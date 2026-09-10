// ============================================================================
// STUDY: The worker consumes the Supabase-backed queue. It keeps the same
// state machine as the original file-backed implementation, but every database
// operation is awaited so serverless requests never hold a fake sync handle.
// ============================================================================
import { getDb, UPLOAD_DIR } from "./db";
import { getVisionClient } from "./vision";
import { callCostUSD } from "./cost";
import { numSetting, getSetting } from "./settings";
import { Item, Job, JobMode } from "./types";
import path from "path";
import { buildFieldAssessments } from "./recognition";
import { removeBackgroundFromStoredImage } from "./preprocess";

const POLL_MS = 1500;
const CONCURRENCY = 2;
let started = false;
let running = 0;

export function startWorker() {
  if (started) return;
  started = true;
  void recoverInterruptedItems().catch((error) => console.error("[worker] recovery failed", error));
  setInterval(() => void tick(), POLL_MS).unref?.();
  console.log("[worker] started");
}

async function recoverInterruptedItems() {
  const db = await getDb();
  await db.query(`UPDATE items SET status = CASE WHEN tier IS NULL THEN 'pending' ELSE 'escalated' END,
    next_retry_at = 0, updated_at = NOW() WHERE status = 'processing'`);
}

async function tick() {
  if (running >= CONCURRENCY) return;
  const db = await getDb();
  const now = Date.now();
  const pending = await db.query<Item>(`SELECT * FROM items WHERE status = 'pending'
    AND next_retry_at <= $1 AND tier IS NULL ORDER BY id ASC LIMIT 1`, [now]);
  const escalated = pending.rows[0]
    ? undefined
    : (await db.query<Item>(`SELECT * FROM items WHERE status = 'escalated'
      AND next_retry_at <= $1 ORDER BY id ASC LIMIT 1`, [now])).rows[0];
  const target = pending.rows[0] ?? escalated;
  if (!target) return;
  running++;
  void processItem(target).catch((error) => console.error("[worker] unhandled error", error)).finally(() => { running--; });
}

