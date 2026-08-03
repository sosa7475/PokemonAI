# CryptoBuds — AI Creature-Collector (plan)

Turning this AI-NPC platform into **the CryptoBuds game**: a Pokémon-style creature-collector set in the Cannaverse, where you **catch the 4,200 buds** and **every NPC is an AI character with memory**. Crypto + cannabis + AI — the convergence, playable.

## What this repo is (the reusable brain)
An **engine-agnostic AI-NPC backend**: Express API → GPT-4o dialogue + Neon/pgvector memory + per-NPC personas. The Lua/BizHawk bridge is one frontend; a future **web game can call the exact same `/npc/chat` API**. Building the brain now is never wasted.

**Done so far (CryptoBuds-ification, phase 1a):**
- `src/config/worlds.ts` — world framing is now game-aware (Pokémon `emerald` vs `cryptobuds`/the Cannaverse tone, slang, progression = Street Cred).
- `src/services/openai.ts` — prompt builder + char limit driven by world config.
- `src/db/seed-cryptobuds.ts` — 5 Cannaverse NPCs (Sour D, The Plug, Agent Blaze/FIRE, Old Malawi, Kush) → `npm run seed:cryptobuds`.

## The creatures: 4,200 buds = the sprites
The NFT collection IS the creature roster. **We already have the art (4,200 PNGs on IPFS) AND the data (`~/agility/cryptobuds/nfts/traits.json`).** Map:
- **Strain (`body`) → creature "type"** (19 strains = 19 types, with a type-matchup chart we design — e.g., Fire strains beat X).
- **Rarity rank → base stats** (rank #1 legendary = strongest; common = starter-tier). Already computed in `traits.json` / `buds.json`.
- **Traits (headgear/eyes/items/…) → moves / flavor / abilities.**
- Each bud = a unique catchable creature with its own sprite.

## ⚠️ The 4,200 reality (key architecture call)
A GBA/Emerald ROM holds **~386 species max** — it physically cannot hold 4,200 creatures. So:

- **Track A — ROM hack (fast prototype only):** reskin Emerald using the **19 strains as the ~species** (or a curated subset of buds), AI NPCs via BizHawk. Great to *feel* the game in a weekend. But Nintendo-IP + desktop-emulator bound → not the shippable product.
- **Track B — Web engine (the real product):** a data-driven creature-collector (custom Phaser/TS, or Tuxemon/OpenMon) that loads all **4,200 buds from `traits.json` + IPFS sprites**, runs in the browser (link, not app store = solves distribution), integrates wallet/NFTs, and calls this same AI-NPC API. This is the only vessel that fits 4,200 creatures + the NFT tie-in.

**Recommendation:** ROM-hack prototype to nail the feel; build the real game **web-first**, data-driven off the collection we already pulled.

## Roadmap
1. **AI layer → CryptoBuds** ✅ started (world config + NPC personas). Next: generate a persona per bud from its traits (strain + accessories → personality); tie memory to the player's owned buds.
2. **Creature system:** script to turn `traits.json` → creature data (type, base stats from rarity, movepool). Type-matchup chart. (Shared by ROM hack + web.)
3. **Infra:** Neon Postgres (pgvector) + deploy the API (Vercel/Fly) + wire `OPENAI_API_KEY` (available in AgilityOS). Optionally back it with the AgilityOS Postgres.
4. **Frontend:** (A) ROM-hack prototype with the 19 strains; (B) web engine loading all 4,200 — the product.
5. **NFT integration:** wallet connect → your owned buds are playable / boosted; rarity → in-game power; ties to the site + farm game.

## Open questions for Sam
- **DB:** spin up a fresh Neon DB, or reuse an AgilityOS Postgres?
- **Frontend track:** ROM-hack prototype first (feel it), or go straight to the web engine (the product)? (Rec: quick prototype, then web.)
- **Push:** OK to push this branch to `github.com/sosa7475/PokemonAI`?
