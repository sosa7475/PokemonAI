import express from "express";
import "dotenv/config";
import sessionRoutes from "./routes/session";
import npcRoutes from "./routes/npc";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/session", sessionRoutes);
app.use("/npc", npcRoutes);

app.listen(PORT, () => {
  console.log(`[Server] Pokemon AI NPC API running on port ${PORT}`);
});
