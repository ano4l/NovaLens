import fs from "fs/promises";
import { Confidence, RecognitionField, TagCallResult, TagResult } from "./types";
import { RECOGNITION_FIELDS } from "./recognition";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 90_000;
const CONFIDENCE_PROPERTIES = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, { type: "number", minimum: 0, maximum: 1 }]));
const EVIDENCE_PROPERTIES = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, { type: "string", description: "Short visible evidence or reason for uncertainty." }]));
const RESPONSE_SCHEMA = {
  // STUDY: Strict structured output covers both catalogue values and the
  // evidence needed to review them. Parsing valid JSON is not the same as
  // trusting its contents, so normalizeResult still clamps and validates.
  type: "object",
  properties: {
    brand: { type: "string", description: "Vehicle manufacturer, or empty when unknown." },
    part_name: { type: "string", description: "Specific listing-ready automotive part name." },
    year_start: { type: ["integer", "null"], description: "Earliest compatible model year." },
    year_end: { type: ["integer", "null"], description: "Latest compatible model year." },
    condition_notes: { type: "string", description: "Concise visible condition notes." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_review: { type: "boolean" },
    field_confidence: { type: "object", properties: CONFIDENCE_PROPERTIES, required: RECOGNITION_FIELDS, additionalProperties: false },
    field_evidence: { type: "object", properties: EVIDENCE_PROPERTIES, required: RECOGNITION_FIELDS, additionalProperties: false },
  },
  required: ["brand", "part_name", "year_start", "year_end", "condition_notes", "confidence", "needs_review", "field_confidence", "field_evidence"],
  additionalProperties: false,
} as const;

function buildPrompt(threshold: number, focus?: RecognitionField, candidates?: TagResult[]): string {
  const focusText = focus ? `Re-evaluate only ${focus}. Return the full schema for validation, but make ${focus} the subject of your analysis.` : "Identify the automotive part and every requested catalogue field.";
  const candidateText = candidates ? `\nTwo independent analysts proposed the following. Adjudicate disagreements from the image itself. Agreement is not proof.\n${JSON.stringify(candidates)}` : "";
  return `You are an expert automotive-parts catalogue verifier for a salvage and wholesale warehouse.
${focusText}
- brand is the vehicle manufacturer the part fits, not a component manufacturer.
- part_name includes side or position only when visibly supported.
- year_start and year_end are compatible model years; use null without a readable part number, distinctive geometry, or other visible evidence.
- condition_notes may describe only visible wear or damage.
- field_confidence is a calibrated 0 to 1 probability for each individual value.
- field_evidence briefly names the visible clue. Say "No visible evidence" where appropriate.
- needs_review is true when any important field is below ${threshold.toFixed(2)} or analysts disagree.
Never invent an OEM brand, exact fitment, hidden damage, or consensus.${candidateText}`;
}

export interface VisionClient {
  tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult>;
  recheckField(imagePath: string, field: RecognitionField): Promise<TagCallResult>;
}

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
}
type ModelCall = TagCallResult;

class OpenRouterVisionClient implements VisionClient {
  constructor(private apiKey: string, private tier1Model: string, private tier2Model: string, private challengerModel: string, private adjudicatorModel: string, private threshold: number) {}

  async tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult> {
    if (tier === 1) return this.callModel(imagePath, this.tier1Model, buildPrompt(this.threshold));
    return this.consensus(imagePath);
  }

  async recheckField(imagePath: string, field: RecognitionField): Promise<TagCallResult> {
    return this.consensus(imagePath, field);
  }

  private async consensus(imagePath: string, focus?: RecognitionField): Promise<TagCallResult> {
    // STUDY: This is deliberation, not failover. Both analysts run even when
    // healthy so disagreement becomes a signal. The adjudicator then receives
    // their proposals and the same image; agreement alone is never evidence.
    const prompt = buildPrompt(this.threshold, focus);
    const [primary, challenger] = await Promise.all([
      this.callModel(imagePath, this.tier2Model, prompt),
      this.callModel(imagePath, this.challengerModel, prompt),
    ]);
    const judge = await this.callModel(imagePath, this.adjudicatorModel, buildPrompt(this.threshold, focus, [primary.result, challenger.result]));
    return {
      result: judge.result,
      model: `${primary.model} + ${challenger.model} -> ${judge.model}`,
      inputTokens: primary.inputTokens + challenger.inputTokens + judge.inputTokens,
      outputTokens: primary.outputTokens + challenger.outputTokens + judge.outputTokens,
      latencyMs: Math.max(primary.latencyMs, challenger.latencyMs) + judge.latencyMs,
      costUsd: (primary.costUsd ?? 0) + (challenger.costUsd ?? 0) + (judge.costUsd ?? 0),
    };
  }

