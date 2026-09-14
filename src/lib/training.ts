import { getDb } from "./db";
import { RecognitionContext, RecognitionField, TrainingExample, TrainingGuideline, UploadFeedback } from "./types";

export async function getRecognitionContext(field?: RecognitionField): Promise<RecognitionContext> {
  const db = await getDb();
  const [guidelines, examples, feedback] = await Promise.all([
    db.query<TrainingGuideline>(
      `SELECT id, title, instruction, kind, priority, active, created_at, updated_at
       FROM training_guidelines WHERE active = TRUE ORDER BY priority DESC, updated_at DESC LIMIT 24`
    ),
    db.query<TrainingExample>(
      `SELECT id, item_id, job_id, field, previous_ai_value, corrected_value, image_path, reviewer, created_at
       FROM training_examples
       ORDER BY CASE WHEN $1::text IS NOT NULL AND field = $1 THEN 0 ELSE 1 END, created_at DESC LIMIT 16`,
      [field ?? null]
    ),
    db.query<UploadFeedback>(
      `SELECT id, job_id, item_id, category, note, status, submitted_by, created_at, updated_at
       FROM upload_feedback WHERE status = 'active' ORDER BY created_at DESC LIMIT 12`
    ),
  ]);
  return {
    guidelines: guidelines.rows.map(({ title, instruction, kind, priority }) => ({ title, instruction, kind, priority })),
    examples: examples.rows.map(({ field: exampleField, previous_ai_value, corrected_value }) => ({ field: exampleField, previous_ai_value, corrected_value })),
    operatorFeedback: feedback.rows.map(({ category, note }) => ({ category, note })),
  };
}
