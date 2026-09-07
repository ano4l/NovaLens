// ============================================================================
// STUDY: Human-in-the-loop route. Two verbs, two lessons:
//   PATCH — inline edits. Every change ALSO writes an edit_log row (who, when,
//           before→after). In AI-assisted products the audit trail is a
//           feature: it's how you measure AI accuracy and settle disputes.
//   POST  — re-photo: replace the image and reset the row to 'pending',
//           re-entering the pipeline. Same item id, new evidence.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { preprocessImage } from "@/lib/preprocess";
import { Item } from "@/lib/types";

export const runtime = "nodejs";

// STUDY: The ALLOWLIST. Only these fields may ever be patched. Never build
// UPDATE statements from whatever keys the client sends — that's how a client
// ends up writing `attempts` or `job_id`. Compare against the audit loop below:
// only the diffed fields get logged, and only from this list.
const EDITABLE = ["brand", "part_name", "year_start", "year_end", "condition_notes", "status"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  const edits: { field: string; oldVal: unknown; newVal: unknown }[] = [];

  for (const field of EDITABLE) {
    if (field in body) {
      const newVal = body[field] === "" ? null : body[field];
      const oldVal = (item as unknown as Record<string, unknown>)[field];
      if (newVal !== oldVal) {
        updates[field] = newVal;
        edits.push({ field, oldVal, newVal });
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ item });
  }

  const sets = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  db.prepare(`UPDATE items SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
    ...Object.values(updates),
    item.id
  );

  const logEdit = db.prepare(
    "INSERT INTO edit_log (item_id, field, old_value, new_value, edited_by) VALUES (?, ?, ?, ?, ?)"
  );
  for (const e of edits) {
    logEdit.run(item.id, e.field, e.oldVal == null ? null : String(e.oldVal), e.newVal == null ? null : String(e.newVal), body.edited_by ?? "manager");
  }

  const updated = db.prepare("SELECT * FROM items WHERE id = ?").get(item.id);
  return NextResponse.json({ item: updated });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // STUDY: Re-photo resets ALL AI-derived columns to NULL and attempts to 0.
  // The worker sees 'pending' + tier NULL → treats it as brand new. The old
  // api_logs rows survive, so cost history is still truthful.
  const { id } = await params;
  const db = getDb();
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const { relPath } = await preprocessImage(item.job_id, file.name, buf);
  db.prepare(
    `UPDATE items SET image_path = ?, filename = ?, status = 'pending', tier = NULL, attempts = 0,
       next_retry_at = 0, brand = NULL, part_name = NULL, year_start = NULL, year_end = NULL,
       condition_notes = NULL, confidence = NULL, needs_review = 0, raw_json = NULL,
       updated_at = datetime('now') WHERE id = ?`
  ).run(relPath, file.name, item.id);
  db.prepare("UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'review'").run(item.job_id);

  return NextResponse.json({ ok: true });
}
