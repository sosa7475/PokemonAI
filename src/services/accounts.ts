/**
 * PLAYER ACCOUNTS.
 *
 * A game save is not money, but it is somebody's twenty hours, and people reuse passwords
 * everywhere. So this is built to the standard you'd use for something that mattered:
 *
 *  · scrypt for passwords (memory-hard, so a leaked table can't be brute-forced cheaply),
 *    per-user random salt, timing-safe comparison
 *  · session tokens are 256 bits of CSPRNG; only their SHA-256 is stored, so a database
 *    leak still can't be used to log in as anyone
 *  · identical error text for "no such user" and "wrong password" — no account enumeration
 *  · per-account lockout on top of the per-IP rate limit, so one target can't be ground down
 *  · the database role behind this can see three tables and nothing else in the estate
 *
 * Tokens go in the Authorization header rather than a cookie ON PURPOSE: the game and the
 * API are on different origins, and Safari drops third-party cookies, so a cookie session
 * would silently fail for a big slice of players.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const scrypt = promisify(_scrypt) as (p: string | Buffer, s: string | Buffer, k: number, o?: object) => Promise<Buffer>;

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const SESSION_DAYS = 90;
const MAX_SAVE_BYTES = 512 * 1024;
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

/** Its own connection, on the least-privileged role. Falls back to the shared one locally. */
const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
export const accountsReady = Boolean(url);
const sql = url ? neon(url) : null;

export const USERNAME_RE = /^[a-z0-9_](?:[a-z0-9_-]{1,18}[a-z0-9_])?$/;

