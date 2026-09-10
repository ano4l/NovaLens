import Link from "next/link";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface JobRow {
  id: number;
  name: string;
  mode: string;
  status: string;
  image_count: number;
  est_cost_usd: number | null;
  actual_cost_usd: number;
  escalation_rate: number | null;
  guardrail_breached: number;
  remaining: number;
  approved: number;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  queued: "border-zinc-600 text-zinc-300",
  processing: "border-sky-700/70 text-sky-300 bg-sky-950/30",
  review: "border-amber-700/70 text-amber-300 bg-amber-950/30",
  done: "border-emerald-700/70 text-emerald-300 bg-emerald-950/30",
};

function formatDate(value: string | Date) {
  if (value instanceof Date) return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(value);
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(date);
}

export default async function HomePage() {
  const db = await getDb();
  const { rows: jobs } = await db.query<JobRow>(
      `SELECT j.*,
        (SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM api_logs WHERE job_id = j.id) as actual_cost_usd,
        (SELECT COUNT(*)::int FROM items WHERE job_id = j.id AND status IN ('pending','processing','escalated')) as remaining,
        (SELECT COUNT(*)::int FROM items WHERE job_id = j.id AND status = 'approved') as approved
       FROM jobs j ORDER BY j.id DESC`
  );

  const totals = jobs.reduce(
    (sum, job) => ({
      images: sum.images + job.image_count,
      remaining: sum.remaining + job.remaining,
      approved: sum.approved + job.approved,
      cost: sum.cost + job.actual_cost_usd,
    }),
    { images: 0, remaining: 0, approved: 0, cost: 0 }
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400 mb-3">Inventory operations</p>
          <h1 className="page-title">Shipments</h1>
          <p className="page-intro mt-3">Track each photo batch from intake through AI tagging, human review, and catalog export.</p>
        </div>
        <Link
          href="/upload"
          className="primary-button px-4 py-2.5 self-start sm:self-auto"
        >
          New upload
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-zinc-800/90">
        <Summary label="Total images" value={totals.images.toLocaleString()} />
        <Summary label="Awaiting review" value={totals.remaining.toLocaleString()} />
        <Summary label="Approved" value={totals.approved.toLocaleString()} />
        <Summary label="AI spend" value={`$${totals.cost.toFixed(4)}`} />
      </div>

      {jobs.length === 0 ? (
        <div className="panel p-10 sm:p-14 text-center">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 font-semibold">01</div>
          <h2 className="text-lg font-semibold">Start with a photo batch</h2>
          <p className="text-sm text-zinc-400 mt-2 mb-6">Upload up to 100 part images. NovaLens will prepare, tag, and route uncertain results for review.</p>
          <Link href="/upload" className="primary-button px-4 py-2.5">Upload images</Link>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-zinc-500 text-left border-b border-zinc-800">
              <tr>
                <th className="px-5 py-3.5 font-medium">Shipment</th>
                <th className="px-4 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 font-medium text-right">Images</th>
                <th className="px-4 py-3.5 font-medium text-right">Remaining</th>
                <th className="px-4 py-3.5 font-medium text-right">Approved</th>
                <th className="px-4 py-3.5 font-medium text-right">Actual cost</th>
                <th className="px-4 py-3.5 font-medium text-right">Escalation</th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-white/[0.025]">
                  <td className="px-5 py-4 min-w-[15rem]">
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:text-amber-300">{j.name}</Link>
                    <div className="text-xs text-zinc-500 mt-1">Job {j.id} / {formatDate(j.created_at)} / {j.mode}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex border text-xs px-2.5 py-1 rounded-full capitalize ${STATUS_STYLE[j.status] ?? "border-zinc-600 text-zinc-300"}`}>
                      {j.status}
                    </span>
                    {j.guardrail_breached === 1 && (
                      <span className="ml-2 text-xs text-red-300" title="Cost or escalation guardrail breached">
                        alert
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right data-value">{j.image_count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right data-value">{j.remaining.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right data-value">{j.approved.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right data-value">${j.actual_cost_usd.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right data-value">
                    {j.escalation_rate == null ? "-" : `${(j.escalation_rate * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/jobs/${j.id}`} className="text-amber-300 hover:text-amber-200 font-medium">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-5 pr-4 border-r border-zinc-800/90 last:border-r-0 even:border-r-0 lg:even:border-r lg:last:border-r-0">
      <div className="text-xs text-zinc-500 mb-2">{label}</div>
      <div className="data-value text-xl sm:text-2xl font-medium">{value}</div>
    </div>
  );
}
