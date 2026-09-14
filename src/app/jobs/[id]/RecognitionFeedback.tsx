"use client";

import { FormEvent, useState } from "react";
import { Item, UploadFeedbackCategory } from "@/lib/types";

const CATEGORIES: Array<{ value: UploadFeedbackCategory; label: string }> = [
  { value: "photo_quality", label: "Photo quality" },
  { value: "wrong_identification", label: "Wrong identification" },
  { value: "brand_model_ambiguity", label: "Brand / model ambiguity" },
  { value: "fitment_years", label: "Fitment years" },
  { value: "condition_assessment", label: "Condition assessment" },
  { value: "other", label: "Other" },
];

export default function RecognitionFeedback({ jobId, items }: { jobId: number; items: Item[] }) {
  const [itemId, setItemId] = useState("");
  const [category, setCategory] = useState<UploadFeedbackCategory>("photo_quality");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSuccess("");
    setError("");
    try {
      const response = await fetch(`/api/jobs/${jobId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId ? Number(itemId) : null, category, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save feedback");
      setNote("");
      setSuccess("Feedback saved. It will inform future analysis as operator guidance.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save feedback");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="feedback-panel panel" aria-labelledby="recognition-feedback-heading">
      <div className="feedback-intro">
        <div>
          <p className="eyebrow">Analysis quality</p>
          <h2 id="recognition-feedback-heading">Recognition feedback</h2>
        </div>
        <p>Flag what made a photo difficult. Your note helps future analysis spot similar issues, but it cannot replace evidence in the image.</p>
      </div>
      <form className="feedback-form" onSubmit={submit}>
        <label>
          <span>Affected photo</span>
          <select className="field" value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">Whole batch</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
          </select>
        </label>
        <label>
          <span>Problem category</span>
          <select className="field" value={category} onChange={(event) => setCategory(event.target.value as UploadFeedbackCategory)}>
            {CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="feedback-note-field">
          <span>Operator note — Required, 4–500 characters <small>{note.length}/500</small></span>
          <textarea
            className="field"
            required
            minLength={4}
            maxLength={500}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What should the analyser handle more carefully?"
          />
        </label>
        <button className="primary-button feedback-submit" type="submit" disabled={saving || note.trim().length < 4}>
          {saving ? "Saving…" : "Save feedback"}
        </button>
        {success && <p className="feedback-message feedback-success" role="status">{success}</p>}
        {error && <p className="feedback-message feedback-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
