// ============================================================================
// STUDY: A SERVER COMPONENT (no "use client"). This code runs only on the
// server: it queries SQLite directly and renders HTML. No loading spinner, no
// useEffect, no API round-trip for the first paint. Compare with
// ReviewTable.tsx — data crosses the server→client boundary ONCE, as the
// `initialItems` prop.
// ============================================================================
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import ReviewTable from "./ReviewTable";
import { Item, Job } from "@/lib/types";

// STUDY: Next tries to prerender pages at build time. force-dynamic says
// "this page reflects live DB state — render it fresh on every request".
export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
  if (!job) notFound();

  const items = db
    .prepare(
      `SELECT * FROM items WHERE job_id = ?
       ORDER BY (confidence IS NULL) DESC,
         CASE confidence WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, id ASC`
    )
    .all(id) as Item[];

  const cost = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) as total_cost,
              COALESCE(SUM(input_tokens), 0) as input_tokens,
              COALESCE(SUM(output_tokens), 0) as output_tokens
       FROM api_logs WHERE job_id = ?`
    )
    .get(id) as { total_cost: number; input_tokens: number; output_tokens: number };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{job.name}</h1>
          <div className="text-sm text-zinc-400">
            #{job.id} · {job.mode} mode · {job.image_count.toLocaleString()} images
            {job.escalation_rate != null && ` · ${(job.escalation_rate * 100).toFixed(1)}% escalated`}
          </div>
        </div>
        <div className="flex gap-2">
          {["csv", "shopify", "woocommerce"].map((f) => (
            <a
              key={f}
              href={`/api/jobs/${job.id}/export?format=${f}`}
              className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm capitalize"
            >
              Export {f === "csv" ? "CSV" : f}
            </a>
          ))}
        </div>
      </div>

      {job.guardrail_breached === 1 && (
        <div className="mb-4 rounded-md border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          Guardrail alert: actual cost exceeded the estimate beyond the configured margin, or the
          escalation rate is outside the expected band. Review photo quality or model config.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Estimated cost" value={`$${(job.est_cost_usd ?? 0).toFixed(2)}`} />
        <Stat label="Actual cost" value={`$${cost.total_cost.toFixed(4)}`} warn={job.guardrail_breached === 1} />
        <Stat label="Input tokens" value={cost.input_tokens.toLocaleString()} />
        <Stat label="Output tokens" value={cost.output_tokens.toLocaleString()} />
      </div>

      <ReviewTable jobId={job.id} initialItems={items} jobStatus={job.status} />
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-4 ${warn ? "border-red-800 bg-red-950/30" : "border-zinc-800 bg-zinc-900"}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
