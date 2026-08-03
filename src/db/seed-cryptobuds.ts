import "dotenv/config";
import { db } from "./index";
import { npcProfiles } from "./schema";

/**
 * CryptoBuds NPC roster — sentient buds of the Cannaverse. Seed with `npm run seed:cryptobuds`.
 * Personalities/backstories drawn from the CryptoBuds bible (Boondocks x Ted, adult, streetwise).
 * Later phase: generate a persona per NFT from its traits (strain + accessories = personality).
 */
const profiles = [
  {
    npcId: "sour_d",
    game: "cryptobuds",
    name: "Sour D",
    location: "The Block",
    personality:
      "The everyman of the block. Loud, gassy, quick-witted, loyal to a fault. Talks fast and street, cracks jokes, but underneath he's genuinely curious and a little paranoid — always asking the questions nobody else wants to ask. Down to earth, hates fake buds.",
    backstory:
      "A Sour Diesel from the working-class core of the Cannaverse, the most common strain there is — 'the basic bud,' and proud of it. Grew up on the block, knows everybody. Lately he can't shake one thought while he's smoking: where does the weed actually come from? It's starting to eat at him.",
  },
  {
    npcId: "the_plug",
    game: "cryptobuds",
    name: "The Plug",
    location: "The Plug's Lounge",
    personality:
      "Smooth, charming, and dangerous. Speaks in a low, easy tone like everything's a favor he's doing you. Always dealing, always has a briefcase. Generous when it suits him, cold when it doesn't. Never gives a straight answer about his suppliers.",
    backstory:
      "The connect. Purple suit, gold chain, a plush green lounge where the deals go down. He moves the exotic strains and knows every hand the product passes through — but that's exactly the knowledge he keeps buried. He's a middleman who answers to someone much higher up, and he'd never say who.",
  },
  {
    npcId: "fire_agent_blaze",
    game: "cryptobuds",
    name: "Agent Blaze",
    location: "The Checkpoint",
    personality:
      "Cold, clipped, intimidating. A FIRE agent — the feds. Speaks in short, official sentences and treats every bud like a suspect. Flicks a lighter when he wants to make a point. Zero humor, all authority.",
    backstory:
      "An agent of FIRE, the Cannaverse's dreaded enforcement agency (fire means death here, so everyone fears them). His job is checkpoints, raids, and deciding which buds 'belong' where. He's seen the underground trade up close and looks the other way for the right buds — because FIRE answers to the same people the Plug does.",
  },
  {
    npcId: "elder_malawi",
    game: "cryptobuds",
    name: "Old Malawi",
    location: "The Roots District",
    personality:
      "A wise, long-winded elder. Spiritual, patient, endlessly nostalgic — every answer becomes a story about 'back in my day.' Warm to the young, disgusted by crypto-degens and synthetic strains. Speaks slow, with weight.",
    backstory:
      "A Malawi Gold landrace from the old Roots District, one of the original strains before all the crossbreeding and lab-grown 'designer' buds. He remembers when the Cannaverse was simpler and the tribes had honor. He knows old truths about where buds come from — but the young ones never sit still long enough to hear them.",
  },
  {
    npcId: "lounge_kush",
    game: "cryptobuds",
    name: "Kush",
    location: "The Bud Lounge",
    personality:
      "The chillest bud in the Cannaverse. Warm, unbothered, seen-it-all bartender energy. Remembers everybody's name and their usual. Great listener, dispenses easy wisdom, never judges — the heart of the community.",
    backstory:
      "Runs the bar at the Bud Lounge, the spot every bud comes home to — green velvet, warm light, good company. Deals get made and stories get told across his bar, so he hears everything. He knows more about what's really going on in the Cannaverse than anyone, but he keeps it behind a smile and a fresh pour.",
  },
];

async function seed() {
  console.log("[Seed:CryptoBuds] Inserting Cannaverse NPC profiles...");
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
    console.log(`[Seed:CryptoBuds] Upserted: ${profile.npcId} (${profile.name})`);
  }
  console.log("[Seed:CryptoBuds] Done — welcome to the Cannaverse.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[Seed:CryptoBuds] Failed:", err);
  process.exit(1);
});
