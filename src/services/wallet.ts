/**
 * WALLET LINKING — read-only, and optional.
 *
 * The entire feature is: prove you control an address, and the buds that address actually
 * holds become playable in the game. That's it.
 *
 * What this deliberately does NOT do, and must never do:
 *   · request an approval, allowance, or any transaction
 *   · hold, move, or custody anything
 *   · treat a client-reported address as proof of anything
 *
 * The signature is the only thing that makes a claimed address real, and holdings are read
 * from the chain server-side — never taken from the client. A wallet is attached to an
 * ACCOUNT, not used as one, because a lost key should cost you a link and not your save.
 */
import { verifyMessage, isAddress, getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;

const CONTRACT = "0xc866f81200f84f46e243b1e2bec7e2dd03052aef";
const RPCS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.llamarpc.com",
  "https://rpc.ankr.com/polygon",
];

/* ── the nonce a wallet has to sign ─────────────────────────────── */
const nonces = new Map<string, { nonce: string; at: number }>();
const NONCE_TTL = 10 * 60 * 1000;

export function issueNonce(address: string): string | null {
  if (!isAddress(address)) return null;
  const nonce = randomBytes(16).toString("hex");
  nonces.set(getAddress(address).toLowerCase(), { nonce, at: Date.now() });
  // opportunistic sweep so the map can't grow forever
  const cutoff = Date.now() - NONCE_TTL;
  for (const [k, v] of nonces) if (v.at < cutoff) nonces.delete(k);
  return nonce;
}

export function messageFor(address: string, nonce: string): string {
  return [
    "CryptoBuds — link this wallet",
    "",
    "Signing proves you control this address so the buds it holds become playable.",
    "This is read-only. It cannot move anything, approve anything, or spend anything.",
    "",
    `Address: ${getAddress(address)}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

/* ── chain reads ────────────────────────────────────────────────── */
async function ethCall(data: string): Promise<string | null> {
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: CONTRACT, data }, "latest"],
        }),
        signal: AbortSignal.timeout(9000),
      });
      const j = (await r.json()) as { result?: string };
      if (j.result && j.result !== "0x") return j.result;
    } catch { /* try the next endpoint */ }
  }
  return null;
}

const pad = (n: string) => n.replace(/^0x/, "").padStart(64, "0");

/** Every token id the address holds. ERC721Enumerable, so this is exact, not an index. */
export async function ownedTokens(address: string, cap = 300): Promise<number[]> {
  const addr = getAddress(address).slice(2).toLowerCase();
  const balHex = await ethCall("0x70a08231" + pad(addr));
  if (!balHex) return [];
  const balance = Math.min(parseInt(balHex, 16) || 0, cap);
  const out: number[] = [];
  // tokenOfOwnerByIndex(owner, i) — batched so a big holder doesn't stall the request
  for (let i = 0; i < balance; i += 12) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(12, balance - i) }, (_, k) =>
        ethCall("0x2f745c59" + pad(addr) + pad((i + k).toString(16))))
    );
    for (const hex of batch) if (hex) out.push(parseInt(hex, 16));
  }
  return out;
}

/* ── link / unlink ──────────────────────────────────────────────── */
export type LinkResult =
  | { ok: true; address: string; tokens: number[] }
  | { ok: false; why: string };

export async function linkWallet(accountId: string, address: string, signature: string): Promise<LinkResult> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  if (!isAddress(address)) return { ok: false, why: "That isn't a valid address." };
  const key = getAddress(address).toLowerCase();

  const rec = nonces.get(key);
  if (!rec || Date.now() - rec.at > NONCE_TTL) {
    return { ok: false, why: "That request expired. Try connecting again." };
  }
  if (typeof signature !== "string" || signature.length > 400) {
    return { ok: false, why: "Bad signature." };
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: getAddress(address),
      message: messageFor(address, rec.nonce),
      signature: signature as `0x${string}`,
    });
  } catch { valid = false; }
  if (!valid) return { ok: false, why: "That signature doesn't match the address." };

  nonces.delete(key);   // single use

  // one wallet, one account — otherwise two players could claim the same buds
  const taken = await sql`
    select id from cb_accounts where wallet = ${key} and id <> ${accountId} limit 1`;
  if (taken.length) return { ok: false, why: "That wallet is already linked to another account." };

  const tokens = await ownedTokens(key);
  await sql`
    update cb_accounts
    set wallet = ${key}, wallet_tokens = ${JSON.stringify(tokens)}, wallet_checked = now()
    where id = ${accountId}`;
  return { ok: true, address: getAddress(address), tokens };
}

export async function unlinkWallet(accountId: string): Promise<void> {
  if (!sql) return;
  await sql`update cb_accounts set wallet = null, wallet_tokens = null, wallet_checked = null where id = ${accountId}`;
}

/** Re-read holdings from chain — they change when somebody buys or sells. */
export async function refreshWallet(accountId: string): Promise<LinkResult> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  const rows = await sql`select wallet from cb_accounts where id = ${accountId} limit 1`;
  const addr = rows[0]?.wallet as string | null;
  if (!addr) return { ok: false, why: "No wallet linked." };
  const tokens = await ownedTokens(addr);
  await sql`
    update cb_accounts set wallet_tokens = ${JSON.stringify(tokens)}, wallet_checked = now()
    where id = ${accountId}`;
  return { ok: true, address: getAddress(addr), tokens };
}

export async function walletOf(accountId: string): Promise<{ address: string | null; tokens: number[] }> {
  if (!sql) return { address: null, tokens: [] };
  const rows = await sql`select wallet, wallet_tokens from cb_accounts where id = ${accountId} limit 1`;
  const w = rows[0];
  if (!w?.wallet) return { address: null, tokens: [] };
  let tokens: number[] = [];
  try { tokens = JSON.parse((w.wallet_tokens as string) ?? "[]"); } catch { tokens = []; }
  return { address: getAddress(w.wallet as string), tokens };
}
