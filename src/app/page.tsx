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
  queued: "bg-zinc-700",
  processing: "bg-blue-600",
  review: "bg-amber-600",
  done: "bg-emerald-600",
};

export default function HomePage() {
  const jobs = getDb()
    .prepare(
      `SELECT j.*,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM api_logs WHERE job_id = j.id) as actual_cost_usd,
        (SELECT COUNT(*) FROM items WHERE job_id = j.id AND status IN ('pending','processing','escalated')) as remaining,
        (SELECT COUNT(*) FROM items WHERE job_id = j.id AND status = 'approved') as approved
       FROM jobs j ORDER BY j.id DESC`
    )
    .all() as JobRow[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Shipments</h1>
        <Link
          href="/upload"
          className="px-4 py-2 rounded-md bg-amber-500 text-zinc-950 font-medium hover:bg-amber-400"
        >
          New Upload
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="border border-dashed border-zinc-700 rounded-lg p-12 text-center text-zinc-500">
          No shipments yet. Upload a folder of part photos to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-left">
              <tr>
                <th className="px-4 py-3">Shipment</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Images</th>
                <th className="px-4 py-3 text-right">Remaining</th>
                <th className="px-4 py-3 text-right">Approved</th>
                <th className="px-4 py-3 text-right">Est. Cost</th>
                <th className="px-4 py-3 text-right">Actual Cost</th>
                <th className="px-4 py-3 text-right">Escalation</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{j.name}</div>
                    <div className="text-xs text-zinc-500">#{j.id} · {j.created_at}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${j.mode === "batch" ? "bg-zinc-700" : "bg-violet-600"}`}>
                      {j.mode}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLE[j.status] ?? "bg-zinc-700"}`}>
                      {j.status}
                    </span>
                    {j.guardrail_breached === 1 && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-700" title="Cost or escalation guardrail breached">
                        alert
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{j.image_count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{j.remaining.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{j.approved.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">${(j.est_cost_usd ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">${j.actual_cost_usd.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right">
                    {j.escalation_rate == null ? "—" : `${(j.escalation_rate * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/jobs/${j.id}`} className="text-amber-400 hover:underline">
                      Open
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
