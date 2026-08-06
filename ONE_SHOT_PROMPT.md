# 🎮 CryptoBuds: The Cannaverse — ONE-SHOT BUILD PROMPT
### Paste everything below into a fresh Fable 5 session and let it rip.

---

You are building **CryptoBuds: The Cannaverse** — a Pokémon-Emerald-style creature-collector RPG that runs in the browser. Everything you need already exists: a complete design spec, ready game data, art direction, and a **live AI-NPC API**. Your job is to build the **v1 first-playable** game in one shot.

## READ THESE FIRST (they are your source of truth)
- **`~/agility/repos/cryptobuds-api/CRYPTOBUDS_GAME_SPEC.md`** — the complete master spec (world, systems, story, architecture). Follow it.
- **`~/agility/repos/cryptobuds-api/game-data/buds.data.json`** — the 383 catchable buds (dex, name, strain, **family/type**, **stats**, learnset, `sprite` = IPFS URL of the NFT art).
- **`~/agility/repos/cryptobuds-api/game-data/types.data.json`** — the 7 strain-family type-effectiveness chart.
- **`~/agility/repos/cryptobuds-api/game-data/moves.data.json`** — 30 moves (power/accuracy/category/effect).
- **`~/agility/repos/cryptobuds-api/game-data/art/overworld-tileset-ref.png`** — top-down CryptoBuds art direction (weed-plant "trees," dirt paths, dispensary, water, grass). Match this style.

## TECH (locked)
- **Vite + Phaser 3 + TypeScript.** Scaffold a fresh app at **`~/agility/cryptobuds/adventure/`**. Deploy to Vercel when done; it will be linked from the site at `/adventure`.
- Copy `game-data/*.json` into the app's `src/data/`. Bud **sprites load from the IPFS `sprite` URLs** in the data (cache/lazy-load them).
- **Maps: build with Tiled** (or a clean programmatic tilemap if faster) — generate/slice a tileset from the art-direction reference (grass, path, crop tall-grass, weed-plant trees, buildings, water). 16×16 or 32×32 tiles.

## AI NPCs (already live — just call it)
NPC dialogue comes from a **live API**: `https://cryptobuds-npc-api.vercel.app`
- `POST /session` `{player_name, game:"cryptobuds"}` → `{session_id}` (call once on new game; store it).
- `POST /npc/chat` `{session_id, npc_id, game:"cryptobuds", player_message, game_flags:{badges, current_town}}` → `{response}` (call when the player talks to an NPC; show `response` in the dialogue box).
- Seeded npc_ids: `sour_d`, `the_plug`, `fire_agent_blaze`, `elder_malawi`, `lounge_kush`. (Old Malawi = `elder_malawi` gives the starter.)
- CORS is open. If the API errors, fall back to a static line so the game never blocks.

## V1 FIRST-PLAYABLE — the core loop (wild-battles-first)
Build these, in order — this is the "see it work" target:
1. **World scene** — load 2 maps: **Dubsack Block** (start town, has Old Malawi's grow-shack + a Dispensary) and **The Grow Rows** (a route with crop tall-grass). Grid movement, collisions, warps between maps, an interact button.
2. **Starter** — Old Malawi (`elder_malawi`, AI dialogue) lets you pick 1 of 3 starters: **Sour Diesel, Green Crack, Northern Lights** (find them in the data by strain; Sour Diesel = edition 16).
3. **Wild encounters** in crop tall-grass — rarity-weighted (commons common, legendaries very rare; use each bud's `rarityTier`).
4. **Battle scene — full turn-based** (per spec §7): moves w/ PP, type chart, STAB, crits, status (Baked/Ashed/Seeded/Paranoid), switch/item/run, XP + Smoke on win. **Both buds shown FRONT-facing** (opponent upper-right/smaller, yours lower-left/larger) — uses the NFT art as-is, **no back sprites needed**.
5. **Catching** — throw a **Baggie** (Zip/Mylar/Vac-Seal), odds scale w/ HP+status+tier.
6. **Party (6) + Box (storage) + Bag (items).**
7. **Dispensary** = full heal + shop (Baggies, **Nug Salve** heal, Seeds, revives).
8. **Grow Tent (crossbreeding)** — put 2 buds + Seeds → a new bud whose family blends the parents (basic rules from spec §6).
9. **Save/load** to localStorage.
10. **NPCs** — every named NPC talks via the AI API.

## STATS / TYPES / MOVES — use the data as-is
- Each bud's `family` = its type; effectiveness from `types.data.json`. `stats` (hp/atk/def/spa/spd/spe) and `learnset` are in `buds.data.json`. Moves in `moves.data.json`. Standard level/XP curve.

## STYLE
Match the CryptoBuds web app: chunky rounded UI, thick outlines, green (#3fae2a) + orange (#ff7a1a), cream (#f6f2e6). Fun, bold, Pudgy-Penguins-clean. Reuse that language for the battle HUD, menus, and dialogue box.

## ACCEPTANCE (v1 is "done" when)
You can: start a new game → get a starter from Old Malawi (AI dialogue) → walk into the Grow Rows → hit crop grass → **battle a wild bud** → **catch it with a Baggie** → it's in your party → **heal at the Dispensary** → **talk to an AI NPC** who responds in the Cannaverse voice → **breed two buds** at the Grow Tent → close and reopen the tab and your save persists. Deploy to Vercel.

## DEFERRED (do NOT build in v1)
Trainer/gym battles, the 3 Smoke-Offs, Teams Red Haze/Blue Dream, the Elite/Kingpin story, wallet/NFT integration, full 8-badge region, deep breeding genetics. (All specced for v2.)

**Build it. Lead with the wild-battle loop so it's playable fast, then layer the rest of v1.**