export function checkUsername(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const t = u.trim().toLowerCase();
  return USERNAME_RE.test(t) ? t : null;
}
export function checkPassword(p: unknown): string | null {
  if (typeof p !== "string") return null;
  if (p.length < 8 || p.length > 200) return null;
  return p;
}

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `s1$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [tag, saltB64, keyB64] = stored.split("$");
  if (tag !== "s1" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(pw, Buffer.from(saltB64, "base64"), expected.length, { N, r: R, p: P });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export interface Account { id: string; username: string }

/** Deliberately vague, and the same for every failure mode. */
export const BAD_LOGIN = "That username and password don't match.";

/**
 * Email is what makes an account recoverable.
 *
 * Until now a run was tied to a username and a password and nothing else, so a player who
 * forgot either had lost twenty hours with no way back — and the only person who could help
 * was Sam, by hand, with no way to prove the account was theirs. It is stored lowercased and
 * trimmed as its own unique key, so Sam@x.com and sam@x.com cannot become two accounts
 * racing for the same inbox.
 *
 * Deliberately NOT verified at sign-up: a verification round-trip in front of a first-time
 * player is exactly the friction the sign-up gate was designed to avoid. It is recorded so
 * recovery is possible later; proving it belongs to them is a problem for the day recovery
 * is actually built.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
export function checkEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length < 6 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

export async function register(username: string, password: string, email?: string): Promise<
  { ok: true; token: string; account: Account } | { ok: false; why: string }
> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  const key = checkUsername(username);
  if (!key) return { ok: false, why: "Usernames are 3–20 characters: letters, numbers, _ and -." };
  const pw = checkPassword(password);
  if (!pw) return { ok: false, why: "Passwords need to be at least 8 characters." };

  const mail = email === undefined ? null : checkEmail(email);
  if (email !== undefined && !mail) return { ok: false, why: "That email doesn't look right." };

  const taken = await sql`select 1 from cb_accounts where username_key = ${key} limit 1`;
  if (taken.length) return { ok: false, why: "That name's taken." };
  if (mail) {
    const dupe = await sql`select 1 from cb_accounts where email = ${mail} limit 1`;
    if (dupe.length) return { ok: false, why: "There's already an account on that email." };
  }

  const hash = await hashPassword(pw);
  const rows = await sql`
    insert into cb_accounts (username_key, username, pw_hash, email)
    values (${key}, ${username.trim()}, ${hash}, ${mail})
    returning id, username`;
  const acct = { id: rows[0].id as string, username: rows[0].username as string };
  return { ok: true, token: await startSession(acct.id), account: acct };
}

export async function login(username: string, password: string): Promise<
  { ok: true; token: string; account: Account } | { ok: false; why: string }
> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  // Whichever they typed. Somebody signing in on a new phone six months later remembers the
  // address they used far more reliably than the handle they picked, so both are accepted.
  const mail = checkEmail(username);
  const key = checkUsername(username);
  const pw = checkPassword(password);
  // Still do a hash even on malformed input, so a bad identifier isn't measurably faster
  if ((!key && !mail) || !pw) { await hashPassword("timing-equaliser"); return { ok: false, why: BAD_LOGIN }; }

  const rows = mail
    ? await sql`
        select id, username, pw_hash, locked_until, failed_logins
        from cb_accounts where email = ${mail} limit 1`
    : await sql`
        select id, username, pw_hash, locked_until, failed_logins
        from cb_accounts where username_key = ${key} limit 1`;
  if (!rows.length) { await hashPassword("timing-equaliser"); return { ok: false, why: BAD_LOGIN }; }

  const row = rows[0] as { id: string; username: string; pw_hash: string; locked_until: string | null; failed_logins: number };
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return { ok: false, why: `Too many tries. Give it ${LOCK_MINUTES} minutes.` };
  }

  if (!(await verifyPassword(pw, row.pw_hash))) {
    const fails = (row.failed_logins ?? 0) + 1;
    if (fails >= LOCK_AFTER) {
      await sql`update cb_accounts set failed_logins = 0,
        locked_until = now() + make_interval(mins => ${LOCK_MINUTES}) where id = ${row.id}`;
    } else {
      await sql`update cb_accounts set failed_logins = ${fails} where id = ${row.id}`;
    }
    return { ok: false, why: BAD_LOGIN };
  }

  await sql`update cb_accounts set failed_logins = 0, locked_until = null, last_login = now() where id = ${row.id}`;
  const acct = { id: row.id, username: row.username };
  return { ok: true, token: await startSession(acct.id), account: acct };
}

async function startSession(accountId: string): Promise<string> {
  const token = newToken();
  await sql!`
    insert into cb_sessions (token_hash, account_id, expires_at)
    values (${sha(token)}, ${accountId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  // opportunistic cleanup; cheap and keeps the table from growing forever
  await sql!`delete from cb_sessions where expires_at < now()`;
  return token;
}

export async function whoAmI(token: string | undefined): Promise<Account | null> {
  if (!sql || !token || token.length > 200) return null;
  const rows = await sql`
    select a.id, a.username from cb_sessions s
    join cb_accounts a on a.id = s.account_id
    where s.token_hash = ${sha(token)} and s.expires_at > now() limit 1`;
  if (!rows.length) return null;
  void sql`update cb_sessions set seen_at = now() where token_hash = ${sha(token)}`;
  return { id: rows[0].id as string, username: rows[0].username as string };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!sql || !token) return;
  await sql`delete from cb_sessions where token_hash = ${sha(token)}`;
}

/** The save is the player's own data — we store it, we never trust it for anything else. */
export async function putSave(accountId: string, blob: unknown): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  if (typeof blob !== "string") return { ok: false, why: "Bad save format." };
  const bytes = Buffer.byteLength(blob, "utf8");
  if (bytes > MAX_SAVE_BYTES) return { ok: false, why: "That save is too big." };
  try {
    const parsed = JSON.parse(blob);
    if (!parsed || typeof parsed !== "object" || typeof parsed.version !== "number") {
      return { ok: false, why: "That doesn't look like a CryptoBuds save." };
    }
  } catch { return { ok: false, why: "That save isn't valid JSON." }; }

  await sql`
    insert into cb_saves (account_id, blob, bytes) values (${accountId}, ${blob}, ${bytes})
    on conflict (account_id) do update set blob = excluded.blob, bytes = excluded.bytes, updated_at = now()`;
  return { ok: true };
}

