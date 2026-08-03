import app from "./app";
import { hasDb } from "./db";

// Local / container server (Vercel uses api/index.ts instead of listening).
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[Server] CryptoBuds AI-NPC API on port ${PORT} — memory ${hasDb ? "ON" : "OFF (no DATABASE_URL)"}`);
});
