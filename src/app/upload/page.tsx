// ============================================================================
// STUDY: The upload form. Notice THREE input affordances for the same data —
// drag-and-drop, folder picker (non-standard `webkitdirectory` attribute), and
// file picker — all funneling into one addFiles() function. One ingestion
// path, many UI doors. Also note refreshEstimate(): cost preview updates on
// every file/mode change so users see the price BEFORE committing.
// ============================================================================
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"batch" | "express">("batch");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);

  const refreshEstimate = useCallback(async (count: number, m: string) => {
    if (count === 0) {
      setEstimate(null);
      return;
    }
    const res = await fetch(`/api/estimate?count=${count}&mode=${m}`);
    const data = await res.json();
    setEstimate(data.estCostUsd);
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const imgs = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
      setFiles((prev) => {
        const next = [...prev, ...imgs];
        refreshEstimate(next.length, mode);
        return next;
      });
    },
    [mode, refreshEstimate]
  );

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // STUDY: FormData == multipart/form-data — the browser's built-in way to
      // stream files. The server side (api/jobs/route.ts POST) reads this exact
      // shape back with req.formData(). Nothing here is JSON; files aren't.
      const form = new FormData();
      form.set("name", name || `Shipment ${new Date().toISOString().slice(0, 10)}`);
      form.set("mode", mode);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/jobs", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      router.push(`/jobs/${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">New Shipment Upload</h1>

      <label className="block text-sm text-zinc-400 mb-1">Shipment name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Shipment ${new Date().toISOString().slice(0, 10)}`}
        className="w-full mb-4 px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 focus:border-amber-500 outline-none"
      />

      <label className="block text-sm text-zinc-400 mb-1">Processing mode</label>
      <div className="flex gap-3 mb-4">
        {(["batch", "express"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              refreshEstimate(files.length, m);
            }}
            className={`flex-1 rounded-md border px-4 py-3 text-left ${
              mode === m ? "border-amber-500 bg-amber-500/10" : "border-zinc-700 bg-zinc-900"
            }`}
          >
            <div className="font-medium capitalize">{m}</div>
            <div className="text-xs text-zinc-400">
              {m === "batch" ? "Batch API · 50% cheaper · results within 24h" : "Synchronous · full price · minutes"}
            </div>
          </button>
        ))}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-lg p-10 text-center mb-4 transition-colors ${
          dragging ? "border-amber-500 bg-amber-500/5" : "border-zinc-700"
        }`}
      >
        <p className="text-zinc-400 mb-3">Drag &amp; drop part photos, or</p>
        <label className="inline-block px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 cursor-pointer">
          Browse folder
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            // @ts-expect-error non-standard attribute for folder selection
            webkitdirectory=""
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </label>
        <label className="ml-3 inline-block px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 cursor-pointer">
          Browse files
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </label>
      </div>

      {files.length > 0 && (
        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between">
          <div>
            <span className="font-medium">{files.length.toLocaleString()}</span> images queued
            {estimate != null && (
              <span className="ml-3 text-sm text-zinc-400">
                Estimated AI cost: <span className="text-amber-400 font-medium">${estimate.toFixed(2)}</span> ({mode})
              </span>
            )}
          </div>
          <button
            onClick={() => {
              setFiles([]);
              setEstimate(null);
            }}
            className="text-sm text-zinc-400 hover:text-red-400"
          >
            Clear
          </button>
        </div>
      )}

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      <button
        onClick={submit}
        disabled={files.length === 0 || submitting}
        className="w-full py-3 rounded-md bg-amber-500 text-zinc-950 font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Uploading…" : "Queue Shipment"}
      </button>
    </div>
  );
}
