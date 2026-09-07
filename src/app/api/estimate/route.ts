// ============================================================================
// STUDY: A pure-function endpoint: request params in, price out, no database
// writes. The upload page calls it live as you pick files — cost transparency
// BEFORE committing is a product feature, and it's cheap because estimateJobCostUSD
// does no I/O of its own (settings read aside).
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { estimateJobCostUSD } from "@/lib/cost";
import { JobMode } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const count = Math.max(0, Number(req.nextUrl.searchParams.get("count") ?? 0));
  const mode = (req.nextUrl.searchParams.get("mode") === "express" ? "express" : "batch") as JobMode;
  return NextResponse.json({ count, mode, estCostUsd: estimateJobCostUSD(count, mode) });
}