async function processItem(item: Item) {
  const db = await getDb();
  const { rows: jobRows } = await db.query<Job>("SELECT * FROM jobs WHERE id = $1", [item.job_id]);
  const job = jobRows[0];
  if (!job) return;
  const tier: 1 | 2 = item.status === "escalated" ? 2 : 1;
  const mode = job.mode as JobMode;
  const maxAttempts = await numSetting("max_attempts", 3);
  await db.query("UPDATE items SET status = 'processing', updated_at = NOW() WHERE id = $1", [item.id]);
  await ensureJobProcessing(job.id);

  const { client } = getVisionClient({
    tier1: await getSetting("tier1_model") ?? "qwen/qwen3-vl-235b-a22b-instruct",
    tier2: await getSetting("tier2_model") ?? "google/gemini-3.1-pro-preview",
    challenger: await getSetting("challenger_model") ?? "qwen/qwen3-vl-235b-a22b-thinking",
    adjudicator: await getSetting("adjudicator_model") ?? "openai/gpt-5.4-mini",
    threshold: await numSetting("escalation_threshold", 0.8),
  });

  try {
    if (item.background_status === "pending") {
      const background = await removeBackgroundFromStoredImage(item.image_path);
      await db.query("UPDATE items SET cutout_path = $1, background_status = $2, updated_at = NOW() WHERE id = $3",
        [background.cutoutPath, background.backgroundStatus, item.id]);
    }
    const call = await client.tagImage(path.join(UPLOAD_DIR, item.image_path), tier);
    const threshold = await numSetting("escalation_threshold", 0.8);
    const fieldReviews = JSON.stringify(buildFieldAssessments(call.result, call.model, threshold));
    const cost = call.costUsd ?? await callCostUSD(tier, mode, call.inputTokens, call.outputTokens);
    await db.query(`INSERT INTO api_logs (item_id, job_id, tier, model, mode, input_tokens, output_tokens, cost_usd, latency_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [item.id, item.job_id, tier, call.model, mode, call.inputTokens, call.outputTokens, cost, call.latencyMs]);

    if (tier === 1 && call.result.needs_review) {
      await db.query(`UPDATE items SET status = 'escalated', tier = 1, brand = $1, part_name = $2, year_start = $3,
        year_end = $4, condition_notes = $5, confidence = $6, needs_review = 1, raw_json = $7, field_reviews = $8,
        attempts = 0, next_retry_at = 0, updated_at = NOW() WHERE id = $9`,
        [call.result.brand, call.result.part_name, call.result.year_start, call.result.year_end, call.result.condition_notes,
          call.result.confidence, JSON.stringify(call.result), fieldReviews, item.id]);
    } else {
      await db.query(`UPDATE items SET status = 'tagged', tier = $1, brand = $2, part_name = $3, year_start = $4,
        year_end = $5, condition_notes = $6, confidence = $7, needs_review = $8, raw_json = $9, field_reviews = $10,
        updated_at = NOW() WHERE id = $11`,
        [tier, call.result.brand, call.result.part_name, call.result.year_start, call.result.year_end,
          call.result.condition_notes, call.result.confidence, call.result.needs_review ? 1 : 0,
          JSON.stringify(call.result), fieldReviews, item.id]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = item.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    const backoff = Math.min(60000, 1000 * 2 ** attempts);
    await db.query(`INSERT INTO api_logs (item_id, job_id, tier, model, mode, error, latency_ms)
      VALUES ($1, $2, $3, $4, $5, $6, 0)`, [item.id, item.job_id, tier, "error", mode, message]);
    await db.query(`UPDATE items SET status = $1, attempts = $2, next_retry_at = $3, updated_at = NOW() WHERE id = $4`,
      [exhausted ? "needs_manual" : item.status === "escalated" ? "escalated" : "pending", attempts, Date.now() + backoff, item.id]);
  }
  await maybeFinishJob(job.id);
}

async function ensureJobProcessing(jobId: number) {
  const db = await getDb();
  await db.query("UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'queued'", [jobId]);
}

async function maybeFinishJob(jobId: number) {
  const db = await getDb();
  const remaining = await db.query<{ c: number }>("SELECT COUNT(*)::int as c FROM items WHERE job_id = $1 AND status IN ('pending', 'processing', 'escalated')", [jobId]);
  if ((remaining.rows[0]?.c ?? 0) > 0) return;
  const tagged = await db.query<{ c: number }>("SELECT COUNT(*)::int as c FROM items WHERE job_id = $1 AND tier = 2", [jobId]);
  const total = await db.query<{ c: number }>("SELECT COUNT(*)::int as c FROM items WHERE job_id = $1", [jobId]);
  const escalationRate = (total.rows[0]?.c ?? 0) > 0 ? (tagged.rows[0]?.c ?? 0) / total.rows[0].c : 0;
  const actual = await db.query<{ cost: number }>("SELECT COALESCE(SUM(cost_usd), 0)::float8 as cost FROM api_logs WHERE job_id = $1", [jobId]);
  const { rows: jobs } = await db.query<Job>("SELECT * FROM jobs WHERE id = $1", [jobId]);
  const job = jobs[0];
  if (!job) return;
  const margin = await numSetting("guardrail_margin", 0.25);
  const breached = job.est_cost_usd != null && actual.rows[0].cost > job.est_cost_usd * (1 + margin) ? 1 : 0;
  const escAlert = escalationRate > await numSetting("escalation_rate_alert_high", 0.25) ? 1 : 0;
  await db.query("UPDATE jobs SET status = 'review', escalation_rate = $1, guardrail_breached = $2, updated_at = NOW() WHERE id = $3",
    [escalationRate, breached || escAlert, jobId]);
}
