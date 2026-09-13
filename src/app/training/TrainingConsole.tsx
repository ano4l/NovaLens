"use client";
import { FormEvent, useState } from "react";
import { TrainingExample, TrainingGuideline, TrainingGuidelineKind } from "@/lib/types";

const KINDS: TrainingGuidelineKind[] = ["general", "cataloguing", "fitment", "brand", "condition", "safety"];

export default function TrainingConsole({ initialGuidelines, initialExamples }: { initialGuidelines: TrainingGuideline[]; initialExamples: TrainingExample[] }) {
  const [guidelines, setGuidelines] = useState(initialGuidelines);
  const [draft, setDraft] = useState({ title: "", instruction: "", kind: "general" as TrainingGuidelineKind, priority: 50 });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    const response = await fetch(editingId ? `/api/training/guidelines/${editingId}` : "/api/training/guidelines", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) return setMessage(data.error ?? "Could not save guideline");
    setGuidelines((current) => editingId ? current.map((g) => g.id === editingId ? data.guideline : g) : [data.guideline, ...current]); setDraft({ title: "", instruction: "", kind: "general", priority: 50 }); setEditingId(null); setMessage("Guideline saved and available to future recognition calls.");
  }
  async function toggle(guideline: TrainingGuideline) {
    const response = await fetch(`/api/training/guidelines/${guideline.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !guideline.active }) });
    const data = await response.json(); if (response.ok) setGuidelines((current) => current.map((g) => g.id === guideline.id ? data.guideline : g));
  }
  async function remove(id: number) {
    const response = await fetch(`/api/training/guidelines/${id}`, { method: "DELETE" });
    if (response.ok) setGuidelines((current) => current.filter((g) => g.id !== id));
  }
  return (
    <div className="memory-grid">
      <section className="panel memory-library">
        <div className="section-heading"><div><p className="eyebrow">Instruction library</p><h2>Active operating rules</h2></div><span>{guidelines.filter((g) => g.active).length} active</span></div>
        <form onSubmit={add} className="guideline-form">
          <label><span>Guideline title</span><input className="field" required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Conservative fitment years" /></label>
          <label className="wide"><span>Instruction</span><textarea className="field" required maxLength={2000} value={draft.instruction} onChange={(e) => setDraft({ ...draft, instruction: e.target.value })} placeholder="Describe the exact rule Gemini should follow…" /></label>
          <label><span>Category</span><select className="field" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as TrainingGuidelineKind })}>{KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <label><span>Priority</span><input className="field" type="number" min="1" max="100" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} /></label>
          <button disabled={saving} className="primary-button px-4">{saving ? "Saving…" : editingId ? "Save changes" : "Add guideline"}</button>
          {editingId && <button type="button" className="secondary-button px-4" onClick={() => { setEditingId(null); setDraft({ title: "", instruction: "", kind: "general", priority: 50 }); }}>Cancel</button>}
          <p className="form-message" aria-live="polite">{message}</p>
        </form>
        <div className="guideline-list">
          {guidelines.length === 0 ? <div className="empty-state"><strong>No operating rules yet</strong><p>Add the first guideline to establish how uncertain evidence should be handled.</p></div> : guidelines.map((g) => (
            <article key={g.id} className={`guideline-card ${g.active ? "" : "is-inactive"}`}>
              <div><span className="guideline-kind">{g.kind} · P{g.priority}</span><h3>{g.title}</h3><p>{g.instruction}</p></div>
              <div className="guideline-actions"><button onClick={() => { setEditingId(g.id); setDraft({ title:g.title, instruction:g.instruction, kind:g.kind, priority:g.priority }); window.scrollTo({ top:0, behavior:"smooth" }); }}>Edit</button><button onClick={() => toggle(g)}>{g.active ? "Pause" : "Activate"}</button><button className="danger-text" onClick={() => remove(g.id)}>Delete</button></div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel correction-panel">
        <div className="section-heading"><div><p className="eyebrow">Correction memory</p><h2>AI → human decisions</h2></div><span>{initialExamples.length} saved</span></div>
        <div className="correction-stream">
          {initialExamples.length === 0 ? <div className="empty-state"><strong>No corrections captured</strong><p>Edit a field in a training batch and the reviewed change will appear here.</p></div> : initialExamples.map((example) => (
            <article key={example.id} className="correction-row">
              <div className="correction-meta"><strong>{example.field.replace(/_/g, " ")}</strong><time>{new Date(example.created_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}</time></div>
              <div className="correction-values"><span><small>Gemini suggested</small>{example.previous_ai_value || "Empty"}</span><b aria-hidden="true">→</b><span><small>Human corrected</small>{example.corrected_value || "Empty"}</span></div>
              <p>{example.job_name ?? `Batch ${example.job_id ?? "archived"}`} · {example.reviewer}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
