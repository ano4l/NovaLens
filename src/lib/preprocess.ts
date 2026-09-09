// ============================================================================
// STUDY: Keep the upload request bounded. This function validates the pixels,
// rotates from EXIF, caps the longest edge, removes metadata, and writes a
// predictable JPEG. It does NOT wait for an external segmentation service.
// Instead, background_status tells the worker whether isolation is queued.
// ============================================================================
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { UPLOAD_DIR } from "./db";

export const MAX_EDGE = 1024;

// STUDY: Note the filename handling: sanitize user-supplied names to a safe
// character set, prefix with a timestamp for uniqueness, normalize the
// extension to .jpg because we RE-ENCODE (a 'photo.png' would actually contain
// JPEG bytes). Uploaded files are untrusted input — treat the name like you
// treat the bytes.
export async function preprocessImage(
  jobId: number,
  originalName: string,
  buffer: Buffer
): Promise<{ relPath: string; cutoutPath: null; backgroundStatus: "pending" | "not_configured" }> {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relPath = path.join(String(jobId), `${Date.now()}_${safeName.replace(/\.[^.]+$/, "")}.jpg`);
  const absPath = path.join(UPLOAD_DIR, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  await sharp(buffer)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toFile(absPath);

  return { relPath, cutoutPath: null, backgroundStatus: process.env.REMOVE_BG_API_KEY ? "pending" : "not_configured" };
}

export async function removeBackgroundFromStoredImage(relPath: string): Promise<{ cutoutPath: string | null; backgroundStatus: "removed" | "not_configured" | "failed" }> {
  // STUDY: Background removal happens immediately before recognition in the
  // worker. A batch of 100 uploads therefore returns quickly, while worker
  // concurrency naturally limits external calls. Failure is explicit and
  // non-fatal: the already-normalized JPEG remains valid recognition input.
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) return { cutoutPath: null, backgroundStatus: "not_configured" };
  const absPath = absFromRel(relPath);
  const cutoutPath = relPath.replace(/\.jpg$/, ".cutout.png");
  const cutoutAbsPath = absFromRel(cutoutPath);
  try {
    const normalized = await sharp(absPath).jpeg({ quality: 88 }).toBuffer();
    const form = new FormData();
    form.set("image_file", new Blob([normalized], { type: "image/jpeg" }), "part.jpg");
    form.set("size", "auto");
    form.set("format", "png");
    form.set("type", "product");
    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });
    if (!response.ok) throw new Error(`remove.bg returned ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const cutout = Buffer.from(await response.arrayBuffer());
    await sharp(cutout).png({ compressionLevel: 8 }).toFile(cutoutAbsPath);
    await sharp(cutout).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toFile(absPath);
    return { cutoutPath, backgroundStatus: "removed" };
  } catch (error) {
    console.error("Background removal failed", error);
    return { cutoutPath: null, backgroundStatus: "failed" };
  }
}

// STUDY: We store RELATIVE paths in the DB and resolve to absolute at use
// time. Move the data directory (or swap disk for GCS) and existing rows still
// work. Small decision, big migration-savings.
export function absFromRel(relPath: string): string {
  return path.join(UPLOAD_DIR, relPath);
}
