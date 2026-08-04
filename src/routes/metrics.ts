import { Router } from "express";
import type { Request } from "express";
import { rateLimit, str, requireAdmin } from "../middleware/guard";
import { whoAmI } from "../services/accounts";
import { recordEvents, recordFeedback, stats, setFeedbackStatus, telemetryReady } from "../services/telemetry";
import { dashboardHtml } from "./dashboard";

const router = Router();

const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : undefined;
};

/** The browser id. Generated client-side; only ever used to count distinct players. */
const anonOf = (req: Request): string | null => str((req.body as { anon?: unknown }).anon, 40);

/**
 * Events arrive in batches on a timer, so the limit is per batch and generous — a long
 * session is a handful of calls, and a player who somehow exceeds it just loses stats,
 * never gameplay.
 */
router.post("/events", rateLimit(30, 400), async (req, res) => {
  if (!telemetryReady) { res.json({ ok: true, stored: 0 }); return; }
  const anon = anonOf(req);
  if (!anon) { res.status(400).json({ error: "Missing id." }); return; }
  const me = await whoAmI(bearer(req));
  const body = req.body as { events?: unknown };
  const stored = await recordEvents(anon, me?.id ?? null, Array.isArray(body.events) ? body.events : []);
  res.json({ ok: true, stored });
});

router.post("/feedback", rateLimit(5, 30), async (req, res) => {
  const anon = anonOf(req);
  const b = req.body as { kind?: unknown; message?: unknown; context?: unknown };
  const message = str(b.message, 2000);
  if (!message || message.length < 4) { res.status(400).json({ error: "Tell us a bit more than that." }); return; }
  const me = await whoAmI(bearer(req));
  await recordFeedback(anon ?? "unknown", me?.id ?? null,
    b.kind === "bug" ? "bug" : "idea", message, b.context);
  res.json({ ok: true });
});

/* ── operator only ───────────────────────────────────────────────── */
router.get("/admin/stats", requireAdmin, async (_req, res) => {
  const s = await stats();
  if (!s) { res.status(503).json({ error: "No database configured." }); return; }
  res.json(s);
});

router.post("/admin/feedback/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id." }); return; }
  await setFeedbackStatus(id, String((req.body as { status?: unknown }).status ?? "new"));
  res.json({ ok: true });
});

/**
 * The dashboard page itself is public; every number on it arrives through the admin
 * endpoint above, which is not. So the page renders empty until you paste the key, and
 * serving it costs nothing.
 */
router.get("/dashboard", (_req, res) => {
  res.type("html").send(dashboardHtml());
});

export default router;
