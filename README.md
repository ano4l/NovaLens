# NovaLens

NovaLens is an enterprise automotive-parts recognition and review console. Recognition calls go directly to Google AI through the official `@google/genai` SDK: `gemini-2.5-flash-lite` handles high-volume Tier 1 work and `gemini-2.5-flash` handles Tier 2 and field rechecks.

## Training mode

Training mode is durable instruction-and-example learning, not provider-side fine-tuning. Active operating guidelines and a bounded set of reviewed AI-to-human corrections are stored in Postgres and supplied as context to later Gemini calls. The context is explicitly treated as guidance rather than visual proof. Corrections made in normal production batches remain in the edit audit log and are not silently added to training memory.

Set `GEMINI_API_KEY` only in the server environment to call Google AI directly. If it is absent, NovaLens uses the existing `OPENROUTER_API_KEY` to route both tiers to the same paid Gemini models; it never falls back to `openrouter/free`. Mock results are used only when neither key is configured.

Upload a folder of part photos and turn it into a manager-reviewable, export-ready catalogue. NovaLens uses direct Google AI recognition with two-tier Gemini routing so routine classifications stay efficient while uncertain items receive a stronger second pass.

## Recognition strategy

- Routine pass: stable `gemini-2.5-flash-lite` keeps high-volume throughput and cost under control.
- Escalation and rechecks: stable `gemini-2.5-flash` performs the higher-quality second pass.
- Every field carries its own confidence, visible evidence, and review status. A reviewer can edit, confirm, or re-run only that field without overwriting trusted values.
- When `GEMINI_API_KEY` is absent, the app uses clearly synthetic mock results so the workflow remains testable without claiming live recognition.

## Architecture

```text
      [Chunked Upload] -> [Image Validation] -> [Durable Postgres Images + Queue]
                                                            |
                                             [Gemini Tier 1 model]
                                                            |
                                                    needs_review?
                                                            |
                                            [Gemini Tier 2 pass]
                                                            |
                     [Results DB] -> [Review Workspace] -> [CSV Exports]
```

- Upload and preprocessing: validates type, size, and batch count; rotates from EXIF; caps the longest edge at 1024 px; strips metadata; optionally removes the background through the separate OpenRouter image-editing integration; stores a transparent cutout; and creates a white-background JPEG for recognition and export.
- Queue and worker: request-scoped Vercel work claims rows atomically with `FOR UPDATE SKIP LOCKED`, with per-image retries, exponential backoff, and a `needs_manual` dead-letter state. Review polling safely advances queued work without relying on a permanent server process.
- Provider boundary: `src/lib/vision.ts` owns the direct Google AI SDK integration. Routes, persistence, and UI depend only on the local `VisionClient` contract.
- Human review: lowest-confidence items appear first, with per-field evidence, inline edits, confirmation, targeted AI retries, an edit audit log, bulk decisions, and corrected-photo requeue.
- Guardrails: token usage and latency are logged for every call. Internal cost estimates and escalation-rate alerts remain configurable.
- Exports: approved items can be downloaded as generic, Shopify, or WooCommerce CSV files.

## Run locally

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

Add `DATABASE_URL` using the Supabase connection string from **Connect → Database**. Keep it server-only and replace `[YOUR-PASSWORD]`; if the password contains characters such as `@`, `:`, `/`, or `#`, percent-encode them first. For Vercel, use Supabase's transaction-pooler connection on port `6543` when available to avoid exhausting direct Postgres connections. The first server request creates the required tables and indexes idempotently.

Add `GEMINI_API_KEY` to `.env` for preferred direct recognition. If only `OPENROUTER_API_KEY` is configured, recognition still uses Gemini 2.5 Flash-Lite and Gemini 2.5 Flash through OpenRouter, and also enables the optional Nano Banana cutout flow. Without either key, recognition uses clearly labelled mock tags.

### Vercel environment setup

In the Vercel project, add `DATABASE_URL`, `DATABASE_POOL_MAX`, and `GEMINI_API_KEY` under **Settings → Environment Variables** for **Production**. Add `OPENROUTER_API_KEY` only if background isolation is required, then redeploy. Do not commit `.env` or paste credentials into source control. These values remain server-only.

## Current production boundaries

| Area | Current implementation | Production path |
|---|---|---|
| Authentication | Trusted local workspace | Add organization accounts, roles, and job ownership checks |
| Product images | Private binary rows in Supabase Postgres, served through the image route | Move high-volume catalogues to private object storage and signed URLs |
| Queue | Atomic Supabase Postgres claims triggered within Vercel function lifetimes | Move sustained high-volume processing to a dedicated managed queue/worker |
| Database | Supabase Postgres via `DATABASE_URL` | Add versioned migrations and connection observability |
| Gemini recognition | Direct Google AI SDK with configurable stable models | Benchmark on a labelled parts set, calibrate thresholds, and monitor quotas |
| Commerce delivery | Import-ready CSV | Add scoped Shopify and WooCommerce API integrations |
