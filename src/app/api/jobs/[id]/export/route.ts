// ============================================================================
// STUDY: ONE source of truth (items where status='approved'), THREE output
// shapes. The data never forks — only the presentation does. When a customer
// asks for a fourth export format, you add a branch here, not a new pipeline.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Item } from "@/lib/types";

export const runtime = "nodejs";

// STUDY: CSV escaping is the kind of thing people skip in demos and regret in
// production: a brand like `ACME, Inc.` or a note with a quote breaks naive
// join(',') output. This 3-line function is the whole fix.
function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

// STUDY: Listing title construction is SHARED across formats (Shopify and
// Woo both reuse it). Build display strings once, feed every export from them.
function title(i: Item): string {
  const years =
    i.year_start && i.year_end ? `${i.year_start}-${i.year_end}` : i.year_start ? String(i.year_start) : "";
  return [years, i.brand ?? "", i.part_name ?? ""].filter(Boolean).join(" ").trim() || i.filename;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as { name: string } | undefined;
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = db
    .prepare("SELECT * FROM items WHERE job_id = ? AND status = 'approved' ORDER BY id ASC")
    .all(id) as Item[];

  let headers: string[];
  let rows: unknown[][];
  let filename: string;

  if (format === "shopify") {
    headers = ["Handle", "Title", "Body (HTML)", "Vendor", "Product Type", "Tags", "Status", "Image Src"];
    rows = items.map((i) => [
      title(i).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title(i),
      i.condition_notes ?? "",
      i.brand ?? "",
      i.part_name ?? "",
      [i.brand, i.part_name, i.year_start && i.year_end ? `${i.year_start}-${i.year_end}` : null]
        .filter(Boolean)
        .join(", "),
      "active",
      `/api/images/${i.id}`,
    ]);
    filename = `novalens-job-${id}-shopify.csv`;
  } else if (format === "woocommerce") {
    headers = ["Name", "Description", "Categories", "Tags", "Published", "Attribute 1 name", "Attribute 1 value(s)"];
    rows = items.map((i) => [
      title(i),
      i.condition_notes ?? "",
      i.part_name ?? "",
      i.brand ?? "",
      1,
      "Fitment Years",
      i.year_start && i.year_end ? `${i.year_start}-${i.year_end}` : "",
    ]);
    filename = `novalens-job-${id}-woocommerce.csv`;
  } else {
    headers = [
      "id",
      "filename",
      "brand",
      "part_name",
      "year_start",
      "year_end",
      "condition_notes",
      "confidence",
      "tier",
      "needs_review",
    ];
    rows = items.map((i) => [
      i.id,
      i.filename,
      i.brand,
      i.part_name,
      i.year_start,
      i.year_end,
      i.condition_notes,
      i.confidence,
      i.tier,
      i.needs_review,
    ]);
    filename = `novalens-job-${id}.csv`;
  }

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
