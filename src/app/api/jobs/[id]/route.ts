// ============================================================================
// STUDY: Job detail payload. One route returns EVERYTHING the dashboard needs
// (job, items, cost rollups, per-tier breakdown, status counts) in a single
// request. The client polls THIS route every 3s while processing — see
// AutoRefresh in ReviewTable.tsx.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // STUDY: The default sort encodes a PRODUCT decision in SQL: untagged items
  // first (NULL confidence), then low → medium → high. "Manager looks at the
  // sketchiest rows first" is a business rule expressed in an ORDER BY — it
  // must stay consistent here and in src/app/jobs/[id]/page.tsx.
  const items = db
    .prepare("SELECT * FROM items WHERE job_id = ? ORDER BY (confidence IS NULL) DESC, CASE confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, id ASC")
    .all(id);

  const cost = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as total_cost,
              COALESCE(SUM(input_tokens), 0) as input_tokens,
              COALESCE(SUM(output_tokens), 0) as output_tokens,
              COUNT(*) as api_calls
       FROM api_logs WHERE job_id = ?`
    )
    .get(id);

  const byTier = db
    .prepare("SELECT tier, COUNT(*) as calls, SUM(cost_usd) as cost FROM api_logs WHERE job_id = ? GROUP BY tier")
    .all(id);

  const statusCounts = db
    .prepare("SELECT status, COUNT(*) as count FROM items WHERE job_id = ? GROUP BY status")
    .all(id);

  return NextResponse.json({ job, items, cost, byTier, statusCounts });
}
