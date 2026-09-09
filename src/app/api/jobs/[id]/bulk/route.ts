import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// ============================================================================
// STUDY: Bulk mutations with SAFETY built in at the SQL level:
//   - every value is bound as a ? parameter (never string-interpolated)
//   - the id list is re-validated to finite numbers before use
//   - 'approve' only touches rows that are status='tagged' AND needs_review=0
//     AND meet the confidence bar — the WHERE clause is the authorization AND
//     the business rule in one place.
// Body: { action: 'approve'|'approve_selected'|'reject'|'flag_rephoto', ids?, minConfidence? }
// ============================================================================
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const action = String(body.action ?? "");
  const minConfidence = body.minConfidence === "medium" ? "medium" : "high";

  const confFilter =
    minConfidence === "high" ? "confidence = 'high'" : "confidence IN ('high', 'medium')";

  let info;
  if (action === "approve") {
    info = db
      .prepare(
        `UPDATE items SET status = 'approved', updated_at = datetime('now')
         WHERE job_id = ? AND status = 'tagged' AND needs_review = 0 AND ${confFilter}`
      )
      .run(id);
  } else if (action === "approve_selected") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite).slice(0, 500) : [];
    if (ids.length === 0) return NextResponse.json({ error: "No ids" }, { status: 400 });
    const placeholders = ids.map(() => "?").join(",");
    info = db
      .prepare(
        `UPDATE items SET status = 'approved', updated_at = datetime('now')
         WHERE job_id = ? AND id IN (${placeholders}) AND status IN ('tagged','flagged_rephoto')`
      )
      .run(id, ...ids);
  } else if (action === "reject") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite).slice(0, 500) : [];
    if (ids.length === 0) return NextResponse.json({ error: "No ids" }, { status: 400 });
    const placeholders = ids.map(() => "?").join(",");
    info = db
      .prepare(
        `UPDATE items SET status = 'rejected', updated_at = datetime('now')
         WHERE job_id = ? AND id IN (${placeholders})`
      )
      .run(id, ...ids);
  } else if (action === "flag_rephoto") {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite).slice(0, 500) : [];
    if (ids.length === 0) return NextResponse.json({ error: "No ids" }, { status: 400 });
    const placeholders = ids.map(() => "?").join(",");
    info = db
      .prepare(
        `UPDATE items SET status = 'flagged_rephoto', updated_at = datetime('now')
         WHERE job_id = ? AND id IN (${placeholders})`
      )
      .run(id, ...ids);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ updated: info.changes });
}
