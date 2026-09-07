# NovaLens

AI-powered bulk auto-spares inventory tagging — upload a folder of part photos, get a manager-reviewable, export-ready catalog. Built on Google's Gemini API with a two-tier hybrid routing strategy for cost control.

## Architecture

```
[Bulk Upload] → [Local Storage] → [SQLite Queue] → [Tier 1: Flash-Lite worker]
                                                        │ needs_review?
                                                        ▼
                                          [Tier 2: Pro escalation worker]
                                                        ▼
                        [Results DB] → [Review Dashboard] → [Export: Shopify / WooCommerce / CSV]
```

- **Upload & preprocess** — drag-and-drop folder upload; every image is resized to 1024px on the longest edge, auto-rotated, EXIF-stripped, and converted to JPEG (`src/lib/preprocess.ts`) before tagging.
- **Queue & worker** — an in-process worker (`src/lib/worker.ts`, started via `src/instrumentation.ts`) polls the SQLite-backed item queue with per-image retry, exponential backoff, and a dead-letter state (`needs_manual`).
- **Tier 1 (bulk)** — Gemini Flash-Lite with native structured output (`responseSchema`), returning brand / part_name / year range / condition notes / confidence / needs_review (`src/lib/vision.ts`).
- **Tier 2 (escalation)** — items flagged `needs_review` are automatically re-run through Gemini Pro and marked with a Tier-2 badge in the dashboard.
- **Batch vs Express** — batch mode applies the Batch API's 50% token discount to the cost model (default); express is full-price synchronous. The batch discount is modeled in `src/lib/cost.ts`; real Batch API file submission slots into the worker call site without changing callers.
- **Cost guardrails** — every API call logs tokens + computed cost (`api_logs`). Pre-run estimate per job; post-run alert if actuals exceed estimate by the configurable margin, or if the escalation rate leaves the expected band.
- **Review dashboard** — sortable table (lowest confidence first), confidence/tier badges, inline editing (with audit log), bulk approve by confidence, reject, flag-for-rephoto with corrected-image requeue.
- **Exports** — one-click CSV in generic, Shopify-import, and WooCommerce-import formats.
- **Admin** — all tunables (models, threshold, token rates, discount, guardrail margins) live in the `settings` table, editable at `/admin` with no deploy.

## Run it

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY for live calls; leave blank for mock mode
npm run dev
```

Open http://localhost:3000 — upload images at **New Upload**, review at the shipment's dashboard, approve, export.

## Mock mode

Without `GEMINI_API_KEY`, a mock vision client returns synthetic tags (with ~12% simulated low-confidence escalation) so the entire pipeline can be exercised offline.

## PRD gap notes (v1 MVP → production)

| PRD element | MVP state | Production path |
|---|---|---|
| GCS storage | Local disk behind `data/uploads` | Swap `preprocess.ts`/`images` route for GCS + signed URLs |
| Cloud Tasks/Pub-Sub queue | SQLite-polled in-process worker | Move worker to Cloud Run pulling Pub/Sub messages |
| Gemini Batch API (file-based) | Cost model applies 50% discount; calls are per-item | Submit batch files via `ai.batches.create`, poll, write results back |
| Shopify/Woo live API export | Import-ready CSV formats | Add Admin/REST API push with stored credentials |
| SQLite | Local dev DB | Postgres/Cloud SQL behind the same query layer |
