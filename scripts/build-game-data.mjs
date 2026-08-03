// Build CryptoBuds game data from the NFT collection.
// Reads game-data/source-buds.json (the 4,200 w/ traits + rarity rank),
// emits buds.data.json (383 rarity-spread creatures), types.data.json, moves.data.json.
// Plain Node ESM — run: `node scripts/build-game-data.mjs` (no deps).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const GD = path.join(DIR, "..", "game-data");
const src = JSON.parse(fs.readFileSync(path.join(GD, "source-buds.json"), "utf8"));
const TOTAL = src.total, CID = src.imgCid, ORDER = src.order;
const GATEWAY = "https://ipfs.io/ipfs";

// ---- 19 strains -> 7 families ----
const FAMILY_OF = {
  "sour diesel": "Gas", "green crack": "Gas",
  "lemon haze": "Haze", "super lemon haze": "Haze", "red haze": "Haze", "super silver": "Haze",
  "rainbow kush": "Kush", "strawberry cough": "Kush", "candyland": "Kush",
  "white widow": "Frost", "northern lights": "Frost", "blue dream": "Frost",
  "malawi gold": "Landrace", "aculpoco gold": "Landrace", "purple thai": "Landrace", "nepali pink": "Landrace",
  "black beauty": "Exotic", "cat piss": "Exotic", "super silver legendary": "Exotic",
};
const FAMILIES = ["Gas", "Haze", "Kush", "Frost", "Landrace", "Exotic", "Designer"];

// ---- type chart: attacker -> defender -> multiplier ----
// core cycle: Gas>Kush>Landrace>Haze>Frost>Gas ; Exotic hits 1.25 & takes 1.25 ; Designer neutral
function buildChart() {
  const beats = { Gas: "Kush", Kush: "Landrace", Landrace: "Haze", Haze: "Frost", Frost: "Gas" };
  const c = {};
  for (const a of FAMILIES) {
    c[a] = {};
    for (const d of FAMILIES) {
      let m = 1;
      if (beats[a] === d) m = 2;                 // super effective
      else if (beats[d] === a) m = 0.5;          // resisted
      if (a === "Exotic" && d !== "Exotic") m = Math.max(m, 1.25);
      if (d === "Exotic" && a !== "Exotic") m = Math.max(m, 1.25);
      c[a][d] = m;
    }
  }
  return c;
}

