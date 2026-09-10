# NovaLens

AI-assisted bulk auto-spares inventory tagging. Upload a folder of part photos and turn it into a manager-reviewable, export-ready catalog. NovaLens uses OpenRouter with two-tier vision routing so fast classifications stay cheap while uncertain items receive a stronger second pass.

## Recognition strategy

- Routine pass: one configurable image model keeps throughput and cost under control.
- Quality consensus: `google/gemini-3.1-pro-preview` and `qwen/qwen3-vl-235b-a22b-thinking` inspect independently; `openai/gpt-5.4-mini` adjudicates from the same image and both proposals.
- Every field carries its own confidence, visible evidence, and review status. A reviewer can edit, confirm, or re-run only that field without overwriting trusted values.
- Free prototype mode remains available through `dots-studio/dots-3-note-preview:free` and `openrouter/free`, but the random free router is not an accuracy benchmark.

Free-model availability and rate limits change. Recheck the [OpenRouter free models collection](https://openrouter.ai/collections/free-models) before a production launch.

## Architecture

```text
      [Bulk Upload] -> [Image Validation] -> [Local Storage] -> [Supabase Postgres Queue]
                                                            |
                                             [Tier 1 vision model]
                                                            |
                                                    needs_review?
                                                            |
                                      [Two analysts + adjudicator]
                                                            |
                     [Results DB] -> [Review Workspace] -> [CSV Exports]
```

- Upload and preprocessing: validates type, size, and batch count; rotates from EXIF; caps the longest edge at 1024 px; strips metadata; removes the background when `REMOVE_BG_API_KEY` is configured; stores a transparent cutout; and creates a white-background JPEG for recognition and export.
- Queue and worker: an in-process worker polls the Supabase Postgres queue with per-image retries, exponential backoff, interrupted-work recovery, and a `needs_manual` dead-letter state.
- Provider boundary: `src/lib/vision.ts` owns the OpenRouter wire format. Routes, persistence, and UI depend only on the local `VisionClient` contract.
- Human review: lowest-confidence items appear first, with per-field evidence, inline edits, confirmation, targeted AI retries, an edit audit log, bulk decisions, and corrected-photo requeue.
- Guardrails: token usage, exact OpenRouter response cost, and latency are logged for every call. Estimates and escalation-rate alerts remain configurable.
- Exports: approved items can be downloaded as generic, Shopify, or WooCommerce CSV files.

## Run locally

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

Add `DATABASE_URL` using the Supabase connection string from **Connect → Database**. Keep it server-only and replace `[YOUR-PASSWORD]`; if the password contains characters such as `@`, `:`, `/`, or `#`, percent-encode them first. For Vercel, use Supabase's transaction-pooler connection on port `6543` when available to avoid exhausting direct Postgres connections. The first server request creates the required tables and indexes idempotently.

Add `OPENROUTER_API_KEY` to `.env` for live tagging. Add `REMOVE_BG_API_KEY` for transparent cutouts and clean white-background images. Without either key, the relevant workflow degrades visibly: recognition uses mock tags and uploads retain their photographed background on a white canvas.

### Vercel environment setup

In the Vercel project, add `DATABASE_URL`, `DATABASE_POOL_MAX`, `OPENROUTER_API_KEY`, and `REMOVE_BG_API_KEY` under **Settings → Environment Variables** for **Production**, then redeploy. Do not commit `.env` or paste database credentials into source control. `DATABASE_URL` is server-only and is now the active persistence adapter.

## Current production boundaries

| Area | Current implementation | Production path |
|---|---|---|
| Authentication | Trusted local workspace | Add organization accounts, roles, and job ownership checks |
| Object storage | Local disk behind an authenticated-ready route boundary | Move images to private object storage and issue short-lived signed URLs |
| Queue | Supabase Postgres-polled in-process worker | Move to a durable managed queue with separately deployed workers |
| Database | Supabase Postgres via `DATABASE_URL` | Add versioned migrations and connection observability |
| OpenRouter free models | Prototype and low-volume operation | Benchmark on a labelled parts set, then pin paid fallbacks and capacity |
| Commerce delivery | Import-ready CSV | Add scoped Shopify and WooCommerce API integrations |
