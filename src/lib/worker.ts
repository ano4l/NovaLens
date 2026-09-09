// ============================================================================
// STUDY: THE WORKER — the most important file in the project. Learn this file
// and you understand the whole product. Three things to trace:
//   1. tick()         → the polling loop (producer/consumer with a DB as queue)
//   2. processItem()  → one unit of work: call AI, log cost, advance the state
//      machine, escalate on needs_review, retry-with-backoff on failure
//   3. maybeFinishJob() → lifecycle bookkeeping: escalation rate + cost guardrail
// Read it alongside the state diagram in CASE_STUDY.md §3.1.
// ============================================================================
import { getDb, UPLOAD_DIR } from "./db";
import { getVisionClient } from "./vision";
import { callCostUSD } from "./cost";
import { numSetting, getSetting } from "./settings";
import { Item, Job, JobMode } from "./types";
import path from "path";

// STUDY: Deliberately tiny numbers. A real deployment scales by running more
// worker processes/machines against the same queue — the code below doesn't
// change. CONCURRENCY caps how many AI calls are in flight at once; the
// `running` counter in tick() enforces it without any locking library.
const POLL_MS = 1500;
const CONCURRENCY = 2;

let started = false;
let running = 0;

export function startWorker() {
  if (started) return;
  started = true;
  recoverInterruptedItems();
  setInterval(tick, POLL_MS).unref?.();
  console.log("[worker] started");
}

function recoverInterruptedItems() {
  getDb().prepare(
    `UPDATE items
     SET status = CASE WHEN tier IS NULL THEN 'pending' ELSE 'escalated' END,
         next_retry_at = 0,
         updated_at = datetime('now')
     WHERE status = 'processing'`
  ).run();
}

// STUDY: The two SELECTs below form a PRIORITY: Tier-1 pending work is found
// first; only when none exists do we look for Tier-2 escalations. Both queries
// filter on next_retry_at <= now — that's how exponential backoff is expressed
// as data instead of timers.
async function tick() {
  if (running >= CONCURRENCY) return;
  const now = Date.now();
  const db = getDb();

  // Items pending Tier 1, or failed Tier 1 awaiting retry
  const item = db
    .prepare(
      `SELECT * FROM items
       WHERE status IN ('pending') AND next_retry_at <= ?
         AND tier IS NULL
       ORDER BY id ASC
       LIMIT 1`
    )
    .get(now) as Item | undefined;

  // Escalated items awaiting Tier 2
  const escalated = item
    ? undefined
    : (db
        .prepare(
          `SELECT * FROM items
           WHERE status = 'escalated' AND next_retry_at <= ?
           ORDER BY id ASC
           LIMIT 1`
        )
        .get(now) as Item | undefined);

  const target = item ?? escalated;
  if (!target) return;

  // STUDY: No `await` on processItem — we kick it off and return so the next
  // tick can fill the other concurrency slot. The `running` counter is the
  // semaphore. Errors are caught HERE so a single bad item can never kill the
  // loop.
  running++;
  processItem(target)
    .catch((err) => console.error("[worker] unhandled error", err))
    .finally(() => {
      running--;
    });
}

