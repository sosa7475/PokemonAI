import OpenAI from "openai";
import {
  getNpcProfile,
  getConversationHistory,
  searchRelevantMemories,
  saveMessage,
} from "./memory";
import { generateEmbedding } from "./embeddings";
import type { GameFlags } from "../types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(
  profile: { name: string; location: string; personality: string; backstory: string },
  gameFlags: GameFlags,
  memories: Array<{ content: string; role: string; similarity: number }>
): string {
  const badgeNames = [
    "Stone", "Knuckle", "Dynamo", "Heat",
    "Balance", "Feather", "Mind", "Rain",
  ];
  const badgeCount = gameFlags.badges ?? 0;
  const earnedBadges = badgeNames
    .filter((_, i) => badgeCount > i)
    .join(", ");

  let prompt = `You are ${profile.name}, a Pokemon NPC located in ${profile.location}.

PERSONALITY: ${profile.personality}

BACKSTORY: ${profile.backstory}

CURRENT GAME STATE:
- Badges earned: ${badgeCount}${earnedBadges ? ` (${earnedBadges})` : ""}
- Current town: ${gameFlags.current_town ?? "unknown"}`;

  if (gameFlags.has_surf) prompt += "\n- Player has Surf";
  if (gameFlags.has_fly) prompt += "\n- Player has Fly";

  if (memories.length > 0) {
    prompt += "\n\nRELEVANT PAST MEMORIES:";
    for (const mem of memories) {
      prompt += `\n- [${mem.role}]: ${mem.content}`;
    }
  }

  prompt += `

RULES:
- Stay fully in character as a Pokemon world NPC at all times
- Keep your response under 200 characters to fit the GBA dialogue box
- Never break the fourth wall or mention AI
- React to the player's badge count and game progress naturally
- If you have past memories of this player, reference them subtly`;

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

  const systemPrompt = buildSystemPrompt(profile, gameFlags, memories);

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

  // Enforce 200 character limit
  if (response.length > 200) {
    response = response.slice(0, 197) + "...";
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
