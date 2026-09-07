// ============================================================================
// STUDY: Money math as PURE FUNCTIONS — no I/O, no side effects, trivially
// testable. All rates and assumptions come from the settings table, so when
// Google changes prices (and they will), the fix is an admin-page edit.
// ============================================================================
import { numSetting, getSettings } from "./settings";
import { JobMode } from "./types";

// STUDY: Cost of ONE API call. Note the shape: tokens × rate-per-million,
// then a mode-dependent discount. The Batch API's 50% discount is modeled
// here even though calls are per-item in this MVP — the worker's call site
// wouldn't change when real batch submission lands; only where the CALL
// happens moves.
export function callCostUSD(
  tier: 1 | 2,
  mode: JobMode,
  inputTokens: number,
  outputTokens: number
): number {
  const inRate = numSetting(`tier${tier}_input_rate`, tier === 1 ? 0.1 : 1.25);
  const outRate = numSetting(`tier${tier}_output_rate`, tier === 1 ? 0.4 : 10);
  const discount = mode === "batch" ? numSetting("batch_discount", 0.5) : 0;
  const raw = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
  return raw * (1 - discount);
}

// STUDY: Pre-run estimate = (images × expected tokens × Tier-1 rate) +
// (images × expected escalation rate × Tier-2 rate). Same estimates appear in
// the upload UI (so the customer sees cost BEFORE committing) and on the job
// card (so guardrails can compare est vs actual after).
export function estimateJobCostUSD(imageCount: number, mode: JobMode): number {
  const s = getSettings();
  const inTok = Number(s.est_input_tokens_per_image ?? 1105);
  const outTok = Number(s.est_output_tokens_per_image ?? 150);
  const escRate = Number(s.est_escalation_rate ?? 0.1);
  const tier1Count = imageCount;
  const tier2Count = Math.round(imageCount * escRate);
  return (
    callCostUSD(1, mode, tier1Count * inTok, tier1Count * outTok) +
    callCostUSD(2, mode, tier2Count * inTok, tier2Count * outTok)
  );
}
