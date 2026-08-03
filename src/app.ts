import express from "express";
import "dotenv/config";
import sessionRoutes from "./routes/session";
import npcRoutes from "./routes/npc";
import { hasDb } from "./db";

const app = express();
app.use(express.json());

// CORS — the browser game calls this API cross-origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.get("/", (_req, res) => res.json({ name: "CryptoBuds AI-NPC API", memory: hasDb ? "on" : "off" }));
app.get("/health", (_req, res) => res.json({ status: "ok", memory: hasDb ? "on" : "off" }));

app.use("/session", sessionRoutes);
app.use("/npc", npcRoutes);

export default app;
