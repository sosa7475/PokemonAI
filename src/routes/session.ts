import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { sessions } from "../db/schema";
import type { SessionRequest } from "../types";
import { rateLimit, str, LIMITS } from "../middleware/guard";

const router = Router();

router.post("/", rateLimit(10, 100), async (req, res) => {
  try {
    const body = req.body as SessionRequest;
    const player_name = str(body.player_name, LIMITS.name);
    const game = str(body.game, LIMITS.id);

    if (!player_name || !game) {
      res.status(400).json({ error: "player_name and game are required" });
      return;
    }

    // No-DB mode: hand back an ephemeral session id (no persistence).
    if (!db) {
      const id = randomUUID();
      console.log(`[Session] (no-db) ephemeral session=${id} player=${player_name} game=${game}`);
      res.json({ session_id: id });
      return;
    }

    const [session] = await db
      .insert(sessions)
      .values({ playerName: player_name, game })
      .returning({ id: sessions.id });

    console.log(`[Session] Created session=${session.id} player=${player_name} game=${game}`);
    res.json({ session_id: session.id });
  } catch (err) {
    console.error("[Session] Error:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

export default router;
