import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
const KINDS = new Set(["cataloguing", "fitment", "condition", "brand", "safety", "general"]);

function idFrom(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "Invalid guideline ID" }, { status: 400 });
  const body = await req.json() as Record<string, unknown>;
  const sets: string[] = []; const values: unknown[] = [];
  if ("title" in body) { const v = typeof body.title === "string" ? body.title.trim() : ""; if (!v || v.length > 120) return NextResponse.json({ error: "Title must be 1–120 characters" }, { status: 400 }); values.push(v); sets.push(`title = $${values.length}`); }
  if ("instruction" in body) { const v = typeof body.instruction === "string" ? body.instruction.trim() : ""; if (!v || v.length > 2000) return NextResponse.json({ error: "Instruction must be 1–2,000 characters" }, { status: 400 }); values.push(v); sets.push(`instruction = $${values.length}`); }
  if ("kind" in body) { if (typeof body.kind !== "string" || !KINDS.has(body.kind)) return NextResponse.json({ error: "Invalid category" }, { status: 400 }); values.push(body.kind); sets.push(`kind = $${values.length}`); }
  if ("priority" in body) { const v = Number(body.priority); if (!Number.isInteger(v) || v < 1 || v > 100) return NextResponse.json({ error: "Priority must be 1–100" }, { status: 400 }); values.push(v); sets.push(`priority = $${values.length}`); }
  if ("active" in body) { if (typeof body.active !== "boolean") return NextResponse.json({ error: "Active must be true or false" }, { status: 400 }); values.push(body.active); sets.push(`active = $${values.length}`); }
  if (!sets.length) return NextResponse.json({ error: "No valid changes" }, { status: 400 });
  values.push(id);
  const db = await getDb();
  const { rows } = await db.query(`UPDATE training_guidelines SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
  return rows[0] ? NextResponse.json({ guideline: rows[0] }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "Invalid guideline ID" }, { status: 400 });
  const db = await getDb();
  const result = await db.query("DELETE FROM training_guidelines WHERE id = $1", [id]);
  return result.rowCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
