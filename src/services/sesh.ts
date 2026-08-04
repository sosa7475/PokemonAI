/**
 * THE SESH — the only part of the game that isn't yours alone.
 *
 * Everything a player does by themselves lives in their own save, client-side, and that's
 * fine: cheating at solitaire only costs the cheat. The moment a bud can move between two
 * players, that stops being true. An edited save would mint a perfect legendary, hand it to
 * a friend, and the whole breeding economy would be worthless inside a week — and it's the
 * breeding economy that's supposed to give trading a reason to exist.
 *
 * So the boundary is drawn here, deliberately, and it is the only boundary:
 *
 *     Your own game is yours. Anything that touches another player belongs to the server.
 *
 * A bud has to be CHECKED IN to the Sesh before it can be traded or fought with. Check-in
 * copies it to a row the client cannot write to afterwards, and from that point the server's
 * copy is the real one. Battles are simulated here, from those rows, so neither side can
 * report their own result. Trades swap rows, so a bud can never be in two places.
 *
 * This does not make the solo game cheat-proof and isn't trying to. It makes the shared
 * economy cheat-proof, which is the part where somebody else gets hurt.
 */
import { neon } from "@neondatabase/serverless";
import { simulate, type SeshBud } from "./battlesim";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;
export const seshReady = Boolean(sql);

const MAX_CHECKED_IN = 12;

export interface InBud {
  uid?: unknown; edition?: unknown; nickname?: unknown; level?: unknown;
  grade?: unknown; lineage?: unknown; moves?: unknown; stats?: unknown; maxHp?: unknown;
}

const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/**
 * Check a bud in. The values are clamped on the way through — a client that claims level
 * 9,999 gets level 100, and one that claims grade 500 gets 100. This isn't the security
 * boundary (a determined cheat can still check in a legitimately-shaped lie), it's the
 * sanity boundary that stops one bad row poisoning every battle it ever appears in.
 */
export async function checkIn(accountId: string, bud: InBud): Promise<{ ok: true } | { ok: false; why: string }> {
  if (!sql) return { ok: false, why: "The Sesh isn't running on this server." };
  const uid = typeof bud.uid === "string" ? bud.uid.slice(0, 40) : "";
  if (!uid) return { ok: false, why: "That bud has no id." };

  const counts = (await sql`
    select count(*)::int as n from cb_sesh_buds where account_id = ${accountId}`) as { n: number }[];
  const n = counts[0]?.n ?? 0;
  const exists = await sql`
    select 1 from cb_sesh_buds where account_id = ${accountId} and uid = ${uid} limit 1`;
  if (!exists.length && n >= MAX_CHECKED_IN) {
    return { ok: false, why: `You can only have ${MAX_CHECKED_IN} buds in the Sesh at once.` };
  }

  const lineage = Array.isArray(bud.lineage) ? bud.lineage.filter((s) => typeof s === "string").slice(0, 6) : [];
  const moves = Array.isArray(bud.moves) ? bud.moves.slice(0, 4) : [];
  const stats = bud.stats && typeof bud.stats === "object" ? bud.stats : {};

  await sql`
    insert into cb_sesh_buds (account_id, uid, edition, nickname, level, grade, lineage, moves, stats, max_hp)
    values (${accountId}, ${uid}, ${int(bud.edition, 1, 4200, 1)},
            ${typeof bud.nickname === "string" ? bud.nickname.slice(0, 24) : null},
            ${int(bud.level, 1, 100, 5)}, ${int(bud.grade, 1, 100, 20)},
            ${JSON.stringify(lineage)}, ${JSON.stringify(moves)}, ${JSON.stringify(stats)},
            ${int(bud.maxHp, 1, 9999, 20)})
    on conflict (account_id, uid) do update set
      level = excluded.level, grade = excluded.grade, moves = excluded.moves,
      stats = excluded.stats, max_hp = excluded.max_hp, nickname = excluded.nickname`;
  return { ok: true };
}

export async function checkOut(accountId: string, uid: string): Promise<void> {
  if (!sql) return;
  await sql`delete from cb_sesh_buds where account_id = ${accountId} and uid = ${uid} and listed = false`;
}

export async function myBuds(accountId: string) {
  if (!sql) return [];
  return sql`
    select uid, edition, nickname, level, grade, listed, want, lineage
    from cb_sesh_buds where account_id = ${accountId} order by grade desc`;
}

/* ── trading ────────────────────────────────────────────────────── */

export async function list(accountId: string, uid: string, want: string | null) {
  if (!sql) return { ok: false as const, why: "The Sesh isn't running." };
  const r = await sql`
    update cb_sesh_buds set listed = true, want = ${want ? want.slice(0, 60) : null}
    where account_id = ${accountId} and uid = ${uid} returning id`;
  return r.length ? { ok: true as const } : { ok: false as const, why: "That bud isn't in your Sesh." };
}

export async function unlist(accountId: string, uid: string) {
  if (!sql) return;
  await sql`update cb_sesh_buds set listed = false, want = null where account_id = ${accountId} and uid = ${uid}`;
}