// ---- moves ----
const MOVES = [
  // universal
  { id: "headbutt", name: "Headbutt", family: "Designer", cat: "physical", power: 40, acc: 100, pp: 25 },
  { id: "roll_up", name: "Roll Up", family: "Designer", cat: "physical", power: 60, acc: 95, pp: 20 },
  { id: "smoke_screen", name: "Smoke Screen", family: "Designer", cat: "status", power: 0, acc: 100, pp: 20, effect: "lower_accuracy" },
  { id: "growl", name: "Growl", family: "Designer", cat: "status", power: 0, acc: 100, pp: 30, effect: "lower_attack" },
  { id: "munchies", name: "Munchies", family: "Designer", cat: "status", power: 0, acc: 100, pp: 10, effect: "heal_50" },
  { id: "lighter_flick", name: "Lighter Flick", family: "Designer", cat: "physical", power: 55, acc: 95, pp: 20, effect: "may_ash" },
  // Gas
  { id: "diesel_rush", name: "Diesel Rush", family: "Gas", cat: "physical", power: 45, acc: 100, pp: 25 },
  { id: "gas_leak", name: "Gas Leak", family: "Gas", cat: "special", power: 55, acc: 100, pp: 20 },
  { id: "backdraft", name: "Backdraft", family: "Gas", cat: "physical", power: 85, acc: 90, pp: 10, effect: "recoil_25" },
  { id: "fumigate", name: "Fumigate", family: "Gas", cat: "status", power: 0, acc: 90, pp: 15, effect: "poison_seeded" },
  // Haze
  { id: "terp_blast", name: "Terp Blast", family: "Haze", cat: "special", power: 50, acc: 100, pp: 20 },
  { id: "haze_cloud", name: "Haze Cloud", family: "Haze", cat: "status", power: 0, acc: 100, pp: 20, effect: "lower_accuracy" },
  { id: "purple_haze", name: "Purple Haze", family: "Haze", cat: "special", power: 90, acc: 90, pp: 10, effect: "may_paranoid" },
  { id: "silver_streak", name: "Silver Streak", family: "Haze", cat: "special", power: 70, acc: 100, pp: 15 },
  // Kush
  { id: "nug_slam", name: "Nug Slam", family: "Kush", cat: "physical", power: 60, acc: 95, pp: 20 },
  { id: "couch_lock", name: "Couch Lock", family: "Kush", cat: "status", power: 0, acc: 75, pp: 10, effect: "sleep_baked" },
  { id: "sticky_icky", name: "Sticky Icky", family: "Kush", cat: "physical", power: 65, acc: 100, pp: 15, effect: "may_lower_speed" },
  { id: "resin_wall", name: "Resin Wall", family: "Kush", cat: "status", power: 0, acc: 100, pp: 20, effect: "raise_defense" },
  // Frost
  { id: "frost_bite", name: "Frost Bite", family: "Frost", cat: "special", power: 55, acc: 100, pp: 20 },
  { id: "chill_out", name: "Chill Out", family: "Frost", cat: "status", power: 0, acc: 100, pp: 10, effect: "heal_50" },
  { id: "widows_bite", name: "Widow's Bite", family: "Frost", cat: "physical", power: 80, acc: 95, pp: 10, effect: "may_lower_speed" },
  { id: "deep_freeze", name: "Deep Freeze", family: "Frost", cat: "special", power: 70, acc: 90, pp: 10, effect: "may_baked" },
  // Landrace
  { id: "root_bind", name: "Root Bind", family: "Landrace", cat: "status", power: 0, acc: 100, pp: 20, effect: "trap" },
  { id: "golden_touch", name: "Golden Touch", family: "Landrace", cat: "physical", power: 60, acc: 100, pp: 20 },
  { id: "landrace_legacy", name: "Landrace Legacy", family: "Landrace", cat: "special", power: 85, acc: 100, pp: 10 },
  { id: "sun_grown", name: "Sun Grown", family: "Landrace", cat: "status", power: 0, acc: 100, pp: 10, effect: "heal_over_time" },
  // Exotic
  { id: "cat_scratch", name: "Cat Scratch", family: "Exotic", cat: "physical", power: 50, acc: 100, pp: 25, effect: "high_crit" },
  { id: "exotic_funk", name: "Exotic Funk", family: "Exotic", cat: "special", power: 95, acc: 90, pp: 10 },
  { id: "dark_bloom", name: "Dark Bloom", family: "Exotic", cat: "special", power: 70, acc: 100, pp: 15, effect: "may_lower_spdef" },
  { id: "legendary_haze", name: "Legendary Haze", family: "Exotic", cat: "special", power: 110, acc: 85, pp: 5, effect: "recoil_33" },
];
const MOVE_BY_FAMILY = {};
for (const f of FAMILIES) MOVE_BY_FAMILY[f] = MOVES.filter((m) => m.family === f);

// ---- helpers ----
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function tier(rr) { return rr <= 42 ? "legendary" : rr <= 210 ? "rare" : rr <= 840 ? "uncommon" : "common"; }
function bst(rr) { return Math.round(300 + 300 * (1 - (rr - 1) / (TOTAL - 1))); }

