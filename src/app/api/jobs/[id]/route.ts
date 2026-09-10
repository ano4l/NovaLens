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
  const db = await getDb();
  const { rows: jobRows } = await db.query("SELECT * FROM jobs WHERE id = $1", [id]);
  const job = jobRows[0];
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // STUDY: The default sort encodes a PRODUCT decision in SQL: untagged items
  // first (NULL confidence), then low → medium → high. "Manager looks at the
  // sketchiest rows first" is a business rule expressed in an ORDER BY — it
  // must stay consistent here and in src/app/jobs/[id]/page.tsx.
  const { rows: items } = await db.query("SELECT * FROM items WHERE job_id = $1 ORDER BY (confidence IS NULL) DESC, CASE confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, id ASC", [id]);

  const { rows: costRows } = await db.query(
    `SELECT COALESCE(SUM(cost_usd), 0)::float8 as total_cost,
            COALESCE(SUM(input_tokens), 0)::int as input_tokens,
            COALESCE(SUM(output_tokens), 0)::int as output_tokens,
            COUNT(*)::int as api_calls
     FROM api_logs WHERE job_id = $1`, [id]
  );
  const cost = costRows[0];

  const { rows: byTier } = await db.query("SELECT tier, COUNT(*)::int as calls, COALESCE(SUM(cost_usd), 0)::float8 as cost FROM api_logs WHERE job_id = $1 GROUP BY tier", [id]);

  const { rows: statusCounts } = await db.query("SELECT status, COUNT(*)::int as count FROM items WHERE job_id = $1 GROUP BY status", [id]);

  return NextResponse.json({ job, items, cost, byTier, statusCounts });
}
