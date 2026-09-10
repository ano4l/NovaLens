// ============================================================================
// STUDY: Runtime configuration. The admin page edits these rows; the worker
// and cost functions read them on EVERY call — so changing a price or model
// name in /admin takes effect with no restart and no deploy.
// ============================================================================
import { getDb } from "./db";

export async function getSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const { rows } = await db.query<{ key: string; value: string }>("SELECT key, value FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

// STUDY: UPSERT pattern (INSERT ... ON CONFLICT DO UPDATE) plus a transaction:
// the admin page either saves ALL changed settings or none. Never leave config
// half-written.
export async function setSettings(updates: Record<string, string>) {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of Object.entries(updates)) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
        [key, value]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// STUDY: Always provide a fallback when parsing config. A corrupt or missing
// row must not crash the pipeline mid-shipment.
export async function numSetting(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