// stat spread from traits (eyes->Spe, items->Atk, headgear->Def, neckwear->SpD, mouth->SpA, feet->HP)
function statSpread(tr, total) {
  const idx = { hp: ORDER.indexOf("feet"), atk: ORDER.indexOf("items"), def: ORDER.indexOf("headgear"),
                spa: ORDER.indexOf("mouth"), spd: ORDER.indexOf("neckwear"), spe: ORDER.indexOf("eyes") };
  const keys = ["hp", "atk", "def", "spa", "spd", "spe"];
  const w = {}; let sum = 0;
  for (const k of keys) { const v = 1 + (hash(String(tr[idx[k]] ?? k)) % 70) / 100; w[k] = v; sum += v; }
  const stats = {}; let used = 0;
  keys.forEach((k, i) => {
    if (i < keys.length - 1) { stats[k] = Math.max(20, Math.round((w[k] / sum) * total)); used += stats[k]; }
    else stats[k] = Math.max(20, total - used); // last stat absorbs rounding
  });
  return stats;
}

function learnset(family) {
  const fam = MOVE_BY_FAMILY[family].length ? MOVE_BY_FAMILY[family] : MOVE_BY_FAMILY.Designer;
  const uni = MOVE_BY_FAMILY.Designer;
  const pool = [uni[0], fam[0], uni[3], fam[1] ?? fam[0], fam[2] ?? fam[0], fam[3] ?? uni[1]];
  const levels = [1, 5, 11, 18, 27, 37];
  return levels.map((lv, i) => ({ level: lv, move: (pool[i] ?? uni[0]).id }));
}

// ---- select 383: stride across rarity for a spread, force legendaries + Sour D ----
const byRank = [...src.buds].sort((a, b) => a.rr - b.rr);
const TARGET = 383;
const pick = new Map();
byRank.filter((b) => b.rr <= 42).forEach((b) => pick.set(b.e, b));   // all legendaries
const sourD = src.buds.find((b) => b.e === 16); if (sourD) pick.set(16, sourD); // canonical Sour D
const step = Math.max(1, Math.floor(byRank.length / TARGET));
for (let i = 0; i < byRank.length && pick.size < TARGET; i += step) pick.set(byRank[i].e, byRank[i]);
for (let i = 0; i < byRank.length && pick.size < TARGET; i++) pick.set(byRank[i].e, byRank[i]); // top-up
const chosen = [...pick.values()].sort((a, b) => a.rr - b.rr).slice(0, TARGET);

// ---- emit ----
const buds = chosen.map((b, dex) => {
  const family = FAMILY_OF[b.s] ?? "Designer";
  const total = bst(b.rr);
  return {
    dex: dex + 1,
    edition: b.e,
    name: b.s.replace(/\b\w/g, (c) => c.toUpperCase()),
    strain: b.s,
    family,
    rarityRank: b.rr,
    rarityTier: tier(b.rr),
    baseStatTotal: total,
    stats: statSpread(b.tr, total),
    traits: Object.fromEntries(ORDER.map((k, i) => [k, b.tr[i]])),
    sprite: `${GATEWAY}/${CID}/${b.e}.png`,
    learnset: learnset(family),
    starter: b.e === 16,
    legendary: b.rr <= 42,
  };
});

const out = (name, data) => { fs.writeFileSync(path.join(GD, name), JSON.stringify(data, null, 0)); };
out("buds.data.json", { count: buds.length, spriteCid: CID, families: FAMILIES, buds });
out("types.data.json", { families: FAMILIES, chart: buildChart() });
out("moves.data.json", { moves: MOVES });

const tiers = buds.reduce((a, b) => ((a[b.rarityTier] = (a[b.rarityTier] || 0) + 1), a), {});
const fams = buds.reduce((a, b) => ((a[b.family] = (a[b.family] || 0) + 1), a), {});
console.log(`✓ buds.data.json: ${buds.length} buds`);
console.log("  tiers:", tiers);
console.log("  families:", fams);
console.log("✓ types.data.json (7-family chart) + moves.data.json (" + MOVES.length + " moves)");
console.log("  Sour D:", buds.find((b) => b.edition === 16)?.name, "dex#" + buds.find((b) => b.edition === 16)?.dex, buds.find((b) => b.edition === 16)?.stats);
