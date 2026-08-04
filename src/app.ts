import express from "express";
import "dotenv/config";
import sessionRoutes from "./routes/session";
import npcRoutes from "./routes/npc";
import accountRoutes from "./routes/account";
import metricsRoutes from "./routes/metrics";
import { hasDb } from "./db";

const app = express();
app.use(express.json({ limit: "700kb" }));   // saves ride in the body; the route caps them at 512kb

// CORS — the browser game calls this API cross-origin
// CORS_ORIGIN takes a comma-separated allowlist; "*" only if it is set to that explicitly
const ALLOWED = (process.env.CORS_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  const allow = ALLOWED.length === 0 || ALLOWED.includes("*")
    ? "*"
    : ALLOWED.includes(origin) ? origin : "";
  if (!allow && req.method === "OPTIONS") { res.sendStatus(403); return; }
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Origin", allow || ALLOWED[0]);
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

app.get("/", (_req, res) => res.json({ name: "CryptoBuds AI-NPC API", memory: hasDb ? "on" : "off" }));
app.get("/health", (_req, res) => res.json({ status: "ok", memory: hasDb ? "on" : "off" }));

app.use("/session", sessionRoutes);
app.use("/npc", npcRoutes);
app.use("/account", accountRoutes);
app.use("/metrics", metricsRoutes);

export default app;
