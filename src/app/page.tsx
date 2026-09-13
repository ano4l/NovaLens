import Link from "next/link";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
interface JobRow { id:number; name:string; mode:string; workflow_mode:string; status:string; image_count:number; actual_cost_usd:number; remaining:number; approved:number; created_at:string; }

export default async function HomePage() {
  const db = await getDb();
  const { rows: jobs } = await db.query<JobRow>(`SELECT j.*, (SELECT COALESCE(SUM(cost_usd),0)::float8 FROM api_logs WHERE job_id=j.id) actual_cost_usd, (SELECT COUNT(*)::int FROM items WHERE job_id=j.id AND status IN ('pending','processing','escalated')) remaining, (SELECT COUNT(*)::int FROM items WHERE job_id=j.id AND status='approved') approved FROM jobs j ORDER BY j.id DESC`);
  const totals = jobs.reduce((a,j)=>({images:a.images+j.image_count, remaining:a.remaining+j.remaining, approved:a.approved+j.approved, cost:a.cost+j.actual_cost_usd}),{images:0,remaining:0,approved:0,cost:0});
  return <div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Catalogue operations</p><h1>Batch overview</h1><p>Monitor recognition throughput, quality review, and catalogue readiness from one operational ledger.</p></div><div className="heading-actions"><Link href="/training" className="secondary-button px-4 py-3">Training memory</Link><Link href="/upload" className="primary-button px-4 py-3">New batch</Link></div></header>
    <section className="kpi-strip"><Metric label="Images processed" value={totals.images.toLocaleString()} note="all time"/><Metric label="Awaiting action" value={totals.remaining.toLocaleString()} note="in pipeline"/><Metric label="Approved" value={totals.approved.toLocaleString()} note="catalogue ready"/><Metric label="Recognition spend" value={`$${totals.cost.toFixed(4)}`} note="recorded usage"/></section>
    <section className="panel ledger-panel"><div className="section-heading"><div><p className="eyebrow">Batch ledger</p><h2>Recent operations</h2></div><span>{jobs.length} total</span></div>
      {jobs.length===0?<div className="empty-state"><strong>No batches yet</strong><p>Create an intake batch to begin recognition and review.</p><Link href="/upload" className="primary-button px-4 py-3">Create first batch</Link></div>:<div className="table-wrap"><table className="enterprise-table"><thead><tr><th>Batch</th><th>Workflow</th><th>Status</th><th>Images</th><th>Remaining</th><th>Approved</th><th>Spend</th><th></th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td><strong>{j.name}</strong><small>JOB-{String(j.id).padStart(5,"0")} · {new Date(j.created_at).toLocaleDateString("en-ZA")}</small></td><td><span className={j.workflow_mode==="training"?"mode-label training":"mode-label"}>{j.workflow_mode}</span></td><td><span className={`status-label ${j.status}`}>{j.status}</span></td><td className="data-value">{j.image_count}</td><td className="data-value">{j.remaining}</td><td className="data-value">{j.approved}</td><td className="data-value">${j.actual_cost_usd.toFixed(4)}</td><td><Link className="table-action" href={`/jobs/${j.id}`}>Open review →</Link></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
function Metric({label,value,note}:{label:string;value:string;note:string}){return <div><span>{label}</span><strong className="data-value">{value}</strong><small>{note}</small></div>}
