export interface GameFlags {
  badges: number;
  has_surf?: boolean;
  has_fly?: boolean;
  current_town?: string;
  /** The character's OWN identity, which is not the persona's — five personas cover 301 buds. */
  npc_name?: string;
  npc_place?: string;
  act?: number;
  [key: string]: unknown;
}

export interface ChatRequest {
  session_id: string;
  npc_id: string;
  game: string;
  player_message: string;
  game_flags: GameFlags;
}

export interface ChatResponse {
  response: string;
  npc_id: string;
  session_id: string;
}

export interface SessionRequest {
  player_name: string;
  game: string;
}

export interface NpcProfileRequest {
  npc_id: string;
  game: string;
  name: string;
  location: string;
  personality: string;
  backstory: string;
}
