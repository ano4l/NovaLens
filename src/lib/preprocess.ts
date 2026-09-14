// ============================================================================
// STUDY: Keep the upload request bounded. This function validates the pixels,
// rotates from EXIF, caps the longest edge, removes metadata, and writes a
// predictable JPEG. Recognition uses this durable normalized image directly.
// ============================================================================
import sharp from "sharp";

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
): Promise<{ relPath: string; image: Buffer; cutoutPath: null; backgroundStatus: "ready" }> {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relPath = `${jobId}/${Date.now()}_${safeName.replace(/\.[^.]+$/, "")}.jpg`;
  const image = await sharp(buffer)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return { relPath, image, cutoutPath: null, backgroundStatus: "ready" };
}
