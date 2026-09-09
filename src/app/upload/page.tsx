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
import { MAX_UPLOAD_FILES, validateImageFile } from "@/lib/uploads";

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
      const incomingFiles = Array.from(incoming);
      const invalid = incomingFiles.map(validateImageFile).filter((message): message is string => Boolean(message));
      if (invalid.length) setError(invalid.slice(0, 2).join(". "));
      const imgs = incomingFiles.filter((file) => !validateImageFile(file));
      setFiles((prev) => {
        const seen = new Set(prev.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
        const next = [...prev, ...imgs.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))]
          .slice(0, MAX_UPLOAD_FILES);
        if (prev.length + imgs.length > MAX_UPLOAD_FILES) setError(`Upload up to ${MAX_UPLOAD_FILES} images at a time.`);
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
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400 mb-3">New intake</p>
        <h1 className="page-title">Create a shipment</h1>
        <p className="page-intro mt-3">Name the batch, choose how it should run, then add clean photos of one part per frame.</p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
        <div className="panel p-5 sm:p-7">
      <label htmlFor="shipment-name" className="block text-sm text-zinc-300 mb-2">Shipment name</label>
      <input
        id="shipment-name"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Shipment ${new Date().toISOString().slice(0, 10)}`}
        className="field px-3.5 py-3 mb-6"
      />

      <fieldset>
      <legend className="block text-sm text-zinc-300 mb-2">Processing mode</legend>
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {(["batch", "express"] as const).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => {
              setMode(m);
              refreshEstimate(files.length, m);
            }}
            className={`rounded-xl border px-4 py-4 text-left ${
              mode === m ? "border-amber-500/80 bg-amber-500/[0.08]" : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600"
            }`}
            aria-pressed={mode === m}
          >
            <div className="font-medium capitalize flex justify-between gap-3"><span>{m}</span><span className="text-xs text-zinc-500">{mode === m ? "Selected" : ""}</span></div>
            <div className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
              {m === "batch" ? "Queue-friendly processing for larger folders." : "Prioritised processing for smaller urgent batches."}
            </div>
          </button>
        ))}
      </div>
      </fieldset>

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
        className={`border border-dashed rounded-xl px-5 py-10 sm:py-14 text-center mb-4 transition-colors ${
          dragging ? "border-amber-500 bg-amber-500/[0.06]" : "border-zinc-600 bg-zinc-950/30"
        }`}
      >
        <div className="text-lg font-medium">Drop part photos here</div>
        <p className="text-sm text-zinc-500 mt-1 mb-5">JPEG, PNG, WebP, AVIF, or TIFF. Up to 15 MB each.</p>
        <label className="secondary-button px-4 py-2.5 cursor-pointer">
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
        <label className="ml-2 secondary-button px-4 py-2.5 cursor-pointer">
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
        <div className="mb-4 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 flex items-center justify-between gap-4">
          <div>
            <div><span className="font-medium">{files.length.toLocaleString()}</span> images ready</div>
            <div className="text-xs text-zinc-500 mt-1">{(files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB total</div>
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

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-900 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">{error}</div>}

      <button
        onClick={submit}
        disabled={files.length === 0 || submitting}
        className="primary-button w-full py-3.5 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Uploading..." : "Queue shipment"}
      </button>
        </div>

        <aside className="panel p-5 lg:sticky lg:top-24">
          <h2 className="font-medium">Run summary</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-zinc-500">Images</dt><dd className="data-value">{files.length}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-500">Mode</dt><dd className="capitalize">{mode}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-500">AI estimate</dt><dd className="data-value text-amber-300">{estimate == null ? "$0.00" : `$${estimate.toFixed(2)}`}</dd></div>
          </dl>
          <div className="mt-5 pt-5 border-t border-zinc-800 text-xs text-zinc-500 leading-relaxed">
            OpenRouter free models currently have no token charge. Account rate limits still apply.
          </div>
        </aside>
      </div>
    </div>
  );
}
