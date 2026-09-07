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
  high: "bg-emerald-700",
  medium: "bg-amber-600",
  low: "bg-red-700",
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
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<{ id: number; field: string; value: string } | null>(null);
  const rephotoRef = useRef<HTMLInputElement>(null);
  const rephotoTarget = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

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

  // STUDY: Every mutation follows the same rhythm: send PATCH to the server,
  // read back the authoritative row, replace it in local state. The server is
  // always the source of truth; local state is just a cache of its answers.
  const patchItem = async (id: number, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (res.ok) {
      setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
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
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((i) => i.id)));
  };

  const startRephoto = (id: number) => {
    rephotoTarget.current = id;
    rephotoRef.current?.click();
  };

  const onRephotoFile = async (file: File | undefined) => {
    if (!file || rephotoTarget.current == null) return;
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/items/${rephotoTarget.current}`, { method: "POST", body: form });
    if (res.ok) {
      const fresh = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
      setItems(fresh.items);
    }
    rephotoTarget.current = null;
  };

  const isEditable = (i: Item) => ["tagged", "approved", "flagged_rephoto", "needs_manual"].includes(i.status);

  return (
    <div>
      <input
        ref={rephotoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onRephotoFile(e.target.files?.[0])}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-sm capitalize ${
              filter === f ? "bg-amber-500 text-zinc-950 font-medium" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {f.replace(/_/g, " ")} ({counts[f] ?? 0})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          disabled={busy || jobStatus !== "review"}
          onClick={() => bulk("approve", { minConfidence: "high" })}
          className="px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-40"
        >
          Approve all high-confidence
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => bulk("approve_selected")}
          className="px-3 py-2 rounded-md bg-emerald-800 hover:bg-emerald-700 text-sm disabled:opacity-40"
        >
          Approve selected ({selected.size})
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => bulk("reject")}
          className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-40"
        >
          Reject selected
        </button>
        <button
          disabled={busy || selected.size === 0}
          onClick={() => bulk("flag_rephoto")}
          className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-40"
        >
          Flag for re-photo
        </button>
        <span className="text-sm text-zinc-500 ml-auto">
          {visible.length.toLocaleString()} of {items.length.toLocaleString()} shown · sorted lowest confidence first
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-left">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={visible.length > 0 && selected.size === visible.length} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2">Photo</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Years</th>
              <th className="px-3 py-2">Condition</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {visible.map((i) => (
              <tr key={i.id} className={`hover:bg-zinc-900/50 ${i.needs_review === 1 && i.status !== "approved" ? "bg-amber-950/20" : ""}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggleSel(i.id)} />
                </td>
                <td className="px-3 py-2">
                  <a href={`/api/images/${i.id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/images/${i.id}`} alt={i.filename} className="w-14 h-14 object-cover rounded border border-zinc-700" />
                  </a>
                </td>
                <Cell item={i} field="brand" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} />
                <Cell item={i} field="part_name" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} wide />
                <td className="px-3 py-2 whitespace-nowrap">
                  <Cell item={i} field="year_start" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} inline />
                  <span className="text-zinc-500">–</span>
                  <Cell item={i} field="year_end" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} inline />
                </td>
                <Cell item={i} field="condition_notes" editing={editing} setEditing={setEditing} commitEdit={commitEdit} editable={isEditable(i)} wide />
                <td className="px-3 py-2">
                  {i.confidence ? (
                    <span className={`text-xs px-2 py-0.5 rounded ${CONF_STYLE[i.confidence]}`}>
                      {i.confidence}
                      {i.needs_review === 1 && " ⚑"}
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {i.tier ? (
                    <span className={`text-xs px-2 py-0.5 rounded ${i.tier === 2 ? "bg-violet-700" : "bg-zinc-700"}`}>
                      T{i.tier}
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
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
        {visible.length === 0 && (
          <div className="p-8 text-center text-zinc-500">
            {jobStatus === "processing" || jobStatus === "queued"
              ? "Processing… this page reloads as results arrive."
              : "No items match this filter."}
          </div>
        )}
      </div>
      {(jobStatus === "processing" || jobStatus === "queued") && <AutoRefresh jobId={jobId} onData={setItems} />}
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
        {value || "—"}
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
          {value || <span className="text-zinc-600">—</span>}
        </span>
      )}
    </td>
  );
}
