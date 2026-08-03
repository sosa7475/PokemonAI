# CRYPTOBUDS: THE CANNAVERSE — Master Game Spec (v1)
### The one-shot build spec. Self-contained. Target: a working browser RPG in the CryptoBuds web app.

A Pokémon-Emerald-style creature-collector set in **the Cannaverse**. You catch **buds** (the CryptoBuds NFTs), battle in **Smoke-Offs**, **crossbreed** to make new strains, and follow the supply chain to the top. **Every NPC is an AI character with persistent memory** (via the AI-NPC backend in this repo). Runs in-browser (Phaser 3), lives at `/adventure` in the CryptoBuds web app.

> Executive calls I made on the few open items (veto any): currency **Smoke** (+ **Seeds** for breeding); badge = **Props**; starters **Sour Diesel / Green Crack / Northern Lights**; healing item **Nug Salve**; region = **the Cannaverse**; game route **/adventure**; v1 is **standalone F2P**, wallet/NFT in v2.

---

## 1. THE ROSETTA STONE (Emerald → CryptoBuds)
| Pokémon Emerald | CryptoBuds |
|---|---|
| Hoenn region | **The Cannaverse** |
| Pokémon (386) | **Buds** — 383 curated from the 4,200 NFTs (weighted by rarity) |
| Types (18) | **Strain families** (7, grouping the 19 strains) |
| Poké Balls | **Baggies** (Zip → Mylar → Vac-Seal) |
| Pokémon Centers | **Dispensaries** (free heal + shop) |
| Poké Marts | Dispensary counter |
| Evolution | **Crossbreeding** (breed 2 buds → new strain) |
| Gyms / Badges | **Smoke-Offs / Props** |
| Team Aqua / Magma | **Team Red Haze vs Team Blue Dream** (beefing gangs) |
| Elite Four | **The Elite** (corrupt top class) |
| Champion | **The Kingpin** (runs the whole supply chain) |
| HMs (Surf/Cut) | **Street moves** (Torch/Clip/Climb) |
| Money | **Smoke** |
| Trainers | AI bud-NPCs with teams |
| Professor Oak | **Old Malawi** (the elder who gives your first bud) |

---

## 2. THE CANNAVERSE — REGION & MAPS (v1 = 5 areas + dispensaries)
Top-down tile RPG. One connected region; towns linked by routes. Player starts on the block, follows the supply chain outward and up.

1. **Dubsack Block** *(start town — the Hood)* — Sour D's home. Old Malawi's grow-shack gives your starter. Team Red Haze & Blue Dream both have corners here (their beef is the inciting incident). Dispensary #1.
2. **Route 1: The Grow Rows → The Weed Farm** — a route where **weed plants are the "trees,"** tall-grass = crop rows (wild bud encounters). Ends at **Kush Hollow** farm town. First Smoke-Off (the Farmer boss). Dispensary #2.
3. **Sativa State (College Campus)** — dorm town, party strains, the Candyland/Blue Dream crowd. Second Smoke-Off. Team Blue Dream HQ nearby. Dispensary #3.
4. **Acapulco City** *(the big city)* — neon, dispensaries, the Plug's Lounge, the docks where shipments come in. Third Smoke-Off. Team Red Haze HQ. The trail to the top opens here. Dispensary #4.
5. **The Underground** *(endgame)* — the trafficking network beneath the city → **The Elite** (4 bosses) → **The Kingpin**. The arc's payoff: you expose it all, and the cycle just resets (a new Kingpin's silhouette). Sets up v2.

*Town-name bank for v2 expansion: Trichome Township, Terp Valley, Landrace Ridge, Hashbury.*

---

