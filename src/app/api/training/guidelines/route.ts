import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
const KINDS = new Set(["cataloguing", "fitment", "condition", "brand", "safety", "general"]);

function validate(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "general";
  const priority = Number(body.priority ?? 50);
  if (!title || title.length > 120) throw new Error("Title must be 1–120 characters");
  if (!instruction || instruction.length > 2000) throw new Error("Instruction must be 1–2,000 characters");
  if (!KINDS.has(kind)) throw new Error("Choose a valid guideline category");
  if (!Number.isInteger(priority) || priority < 1 || priority > 100) throw new Error("Priority must be 1–100");
  return { title, instruction, kind, priority };
}

export async function GET() {
  const db = await getDb();
  const { rows } = await db.query("SELECT * FROM training_guidelines ORDER BY active DESC, priority DESC, updated_at DESC");
  return NextResponse.json({ guidelines: rows });
}

export async function POST(req: NextRequest) {
  try {
    const value = validate(await req.json());
    const db = await getDb();
    const { rows } = await db.query(
      `INSERT INTO training_guidelines (title, instruction, kind, priority) VALUES ($1,$2,$3,$4) RETURNING *`,
      [value.title, value.instruction, value.kind, value.priority]
    );
    return NextResponse.json({ guideline: rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid guideline" }, { status: 400 });
  }
}
