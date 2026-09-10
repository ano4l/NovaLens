// ============================================================================
// STUDY: THE SEAM between "user world" and "pipeline world".
//   GET  /api/jobs — list shipments with cost/aggregates computed in SQL, not JS.
//   POST /api/jobs — accept a multipart upload, price it, enqueue rows.
// Notice what's NOT here: no AI calls. Upload only prepares data; the worker
// does the expensive work asynchronously. That's what makes the UI feel instant
// with 15,000 images.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb, UPLOAD_DIR } from "@/lib/db";
import { preprocessImage } from "@/lib/preprocess";
import { estimateJobCostUSD } from "@/lib/cost";
import { JobMode } from "@/lib/types";
import { MAX_UPLOAD_FILES, validateImageFile } from "@/lib/uploads";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const db = await getDb();
  // STUDY: Correlated subqueries for actual cost / remaining / approved —
  // computed per-row in SQL rather than N+1 queries from JS. With a dozen jobs
  // this is fine; at thousands you'd denormalize counters onto the jobs table.
  const { rows: jobs } = await db.query(
      `SELECT j.*,
        (SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM api_logs WHERE job_id = j.id) as actual_cost_usd,
        (SELECT COUNT(*)::int FROM items WHERE job_id = j.id AND status IN ('pending','processing','escalated')) as remaining,
        (SELECT COUNT(*)::int FROM items WHERE job_id = j.id AND status = 'approved') as approved
       FROM jobs j ORDER BY j.id DESC`
  );
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const requestedName = String(form.get("name") ?? "").trim();
  const name = (requestedName || `Shipment ${new Date().toISOString().slice(0, 10)}`).slice(0, 120);
  const mode = (String(form.get("mode") ?? "batch") === "express" ? "express" : "batch") as JobMode;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }
  if (files.length > MAX_UPLOAD_FILES) {
    return NextResponse.json({ error: `Upload up to ${MAX_UPLOAD_FILES} images at a time` }, { status: 400 });
  }
  const invalid = files.map(validateImageFile).filter((message): message is string => Boolean(message));
  if (invalid.length > 0) {
    return NextResponse.json({ error: invalid.slice(0, 3).join(". ") }, { status: 400 });
  }

  const db = await getDb();
  // STUDY: Estimate BEFORE inserting the job row, and store it on the job
  // (est_cost_usd). Persisting the estimate — not recomputing it later — is
  // what lets the guardrail compare "what we promised" vs "what it cost", even
  // if someone changes the pricing settings mid-job.
  const est = await estimateJobCostUSD(files.length, mode);
  const { rows: jobRows } = await db.query<{ id: number }>(
    "INSERT INTO jobs (name, mode, status, image_count, est_cost_usd) VALUES ($1, $2, 'queued', $3, $4) RETURNING id",
    [name, mode, files.length, est]
  );
  const jobId = jobRows[0].id;
  let inserted = 0;
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const processed = await preprocessImage(jobId, file.name, buf);
      await db.query(
        "INSERT INTO items (job_id, filename, image_path, cutout_path, background_status) VALUES ($1, $2, $3, $4, $5)",
        [jobId, file.name, processed.relPath, processed.cutoutPath, processed.backgroundStatus]
      );
      inserted++;
    } catch (err) {
      console.error(`Failed to preprocess ${file.name}`, err);
      await db.query("UPDATE jobs SET image_count = image_count - 1 WHERE id = $1", [jobId]);
    }
  }

  if (inserted === 0) {
    await db.query("DELETE FROM jobs WHERE id = $1", [jobId]);
    fs.rmSync(path.join(UPLOAD_DIR, String(jobId)), { recursive: true, force: true });
    return NextResponse.json({ error: "None of the images could be processed" }, { status: 422 });
  }

  const finalEstimate = await estimateJobCostUSD(inserted, mode);
  await db.query("UPDATE jobs SET image_count = $1, est_cost_usd = $2 WHERE id = $3", [inserted, finalEstimate, jobId]);

  return NextResponse.json({ jobId, estCostUsd: finalEstimate, skipped: files.length - inserted });
}