## 3. STORY ARC — "Where Does the Weed Come From?" (the spine)
- **Act 1 — The Block.** Sour D gets his first bud from Old Malawi. Team Red Haze and Team Blue Dream are beefing over corners; you get pulled in. The question hits him: *where does all this weed even come from?* He sets out to follow it.
- **Act 2 — Up the Chain.** Farm → Campus → City. Each stop = a Smoke-Off (Prop) + you learn the supply moves *up*, not down. The two gangs are just street-level pawns. The Plug won't say who he answers to.
- **Act 3 — The Underground.** You break into the network. **The Elite** (4) run it — the untouchable class. Beat them, reach **The Kingpin** at the very top.
- **The gut-punch.** You expose everything… and nothing changes. FIRE looks the other way, a new Kingpin steps in, the cycle resets. Roll credits on the truth. (v2 hook: the resistance.)

**Teams:** *Team Red Haze* (aggressive, fire-slinging hotheads) and *Team Blue Dream* (chill-but-shady, mellow manipulators) — beefing rivals you clash with throughout, à la Aqua/Magma. Neither is the real villain; the Elite are.

---

## 4. PROGRESSION — Smoke-Offs & Props
- **Smoke-Offs** replace gyms: a themed boss battle (hotbox challenge) run by a **tribe boss**. Win → a **Prop** (respect) + a new **Street Move** (HM-style traversal: Torch to burn blockages, Clip to cut crop, Climb for ledges).
- v1 has **3 Smoke-Offs** (Farm/Campus/City) + the endgame **Elite (4) + Kingpin**. (v2 scales to 8.)
- Props gate story access + which caught buds obey you (level cap per Prop, like badges).

---

