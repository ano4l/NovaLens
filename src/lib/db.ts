// ============================================================================
// STUDY: The persistence boundary. Production uses Supabase Postgres through
// DATABASE_URL; the schema is created idempotently on first use so a fresh
// project can deploy without a hand-edited SQL console migration.
// ============================================================================
import { Pool, QueryResultRow } from "pg";
import fs from "fs";
import os from "os";
import path from "path";

const DATA_DIR = path.resolve(
  process.env.NOVALENS_DATA_DIR?.trim() ||
    (process.env.VERCEL ? path.join(os.tmpdir(), "novalens") : path.join(process.cwd(), "data"))
);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
export { DATA_DIR, UPLOAD_DIR };

const globalForDb = globalThis as unknown as {
  __novalensPool?: Pool;
  __novalensSchema?: Promise<void>;
};

function createPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Add the Supabase Postgres connection string to the server environment.");
  }
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
}

export async function getDb(): Promise<Pool> {
  if (!globalForDb.__novalensPool) globalForDb.__novalensPool = createPool();
  if (!globalForDb.__novalensSchema) globalForDb.__novalensSchema = migrate(globalForDb.__novalensPool);
  await globalForDb.__novalensSchema;
  return globalForDb.__novalensPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  const db = await getDb();
  return db.query<T>(text, values);
}

async function migrate(db: Pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'batch',
      status TEXT NOT NULL DEFAULT 'queued', image_count INTEGER NOT NULL DEFAULT 0,
      est_cost_usd DOUBLE PRECISION, escalation_rate DOUBLE PRECISION,
      guardrail_breached INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, image_path TEXT NOT NULL, cutout_path TEXT,
      background_status TEXT NOT NULL DEFAULT 'legacy', status TEXT NOT NULL DEFAULT 'pending',
      brand TEXT, part_name TEXT, year_start INTEGER, year_end INTEGER, condition_notes TEXT,
      confidence TEXT, needs_review INTEGER NOT NULL DEFAULT 0, tier INTEGER, raw_json TEXT,
      field_reviews TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_retry_at BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_items_job ON items(job_id, status);
    CREATE INDEX IF NOT EXISTS idx_items_pending ON items(status, next_retry_at);
    CREATE TABLE IF NOT EXISTS api_logs (
      id SERIAL PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, tier INTEGER NOT NULL,
      model TEXT NOT NULL, mode TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_api_logs_job ON api_logs(job_id);
    CREATE TABLE IF NOT EXISTS edit_log (
      id SERIAL PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      field TEXT NOT NULL, old_value TEXT, new_value TEXT,
      edited_by TEXT NOT NULL DEFAULT 'manager', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ALTER TABLE items ADD COLUMN IF NOT EXISTS cutout_path TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS background_status TEXT NOT NULL DEFAULT 'legacy';
    ALTER TABLE items ADD COLUMN IF NOT EXISTS field_reviews TEXT;
  `);

  const settings = {
    tier1_model: "qwen/qwen3-vl-235b-a22b-instruct", tier2_model: "google/gemini-3.1-pro-preview",
    challenger_model: "qwen/qwen3-vl-235b-a22b-thinking", adjudicator_model: "openai/gpt-5.4-mini",
    escalation_threshold: "0.8", tier1_input_rate: "0", tier1_output_rate: "0", tier2_input_rate: "0",
    tier2_output_rate: "0", batch_discount: "0", est_input_tokens_per_image: "1105",
    est_output_tokens_per_image: "150", est_escalation_rate: "0.10", guardrail_margin: "0.25",
    max_attempts: "3", escalation_rate_alert_high: "0.25",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [key, value]);
  }
}
