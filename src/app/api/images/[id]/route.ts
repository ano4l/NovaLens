// ============================================================================
// STUDY: Serving private files. Images live on local disk OUTSIDE Next's
// public/ folder — so nothing is reachable without going through this route.
// In production you'd swap this for GCS signed URLs; the <img> tags in the UI
// wouldn't change at all (they already point at /api/images/[id]).
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, UPLOAD_DIR } from "@/lib/db";
import { Item } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getDb().prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wantsCutout = req.nextUrl.searchParams.get("variant") === "cutout";
  const storedPath = wantsCutout ? item.cutout_path : item.image_path;
  if (!storedPath) return NextResponse.json({ error: "Cutout not available" }, { status: 404 });
  const abs = path.resolve(UPLOAD_DIR, storedPath);
  // STUDY: Path-traversal guard. image_path comes from our own DB, but defense
  // in depth says: never join a stored path and trust it. If the resolved path
  // isn't under UPLOAD_DIR, refuse. Exercise 8 in CASE_STUDY.md asks you to
  // spot what ELSE is missing here (hint: who is allowed to see which image?).
  const uploadRoot = `${path.resolve(UPLOAD_DIR)}${path.sep}`;
  if (!abs.startsWith(uploadRoot) || !fs.existsSync(abs)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buf = fs.readFileSync(abs);
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": wantsCutout ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=3600" },
  });
}
