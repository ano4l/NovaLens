import sharp from "sharp";
import { Confidence, RecognitionContext, RecognitionField, TagCallResult, TagResult } from "./types";
import { RECOGNITION_FIELDS } from "./recognition";

const SERPAPI_IMAGE_URL = "https://serpapi.com/image";
const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 90_000;
const DEFAULT_MODEL = "openai/gpt-4o";

type LensMatch = { title?: string; link?: string; source?: string; exact_matches?: boolean; price?: { value?: string } };
type LensPayload = { search_metadata?: { status?: string }; error?: string; visual_matches?: LensMatch[]; exact_matches?: LensMatch[]; products_results?: LensMatch[]; related_content?: Array<{ query?: string }> };
type OpenRouterPayload = { model?: string; choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; error?: { message?: string } };

export interface VisionClient {
  tagImage(image: Buffer, tier: 1 | 2, context?: RecognitionContext): Promise<TagCallResult>;
  recheckField(image: Buffer, field: RecognitionField, context?: RecognitionContext): Promise<TagCallResult>;
}

function timeout() { const controller = new AbortController(); return { controller, timer: setTimeout(() => controller.abort(), TIMEOUT_MS) }; }
async function compactForLens(image: Buffer) { return image.length <= 480_000 ? image : sharp(image).resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 58, mozjpeg: true }).toBuffer(); }

const confidenceProperties = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, { type: "number", minimum: 0, maximum: 1 }]));
const evidenceProperties = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, { type: "string" }]));
const RESPONSE_SCHEMA = { type: "object", properties: { brand: { type: "string" }, vehicle_model: { type: "string" }, part_name: { type: "string" }, year_start: { type: ["integer", "null"] }, year_end: { type: ["integer", "null"] }, condition_notes: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] }, needs_review: { type: "boolean" }, field_confidence: { type: "object", properties: confidenceProperties, required: RECOGNITION_FIELDS, additionalProperties: false }, field_evidence: { type: "object", properties: evidenceProperties, required: RECOGNITION_FIELDS, additionalProperties: false } }, required: ["brand", "vehicle_model", "part_name", "year_start", "year_end", "condition_notes", "confidence", "needs_review", "field_confidence", "field_evidence"], additionalProperties: false } as const;
function stripCodeFence(value: string) { return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); }

function normalize(value: Partial<TagResult>): TagResult {
  const confidence: Confidence = ["high", "medium", "low"].includes(String(value.confidence)) ? value.confidence as Confidence : "low";
  const validYear = (raw: unknown) => { const year = Number(raw); return Number.isInteger(year) && year >= 1886 && year <= new Date().getFullYear() + 2 ? year : null; };
  const start = validYear(value.year_start); const end = validYear(value.year_end);
  const field_confidence = {} as Record<RecognitionField, number>; const field_evidence = {} as Record<RecognitionField, string>;
  for (const field of RECOGNITION_FIELDS) { const score = Number(value.field_confidence?.[field]); field_confidence[field] = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : confidence === "high" ? .85 : confidence === "medium" ? .65 : .35; field_evidence[field] = String(value.field_evidence?.[field] ?? "No evidence supplied").trim().slice(0, 240); }
  return { brand: typeof value.brand === "string" ? value.brand.trim().slice(0, 80) : "", vehicle_model: typeof value.vehicle_model === "string" ? value.vehicle_model.trim().slice(0, 80) : "", part_name: typeof value.part_name === "string" ? value.part_name.trim().slice(0, 160) : "", year_start: start !== null && end !== null && start > end ? end : start, year_end: start !== null && end !== null && start > end ? start : end, condition_notes: typeof value.condition_notes === "string" ? value.condition_notes.trim().slice(0, 500) : "", confidence, needs_review: Boolean(value.needs_review) || confidence === "low", field_confidence, field_evidence };
}

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
  const result: TagResult = normalize({ brand: "", vehicle_model: "", part_name: "", year_start: null, year_end: null, condition_notes: "", confidence: "low", needs_review: true, field_confidence, field_evidence });
  return { result, model: "serpapi-google-lens", inputTokens: 0, outputTokens: 0, latencyMs };
}

class SerpApiLensClient implements VisionClient {
  constructor(private apiKey: string) {}
  async tagImage(image: Buffer, _tier: 1 | 2, _context?: RecognitionContext) { const found = await this.search(image); return lensResult(found.payload, found.latencyMs); }
  async recheckField(image: Buffer, field: RecognitionField, _context?: RecognitionContext) { const found = await this.search(image); return lensResult(found.payload, found.latencyMs, field); }
  async search(image: Buffer): Promise<{ payload: LensPayload; latencyMs: number }> {
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
      return { payload, latencyMs: Date.now() - started };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`SerpApi Google Lens timed out after ${TIMEOUT_MS / 1000}s`);
      throw error;
    } finally { clearTimeout(timer); }
  }
}

