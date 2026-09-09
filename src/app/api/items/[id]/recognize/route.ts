// STUDY: Targeted recognition is deliberately a separate endpoint from PATCH.
// PATCH records a human decision; this route spends money and invokes the
// consensus pipeline. It updates one requested value only, preserves trusted
// neighbours, revokes approval, and records both API cost and any value change.
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getDb, UPLOAD_DIR } from "@/lib/db";
import { getSetting, numSetting } from "@/lib/settings";
import { getVisionClient } from "@/lib/vision";
import { isRecognitionField, parseFieldAssessments } from "@/lib/recognition";
import { Item, Job, JobMode, RecognitionField } from "@/lib/types";
import { callCostUSD } from "@/lib/cost";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { field?: unknown };
  if (!isRecognitionField(body.field)) return NextResponse.json({ error: "Choose a valid field to recognise" }, { status: 400 });
  const field: RecognitionField = body.field;
  const db = getDb();
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (["pending", "processing", "escalated"].includes(item.status)) return NextResponse.json({ error: "Wait for the current recognition pass to finish" }, { status: 409 });
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(item.job_id) as Job;
  const { client } = getVisionClient({
    tier1: getSetting("tier1_model") ?? "qwen/qwen3-vl-235b-a22b-instruct",
    tier2: getSetting("tier2_model") ?? "google/gemini-3.1-pro-preview",
    challenger: getSetting("challenger_model") ?? "qwen/qwen3-vl-235b-a22b-thinking",
    adjudicator: getSetting("adjudicator_model") ?? "openai/gpt-5.4-mini",
    threshold: numSetting("escalation_threshold", 0.8),
  });

  try {
    const call = await client.recheckField(path.join(UPLOAD_DIR, item.image_path), field);
    const cost = call.costUsd ?? callCostUSD(2, job.mode as JobMode, call.inputTokens, call.outputTokens);
    db.prepare(`INSERT INTO api_logs (item_id, job_id, tier, model, mode, input_tokens, output_tokens, cost_usd, latency_ms) VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.job_id, call.model, job.mode, call.inputTokens, call.outputTokens, cost, call.latencyMs);

    let value = call.result[field];
    // STUDY: Rechecking one edge of a year range must not create an impossible
    // range. Keep the stored value and surface the conflict in evidence instead.
    let evidence = call.result.field_evidence[field];
    if (field === "year_start" && value !== null && item.year_end !== null && Number(value) > item.year_end) {
      value = item.year_start;
      evidence = `Candidate conflicted with the current end year. ${evidence}`;
    }
    if (field === "year_end" && value !== null && item.year_start !== null && Number(value) < item.year_start) {
      value = item.year_end;
      evidence = `Candidate conflicted with the current start year. ${evidence}`;
    }
    const confidence = call.result.field_confidence[field];
    const threshold = numSetting("escalation_threshold", 0.8);
    const reviews = parseFieldAssessments(item.field_reviews);
    reviews[field] = { confidence, evidence, status: confidence >= threshold ? "ai_suggested" : "needs_review", source: call.model, updated_at: new Date().toISOString() };
    db.prepare(`UPDATE items SET ${field} = ?, field_reviews = ?, needs_review = 1, status = 'tagged', updated_at = datetime('now') WHERE id = ?`)
      .run(value, JSON.stringify(reviews), item.id);
    const oldValue = item[field];
    if (oldValue !== value) {
      db.prepare("INSERT INTO edit_log (item_id, field, old_value, new_value, edited_by) VALUES (?, ?, ?, ?, 'AI consensus recheck')")
        .run(item.id, field, oldValue == null ? null : String(oldValue), value == null ? null : String(value));
    }
    const updated = db.prepare("SELECT * FROM items WHERE id = ?").get(item.id);
    return NextResponse.json({ item: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recognition failed";
    db.prepare(`INSERT INTO api_logs (item_id, job_id, tier, model, mode, error, latency_ms) VALUES (?, ?, 2, 'field-recheck-error', ?, ?, 0)`)
      .run(item.id, item.job_id, job.mode, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