  private async callModel(imagePath: string, model: string, prompt: string): Promise<ModelCall> {
    // STUDY: All provider-specific HTTP details stay behind VisionClient. The
    // worker and routes only receive normalized results, usage, latency, and
    // exact cost, so a later provider swap remains localized.
    const image = await fs.readFile(imagePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", "X-Title": "NovaLens" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } }] }],
          max_tokens: 1100,
          response_format: { type: "json_schema", json_schema: { name: "part_recognition", strict: true, schema: RESPONSE_SCHEMA } },
          provider: { require_parameters: true, data_collection: "deny" },
        }),
      });
      const payload = (await response.json()) as OpenRouterResponse;
      if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter request failed (${response.status})`);
      const content = payload.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : content?.map((part) => part.text ?? "").join("");
      if (!text) throw new Error("OpenRouter returned an empty response");
      return { result: normalizeResult(JSON.parse(stripCodeFence(text)) as Partial<TagResult>), model: payload.model ?? model, inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, latencyMs: Date.now() - started, costUsd: payload.usage?.cost };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`OpenRouter timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      throw error;
    } finally { clearTimeout(timeout); }
  }
}

function stripCodeFence(value: string): string { return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); }
function normalizeYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const year = Number(value);
  const maxYear = new Date().getFullYear() + 2;
  return Number.isInteger(year) && year >= 1886 && year <= maxYear ? year : null;
}

function normalizeResult(value: Partial<TagResult>): TagResult {
  const confidence: Confidence = ["high", "medium", "low"].includes(String(value.confidence)) ? value.confidence as Confidence : "low";
  const yearStart = normalizeYear(value.year_start);
  const yearEnd = normalizeYear(value.year_end);
  const invalidRange = yearStart !== null && yearEnd !== null && yearStart > yearEnd;
  const fieldConfidence = {} as Record<RecognitionField, number>;
  const fieldEvidence = {} as Record<RecognitionField, string>;
  for (const field of RECOGNITION_FIELDS) {
    const score = Number(value.field_confidence?.[field]);
    fieldConfidence[field] = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : confidence === "high" ? 0.85 : confidence === "medium" ? 0.65 : 0.35;
    fieldEvidence[field] = String(value.field_evidence?.[field] ?? "No evidence supplied").trim().slice(0, 240);
  }
  return { brand: typeof value.brand === "string" ? value.brand.trim().slice(0, 80) : "", part_name: typeof value.part_name === "string" ? value.part_name.trim().slice(0, 160) : "", year_start: invalidRange ? yearEnd : yearStart, year_end: invalidRange ? yearStart : yearEnd, condition_notes: typeof value.condition_notes === "string" ? value.condition_notes.trim().slice(0, 500) : "", confidence, needs_review: Boolean(value.needs_review) || confidence === "low", field_confidence: fieldConfidence, field_evidence: fieldEvidence };
}

class MockVisionClient implements VisionClient {
  async tagImage(_imagePath: string, tier: 1 | 2): Promise<TagCallResult> {
    const ambiguous = tier === 1 && Math.random() < 0.12;
    const yearStart = 2005 + Math.floor(Math.random() * 15);
    const score = ambiguous ? 0.38 : 0.86;
    const field_confidence = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, score])) as Record<RecognitionField, number>;
    const field_evidence = Object.fromEntries(RECOGNITION_FIELDS.map((field) => [field, "Mock visual evidence"])) as Record<RecognitionField, string>;
    return { result: { brand: ambiguous ? "" : "Toyota", part_name: "Front Left Headlight Assembly", year_start: ambiguous ? null : yearStart, year_end: ambiguous ? null : yearStart + 4, condition_notes: ambiguous ? "Heavy surface rust, markings illegible" : "Minor visible wear", confidence: ambiguous ? "low" : "high", needs_review: ambiguous, field_confidence, field_evidence }, model: `mock-tier${tier}`, inputTokens: 1105, outputTokens: 240, latencyMs: 20 };
  }
  recheckField(imagePath: string, _field: RecognitionField) { return this.tagImage(imagePath, 2); }
}

let cached: VisionClient | null = null;
let cachedKey = "";
export function getVisionClient(models: { tier1: string; tier2: string; challenger?: string; adjudicator?: string; threshold: number }): { client: VisionClient; isMock: boolean } {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const challenger = models.challenger ?? "qwen/qwen3-vl-235b-a22b-thinking";
  const adjudicator = models.adjudicator ?? "openai/gpt-5.4-mini";
  const key = `${apiKey}|${models.tier1}|${models.tier2}|${challenger}|${adjudicator}|${models.threshold}`;
  if (!cached || cachedKey !== key) {
    cached = apiKey ? new OpenRouterVisionClient(apiKey, models.tier1, models.tier2, challenger, adjudicator, models.threshold) : new MockVisionClient();
    cachedKey = key;
  }
  return { client: cached, isMock: !apiKey };
}
