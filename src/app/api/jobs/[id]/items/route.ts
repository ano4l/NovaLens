import { after, NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { preprocessImage } from "@/lib/preprocess";
import { saveItemImage } from "@/lib/image-store";
import { validateImageFile } from "@/lib/uploads";
import { estimateJobCostUSD } from "@/lib/cost";
import { processQueueOnce } from "@/lib/worker";
import { JobMode } from "@/lib/types";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await enforceRateLimit(req, "upload-item", 200);
  if (limited) return limited;
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
  const db = await getDb();
  const { rows: jobs } = await db.query<{ mode: JobMode; image_count: number }>("SELECT mode, image_count FROM jobs WHERE id = $1", [jobId]);
  const job = jobs[0];
  if (!job) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (job.image_count >= 100) return NextResponse.json({ error: "This batch already has 100 images" }, { status: 409 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No image provided" }, { status: 400 });
  const validation = validateImageFile(file);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });

  let itemId: number | null = null;
  try {
    const processed = await preprocessImage(jobId, file.name, Buffer.from(await file.arrayBuffer()));
    const { rows } = await db.query<{ id: number }>(
      "INSERT INTO items (job_id, filename, image_path, cutout_path, background_status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [jobId, file.name, processed.relPath, processed.cutoutPath, processed.backgroundStatus]
    );
    itemId = rows[0].id;
    await saveItemImage(itemId, processed.image);
    const { rows: counts } = await db.query<{ image_count: number }>(
      "UPDATE jobs SET image_count = image_count + 1, updated_at = NOW() WHERE id = $1 RETURNING image_count",
      [jobId]
    );
    const nextCount = counts[0].image_count;
    const estimate = await estimateJobCostUSD(nextCount, job.mode);
    await db.query("UPDATE jobs SET est_cost_usd = $1, updated_at = NOW() WHERE id = $2", [estimate, jobId]);
    after(() => processQueueOnce(jobId).catch((error) => console.error("[queue] upload trigger failed", error)));
    return NextResponse.json({ itemId, imageCount: nextCount });
  } catch (error) {
    if (itemId) await db.query("DELETE FROM items WHERE id = $1", [itemId]);
    console.error("Product upload failed", error);
    return NextResponse.json({ error: "The product image could not be prepared" }, { status: 422 });
  }
}
