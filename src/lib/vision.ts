// ============================================================================
// STUDY: The AI boundary. Everything that knows about Gemini lives HERE.
// The worker, routes, and UI know nothing about Google's SDK — they see only
// the VisionClient interface and the TagResult type. One file to swap = vendor
// independence (the PRD calls this the "abstract the vision-call layer" risk
// mitigation).
// ============================================================================
import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import { TagCallResult, TagResult, Confidence } from "./types";

// STUDY: STRUCTURED OUTPUT. We do not ask the model to "please return JSON" —
// we declare the exact JSON shape via responseSchema and set
// responseMimeType: "application/json" (see generateContent below). The API
// then enforces the shape at decoding time, which removes malformed-JSON
// parse failures almost entirely. Compare fields here with TagResult in
// types.ts — they mirror each other deliberately.
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    brand: { type: Type.STRING, description: "Auto manufacturer brand, e.g. Toyota, Ford. Empty string if unknown." },
    part_name: { type: Type.STRING, description: "Specific part name, e.g. Front Left Headlight Assembly" },
    year_start: { type: Type.INTEGER, nullable: true, description: "Earliest compatible model year, or null if unknown" },
    year_end: { type: Type.INTEGER, nullable: true, description: "Latest compatible model year, or null if unknown" },
    condition_notes: { type: Type.STRING, description: "Brief visible condition notes: rust, scratches, missing tabs, etc." },
    confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
    needs_review: {
      type: Type.BOOLEAN,
      description:
        "true if you are not confident in brand or year range (below ~80% self-assessed confidence), image is ambiguous/poorly lit, or the part is unfamiliar. Never guess confidently.",
    },
  },
  required: ["brand", "part_name", "condition_notes", "confidence", "needs_review"],
};

// STUDY: Prompt engineering as code. Notice what the prompt carries:
//   - a role ("expert auto-parts cataloguer")
//   - field-by-field output guidance
//   - an EXPLICIT honesty instruction: needs_review=true when unsure.
// The self-assessed threshold is interpolated from settings, so the admin page
// changes the model's honesty bar without a code change. That trade-off knob
// (threshold ↑ → more Tier-2 calls → cost ↑, accuracy ↑) is the economics of
// this entire product in one number.
function buildPrompt(threshold: number): string {
  return `You are an expert auto-parts cataloguer for a salvage/wholesale warehouse.
Identify the automotive part in this photo. Return strict JSON per the schema.
- brand: vehicle manufacturer the part fits (OEM brand, not the part manufacturer).
- part_name: specific, listing-ready name (include side/position when visible, e.g. "Front Right Fender").
- year_start/year_end: best-effort compatible model-year range as integers; use null if genuinely unknown.
- condition_notes: concise visible condition ("surface rust on mount points", "one tab broken", "appears NOS").
- confidence: high = certain of brand/part/year range; medium = part certain, brand or years uncertain; low = significant ambiguity.
- needs_review: true whenever your brand or year-range self-confidence is below ${Math.round(
    threshold * 100
  )}%, or the photo is too dark/blurry/occluded to be sure. Do not guess to avoid review.`;
}

// STUDY: THE interface that makes this file matter. Two implementations below
// (real + mock) both satisfy it. The worker calls tagImage() without knowing
// which it has. This is the Strategy pattern / dependency injection in its
// most practical form.
export interface VisionClient {
  tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult>;
}

// STUDY: Real implementation. Reads the (already preprocessed) JPEG from disk,
// base64-encodes it inline, and asks for structured JSON. Token counts come
// from usageMetadata — we trust the provider's meter, not our own estimate,
// for ACTUAL cost logging.
class GeminiVisionClient implements VisionClient {
  private ai: GoogleGenAI;
  constructor(
    apiKey: string,
    private tier1Model: string,
    private tier2Model: string,
    private threshold: number
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult> {
    const model = tier === 1 ? this.tier1Model : this.tier2Model;
    const image = fs.readFileSync(imagePath);
    const started = Date.now();
    const response = await this.ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: buildPrompt(this.threshold) },
            { inlineData: { mimeType: "image/jpeg", data: image.toString("base64") } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const latencyMs = Date.now() - started;
    const text = response.text;
    if (!text) throw new Error("Gemini returned empty response");
    const parsed = JSON.parse(text) as TagResult;
    return {
      result: {
        brand: parsed.brand ?? "",
        part_name: parsed.part_name ?? "",
        year_start: parsed.year_start ?? null,
        year_end: parsed.year_end ?? null,
        condition_notes: parsed.condition_notes ?? "",
        confidence: (parsed.confidence as Confidence) ?? "low",
        needs_review: Boolean(parsed.needs_review),
      },
      model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs,
    };
  }
}

// STUDY: Mock implementation. When there is no API key, the whole pipeline is
// still exercisable: ~12% of Tier-1 calls return low-confidence/needs_review
// to simulate ambiguous photos, which drives the escalation path. This lets a
// student (or CI) test routing, retries, review, and export for free.
//
// Writing a faithful mock of your most expensive external dependency is one of
// the highest-leverage habits you can build.
class MockVisionClient implements VisionClient {
  constructor(private threshold: number) {}

  async tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult> {
    const latencyMs = 50 + Math.floor(Math.random() * 150);
    await new Promise((r) => setTimeout(r, Math.min(latencyMs, 20)));
    const brands = ["Toyota", "Ford", "Honda", "BMW", "Chevrolet", "Nissan"];
    const parts = [
      "Front Left Headlight Assembly",
      "Rear Bumper Cover",
      "Alternator",
      "Driver Side Mirror",
      "Front Grille",
      "Brake Caliper",
    ];
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const part = parts[Math.floor(Math.random() * parts.length)];
    const yearStart = 2005 + Math.floor(Math.random() * 15);
    const ambiguous = tier === 1 && Math.random() < 0.12;
    const confidence: Confidence = ambiguous ? "low" : Math.random() < 0.7 ? "high" : "medium";
    const needsReview = tier === 1 ? ambiguous : Math.random() < 0.05;
    return {
      result: {
        brand: ambiguous ? "" : brand,
        part_name: part,
        year_start: ambiguous ? null : yearStart,
        year_end: ambiguous ? null : yearStart + 4,
        condition_notes: ambiguous
          ? "Heavy surface rust, markings illegible"
          : "Minor wear consistent with salvage",
        confidence,
        needs_review: needsReview,
      },
      model: `mock-tier${tier}`,
      inputTokens: 1105,
      outputTokens: 150,
      latencyMs,
    };
  }
}

// STUDY: Client factory + simple cache keyed on the config. If an admin
// changes model names in /admin, the cache key changes and a fresh client is
// built on the next worker tick — config hot-reload with ~5 lines of code.
let cached: VisionClient | null = null;
let cachedKey = "";

export function getVisionClient(models: {
  tier1: string;
  tier2: string;
  threshold: number;
}): { client: VisionClient; isMock: boolean } {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const key = `${apiKey}|${models.tier1}|${models.tier2}|${models.threshold}`;
  if (!cached || cachedKey !== key) {
    cached = apiKey
      ? new GeminiVisionClient(apiKey, models.tier1, models.tier2, models.threshold)
      : new MockVisionClient(models.threshold);
    cachedKey = key;
  }
  return { client: cached, isMock: !apiKey };
}
