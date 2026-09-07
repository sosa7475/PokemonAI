/**
 * WALLET LINKING — read-only, optional, and deliberately boring.
 *
 * The entire feature is: prove you control an address, and the buds that address actually
 * holds become playable in the game. That's it.
 *
 * What this deliberately does NOT do, and must never do:
 *   · request an approval, allowance, or any transaction
 *   · hold, move, or custody anything
 *   · treat a client-reported address, or a client-reported balance, as proof of anything
 *
 * A wallet is attached to an ACCOUNT, not used as one, because a lost key should cost you a
 * link and not your save.
 *
 * ── why this is stricter than it looks ─────────────────────────────────────────────────
 *
 * The first cut of this signed a plain sentence: a title, the address, a nonce. It verified
 * correctly and it was still wrong, for a reason that only shows up when you write the
 * attack down. That message carried no domain, so it was equally at home on any website in
 * the world, and a wallet shown an unstructured string has nothing to warn you about.
 *
 *   1. Attacker signs up, and asks OUR server for a challenge naming the VICTIM's address.
 *   2. Attacker puts that exact string on a site of their own. Nothing in it says where it
 *      came from or who it is for, so the wallet renders it as an anonymous blob of text —
 *      and the text itself says, reassuringly and truthfully, that signing is read-only.
 *   3. Victim signs. Attacker replays the signature to us and the victim's wallet is now
 *      attached to the attacker's account.
 *
 * Read-only is a real guarantee — nothing there can move a token — which is exactly what
 * makes it a comfortable thing to be phished into. The cost was the identity, not the
 * assets, and identity is the whole product here.
 *
 * So: EIP-4361. The signed payload names the domain, the URI, the chain and an expiry, and
 * every wallet renders that format with the requesting origin shown and checked. The same
 * attack now has to persuade someone to approve a prompt that says, in the wallet's own UI,
 * that `cryptobuds.world` is asking — while standing on a domain that isn't it.
 *
 * The second hole was in the storage rather than the message: challenges were keyed by
 * address alone, `on conflict (address) do update`, so anyone who knew your address could
 * overwrite your pending challenge — rebinding it to their own account, and incidentally
 * making it impossible for you to ever link. They are keyed per account now, and the exact
 * message we issued is stored and compared byte-for-byte on the way back, so nothing about
 * what was signed is inferred from what the client hands us.
 */
import {
  createPublicClient, http, isAddress, getAddress,
  type Address, type Chain, type PublicClient,
} from "viem";
import { base, polygon, mainnet } from "viem/chains";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { neon } from "@neondatabase/serverless";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;

/**
 * Chains are a list, not a constant, because a relaunch on Base or Ethereum shouldn't
 * strand the people who already hold. Signatures are EVM-wide and the reads are plain
 * ERC721Enumerable, so adding a chain here is the whole migration: every entry is checked
 * and the holdings merge. Drop an entry to retire a deployment.
 */
type ChainCfg = {
  id: string;
  chainId: number;
  chain: Chain;
  contract: Address | null;
  rpcs: string[];
};

export const CHAINS: ChainCfg[] = [
  {
    id: "polygon",
    chainId: 137,
    chain: polygon,
    contract: "0xc866f81200f84f46e243b1e2bec7e2dd03052aef",
    rpcs: [
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon.llamarpc.com",
      "https://rpc.ankr.com/polygon",
    ],
  },
  // Base is here before it holds anything on purpose. A signature is chain-independent for
  // an ordinary key, but a SMART-CONTRACT wallet is a contract on one specific chain, and
  // its signature can only be checked by asking that chain. Coinbase Smart Wallet lives on
  // Base and is the largest consumer on-ramp we have; leaving Base out of this list would
  // have rejected every one of those users at the door with "that signature doesn't match"
  // — the most confusing possible way to fail. `contract: null` means: trusted for proving
  // who you are, holds nothing yet.
  {
    id: "base",
    chainId: 8453,
    chain: base,
    contract: null,
    rpcs: ["https://mainnet.base.org", "https://base.publicnode.com"],
  },
  {
    id: "ethereum",
    chainId: 1,
    chain: mainnet,
    contract: null,
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  },
];

const clients = new Map<number, PublicClient>();
function clientFor(chainId: number): PublicClient | null {
  const cfg = CHAINS.find((c) => c.chainId === chainId);
  if (!cfg) return null;
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcs[0]) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

/**
 * Which origins may ask for a signature.
 *
 * An allowlist rather than "whatever the client claims", because the domain inside the
 * signed message is the entire protection and a caller that can choose it freely has
 * removed it. Set WALLET_DOMAINS to override; localhost is only ever included off-prod.
 */
export function allowedDomains(): string[] {
  const env = process.env.WALLET_DOMAINS;
  if (env) return env.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const base = [
    "cryptobuds.world", "www.cryptobuds.world",
    "cryptobuds.io", "www.cryptobuds.io",
  ];
  if (process.env.NODE_ENV !== "production") base.push("localhost:5173", "localhost:4173", "127.0.0.1:5173");
  return base;
}

const CHALLENGE_MINUTES = 10;

