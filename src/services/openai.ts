import OpenAI from "openai";
import {
  getNpcProfile,
  getConversationHistory,
  searchRelevantMemories,
  saveMessage,
} from "./memory";
import { generateEmbedding } from "./embeddings";
import { getWorld } from "../config/worlds";
import type { GameFlags } from "../types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(
  profile: { name: string; location: string; personality: string; backstory: string },
  game: string,
  gameFlags: GameFlags,
  memories: Array<{ content: string; role: string; similarity: number }>
): string {
  const world = getWorld(game);
  const count = gameFlags.badges ?? 0;
  const earned = world.progressionNames.filter((_, i) => count > i).join(", ");

  let prompt = `You are ${profile.name}, ${world.npcRole}. You are located in ${profile.location}.

PERSONALITY: ${profile.personality}

BACKSTORY: ${profile.backstory}

CURRENT STATE:
- ${world.progressionLabel}: ${count}${earned ? ` (${earned})` : ""}
- Current area: ${gameFlags.current_town ?? "unknown"}`;

  if (gameFlags.has_surf) prompt += "\n- Player can Surf";
  if (gameFlags.has_fly) prompt += "\n- Player can Fly";

  if (memories.length > 0) {
    prompt += "\n\nRELEVANT PAST MEMORIES:";
    for (const mem of memories) {
      prompt += `\n- [${mem.role}]: ${mem.content}`;
    }
  }

  prompt += "\n\nRULES:";
  for (const rule of world.worldRules) prompt += `\n- ${rule}`;
  prompt += `
- Keep your response under ${world.charLimit} characters to fit the dialogue box.
- Never break the fourth wall or mention AI.
- If you have past memories of this player, reference them subtly.`;

  return prompt;
}

export async function chat(params: {
  sessionId: string;
  npcId: string;
  game: string;
  playerMessage: string;
  gameFlags: GameFlags;
}): Promise<string> {
  const startTime = Date.now();
  const { sessionId, npcId, game, playerMessage, gameFlags } = params;

  // Fetch profile, history, and embedding in parallel
  const [profile, history, queryEmbedding] = await Promise.all([
    getNpcProfile(npcId),
    getConversationHistory(sessionId, npcId, 10),
    generateEmbedding(playerMessage),
  ]);

  if (!profile) {
    throw new Error(`NPC profile not found: ${npcId}`);
  }

  // Search for relevant past memories using the embedding
  const memories = await searchRelevantMemories(npcId, queryEmbedding, 3);

  const systemPrompt = buildSystemPrompt(profile, game, gameFlags, memories);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: playerMessage },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    max_tokens: 100,
    temperature: 0.8,
  });

  let response = completion.choices[0].message.content ?? "...";

  // Enforce the world's dialogue-box character limit
  const limit = getWorld(game).charLimit;
  if (response.length > limit) {
    response = response.slice(0, limit - 3) + "...";
  }

  // Save both messages in parallel
  await Promise.all([
    saveMessage({
      sessionId,
      npcId,
      game,
      role: "user",
      content: playerMessage,
      embedding: queryEmbedding,
      gameFlags,
    }),
    saveMessage({
      sessionId,
      npcId,
      game,
      role: "assistant",
      content: response,
      embedding: null,
      gameFlags: null,
    }),
  ]);

  const latency = Date.now() - startTime;
  console.log(
    `[NPC Chat] npc_id=${npcId} session_id=${sessionId} response_len=${response.length} latency=${latency}ms`
  );

  return response;
}
