// ============================================================================
// STUDY: The upload form. Notice THREE input affordances for the same data —
// drag-and-drop, folder picker (non-standard `webkitdirectory` attribute), and
// file picker — all funneling into one addFiles() function. One ingestion
// path, many UI doors. Also note refreshEstimate(): cost preview updates on
// every file/mode change so users see the price BEFORE committing.
// ============================================================================
"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MAX_UPLOAD_FILES, validateImageFile } from "@/lib/uploads";
import { prepareUploadFile } from "@/lib/client-image";

export default function UploadPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"batch" | "express">("batch");
  const [workflowMode, setWorkflowMode] = useState<"production" | "training">("production");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateUnavailable, setEstimateUnavailable] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("workflow") === "training") {
      setWorkflowMode("training"); setMode("batch");
    }
  }, []);

  const refreshEstimate = useCallback(async (count: number, m: string) => {
    if (count === 0) {
      setEstimate(null);
      setEstimateUnavailable(false);
      return;
    }
    try {
      const res = await fetch(`/api/estimate?count=${count}&mode=${m}`);
      if (!res.ok) throw new Error("Estimate request failed");
      const data = await res.json() as { estCostUsd?: unknown };
      if (typeof data.estCostUsd !== "number" || !Number.isFinite(data.estCostUsd)) {
        throw new Error("Estimate response was invalid");
      }
      setEstimate(data.estCostUsd);
      setEstimateUnavailable(false);
    } catch {
      // Cost preview is helpful but must never make image selection or upload
      // unusable when the database or estimate endpoint is temporarily down.
      setEstimate(null);
      setEstimateUnavailable(true);
    }
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
      setUploadProgress(0);
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || `Shipment ${new Date().toISOString().slice(0, 10)}`, mode, workflow_mode: workflowMode, image_count: files.length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const failures: string[] = [];
      for (let index = 0; index < files.length; index++) {
        try {
          const prepared = await prepareUploadFile(files[index]);
          const form = new FormData();
          form.set("file", prepared);
          const upload = await fetch(`/api/jobs/${data.jobId}/items`, { method: "POST", body: form });
          const result = await upload.json();
          if (!upload.ok) throw new Error(result.error ?? "Upload failed");
        } catch (uploadError) {
          failures.push(`${files[index].name}: ${uploadError instanceof Error ? uploadError.message : "failed"}`);
        }
        setUploadProgress(index + 1);
      }
      if (failures.length === files.length) throw new Error("None of the selected product photos could be uploaded.");
      if (failures.length) sessionStorage.setItem(`novalens-upload-warning-${data.jobId}`, `${failures.length} image${failures.length === 1 ? "" : "s"} could not be uploaded.`);
      router.push(`/jobs/${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="eyebrow">New intake</p>
        <h1>Create a recognition batch</h1>
        <p>Name the batch, choose its operating workflow, then add clear photos with one part per frame.</p></div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem] gap-6 items-start">
        <div className="panel intake-panel">
      <label htmlFor="shipment-name" className="form-label">Batch name</label>
      <input
        id="shipment-name"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Shipment ${new Date().toISOString().slice(0, 10)}`}
        className="field px-3.5 py-3 mb-6"
      />

      <fieldset>
      <legend className="form-label">Operating mode</legend>
      <div className="mode-grid">
        {([
          { id: "standard", label: "Standard batch", note: "Queue-efficient processing for routine catalogue work." },
          { id: "express", label: "Express", note: "Prioritised processing for urgent smaller batches." },
          { id: "training", label: "Training", note: "Process normally and remember reviewed corrections as examples." },
        ] as const).map((choice) => (
          <button
            type="button"
            key={choice.id}
            onClick={() => {
              const nextMode = choice.id === "express" ? "express" : "batch";
              setMode(nextMode); setWorkflowMode(choice.id === "training" ? "training" : "production");
              refreshEstimate(files.length, nextMode);
            }}
            className={`mode-card ${(choice.id === "training" ? workflowMode === "training" : workflowMode === "production" && mode === (choice.id === "standard" ? "batch" : "express")) ? "selected" : ""}`}
            aria-pressed={choice.id === "training" ? workflowMode === "training" : workflowMode === "production" && mode === (choice.id === "standard" ? "batch" : "express")}
          >
            <span className="mode-check" /> <strong>{choice.label}</strong><small>{choice.note}</small>
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
        className={`upload-dropzone ${dragging ? "dragging" : ""}`}
      >
        <div className="text-lg font-medium">Drop part photos here</div>
        <p>JPEG, PNG, WebP, AVIF, or TIFF · up to 15 MB each</p>
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
              setEstimateUnavailable(false);
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
        {submitting ? `Uploading ${uploadProgress}/${files.length}…` : "Queue shipment"}
      </button>
        </div>

        <aside className="panel run-summary">
          <h2 className="font-medium">Run summary</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-zinc-500">Images</dt><dd className="data-value">{files.length}</dd></div>
            <div className="flex justify-between gap-4"><dt>Priority</dt><dd className="capitalize">{mode}</dd></div>
            <div className="flex justify-between gap-4"><dt>Workflow</dt><dd className="capitalize">{workflowMode}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-zinc-500">AI estimate</dt><dd className="data-value text-amber-300">{estimateUnavailable ? "Unavailable" : estimate == null ? "$0.00" : `$${estimate.toFixed(2)}`}</dd></div>
          </dl>
          <div className="summary-note">
            Recognition uses live Google Lens matches through SerpApi, with GPT-4o or Claude Sonnet as backup intelligence. {workflowMode === "training" ? "Reviewed field corrections become durable operating examples." : "Production edits remain audited but do not enter training memory."}
          </div>
        </aside>
      </div>
    </div>
  );
}
