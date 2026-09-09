import fs from "fs/promises";
import { Confidence, TagCallResult, TagResult } from "./types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 90_000;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    brand: { type: "string", description: "Vehicle manufacturer, or an empty string when unknown." },
    part_name: { type: "string", description: "Specific, listing-ready automotive part name." },
    year_start: { type: ["integer", "null"], description: "Earliest compatible model year." },
    year_end: { type: ["integer", "null"], description: "Latest compatible model year." },
    condition_notes: { type: "string", description: "Concise visible condition notes." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_review: { type: "boolean" },
  },
  required: ["brand", "part_name", "year_start", "year_end", "condition_notes", "confidence", "needs_review"],
  additionalProperties: false,
} as const;

function buildPrompt(threshold: number): string {
  return `You are an expert auto-parts cataloguer for a salvage and wholesale warehouse.
Identify the automotive part in this photo and return only one JSON object matching the supplied schema.
- brand: vehicle manufacturer the part fits, not the component manufacturer.
- part_name: a specific listing-ready name including side or position when visible.
- year_start and year_end: compatible model-year range; use null when genuinely unknown.
- condition_notes: concise visible condition such as rust, scratches, cracks, missing tabs, or apparent new-old-stock state.
- confidence: high only when the brand, part, and fitment range are well supported by visible evidence; medium when the part is clear but brand or years are uncertain; low for significant ambiguity.
- needs_review: true whenever brand or year-range confidence is below ${Math.round(threshold * 100)}%, or the image is dark, blurry, occluded, or unfamiliar.
Never invent an OEM brand, model year, or hidden condition.
JSON schema: ${JSON.stringify(RESPONSE_SCHEMA)}`;
}

export interface VisionClient {
  tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult>;
}

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

class OpenRouterVisionClient implements VisionClient {
  constructor(
    private apiKey: string,
    private tier1Model: string,
    private tier2Model: string,
    private threshold: number
  ) {}

  async tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult> {
    const model = tier === 1 ? this.tier1Model : this.tier2Model;
    const image = await fs.readFile(imagePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
          "X-Title": "NovaLens",
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: buildPrompt(this.threshold) },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
            ],
          }],
          temperature: 0.1,
          max_tokens: 700,
          reasoning: { enabled: false },
          response_format: { type: "json_object" },
          provider: { require_parameters: true },
        }),
      });

      const payload = (await response.json()) as OpenRouterResponse;
      if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status})`);
      const content = payload.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : content?.map((part) => part.text ?? "").join("");
      if (!text) throw new Error("OpenRouter returned an empty response");

      const result = normalizeResult(JSON.parse(stripCodeFence(text)) as Partial<TagResult>);
      return {
        result,
        model: payload.model ?? model,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenRouter timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function stripCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function normalizeYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const year = Number(value);
  const maxYear = new Date().getFullYear() + 2;
  return Number.isInteger(year) && year >= 1886 && year <= maxYear ? year : null;
}

function normalizeResult(value: Partial<TagResult>): TagResult {
  const confidence: Confidence = ["high", "medium", "low"].includes(String(value.confidence))
    ? (value.confidence as Confidence)
    : "low";
  const yearStart = normalizeYear(value.year_start);
  const yearEnd = normalizeYear(value.year_end);
  const invalidRange = yearStart !== null && yearEnd !== null && yearStart > yearEnd;
  return {
    brand: typeof value.brand === "string" ? value.brand.trim().slice(0, 80) : "",
    part_name: typeof value.part_name === "string" ? value.part_name.trim().slice(0, 160) : "",
    year_start: invalidRange ? yearEnd : yearStart,
    year_end: invalidRange ? yearStart : yearEnd,
    condition_notes: typeof value.condition_notes === "string" ? value.condition_notes.trim().slice(0, 500) : "",
    confidence,
    needs_review: Boolean(value.needs_review) || confidence === "low",
  };
}

class MockVisionClient implements VisionClient {
  async tagImage(_imagePath: string, tier: 1 | 2): Promise<TagCallResult> {
    const brands = ["Toyota", "Ford", "Honda", "BMW", "Chevrolet", "Nissan"];
    const parts = ["Front Left Headlight Assembly", "Rear Bumper Cover", "Alternator", "Driver Side Mirror", "Front Grille", "Brake Caliper"];
    const ambiguous = tier === 1 && Math.random() < 0.12;
    const yearStart = 2005 + Math.floor(Math.random() * 15);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      result: {
        brand: ambiguous ? "" : brands[Math.floor(Math.random() * brands.length)],
        part_name: parts[Math.floor(Math.random() * parts.length)],
        year_start: ambiguous ? null : yearStart,
        year_end: ambiguous ? null : yearStart + 4,
        condition_notes: ambiguous ? "Heavy surface rust, markings illegible" : "Minor wear consistent with salvage",
        confidence: ambiguous ? "low" : Math.random() < 0.7 ? "high" : "medium",
        needs_review: ambiguous,
      },
      model: `mock-tier${tier}`,
      inputTokens: 1105,
      outputTokens: 150,
      latencyMs: 20,
    };
  }
}

let cached: VisionClient | null = null;
let cachedKey = "";

export function getVisionClient(models: { tier1: string; tier2: string; threshold: number }): { client: VisionClient; isMock: boolean } {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const key = `${apiKey}|${models.tier1}|${models.tier2}|${models.threshold}`;
  if (!cached || cachedKey !== key) {
    cached = apiKey
      ? new OpenRouterVisionClient(apiKey, models.tier1, models.tier2, models.threshold)
      : new MockVisionClient();
    cachedKey = key;
  }
  return { client: cached, isMock: !apiKey };
}
