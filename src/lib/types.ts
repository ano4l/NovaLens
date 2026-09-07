// ============================================================================
// STUDY: This file is the contract for the whole app. Every other file — the
// database schema, the worker, the API routes, the UI — speaks in these types.
// Read this first: it is the domain model condensed into one screen.
// ============================================================================

// STUDY: String-literal union types like this are TypeScript's way of saying
// "this value can only be one of these exact strings." Typo 'bach' → compile
// error. This is how you make illegal states unrepresentable.
export type JobMode = "batch" | "express";
export type JobStatus = "queued" | "processing" | "review" | "exporting" | "done";
// STUDY: This union IS the state machine of the pipeline. Every item moves
// through these statuses exactly like the diagram in CASE_STUDY.md §3.1.
// Notice there is no "failed→retry" status: retries reuse 'pending'/'escalated'
// plus the `attempts` counter, which keeps the state space small.
export type ItemStatus =
  | "pending"
  | "processing"
  | "tagged"
  | "escalated"
  | "failed"
  | "needs_manual"
  | "approved"
  | "rejected"
  | "flagged_rephoto";

export type Confidence = "high" | "medium" | "low";

export interface Job {
  id: number;
  name: string;
  mode: JobMode;
  status: JobStatus;
  image_count: number;
  est_cost_usd: number | null;
  escalation_rate: number | null;
  guardrail_breached: number;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: number;
  job_id: number;
  filename: string;
  image_path: string;
  status: ItemStatus;
  // STUDY: Everything below `status` is nullable because the AI may not know
  // (or may not have run yet). `null` here means "unknown", not "empty" — an
  // important semantic distinction the UI relies on to show "—".
  brand: string | null;
  part_name: string | null;
  year_start: number | null;
  year_end: number | null;
  condition_notes: string | null;
  confidence: Confidence | null;
  needs_review: number;
  tier: number | null;
  raw_json: string | null;
  // STUDY: Retry bookkeeping lives ON the row. `next_retry_at` is a unix
  // timestamp; the worker only picks up rows whose retry time has passed.
  // Persisting this (rather than keeping timers in memory) means a server
  // restart loses nothing.
  attempts: number;
  next_retry_at: number;
  created_at: string;
  updated_at: string;
}

export interface ApiLog {
  id: number;
  item_id: number;
  job_id: number;
  tier: number;
  model: string;
  mode: JobMode;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  error: string | null;
  created_at: string;
}

export interface EditLog {
  id: number;
  item_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  edited_by: string;
  created_at: string;
}

// STUDY: This shape mirrors the responseSchema in vision.ts field-for-field.
// When you integrate an external API, define YOUR OWN type for its payload and
// convert at the boundary. If Google changes the wire format someday, you fix
// one file (vision.ts), not the whole app.
export interface TagResult {
  brand: string;
  part_name: string;
  year_start: number | null;
  year_end: number | null;
  condition_notes: string;
  confidence: Confidence;
  needs_review: boolean;
}

export interface TagCallResult {
  result: TagResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}
