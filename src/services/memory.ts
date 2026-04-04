import { db } from "../db";
import { npcMemory, npcProfiles } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { generateEmbedding } from "./embeddings";
import type { GameFlags } from "../types";

export async function getNpcProfile(npcId: string) {
  const results = await db
    .select()
    .from(npcProfiles)
    .where(eq(npcProfiles.npcId, npcId))
    .limit(1);
  return results[0] ?? null;
}

export async function getConversationHistory(
  sessionId: string,
  npcId: string,
  limit = 10
) {
  return db
    .select({
      role: npcMemory.role,
      content: npcMemory.content,
    })
    .from(npcMemory)
    .where(
      and(eq(npcMemory.sessionId, sessionId), eq(npcMemory.npcId, npcId))
    )
    .orderBy(desc(npcMemory.createdAt))
    .limit(limit)
    .then((rows) => rows.reverse());
}

export async function searchRelevantMemories(
  npcId: string,
  queryEmbedding: number[],
  limit = 3
) {
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
  return db
    .select({
      role: npcMemory.role,
      content: npcMemory.content,
      gameFlags: npcMemory.gameFlags,
      createdAt: npcMemory.createdAt,
    })
    .from(npcMemory)
    .where(
      and(eq(npcMemory.sessionId, sessionId), eq(npcMemory.npcId, npcId))
    )
    .orderBy(desc(npcMemory.createdAt))
    .limit(limit)
    .then((rows) => rows.reverse());
}
