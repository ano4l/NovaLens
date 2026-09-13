"use client";

import { useEffect, useMemo, useState } from "react";

type Note = { id: number; author: string; text: string; time: string; kind?: "system" };

const seedNotes: Note[] = [
  { id: 1, author: "Maya", text: "I’ll take the low-confidence items first. Flag anything with an unclear fitment year.", time: "12 min ago" },
  { id: 2, author: "NovaLens", text: "Review link created. Anyone with the link can view this shipment.", time: "Just now", kind: "system" },
];

export default function CollaborationPanel({ jobId }: { jobId: number }) {
  const storageKey = `novalens-collab-${jobId}`;
  const [notes, setNotes] = useState<Note[]>(seedNotes);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<"Can edit" | "Can comment" | "Can view">("Can comment");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setNotes(JSON.parse(saved));
    } catch { /* local demo state should never block review */ }
  }, [storageKey]);

  const shareUrl = useMemo(() => typeof window === "undefined" ? `/jobs/${jobId}` : window.location.href, [jobId]);

  function save(next: Note[]) {
    setNotes(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  async function copyLink() {
    await navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function addNote() {
    const text = draft.trim();
    if (!text) return;
    save([{ id: Date.now(), author: "You", text, time: "Just now" }, ...notes]);
    setDraft("");
  }

  return (
    <section className="collab-panel panel" aria-labelledby="team-review-title">
      <div className="collab-head">
        <div>
          <p className="review-eyebrow">Shared review</p>
          <h2 id="team-review-title">Keep the handoff moving</h2>
          <p>Bring in a teammate for a second look without losing the review context.</p>
        </div>
        <div className="presence-stack" aria-label="2 teammates active">
          <span className="presence-avatar presence-avatar-maya">M</span>
          <span className="presence-avatar presence-avatar-jay">J</span>
          <span className="presence-count">+1</span>
        </div>
      </div>
      <div className="collab-share-row">
        <div className="collab-link"><span className="status-dot" />Anyone with the link {role.toLowerCase()}</div>
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="collab-role" aria-label="Link permission">
          <option>Can edit</option><option>Can comment</option><option>Can view</option>
        </select>
        <button type="button" onClick={copyLink} className="secondary-button collab-copy">{copied ? "Copied" : "Copy link"}</button>
      </div>
      <div className="collab-body">
        <div className="collab-activity-head"><span>Activity</span><span>{notes.length} updates</span></div>
        <div className="collab-notes" aria-live="polite">
          {notes.map((note) => (
            <article key={note.id} className={`collab-note ${note.kind ? "collab-note-system" : ""}`}>
              <span className="note-avatar">{note.author === "NovaLens" ? "N" : note.author[0]}</span>
              <div><div className="collab-note-meta"><strong>{note.author}</strong><time>{note.time}</time></div><p>{note.text}</p></div>
            </article>
          ))}
        </div>
        <div className="collab-composer">
          <label htmlFor="collab-note">Add a note for the team</label>
          <div className="collab-compose-row"><input id="collab-note" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="e.g. Check the fitment years on this batch" className="field" /><button type="button" onClick={addNote} className="primary-button" disabled={!draft.trim()}>Post</button></div>
        </div>
      </div>
      <p className="collab-footnote">Demo collaboration is saved in this browser. Connect auth and shared storage before using this for sensitive inventory.</p>
    </section>
  );
}
