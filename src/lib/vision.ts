import sharp from "sharp";
import { Confidence, RecognitionContext, RecognitionField, TagCallResult, TagResult } from "./types";
import { RECOGNITION_FIELDS } from "./recognition";

const SERPAPI_IMAGE_URL = "https://serpapi.com/image";
const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const TIMEOUT_MS = 90_000;

type LensMatch = { title?: string; link?: string; source?: string; exact_matches?: boolean; price?: { value?: string } };
type LensPayload = { search_metadata?: { status?: string }; error?: string; visual_matches?: LensMatch[]; exact_matches?: LensMatch[]; products_results?: LensMatch[]; related_content?: Array<{ query?: string }> };

export interface VisionClient {
  tagImage(image: Buffer, tier: 1 | 2, context?: RecognitionContext): Promise<TagCallResult>;
  recheckField(image: Buffer, field: RecognitionField, context?: RecognitionContext): Promise<TagCallResult>;
}

function timeout() { const controller = new AbortController(); return { controller, timer: setTimeout(() => controller.abort(), TIMEOUT_MS) }; }
async function compactForLens(image: Buffer) { return image.length <= 480_000 ? image : sharp(image).resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 58, mozjpeg: true }).toBuffer(); }

function lensCandidateCount(payload: LensPayload): number {
  return [...(payload.exact_matches ?? []), ...(payload.products_results ?? []), ...(payload.visual_matches ?? [])]
    .filter((match) => match.title)
    .slice(0, 5).length;
}

function lensResult(payload: LensPayload, latencyMs: number, focus?: RecognitionField): TagCallResult {
  const candidates = lensCandidateCount(payload);
  const note = candidates ? "Google Lens found match candidates. Review the catalogue fields." : "Google Lens found no usable match candidates.";
  const field_confidence = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, 0.15])) as Record<RecognitionField, number>;
  const field_evidence = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, focus && field !== focus ? "Not rechecked in this Lens search" : note.slice(0, 240)])) as Record<RecognitionField, string>;
  const result: TagResult = { brand: "", vehicle_model: "", part_name: "", year_start: null, year_end: null, condition_notes: "", confidence: "low", needs_review: true, field_confidence, field_evidence };
  return { result, model: "serpapi-google-lens", inputTokens: 0, outputTokens: 0, latencyMs };
}

class SerpApiLensClient implements VisionClient {
  constructor(private apiKey: string) {}
  async tagImage(image: Buffer, _tier: 1 | 2, _context?: RecognitionContext) { return this.search(image); }
  async recheckField(image: Buffer, field: RecognitionField, _context?: RecognitionContext) { return this.search(image, field); }
  private async search(image: Buffer, focus?: RecognitionField): Promise<TagCallResult> {
    const compact = await compactForLens(image);
    if (compact.length > 500_000) throw new Error("Image exceeds SerpApi Google Lens’s 500 KB upload limit");
    const form = new FormData();
    form.set("image", new Blob([new Uint8Array(compact)], { type: "image/jpeg" }), "part.jpg");
    form.set("api_key", this.apiKey);
    const { controller, timer } = timeout(); const started = Date.now();
    try {
      const upload = await fetch(SERPAPI_IMAGE_URL, { method: "POST", body: form, signal: controller.signal });
      const uploaded = await upload.json() as { image_id?: string; error?: string };
      if (!upload.ok || !uploaded.image_id) throw new Error(uploaded.error ?? "SerpApi image upload failed");
      const url = new URL(SERPAPI_SEARCH_URL);
      url.search = new URLSearchParams({ engine: "google_lens", image_id: uploaded.image_id, type: "all", hl: "en", country: process.env.SERPAPI_COUNTRY ?? "za", api_key: this.apiKey }).toString();
      const response = await fetch(url, { signal: controller.signal });
      const payload = await response.json() as LensPayload;
      if (!response.ok || payload.error || payload.search_metadata?.status === "Error") throw new Error(payload.error ?? "Google Lens search failed");
      return lensResult(payload, Date.now() - started, focus);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`SerpApi Google Lens timed out after ${TIMEOUT_MS / 1000}s`);
      throw error;
    } finally { clearTimeout(timer); }
  }
}

class MockClient implements VisionClient {
  async tagImage(_image: Buffer, _tier: 1 | 2): Promise<TagCallResult> {
    const field_confidence = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, 0])) as Record<RecognitionField, number>;
    const field_evidence = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, "No SerpApi Google Lens key is configured"])) as Record<RecognitionField, string>;
    return { result: { brand: "", vehicle_model: "", part_name: "", year_start: null, year_end: null, condition_notes: "", confidence: "low" as Confidence, needs_review: true, field_confidence, field_evidence }, model: "mock-provider", inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  }
  recheckField(image: Buffer, _field: RecognitionField) { return this.tagImage(image, 2); }
}

let cached: VisionClient | null = null; let cachedKey = "";
export function getVisionClient(): { client: VisionClient; isMock: boolean } {
  const serpApiKey = process.env.SERPAPI_KEY?.trim() ?? "";
  if (!cached || cachedKey !== serpApiKey) { cached = serpApiKey ? new SerpApiLensClient(serpApiKey) : new MockClient(); cachedKey = serpApiKey; }
  return { client: cached, isMock: !serpApiKey };
}
