/**
 * MAILING LIST — one field, one job.
 *
 * Signing up here is not an account and does not touch the game. It exists so somebody who
 * lands on the site before they are ready to play can be told when there is something worth
 * coming back for.
 *
 * Two deliberate properties:
 *   · It always answers the same way. "Already on the list" would let anybody type an
 *     address and learn whether that person signed up, which is a membership oracle for free.
 *   · Re-submitting an address is not an error and does not create a second row — people
 *     double-tap buttons, and a duplicate should be a no-op rather than a 400.
 */
import { Router } from "express";
import { rateLimit, str, guarded } from "../middleware/guard";
import { neon } from "@neondatabase/serverless";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;
const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length >= 6 && e.length <= 254 && EMAIL_RE.test(e) ? e : null;
};

router.post("/subscribe", rateLimit(10, 60), guarded(async (req, res) => {
  const SAME = { ok: true, message: "You're on the list." };
  const b = req.body as { email?: unknown; source?: unknown };
  const email = clean(b.email);
  if (!email) { res.status(400).json({ error: "That email doesn't look right." }); return; }
  if (!sql) { res.json(SAME); return; }
  const source = str(b.source, 40) ?? "site";
  try {
    await sql`insert into cb_leads (email, source) values (${email}, ${source})
              on conflict (email) do update set unsubbed_at = null`;
  } catch (err) {
    console.error("[leads:subscribe]", err);
  }
  res.json(SAME);   // identical whether it was new, a repeat, or a failure
}));

router.post("/unsubscribe", rateLimit(10, 60), guarded(async (req, res) => {
  const email = clean((req.body as { email?: unknown }).email);
  if (!email) { res.status(400).json({ error: "That email doesn't look right." }); return; }
  if (sql) await sql`update cb_leads set unsubbed_at = now() where email = ${email}`;
  res.json({ ok: true, message: "Removed. Sorry to see you go." });
}));

export default router;