const STATEMENT =
  "Link this wallet to your CryptoBuds account. This proves you control the address so the " +
  "buds it holds become playable. It is read-only: it cannot move, approve or spend anything.";

/* ── the challenge ──────────────────────────────────────────────────
 * In the database rather than in memory, and not as a nicety: this runs on serverless, so
 * the request that issues a challenge and the request that redeems it routinely land on
 * different instances. An in-memory map made linking work only when the two happened to
 * share a warm lambda — intermittently, and worst under low traffic.
 *
 * The whole message is stored, not just the nonce, so redemption compares what was signed
 * against what we issued rather than re-deriving it from client input. */
export type Challenge = { ok: true; nonce: string; message: string } | { ok: false; why: string };

/**
 * Everything about a challenge except storing it.
 *
 * Split out so the rules can be tested without a database behind them. Argument validation
 * that only runs when infrastructure is configured is validation you cannot prove, and this
 * is the half where the security lives.
 */
export function buildChallenge(
  address: string, domain: string, uri: string, chainId: number, now = new Date(),
): Challenge & { domain?: string; nonce?: string } {
  if (!isAddress(address)) return { ok: false, why: "That isn't a valid address." };

  const dom = String(domain || "").trim().toLowerCase();
  if (!allowedDomains().includes(dom)) return { ok: false, why: "This site can't request a signature." };

  // The URI has to belong to the domain it claims, or the allowlist is decorative.
  let parsed: URL;
  try { parsed = new URL(uri); } catch { return { ok: false, why: "Bad request." }; }
  if (parsed.host.toLowerCase() !== dom) return { ok: false, why: "Bad request." };
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { ok: false, why: "Bad request." };
  }

  if (!CHAINS.some((c) => c.chainId === chainId)) return { ok: false, why: "That network isn't supported." };

  const nonce = generateSiweNonce();
  const message = createSiweMessage({
    address: getAddress(address),
    chainId,
    domain: dom,
    nonce,
    uri: parsed.toString(),
    version: "1",
    statement: STATEMENT,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + CHALLENGE_MINUTES * 60_000),
  });
  return { ok: true, nonce, message, domain: dom };
}

export async function issueChallenge(
  accountId: string, address: string, domain: string, uri: string, chainId: number,
): Promise<Challenge> {
  const built = buildChallenge(address, domain, uri, chainId);
  if (!built.ok) return built;
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };

  const key = getAddress(address).toLowerCase();
  // Keyed per ACCOUNT+address. Keyed on address alone, anyone who knew your address could
  // overwrite your pending challenge and rebind it to themselves.
  await sql`
    insert into cb_wallet_challenges (account_id, address, nonce, message, domain, chain_id, created_at)
    values (${accountId}, ${key}, ${built.nonce!}, ${built.message}, ${built.domain!}, ${chainId}, now())
    on conflict (account_id, address) do update
      set nonce = excluded.nonce, message = excluded.message, domain = excluded.domain,
          chain_id = excluded.chain_id, created_at = now()`;
  await sql`
    delete from cb_wallet_challenges
    where created_at < now() - make_interval(mins => ${CHALLENGE_MINUTES})`;

  return { ok: true, nonce: built.nonce!, message: built.message };
}

/**
 * Is this signature good for this exact message, from this exact address?
 *
 * Separated from the storage so it can be tested against real keys and real tampering. An
 * ordinary key needs no network — the address recovers from the signature. A smart-contract
 * wallet is a contract, and only the chain it lives on can be asked whether it considers a
 * signature its own (EIP-1271), including when it hasn't been deployed yet (ERC-6492). viem
 * covers all three behind one call given a client.
 */
export async function checkSignature(
  message: string, signature: string, address: string, domain: string, nonce: string, chainId: number,
): Promise<boolean> {
  const client = clientFor(chainId);
  if (!client) return false;
  try {
    return await client.verifySiweMessage({
      message,
      signature: signature as `0x${string}`,
      address: getAddress(address),
      domain,
      nonce,
    });
  } catch { return false; }
}

/* ── chain reads ─────────────────────────────────────────────────── */
async function ethCall(cfg: ChainCfg, data: string): Promise<string | null> {
  if (!cfg.contract) return null;
  for (const rpc of cfg.rpcs) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: cfg.contract, data }, "latest"],
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
async function tokensOnChain(cfg: ChainCfg, address: string, cap: number): Promise<number[]> {
  if (!cfg.contract) return [];
  const addr = getAddress(address).slice(2).toLowerCase();
  const balHex = await ethCall(cfg, "0x70a08231" + pad(addr));
  if (!balHex) return [];
  const balance = Math.min(parseInt(balHex, 16) || 0, cap);
  const out: number[] = [];
  for (let i = 0; i < balance; i += 12) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(12, balance - i) }, (_, k) =>
        ethCall(cfg, "0x2f745c59" + pad(addr) + pad((i + k).toString(16))))
    );
    for (const hex of batch) if (hex) out.push(parseInt(hex, 16));
  }
  return out;
}

