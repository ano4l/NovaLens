import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";

export async function enforceRateLimit(req: NextRequest, scope: string, limit: number, windowMs = 60 * 60 * 1000) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const identity = forwarded || req.headers.get("x-real-ip") || "unknown";
  const digest = crypto.createHash("sha256").update(`${scope}:${identity}`).digest("hex").slice(0, 32);
  const key = `${scope}:${digest}`;
  const now = Date.now();
  const db = await getDb();
  const { rows } = await db.query<{ request_count: number; window_started: number }>(
    `INSERT INTO request_limits (key, request_count, window_started) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       request_count = CASE WHEN request_limits.window_started < $3 THEN 1 ELSE request_limits.request_count + 1 END,
       window_started = CASE WHEN request_limits.window_started < $3 THEN $2 ELSE request_limits.window_started END
     RETURNING request_count, window_started`,
    [key, now, now - windowMs]
  );
  const row = rows[0];
  if (row.request_count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((Number(row.window_started) + windowMs - now) / 1000));
  return NextResponse.json(
    { error: "Too many requests. Please wait before trying again." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}