async function processItem(item: Item) {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(item.job_id) as Job;
  const tier: 1 | 2 = item.status === "escalated" ? 2 : 1;
  const mode = job.mode as JobMode;
  const maxAttempts = numSetting("max_attempts", 3);

  db.prepare("UPDATE items SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(
    item.id
  );
  ensureJobProcessing(job.id);

  const { client } = getVisionClient({
    tier1: getSetting("tier1_model") ?? "dots-studio/dots-3-note-preview:free",
    tier2: getSetting("tier2_model") ?? "openrouter/free",
    threshold: numSetting("escalation_threshold", 0.8),
  });

  try {
    // In batch mode we simulate async latency up-front for express-like flow; real
    // Batch API wiring (submit file, poll job) slots in here without changing callers.
    const imagePath = path.join(UPLOAD_DIR, item.image_path);
    const call = await client.tagImage(imagePath, tier);
    const cost = callCostUSD(tier, mode, call.inputTokens, call.outputTokens);

    db.prepare(
      `INSERT INTO api_logs (item_id, job_id, tier, model, mode, input_tokens, output_tokens, cost_usd, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(item.id, item.job_id, tier, call.model, mode, call.inputTokens, call.outputTokens, cost, call.latencyMs);

    // STUDY: THE ROUTING DECISION — the economic core of the product. Tier 1
    // said "I'm not sure" → we save its partial result (so the reviewer sees
    // *something*), then flip the row to 'escalated' and RESET attempts/
    // next_retry_at so the Tier-2 pass starts fresh immediately. Tier 2's
    // result will overwrite these same columns on the next pass.
    if (tier === 1 && call.result.needs_review) {
      db.prepare(
        `UPDATE items SET status = 'escalated', tier = 1, brand = ?, part_name = ?, year_start = ?,
          year_end = ?, condition_notes = ?, confidence = ?, needs_review = 1, raw_json = ?,
          attempts = 0, next_retry_at = 0, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        call.result.brand,
        call.result.part_name,
        call.result.year_start,
        call.result.year_end,
        call.result.condition_notes,
        call.result.confidence,
        JSON.stringify(call.result),
        item.id
      );
    } else {
      db.prepare(
        `UPDATE items SET status = 'tagged', tier = ?, brand = ?, part_name = ?, year_start = ?,
          year_end = ?, condition_notes = ?, confidence = ?, needs_review = ?, raw_json = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        tier,
        call.result.brand,
        call.result.part_name,
        call.result.year_start,
        call.result.year_end,
        call.result.condition_notes,
        call.result.confidence,
        call.result.needs_review ? 1 : 0,
        JSON.stringify(call.result),
        item.id
      );
    }
  } catch (err) {
    // STUDY: Failure handling in three moves:
    //   1. log the error to api_logs (observability — you can't fix what you can't see)
    //   2. either requeue with exponential backoff (1000×2^attempts ms, capped)
    //   3. or, after max_attempts, dead-letter as 'needs_manual' for a human.
    // Note we put the row back in the queue it came FROM (pending vs escalated)
    // so a Tier-2 failure never causes a duplicate Tier-1 call.
    const message = err instanceof Error ? err.message : String(err);
    const attempts = item.attempts + 1;
    const exhausted = attempts >= maxAttempts;
    const backoff = Math.min(60000, 1000 * 2 ** attempts);
    db.prepare(
      `INSERT INTO api_logs (item_id, job_id, tier, model, mode, error, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    ).run(item.id, item.job_id, tier, "error", mode, message);
    db.prepare(
      `UPDATE items SET status = ?, attempts = ?, next_retry_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      exhausted ? "needs_manual" : item.status === "escalated" ? "escalated" : "pending",
      attempts,
      Date.now() + backoff,
      item.id
    );
  }

  maybeFinishJob(job.id);
}

function ensureJobProcessing(jobId: number) {
  getDb()
    .prepare("UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'queued'")
    .run(jobId);
}

// STUDY: Called after EVERY item. Cheap because of the index on
// (job_id, status). When nothing actionable remains, the job flips to 'review'
// and the GUARDRAILS run: compare actual spend vs. estimate, and check that
// the escalation rate stayed in its expected band. Both are "alert, don't
// silently bleed money" mechanisms.
function maybeFinishJob(jobId: number) {
  const db = getDb();
  const remaining = db
    .prepare("SELECT COUNT(*) as c FROM items WHERE job_id = ? AND status IN ('pending', 'processing', 'escalated')")
    .get(jobId) as { c: number };
  if (remaining.c > 0) return;

  const tagged = db
    .prepare("SELECT COUNT(*) as c FROM items WHERE job_id = ? AND tier = 2")
    .get(jobId) as { c: number };
  const total = db
    .prepare("SELECT COUNT(*) as c FROM items WHERE job_id = ?")
    .get(jobId) as { c: number };
  const escalationRate = total.c > 0 ? tagged.c / total.c : 0;

  const actual = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) as cost FROM api_logs WHERE job_id = ?")
    .get(jobId) as { cost: number };
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job;
  const margin = numSetting("guardrail_margin", 0.25);
  const breached =
    job.est_cost_usd != null && actual.cost > job.est_cost_usd * (1 + margin) ? 1 : 0;
  const escAlert = escalationRate > numSetting("escalation_rate_alert_high", 0.25) ? 1 : 0;

  db.prepare(
    `UPDATE jobs SET status = 'review', escalation_rate = ?, guardrail_breached = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(escalationRate, breached || escAlert, jobId);
}
