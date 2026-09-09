// ============================================================================
// STUDY: The review dashboard — the largest CLIENT component in the app
// (note the "use client" directive: this file ships to the browser and runs
// there). Contrast with src/app/jobs/[id]/page.tsx, which is a Server Component
// that queried the DB and passed the rows down as the `initialItems` prop.
// That prop handoff is THE architectural boundary: plain JSON crosses it, and
// from there this component owns all interaction state (selection, editing,
// polling).
//
// Three sub-systems to trace:
//   1. editing state + <Cell>                → spreadsheet-like inline editing
//   2. `selected` Set + bulk()               → checkbox selection & bulk actions
//   3. <AutoRefresh>                         → polling while the job processes
// ============================================================================
"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Item } from "@/lib/types";

const CONF_STYLE: Record<string, string> = {
  high: "border-emerald-800 text-emerald-300 bg-emerald-950/30",
  medium: "border-amber-800 text-amber-300 bg-amber-950/30",
  low: "border-red-800 text-red-300 bg-red-950/30",
};

const STATUS_FILTERS = ["all", "needs_review", "tagged", "approved", "rejected", "flagged_rephoto", "needs_manual", "pending"] as const;

export default function ReviewTable({
  jobId,
  initialItems,
  jobStatus,
}: {
  jobId: number;
  initialItems: Item[];
  jobStatus: string;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(initialItems[0]?.id ?? null);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ id: number; field: string; value: string } | null>(null);
  const rephotoRef = useRef<HTMLInputElement>(null);
  const rephotoTarget = useRef<number | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "needs_review") return items.filter((i) => i.needs_review === 1 && i.status !== "approved");
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    c.needs_review = items.filter((i) => i.needs_review === 1 && i.status !== "approved").length;
    for (const s of STATUS_FILTERS) {
      if (s === "all" || s === "needs_review") continue;
      c[s] = items.filter((i) => i.status === s).length;
    }
    return c;
  }, [items]);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? visible[0] ?? items[0] ?? null,
    [activeId, items, visible],
  );
  const approvedCount = counts.approved ?? 0;
  const labelledCount = items.filter((item) => item.brand && item.part_name).length;
  const metadataCompletion = items.length ? Math.round((labelledCount / items.length) * 100) : 0;

  useEffect(() => {
    if (activeId != null && !items.some((item) => item.id === activeId)) setActiveId(items[0]?.id ?? null);
  }, [activeId, items]);

  // STUDY: Every mutation follows the same rhythm: send PATCH to the server,
  // read back the authoritative row, replace it in local state. The server is
  // always the source of truth; local state is just a cache of its answers.
  const patchItem = async (id: number, updates: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (res.ok) {
      setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
    } else {
      setError(data.error ?? "Could not update this item");
    }
    return res.ok;
  };

  const commitEdit = async () => {
    if (!editing) return;
    const { id, field, value } = editing;
    setEditing(null);
    const val = field === "year_start" || field === "year_end" ? (value === "" ? null : Number(value)) : value;
    await patchItem(id, { [field]: val });
  };

  // STUDY: Bulk actions refetch the WHOLE job afterward rather than patching
  // rows locally. Deliberate: bulk SQL touches many rows at once; re-syncing
  // from the server is simpler and can never drift out of sync.
  const bulk = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { action, ...extra };
      if (action !== "approve") body.ids = Array.from(selected);
      const res = await fetch(`/api/jobs/${jobId}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const fresh = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
        setItems(fresh.items);
        setSelected(new Set());
      } else {
        const data = await res.json();
        setError(data.error ?? "Bulk action failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleSel = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    const visibleIds = visible.map((item) => item.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    setSelected((current) => {
      const next = new Set(current);
      for (const id of visibleIds) allVisibleSelected ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startRephoto = (id: number) => {
    rephotoTarget.current = id;
    rephotoRef.current?.click();
  };

  const reviewNext = () => {
    const next = items.find((item) => item.needs_review === 1 && item.status !== "approved") ?? items.find((item) => item.status === "tagged");
    if (!next) return;
    setActiveId(next.id);
    window.requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const onRephotoFile = async (file: File | undefined) => {
    if (!file || rephotoTarget.current == null) return;
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/items/${rephotoTarget.current}`, { method: "POST", body: form });
    if (res.ok) {
      const fresh = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
      setItems(fresh.items);
    } else {
      const data = await res.json();
      setError(data.error ?? "Could not replace the photo");
    }
    rephotoTarget.current = null;
  };

  const isEditable = (i: Item) => ["tagged", "approved", "flagged_rephoto", "needs_manual"].includes(i.status);

  return (
    <div className="space-y-4">
      <input
        ref={rephotoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onRephotoFile(e.target.files?.[0])}
      />

      <section className="review-pulse-grid" aria-label="Review progress">
        <Pulse label="Queue" value={items.length.toLocaleString()} detail="photos in this job" />
        <Pulse label="Approved" value={approvedCount.toLocaleString()} detail={`${items.length ? Math.round((approvedCount / items.length) * 100) : 0}% cleared`} tone="approved" />
        <Pulse label="Attention" value={(counts.needs_review ?? 0).toLocaleString()} detail="need a reviewer" tone={(counts.needs_review ?? 0) > 0 ? "attention" : undefined} />
        <Pulse label="Metadata" value={`${metadataCompletion}%`} detail="brand and part complete" />
      </section>

      <div className="review-filter-rail-wrap">
      <div className="review-filter-rail" role="group" aria-label="Filter review queue">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border text-sm capitalize ${
              filter === f ? "border-amber-500 bg-amber-500 text-zinc-950 font-medium" : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            {f.replace(/_/g, " ")} ({counts[f] ?? 0})
          </button>
        ))}
      </div>
      </div>

      <div className="review-bulk-bar flex flex-wrap items-center gap-2 panel p-3">
        <button
          disabled={busy || jobStatus !== "review"}
          onClick={() => bulk("approve", { minConfidence: "high" })}
          className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm font-medium disabled:opacity-40"
        >
          Approve all high-confidence
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => bulk("approve_selected")}
          className="px-3 py-2 rounded-lg border border-emerald-800 text-emerald-300 hover:bg-emerald-950/50 text-sm disabled:opacity-40"
        >
          Approve selected ({selected.size})
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => bulk("reject")}
          className="secondary-button px-3 py-2 text-sm disabled:opacity-40"
        >
          Reject selected
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => bulk("flag_rephoto")}
          className="secondary-button px-3 py-2 text-sm disabled:opacity-40"
        >
          Flag for re-photo
        </button>
        <span className="text-sm text-zinc-500 ml-auto">
          {visible.length.toLocaleString()} of {items.length.toLocaleString()} shown / lowest confidence first
        </span>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="review-workspace">
        <section className="min-w-0 overflow-hidden panel" aria-label="Review queue">
          <div className="review-queue-heading">
            <div>
              <p className="review-eyebrow">Review queue</p>
              <p className="text-sm text-zinc-400 mt-1">Select a photo to inspect its result and decide the next move.</p>
            </div>
            <div className="review-queue-tools">
              {(counts.needs_review ?? 0) > 0 && <button type="button" className="review-next-button" onClick={reviewNext}>Review next</button>}
              <span className="review-count">{visible.length} shown</span>
            </div>
          </div>
          <div className="review-table-wrap">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-zinc-900/90 text-zinc-500 text-left sticky top-16 z-10">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" aria-label="Select all visible items" checked={visible.length > 0 && visible.every((item) => selected.has(item.id))} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2">Photo</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Years</th>
              <th className="px-3 py-2">Condition</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {visible.map((i) => (
              <tr
                key={i.id}
                aria-selected={activeItem?.id === i.id}
                className={`review-row cursor-pointer ${activeItem?.id === i.id ? "review-row-active" : ""} ${i.needs_review === 1 && i.status !== "approved" ? "bg-amber-950/15" : ""}`}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={`Select ${i.filename}`} checked={selected.has(i.id)} onChange={() => toggleSel(i.id)} />
                </td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setActiveId(i.id)} className="review-select-button" aria-label={`Inspect ${i.filename}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/images/${i.id}`} alt={i.filename} className="w-14 h-14 object-cover rounded-lg border border-zinc-700" />
                    {activeItem?.id === i.id && <span className="review-selected-mark">Selected</span>}
                  </button>
                </td>
                <Cell item={i} field="brand" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} />
                <Cell item={i} field="part_name" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} wide />
                <td className="px-3 py-2 whitespace-nowrap">
                  <Cell item={i} field="year_start" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} inline />
                  <span className="text-zinc-500">-</span>
                  <Cell item={i} field="year_end" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} inline />
                </td>
                <Cell item={i} field="condition_notes" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} wide />
                <td className="px-3 py-2">
                  {i.confidence ? (
                    <span className={`inline-flex border text-xs px-2 py-0.5 rounded-full ${CONF_STYLE[i.confidence]}`}>
                      {i.confidence}
                      {i.needs_review === 1 && " / review"}
                    </span>
                  ) : (
                    <span className="text-zinc-600">-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {i.tier ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${i.tier === 2 ? "border-amber-700 text-amber-300" : "border-zinc-700 text-zinc-400"}`}>
                      T{i.tier}
                    </span>
                  ) : (
                    <span className="text-zinc-600">-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-zinc-400">{i.status.replace(/_/g, " ")}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {i.status === "tagged" && (
                    <button onClick={() => patchItem(i.id, { status: "approved" })} className="text-emerald-400 hover:underline text-xs mr-2">
                      Approve
                    </button>
                  )}
                  <button onClick={() => startRephoto(i.id)} className="text-amber-400 hover:underline text-xs">
                    Re-photo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        {visible.length === 0 && (
          <div className="p-8 text-center text-zinc-500">
            {jobStatus === "processing" || jobStatus === "queued"
              ? "Processing... this page refreshes as results arrive."
              : "No items match this filter."}
          </div>
        )}
        </section>

        <div className="review-card-list" role="list" aria-label="Review queue cards">
          {visible.map((item) => (
            <div key={item.id} role="listitem" className={`review-card ${activeItem?.id === item.id ? "review-card-active" : ""}`}>
              <button type="button" onClick={() => setActiveId(item.id)} className="review-card-select" aria-label={`Inspect ${item.filename}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/images/${item.id}`} alt="" className="review-card-photo" />
                <span className="min-w-0 text-left"><strong>{item.brand || "Unidentified"}</strong><span>{item.part_name || "Part not set"}</span><small>{item.year_start || item.year_end ? `${item.year_start ?? "?"} – ${item.year_end ?? "?"}` : "Year not set"}</small></span>
              </button>
              <div className="review-card-meta"><span className={`review-status review-status-${item.status}`}>{item.status.replace(/_/g, " ")}</span><span className={`review-card-confidence ${item.confidence ?? "unknown"}`}>{item.confidence ?? "Unknown"}{item.needs_review === 1 ? " · review" : ""}</span></div>
              <div className="review-card-bottom"><span>{item.condition_notes || "No condition note"}</span><label><input type="checkbox" aria-label={`Select ${item.filename}`} checked={selected.has(item.id)} onChange={() => toggleSel(item.id)} /> Select</label></div>
            </div>
          ))}
        </div>

        <aside ref={inspectorRef} className="review-inspector" aria-live="polite" aria-label="Selected photo inspector">
          {activeItem ? (
            <>
              <div className="review-inspector-topline">
                <span className="review-eyebrow">Selected photo</span>
                <span className={`review-status review-status-${activeItem.status}`}>{activeItem.status.replace(/_/g, " ")}</span>
              </div>
              <a href={`/api/images/${activeItem.id}`} target="_blank" rel="noreferrer" className="review-photo-link">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/images/${activeItem.id}`} alt={activeItem.filename} className="review-inspector-photo" />
                <span>Open full image</span>
              </a>
              <div className="review-filename" title={activeItem.filename}>{activeItem.filename}</div>
              <dl className="review-facts">
                <InspectorField item={activeItem} field="brand" label="Brand" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(activeItem)} />
                <InspectorField item={activeItem} field="part_name" label="Part" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(activeItem)} />
                <Fact label="Years" value={activeItem.year_start || activeItem.year_end ? `${activeItem.year_start ?? "?"} – ${activeItem.year_end ?? "?"}` : null} />
                <InspectorField item={activeItem} field="condition_notes" label="Condition" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(activeItem)} />
                <Fact label="Confidence" value={activeItem.confidence ? `${activeItem.confidence}${activeItem.needs_review === 1 ? " · review" : ""}` : null} />
              </dl>
              <div className="review-actions">
                {activeItem.status === "tagged" && <button onClick={() => patchItem(activeItem.id, { status: "approved" })} className="review-approve">Approve photo</button>}
                <button onClick={() => startRephoto(activeItem.id)} className="secondary-button px-3 py-2.5 text-sm">Request re-photo</button>
                <button type="button" disabled={(counts.needs_review ?? 0) === 0} onClick={reviewNext} className="review-mobile-next">Review next <span aria-hidden="true">→</span></button>
              </div>
              <div className="reference-ready">
                <span className="reference-ready-dot" />
                <div><strong>Reference-ready</strong><p>Approved photos can become verified visual references after indexing.</p></div>
              </div>
            </>
          ) : <div className="p-5 text-sm text-zinc-500">Select a photo to open its inspection details.</div>}
        </aside>
      </div>
      {(jobStatus === "processing" || jobStatus === "queued") && <AutoRefresh jobId={jobId} onData={setItems} />}
    </div>
  );
}

