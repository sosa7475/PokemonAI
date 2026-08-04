/**
 * TELEMETRY AND FEEDBACK.
 *
 * The question this exists to answer is "did people keep playing, and where did they stop"
 * — nothing more. So it stores a stable per-browser id, an optional account id, an event
 * name and a small bag of numbers. It does not store IP addresses, user agents, referrers,
 * or anything a player typed except the feedback they deliberately wrote and sent.
 *
 * Event names are checked against a fixed list rather than accepted as free text. An
 * open name field turns into a junk drawer within a week, and it also means anyone can
 * write arbitrary strings into the table you read every morning.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;
export const telemetryReady = Boolean(sql);

/** The events worth having. Anything not on this list is dropped without comment. */
export const EVENTS = new Set([
  "boot",            // the game opened
  "new_game",        // started a fresh save
  "named",           // finished the cold open and named the player
  "starter",         // picked a starter
  "battle_win",
  "battle_lose",
  "caught",
  "gym_win",         // props: { gym }
  "act_done",        // props: { act }  — the retention funnel
  "quest_done",      // props: { quest }
  "tool_found",      // props: { tool }
  "dungeon_clear",   // props: { dungeon }
  "legendary_seen",  // props: { dex }
  "legendary_caught",
  "blackout",
  "stuck_escape",    // they pressed the "I'm stuck" button — a bug signal
  "account_made",
  "wallet_linked",
  "heartbeat",       // every 60s of play; props: { minutes } — session length
  "finished",        // beat the Kingpin
]);

const MAX_BATCH = 20;

/** Props are numbers and short strings only — never nested, never large. */
function cleanProps(v: unknown): Record<string, string | number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string | number> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n++ >= 8 || k.length > 32) continue;
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
    else if (typeof val === "string") out[k] = val.slice(0, 60);
  }
  return Object.keys(out).length ? out : null;
}

export interface InEvent { name?: unknown; props?: unknown }

export async function recordEvents(
  anonId: string, accountId: string | null, events: InEvent[],
): Promise<number> {
  if (!sql || !Array.isArray(events)) return 0;
  const rows = events.slice(0, MAX_BATCH)
    .map((e) => ({ name: typeof e.name === "string" ? e.name : "", props: cleanProps(e.props) }))
    .filter((e) => EVENTS.has(e.name));
  if (!rows.length) return 0;

  // One statement, not one per event — a batch of twenty shouldn't be twenty round trips.
  await sql`
    insert into cb_events (anon_id, account_id, name, props)
    select ${anonId}, ${accountId}, x.name, x.props::jsonb
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(name text, props jsonb)`;
  return rows.length;
}

export async function recordFeedback(
  anonId: string, accountId: string | null,
  kind: string, message: string, context: unknown,
): Promise<void> {
  if (!sql) return;
  const k = kind === "bug" ? "bug" : "idea";
  await sql`
    insert into cb_feedback (anon_id, account_id, kind, message, context)
    values (${anonId}, ${accountId}, ${k}, ${message.slice(0, 2000)},
            ${JSON.stringify(cleanProps(context) ?? {})}::jsonb)`;
}

/* ── the numbers worth looking at ────────────────────────────────── */

export interface Stats {
  players: { total: number; accounts: number; today: number; week: number };
  retention: { d1: number; d7: number; cohort: number };
  sessions: { median_minutes: number; over_10_min: number; over_30_min: number };
  funnel: { step: string; players: number }[];
  daily: { day: string; players: number; signups: number }[];
  signals: { name: string; n: number }[];
  feedback: { id: number; kind: string; message: string; at: string; status: string; who: string | null }[];
}

export async function stats(): Promise<Stats | null> {
  if (!sql) return null;

  const [players] = await sql`
    select
      count(distinct anon_id)                                             as total,
      count(distinct account_id)                                          as accounts,
      count(distinct anon_id) filter (where at > now() - interval '1 day')  as today,
      count(distinct anon_id) filter (where at > now() - interval '7 days') as week
    from cb_events` as { total: number; accounts: number; today: number; week: number }[];

  /* Retention the honest way: of the people whose FIRST day was at least N days ago, how
     many came back on a later day. Anyone too new to have had the chance is excluded from
     the denominator — otherwise yesterday's signups drag D7 toward zero forever. */
  const [ret] = await sql`
    with first_seen as (
      select anon_id, min(at) as first_at, max(at) as last_at from cb_events group by anon_id
    )
    select
      count(*) filter (where first_at < now() - interval '1 day')                                as cohort,
      count(*) filter (where first_at < now() - interval '1 day'  and last_at > first_at + interval '1 day')  as d1,
      count(*) filter (where first_at < now() - interval '7 days' and last_at > first_at + interval '7 days') as d7
    from first_seen` as { cohort: number; d1: number; d7: number }[];

  // Session length comes off the heartbeat: the highest minute count a player ever reached.
  const [sess] = await sql`
    with best as (
      select anon_id, max((props->>'minutes')::int) as mins
      from cb_events where name = 'heartbeat' and props ? 'minutes' group by anon_id
    )
    select
      coalesce(percentile_cont(0.5) within group (order by mins), 0)::int as median_minutes,
      count(*) filter (where mins >= 10) as over_10_min,
      count(*) filter (where mins >= 30) as over_30_min
    from best` as { median_minutes: number; over_10_min: number; over_30_min: number }[];

  const funnelRows = await sql`
    select name, props->>'act' as act, count(distinct anon_id)::int as players
    from cb_events
    where name in ('boot','new_game','named','starter','gym_win','act_done','finished')
    group by 1, 2`;
  const at = (n: string, a?: string) =>
    funnelRows.find((r) => r.name === n && (a === undefined || r.act === a))?.players ?? 0;
  const funnel = [
    { step: "opened the game", players: at("boot") },
    { step: "started a game", players: at("new_game") },
    { step: "named their player", players: at("named") },
    { step: "picked a starter", players: at("starter") },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((a) => ({
      step: `finished act ${a}`,
      players: at("act_done", String(a)),
    })),
    { step: "beat the Kingpin", players: at("finished") },
  ];

  const daily = await sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
           count(distinct e.anon_id)::int as players,
           count(distinct e.anon_id) filter (where e.name = 'account_made')::int as signups
    from generate_series(current_date - interval '13 days', current_date, interval '1 day') as d(day)
    left join cb_events e on e.at >= d.day and e.at < d.day + interval '1 day'
    group by d.day order by d.day`;

  const signals = await sql`
    select name, count(*)::int as n from cb_events
    where name in ('blackout','stuck_escape','battle_lose','wallet_linked','legendary_caught')
    group by name order by n desc`;

  const feedback = await sql`
    select f.id, f.kind, f.message, f.status, to_char(f.at, 'Mon DD HH24:MI') as at, a.username as who
    from cb_feedback f left join cb_accounts a on a.id = f.account_id
    order by f.at desc limit 60`;

  return {
    players, retention: ret, sessions: sess, funnel,
    daily: daily as Stats["daily"],
    signals: signals as Stats["signals"],
    feedback: feedback as Stats["feedback"],
  };
}

export async function setFeedbackStatus(id: number, status: string): Promise<void> {
  if (!sql) return;
  const s = ["new", "done", "wontfix"].includes(status) ? status : "new";
  await sql`update cb_feedback set status = ${s} where id = ${id}`;
}
