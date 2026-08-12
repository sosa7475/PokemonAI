/**
 * OUTBOUND MAIL — one place, so nothing else has to know how sending works.
 *
 * Two rules, both learned the hard way elsewhere in this codebase:
 *
 *  1. A send NEVER fails the request that triggered it. Somebody joining a mailing list must
 *     not see an error because our mail provider had a bad second. Every failure here is
 *     logged and swallowed.
 *  2. It never leaks whether an address exists. The routes that call this already answer
 *     identically in every case; this must not undo that by taking measurably longer or
 *     throwing on one path and not another.
 *
 * FROM address: Resend's free plan allows one verified domain and that slot is taken by
 * agilityautomations.com, so mail goes out from there. Player-facing mail should move to
 * cryptobuds.io once that domain is verified — it is a one-line change here.
 */
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || "CryptoBuds <cryptobuds@agilityautomations.com>";
const ADMIN = process.env.ADMIN_EMAIL || "";

async function send(to: string, subject: string, text: string): Promise<void> {
  if (!KEY || !to) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!r.ok) console.error("[notify] resend refused:", r.status, (await r.text()).slice(0, 200));
  } catch (err) {
    console.error("[notify] send failed", err);
  }
}

/** Fire and forget. Callers must not await this — it is a side effect, not a step. */
export function notifyAdmin(subject: string, lines: string[]): void {
  if (!ADMIN) return;
  void send(ADMIN, subject, lines.join("\n"));
}

export const mail = { send };
