import { Router } from "express";
import type { Request } from "express";
import { rateLimit, str, guarded } from "../middleware/guard";
import { whoAmI } from "../services/accounts";
import { putProfile, leaderboard, type Board } from "../services/profiles";
import {
  checkIn, checkOut, myBuds, list, unlist, board, swap, opponents, fight, record, seshReady,
} from "../services/sesh";

const router = Router();

const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : undefined;
};

/** Every route in here needs an account — the Sesh is the part that isn't anonymous. */
const me = async (req: Request) => whoAmI(bearer(req));

/* ── profile + leaderboard ──────────────────────────────────────── */

router.put("/profile", rateLimit(20, 200), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  await putProfile(who.id, req.body as Record<string, unknown>);
  res.json({ ok: true });
}));

/** Public on purpose — a leaderboard nobody can look at isn't one. */
router.get("/leaderboard", rateLimit(60, 600), guarded(async (req, res) => {
  const b = String(req.query.board ?? "props") as Board;
  res.json({ board: b, rows: await leaderboard(b) });
}));

/* ── the Sesh ───────────────────────────────────────────────────── */

router.get("/", rateLimit(60, 600), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const [buds, offers, foes, rec] = await Promise.all([
    myBuds(who.id), board(who.id), opponents(who.id), record(who.id),
  ]);
  res.json({ ready: seshReady, buds, offers, opponents: foes, record: rec });
}));

router.post("/check-in", rateLimit(30, 300), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const out = await checkIn(who.id, (req.body as { bud?: unknown }).bud as never);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true });
}));

router.post("/check-out", rateLimit(30, 300), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const uid = str((req.body as { uid?: unknown }).uid, 40);
  if (uid) await checkOut(who.id, uid);
  res.json({ ok: true });
}));

router.post("/list", rateLimit(30, 300), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { uid?: unknown; want?: unknown };
  const uid = str(b.uid, 40);
  if (!uid) { res.status(400).json({ error: "Which bud?" }); return; }
  const out = await list(who.id, uid, str(b.want, 60));
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true });
}));

router.post("/unlist", rateLimit(30, 300), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const uid = str((req.body as { uid?: unknown }).uid, 40);
  if (uid) await unlist(who.id, uid);
  res.json({ ok: true });
}));

router.post("/trade", rateLimit(20, 150), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { offerId?: unknown; give?: unknown };
  const offerId = Number(b.offerId);
  const give = str(b.give, 40);
  if (!Number.isInteger(offerId) || !give) { res.status(400).json({ error: "Bad trade." }); return; }
  const out = await swap(who.id, offerId, give);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true, got: out.got });
}));

router.post("/battle", rateLimit(20, 150), guarded(async (req, res) => {
  const who = await me(req);
  if (!who) { res.status(401).json({ error: "Not signed in." }); return; }
  const foe = str((req.body as { opponent?: unknown }).opponent, 40);
  if (!foe) { res.status(400).json({ error: "Who?" }); return; }
  const out = await fight(who.id, foe);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ won: out.won, log: out.log });
}));

export default router;
