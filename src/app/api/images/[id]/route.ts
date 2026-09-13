// ============================================================================
// Product images are held durably outside the public asset tree and are served
// only through this route. The UI stays unchanged when storage moves again.
// ============================================================================
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { Item } from "@/lib/types";
import { getItemImage } from "@/lib/image-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const { rows } = await db.query<Item>("SELECT * FROM items WHERE id = $1", [id]);
  const item = rows[0];
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wantsCutout = req.nextUrl.searchParams.get("variant") === "cutout";
  if (wantsCutout && !item.cutout_path) return NextResponse.json({ error: "Cutout not available" }, { status: 404 });
  const stored = await getItemImage(item.id, wantsCutout);
  if (!stored) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(stored.data), {
    headers: { "Content-Type": stored.contentType, "Cache-Control": "private, max-age=3600" },
  });
}