function lensContext(payload: LensPayload) {
  const matches = [...(payload.exact_matches ?? []), ...(payload.products_results ?? []), ...(payload.visual_matches ?? [])].filter((match) => match.title).slice(0, 8).map((match) => ({ title: match.title, source: match.source, exact: Boolean(match.exact_matches), link: match.link, price: match.price?.value }));
  return `\n<google_lens_matches>${JSON.stringify({ matches, related: (payload.related_content ?? []).map((item) => item.query).filter(Boolean).slice(0, 5) })}</google_lens_matches>`;
}

function buildPrompt(focus?: RecognitionField, context?: RecognitionContext, lens = "") {
  const memory = context && (context.guidelines.length || context.examples.length) ? `\n<operating_memory>${JSON.stringify({ guidelines: context.guidelines, corrections: context.examples })}</operating_memory>` : "";
  const feedback = context?.operatorFeedback.length ? `\n<operator_feedback>${JSON.stringify(context.operatorFeedback)}</operator_feedback>` : "";
  return `You are an automotive-parts catalogue verifier. ${focus ? `Re-evaluate only ${focus}; still return the entire schema.` : "Identify this part and every catalogue field."}
Google Lens matches are candidate evidence, not verified fitment. Use the image and credible candidate agreement; leave unsupported fields empty and set needs_review. brand is the vehicle make, vehicle_model is the vehicle model, and part_name includes side or position only when supported. Years require evidence. condition_notes may describe only visible wear. Return concise field_evidence based on visible clues or candidate agreement, never raw URLs. Never invent fitment, OEM numbers, hidden damage, or consensus.${lens}${memory}${feedback}`;
}

class OpenRouterClient implements VisionClient {
  constructor(private apiKey: string, private model: string) {}
  async tagImage(image: Buffer, _tier: 1 | 2, context?: RecognitionContext) { return this.call(image, undefined, context); }
  async recheckField(image: Buffer, field: RecognitionField, context?: RecognitionContext) { return this.call(image, field, context); }
  async call(image: Buffer, focus?: RecognitionField, context?: RecognitionContext, lens = ""): Promise<TagCallResult> {
    const { controller, timer } = timeout(); const started = Date.now();
    try {
      const response = await fetch(OPENROUTER_URL, { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", "X-OpenRouter-Title": "NovaLens" }, body: JSON.stringify({ model: this.model, max_tokens: 1100, messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(focus, context, lens) }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } }] }], response_format: { type: "json_schema", json_schema: { name: "part_recognition", strict: true, schema: RESPONSE_SCHEMA } }, provider: { require_parameters: true, data_collection: "deny" } }) });
      const payload = await response.json() as OpenRouterPayload;
      if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status})`);
      const content = payload.choices?.[0]?.message?.content; const text = typeof content === "string" ? content : content?.map((part) => part.text ?? "").join("");
      if (!text) throw new Error("OpenRouter returned an empty response");
      return { result: normalize(JSON.parse(stripCodeFence(text)) as Partial<TagResult>), model: payload.model ?? this.model, inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, costUsd: payload.usage?.cost, latencyMs: Date.now() - started };
    } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error(`OpenRouter timed out after ${TIMEOUT_MS / 1000}s`); throw error; } finally { clearTimeout(timer); }
  }
}

class LensFirstClient implements VisionClient {
  constructor(private lens: SerpApiLensClient, private intelligence: OpenRouterClient | null) {}
  async tagImage(image: Buffer, _tier: 1 | 2, context?: RecognitionContext) { return this.run(image, undefined, context); }
  async recheckField(image: Buffer, field: RecognitionField, context?: RecognitionContext) { return this.run(image, field, context); }
  private async run(image: Buffer, focus?: RecognitionField, context?: RecognitionContext): Promise<TagCallResult> {
    const lens = await this.lens.search(image);
    if (this.intelligence) { const call = await this.intelligence.call(image, focus, context, lensContext(lens.payload)); return { ...call, model: `serpapi-google-lens + ${call.model}`, latencyMs: lens.latencyMs + call.latencyMs }; }
    return lensResult(lens.payload, lens.latencyMs, focus);
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
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const model = process.env.OPENROUTER_MODEL?.trim() || process.env.OPENROUTER_TIER1_MODEL?.trim() || DEFAULT_MODEL;
  const key = `${serpApiKey}|${openRouterKey}|${model}`;
  if (!cached || cachedKey !== key) { const intelligence = openRouterKey ? new OpenRouterClient(openRouterKey, model) : null; cached = serpApiKey ? new LensFirstClient(new SerpApiLensClient(serpApiKey), intelligence) : intelligence ?? new MockClient(); cachedKey = key; }
  return { client: cached!, isMock: !serpApiKey && !openRouterKey };
}
