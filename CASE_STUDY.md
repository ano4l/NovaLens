# NovaLens — A Guided Case Study

This repository is a working AI product, but it is also written to be **read**.
It implements a real-world pattern you will meet again and again in your career:

> **A batch pipeline that moves data through stages, calls an external AI API,
> keeps humans in the loop, and watches its own costs.**

## How to use this case study

1. Read this document top to bottom.
2. Then read the source files **in the order given below**. Every important spot
   in the code is marked with a `// STUDY:` comment explaining *why* the code is
   written that way, not just *what* it does.
3. Try the exercises at the end of each section. They are ordered from "change a
   string" to "design a new feature."

You do not need an OpenRouter or background-removal key to study the project.
Without `OPENROUTER_API_KEY`, a **mock vision client** keeps the recognition and
review pipeline usable offline. Without `REMOVE_BG_API_KEY`, uploads are still
normalized onto white, but the UI truthfully reports that no transparent cutout
was produced.

```bash
npm install
npm run dev     # → http://localhost:3000
```

---

## 1. The big picture

Warehouse staff upload thousands of photos of loose car parts. The system must
identify each part (brand, model-year range, part name) with AI, let a human
manager review and correct the results, then export approved listings to a
storefront. The product only makes money if AI costs stay tiny, so the system's
defining design decision is **cost-aware routing with consensus escalation**:

- Every image goes to one configurable **routine vision model** first.
- The response includes confidence and visible evidence for each individual field.
- Uncertain images enter Tier 2, where two models inspect independently and a
  third model adjudicates their proposals from the original image.
- Reviewers can re-run one weak field without replacing values they already trust.
- The Admin page keeps free prototype routing available and offers a one-click
  quality preset. The best production mix must still be measured on labelled parts.

```
Browser ──upload──▶ validate + normalize ──▶ Supabase Postgres queue + private disk
                                                   │
                                      worker loop (polls every 1.5s)
                                                   │
                            queued background isolation when configured
                                  │ transparent PNG + white JPEG
                                  ▼
                           Tier 1 structured vision call
                                  │ needs_review?
                     no ──────────┴────────── yes
                     ▼                         ▼
                  tagged       analyst A + analyst B in parallel
                                               │
                                      adjudicator + same image
                                               ▼
                                             tagged
                                               │
                       field edit / confirm / targeted AI recheck
                                               │
                                approve ──▶ CSV exports
```

**Concepts to notice:** producer/consumer queues, state machines (item status),
cost-aware design, graceful degradation (mock client when no API key),
idempotent-ish retries, and an audit trail for human edits.

---

## 2. Reading path

Read in this order. Each step builds on the vocabulary of the previous one.

| # | File | What it teaches |
|---|------|-----------------|
| 1 | `src/lib/types.ts` | Modeling a domain with TypeScript: string-literal unions as a state machine, nullable fields as "unknown from the AI" |
| 2 | `src/lib/db.ts` | Supabase Postgres in Node, idempotent schema creation, indexes, and pooled connections |
| 3 | `src/lib/settings.ts` | Runtime configuration: why tunables live in a DB table, not in code |
| 4 | `src/lib/preprocess.ts` | Fast upload normalization plus queued background isolation and white-background composition |
| 5 | `src/lib/cost.ts` | Turning pricing into pure functions: cost as data, config-driven formulas |
| 6 | `src/lib/vision.ts` | OpenRouter structured output, parallel analysts, adjudication, targeted field rechecks, and the mock-client pattern |
| 7 | `src/lib/recognition.ts` | Turning model confidence and evidence into durable per-field review states |
| 8 | `src/lib/worker.ts` | The heart of the app: preprocessing, queue polling, retry + backoff, consensus escalation, and guardrails |
| 9 | `src/instrumentation.ts` | How to run background code inside a Next.js server process |
| 10 | `src/app/api/jobs/route.ts` | Multipart upload handling, transactional-ish creation, and the upload-to-queue seam |
| 11 | `src/app/api/items/[id]/route.ts` | Audited edits, field confirmation, and corrected-photo requeue |
| 12 | `src/app/api/items/[id]/recognize/route.ts` | Re-running one field through consensus without overwriting the rest |
| 13 | `src/app/api/jobs/[id]/bulk/route.ts` | Bulk operations parameterized safely (`?` placeholders, no string interpolation of values) |
| 14 | `src/app/api/jobs/[id]/export/route.ts` | One source of truth, three output formats (generic/Shopify/WooCommerce CSV) |
| 15 | `src/app/api/images/[id]/route.ts` | Serving white-background and transparent variants with a path-traversal guard |
| 16 | `src/app/page.tsx` + `src/app/jobs/[id]/page.tsx` | React Server Components: rendering straight from the DB, no client fetch needed |
| 17 | `src/app/jobs/[id]/ReviewTable.tsx` | Mobile-first selection, field evidence, edits, confirmation, retries, and polling |
| 18 | `src/app/upload/page.tsx` + `src/app/admin/page.tsx` | Forms, model-pairing presets, and controlled inputs |
| 19 | `src/app/api/settings/route.ts` + `src/app/api/estimate/route.ts` | Small routes with allowlists and pure-function responses |