export async function board(viewerId: string) {
  if (!sql) return [];
  return sql`
    select b.id, b.uid, b.edition, b.nickname, b.level, b.grade, b.want, b.lineage, a.username as owner
    from cb_sesh_buds b join cb_accounts a on a.id = b.account_id
    where b.listed = true and b.account_id <> ${viewerId}
    order by b.created_at desc limit 60`;
}

/**
 * A swap.
 *
 * The offer is claimed by flipping `listed` as part of the WHERE clause, not by checking it
 * first and updating after. Two players hitting accept in the same second both pass a
 * check-then-update; only one of them gets a row back from an update that filters on the
 * flag it's clearing. The loser is told the trade is gone, which is true, instead of both
 * of them receiving the same bud — the kind of duplication that ruins an economy quietly.
 */
export async function swap(
  takerId: string, offerId: number, giveUid: string,
): Promise<{ ok: true; got: string } | { ok: false; why: string }> {
  if (!sql) return { ok: false, why: "The Sesh isn't running." };

  const rows = (await sql`
    select id, account_id, uid, edition from cb_sesh_buds
    where id = ${offerId} and listed = true limit 1`) as { id: number; account_id: string; uid: string; edition: number }[];
  const offer = rows[0];
  if (!offer) return { ok: false, why: "That trade is gone." };
  if (offer.account_id === takerId) return { ok: false, why: "That's your own bud." };

  const mine = (await sql`
    select uid, edition from cb_sesh_buds
    where account_id = ${takerId} and uid = ${giveUid} and listed = false limit 1`) as { uid: string; edition: number }[];
  if (!mine.length) return { ok: false, why: "Check that bud into the Sesh first." };

  // Claim the offer by flipping `listed` as part of the WHERE — whoever's update returns a
  // row won the race, and the loser gets "that trade is gone" instead of a duplicate bud.
  const claimed = await sql`
    update cb_sesh_buds set account_id = ${takerId}, listed = false, want = null
    where id = ${offerId} and listed = true returning id`;
  if (!claimed.length) return { ok: false, why: "Somebody just took that one." };

  await sql`
    update cb_sesh_buds set account_id = ${offer.account_id}
    where account_id = ${takerId} and uid = ${giveUid}`;

  return { ok: true, got: String(offer.edition) };
}

/* ── battles ────────────────────────────────────────────────────── */

export async function opponents(viewerId: string) {
  if (!sql) return [];
  return sql`
    select a.id, a.username,
           count(b.id)::int as team,
           coalesce(max(b.grade), 0)::int as best,
           coalesce(max(b.level), 0)::int as top
    from cb_accounts a join cb_sesh_buds b on b.account_id = a.id
    where a.id <> ${viewerId}
    group by a.id, a.username
    having count(b.id) >= 1
    order by random() limit 12`;
}

const toBud = (r: Record<string, unknown>): SeshBud => ({
  uid: String(r.uid),
  edition: Number(r.edition),
  name: (r.nickname as string) || `#${r.edition}`,
  level: Number(r.level),
  grade: Number(r.grade),
  maxHp: Number(r.max_hp),
  stats: JSON.parse((r.stats as string) || "{}"),
  moves: JSON.parse((r.moves as string) || "[]"),
});

/**
 * Fought here, not on either client, and the result is written before it's returned. The
 * attacker's client learns who won at the same moment the database does.
 */
export async function fight(attackerId: string, defenderId: string) {
  if (!sql) return { ok: false as const, why: "The Sesh isn't running." };
  if (attackerId === defenderId) return { ok: false as const, why: "You can't fight yourself." };

  const [mine, theirs] = await Promise.all([
    sql`select * from cb_sesh_buds where account_id = ${attackerId} order by grade desc limit 3`,
    sql`select * from cb_sesh_buds where account_id = ${defenderId} order by grade desc limit 3`,
  ]);
  if (!mine.length) return { ok: false as const, why: "Check a bud into the Sesh first." };
  if (!theirs.length) return { ok: false as const, why: "They've got nothing in the Sesh." };

  const out = simulate(mine.map(toBud), theirs.map(toBud));
  const winner = out.attackerWon ? attackerId : defenderId;
  await sql`
    insert into cb_sesh_battles (attacker, defender, winner, log)
    values (${attackerId}, ${defenderId}, ${winner}, ${JSON.stringify(out.log.slice(0, 60))})`;
  return { ok: true as const, won: out.attackerWon, log: out.log };
}

export async function record(accountId: string) {
  if (!sql) return { wins: 0, losses: 0 };
  const rows = (await sql`
    select
      (count(*) filter (where winner = ${accountId}))::int as wins,
      (count(*) filter (where winner is not null and winner <> ${accountId}))::int as losses
    from cb_sesh_battles where attacker = ${accountId} or defender = ${accountId}`) as { wins: number; losses: number }[];
  return rows[0] ?? { wins: 0, losses: 0 };
}
