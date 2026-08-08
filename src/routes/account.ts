import { Router } from "express";
import type { Request } from "express";
import { rateLimit, str, LIMITS, guarded } from "../middleware/guard";
import {
  register, login, logout, whoAmI, putSave, getSave, accountsReady,
} from "../services/accounts";
import {
  issueNonce, messageFor, linkWallet, unlinkWallet, refreshWallet, walletOf,
} from "../services/wallet";
import { recordMilestones, completionOf } from "../services/progress";

const router = Router();

const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : undefined;
};

router.get("/status", (_req, res) => res.json({ accounts: accountsReady }));

// Registration is the expensive one (a scrypt hash) and the one worth abusing, so it stays
// the tightest limit on the service — but the limiter keys on IP, and a group of friends
// signing up together from one house or one office is a single IP. 4/min turned that into
// "the game is broken" for everyone after the first four. A scrypt hash is ~100ms, so this
// is still nowhere near a cost anyone can exploit.
router.post("/register", rateLimit(10, 50), guarded(async (req, res) => {
  try {
    const body = req.body as { username?: unknown; password?: unknown; email?: unknown };
    const u = str(body.username, LIMITS.name);
    const p = typeof body.password === "string" ? body.password : "";
    if (!u) { res.status(400).json({ error: "Pick a username." }); return; }
    // Optional on the wire so existing clients keep working, but the game asks for it.
    const e = body.email === undefined || body.email === "" ? undefined : str(body.email, 254) ?? "";
    const out = await register(u, p, e);
    if (!out.ok) { res.status(400).json({ error: out.why }); return; }
    res.json({ token: out.token, account: out.account });
  } catch (err) {
    console.error("[account:register]", err);
    res.status(500).json({ error: "Couldn't create that account." });
  }
}));

// 6/min was too tight for an honest player: two typos and a retry and they are locked out
// with "Slow down", which is indistinguishable from "this game will not let me in". Per-
// account lockout after repeated failures is the real brute-force defence and it is
// untouched — this limit only needs to stop a flood, not police somebody's memory.
router.post("/login", rateLimit(20, 120), guarded(async (req, res) => {
  try {
    const body = req.body as { username?: unknown; password?: unknown };
    const u = typeof body.username === "string" ? body.username : "";
    const p = typeof body.password === "string" ? body.password : "";
    const out = await login(u, p);
    if (!out.ok) { res.status(401).json({ error: out.why }); return; }
    res.json({ token: out.token, account: out.account });
  } catch (err) {
    console.error("[account:login]", err);
    res.status(500).json({ error: "Couldn't sign you in." });
  }
}));

router.post("/logout", rateLimit(20, 200), guarded(async (req, res) => {
  await logout(bearer(req));
  res.json({ ok: true });
}));

router.get("/me", rateLimit(60, 600), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  res.json({ account: me });
}));

/** Cloud save. Always scoped to the caller's own account — the client never names one. */
router.get("/save", rateLimit(30, 400), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const save = await getSave(me.id);
  if (!save) { res.status(404).json({ error: "No save stored yet." }); return; }
  res.json(save);
}));

router.put("/save", rateLimit(30, 400), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const out = await putSave(me.id, (req.body as { blob?: unknown }).blob);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true });
}));

/* ── progress: the server's own record of the playthrough ────────── */

/**
 * The client reports what it DID — never that it finished. There is no "finished" field to
 * send and no endpoint that takes one: completion is derived in `services/progress.ts` from
 * the whole required set being present, each row stamped with this server's clock.
 *
 * The limit is generous because a milestone is cheap and losing one costs a real player their
 * proof; the write is idempotent, so a client that resends its whole set every sync — which
 * is exactly what it does — costs nothing but a no-op insert.
 */
router.post("/milestone", rateLimit(30, 300), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { keys?: unknown; minutes?: unknown };
  const out = await recordMilestones(me.id, b.keys, b.minutes);
  res.json({ recorded: out.recorded, completion: out.completion });
}));

/**
 * The single read-only truth about a finished game. `rank` is the Nth player to finish; it is
 * recorded from the first completion onwards even though nothing consumes it yet, because it
 * is the one thing here that cannot be worked out after the fact.
 */
router.get("/completion", rateLimit(60, 600), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  res.json(await completionOf(me.id));
}));

/* ── wallet: optional, read-only, never custodial ───────────────── */
router.post("/wallet/nonce", rateLimit(20, 200), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const addr = str((req.body as { address?: unknown }).address, 60);
  const nonce = addr ? await issueNonce(me.id, addr) : null;
  if (!nonce || !addr) { res.status(400).json({ error: "That isn't a valid address." }); return; }
  res.json({ nonce, message: messageFor(addr, nonce) });
}));

router.post("/wallet/link", rateLimit(10, 80), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { address?: unknown; signature?: unknown };
  const addr = str(b.address, 60);
  const sig = typeof b.signature === "string" ? b.signature : "";
  if (!addr) { res.status(400).json({ error: "That isn't a valid address." }); return; }
  const out = await linkWallet(me.id, addr, sig);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ address: out.address, tokens: out.tokens });
}));

router.post("/wallet/refresh", rateLimit(10, 80), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const out = await refreshWallet(me.id);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ address: out.address, tokens: out.tokens });
}));

router.post("/wallet/unlink", rateLimit(10, 80), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  await unlinkWallet(me.id);
  res.json({ ok: true });
}));

router.get("/wallet", rateLimit(40, 400), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  res.json(await walletOf(me.id));
}));

export default router;