---

## 3. Deep dives

### 3.1 The item status state machine

Everything hangs off `items.status`. Draw this on paper:

```
pending ──ok──▶ tagged ──────────┬─▶ approved    (from bulk or per-row)
   │              │              ├─▶ rejected
   │needs_review  │              ├─▶ flagged_rephoto ──new photo──▶ pending
   ▼              ▼
escalated ──consensus ok──▶ tagged (tier 2)
   │
   ▼ (tier 1 or 2 call throws)
back to pending/escalated with attempts+1 and next_retry_at = now + backoff
   │
   ▼ attempts >= max_attempts
needs_manual   (dead-letter: surfaced to a human, never retried automatically)
```

**Questions to test your understanding:**
- Why is `tier` set to `1` when an item is *escalated* (before Tier 2 runs)? What
  would break in the worker's queries if it stayed `NULL`?
- Why does the `pending` query require `tier IS NULL`? What bug would occur
  without it? (Hint: think about a Tier-1 call that fails *after* the item was
  escalated in a previous life.)

### 3.2 Background isolation belongs in the worker

`preprocessImage()` deliberately does only the bounded work needed to accept an
upload: validate, rotate, resize, flatten onto white, encode, and save. If a
background-removal key exists, the item receives `background_status = pending`.
The worker later calls `removeBackgroundFromStoredImage()` before recognition.

This separation matters. A request may contain 100 files; making 100 external
segmentation calls before returning the upload response would create a slow and
fragile request. The queue already owns retries and bounded concurrency, so it
is the right place for optional external image processing. A successful pass
stores both a transparent PNG and a white-background JPEG. Failure leaves the
normalized image usable and records `failed` instead of pretending it succeeded.

### 3.3 The mock client pattern

`src/lib/vision.ts` exports `getVisionClient()`. If `OPENROUTER_API_KEY` is set it
returns a real `OpenRouterVisionClient`; otherwise a `MockVisionClient` that returns
plausible fake data with a simulated ~12% ambiguity rate. Both implement the
same interface:

```ts
interface VisionClient {
  tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult>;
  recheckField(imagePath: string, field: RecognitionField): Promise<TagCallResult>;
}
```

This is **dependency injection in its simplest form**. The worker never knows
which client it has. This is how you make an app testable and demo-able without
money or network access.

### 3.4 Structured output, not prompt begging

Look at `RESPONSE_SCHEMA` in `vision.ts`. Instead of writing "please reply with
JSON" into the prompt (fragile — models sometimes wrap output in markdown or add
commentary), the OpenRouter request uses `response_format` with a strict named
`json_schema`. OpenRouter routes only to providers that support the requested
parameters, and strict JSON Schema makes the response predictable enough to normalize at one
boundary. Rule of thumb:
**use the API's enforcement mechanism when one exists; use prompt instructions
only for what the model must decide.**

The schema now contains `field_confidence` and `field_evidence` objects as well
as the catalogue values. An overall `high` label must not hide a weak year range.

### 3.5 Consensus is not ordinary fallback

Fallback routing tries another model only when the first call fails. Consensus
does something different: Tier 2 calls a primary analyst and a challenger in
parallel even when both are healthy. The adjudicator receives their structured
proposals plus the same image and must resolve disagreement from visible evidence.

The recommended preset uses Gemini 3.1 Pro Preview, Qwen3-VL 235B Thinking, and
GPT-5.4 Mini. These are configuration values, not permanent truths. Model access,
price, and quality drift, so a production choice should be re-run against a
labelled set of real warehouse images.

### 3.6 Field-level human review

`field_reviews` is stored as JSON beside the normal catalogue columns. Each of
the five recognised fields can be `ai_suggested`, `needs_review`, `confirmed`,
or `corrected`, with confidence, evidence, model source, and timestamp. Manual
edits mark only that field as corrected. Confirmation writes an audit event.
Targeted AI rechecks use the same consensus path but update only the requested
column and revoke item approval until a person reviews the new proposal.

