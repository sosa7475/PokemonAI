/**
 * The Sesh battle simulator.
 *
 * Runs server-side and only server-side. The move list, the type chart and the species stats
 * all live here rather than being taken from the request, because a battle whose rules the
 * client supplies is a battle the client wins.
 *
 * Deliberately deterministic-ish and short: three buds a side, one exchange at a time,
 * highest-damage move each turn. It doesn't reproduce the solo battle system's status
 * effects or PP — an async fight nobody watches doesn't need them, and every extra rule is
 * another thing that can disagree with the client's version of events.
 *
 * GRADE is the one thing here that isn't in the solo game: better genetics hit harder. That
 * is the whole point of breeding, so it has to show up where players compare themselves.
 */
import MOVES from "../gamedata/moves.data.json";
import TYPES from "../gamedata/types.data.json";
import SPECIES from "../gamedata/species.json";

interface MoveDef { id: string; name: string; family: string; cat: string; power: number; acc: number }
interface Sp { dex: number; edition: number; name: string; family: string; stats: Record<string, number>; rarityRank: number }

const moveById = new Map<string, MoveDef>(
  ((MOVES as { moves: MoveDef[] }).moves ?? []).map((m) => [m.id, m]));
const speciesByEdition = new Map<number, Sp>((SPECIES as Sp[]).map((s) => [s.edition, s]));
const chart = (TYPES as { chart: Record<string, Record<string, number>> }).chart;

export interface SeshBud {
  uid: string; edition: number; name: string; level: number; grade: number;
  maxHp: number; stats: Record<string, number>; moves: { id: string }[];
}

interface Fighter {
  name: string; family: string; level: number; grade: number;
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  moves: MoveDef[];
}

const calcStat = (base: number, level: number) => Math.floor((base * 2 * level) / 100) + 5;
const calcHp = (base: number, level: number) => Math.floor((base * 2 * level) / 100) + level + 10;

function build(b: SeshBud): Fighter {
  const sp = speciesByEdition.get(b.edition);
  const base = sp?.stats ?? { hp: 60, atk: 60, def: 60, spa: 60, spd: 60, spe: 60 };
  const lvl = Math.max(1, Math.min(100, b.level));
  const moves = (b.moves ?? [])
    .map((m) => moveById.get(String((m as { id?: unknown }).id ?? "")))
    .filter((m): m is MoveDef => Boolean(m) && (m as MoveDef).power > 0)
    .slice(0, 4);
  return {
    name: b.name || sp?.name || "a bud",
    family: sp?.family ?? "Gas",
    level: lvl,
    grade: Math.max(1, Math.min(100, b.grade || 20)),
    hp: calcHp(base.hp, lvl),
    atk: calcStat(base.atk, lvl), def: calcStat(base.def, lvl),
    spa: calcStat(base.spa, lvl), spd: calcStat(base.spd, lvl),
    spe: calcStat(base.spe, lvl),
    // a bud that somehow arrived with no usable moves still throws hands
    moves: moves.length ? moves : [{ id: "headbutt", name: "Headbutt", family: "Gas", cat: "physical", power: 40, acc: 100 }],
  };
}

const mult = (atkFam: string, defFam: string) => chart[atkFam]?.[defFam] ?? 1;

/** Genetics are worth up to about a fifth more damage — noticeable, never decisive alone. */
const gradeBonus = (g: number) => 0.9 + (g / 100) * 0.3;

function damage(a: Fighter, d: Fighter, m: MoveDef, rand: () => number): number {
  const phys = m.cat !== "special";
  const atk = phys ? a.atk : a.spa;
  const def = phys ? d.def : d.spd;
  const stab = m.family === a.family ? 1.5 : 1;
  const eff = mult(m.family, d.family);
  const crit = rand() < 0.0625 ? 1.5 : 1;
  const roll = 0.85 + rand() * 0.15;
  const raw = (((2 * a.level) / 5 + 2) * m.power * (atk / Math.max(1, def))) / 50 + 2;
  return Math.max(1, Math.floor(raw * stab * eff * crit * roll * gradeBonus(a.grade)));
}

/** A tiny seeded PRNG so a battle can be replayed from its log if it's ever disputed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export interface SimResult { attackerWon: boolean; log: string[] }

export function simulate(attacker: SeshBud[], defender: SeshBud[], seed = Date.now()): SimResult {
  const rand = rng(seed);
  const A = attacker.slice(0, 3).map(build);
  const D = defender.slice(0, 3).map(build);
  const log: string[] = [];
  let ai = 0, di = 0, turns = 0;

  while (ai < A.length && di < D.length && turns < 120) {
    turns++;
    const a = A[ai], d = D[di];
    // faster bud swings first; grade breaks the tie, which rewards the breeder
    const order = a.spe > d.spe || (a.spe === d.spe && a.grade >= d.grade) ? [a, d] : [d, a];

    for (const attackerSide of order) {
      const defenderSide = attackerSide === a ? d : a;
      if (attackerSide.hp <= 0 || defenderSide.hp <= 0) continue;
      // pick the move that actually hits hardest into this defender
      const m = attackerSide.moves.reduce((best, mv) =>
        damage(attackerSide, defenderSide, mv, () => 0.925) >
        damage(attackerSide, defenderSide, best, () => 0.925) ? mv : best);
      if (rand() * 100 > m.acc) { log.push(`${attackerSide.name}'s ${m.name} missed.`); continue; }
      const dmg = damage(attackerSide, defenderSide, m, rand);
      defenderSide.hp -= dmg;
      const eff = mult(m.family, defenderSide.family);
      log.push(`${attackerSide.name} used ${m.name} — ${dmg}${eff > 1 ? " (super effective)" : eff < 1 ? " (not much)" : ""}.`);
      if (defenderSide.hp <= 0) log.push(`${defenderSide.name} got smoked.`);
    }
    if (a.hp <= 0) ai++;
    if (d.hp <= 0) di++;
  }

  const attackerWon = di >= D.length && ai < A.length;
  log.push(attackerWon ? "You took the Sesh." : ai >= A.length ? "You got run." : "Neither side could finish it — the house calls it.");
  return { attackerWon, log };
}
