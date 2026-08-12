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

/**
 * The password-reset mail. Lives here with everything else that sends, so moving to a
 * different Resend account is two environment variables and no code.
 *
 * Deliberately plain text: a game that emails you like a bank gets marked as spam.
 */
export async function sendResetEmail(to: string, username: string, link: string): Promise<void> {
  await send(to, "Get back into CryptoBuds", [
    `Somebody asked to reset the password for ${username}.`,
    "",
    "Open this to pick a new one. It works once and expires in 45 minutes:",
    link,
    "",
    "If that wasn't you, nothing has changed and you can ignore this.",
  ].join("\n"));
}

/**
 * Is mail actually configured? Reported by /health so a missing key is visible rather than
 * silent — RESEND_API_KEY was absent from production for days and the only symptom was reset
 * links that never arrived, because every route answers the same way whether a send worked
 * or not. Never returns the key itself.
 */
export function mailStatus() {
  return {
    configured: Boolean(KEY),
    from: KEY ? FROM : null,
    adminNotifications: Boolean(ADMIN),
  };
}

export const mail = { send };
