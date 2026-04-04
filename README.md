# Pokemon AI NPC Platform

AI-powered NPCs with persistent memory for Pokemon ROM hacks. Uses OpenAI GPT-4o to generate in-character dialogue that fits in the GBA dialogue box, with pgvector-backed semantic memory so NPCs remember past interactions.

## Architecture

```
BizHawk (Lua) → HTTP POST → Node.js API → OpenAI GPT-4o
                                ↕
                         Neon PostgreSQL
                         (pgvector memory)
```

## Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) PostgreSQL database with pgvector enabled
- An [OpenAI](https://platform.openai.com) API key
- [BizHawk](https://tasvideos.org/BizHawk) emulator (for running the Lua bridge)
- A Pokemon Emerald ROM

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Neon DATABASE_URL and OPENAI_API_KEY
```

### 3. Enable pgvector on your Neon database

In the Neon SQL Editor, run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 4. Run database migrations

```bash
npm run db:push
```

### 5. Seed NPC profiles

```bash
npm run seed
```

### 6. Start the API server

```bash
npm run dev
```

The server runs on `http://localhost:3000` by default.

## Loading the Lua Script in BizHawk

1. Open BizHawk and load your Pokemon Emerald ROM
2. Go to **Tools → Lua Console**
3. Click **Script → Open Script** and select `lua/ai_npc.lua`
4. The script will auto-create a session and begin polling for dialogue triggers
5. Check the Lua Console output for connection status and NPC responses

## API Endpoints

### POST /session
Create a new play session.
```json
{ "player_name": "Ash", "game": "emerald" }
→ { "session_id": "uuid" }
```

### POST /npc/chat
Chat with an NPC.
```json
{
  "session_id": "uuid",
  "npc_id": "petalburg_old_man",
  "game": "emerald",
  "player_message": "hello",
  "game_flags": { "badges": 3, "current_town": "petalburg" }
}
→ { "response": "Ah, three badges! ...", "npc_id": "...", "session_id": "..." }
```

### GET /npc/:npc_id/history?session_id=uuid
Get conversation history for an NPC in a session.

### POST /npc/profile
Upsert an NPC profile.
```json
{
  "npc_id": "petalburg_old_man",
  "game": "emerald",
  "name": "Old Man Gerald",
  "location": "Petalburg City",
  "personality": "A wise old man...",
  "backstory": "Former trainer..."
}
→ { "npc_id": "petalburg_old_man" }
```

## Multi-Game Support

All tables include a `game` field. To add NPCs for FireRed, Crystal, or other decomps, create profiles with the appropriate game value and adjust the Lua script's memory addresses for each game.

## Project Structure

```
├── src/
│   ├── db/
│   │   ├── schema.ts      # Drizzle ORM schema (sessions, npc_memory, npc_profiles)
│   │   ├── index.ts        # Database connection
│   │   └── seed.ts         # Seed data for 3 Emerald NPCs
│   ├── routes/
│   │   ├── npc.ts          # /npc/chat, /npc/:id/history, /npc/profile
│   │   └── session.ts      # /session
│   ├── services/
│   │   ├── openai.ts       # GPT-4o chat with system prompt builder
│   │   ├── memory.ts       # Conversation history + pgvector search
│   │   └── embeddings.ts   # text-embedding-3-small wrapper
│   ├── types/
│   │   └── index.ts        # TypeScript interfaces
│   └── index.ts            # Express server entry point
├── lua/
│   └── ai_npc.lua          # BizHawk Lua bridge script
├── drizzle.config.ts
└── package.json
```
