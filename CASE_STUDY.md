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

You do not need a Gemini API key to study or run this project — without one the
app uses a **mock vision client** that simulates the AI, so the whole pipeline
works offline.

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
defining design decision is **two-tier model routing**:

- Every image goes to a **cheap, fast model first** (Gemini Flash-Lite).
- The model is told to *flag itself* when it's unsure (`needs_review: true`).
- Only flagged images are re-run through an **expensive, smart model** (Gemini Pro).
- ~85–90% of images never touch the expensive model. Costs drop by ~85% vs.
  sending everything to Pro.

```
Browser ──upload──▶ API route ──▶ sharp (resize to 1024px) ──▶ disk
                                            │
                                            ▼
                                 SQLite queue (items table)
                                            │
                              worker loop (polls every 1.5s)
                                            │
                              ┌───── Tier 1: Flash-Lite ────┐
                              │ needs_review? ──yes──▶ queue again as 'escalated'
                              │                             ▼
                              │                    Tier 2: Pro (overwrite result)
                              ▼ no
                        tagged → human review → approve → CSV export
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
| 2 | `src/lib/db.ts` | SQLite in Node, schema design, indexes, why a module-level singleton matters in dev (hot reload) |
| 3 | `src/lib/settings.ts` | Runtime configuration: why tunables live in a DB table, not in code |
| 4 | `src/lib/preprocess.ts` | Defensive input handling: never trust an uploaded file, normalize before the expensive API call |
| 5 | `src/lib/cost.ts` | Turning pricing into pure functions: cost as data, config-driven formulas |
| 6 | `src/lib/vision.ts` | Abstracting an external API behind an interface; structured output vs. "please return JSON"; the mock-client pattern |
| 7 | `src/lib/worker.ts` | The heart of the app: a polling worker, a status state machine, retry + backoff, tier escalation, guardrails |
| 8 | `src/instrumentation.ts` | How to run background code inside a Next.js server process |
| 9 | `src/app/api/jobs/route.ts` | Multipart upload handling, transactional-ish creation, the upload→queue seam |
| 10 | `src/app/api/items/[id]/route.ts` | A PATCH that writes an audit log; a POST that requeues work |
| 11 | `src/app/api/jobs/[id]/bulk/route.ts` | Bulk operations parameterized safely (`?` placeholders, no string interpolation of values) |
| 12 | `src/app/api/jobs/[id]/export/route.ts` | One source of truth (the DB), three output formats (generic/Shopify/WooCommerce CSV) |
| 13 | `src/app/api/images/[id]/route.ts` | Streaming files from private disk storage with a path-traversal guard |
| 14 | `src/app/page.tsx` + `src/app/jobs/[id]/page.tsx` | React Server Components: rendering straight from the DB, no client fetch needed |
| 15 | `src/app/jobs/[id]/ReviewTable.tsx` | The hard client component: inline editing, optimistic-ish updates, polling for progress |
| 16 | `src/app/upload/page.tsx` + `src/app/admin/page.tsx` | Forms, drag-and-drop, controlled inputs |
| 17 | `src/app/api/settings/route.ts` + `src/app/api/estimate/route.ts` | Small routes with allowlists and pure-function responses |

---

## 3. Deep dives

### 3.1 The item status state machine

Everything hangs off `items.status`. Draw this on paper:

```
pending ──ok──▶ tagged ──────────┬─▶ approved    (from bulk or per-row)
   │              │              ├─▶ rejected
   │needs_review  │              ├─▶ flagged_rephoto ──new photo──▶ pending
   ▼              ▼
escalated ──ok──▶ tagged (tier 2)
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

### 3.2 The mock client pattern

`src/lib/vision.ts` exports `getVisionClient()`. If `GEMINI_API_KEY` is set it
returns a real `GeminiVisionClient`; otherwise a `MockVisionClient` that returns
plausible fake data with a simulated ~12% ambiguity rate. Both implement the
same interface:

