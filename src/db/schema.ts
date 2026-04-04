import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sessions = pgTable("sessions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  playerName: text("player_name").notNull(),
  game: text("game").notNull(),
  badges: integer("badges").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const npcMemory = pgTable(
  "npc_memory",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    npcId: text("npc_id").notNull(),
    game: text("game").notNull(),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    gameFlags: jsonb("game_flags"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("npc_memory_session_npc_idx").on(table.sessionId, table.npcId),
    index("npc_memory_npc_game_idx").on(table.npcId, table.game),
  ]
);

export const npcProfiles = pgTable("npc_profiles", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  npcId: text("npc_id").unique().notNull(),
  game: text("game").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  personality: text("personality").notNull(),
  backstory: text("backstory").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