function Pulse({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "approved" | "attention" }) {
  return <div className={`review-pulse ${tone ? `review-pulse-${tone}` : ""}`}><span>{label}</span><strong className="data-value">{value}</strong><small>{detail}</small></div>;
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{value || <span className="text-zinc-600">Not set</span>}</dd></div>;
}

function InspectorField({
  item, field, label, editing, setEditing, commitEdit, editable,
}: {
  item: Item;
  field: "brand" | "part_name" | "condition_notes";
  label: string;
  editing: { id: number; field: string; value: string } | null;
  setEditing: (e: { id: number; field: string; value: string } | null) => void;
  commitEdit: () => void;
  editable: boolean;
}) {
  const value = String(item[field] ?? "");
  const isEditing = editing?.id === item.id && editing.field === field;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {isEditing ? (
          <input autoFocus value={editing.value} onChange={(e) => setEditing({ id: item.id, field, value: e.target.value })} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }} className="review-inspector-input" aria-label={`${label} for ${item.filename}`} />
        ) : (
          <button type="button" disabled={!editable} onClick={() => setEditing({ id: item.id, field, value })} className="review-fact-value"><span>{value || <span className="text-zinc-600">Not set</span>}</span> {editable && <span className="review-edit-hint">Edit {label.toLowerCase()}</span>}</button>
        )}
      </dd>
    </div>
  );
}