```ts
interface VisionClient {
  tagImage(imagePath: string, tier: 1 | 2): Promise<TagCallResult>;
}
```

This is **dependency injection in its simplest form**. The worker never knows
which client it has. This is how you make an app testable and demo-able without
money or network access.

### 3.3 Structured output, not prompt begging

Look at `RESPONSE_SCHEMA` in `vision.ts`. Instead of writing "please reply with
JSON" into the prompt (fragile — models sometimes wrap output in markdown or add
commentary), the API is told `responseMimeType: "application/json"` plus a
schema. Gemini then *guarantees* valid JSON matching that shape. Rule of thumb:
**use the API's enforcement mechanism when one exists; use prompt instructions
only for what the model must decide.**

### 3.4 Cost as a first-class concept

Most tutorial apps ignore money. This one treats it as data:

- Every API call inserts a row into `api_logs` with token counts and computed cost.
- `estimateJobCostUSD()` in `cost.ts` prices a job *before* it runs using
  configurable token assumptions.
- When a job finishes, the worker compares actual vs. estimate and sets
  `guardrail_breached` if actual > estimate × (1 + margin).

The prices are rows in the `settings` table — because prices change, and you
shouldn't redeploy code to change a number.

### 3.5 Why the worker polls the database

A "real" deployment would use Cloud Tasks or Pub/Sub. Here the worker simply
SELECTs the next due row every 1.5 seconds. This is deliberate:

- One process to run, zero infra — perfect for learning.
- SQLite gives transactions and persistence for free.
- Swapping the transport later (Pub/Sub) means rewriting only the *fetch next
  item* part of `tick()`; everything downstream is unchanged.

When you read `worker.ts`, identify exactly which 5 lines would change if the
queue moved to Pub/Sub.

### 3.6 Server Components vs. Client Components

- `src/app/jobs/[id]/page.tsx` is a **Server Component**: it runs on the server,
  queries SQLite directly, and sends finished HTML. No `useEffect`, no fetch
  spinners for the first render.
- `ReviewTable.tsx` is a **Client Component** (`"use client"`): it receives the
  server-rendered rows as props (`initialItems`) and takes over from there —
  inline editing, selection, polling while the job processes.

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
4. The mock client escalates ~12% of items. Make that rate a `settings` row
   read at runtime, like the real tunables.
5. Add a `retry` button on `needs_manual` rows that resets `attempts` and
   requeues the item. (Route + UI.)
6. Add a per-job **cost cap**: if the running total in `api_logs` exceeds
   `est_cost_usd` × 2, stop processing further items and mark the remaining ones
   `needs_manual`. Where's the right place to check — worker or upload?

### Stretch (design work)
7. Implement real Gemini Batch support: accumulate pending items, submit a batch
   via `ai.batches.create`, and write back results when the batch completes.
   (Study how `worker.ts` currently calls `client.tagImage` — what new states
   does the state machine need?)
8. Add multi-tenancy: a `customers` table, `job.customer_id`, and a customer
   column on the shipments page. What security problems appear with the
   `/api/images/[id]` route? How would signed URLs fix them?
9. Write a small script that replays `edit_log` to reconstruct any item's state
   at a chosen timestamp. Why is an append-only edit log valuable in a product
   where humans correct AI output?

---

## 5. Deliberate simplifications (read this before judging the code)

Real production code would differ — by design here, for clarity:

| Production choice | This repo | Why |
|---|---|---|
| GCS + signed URLs | local `data/uploads` | runs anywhere, no cloud account |
| Cloud Tasks / Pub/Sub | SQLite polling worker | one process, no infra |
| Postgres | SQLite | file-based DB, zero setup |
| Real Batch API | per-item calls + 50% discount in cost math | keeps the async batch pattern as a stretch exercise |
| Auth / multi-tenant | none | not the lesson here — but Exercise 8 makes you add it |

A good engineer knows which corners are cut *on purpose* and can name the
upgrade path for each. That is a core skill this case study is meant to teach.
