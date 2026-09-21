import { getDb } from "@/lib/db";
import { TrainingExample, TrainingGuideline, UploadFeedback } from "@/lib/types";
import TrainingConsole from "./TrainingConsole";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const db = await getDb();
  const [guidelines, examples, jobs, feedback] = await Promise.all([
    db.query<TrainingGuideline>("SELECT * FROM training_guidelines ORDER BY active DESC, priority DESC, updated_at DESC"),
    db.query<TrainingExample>(`SELECT e.*, j.name AS job_name FROM training_examples e LEFT JOIN jobs j ON j.id=e.job_id ORDER BY e.created_at DESC LIMIT 250`),
    db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM jobs WHERE workflow_mode='training'"),
    db.query<UploadFeedback>(
      `SELECT f.*, j.name AS job_name, i.filename
       FROM upload_feedback f
       LEFT JOIN jobs j ON j.id = f.job_id
       LEFT JOIN items i ON i.id = f.item_id
       ORDER BY f.created_at DESC LIMIT 20`
    ),
  ]);
  const covered = new Set(examples.rows.map((example) => example.field)).size;
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div><p className="eyebrow">Operating memory</p><h1>Training mode</h1><p>Turn reviewed decisions into consistent operating guidance for future recognition runs.</p></div>
        <a href="/upload?workflow=training" className="primary-button px-4 py-3">Start training batch</a>
      </header>
      <section className="kpi-strip" aria-label="Training metrics">
        <Metric label="Active guidelines" value={String(guidelines.rows.filter((g) => g.active).length)} />
        <Metric label="Saved corrections" value={String(examples.rows.length)} />
        <Metric label="Training batches" value={String(jobs.rows[0]?.count ?? 0)} />
        <Metric label="Field coverage" value={`${covered}/5`} />
      </section>
      <TrainingConsole initialGuidelines={guidelines.rows} initialExamples={examples.rows} />
      <RecentFeedback feedback={feedback.rows} />
      <section className="memory-disclosure">
        <strong>How memory is used</strong>
        <p>NovaLens stores active instructions and a bounded set of relevant human corrections for the review team. Google Lens matches remain external candidates, never verified fitment. This is review guidance, not provider-side fine-tuning.</p>
      </section>
    </div>
  );
}

const FEEDBACK_LABELS: Record<UploadFeedback["category"], string> = {
  photo_quality: "Photo quality",
  wrong_identification: "Wrong identification",
  brand_model_ambiguity: "Brand / model ambiguity",
  fitment_years: "Fitment years",
  condition_assessment: "Condition assessment",
  other: "Other",
};

function RecentFeedback({ feedback }: { feedback: UploadFeedback[] }) {
  return (
    <section className="panel recent-feedback" aria-labelledby="recent-feedback-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Operator signals</p><h2 id="recent-feedback-heading">Recent recognition feedback</h2></div>
        <span>{feedback.length} recent</span>
      </div>
      <div className="feedback-stream">
        {feedback.length === 0 ? (
          <div className="empty-state"><strong>No upload feedback yet</strong><p>Operators can flag difficult photos from each review job. Recent notes will appear here and inform future analysis as guidance.</p></div>
        ) : feedback.map((entry) => (
          <article className="feedback-record" key={entry.id}>
            <div className="feedback-record-meta">
              <span>{FEEDBACK_LABELS[entry.category]}</span>
              <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}</time>
            </div>
            <p>{entry.note}</p>
            <small>{entry.job_name ?? `Batch ${entry.job_id}`} · {entry.filename ?? "Whole batch"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong className="data-value">{value}</strong></div>;
}
