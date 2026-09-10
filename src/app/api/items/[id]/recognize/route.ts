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
  const db = await getDb();
  const { rows: itemRows } = await db.query<Item>("SELECT * FROM items WHERE id = $1", [id]);
  const item = itemRows[0];
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (["pending", "processing", "escalated"].includes(item.status)) return NextResponse.json({ error: "Wait for the current recognition pass to finish" }, { status: 409 });
  const { rows: jobRows } = await db.query<Job>("SELECT * FROM jobs WHERE id = $1", [item.job_id]);
  const job = jobRows[0];
  const { client } = getVisionClient({
    tier1: await getSetting("tier1_model") ?? "qwen/qwen3-vl-235b-a22b-instruct",
    tier2: await getSetting("tier2_model") ?? "google/gemini-3.1-pro-preview",
    challenger: await getSetting("challenger_model") ?? "qwen/qwen3-vl-235b-a22b-thinking",
    adjudicator: await getSetting("adjudicator_model") ?? "openai/gpt-5.4-mini",
    threshold: await numSetting("escalation_threshold", 0.8),
  });

  try {
    const call = await client.recheckField(path.join(UPLOAD_DIR, item.image_path), field);
    const cost = call.costUsd ?? await callCostUSD(2, job.mode as JobMode, call.inputTokens, call.outputTokens);
    await db.query(`INSERT INTO api_logs (item_id, job_id, tier, model, mode, input_tokens, output_tokens, cost_usd, latency_ms) VALUES ($1, $2, 2, $3, $4, $5, $6, $7, $8)`,
      [item.id, item.job_id, call.model, job.mode, call.inputTokens, call.outputTokens, cost, call.latencyMs]);

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
    const threshold = await numSetting("escalation_threshold", 0.8);
    const reviews = parseFieldAssessments(item.field_reviews);
    reviews[field] = { confidence, evidence, status: confidence >= threshold ? "ai_suggested" : "needs_review", source: call.model, updated_at: new Date().toISOString() };
    await db.query(`UPDATE items SET ${field} = $1, field_reviews = $2, needs_review = 1, status = 'tagged', updated_at = NOW() WHERE id = $3`,
      [value, JSON.stringify(reviews), item.id]);
    const oldValue = item[field];
    if (oldValue !== value) {
      await db.query("INSERT INTO edit_log (item_id, field, old_value, new_value, edited_by) VALUES ($1, $2, $3, $4, 'AI consensus recheck')",
        [item.id, field, oldValue == null ? null : String(oldValue), value == null ? null : String(value)]);
    }
    const { rows: updatedRows } = await db.query("SELECT * FROM items WHERE id = $1", [item.id]);
    const updated = updatedRows[0];
    return NextResponse.json({ item: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recognition failed";
    await db.query(`INSERT INTO api_logs (item_id, job_id, tier, model, mode, error, latency_ms) VALUES ($1, $2, 2, 'field-recheck-error', $3, $4, 0)`,
      [item.id, item.job_id, job.mode, message]);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
