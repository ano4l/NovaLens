import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { UploadFeedback, UploadFeedbackCategory } from "@/lib/types";

export const runtime = "nodejs";

const CATEGORIES = new Set<UploadFeedbackCategory>([
  "photo_quality",
  "wrong_identification",
  "brand_model_ambiguity",
  "fitment_years",
  "condition_assessment",
  "other",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await enforceRateLimit(req, "job-feedback", 30);
  if (limited) return limited;

  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId < 1) {
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  }

  let body: { item_id?: unknown; category?: unknown; note?: unknown; submitted_by?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send feedback as valid JSON" }, { status: 400 });
  }

  const category = typeof body.category === "string" ? body.category : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const rawItemId = body.item_id;
  const itemId = rawItemId === null || rawItemId === undefined || rawItemId === "" ? null : Number(rawItemId);
  if (!CATEGORIES.has(category as UploadFeedbackCategory)) {
    return NextResponse.json({ error: "Choose a valid problem category" }, { status: 400 });
  }
  if (note.length < 4) {
    return NextResponse.json({ error: "Add a short note describing the recognition problem" }, { status: 400 });
  }
  if (note.length > 500) {
    return NextResponse.json({ error: "Keep the note to 500 characters or fewer" }, { status: 400 });
  }
  if (itemId !== null && (!Number.isInteger(itemId) || itemId < 1)) {
    return NextResponse.json({ error: "Choose a valid affected photo" }, { status: 400 });
  }

  const db = await getDb();
  const job = await db.query<{ id: number }>("SELECT id FROM jobs WHERE id = $1", [jobId]);
  if (!job.rows[0]) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (itemId !== null) {
    const item = await db.query<{ id: number }>("SELECT id FROM items WHERE id = $1 AND job_id = $2", [itemId, jobId]);
    if (!item.rows[0]) {
      return NextResponse.json({ error: "The selected photo does not belong to this job" }, { status: 400 });
    }
  }

  const submittedBy = typeof body.submitted_by === "string" && body.submitted_by.trim()
    ? body.submitted_by.trim().slice(0, 80)
    : "operator";
  const { rows } = await db.query<UploadFeedback>(
    `INSERT INTO upload_feedback (job_id, item_id, category, note, submitted_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, job_id, item_id, category, note, status, submitted_by, created_at, updated_at`,
    [jobId, itemId, category, note, submittedBy]
  );

  return NextResponse.json({ feedback: rows[0] }, { status: 201 });
}
