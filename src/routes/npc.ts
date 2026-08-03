import { Router } from "express";
import { chat } from "../services/openai";
import { getMessageHistory } from "../services/memory";
import { db } from "../db";
import { npcProfiles } from "../db/schema";
import { eq } from "drizzle-orm";
import type { ChatRequest, NpcProfileRequest } from "../types";

const router = Router();

router.post("/chat", async (req, res) => {
  try {
    const { session_id, npc_id, game, player_message, game_flags } =
      req.body as ChatRequest;

    if (!session_id || !npc_id || !game || !player_message) {
      res
        .status(400)
        .json({ error: "session_id, npc_id, game, and player_message are required" });
      return;
    }

    const response = await chat({
      sessionId: session_id,
      npcId: npc_id,
      game,
      playerMessage: player_message,
      gameFlags: game_flags ?? {},
    });

    res.json({ response, npc_id, session_id });
  } catch (err) {
    console.error("[NPC Chat] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to get NPC response";
    res.status(500).json({ error: message });
  }
});

router.get("/:npc_id/history", async (req, res) => {
  try {
    const { npc_id } = req.params;
    const { session_id } = req.query;

    if (!session_id || typeof session_id !== "string") {
      res.status(400).json({ error: "session_id query parameter is required" });
      return;
    }

    const history = await getMessageHistory(session_id, npc_id, 20);

    console.log(
      `[NPC History] npc_id=${npc_id} session_id=${session_id} messages=${history.length}`
    );
    res.json({ npc_id, session_id, messages: history });
  } catch (err) {
    console.error("[NPC History] Error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.post("/profile", async (req, res) => {
  try {
    const { npc_id, game, name, location, personality, backstory } =
      req.body as NpcProfileRequest;

    if (!npc_id || !game || !name || !personality) {
      res
        .status(400)
        .json({ error: "npc_id, game, name, and personality are required" });
      return;
    }

    if (!db) {
      res.status(503).json({ error: "profile upsert requires a database (set DATABASE_URL)" });
      return;
    }

    await db
      .insert(npcProfiles)
      .values({ npcId: npc_id, game, name, location, personality, backstory })
      .onConflictDoUpdate({
        target: npcProfiles.npcId,
        set: { game, name, location, personality, backstory },
      });

    console.log(`[NPC Profile] Upserted npc_id=${npc_id} game=${game}`);
    res.json({ npc_id });
  } catch (err) {
    console.error("[NPC Profile] Error:", err);
    res.status(500).json({ error: "Failed to upsert NPC profile" });
  }
});

export default router;
