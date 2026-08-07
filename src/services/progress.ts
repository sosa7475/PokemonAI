/**
 * PROGRESS — the server's own view of how far somebody actually got.
 *
 * The rest of the solo game lives in a blob the player owns, and that is exactly right up
 * until finishing it is worth something. Until this file existed, `pushProfile` sent a
 * boolean called `finished` and the server wrote it down: anyone who could open devtools was
 * a champion in five seconds. That is fine for a leaderboard nobody's paid to top. It is not
 * fine for anything that costs the house.
 *
 * This does NOT re-simulate a playthrough. Checking somebody's twenty hours server-side is a
 * fantasy and pretending otherwise would be worse than doing nothing. What it does is take
 * away the two things a forger needs:
 *
 *   · A HISTORY THEY DIDN'T LIVE. Milestones are append-only rows stamped with the SERVER's
 *     clock — one per account per milestone, never updated, never deleted. That isn't a
 *     convention: the game's database role is granted SELECT and INSERT on these tables and
 *     nothing else, so the code physically cannot rewrite them. An edited save cannot
 *     produce a row that says last Tuesday.
 *
 *   · THE WORD "FINISHED". There is no milestone for it and no endpoint that accepts it.
 *     Completion is DERIVED here, from the whole required set being present, and written by
 *     this file. The client cannot say it won. It can only say what it did, twenty-seven
 *     separate times, and be timed doing it.
 *
 * Somebody determined can still drive the game with a script and send all twenty-seven. What
 * they can't easily do is make that look like a playthrough — and `shapeOf()` is what looks.
 * Nothing is ever refused or deleted on the strength of it. A suspicious run is recorded,
 * RANKED, and flagged, with its reasons kept beside it. The goal is that a real player's win
 * is provable, not that a stranger's is silently binned; whoever spends a reward reads the
 * flags and makes the call.
 *
 * One honest limitation, stated rather than hidden: anyone who finished the game BEFORE this
 * shipped has no history here, so their whole set lands in one burst the next time they sync
 * and gets flagged `no_history`. There is nothing to backfill from — the record they'd need
 * is the one that never existed. That is a human decision, not a bug to paper over.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;
export const progressReady = Boolean(sql);

/* ── the vocabulary ──────────────────────────────────────────────────
 * Fixed, and the same list the client derives its keys from. Free text here would be a junk
 * drawer within a week and — worse — would let a client invent the milestone that completes
 * the set. Both sides change together; `npm run progress` in the game repo fails if the game
 * grows a leader or an act this list doesn't know about.
 */
const ACTS = 10;
const GYMS = [
  "leader_hollow", "leader_southside", "leader_truce", "leader_sativa",
  "leader_acapulco", "leader_neon", "leader_trichome",
] as const;
const ELITES = 4;      // the Cannabuls, at the League
const CELESTIALS = 4;  // the four names in the house, after the credits

/**
 * Every one of these is required to have finished. Acts 9 and 10 are the two the game doesn't
 * admit to — beating the Kingpin is the FALSE ending, and a reward keyed off it would be paid
 * out to everyone who stopped where the credits told them to and to nobody who went further.
 */
export const MILESTONES: readonly string[] = [
  ...Array.from({ length: ACTS }, (_, i) => `act:${i + 1}`),
  ...GYMS.map((g) => `gym:${g}`),
  ...Array.from({ length: ELITES }, (_, i) => `elite:${i + 1}`),
  ...Array.from({ length: CELESTIALS }, (_, i) => `celest:${i + 1}`),
  "boss:kingpin",
  "boss:shareholder",
];
const KNOWN = new Set(MILESTONES);

/* ── what a played run looks like ────────────────────────────────────
 * Deliberately loose. These are floors a real player clears without noticing and a script
 * trips over, not a model of how long the game takes. Every one of them errs toward letting
 * a slow, odd, or resumed playthrough through unflagged.
 */
const MIN_SPAN_MINUTES = 90;    // server wall-clock, first milestone → last
const MIN_PLAYED_MINUTES = 60;  // what the client claims it played, as a weak second opinion
const BURST_WINDOW_MIN = 5;
const BURST_COUNT = 8;          // 8 of 27 milestones inside five minutes is not a playthrough

interface Row { milestone: string; at: Date }

/**
 * Look at the shape of a run and say what's odd about it. Returns the reasons, and an empty
 * array means nothing looked wrong — this never returns a verdict, only evidence.
 */
