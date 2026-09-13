// ============================================================================
// STUDY: Keep the upload request bounded. This function validates the pixels,
// rotates from EXIF, caps the longest edge, removes metadata, and writes a
// predictable JPEG. It does NOT wait for an external segmentation service.
// Instead, background_status tells the worker whether isolation is queued.
// ============================================================================
import sharp from "sharp";
import { getItemImage, saveProcessedImages } from "./image-store";

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
): Promise<{ relPath: string; image: Buffer; cutoutPath: null; backgroundStatus: "pending" | "not_configured" }> {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relPath = `${jobId}/${Date.now()}_${safeName.replace(/\.[^.]+$/, "")}.jpg`;
  const image = await sharp(buffer)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return { relPath, image, cutoutPath: null, backgroundStatus: process.env.OPENROUTER_API_KEY ? "pending" : "not_configured" };
}

export async function removeBackgroundFromStoredImage(itemId: number, relPath: string): Promise<{ cutoutPath: string | null; backgroundStatus: "removed" | "not_configured" | "failed" }> {
  // STUDY: Background removal happens immediately before recognition in the
  // worker. A batch of 100 uploads therefore returns quickly, while worker
  // concurrency naturally limits external calls. Failure is explicit and
  // non-fatal: the already-normalized JPEG remains valid recognition input.
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { cutoutPath: null, backgroundStatus: "not_configured" };
  const cutoutPath = relPath.replace(/\.jpg$/, ".cutout.png");
  const stored = await getItemImage(itemId);
  if (!stored) return { cutoutPath: null, backgroundStatus: "failed" };
  try {
    const normalized = await sharp(stored.data).jpeg({ quality: 88 }).toBuffer();
    const prompt = "Remove the entire background from this automotive product photo. Return only the exact item isolated on a transparent background. Preserve its shape, details, colours, orientation, and visible condition. Do not invent, repair, crop, or add any part.";
    const cutout = await openRouterBackgroundEdit(apiKey, "google/gemini-3.1-flash-lite-image", normalized, prompt);
    const png = await sharp(cutout).png({ compressionLevel: 8 }).toBuffer();
    const recognitionImage = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    await saveProcessedImages(itemId, recognitionImage, png);
    return { cutoutPath, backgroundStatus: "removed" };
  } catch (error) {
    try {
      const normalized = await sharp(stored.data).jpeg({ quality: 88 }).toBuffer();
      const cutout = await openRouterBackgroundEdit(apiKey, "google/gemini-3.1-flash-image", normalized, "Isolate this automotive product by removing its background. Return the exact item on transparency; preserve all visible details and do not invent anything.");
      const png = await sharp(cutout).png({ compressionLevel: 8 }).toBuffer();
      const recognitionImage = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
      await saveProcessedImages(itemId, recognitionImage, png);
      return { cutoutPath, backgroundStatus: "removed" };
    } catch (fallbackError) {
      console.error("OpenRouter background removal failed", error, fallbackError);
      return { cutoutPath: null, backgroundStatus: "failed" };
    }
  }
}

async function openRouterBackgroundEdit(apiKey: string, model: string, image: Buffer, prompt: string): Promise<Buffer> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", "X-Title": "NovaLens" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } }] }],
      modalities: ["text", "image"],
      max_tokens: 1200,
      provider: { require_parameters: true, data_collection: "deny" },
    }),
  });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown; images?: Array<{ image_url?: { url?: string } }> } }>; error?: { message?: string } };
  if (!response.ok) throw new Error(`OpenRouter ${model} returned ${response.status}: ${payload.error?.message ?? "request failed"}`);
  const message = payload.choices?.[0]?.message;
  const candidates = [...(Array.isArray(message?.images) ? message.images.map((image) => image.image_url?.url) : []), ...(Array.isArray(message?.content) ? (message.content as Array<{ type?: string; image_url?: { url?: string }; image?: { url?: string } }>).map((part) => part.image_url?.url ?? part.image?.url) : [])].filter(Boolean) as string[];
  const dataUrl = candidates.find((value) => value.startsWith("data:image/"));
  if (!dataUrl) throw new Error(`OpenRouter ${model} returned no image output`);
  const encoded = dataUrl.split(",")[1];
  if (!encoded) throw new Error(`OpenRouter ${model} returned an invalid image output`);
  return Buffer.from(encoded, "base64");
}
