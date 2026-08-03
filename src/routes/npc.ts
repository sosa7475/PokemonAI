import { Router } from "express";
import { chat } from "../services/openai";
import { getMessageHistory } from "../services/memory";
import { db } from "../db";
import { npcProfiles } from "../db/schema";
import { eq } from "drizzle-orm";
import type { ChatRequest, NpcProfileRequest } from "../types";
import { rateLimit, requireAdmin, str, safeFlags, LIMITS } from "../middleware/guard";

const router = Router();

// every call here costs money at OpenAI, so it is the most tightly bounded route
router.post("/chat", rateLimit(20, 300), async (req, res) => {
  try {
    const body = req.body as ChatRequest;
    const sessionId = str(body.session_id, LIMITS.id);
    const npcId = str(body.npc_id, LIMITS.id);
    const game = str(body.game, LIMITS.id);
    const playerMessage = str(body.player_message, LIMITS.message);

    if (!sessionId || !npcId || !game || !playerMessage) {
      res
        .status(400)
        .json({ error: "session_id, npc_id, game, and player_message are required" });
      return;
    }

    const response = await chat({
      sessionId,
      npcId,
      game,
      playerMessage,
      gameFlags: safeFlags(body.game_flags),
    });

    res.json({ response, npc_id: npcId, session_id: sessionId });
  } catch (err) {
    console.error("[NPC Chat] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to get NPC response";
    res.status(500).json({ error: message });
  }
});

router.get("/:npc_id/history", rateLimit(60, 600), async (req, res) => {
  try {
    const npc_id = str(req.params.npc_id, LIMITS.id);
    const session_id = str(req.query.session_id, LIMITS.id);

    if (!session_id || !npc_id) {
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

// rewriting who an NPC IS is an authoring action, not something a player can do
router.post("/profile", requireAdmin, async (req, res) => {
  try {
    const body = req.body as NpcProfileRequest;
    const npc_id = str(body.npc_id, LIMITS.id);
    const game = str(body.game, LIMITS.id);
    const name = str(body.name, LIMITS.name);
    const location = str(body.location, LIMITS.name);
    const personality = str(body.personality, LIMITS.text);
    const backstory = str(body.backstory, LIMITS.text);

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
      .values({ npcId: npc_id, game, name, location: location ?? "", personality, backstory: backstory ?? "" })
      .onConflictDoUpdate({
        target: npcProfiles.npcId,
        set: { game, name, location: location ?? "", personality, backstory: backstory ?? "" },
      });

    console.log(`[NPC Profile] Upserted npc_id=${npc_id} game=${game}`);
    res.json({ npc_id });
  } catch (err) {
    console.error("[NPC Profile] Error:", err);
    res.status(500).json({ error: "Failed to upsert NPC profile" });
  }
});

export default router;
