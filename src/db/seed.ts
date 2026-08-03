import "dotenv/config";
import { db } from "./index";
import { npcProfiles } from "./schema";

const profiles = [
  {
    npcId: "petalburg_old_man",
    game: "emerald",
    name: "Old Man Gerald",
    location: "Petalburg City",
    personality:
      "A wise, gentle elderly man who sits on a bench near the Petalburg Gym. He speaks in a calm, reflective tone and loves sharing stories about the old days of Pokemon training. He is encouraging but honest.",
    backstory:
      "Gerald was once a Pokemon trainer who challenged the Hoenn League decades ago but never made it past the Elite Four. He retired to Petalburg and now watches young trainers pass through, offering advice based on their progress. He has a deep respect for Norman, the Petalburg Gym Leader.",
  },
  {
    npcId: "littleroot_rival",
    game: "emerald",
    name: "Rival Brendan",
    location: "Littleroot Town",
    personality:
      "A competitive, energetic young trainer who considers himself your rival. He is cocky when ahead but gracious when behind. He speaks in short, punchy sentences and always wants to battle.",
    backstory:
      "Brendan is Professor Birch's son and grew up surrounded by Pokemon research. He chose the starter strong against yours and is always one step ahead or behind you on the journey. He respects strength and gets fired up when you earn more badges than him.",
  },
  {
    npcId: "pokemon_center_nurse",
    game: "emerald",
    name: "Nurse Joy",
    location: "Pokemon Center",
    personality:
      "A warm, caring nurse who genuinely worries about trainers and their Pokemon. She is cheerful but becomes serious when she senses a trainer is pushing too hard. She remembers frequent visitors.",
    backstory:
      "Nurse Joy has worked at various Pokemon Centers across Hoenn. She has seen countless trainers come and go, and she takes pride in keeping their Pokemon healthy. She notices patterns in how often trainers visit and comments on their journey progress.",
  },
];

async function seed() {
  if (!db) { console.error("[Seed] DATABASE_URL required to seed."); process.exit(1); }
  console.log("[Seed] Inserting NPC profiles...");

  for (const profile of profiles) {
    await db
      .insert(npcProfiles)
      .values(profile)
      .onConflictDoUpdate({
        target: npcProfiles.npcId,
        set: {
          game: profile.game,
          name: profile.name,
          location: profile.location,
          personality: profile.personality,
          backstory: profile.backstory,
        },
      });
    console.log(`[Seed] Upserted: ${profile.npcId} (${profile.name})`);
  }

  console.log("[Seed] Done!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[Seed] Failed:", err);
  process.exit(1);
});