// STUDY: Polling, done right, in 12 lines: start a setInterval, STOP it when
// the job leaves processing, clean up in the effect's return. Real apps would
// upgrade this to Server-Sent Events or websockets — the component consuming
// the data (onData callback) wouldn't notice the difference.
function AutoRefresh({ jobId, onData }: { jobId: number; onData: (items: Item[]) => void }) {
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const fresh = await res.json();
      onData(fresh.items);
      if (fresh.job.status !== "processing" && fresh.job.status !== "queued") {
        clearInterval(t);
        window.location.reload();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [jobId, onData]);
  return null;
}

// STUDY: An editable table cell. Read the two render branches: either it's the
// editing <input> (autofocused, commits on blur/Enter, cancels on Escape) or a
// clickable <span>. Lifting `editing` state UP to the table (passed down as
// props) guarantees only one cell edits at a time — shared state placement is
// the real lesson here.
function Cell({
  item,
  field,
  editing,
  setEditing,
  commitEdit,
  editable,
  wide,
  inline,
}: {
  item: Item;
  field: "brand" | "part_name" | "year_start" | "year_end" | "condition_notes";
  editing: { id: number; field: string; value: string } | null;
  setEditing: (e: { id: number; field: string; value: string } | null) => void;
  commitEdit: () => void;
  editable: boolean;
  wide?: boolean;
  inline?: boolean;
}) {
  const value = (item[field] ?? "") as string | number;
  const isEditing = editing?.id === item.id && editing.field === field;

  const input = (
    <input
      autoFocus
      value={editing?.value ?? ""}
      onChange={(e) => setEditing({ id: item.id, field, value: e.target.value })}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitEdit();
        if (e.key === "Escape") setEditing(null);
      }}
      className={`bg-zinc-800 border border-amber-500 rounded px-1 py-0.5 outline-none ${
        inline ? "w-14" : wide ? "w-full min-w-[12rem]" : "w-28"
      }`}
      aria-label={`${field.replace(/_/g, " ")} for ${item.filename}`}
    />
  );

  if (inline) {
    return isEditing ? (
      input
    ) : (
      <span
        onClick={() => editable && setEditing({ id: item.id, field, value: String(value) })}
        className={editable ? "cursor-text hover:bg-zinc-800 rounded px-1" : "text-zinc-400"}
      >
        {value || "-"}
      </span>
    );
  }

  return (
    <td className="px-3 py-2">
      {isEditing ? (
        input
      ) : (
        <span
          onClick={() => editable && setEditing({ id: item.id, field, value: String(value) })}
          className={`${editable ? "cursor-text hover:bg-zinc-800 rounded px-1 -mx-1" : ""} ${wide ? "block max-w-[16rem] truncate" : ""}`}
          title={String(value)}
        >
          {value || <span className="text-zinc-600">-</span>}
        </span>
      )}
    </td>
  );
}
