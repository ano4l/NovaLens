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
  "tier1_model",
  "tier2_model",
  "challenger_model",
  "adjudicator_model",
  "escalation_threshold",
  "tier1_input_rate",
  "tier1_output_rate",
  "tier2_input_rate",
  "tier2_output_rate",
  "batch_discount",
  "est_input_tokens_per_image",
  "est_output_tokens_per_image",
  "est_escalation_rate",
  "guardrail_margin",
  "max_attempts",
  "escalation_rate_alert_high",
]);

const BOUNDS: Record<string, [number, number]> = {
  escalation_threshold: [0, 1],
  tier1_input_rate: [0, 1000],
  tier1_output_rate: [0, 1000],
  tier2_input_rate: [0, 1000],
  tier2_output_rate: [0, 1000],
  batch_discount: [0, 1],
  est_input_tokens_per_image: [1, 1_000_000],
  est_output_tokens_per_image: [1, 100_000],
  est_escalation_rate: [0, 1],
  guardrail_margin: [0, 10],
  max_attempts: [1, 10],
  escalation_rate_alert_high: [0, 1],
};

export async function GET() {
  return NextResponse.json({ settings: getSettings() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE_KEYS.has(k) || typeof v !== "string") continue;
    const cleanValue = v.trim();
    if (k.endsWith("_model")) {
      if (!/^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(cleanValue)) {
        return NextResponse.json({ error: `${k} is not a valid OpenRouter model ID` }, { status: 400 });
      }
    } else if (BOUNDS[k]) {
      const value = Number(cleanValue);
      const [min, max] = BOUNDS[k];
      if (!Number.isFinite(value) || value < min || value > max) {
        return NextResponse.json({ error: `${k} must be between ${min} and ${max}` }, { status: 400 });
      }
    }
    updates[k] = cleanValue;
  }
  setSettings(updates);
  return NextResponse.json({ settings: getSettings() });
}
