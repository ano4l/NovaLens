# NovaLens

NovaLens is an enterprise automotive-parts recognition and review console. Recognition uses SerpApi's Google Lens flow for live web matching. Returned candidates are kept as review evidence; NovaLens does not infer catalogue fitment beyond what Lens provides.

## Training mode

Training mode is durable instruction-and-example learning, not provider-side fine-tuning. Active operating guidelines, a bounded set of reviewed corrections, and recent operator feedback are stored in Postgres as review guidance—not visual proof.

Set `SERPAPI_KEY` in the server environment for live matching. Mock results are used only when it is absent. The key is never sent to the browser.

Upload a folder of part photos and turn it into a manager-reviewable, export-ready catalogue. Lens candidates are retained as field evidence, but they are never presented as verified fitment without a reviewer decision.

## Recognition strategy

- Routine pass: SerpApi uploads the normalized image and runs a live Google Lens search using the returned `image_id`.
- Review evidence: the five strongest exact/product/visual matches and related Lens queries are retained on the item for reviewer inspection. Fields remain unverified until a person confirms or edits them.
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
                                [Review candidate evidence]
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

Add `SERPAPI_KEY` to `.env`. SerpApi is required for live Google Lens matching.

### Vercel environment setup

In the Vercel project, add `DATABASE_URL`, `DATABASE_POOL_MAX`, and `SERPAPI_KEY` under **Settings → Environment Variables** for **Production**, then redeploy. Do not commit `.env` or paste credentials into source control. These values remain server-only.

## Current production boundaries

| Area | Current implementation | Production path |
|---|---|---|
| Authentication | Trusted local workspace | Add organization accounts, roles, and job ownership checks |
| Product images | Private binary rows in Supabase Postgres, served through the image route | Move high-volume catalogues to private object storage and signed URLs |
| Queue | Atomic Supabase Postgres claims triggered within Vercel function lifetimes | Move sustained high-volume processing to a dedicated managed queue/worker |
| Database | Supabase Postgres via `DATABASE_URL` | Add versioned migrations and connection observability |
| Live recognition | SerpApi Google Lens candidate matching | Benchmark on a labelled parts set, confirm field accuracy, and monitor SerpApi quotas |
| Commerce delivery | Import-ready CSV | Add scoped Shopify and WooCommerce API integrations |
