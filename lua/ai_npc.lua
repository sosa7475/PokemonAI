-- AI NPC Bridge for Pokemon Emerald (BizHawk)
-- Polls game memory for dialogue triggers and routes them through the AI NPC API

local API_URL = "http://localhost:3000"
local SESSION_ID = nil
local PLAYER_NAME = "Player"
local GAME = "emerald"
local COOLDOWN_FRAMES = 180 -- 3 seconds at 60fps
local POLL_INTERVAL = 30   -- check every 30 frames

-- Memory addresses (Pokemon Emerald US)
local ADDR_DIALOGUE_FLAG = 0x020370C0
local ADDR_NPC_ID        = 0x02037000
local ADDR_BADGES        = 0x020297C7
local ADDR_PLAYER_NAME   = 0x02024190
local ADDR_TEXT_BUFFER    = 0x0203A1C4

local frame_counter = 0
local cooldown_timer = 0
local initialized = false

-- Pokemon Emerald character encoding table (subset)
local CHAR_TABLE = {
  [0xBB] = "A", [0xBC] = "B", [0xBD] = "C", [0xBE] = "D", [0xBF] = "E",
  [0xC0] = "F", [0xC1] = "G", [0xC2] = "H", [0xC3] = "I", [0xC4] = "J",
  [0xC5] = "K", [0xC6] = "L", [0xC7] = "M", [0xC8] = "N", [0xC9] = "O",
  [0xCA] = "P", [0xCB] = "Q", [0xCC] = "R", [0xCD] = "S", [0xCE] = "T",
  [0xCF] = "U", [0xD0] = "V", [0xD1] = "W", [0xD2] = "X", [0xD3] = "Y",
  [0xD4] = "Z",
  [0xD5] = "a", [0xD6] = "b", [0xD7] = "c", [0xD8] = "d", [0xD9] = "e",
  [0xDA] = "f", [0xDB] = "g", [0xDC] = "h", [0xDD] = "i", [0xDE] = "j",
  [0xDF] = "k", [0xE0] = "l", [0xE1] = "m", [0xE2] = "n", [0xE3] = "o",
  [0xE4] = "p", [0xE5] = "q", [0xE6] = "r", [0xE7] = "s", [0xE8] = "t",
  [0xE9] = "u", [0xEA] = "v", [0xEB] = "w", [0xEC] = "x", [0xED] = "y",
  [0xEE] = "z",
  [0xA1] = "0", [0xA2] = "1", [0xA3] = "2", [0xA4] = "3", [0xA5] = "4",
  [0xA6] = "5", [0xA7] = "6", [0xA8] = "7", [0xA9] = "8", [0xAA] = "9",
  [0xAB] = "!", [0xAC] = "?", [0xAD] = ".", [0xB0] = "-",
  [0x00] = " ",
}

-- Reverse lookup: ASCII char -> GBA byte
local REVERSE_CHAR = {}
for byte, char in pairs(CHAR_TABLE) do
  REVERSE_CHAR[char] = byte
end
REVERSE_CHAR[" "] = 0x00
REVERSE_CHAR[","] = 0xB8
REVERSE_CHAR["'"] = 0xB4

--- Read the player name from game memory
local function read_player_name()
  local name = ""
  for i = 0, 6 do
    local byte = memory.read_u8(ADDR_PLAYER_NAME + i)
    if byte == 0xFF then break end
    name = name .. (CHAR_TABLE[byte] or "?")
  end
  return name
end

--- Get badge count from the badge bitmask byte
local function get_badge_count()
  local badge_byte = memory.read_u8(ADDR_BADGES)
  local count = 0
  for i = 0, 7 do
    if bit.band(badge_byte, bit.lshift(1, i)) ~= 0 then
      count = count + 1
    end
  end
  return count
end

--- Read the NPC ID from memory (2 bytes)
local function read_npc_id()
  local id = memory.read_u16_le(ADDR_NPC_ID)
  return string.format("npc_%04X", id)
end

