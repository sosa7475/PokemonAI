-- PROGRESS: the server's own record of a playthrough.
--
-- Run once, as the owner role (neondb_owner). The game's role (cryptobuds_game) is granted
-- SELECT and INSERT and nothing else, on purpose: "append-only" is then a privilege rather
-- than a convention, and a bug in the API cannot rewrite somebody's history or quietly
-- delete a completion it disagrees with.
--
--   psql "$DATABASE_URL" -f sql/001_progress.sql        (as the OWNER, not the game role)

create table if not exists cb_milestones (
  id          bigserial   primary key,
  account_id  uuid        not null references cb_accounts(id) on delete cascade,
  milestone   text        not null,
  -- what the client claimed it had played when this landed. A hint, never a proof — the
  -- column that matters for plausibility is `at`, which is the server's clock.
  minutes     integer     not null default 0,
  at          timestamptz not null default now(),
  unique (account_id, milestone)
);

create index if not exists cb_milestones_account_idx on cb_milestones (account_id, at);

-- One row per finisher, written by the server when it holds the whole required set. There is
-- no client-supplied "finished" anywhere in this schema, which is the point of it.
create table if not exists cb_completions (
  account_id   uuid        primary key references cb_accounts(id) on delete cascade,
  -- the Nth player to finish. UNIQUE so two simultaneous finishers can never share a place;
  -- the loser of that race retries and takes the next one. This is the column that cannot be
  -- reconstructed after the fact, which is why it is recorded now and not when it's needed.
  rank         integer     not null unique,
  finished_at  timestamptz not null default now(),
  minutes      integer     not null default 0,
  milestones   integer     not null default 0,
  span_minutes integer     not null default 0,
  -- a run whose SHAPE looks played. False is a flag, never a verdict: nothing is deleted or
  -- refused on the strength of it, and the reasons are kept alongside so a human can judge.
  plausible    boolean     not null default true,
  flags        jsonb       not null default '[]'::jsonb
);

create index if not exists cb_completions_rank_idx on cb_completions (rank);

grant select, insert on cb_milestones, cb_completions to cryptobuds_game;
grant usage, select on sequence cb_milestones_id_seq to cryptobuds_game;
