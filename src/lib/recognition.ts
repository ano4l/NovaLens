import { FieldAssessments, RecognitionField, TagResult } from "./types";

export const RECOGNITION_FIELDS: RecognitionField[] = ["brand", "part_name", "year_start", "year_end", "condition_notes"];

// STUDY: AI output becomes review workflow data here. The model supplies a
// probability and evidence; NovaLens applies its own threshold and status.
// Keeping this policy outside vision.ts means model transport and product
// review rules can evolve independently.
export function buildFieldAssessments(result: TagResult, source: string, threshold: number): FieldAssessments {
  const updatedAt = new Date().toISOString();
  return Object.fromEntries(RECOGNITION_FIELDS.map((field) => {
    const confidence = result.field_confidence[field];
    return [field, {
      confidence,
      evidence: result.field_evidence[field],
      status: confidence >= threshold ? "ai_suggested" : "needs_review",
      source,
      updated_at: updatedAt,
    }];
  })) as FieldAssessments;
}

export function parseFieldAssessments(value: string | null): Partial<FieldAssessments> {
  // STUDY: Legacy rows predate field-level review. Treat missing or malformed
  // JSON as an empty review map so migrations never make the UI unusable.
  if (!value) return {};
  try { return JSON.parse(value) as Partial<FieldAssessments>; } catch { return {}; }
}

export function isRecognitionField(value: unknown): value is RecognitionField {
  return typeof value === "string" && (RECOGNITION_FIELDS as string[]).includes(value);
}