/**
 * Holdings across every configured chain, merged.
 *
 * Deduped by token id on purpose: bud #16 is bud #16 whichever contract minted it. A
 * relaunch moves the same buds to a new chain, so holding it in two places is one bud in
 * the game, not two.
 *
 * Read from the chain, every time, and never from anything the client said. The cached copy
 * on the account is for DRAWING a wallet page quickly; anything that grants something must
 * call this and use what it returns. See `ownedTokensNow`.
 */
export async function ownedTokens(address: string, cap = 300): Promise<number[]> {
  const per = await Promise.all(CHAINS.map((c) => tokensOnChain(c, address, cap).catch(() => [])));
  return [...new Set(per.flat())].sort((a, b) => a - b);
}

/**
 * The same read, named so it's obvious at the call site that it hits the chain.
 *
 * Anything that MINTS, grants or spends calls this. `wallet_tokens` on the account is a
 * cache with a timestamp, and a cache is a statement about the past: between the link and
 * the claim, a wallet can sell everything it had. Granting on a cached balance is how you
 * let one bud be claimed by a chain of buyers.
 */
export async function ownedTokensNow(address: string): Promise<number[]> {
  return ownedTokens(address);
}

/* ── link / unlink ──────────────────────────────────────────────── */
export type LinkResult =
  | { ok: true; address: string; tokens: number[] }
  | { ok: false; why: string };

async function note(accountId: string, address: string | null, event: string, detail?: string, ip?: string) {
  if (!sql) return;
  try {
    await sql`
      insert into cb_wallet_events (account_id, address, event, detail, ip)
      values (${accountId}, ${address}, ${event}, ${detail ?? null}, ${ip ?? null})`;
  } catch { /* the log is evidence, never a gate — a failed write must not fail a link */ }
}

export async function linkWallet(
  accountId: string, address: string, message: string, signature: string, ip?: string,
): Promise<LinkResult> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  if (!isAddress(address)) return { ok: false, why: "That isn't a valid address." };
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 6000) {
    // Long, because an ERC-6492 wrapper for a wallet that isn't deployed yet carries its own
    // deploy calldata. Still bounded, and still hex-only.
    return { ok: false, why: "Bad signature." };
  }
  const key = getAddress(address).toLowerCase();

  const rows = await sql`
    select nonce, message, domain, chain_id from cb_wallet_challenges
    where account_id = ${accountId} and address = ${key}
      and created_at > now() - make_interval(mins => ${CHALLENGE_MINUTES})
    limit 1`;
  const row = rows[0] as { nonce: string; message: string; domain: string; chain_id: number } | undefined;
  if (!row) return { ok: false, why: "That request expired. Try connecting again." };

  // Byte-for-byte against what we issued. Nothing about what was signed is inferred from
  // what the client sent, so there is no gap between our parser and the wallet's.
  if (typeof message !== "string" || message !== row.message) {
    await note(accountId, key, "refused", "message did not match the issued challenge", ip);
    return { ok: false, why: "That signature doesn't match what we asked you to sign." };
  }

  // Refuse before spending the challenge, so a collision costs a click and not a round trip.
  const taken = await sql`
    select id from cb_accounts where wallet = ${key} and id <> ${accountId} limit 1`;
  if (taken.length) return { ok: false, why: "That wallet is already linked to another account." };

  // Verified against the chain named in the message — see checkSignature.
  const valid = await checkSignature(
    message, signature, address, row.domain, row.nonce, row.chain_id);

  if (!valid) {
    await note(accountId, key, "refused", "signature did not verify", ip);
    return { ok: false, why: "That signature doesn't match the address." };
  }

  await sql`delete from cb_wallet_challenges where account_id = ${accountId} and address = ${key}`;

  const tokens = await ownedTokensNow(key);
  await sql`
    update cb_accounts
    set wallet = ${key}, wallet_tokens = ${JSON.stringify(tokens)}, wallet_checked = now()
    where id = ${accountId}`;
  await note(accountId, key, "linked", `${tokens.length} bud(s)`, ip);
  return { ok: true, address: getAddress(address), tokens };
}

export async function unlinkWallet(accountId: string, ip?: string): Promise<void> {
  if (!sql) return;
  const rows = await sql`select wallet from cb_accounts where id = ${accountId} limit 1`;
  const had = (rows[0]?.wallet as string | null) ?? null;
  await sql`update cb_accounts set wallet = null, wallet_tokens = null, wallet_checked = null where id = ${accountId}`;
  await sql`delete from cb_wallet_challenges where account_id = ${accountId}`;
  if (had) await note(accountId, had, "unlinked", undefined, ip);
}

/** Re-read holdings from chain — they change when somebody buys or sells. */
export async function refreshWallet(accountId: string): Promise<LinkResult> {
  if (!sql) return { ok: false, why: "Accounts aren't set up on this server." };
  const rows = await sql`select wallet from cb_accounts where id = ${accountId} limit 1`;
  const addr = rows[0]?.wallet as string | null;
  if (!addr) return { ok: false, why: "No wallet linked." };
  const tokens = await ownedTokensNow(addr);
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

/** Exposed for the test suite — the message a challenge would produce, minus the storage. */
export const _internals = { STATEMENT, CHALLENGE_MINUTES, parseSiweMessage };