### 3.7 Cost as a first-class concept

Most tutorial apps ignore money. This one treats it as data:

- Every API call inserts a row into `api_logs` with token counts and cost.
- Live OpenRouter calls prefer the exact `usage.cost` returned by the provider;
  configured token rates remain the fallback and drive pre-run estimates.
- `estimateJobCostUSD()` in `cost.ts` prices a job *before* it runs using
  configurable token assumptions.
- When a job finishes, the worker compares actual vs. estimate and sets
  `guardrail_breached` if actual > estimate × (1 + margin).

The prices are rows in the `settings` table — because prices change, and you
shouldn't redeploy code to change a number.

### 3.8 Why the worker polls the database

A "real" deployment would use Cloud Tasks or Pub/Sub. Here the worker simply
SELECTs the next due row every 1.5 seconds. This is deliberate:

- One process to run, zero infra — perfect for learning.
- Supabase Postgres provides durable persistence; the app still needs a managed object store for production image bytes.
- Swapping the transport later (Pub/Sub) means rewriting only the *fetch next
  item* part of `tick()`; everything downstream is unchanged.

When you read `worker.ts`, identify exactly which 5 lines would change if the
queue moved to Pub/Sub.

### 3.9 Server Components vs. Client Components

- `src/app/jobs/[id]/page.tsx` is a **Server Component**: it runs on the server,
  queries Postgres directly, and sends finished HTML. No `useEffect`, no fetch
  spinners for the first render.
- `ReviewTable.tsx` is a **Client Component** (`"use client"`): it receives the
  server-rendered rows as props (`initialItems`) and takes over from there:
  selection, inline editing, per-field confirmation, targeted retries, and
  polling while the job processes.

The boundary between them (props of plain JSON data) is the most important
architectural line in any Next.js app. Find it and note what data crosses it.

---

## 4. Exercises

### Warm-up (no new concepts)
1. Change the default confidence enum to include `"unsure"` end-to-end
   (types, schema, UI badge colors). What breaks if you only change one place?
2. Add a `notes` text field to items: schema, PATCH allowlist, edit log, table
   cell. You've now done a full vertical slice.
3. Change the export to Excel-friendly TSV. Why is this a 1-line change? What
   does that tell you about the design?

### Core (touch the pipeline)
4. The mock client escalates about 12% of items. Make that rate a `settings` row
   read at runtime, like the real tunables.
5. Add a `retry` button on `needs_manual` rows that resets `attempts` and
   requeues the item. (Route + UI.)
6. Add a per-job **cost cap**: if the running total in `api_logs` exceeds
   `est_cost_usd` × 2, stop processing further items and mark the remaining ones
   `needs_manual`. Where's the right place to check — worker or upload?

### Stretch (design work)
7. Build a labelled evaluation harness that runs multiple OpenRouter model
   pairings against known answers and scores accuracy per field. How should it
   penalize a confident but invented model-year range?
8. Add a background-removal retry action for items whose `background_status`
   is `failed`. Which parts belong in the item route and which belong in the worker?
9. Add multi-tenancy: a `customers` table, `job.customer_id`, and a customer
   column on the shipments page. What security problems appear with the
   `/api/images/[id]` route? How would signed URLs fix them?
10. Write a small script that replays `edit_log` to reconstruct any item's state
   at a chosen timestamp. Why is an append-only edit log valuable in a product
   where humans correct AI output?

---

## 5. Deliberate simplifications (read this before judging the code)

Real production code would differ — by design here, for clarity:

| Production choice | This repo | Why |
|---|---|---|
| GCS + signed URLs | local `data/uploads` | runs anywhere, no cloud account |
| Cloud Tasks / Pub/Sub | Postgres polling worker | one process, no infra |
| Object storage | Local upload directory | Vercel filesystem is ephemeral |
| Background removal | queued remove.bg call with local files | swap the provider boundary or self-host segmentation for scale and data-residency needs |
| Model evaluation | configurable consensus with field evidence | benchmark pairings on a labelled warehouse dataset before claiming production accuracy |
| Real Batch API | per-item calls plus configurable estimate discount | keeps the worker state machine easy to inspect |
| Auth / multi-tenant | none | not the lesson here — but Exercise 8 makes you add it |

A good engineer knows which corners are cut *on purpose* and can name the
upgrade path for each. That is a core skill this case study is meant to teach.