## 5. THE BUDS (creatures)
### 5.1 Roster
- **383 buds**, curated from `~/agility/cryptobuds/nfts/traits.json` — sampled across all 19 strains, **weighted by rarity** (commons common, legendaries rare), guaranteeing the iconic/rarest ones. Each bud's **sprite = its NFT image** (IPFS by CID). Data-generator script (§11) outputs `buds.data.json`.
### 5.2 Types = 7 strain families (maps the 19 strains)
| Family | Strains | Vibe |
|---|---|---|
| **Gas** | Sour Diesel, Green Crack | aggressive, fast |
| **Haze** | Lemon Haze, Super Lemon Haze, Red Haze, Super Silver | hype, special-attack |
| **Kush** | Rainbow Kush, Strawberry Cough, Candyland | bulky, defensive |
| **Frost** | White Widow, Northern Lights, Blue Dream | chill, tanky |
| **Landrace** | Malawi Gold, Acapulco Gold, Purple Thai, Nepali Pink | balanced, OG |
| **Exotic** | Black Beauty, Cat Piss, Super Silver Legendary | rare, high crit |
| **Designer** | (crossbred / lab strains — created via breeding) | hybrids |
**Type chart (rock-paper-scissors core, x2 / x0.5):** Gas > Kush > Landrace > Haze > Frost > Gas; Exotic > everything x1.25 but frail; Designer inherits parents' matchups. (Full 7×7 matrix in `types.data.json`; I'll finalize it — tweakable.)
### 5.3 Stats from rarity + traits
- **Base Stat Total** scales with **rarity rank** (rank #1 legendary ≈ 600 BST; common ≈ 300). Already computed in `buds.json`.
- **Trait → stat weighting:** `eyes` → Speed, `items` → Attack, `headgear` → Defense, `neckwear` → Sp.Def, `mouth` → Sp.Atk, `feet` → HP (deterministic from the bud's own traits → every bud has a distinct spread).
- **Level/XP** standard (1–100 curve). Level cap gated by Props.
### 5.4 Starters
**Sour Diesel (Gas)**, **Green Crack (Gas/hype)**, **Northern Lights (Frost)** — Old Malawi lets you pick one; Sour D is the mascot/canon pick. Rival takes the type-advantaged one.
### 5.5 Legendaries
The rarest buds (**Super Silver Legendary**, Black Beauty, etc.) = static/roaming legendaries, one-per-save, endgame-tier.
### 5.6 Moves
~80 moves across the 7 families (damaging + status), themed (e.g., "Backdraft," "Couch Lock," "Terp Blast," "Lighter Flick"). Each bud learns by level + family. `moves.data.json`.

---

## 6. CROSSBREEDING (the evolution mechanic)
Replaces level-up evolution. At a **Grow Tent** (in dispensaries):
- Put **2 buds + Seeds** → get an **egg → a new bud** whose strain/type is a **blend of the parents** (parent families → a Designer hybrid or a parent strain), inheriting some stats + one parent move.
- Rarer parents → better offspring odds. This is the collection/breeding hook and the path to unique **Designer** strains.
- v1: core breeding (blend rules + a handful of designer outcomes). v2: deep genetics, IVs, shininess.

---

## 7. BATTLE SYSTEM (turn-based)
Classic: 1v1 (wild) & trainer battles; party of 6; switch/item/run; move PP; type effectiveness; STAB; crits; status (Baked=sleep, Ashed=burn, Seeded=leech, Paranoid=confuse); speed-ordered turns; XP + Smoke on win. **AI-flavored:** boss/rival NPCs get an **AI taunt line** (from the NPC API) at battle start & on KO — in character, remembers past losses.

---

## 8. CATCHING — Baggies
Throw a **Baggie** at a weakened wild bud; catch odds scale with HP/status/Baggie tier. Tiers: **Zip** (basic) → **Mylar** (better) → **Vac-Seal** (best). Legendary buds resist heavily.

---

## 9. ECONOMY & ITEMS
- **Smoke** = currency (matches the farm game — one ecosystem economy). **Seeds** = breeding resource.
- **Dispensary** = free full heal + **shop** (Baggies, Nug Salve/healing, Seeds, status cures). Also the **Grow Tent** (breeding) + **Box** (bud storage).
- Items: **Nug Salve** (heal), **Reup** (revive), **Terp Spray** (repel), family-boost held items, Baggie tiers.

---

## 10. NPCs & AI (the differentiator)
- **All key NPCs are AI** via this repo's `/npc/chat` API: personas + memory (pgvector). Already seeded: Sour D, The Plug, Agent Blaze (FIRE), Old Malawi, Kush. Add: tribe bosses, the rival, Team leaders, the Elite, the Kingpin.
- Overworld: talk to any NPC → live AI dialogue that remembers you + reacts to Props/story flags (`game_flags`).
- Battle: boss AI taunts. Rival remembers your history.
- Player identified by a session (wallet address in v2).

---

## 11. TECH ARCHITECTURE
- **Engine: Phaser 3 + TypeScript.** Tile-based, browser, integrates into the CryptoBuds web app at **`/adventure`** (own bundle/route; the marketing site stays static).
- **Maps: Tiled editor** → export **JSON (TMX)**; Phaser loads them. Tilesets = generated CryptoBuds tiles (§12). **Not** ROM hack tools.
- **Data-driven:** `buds.data.json`, `types.data.json`, `moves.data.json`, `maps/*.json`, generated by a script from `traits.json`/`buds.json` (§13). Sprites streamed from IPFS by CID (cache to Blob/CDN for speed).
- **AI NPCs:** call the deployed **PokemonAI API** (`/session`, `/npc/chat`, `/npc/:id/history`). Deploy API on Vercel/Fly + Neon Postgres (pgvector). OPENAI_API_KEY from AgilityOS.
- **Save:** localStorage v1 (JSON save blob) → account/wallet-linked v2.
- **State:** a clean data model — `Player`, `Bud` (species+level+moves+IVs), `Party`, `Box`, `Bag`, `Flags`, `Map/warp graph`, `BattleState`.
- **Repo layout (web game):** `apps/adventure/` in the CryptoBuds web app — `src/scenes/` (Boot, World, Battle, Menu, Breed), `src/systems/` (battle, catch, breed, save, ai-npc client), `src/data/*.json`, `public/tilesets/`, `public/ui/`.

---

## 12. ASSETS (what to make)
- **Tilesets (generate via GPT Image 2, CryptoBuds cartoon style):** grass/soil/paths, **weed-plant "trees,"** crop tall-grass, water, fences, city streets, neon signage, building exteriors (dispensary, dorms, houses, the Lounge), interiors (dispensary counter, grow tent, homes). Slice into a Tiled tileset (16×16 or 32×32 grid).
- **Bud sprites:** the **NFT images** (383) — auto-resized to overworld + battle sprites.
- **⚠️ Back-sprite solution (Sam flagged):** the NFT art is all front-facing; classic Pokémon shows *your* bud from behind. **v1 fix = both combatants shown FRONT-facing** — opponent upper-right (smaller/farther), your active bud lower-left (larger/closer), like many indie monster-collectors. **Zero extra art, uses the NFT images as-is.** No back sprites needed. **v2:** batch-generate true back-view sprites via GPT Image 2 (image-to-image from each front sprite) if we want the authentic over-the-shoulder look. Overworld bud sprites (when a bud follows you) = a small front/3-4 sprite, also fine from the NFT art.
- **Player + NPC overworld sprites:** a walkable Sour-D-style avatar (4-dir) + NPC variants (generate a small set, tint per strain).
- **UI:** battle HUD, menus, dialogue box, Baggie/Nug icons — in the site's chunky Pudgy style (reuse the web-app design language).

---

## 13. DATA PIPELINE (traits → game)
Script (`scripts/build-game-data.ts`) reads `~/agility/cryptobuds/nfts/traits.json` + `buds.json` →
1. Sample 383 (rarity-weighted, force-include iconics/legendaries).
2. For each: assign **family** (from strain), **BST** (from rarity rank), **stat spread** (from traits, §5.3), **learnset** (family + level), **sprite URL** (IPFS CID + edition).
3. Emit `buds.data.json`. Also emit `types.data.json` (chart) + `moves.data.json` (hand-authored).

---

## 14. BUILD MILESTONES (the one-shot)
**v1 FIRST-PLAYABLE (Sam: "start with just wild bud battles") = the core loop:** overworld + wild encounters + turn-based battle + catching + party/box + dispensary heal/shop + breeding. Story/teams/Smoke-Offs are the next layer, not required for first-playable.
1. Scaffold Phaser+TS app at `/adventure` + boot scene + save system.
2. Data pipeline → `buds.data.json` / `types.data.json` / `moves.data.json`.
3. World scene: load Tiled maps (Dubsack Block + the Grow Rows first), movement, warps, NPC interaction (AI dialogue).
4. **Wild encounters** in crop tall-grass + **Battle scene** (full turn-based, front-facing) + **catching (Baggies)**. ← *this is the "see it work" moment.*
5. Party / Box / Bag / **Dispensary** (heal + shop) + **Grow Tent (crossbreeding)**.
6. *(Next layer)* Story flags, rival (cocky legendary), 3 Smoke-Offs, Team Red Haze vs Blue Dream, the Underground → Elite → Kingpin.
7. *(Next layer)* AI boss taunts + rival memory. Then polish, save/load, deploy.
**Trainer/story battles come after wild battles prove out** — v1 leads with catching + wild fights.

---

## 15. DEFERRED TO v2
Full 8 Smoke-Offs; deep breeding genetics/IVs/shinies; **wallet + NFT integration** (own a bud → guaranteed catch / boost / play-as); online trading; the resistance storyline; the full 4,200 as catchable.

---

## OPEN (veto/confirm)
Currency **Smoke**; badge **Props**; starters **Sour Diesel/Green Crack/Northern Lights**; catch item **Baggie**; healing **Nug Salve**; route **/adventure**; **standalone F2P v1**; I finalize the **7-family type chart + movepool**. Everything else above is locked from your answers.
