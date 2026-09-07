// ============================================================================
// STUDY: THE SEAM between "user world" and "pipeline world".
//   GET  /api/jobs — list shipments with cost/aggregates computed in SQL, not JS.
//   POST /api/jobs — accept a multipart upload, price it, enqueue rows.
// Notice what's NOT here: no AI calls. Upload only prepares data; the worker
// does the expensive work asynchronously. That's what makes the UI feel instant
// with 15,000 images.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { preprocessImage } from "@/lib/preprocess";
import { estimateJobCostUSD } from "@/lib/cost";
import { JobMode } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  // STUDY: Correlated subqueries for actual cost / remaining / approved —
  // computed per-row in SQL rather than N+1 queries from JS. With a dozen jobs
  // this is fine; at thousands you'd denormalize counters onto the jobs table.
  const jobs = db
    .prepare(
      `SELECT j.*,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM api_logs WHERE job_id = j.id) as actual_cost_usd,
        (SELECT COUNT(*) FROM items WHERE job_id = j.id AND status IN ('pending','processing','escalated')) as remaining,
        (SELECT COUNT(*) FROM items WHERE job_id = j.id AND status = 'approved') as approved
       FROM jobs j ORDER BY j.id DESC`
    )
    .all();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const name = String(form.get("name") ?? `Shipment ${new Date().toISOString().slice(0, 10)}`);
  const mode = (String(form.get("mode") ?? "batch") === "express" ? "express" : "batch") as JobMode;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }

  const db = getDb();
  // STUDY: Estimate BEFORE inserting the job row, and store it on the job
  // (est_cost_usd). Persisting the estimate — not recomputing it later — is
  // what lets the guardrail compare "what we promised" vs "what it cost", even
  // if someone changes the pricing settings mid-job.
  const est = estimateJobCostUSD(files.length, mode);
  const info = db
    .prepare(
      "INSERT INTO jobs (name, mode, status, image_count, est_cost_usd) VALUES (?, ?, 'queued', ?, ?)"
    )
    .run(name, mode, files.length, est);
  const jobId = Number(info.lastInsertRowid);

  const insertItem = db.prepare(
    "INSERT INTO items (job_id, filename, image_path) VALUES (?, ?, ?)"
  );
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const { relPath } = await preprocessImage(jobId, file.name, buf);
      insertItem.run(jobId, file.name, relPath);
    } catch (err) {
      console.error(`Failed to preprocess ${file.name}`, err);
      db.prepare("UPDATE jobs SET image_count = image_count - 1 WHERE id = ?").run(jobId);
    }
  }

  return NextResponse.json({ jobId, estCostUsd: est });
}
