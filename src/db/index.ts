import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import "dotenv/config";

/**
 * DB is OPTIONAL. With DATABASE_URL set → full persistence + pgvector memory.
 * Without it → `db` is null and the API runs in "no-memory" mode (NPCs still talk,
 * profiles come from the static roster). Lets the service deploy before a Postgres attaches.
 */
export const hasDb = Boolean(process.env.DATABASE_URL);

export const db = hasDb
  ? drizzle(neon(process.env.DATABASE_URL!), { schema })
  : null;

if (!hasDb) {
  console.warn(
    "[DB] No DATABASE_URL — no-memory mode (NPC dialogue works, persistence disabled)."
  );
}
