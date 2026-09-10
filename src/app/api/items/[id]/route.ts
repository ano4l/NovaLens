// ============================================================================
// STUDY: Human-in-the-loop route. Two verbs, two lessons:
//   PATCH — inline edits and field confirmation. Value changes become
//           `corrected`; confirmations become `confirmed`; both are audited.
//   POST  — re-photo: replace the image and reset the row to 'pending',
//           re-entering the pipeline. Same item id, new evidence.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb, UPLOAD_DIR } from "@/lib/db";
import { preprocessImage } from "@/lib/preprocess";
import { Item } from "@/lib/types";
import { validateImageFile } from "@/lib/uploads";
import fs from "fs";
import path from "path";
import { isRecognitionField, parseFieldAssessments } from "@/lib/recognition";

export const runtime = "nodejs";

// STUDY: The ALLOWLIST. Only these fields may ever be patched. Never build
// UPDATE statements from whatever keys the client sends — that's how a client
// ends up writing `attempts` or `job_id`. Compare against the audit loop below:
// only the diffed fields get logged, and only from this list.
const EDITABLE = ["brand", "part_name", "year_start", "year_end", "condition_notes", "status"] as const;
const ALLOWED_STATUSES = new Set(["tagged", "approved", "rejected", "flagged_rephoto", "needs_manual"]);

function validatedValue(field: (typeof EDITABLE)[number], value: unknown): unknown {
  if (value === "" || value == null) return null;
  if (field === "year_start" || field === "year_end") {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1886 || year > new Date().getFullYear() + 2) {
      throw new Error(`${field} must be a valid vehicle model year`);
    }
    return year;
  }
  if (field === "status") {
    if (typeof value !== "string" || !ALLOWED_STATUSES.has(value)) throw new Error("Invalid item status");
    return value;
  }
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const limits: Record<string, number> = { brand: 80, part_name: 160, condition_notes: 500 };
  return value.trim().slice(0, limits[field]);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const { rows: itemRows } = await db.query<Item>("SELECT * FROM items WHERE id = $1", [id]);
  const item = itemRows[0];
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  const edits: { field: string; oldVal: unknown; newVal: unknown }[] = [];

  for (const field of EDITABLE) {
    if (field in body) {
      let newVal: unknown;
      try {
        newVal = validatedValue(field, body[field]);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid value" }, { status: 400 });
      }
      const oldVal = (item as unknown as Record<string, unknown>)[field];
      if (newVal !== oldVal) {
        updates[field] = newVal;
        edits.push({ field, oldVal, newVal });
      }
    }
  }

  const fieldReviews = parseFieldAssessments(item.field_reviews);
  // STUDY: Human actions override only the field they touch. Starting review
  // on a legacy row must not increase needs_review, while completing all four
  // identification fields is allowed to clear it.
  const reviewedAt = new Date().toISOString();
  let confirmationLog: { field: string; oldStatus: string | null } | null = null;
  for (const edit of edits) {
    if (!isRecognitionField(edit.field)) continue;
    fieldReviews[edit.field] = {
      confidence: 1,
      evidence: "Corrected by a human reviewer",
      status: "corrected",
      source: typeof body.edited_by === "string" ? body.edited_by : "manager",
      updated_at: reviewedAt,
    };
  }
  if (isRecognitionField(body.confirm_field)) {
    const existing = fieldReviews[body.confirm_field];
    confirmationLog = { field: body.confirm_field, oldStatus: existing?.status ?? null };
    fieldReviews[body.confirm_field] = existing
      ? { ...existing, status: "confirmed", updated_at: reviewedAt }
      : { confidence: 1, evidence: "Confirmed by a human reviewer", status: "confirmed", source: typeof body.edited_by === "string" ? body.edited_by : "manager", updated_at: reviewedAt };
  }
  if (edits.some((edit) => isRecognitionField(edit.field)) || isRecognitionField(body.confirm_field)) {
    updates.field_reviews = JSON.stringify(fieldReviews);
    const importantFields = ["brand", "part_name", "year_start", "year_end"] as const;
    updates.needs_review = importantFields.every((field) => ["confirmed", "corrected"].includes(fieldReviews[field]?.status ?? "")) ? 0 : item.needs_review;
  }

  const proposedStart = ("year_start" in updates ? updates.year_start : item.year_start) as number | null;
  const proposedEnd = ("year_end" in updates ? updates.year_end : item.year_end) as number | null;
  if (proposedStart !== null && proposedEnd !== null && proposedStart > proposedEnd) {
    return NextResponse.json({ error: "Start year cannot be later than end year" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ item });
  }

  const values = Object.values(updates);
  const sets = Object.keys(updates)
    .map((k, index) => `${k} = $${index + 1}`)
    .join(", ");
  await db.query(`UPDATE items SET ${sets}, updated_at = NOW() WHERE id = $${values.length + 1}`, [...values, item.id]);

  for (const e of edits) {
    await db.query(
      "INSERT INTO edit_log (item_id, field, old_value, new_value, edited_by) VALUES ($1, $2, $3, $4, $5)",
      [item.id, e.field, e.oldVal == null ? null : String(e.oldVal), e.newVal == null ? null : String(e.newVal), typeof body.edited_by === "string" ? body.edited_by : "manager"]
    );
  }
  if (confirmationLog) {
    await db.query(
      "INSERT INTO edit_log (item_id, field, old_value, new_value, edited_by) VALUES ($1, $2, $3, $4, $5)",
      [item.id, `${confirmationLog.field}.review_status`, confirmationLog.oldStatus, "confirmed", typeof body.edited_by === "string" ? body.edited_by : "manager"]
    );
  }

  const { rows: updatedRows } = await db.query("SELECT * FROM items WHERE id = $1", [item.id]);
  const updated = updatedRows[0];
  return NextResponse.json({ item: updated });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // STUDY: Re-photo resets ALL AI-derived columns to NULL and attempts to 0.
  // The worker sees 'pending' + tier NULL → treats it as brand new. The old
  // api_logs rows survive, so cost history is still truthful.
  const { id } = await params;
  const db = await getDb();
  const { rows: itemRows } = await db.query<Item>("SELECT * FROM items WHERE id = $1", [id]);
  const item = itemRows[0];
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  const validationError = validateImageFile(file);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const processed = await preprocessImage(item.job_id, file.name, buf);
  await db.query(
    `UPDATE items SET image_path = $1, cutout_path = $2, background_status = $3, filename = $4, status = 'pending', tier = NULL, attempts = 0,
       next_retry_at = 0, brand = NULL, part_name = NULL, year_start = NULL, year_end = NULL,
       condition_notes = NULL, confidence = NULL, needs_review = 0, raw_json = NULL, field_reviews = NULL,
       updated_at = NOW() WHERE id = $5`,
    [processed.relPath, processed.cutoutPath, processed.backgroundStatus, file.name, item.id]
  );
  await db.query("UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'review'", [item.job_id]);

  const uploadRoot = `${path.resolve(UPLOAD_DIR)}${path.sep}`;
  for (const storedPath of [item.image_path, item.cutout_path]) {
    if (!storedPath) continue;
    const oldPath = path.resolve(UPLOAD_DIR, storedPath);
    if (oldPath.startsWith(uploadRoot) && ![processed.relPath, processed.cutoutPath].includes(storedPath)) {
      fs.rmSync(oldPath, { force: true });
    }
  }

  return NextResponse.json({ ok: true });
}
