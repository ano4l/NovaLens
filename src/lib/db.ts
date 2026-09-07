// ============================================================================
// STUDY: The persistence layer. One SQLite file, one module-level connection,
// schema + seed data created on first access. There is intentionally no ORM —
// the SQL is short, visible, and worth reading line by line.
// ============================================================================
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "novalens.db");

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export { DATA_DIR, UPLOAD_DIR };

// STUDY: Why globalThis? In `next dev`, modules are RELOADED on every file
// edit. A plain module-level variable would be recreated each reload, leaking
// one database connection per edit. Stashing the connection on globalThis
// survives reloads. This "global singleton" trick appears in nearly every
// Next.js + database tutorial for exactly this reason.
const globalForDb = globalThis as unknown as { __novalensDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__novalensDb) {
    const db = new Database(DB_PATH);
    // STUDY: WAL (write-ahead logging) lets readers and the writer work at the
    // same time — essential because the worker writes while the dashboard reads.
    db.pragma("journal_mode = WAL");
    // SQLite ships with FK enforcement OFF by default. Always turn it on.
    db.pragma("foreign_keys = ON");
    migrate(db);
    seedSettings(db);
    globalForDb.__novalensDb = db;
  }
  return globalForDb.__novalensDb;
}

// STUDY: "Migrate" here just means CREATE TABLE IF NOT EXISTS — fine for a
// case study. Production apps use versioned migration files (drizzle, knex,
// prisma migrate) so schema changes are replayable and reversible.
function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'batch',
      status TEXT NOT NULL DEFAULT 'queued',
      image_count INTEGER NOT NULL DEFAULT 0,
      est_cost_usd REAL,
      escalation_rate REAL,
      guardrail_breached INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      image_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      brand TEXT,
      part_name TEXT,
      year_start INTEGER,
      year_end INTEGER,
      condition_notes TEXT,
      confidence TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0,
      tier INTEGER,
      raw_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    // STUDY: These two indexes exist because of the two hot queries:
    //   1. dashboard:   "all items for job X"               → idx_items_job
    //   2. worker tick: "next due pending/escalated item"    → idx_items_pending
    // Indexes are written FOR YOUR QUERIES, not for your tables. Read
    // worker.ts's SELECT statements and match them to these columns.
    CREATE INDEX IF NOT EXISTS idx_items_job ON items(job_id, status);
    CREATE INDEX IF NOT EXISTS idx_items_pending ON items(status, next_retry_at);

    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      tier INTEGER NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_api_logs_job ON api_logs(job_id);

    CREATE TABLE IF NOT EXISTS edit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      edited_by TEXT NOT NULL DEFAULT 'manager',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// STUDY: All values are strings in the settings table; callers parse numbers
// via numSetting() in settings.ts. This trades type safety for a dead-simple
// schema — acceptable for a small fixed key set, questionable beyond it.
//
// Notice WHICH numbers live here: model names, token prices, thresholds,
// guardrail margins. Anything that changes with the outside world (vendor
// pricing, model generations) belongs in config, not code.
const DEFAULT_SETTINGS: Record<string, string> = {
  tier1_model: "gemini-2.5-flash-lite",
  tier2_model: "gemini-2.5-pro",
  escalation_threshold: "0.8",
  tier1_input_rate: "0.10",
  tier1_output_rate: "0.40",
  tier2_input_rate: "1.25",
  tier2_output_rate: "10.00",
  batch_discount: "0.5",
  est_input_tokens_per_image: "1105",
  est_output_tokens_per_image: "150",
  est_escalation_rate: "0.10",
  guardrail_margin: "0.25",
  max_attempts: "3",
  escalation_rate_alert_high: "0.25",
};

function seedSettings(db: Database.Database) {
  const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    stmt.run(key, value);
  }
}
