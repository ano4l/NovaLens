# NovaLens

AI-assisted bulk auto-spares inventory tagging. Upload a folder of part photos and turn it into a manager-reviewable, export-ready catalog. NovaLens uses OpenRouter with two-tier vision routing so fast classifications stay cheap while uncertain items receive a stronger second pass.

## Default model strategy

- Tier 1: `dots-studio/dots-3-note-preview:free`, verified against NovaLens's structured automotive-tagging request with reasoning disabled.
- Tier 2: `openrouter/free`, an availability-first escalation route that selects a compatible free vision model.
- Alternatives: `google/gemma-4-26b-a4b-it:free` for faster multimodal throughput and `google/gemma-4-31b-it:free` for a denser quality pass when their free endpoints have capacity.

Free-model availability and rate limits change. Recheck the [OpenRouter free models collection](https://openrouter.ai/collections/free-models) before a production launch.

## Architecture

```text
[Bulk Upload] -> [Image Validation] -> [Local Storage] -> [SQLite Queue]
                                                            |
                                             [Tier 1 vision model]
                                                            |
                                                    needs_review?
                                                            |
                                             [Tier 2 vision model]
                                                            |
                     [Results DB] -> [Review Workspace] -> [CSV Exports]
```

- Upload and preprocessing: validates type, size, and batch count; rotates from EXIF; caps the longest edge at 1024 px; strips metadata; and converts images to JPEG.
- Queue and worker: an in-process worker polls the SQLite queue with per-image retries, exponential backoff, interrupted-work recovery, and a `needs_manual` dead-letter state.
- Provider boundary: `src/lib/vision.ts` owns the OpenRouter wire format. Routes, persistence, and UI depend only on the local `VisionClient` contract.
- Human review: lowest-confidence items appear first, with inline edits, an edit audit log, bulk decisions, and corrected-photo requeue.
- Guardrails: token usage and latency are logged for every call. Estimates and escalation-rate alerts remain configurable even when current model rates are zero.
- Exports: approved items can be downloaded as generic, Shopify, or WooCommerce CSV files.

## Run locally

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

Add `OPENROUTER_API_KEY` to `.env` for live tagging, then open [http://localhost:3000](http://localhost:3000). Without a key, NovaLens uses synthetic mock tags so the complete review workflow remains testable offline.

## Current production boundaries

| Area | Current implementation | Production path |
|---|---|---|
| Authentication | Trusted local workspace | Add organization accounts, roles, and job ownership checks |
| Object storage | Local disk behind an authenticated-ready route boundary | Move images to private object storage and issue short-lived signed URLs |
| Queue | SQLite-polled in-process worker | Move to a durable managed queue with separately deployed workers |
| Database | SQLite | Move to Postgres with versioned migrations |
| OpenRouter free models | Prototype and low-volume operation | Benchmark on a labelled parts set, then pin paid fallbacks and capacity |
| Commerce delivery | Import-ready CSV | Add scoped Shopify and WooCommerce API integrations |
