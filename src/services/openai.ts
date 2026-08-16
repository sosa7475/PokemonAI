import OpenAI from "openai";
import {
  getNpcProfile,
  getConversationHistory,
  searchRelevantMemories,
  saveMessage,
} from "./memory";
import { generateEmbedding } from "./embeddings";
import { getWorld } from "../config/worlds";
import { hasDb } from "../db";
import type { GameFlags } from "../types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** What the story is about, act by act. A bud who does not know what is going on in the world
 *  says nothing that connects to it — which is exactly how the dialogue read: fine sentences
 *  about nothing, in a game with a plot running through it. */
const ACT_CONTEXT: Record<number, string> = {
  1: "Nothing has happened yet. The block is the block. If anything is wrong, nobody has said so.",
  2: "People are starting to notice the local harvest never seems to reach local blocks.",
  3: "Two crews, Blue Dream and Red Haze, are beefing — and it is slowly dawning that they answer to the same landlord.",
  4: "The universities and labs are involved. Somebody is testing product and not saying for who.",
  5: "The docks at Port Reup move something at 3am. Everyone knows and nobody says.",
  6: "Verdant Wellness Group is hiring, expanding, and rebranding. The dispensaries are theirs.",
  7: "The Heights have a client list. Everyone respectable is on it.",
  8: "The Underground is real, it is beneath the ridge, and buds are being held in it.",
  9: "There is an island nobody talks about, and an auction on it.",
  10: "It is over, and nothing has changed. A new one was appointed on the Tuesday.",
};

function buildSystemPrompt(
  profile: { name: string; location: string; personality: string; backstory: string },
  game: string,
  gameFlags: GameFlags,
  memories: Array<{ content: string; role: string; similarity: number }>
): string {
  const world = getWorld(game);
  const count = gameFlags.badges ?? 0;
  const earned = world.progressionNames.filter((_, i) => count > i).join(", ");

  /* The character's OWN name and place win over the persona's. Five personas are shared by
   * 301 characters, so without this a bud called Purple Pie in Trichome Heights was told it
   * was Sour D at The Block — and answered as him. Most of the "random" dialogue was a
   * character being asked to be somebody else, somewhere else. */
  const name = gameFlags.npc_name || profile.name;
  const place = gameFlags.npc_place || profile.location;
  const act = Number(gameFlags.act ?? 0);

  let prompt = `You are ${name}, ${world.npcRole}. You are standing in ${place}.`;
  if (name !== profile.name) {
    prompt += `\n\nYou are NOT ${profile.name}. You are ${name}, an ordinary bud who lives here. ` +
      `Use the voice below as a register, not as an identity — never claim their name, job or history.`;
  }
  prompt += `

PERSONALITY: ${profile.personality}

BACKSTORY: ${profile.backstory}

CURRENT STATE:
- ${world.progressionLabel}: ${count}${earned ? ` (${earned})` : ""}
- Current area: ${gameFlags.current_town ?? "unknown"}`;

  if (ACT_CONTEXT[act]) {
    prompt += `\n\nWHAT IS GOING ON IN THE WORLD RIGHT NOW:\n${ACT_CONTEXT[act]}\n` +
      `You may allude to this the way somebody living here would — gossip, a complaint, a rumour, ` +
      `something a cousin said. You do NOT explain it, and you do not know the whole picture. ` +
      `Most buds are talking about rent, work and each other, and the plot is just weather to them.`;
  }

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
    hasDb ? generateEmbedding(playerMessage) : Promise.resolve([] as number[]),
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
