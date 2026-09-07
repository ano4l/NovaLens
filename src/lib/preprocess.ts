// ============================================================================
// STUDY: Never feed a raw user upload to an expensive API. This one function
// does four defensive things before any Gemini call: rotate per EXIF, cap the
// longest edge at 1024px (what the model actually uses — bigger input = burned
// money), flatten onto white, and re-encode as JPEG. Predictable input =
// predictable token cost.
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
): Promise<{ relPath: string }> {
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

  return { relPath };
}

// STUDY: We store RELATIVE paths in the DB and resolve to absolute at use
// time. Move the data directory (or swap disk for GCS) and existing rows still
// work. Small decision, big migration-savings.
export function absFromRel(relPath: string): string {
  return path.join(UPLOAD_DIR, relPath);
}
