import { db } from "../db";
import { npcMemory, npcProfiles } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { NPC_PROFILE_MAP } from "../config/npc-profiles";
import type { GameFlags } from "../types";

export async function getNpcProfile(npcId: string) {
  if (!db) return NPC_PROFILE_MAP[npcId] ?? null; // no-DB fallback to static roster
  const results = await db
    .select()
    .from(npcProfiles)
    .where(eq(npcProfiles.npcId, npcId))
    .limit(1);
  return results[0] ?? NPC_PROFILE_MAP[npcId] ?? null;
}

export async function getConversationHistory(
  sessionId: string,
  npcId: string,
  limit = 10
) {
  if (!db) return [] as Array<{ role: string; content: string }>;
  return db
    .select({ role: npcMemory.role, content: npcMemory.content })
    .from(npcMemory)
    .where(and(eq(npcMemory.sessionId, sessionId), eq(npcMemory.npcId, npcId)))
    .orderBy(desc(npcMemory.createdAt))
    .limit(limit)
    .then((rows) => rows.reverse());
}

export async function searchRelevantMemories(
  npcId: string,
  queryEmbedding: number[],
  limit = 3
) {
  if (!db)
    return [] as Array<{ content: string; role: string; game_flags: unknown; created_at: string; similarity: number }>;
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const results = await db.execute(sql`
    SELECT content, role, game_flags, created_at,
           1 - (embedding <=> ${embeddingStr}::vector) as similarity
    FROM npc_memory
    WHERE npc_id = ${npcId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);
  return results.rows as Array<{
    content: string;
    role: string;
    game_flags: unknown;
    created_at: string;
    similarity: number;
  }>;
}

export async function saveMessage(params: {
  sessionId: string;
  npcId: string;
  game: string;
  role: "user" | "assistant";
  content: string;
  embedding: number[] | null;
  gameFlags: GameFlags | null;
}) {
  if (!db) return; // no-memory mode: nothing persisted
  await db.insert(npcMemory).values({
    sessionId: params.sessionId,
    npcId: params.npcId,
    game: params.game,
    role: params.role,
    content: params.content,
    embedding: params.embedding,
    gameFlags: params.gameFlags,
  });
}

export async function getMessageHistory(
  sessionId: string,
  npcId: string,
  limit = 20
) {
  if (!db)
    return [] as Array<{ role: string; content: string; gameFlags: unknown; createdAt: Date }>;
  return db
    .select({
      role: npcMemory.role,
      content: npcMemory.content,
      gameFlags: npcMemory.gameFlags,
      createdAt: npcMemory.createdAt,
    })
    .from(npcMemory)
    .where(and(eq(npcMemory.sessionId, sessionId), eq(npcMemory.npcId, npcId)))
    .orderBy(desc(npcMemory.createdAt))
    .limit(limit)
    .then((rows) => rows.reverse());
}