export function shapeOf(rows: Row[], claimedMinutes: number): string[] {
  const flags: string[] = [];
  if (rows.length < MILESTONES.length) flags.push("incomplete");
  if (!rows.length) return flags;

  const ms = rows.map((r) => new Date(r.at).getTime()).sort((a, b) => a - b);
  const span = (ms[ms.length - 1] - ms[0]) / 60000;
  if (span < MIN_SPAN_MINUTES) flags.push("too_fast");
  if (claimedMinutes < MIN_PLAYED_MINUTES) flags.push("no_playtime");

  // the whole set arriving at once: somebody who finished before any of this existed, or
  // somebody who wrote the save and then let it sync. Same signature, different stories.
  if (rows.length >= MILESTONES.length && span < BURST_WINDOW_MIN) flags.push("no_history");

  // any BURST_WINDOW_MIN window holding BURST_COUNT of them
  for (let i = 0; i + BURST_COUNT - 1 < ms.length; i++) {
    if (ms[i + BURST_COUNT - 1] - ms[i] <= BURST_WINDOW_MIN * 60000) { flags.push("burst"); break; }
  }

  // acts are a line: you cannot finish act 5 before act 4. A save handed the flags in one go
  // reports them in whatever order the client's loop happened to run.
  const acts = rows
    .filter((r) => r.milestone.startsWith("act:"))
    .map((r) => ({ n: Number(r.milestone.slice(4)), t: new Date(r.at).getTime() }))
    .sort((a, b) => a.t - b.t || a.n - b.n);
  for (let i = 1; i < acts.length; i++) {
    if (acts[i].n < acts[i - 1].n) { flags.push("out_of_order"); break; }
  }

  return [...new Set(flags)];
}

/* ── storage ─────────────────────────────────────────────────────────
 * A deployment whose database hasn't had sql/001_progress.sql run against it should degrade
 * to inert rather than 500 every request — but ONLY for a missing table. Swallowing anything
 * else in the one file that has to be trustworthy would defeat the point of having it.
 */
let tablesMissing = false;
const MISSING = "42P01";
const isMissingTable = (e: unknown) => (e as { code?: string })?.code === MISSING;
const isDuplicate = (e: unknown) => (e as { code?: string })?.code === "23505";

function soft<T>(e: unknown, fallback: T): T {
  if (!isMissingTable(e)) throw e;
  if (!tablesMissing) console.error("[progress] cb_milestones/cb_completions missing — run sql/001_progress.sql");
  tablesMissing = true;
  return fallback;
}

const clampMinutes = (v: unknown) => {
  const n = typeof v === "number" ? Math.round(v) : 0;
  return Number.isFinite(n) ? Math.max(0, Math.min(100000, n)) : 0;
};

export interface Completion {
  finished: true;
  finishedAt: string;
  rank: number;
  plausible: boolean;
  flags: string[];
  minutes: number;
  spanMinutes: number;
}

interface CompRow {
  rank: number; finished_at: string; plausible: boolean;
  flags: string[]; minutes: number; span_minutes: number;
}

const toCompletion = (c: CompRow): Completion => ({
  finished: true,
  finishedAt: new Date(c.finished_at).toISOString(),
  rank: Number(c.rank),
  plausible: c.plausible === true,
  flags: Array.isArray(c.flags) ? c.flags : [],
  minutes: Number(c.minutes),
  spanMinutes: Number(c.span_minutes),
});

async function milestoneRows(accountId: string): Promise<Row[]> {
  return (await sql!`
    select milestone, at from cb_milestones
    where account_id = ${accountId} order by at asc, id asc`) as unknown as Row[];
}

async function completionRow(accountId: string): Promise<CompRow | null> {
  const rows = await sql!`
    select rank, finished_at, plausible, flags, minutes, span_minutes
    from cb_completions where account_id = ${accountId} limit 1`;
  return (rows[0] as CompRow) ?? null;
}

/**
 * Take the next free rank.
 *
 * Read-then-insert races: two people finishing in the same second both read the same max.
 * `rank` is UNIQUE, so the loser's insert raises instead of silently sharing third place, and
 * it simply tries again. Bounded, because a loop that can spin forever on a hot path is a
 * worse bug than the one it's guarding against.
 */
