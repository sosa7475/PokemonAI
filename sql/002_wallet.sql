-- WALLET: the challenge a wallet signs, and the record of what got linked.
--
-- Run once, as the owner role (neondb_owner):
--   psql "$DATABASE_URL" -f sql/002_wallet.sql        (as the OWNER, not the game role)
--
-- This REPLACES cb_wallet_nonces, which was keyed by address alone. That key was the bug:
-- `on conflict (address) do update set account_id = excluded.account_id` meant anybody who
-- knew your address could overwrite your pending challenge — rebinding it to their own
-- account, and locking you out of ever linking while they kept doing it. A challenge belongs
-- to the account that asked for it, so that is the key.
--
-- Dropping it outright is safe: rows live ten minutes and mean nothing after that.

drop table if exists cb_wallet_nonces;

create table if not exists cb_wallet_challenges (
  account_id uuid        not null references cb_accounts(id) on delete cascade,
  address    text        not null,
  nonce      text        not null,
  -- the FULL EIP-4361 message we issued. Redemption compares what was signed against this,
  -- byte for byte, rather than rebuilding it from what the client sends back — so there is
  -- no gap between our idea of the message and the wallet's.
  message    text        not null,
  domain     text        not null,
  chain_id   integer     not null,
  created_at timestamptz not null default now(),
  primary key (account_id, address)
);

create index if not exists cb_wallet_challenges_age_idx on cb_wallet_challenges (created_at);

-- Who linked what, when. Append-only and never read by the game: this exists so that if an
-- address is ever disputed there is a history to read instead of a shrug.
create table if not exists cb_wallet_events (
  id         bigserial   primary key,
  account_id uuid        not null references cb_accounts(id) on delete cascade,
  address    text,
  event      text        not null,   -- linked | unlinked | refused | refreshed
  detail     text,
  ip         text,
  at         timestamptz not null default now()
);

create index if not exists cb_wallet_events_account_idx on cb_wallet_events (account_id, at desc);
create index if not exists cb_wallet_events_address_idx on cb_wallet_events (address, at desc);

-- The game role gets exactly what the flows need and nothing else. It can hand out a
-- challenge and spend it; it can write history; it cannot rewrite history.
grant select, insert, update, delete on cb_wallet_challenges to cryptobuds_game;
grant select, insert                 on cb_wallet_events     to cryptobuds_game;
grant usage, select on sequence cb_wallet_events_id_seq to cryptobuds_game;
