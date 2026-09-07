import { Router } from "express";
import type { Request } from "express";
import { rateLimit, str, LIMITS, guarded } from "../middleware/guard";
import { notifyAdmin, sendResetEmail } from "../services/notify";
import {
  register, login, logout, whoAmI, putSave, getSave, accountsReady,
  createReset, findForReset, consumeReset, setEmail,
} from "../services/accounts";
import {
  issueChallenge, linkWallet, unlinkWallet, refreshWallet, walletOf,
} from "../services/wallet";
import { recordMilestones, completionOf } from "../services/progress";

const router = Router();

/** Where the reset link points. Env-overridable so a preview deploy doesn't mail prod links. */
const GAME_URL = process.env.GAME_URL || "https://www.cryptobuds.world";


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
    // A new player is the number Sam actually watches. Fire and forget — a mail provider
    // having a bad second must never be why somebody cannot create an account.
    notifyAdmin(`CryptoBuds: ${out.account.username} started playing`, [
      `${out.account.username} just created an account.`,
      e ? `Email on file: yes` : `Email on file: no (cannot recover this account)`,
    ]);
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
/* The challenge names the origin asking for it, and the server decides whether that origin
   is allowed to ask — see services/wallet.ts for the attack that makes this necessary. */
router.post("/wallet/challenge", rateLimit(20, 200), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { address?: unknown; domain?: unknown; uri?: unknown; chainId?: unknown };
  const addr = str(b.address, 60);
  const domain = str(b.domain, 120);
  const uri = str(b.uri, 300);
  const chainId = typeof b.chainId === "number" ? b.chainId : 0;
  if (!addr || !domain || !uri) { res.status(400).json({ error: "Bad request." }); return; }
  const out = await issueChallenge(me.id, addr, domain, uri, chainId);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ nonce: out.nonce, message: out.message });
}));

router.post("/wallet/link", rateLimit(10, 80), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { address?: unknown; message?: unknown; signature?: unknown };
  const addr = str(b.address, 60);
  const message = typeof b.message === "string" ? b.message : "";
  const sig = typeof b.signature === "string" ? b.signature : "";
  if (!addr) { res.status(400).json({ error: "That isn't a valid address." }); return; }
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const out = await linkWallet(me.id, addr, message, sig, ip);
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
  await unlinkWallet(me.id, (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim());
  res.json({ ok: true });
}));

router.get("/wallet", rateLimit(40, 400), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  res.json(await walletOf(me.id));
}));


/* ── PASSWORD RESET ──────────────────────────────────────────────────────────────────────
 * Always answers the same thing whether or not the account exists. Anything else is a free
 * membership oracle: type an email, learn who plays.
 */
router.post("/reset-request", rateLimit(5, 20), guarded(async (req, res) => {
  const SAME = { ok: true, message: "If there's an account with an email on it, a reset link is on its way." };
  try {
    const id = str((req.body as { identifier?: unknown }).identifier, 254);
    if (!id) { res.json(SAME); return; }
    const who = await findForReset(id);
    // No account, or an account with no email on it, both end here — and look identical.
    if (!who?.email) { res.json(SAME); return; }
    const token = await createReset(who.id);
    const link = `${GAME_URL}/?reset=${encodeURIComponent(token)}`;
    await sendResetEmail(who.email, who.username, link);
    res.json(SAME);
  } catch (err) {
    console.error("[account:reset-request]", err);
    res.json(SAME);   // even a failure must not leak whether the account was real
  }
}));

router.post("/reset", rateLimit(10, 40), guarded(async (req, res) => {
  const b = req.body as { token?: unknown; password?: unknown };
  const t = typeof b.token === "string" ? b.token : "";
  const p = typeof b.password === "string" ? b.password : "";
  const out = await consumeReset(t, p);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true, username: out.username });
}));

/** Attach an email to your own account — the fix for every run made before we asked for one. */
router.post("/email", rateLimit(10, 40), guarded(async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const e = str((req.body as { email?: unknown }).email, 254);
  if (!e) { res.status(400).json({ error: "Pick an email." }); return; }
  const out = await setEmail(me.id, e);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true });
}));

export default router;
