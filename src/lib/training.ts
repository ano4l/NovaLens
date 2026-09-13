import { getDb } from "./db";
import { RecognitionContext, RecognitionField, TrainingExample, TrainingGuideline } from "./types";

export async function getRecognitionContext(field?: RecognitionField): Promise<RecognitionContext> {
  const db = await getDb();
  const guidelines = await db.query<TrainingGuideline>(
    `SELECT id, title, instruction, kind, priority, active, created_at, updated_at
     FROM training_guidelines WHERE active = TRUE ORDER BY priority DESC, updated_at DESC LIMIT 24`
  );
  const examples = await db.query<TrainingExample>(
    `SELECT id, item_id, job_id, field, previous_ai_value, corrected_value, image_path, reviewer, created_at
     FROM training_examples
     ORDER BY CASE WHEN $1::text IS NOT NULL AND field = $1 THEN 0 ELSE 1 END, created_at DESC LIMIT 16`,
    [field ?? null]
  );
  return {
    guidelines: guidelines.rows.map(({ title, instruction, kind, priority }) => ({ title, instruction, kind, priority })),
    examples: examples.rows.map(({ field: exampleField, previous_ai_value, corrected_value }) => ({ field: exampleField, previous_ai_value, corrected_value })),
  };
}
