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

async function send(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!KEY || !to) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      // text is always sent alongside html: it is the fallback for clients that refuse HTML,
      // and a mail with no text part scores worse with spam filters than one with both.
      body: JSON.stringify({ from: FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
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
/**
 * THE PASSWORD RESET.
 *
 * Transactional, not marketing: one thing to do, one button to do it with, and the raw link
 * underneath because a good number of clients strip buttons and a reset that cannot be
 * clicked is a support ticket.
 *
 * Everything is inline-styled and table-laid-out, which is ugly to read and the only thing
 * that survives Outlook and Gmail. No external images — remote images are blocked by default
 * in most clients, so a logo hosted anywhere renders as a broken box on first open. The
 * wordmark here is type.
 */
function resetHtml(username: string, link: string): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const u = esc(username), l = esc(link);
  /* The logo is served from cryptobuds.io — the same domain the mail is now sent from, which
     is the one place a remote image is most likely to be trusted and loaded. It is still
     flattened onto the header colour rather than shipped transparent, because alpha is
     unreliable across clients, and the wordmark stays behind it as alt text so a blocked
     image degrades to words rather than a grey box. */
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f0e3;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Pick a new password for ${u}. The link works once and expires in 45 minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e3;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4dfcc;border-radius:16px;overflow:hidden;">

        <tr><td align="center" style="background:#f4f0e3;padding:26px 28px 18px;border-bottom:3px solid #ff7a1a;">
          <img src="https://www.cryptobuds.io/email/logo-light.png" width="240" alt="CRYPTOBUDS" style="display:block;border:0;width:240px;max-width:74%;height:auto;">
          <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.26em;color:#ff7a1a;text-transform:uppercase;padding-top:10px;font-weight:700;">The Cannaverse</div>
        </td></tr>

        <tr><td style="padding:32px 28px 8px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#0a0d07;font-weight:800;">Let's get you back in</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#33372c;">
            Somebody asked to reset the password for <strong style="color:#3a9a2b;">${u}</strong>.
            Pick a new one and your buds will be right where you left them.
          </p>
        </td></tr>

        <tr><td align="center" style="padding:0 28px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#57c93f;">
            <a href="${l}" style="display:inline-block;padding:15px 36px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:#0a0d07;text-decoration:none;border-radius:12px;">Choose a new password</a>
          </td></tr></table>
        </td></tr>

        <tr><td style="padding:0 28px 26px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 6px;font-size:12px;color:#8a8578;">Button not working? Paste this in:</p>
          <p style="margin:0;font-size:12px;line-height:1.55;word-break:break-all;"><a href="${l}" style="color:#3a9a2b;text-decoration:underline;">${l}</a></p>
        </td></tr>

        <tr><td style="padding:0 28px 28px;">
          <div style="border-top:1px solid #eee8d6;padding-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.65;color:#33372c;">
            The link works <strong style="color:#d9600e;">once</strong> and expires in <strong style="color:#d9600e;">45 minutes</strong>.<br>
            If this wasn't you, nothing has changed and you can ignore it — your password stays as it is.
          </div>
        </td></tr>

        <tr><td style="background:#f4f0e3;padding:18px 28px;border-top:1px solid #e4dfcc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8a8578;">
          We only ever email you about your account. We will never ask for your password, and nobody from CryptoBuds will ever ask for a seed phrase.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendResetEmail(to: string, username: string, link: string): Promise<void> {
  await send(
    to,
    "Get back into CryptoBuds",
    [
      `Somebody asked to reset the password for ${username}.`,
      "",
      "Open this to pick a new one. It works once and expires in 45 minutes:",
      link,
      "",
      "If that wasn't you, nothing has changed and you can ignore this.",
    ].join("\n"),
    resetHtml(username, link),
  );
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
