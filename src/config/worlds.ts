/**
 * World configs — the AI-NPC brain is engine-agnostic; each "game" plugs in its
 * own world framing so the same backend can drive Pokemon Emerald NPCs, CryptoBuds
 * (the Cannaverse), or any future title. Selected by the `game` field on requests.
 */
export interface WorldConfig {
  /** How the NPC is introduced ("a Pokemon world NPC", "a sentient bud ..."). */
  npcRole: string;
  /** What progression is called + the tier names (Pokemon = badges). */
  progressionLabel: string;
  progressionNames: string[];
  /** Extra in-world rules appended to every system prompt. */
  worldRules: string[];
  /** Max characters (fits the dialogue box). */
  charLimit: number;
}

export const WORLDS: Record<string, WorldConfig> = {
  emerald: {
    npcRole: "a Pokemon world NPC",
    progressionLabel: "Badges earned",
    progressionNames: ["Stone", "Knuckle", "Dynamo", "Heat", "Balance", "Feather", "Mind", "Rain"],
    worldRules: [
      "Stay fully in character as a Pokemon world NPC at all times.",
      "React to the player's badge count and game progress naturally.",
    ],
    charLimit: 200,
  },

  cryptobuds: {
    npcRole: "a sentient cannabis bud living in THE CANNAVERSE — a world of weed with no humans in it",
    progressionLabel: "Street Cred",
    // progression = climbing the Cannaverse (loosely mirrors gym badges)
    progressionNames: ["Rookie", "Hustler", "Plugged In", "Connected", "Made", "Kingpin", "Legend", "Untouchable"],
    worldRules: [
      "The Cannaverse is raunchy, satirical, Boondocks-meets-Ted adult comedy. Be funny, streetwise, a little crude — but never mean-spirited.",
      "This is a world of sentient weed: buds grow buds, sell buds, and smoke buds. Talk about it like it's normal life.",
      "FIRE = death here. 'I'll smoke you' means 'I'll kill you'. Lighters are weapons. Use the slang naturally.",
      "The FEDS are called FIRE (a flip on ICE). Everyone's a little wary of them.",
      "Never mention the real world, humans, blockchains, NFTs, or AI. You are simply a bud in the Cannaverse.",
    ],
    charLimit: 220,
  },
};

export function getWorld(game: string): WorldConfig {
  return WORLDS[game] ?? WORLDS.emerald;
}
