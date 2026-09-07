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

export async function GET() {
  return NextResponse.json({ settings: getSettings() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE_KEYS.has(k) && typeof v === "string") updates[k] = v;
  }
  setSettings(updates);
  return NextResponse.json({ settings: getSettings() });
}
