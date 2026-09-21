// ============================================================================
// STUDY: Config API. The critical line is the EDITABLE_KEYS allowlist below:
// the body is filtered through it, so a client cannot invent settings keys or
// overwrite internal ones. Same lesson as the EDITABLE list in items/[id] —
// allowlists on every write.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getSettings, setSettings } from "@/lib/settings";

export const runtime = "nodejs";

const EDITABLE_KEYS = new Set([
  "max_attempts",
  "escalation_rate_alert_high",
]);

const BOUNDS: Record<string, [number, number]> = {
  max_attempts: [1, 10],
  escalation_rate_alert_high: [0, 1],
};

export async function GET() {
  return NextResponse.json({ settings: await getSettings() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE_KEYS.has(k) || typeof v !== "string") continue;
    const cleanValue = v.trim();
    if (BOUNDS[k]) {
      const value = Number(cleanValue);
      const [min, max] = BOUNDS[k];
      if (!Number.isFinite(value) || value < min || value > max) {
        return NextResponse.json({ error: `${k} must be between ${min} and ${max}` }, { status: 400 });
      }
    }
    updates[k] = cleanValue;
  }
  await setSettings(updates);
  return NextResponse.json({ settings: await getSettings() });
}
