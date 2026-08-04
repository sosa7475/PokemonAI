/**
 * PROFILES AND THE LEADERBOARD.
 *
 * A profile is a summary the client pushes when it syncs. It is NOT trusted for anything
 * that costs another player something — it exists so people can see each other, and the
 * worst a liar achieves is a wrong name at the top of a board.
 *
 * That's a deliberate line. Verifying a solo save server-side would mean re-simulating
 * somebody's entire twenty hours, which is a lot of machinery to stop a stranger from
 * pretending they finished the game. The things that ARE worth cheating for — trading and
 * battling — live in the Sesh, where the server holds the buds.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.ACCOUNTS_DATABASE_URL || process.env.DATABASE_URL;
const sql = url ? neon(url) : null;

const int = (v: unknown, hi: number) => {
  const n = typeof v === "number" ? Math.round(v) : 0;
  return Number.isFinite(n) ? Math.max(0, Math.min(hi, n)) : 0;
};

export interface InProfile {
  props?: unknown; legends?: unknown; dex?: unknown;
  bestGrade?: unknown; smoke?: unknown; minutes?: unknown; finished?: unknown;
}

export async function putProfile(accountId: string, p: InProfile): Promise<void> {
  if (!sql) return;
  await sql`
    insert into cb_profiles (account_id, props, legends, dex, best_grade, smoke, minutes, finished, updated_at)
    values (${accountId}, ${int(p.props, 8)}, ${int(p.legends, 8)}, ${int(p.dex, 383)},
            ${int(p.bestGrade, 100)}, ${int(p.smoke, 1e12)}, ${int(p.minutes, 100000)},
            ${p.finished === true}, now())
    on conflict (account_id) do update set
      props = excluded.props, legends = excluded.legends, dex = excluded.dex,
      best_grade = excluded.best_grade, smoke = excluded.smoke,
      minutes = excluded.minutes, finished = excluded.finished, updated_at = now()`;
}

export type Board = "props" | "legends" | "dex" | "grade" | "smoke" | "wins";

/**
 * One board at a time rather than everything at once — five short lists people actually read
 * beats one giant table nobody does, and each one rewards a different way of playing.
 *
 * The ORDER BY is written out per board instead of being interpolated. It's more lines, but
 * a sort key is the one place a "just this once" string concatenation turns a leaderboard
 * into an injection point, and there is no parameterised form of ORDER BY to fall back on.
 */
export async function leaderboard(board: Board = "props", limit = 25) {
  if (!sql) return [];
  const n = Math.min(50, Math.max(1, limit));
  switch (board) {
    case "legends":
      return sql`select a.username, p.props, p.legends, p.dex, p.best_grade, p.smoke, p.minutes, p.finished,
        coalesce((select count(*) from cb_sesh_battles b where b.winner = p.account_id), 0)::int as wins
        from cb_profiles p join cb_accounts a on a.id = p.account_id where p.minutes > 0
        order by p.legends desc, p.minutes asc limit ${n}`;
    case "dex":
      return sql`select a.username, p.props, p.legends, p.dex, p.best_grade, p.smoke, p.minutes, p.finished,
        coalesce((select count(*) from cb_sesh_battles b where b.winner = p.account_id), 0)::int as wins
        from cb_profiles p join cb_accounts a on a.id = p.account_id where p.minutes > 0
        order by p.dex desc, p.minutes asc limit ${n}`;
    case "grade":
      return sql`select a.username, p.props, p.legends, p.dex, p.best_grade, p.smoke, p.minutes, p.finished,
        coalesce((select count(*) from cb_sesh_battles b where b.winner = p.account_id), 0)::int as wins
        from cb_profiles p join cb_accounts a on a.id = p.account_id where p.minutes > 0
        order by p.best_grade desc, p.minutes asc limit ${n}`;
    case "smoke":
      return sql`select a.username, p.props, p.legends, p.dex, p.best_grade, p.smoke, p.minutes, p.finished,
        coalesce((select count(*) from cb_sesh_battles b where b.winner = p.account_id), 0)::int as wins
        from cb_profiles p join cb_accounts a on a.id = p.account_id where p.minutes > 0
        order by p.smoke desc, p.minutes asc limit ${n}`;
    case "wins":
      return sql`select a.username, p.props, p.legends, p.dex, p.best_grade, p.smoke, p.minutes, p.finished,
        coalesce((select count(*) from cb_sesh_battles b where b.winner = p.account_id), 0)::int as wins
        from cb_profiles p join cb_accounts a on a.id = p.account_id where p.minutes > 0
        order by wins desc, p.minutes asc limit ${n}`;
    default:
      return sql`select a.username, p.props, p.legends, p.dex, p.best_grade, p.smoke, p.minutes, p.finished,
        coalesce((select count(*) from cb_sesh_battles b where b.winner = p.account_id), 0)::int as wins
        from cb_profiles p join cb_accounts a on a.id = p.account_id where p.minutes > 0
        order by p.props desc, p.legends desc, p.minutes asc limit ${n}`;
  }
}