--- Write a string into the GBA text buffer using Pokemon encoding
local function write_to_text_buffer(text)
  for i = 1, #text do
    local char = text:sub(i, i)
    local byte = REVERSE_CHAR[char] or 0x00
    memory.write_u8(ADDR_TEXT_BUFFER + (i - 1), byte)
  end
  -- Write end-of-string terminator
  memory.write_u8(ADDR_TEXT_BUFFER + #text, 0xFF)
end

--- JSON encode a simple table (flat, no nested tables of tables)
local function json_encode(tbl)
  local parts = {}
  for k, v in pairs(tbl) do
    local key = '"' .. tostring(k) .. '"'
    local val
    if type(v) == "string" then
      val = '"' .. v:gsub('"', '\\"') .. '"'
    elseif type(v) == "boolean" then
      val = v and "true" or "false"
    else
      val = tostring(v)
    end
    table.insert(parts, key .. ":" .. val)
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

--- Simple JSON string value extraction
local function json_get_string(json_str, key)
  local pattern = '"' .. key .. '"%s*:%s*"([^"]*)"'
  return json_str:match(pattern)
end

--- HTTP POST helper using BizHawk comm library
local function http_post(url, body)
  comm.httpSetPostUrl(url)
  comm.httpSetRequest(body)
  local response = comm.httpPost()
  return response
end

--- Create a new session via the API
local function create_session()
  local body = json_encode({
    player_name = PLAYER_NAME,
    game = GAME,
  })
  console.log("[AI NPC] Creating session for " .. PLAYER_NAME)

  local ok, response = pcall(http_post, API_URL .. "/session", body)
  if ok and response then
    local sid = json_get_string(response, "session_id")
    if sid then
      SESSION_ID = sid
      console.log("[AI NPC] Session created: " .. SESSION_ID)
      return true
    end
  end
  console.log("[AI NPC] Failed to create session")
  return false
end

--- Send a chat message to the NPC API
local function chat_with_npc(npc_id, message, game_flags)
  if not SESSION_ID then
    console.log("[AI NPC] No session, skipping chat")
    return nil
  end

  local body = json_encode({
    session_id = SESSION_ID,
    npc_id = npc_id,
    game = GAME,
    player_message = message,
    game_flags = json_encode(game_flags),
  })

  console.log("[AI NPC] Chatting with " .. npc_id)

  local ok, response = pcall(http_post, API_URL .. "/npc/chat", body)
  if ok and response then
    local npc_response = json_get_string(response, "response")
    if npc_response then
      console.log("[AI NPC] Response: " .. npc_response)
      return npc_response
    end
  end
  console.log("[AI NPC] Chat request failed")
  return nil
end

--- Initialize on first run
local function initialize()
  if initialized then return end
  console.log("[AI NPC] Pokemon Emerald AI NPC Bridge v1.0")
  console.log("[AI NPC] API endpoint: " .. API_URL)

  PLAYER_NAME = read_player_name()
  if PLAYER_NAME == "" then
    PLAYER_NAME = "Player"
  end
  console.log("[AI NPC] Player name: " .. PLAYER_NAME)

  create_session()
  initialized = true
end

--- Main loop - runs every frame
local function main_loop()
  frame_counter = frame_counter + 1

  -- Decrement cooldown
  if cooldown_timer > 0 then
    cooldown_timer = cooldown_timer - 1
    return
  end

  -- Only check every POLL_INTERVAL frames
  if frame_counter % POLL_INTERVAL ~= 0 then return end

  -- Check the dialogue trigger flag
  local trigger = memory.read_u8(ADDR_DIALOGUE_FLAG)
  if trigger == 0 then return end

  console.log("[AI NPC] Dialogue trigger detected!")

  -- Read game state
  local npc_id = read_npc_id()
  local badges = get_badge_count()

  local game_flags = {
    badges = badges,
  }

  -- Send to API
  local response = chat_with_npc(npc_id, "hello", game_flags)

  if response then
    write_to_text_buffer(response)
    console.log("[AI NPC] Wrote " .. #response .. " chars to text buffer")
  else
    write_to_text_buffer("...")
  end

  -- Clear trigger flag and set cooldown
  memory.write_u8(ADDR_DIALOGUE_FLAG, 0)
  cooldown_timer = COOLDOWN_FRAMES
end

-- Entry point
initialize()

-- Register the main loop to run each frame
event.onframeend(main_loop)
console.log("[AI NPC] Script loaded and running")
