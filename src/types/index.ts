export interface GameFlags {
  badges: number;
  has_surf?: boolean;
  has_fly?: boolean;
  current_town?: string;
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
