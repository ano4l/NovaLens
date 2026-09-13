import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT e.*, j.name AS job_name FROM training_examples e LEFT JOIN jobs j ON j.id = e.job_id ORDER BY e.created_at DESC LIMIT 250`
  );
  return NextResponse.json({ examples: rows });
}
