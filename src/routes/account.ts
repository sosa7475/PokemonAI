import { Router } from "express";
import type { Request } from "express";
import { rateLimit, str, LIMITS } from "../middleware/guard";
import {
  register, login, logout, whoAmI, putSave, getSave, accountsReady,
} from "../services/accounts";
import {
  issueNonce, messageFor, linkWallet, unlinkWallet, refreshWallet, walletOf,
} from "../services/wallet";

const router = Router();

const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : undefined;
};

router.get("/status", (_req, res) => res.json({ accounts: accountsReady }));

// Registration is the expensive one (a scrypt hash) and the one worth abusing, so it's
// the tightest limit on the service.
router.post("/register", rateLimit(4, 20), async (req, res) => {
  try {
    const body = req.body as { username?: unknown; password?: unknown };
    const u = str(body.username, LIMITS.name);
    const p = typeof body.password === "string" ? body.password : "";
    if (!u) { res.status(400).json({ error: "Pick a username." }); return; }
    const out = await register(u, p);
    if (!out.ok) { res.status(400).json({ error: out.why }); return; }
    res.json({ token: out.token, account: out.account });
  } catch (err) {
    console.error("[account:register]", err);
    res.status(500).json({ error: "Couldn't create that account." });
  }
});

router.post("/login", rateLimit(6, 40), async (req, res) => {
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
});

router.post("/logout", rateLimit(20, 200), async (req, res) => {
  await logout(bearer(req));
  res.json({ ok: true });
});

router.get("/me", rateLimit(60, 600), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  res.json({ account: me });
});

/** Cloud save. Always scoped to the caller's own account — the client never names one. */
router.get("/save", rateLimit(30, 400), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const save = await getSave(me.id);
  if (!save) { res.status(404).json({ error: "No save stored yet." }); return; }
  res.json(save);
});

router.put("/save", rateLimit(30, 400), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const out = await putSave(me.id, (req.body as { blob?: unknown }).blob);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ ok: true });
});

/* ── wallet: optional, read-only, never custodial ───────────────── */
router.post("/wallet/nonce", rateLimit(20, 200), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const addr = str((req.body as { address?: unknown }).address, 60);
  const nonce = addr ? await issueNonce(me.id, addr) : null;
  if (!nonce || !addr) { res.status(400).json({ error: "That isn't a valid address." }); return; }
  res.json({ nonce, message: messageFor(addr, nonce) });
});

router.post("/wallet/link", rateLimit(10, 80), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const b = req.body as { address?: unknown; signature?: unknown };
  const addr = str(b.address, 60);
  const sig = typeof b.signature === "string" ? b.signature : "";
  if (!addr) { res.status(400).json({ error: "That isn't a valid address." }); return; }
  const out = await linkWallet(me.id, addr, sig);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ address: out.address, tokens: out.tokens });
});

router.post("/wallet/refresh", rateLimit(10, 80), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  const out = await refreshWallet(me.id);
  if (!out.ok) { res.status(400).json({ error: out.why }); return; }
  res.json({ address: out.address, tokens: out.tokens });
});

router.post("/wallet/unlink", rateLimit(10, 80), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  await unlinkWallet(me.id);
  res.json({ ok: true });
});

router.get("/wallet", rateLimit(40, 400), async (req, res) => {
  const me = await whoAmI(bearer(req));
  if (!me) { res.status(401).json({ error: "Not signed in." }); return; }
  res.json(await walletOf(me.id));
});

export default router;
