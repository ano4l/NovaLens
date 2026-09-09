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
  const approved = items.filter((item) => item.status === "approved").length;
  const reviewCount = items.filter((item) => item.needs_review === 1 && item.status !== "approved").length;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400 mb-3">Review queue</p>
          <h1 className="page-title">{job.name}</h1>
          <div className="text-sm text-zinc-500 mt-3">
            Job {job.id} / {job.mode} / {job.image_count.toLocaleString()} images
            {job.escalation_rate != null && ` / ${(job.escalation_rate * 100).toFixed(1)}% escalated`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["csv", "shopify", "woocommerce"].map((f) => (
            <a
              key={f}
              href={`/api/jobs/${job.id}/export?format=${f}`}
              className="job-export-link secondary-button px-3.5 py-2.5 text-sm capitalize"
            >
              Export {f === "csv" ? "CSV" : f}
            </a>
          ))}
        </div>
      </div>

      {job.guardrail_breached === 1 && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          Guardrail alert: actual cost exceeded the estimate beyond the configured margin, or the
          escalation rate is outside the expected band. Review photo quality or model config.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 border-y border-zinc-800/90">
        <Stat label="Approved" value={`${approved}/${items.length}`} />
        <Stat label="Needs review" value={reviewCount.toLocaleString()} warn={reviewCount > 0} />
        <Stat label="Estimated cost" value={`$${(job.est_cost_usd ?? 0).toFixed(2)}`} />
        <Stat label="Actual cost" value={`$${cost.total_cost.toFixed(4)}`} warn={job.guardrail_breached === 1} />
        <Stat label="Tokens" value={(cost.input_tokens + cost.output_tokens).toLocaleString()} />
      </div>

      <ReviewTable jobId={job.id} initialItems={items} jobStatus={job.status} />
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="py-5 pr-4 border-r border-zinc-800/90 last:border-r-0">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`data-value text-xl font-medium mt-1 ${warn ? "text-red-300" : ""}`}>{value}</div>
    </div>
  );
}
