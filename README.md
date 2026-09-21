# NovaLens

NovaLens is an enterprise automotive-parts recognition and review console. Recognition is Lens-first: each image is uploaded privately to SerpApi's Google Lens flow for live web matching, then GPT-4o or Claude Sonnet—both routed through OpenRouter—turn the returned candidates into a conservative catalogue record.

## Training mode

Training mode is durable instruction-and-example learning, not provider-side fine-tuning. Active operating guidelines, a bounded set of reviewed AI-to-human corrections, and recent operator feedback are stored in Postgres and supplied to the backup intelligence layer as guidance—not visual proof.

Set `SERPAPI_KEY` in the server environment for live matching and `OPENROUTER_API_KEY` for the intelligence layer. Mock results are used only when neither is configured. Keys are never sent to the browser.

Upload a folder of part photos and turn it into a manager-reviewable, export-ready catalogue. Lens candidates are retained as field evidence, but they are never presented as verified fitment without a reviewer decision.

## Recognition strategy

- Routine pass: SerpApi uploads the normalized image and runs a live Google Lens search using the returned `image_id`.
- Intelligence layer: GPT-4o is the default first-pass interpreter; Claude Sonnet is the default escalation/recheck interpreter. Both receive the photo and bounded Lens evidence.
- Every field carries its own confidence, visible evidence, and review status. A reviewer can edit, confirm, or re-run only that field without overwriting trusted values.
- When no provider keys are configured, the app uses clearly labelled mock results and never claims a live match.

## Architecture

```text
      [Chunked Upload] -> [Image Validation] -> [Durable Postgres Images + Queue]
                                                            |
                                      [SerpApi Google Lens matching]
                                                            |
                                                    needs_review?
                                                            |
                              [GPT-4o / Claude Sonnet interpretation]
                                                            |
                     [Results DB] -> [Review Workspace] -> [CSV Exports]
```

- Upload and preprocessing: validates type, size, and batch count; rotates from EXIF; caps the longest edge at 1024 px; strips metadata; stores the normalized image durably; and sends that original analysis image into recognition without background removal.
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

Add `SERPAPI_KEY` and `OPENROUTER_API_KEY` to `.env`. SerpApi is required for live Google Lens matching; OpenRouter routes GPT-4o and Claude Sonnet to turn match candidates into a reviewable structured record.

### Vercel environment setup

In the Vercel project, add `DATABASE_URL`, `DATABASE_POOL_MAX`, `SERPAPI_KEY`, and `OPENROUTER_API_KEY` under **Settings → Environment Variables** for **Production**, then redeploy. Do not commit `.env` or paste credentials into source control. These values remain server-only.

## Current production boundaries

| Area | Current implementation | Production path |
|---|---|---|
| Authentication | Trusted local workspace | Add organization accounts, roles, and job ownership checks |
| Product images | Private binary rows in Supabase Postgres, served through the image route | Move high-volume catalogues to private object storage and signed URLs |
| Queue | Atomic Supabase Postgres claims triggered within Vercel function lifetimes | Move sustained high-volume processing to a dedicated managed queue/worker |
| Database | Supabase Postgres via `DATABASE_URL` | Add versioned migrations and connection observability |
| Live recognition | SerpApi Google Lens with GPT-4o / Claude Sonnet interpretation | Benchmark on a labelled parts set, calibrate thresholds, and monitor provider quotas |
| Commerce delivery | Import-ready CSV | Add scoped Shopify and WooCommerce API integrations |
