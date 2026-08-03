/**
 * Guards for a public, unauthenticated game API.
 *
 * Every /npc/chat hits OpenAI, so an open endpoint is somebody else's bill. Three layers,
 * cheapest first:
 *   1. hard input caps      — a 1MB "message" never reaches the model
 *   2. per-IP rate limiting — a script can't sit on the endpoint
 *   3. an admin key         — writes to NPC profiles aren't a public feature
 *
 * The limiter is in-process, so on serverless it is per-instance and resets on cold
 * start. That is deliberately not the only defence: the input caps and max_tokens bound
 * the cost of any single request no matter how the limiter is bypassed.
 */
import type { Request, Response, NextFunction } from "express";

export const LIMITS = {
  message: 500,     // a dialogue box holds far less than this
  id: 120,
  name: 60,
  text: 2000,      // profile prose
  flags: 60,       // game_flags keys
};

/** Trim a client string to a sane length, or reject it if it isn't a string. */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

interface Bucket { hits: number[]; }
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const HOUR_MS = 3_600_000;

function clientKey(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = Array.isArray(fwd) ? fwd[0] : (fwd ?? "").split(",")[0].trim();
  return ip || req.socket.remoteAddress || "unknown";
}

/** Sliding-window limiter: `perMin` in any 60s and `perHour` in any 3600s. */
export function rateLimit(perMin: number, perHour: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = clientKey(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) { b = { hits: [] }; buckets.set(key, b); }
    b.hits = b.hits.filter((t) => now - t < HOUR_MS);

    const lastMin = b.hits.filter((t) => now - t < WINDOW_MS).length;
    if (lastMin >= perMin || b.hits.length >= perHour) {
      res.status(429).json({ error: "Slow down — too many requests. Try again in a minute." });
      return;
    }
    b.hits.push(now);

    // keep the map from growing without bound on a long-lived instance
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) {
        if (!v.hits.some((t) => now - t < HOUR_MS)) buckets.delete(k);
        if (buckets.size <= 4000) break;
      }
    }
    next();
  };
}

/** Writes are not a public feature. Set ADMIN_KEY to enable them at all. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) {
    res.status(503).json({ error: "Admin operations are disabled on this deployment." });
    return;
  }
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  // constant-length compare so the key can't be probed a character at a time
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only echo back flags we understand — never forward arbitrary client objects to a model. */
export function safeFlags(v: unknown): { badges: number; [k: string]: unknown } {
  const out: { badges: number; [k: string]: unknown } = { badges: 0 };
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n++ >= LIMITS.flags) break;
    if (typeof k !== "string" || k.length > 60) continue;
    if (typeof val === "string") out[k] = val.slice(0, 120);
    else if (typeof val === "number" || typeof val === "boolean") out[k] = val;
  }
  out.badges = typeof out.badges === "number" ? out.badges : 0;
  return out;
}