export async function getSave(accountId: string): Promise<{ blob: string; updatedAt: string } | null> {
  if (!sql) return null;
  const rows = await sql`select blob, updated_at from cb_saves where account_id = ${accountId} limit 1`;
  if (!rows.length) return null;
  return { blob: rows[0].blob as string, updatedAt: String(rows[0].updated_at) };
}

/* ── PASSWORD RESET ──────────────────────────────────────────────────────────────────────
 * Sam forgot his own password on day four, which is the fastest possible demonstration that
 * "you can never get back in" is not an acceptable answer for a game people put twenty hours
 * into.
 *
 * The token is random, single-use, short-lived, and stored HASHED — same treatment as a
 * session token, for the same reason: a leaked table must not hand anybody a working reset
 * link. Redeeming one kills every other outstanding token for that account and every live
 * session, so a reset also boots whoever might already be in there.
 */
const RESET_MINUTES = 45;

/** Mint a reset token. Returns the RAW token — the only time it exists in readable form. */
export async function createReset(accountId: string): Promise<string> {
  const token = newToken();
  await sql!`insert into cb_password_resets (account_id, token_hash, expires_at)
             values (${accountId}, ${sha(token)}, now() + make_interval(mins => ${RESET_MINUTES}))`;
  return token;
}

/**
 * Look somebody up for a reset. Callers must NOT tell the world whether this found anything —
 * "no account on that email" is a free membership oracle for anyone who wants to know who
 * plays. The route answers identically either way.
 */
export async function findForReset(identifier: string): Promise<{ id: string; username: string; email: string | null } | null> {
  if (!sql) return null;
  const mail = checkEmail(identifier);
  const key = checkUsername(identifier);
  if (!mail && !key) return null;
  const rows = mail
    ? await sql`select id, username, email from cb_accounts where email = ${mail} limit 1`
    : await sql`select id, username, email from cb_accounts where username_key = ${key} limit 1`;
  return rows.length ? (rows[0] as { id: string; username: string; email: string | null }) : null;
}

export async function consumeReset(token: string, newPassword: string): Promise<
  { ok: true; username: string } | { ok: false; why: string }
> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  const pw = checkPassword(newPassword);
  if (!pw) return { ok: false, why: "Passwords need to be at least 8 characters." };

  const rows = await sql`
    select r.id, r.account_id, a.username
    from cb_password_resets r join cb_accounts a on a.id = r.account_id
    where r.token_hash = ${sha(token)} and r.used_at is null and r.expires_at > now() limit 1`;
  if (!rows.length) return { ok: false, why: "That link has expired or already been used." };
  const row = rows[0] as { id: string; account_id: string; username: string };

  const hash = await hashPassword(pw);
  await sql`update cb_accounts set pw_hash = ${hash}, failed_logins = 0, locked_until = null
            where id = ${row.account_id}`;
  await sql`update cb_password_resets set used_at = now() where id = ${row.id}`;
  // burn the rest, and every existing session — a reset should end anybody else's access too
  await sql`update cb_password_resets set used_at = now()
            where account_id = ${row.account_id} and used_at is null`;
  await sql`delete from cb_sessions where account_id = ${row.account_id}`;
  return { ok: true, username: row.username };
}

/** Attach an email to an account that has none, so it stops being unrecoverable. */
export async function setEmail(accountId: string, email: string): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  const mail = checkEmail(email);
  if (!mail) return { ok: false, why: "That email doesn't look right." };
  const dupe = await sql`select 1 from cb_accounts where email = ${mail} and id <> ${accountId} limit 1`;
  if (dupe.length) return { ok: false, why: "There's already an account on that email." };
  await sql`update cb_accounts set email = ${mail} where id = ${accountId}`;
  return { ok: true };
}