async function claimRank(
  accountId: string, mins: number, count: number, span: number, flags: string[],
): Promise<CompRow | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const [{ next }] = (await sql!`
      select coalesce(max(rank), 0) + 1 as next from cb_completions`) as { next: number }[];
    try {
      const ins = await sql!`
        insert into cb_completions
          (account_id, rank, minutes, milestones, span_minutes, plausible, flags)
        values (${accountId}, ${next}, ${mins}, ${count}, ${span},
                ${flags.length === 0}, ${JSON.stringify(flags)}::jsonb)
        on conflict (account_id) do nothing
        returning rank, finished_at, plausible, flags, minutes, span_minutes`;
      if (ins.length) return ins[0] as CompRow;
      // the account already had one — two of their own requests crossed. Read it back.
      return await completionRow(accountId);
    } catch (e) {
      if (!isDuplicate(e)) throw e;   // somebody else took that rank; go round again
    }
  }
  console.error("[progress] could not claim a rank after 8 attempts", accountId);
  return null;
}

/**
 * Write down what the player says they did, then decide for ourselves whether that adds up to
 * a finished game.
 *
 * Unknown keys are dropped without comment — the same rule telemetry uses, for the same
 * reason, except here it also means a client cannot invent the twenty-fourth milestone that
 * completes the set.
 */
export async function recordMilestones(
  accountId: string, keys: unknown, minutes: unknown,
): Promise<{ recorded: string[]; completion: Completion | null }> {
  if (!sql || tablesMissing) return { recorded: [], completion: null };
  const mins = clampMinutes(minutes);
  const wanted = Array.isArray(keys)
    ? [...new Set(keys.filter((k): k is string => typeof k === "string" && KNOWN.has(k)))]
    : [];

  try {
    let recorded: string[] = [];
    if (wanted.length) {
      const ins = await sql`
        insert into cb_milestones (account_id, milestone, minutes)
        select ${accountId}, x.m, ${mins}
        from jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb) as x(m)
        on conflict (account_id, milestone) do nothing
        returning milestone`;
      recorded = ins.map((r) => String(r.milestone));
    }
    return { recorded, completion: await settle(accountId, mins) };
  } catch (e) { return soft(e, { recorded: [], completion: null }); }
}

/**
 * Is this a finished game? Asked of the rows, not of the caller.
 *
 * A completion is written exactly once and never revised. The shape flags are judged against
 * the history as it stood at the moment the last milestone landed, which is the only moment
 * they mean anything — re-scoring it later, once more rows have accumulated, would turn a
 * flagged run clean just by waiting.
 */
async function settle(accountId: string, mins: number): Promise<Completion | null> {
  const existing = await completionRow(accountId);
  if (existing) return toCompletion(existing);

  const rows = await milestoneRows(accountId);
  const have = new Set(rows.map((r) => r.milestone));
  if (!MILESTONES.every((m) => have.has(m))) return null;

  const ms = rows.map((r) => new Date(r.at).getTime());
  const span = Math.round((Math.max(...ms) - Math.min(...ms)) / 60000);
  const written = await claimRank(accountId, mins, rows.length, span, shapeOf(rows, mins));
  return written ? toCompletion(written) : null;
}

/**
 * THE SINGLE READ-ONLY TRUTH. Whatever ends up rewarding a finished game reads this and
 * nothing else — not the save, not the profile, not a flag on a leaderboard row.
 */
export async function completionOf(accountId: string) {
  const empty = {
    finished: false, finishedAt: null as string | null, rank: null as number | null,
    plausible: null as boolean | null, flags: [] as string[],
    milestones: [] as { key: string; at: string }[],
    required: MILESTONES.length,
  };
  if (!sql || tablesMissing) return empty;
  try {
    const [rows, comp] = await Promise.all([milestoneRows(accountId), completionRow(accountId)]);
    return {
      ...empty,
      finished: Boolean(comp),
      finishedAt: comp ? new Date(comp.finished_at).toISOString() : null,
      rank: comp ? Number(comp.rank) : null,
      plausible: comp ? comp.plausible === true : null,
      flags: comp && Array.isArray(comp.flags) ? comp.flags : [],
      milestones: rows.map((r) => ({ key: r.milestone, at: new Date(r.at).toISOString() })),
    };
  } catch (e) { return soft(e, empty); }
}

/** For the leaderboard, which used to take the client's word for this. */
export async function hasFinished(accountId: string): Promise<boolean> {
  if (!sql || tablesMissing) return false;
  try {
    const rows = await sql`select 1 from cb_completions where account_id = ${accountId} limit 1`;
    return rows.length > 0;
  } catch (e) { return soft(e, false); }
}
