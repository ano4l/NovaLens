// ============================================================================
// STUDY: The persistence boundary. Production uses Supabase Postgres through
// DATABASE_URL; the schema is created idempotently on first use so a fresh
// project can deploy without a hand-edited SQL console migration.
// ============================================================================
import { Pool, QueryResultRow } from "pg";

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
    CREATE TABLE IF NOT EXISTS item_images (
      item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      image_data BYTEA NOT NULL, image_content_type TEXT NOT NULL DEFAULT 'image/jpeg',
      cutout_data BYTEA, cutout_content_type TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE TABLE IF NOT EXISTS request_limits (
      key TEXT PRIMARY KEY, request_count INTEGER NOT NULL DEFAULT 0,
      window_started BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS training_guidelines (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, instruction TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'general', priority INTEGER NOT NULL DEFAULT 50,
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_training_guidelines_active ON training_guidelines(active, priority DESC);
    CREATE TABLE IF NOT EXISTS training_examples (
      id SERIAL PRIMARY KEY, item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL, field TEXT NOT NULL,
      previous_ai_value TEXT, corrected_value TEXT, image_path TEXT, reviewer TEXT NOT NULL DEFAULT 'manager',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_training_examples_field_created ON training_examples(field, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_training_examples_job ON training_examples(job_id);
    CREATE TABLE IF NOT EXISTS upload_feedback (
      id SERIAL PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      item_id INTEGER REFERENCES items(id) ON DELETE SET NULL, category TEXT NOT NULL,
      note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      submitted_by TEXT NOT NULL DEFAULT 'operator', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_upload_feedback_created ON upload_feedback(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_upload_feedback_job ON upload_feedback(job_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_limits_window ON request_limits(window_started);
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workflow_mode TEXT NOT NULL DEFAULT 'production';
    ALTER TABLE items ADD COLUMN IF NOT EXISTS cutout_path TEXT;
    ALTER TABLE items ADD COLUMN IF NOT EXISTS background_status TEXT NOT NULL DEFAULT 'legacy';
    ALTER TABLE items ADD COLUMN IF NOT EXISTS field_reviews TEXT;
  `);

  const settings = {
    tier1_model: "gemini-3.6-flash", tier2_model: "gemini-3.6-flash",
    escalation_threshold: "0.8", tier1_input_rate: "0.10", tier1_output_rate: "0.40", tier2_input_rate: "0.30",
    tier2_output_rate: "2.50", batch_discount: "0", est_input_tokens_per_image: "1105",
    est_output_tokens_per_image: "150", est_escalation_rate: "0.10", guardrail_margin: "0.25",
    max_attempts: "3", escalation_rate_alert_high: "0.25",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [key, value]);
  }
  await db.query("UPDATE settings SET value = 'gemini-3.6-flash' WHERE key = 'tier1_model' AND value IN ('qwen/qwen3-vl-235b-a22b-instruct', 'openrouter/free', 'gemini-2.5-flash-lite')");
  await db.query("UPDATE settings SET value = 'gemini-3.6-flash' WHERE key = 'tier2_model' AND value IN ('google/gemini-3.1-pro-preview', 'qwen/qwen3-vl-235b-a22b-thinking', 'gemini-2.5-flash')");
  await db.query("UPDATE settings SET value = '0.10' WHERE key = 'tier1_input_rate' AND value = '0'");
  await db.query("UPDATE settings SET value = '0.40' WHERE key = 'tier1_output_rate' AND value = '0'");
  await db.query("UPDATE settings SET value = '0.30' WHERE key = 'tier2_input_rate' AND value = '0'");
  await db.query("UPDATE settings SET value = '2.50' WHERE key = 'tier2_output_rate' AND value = '0'");
}
