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

/**
 * Chains are a list, not a constant, because a relaunch on Base or Ethereum shouldn't
 * strand the people who already hold. Signatures are EVM-wide and the reads are plain
 * ERC721Enumerable, so adding a chain here is the whole migration: every entry is checked
 * and the holdings merge, tagged by chain. Drop an entry to retire a deployment.
 */
type Chain = { id: string; contract: string; rpcs: string[] };

const CHAINS: Chain[] = [
  {
    id: "polygon",
    contract: "0xc866f81200f84f46e243b1e2bec7e2dd03052aef",
    rpcs: [
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon.llamarpc.com",
      "https://rpc.ankr.com/polygon",
    ],
  },
  // A Base or Ethereum redeploy slots in here — same shape, nothing else changes:
  // { id: "base", contract: "0x…", rpcs: ["https://mainnet.base.org", "https://base.publicnode.com"] },
];

/* ── the nonce a wallet has to sign ─────────────────────────────────
 * In the database rather than in memory, and not as a nicety: this runs on serverless,
 * so the request that issues a nonce and the request that redeems it routinely land on
 * different instances. An in-memory map made linking work only when the two happened to
 * share a warm lambda — which is to say, intermittently, and worse under low traffic.
 *
 * It's also bound to the account that asked for it, so one player can't have a nonce
 * issued and another redeem it. */
const NONCE_MINUTES = 10;

export async function issueNonce(accountId: string, address: string): Promise<string | null> {
  if (!sql || !isAddress(address)) return null;
  const key = getAddress(address).toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  await sql`
    insert into cb_wallet_nonces (address, nonce, account_id, created_at)
    values (${key}, ${nonce}, ${accountId}, now())
    on conflict (address) do update
      set nonce = excluded.nonce, account_id = excluded.account_id, created_at = now()`;
  // opportunistic sweep so spent and abandoned nonces don't accumulate
  await sql`
    delete from cb_wallet_nonces
    where created_at < now() - make_interval(mins => ${NONCE_MINUTES})`;
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
async function ethCall(chain: Chain, data: string): Promise<string | null> {
  for (const rpc of chain.rpcs) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: chain.contract, data }, "latest"],
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

/** Every token id the address holds on one chain. ERC721Enumerable, so exact, not an index. */
async function tokensOnChain(chain: Chain, address: string, cap: number): Promise<number[]> {
  const addr = getAddress(address).slice(2).toLowerCase();
  const balHex = await ethCall(chain, "0x70a08231" + pad(addr));
  if (!balHex) return [];
  const balance = Math.min(parseInt(balHex, 16) || 0, cap);
  const out: number[] = [];
  // tokenOfOwnerByIndex(owner, i) — batched so a big holder doesn't stall the request
  for (let i = 0; i < balance; i += 12) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(12, balance - i) }, (_, k) =>
        ethCall(chain, "0x2f745c59" + pad(addr) + pad((i + k).toString(16))))
    );
    for (const hex of batch) if (hex) out.push(parseInt(hex, 16));
  }
  return out;
}

/**
 * Holdings across every configured chain, merged.
 *
 * Deduped by token id on purpose: bud #16 is bud #16 whichever contract minted it. A
 * relaunch moves the same 4,200 buds to a new chain, so holding it in two places is one
 * bud in the game, not two.
 */
export async function ownedTokens(address: string, cap = 300): Promise<number[]> {
  const per = await Promise.all(CHAINS.map((c) => tokensOnChain(c, address, cap).catch(() => [])));
  return [...new Set(per.flat())].sort((a, b) => a - b);
}

/* ── link / unlink ──────────────────────────────────────────────── */
export type LinkResult =
  | { ok: true; address: string; tokens: number[] }
  | { ok: false; why: string };

export async function linkWallet(accountId: string, address: string, signature: string): Promise<LinkResult> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  if (!isAddress(address)) return { ok: false, why: "That isn't a valid address." };
  const key = getAddress(address).toLowerCase();

  const rows = await sql`
    select nonce from cb_wallet_nonces
    where address = ${key} and account_id = ${accountId}
      and created_at > now() - make_interval(mins => ${NONCE_MINUTES})
    limit 1`;
  const issued = rows[0]?.nonce as string | undefined;
  if (!issued) return { ok: false, why: "That request expired. Try connecting again." };
  if (typeof signature !== "string" || signature.length > 400) {
    return { ok: false, why: "Bad signature." };
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: getAddress(address),
      message: messageFor(address, issued),
      signature: signature as `0x${string}`,
    });
  } catch { valid = false; }
  if (!valid) return { ok: false, why: "That signature doesn't match the address." };

  await sql`delete from cb_wallet_nonces where address = ${key}`;   // single use

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
