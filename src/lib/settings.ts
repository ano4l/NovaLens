// ============================================================================
// STUDY: Runtime configuration. The admin page edits these rows; the worker
// and cost functions read them on EVERY call — so changing a price or model
// name in /admin takes effect with no restart and no deploy.
// ============================================================================
import { getDb } from "./db";

export function getSettings(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

// STUDY: UPSERT pattern (INSERT ... ON CONFLICT DO UPDATE) plus a transaction:
// the admin page either saves ALL changed settings or none. Never leave config
// half-written.
export function setSettings(updates: Record<string, string>) {
  const stmt = getDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = getDb().transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) stmt.run(k, v);
  });
  tx(Object.entries(updates));
}

// STUDY: Always provide a fallback when parsing config. A corrupt or missing
// row must not crash the pipeline mid-shipment.
export function numSetting(key: string, fallback: number): number {
  const v = getSetting(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
