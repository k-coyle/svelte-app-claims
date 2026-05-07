# Claims App Migration Brief

## Goal

Recreate the behavior of the current claims upload app from `C:\Users\kcoyle\Desktop\svelte-app-claims` inside the Intercom app at `C:\Users\kcoyle\Desktop\small-projects\intercom-engagement-job`.

Important path note:

- The target repo on disk is `../small-projects/intercom-engagement-job`

This brief is meant to give Codex enough source-of-truth detail to rebuild the app under the target stack rather than copying the current repo blindly.

## What The Current App Does

The source app is a small SvelteKit file-ingestion tool with three main user-facing flows:

1. Upload one or more claims or eligibility files.
2. Preview file stats before confirming ingestion.
3. Review upload history and manage stored column mappings.

Core route surfaces:

- `src/routes/upload/+page.svelte`
- `src/routes/upload/+page.server.ts`
- `src/routes/upload/history/+page.svelte`
- `src/routes/upload/history/+page.server.ts`
- `src/routes/admin/mappings/+page.svelte`
- `src/routes/admin/mappings/+page.server.ts`

Support modules:

- `src/lib/server/db.ts`
- `src/lib/server/ndjson.ts`
- `src/lib/server/lineCount.ts`
- `src/lib/server/worker.ts`
- `scripts/worker.mjs`
- `src/lib/url.ts`

## Source UX And Behavior To Preserve

### Upload Page

Purpose:

- Accept files for one account and one file type.
- Optionally choose an eligibility start date.
- Optionally use a stored mapping or provide raw mapping JSON.
- Preview row counts, headers, and file metadata before confirming.

Visible controls:

- File type select
- Account select
- Eligibility start date input, shown only for `eligibility`
- Checkbox for `useStoredMapping`
- Mapping JSON textarea when stored mapping is not used
- Drag-and-drop/file-picker area
- `Preview stats` submit button
- `Confirm & queue` submit button after preview succeeds
- `View history` link

File types:

- `eligibility`
- `medical`
- `pharmacy`
- `vision`
- `dental`

Current account model is mocked:

- client manager can choose `clientA`, `clientB`, `clientC`
- client user would be locked to one account

### Upload Validation Rules

From `src/routes/upload/+page.server.ts` and tests:

- At least one file is required.
- Maximum file count is `20`.
- Maximum total upload size is `200 MB`.
- Allowed extensions:
  - `.csv`
  - `.tsv`
  - `.txt`
  - `.psv`
  - `.xls`
  - `.xlsx`
- Extension is authoritative even if MIME type is odd.
- Eligibility start date is validated only for `eligibility`.
- Mapping JSON must parse as JSON when supplied manually.
- If `useStoredMapping` is checked and no stored mapping exists, return an error.
- If neither checkbox nor JSON is provided, the app tries stored mapping as a fallback but does not hard-fail if none exists.

### Preview Behavior

Preview returns:

- `uploaderUserId`
- `accountId`
- `fileType`
- optional `eligibilityStartDate`
- `usedMapping`: `stored | provided | none`
- optional `mappingVersion`
- optional `mappingFieldCount`
- per-file `stats`

Per-file stats include:

- `filename`
- `bytes`
- `rowCount`
- `mime`
- `headers`

Row-count logic:

- For text-like files, count non-empty lines.
- Row count includes header row.
- For Excel files, read first sheet and count rows from `sheet_to_json(..., { header: 1 })`.

Header extraction logic:

- Text files:
  - strip BOM
  - read first non-empty line
  - delimiter detection in this priority order: comma, tab, pipe, then comma fallback
  - trim and unquote values
  - return first 10 headers
- Excel files:
  - read first row of first sheet
  - trim values
  - return first 10 headers

### Confirm Behavior

When user confirms:

1. Re-read the same form and files.
2. Resolve mapping again.
3. Insert an upload session record.
4. Save files to disk under `var/uploads/<sessionId>/`.
5. Enqueue a background job in Mongo.
6. Emit an audit log.
7. Return `{ confirmed: true, sessionId }`.

Saved file metadata includes:

- absolute file path
- original filename
- byte count

### Upload History

Purpose:

- Show prior upload sessions with filters and pagination.

Filters:

- `accountId`
- `fileType`
- `page`
- `pageSize`

Table columns:

- Created timestamp
- Account
- File type
- Uploader
- File count
- Total MB
- First file name

### Admin Mappings

Purpose:

- List mappings by account and file type.
- Upsert mapping versions.
- Optionally mark one mapping active for an `(accountId, fileType)` pair.

Required form inputs:

- `accountId`
- `fileType`
- `version`
- `json`
- optional `isActive`

Expected behavior:

- Reject invalid JSON
- Require positive integer version
- Persist mapping object, version, active flag, timestamps

## Source Data Model

The intended Mongo collections are:

### `upload_sessions`

Document shape:

```ts
type UploadSessionDoc = {
  uploaderUserId: string;
  accountId: string;
  fileType: string;
  eligibilityStartDate?: string;
  usedMapping: 'stored' | 'provided' | 'none';
  mappingVersion?: number;
  stats: Array<{
    filename: string;
    bytes: number;
    rowCount: number | null;
    mime?: string;
    headers?: string[] | null;
    path?: string;
  }>;
  createdAt: string;
  totalBytes: number;
  audit?: { previewAt?: string; confirmAt?: string };
};
```

Indexes currently intended:

- `{ accountId: 1, createdAt: -1 }`
- `{ fileType: 1, createdAt: -1 }`

### `mappings`

Document shape:

```ts
type MappingDoc = {
  accountId: string;
  fileType: string;
  isActive: boolean;
  version: number;
  json: Record<string, unknown>;
  updatedAt: string;
};
```

Lookup behavior:

- Fetch active mapping by `accountId + fileType`
- Sort by newest `updatedAt`, then highest `version`

### `jobs`

Document shape:

```ts
type JobDoc = {
  sessionId: string;
  accountId: string;
  fileType: string;
  mappingVersion?: number;
  files: Array<{ path: string; filename: string; bytes: number }>;
  status: 'queued' | 'processing' | 'done' | 'error';
  createdAt: string;
  updatedAt: string;
  error?: string;
  stats?: { processedRows?: number };
  eligibilityStartDate?: string | null;
  mapping?: { fields: Record<string, string> } | null;
};
```

Indexes currently intended:

- `{ status: 1, createdAt: 1 }`
- `{ sessionId: 1 }`

## ETL / Worker Behavior

There are two overlapping implementation directions in the source app:

1. A reusable worker helper in `src/lib/server/worker.ts`
2. A polling worker script in `scripts/worker.mjs`

Intended background-job flow:

1. App inserts `jobs` row with `status = queued`.
2. Worker claims oldest queued job and marks it `processing`.
3. Only `eligibility` is currently supported by the worker MVP.
4. Worker invokes a legacy ETL process from another repo.
5. Legacy process streams NDJSON rows.
6. Each emitted row is decorated with:
   - `_sessionId`
   - `_source = 'eligibility'`
   - `_ingestedAt`
7. Rows are batch-inserted into `records_eligibility`.
8. Job is marked `done` with processed row count or `error` on failure.

Legacy ETL knobs in source:

- `ETL_NODE_ENTRY`
- `LEGACY_ETL_ROOT`
- `PYTHON_BIN`
- `PYTHON_ENTRY`

Reusable NDJSON batching helper:

- `src/lib/server/ndjson.ts`

This module is worth preserving if the migrated implementation still streams NDJSON from a worker or child process.

## Audit And Observability

The source app emits JSON audit logs to `console.info` for:

- `upload.preview`
- `upload.confirm`

Preview log payload includes:

- uploader user id
- account id
- file type
- IP if available
- file summary
- total bytes

Confirm log payload includes:

- session id
- account id
- file type
- file summary

The target app already has API history tracking in `src/hooks.server.ts`, but that tracks API calls, not domain events. If recreating audit behavior, keep explicit event logging.

## Source Tests That Best Capture Intended Acceptance Criteria

These are the most useful files to mirror as migration acceptance tests:

- `tests/upload.preview.test.ts`
- `tests/upload.validation.test.ts`
- `tests/upload.headers.test.ts`
- `tests/mapping.lookup.test.ts`
- `tests/upload.audit.test.ts`
- `tests/upload.history.load.test.ts`
- `tests/admin.mappins.test.ts`
- `tests/ndjson.ingest.test.ts`
- `tests/worker.spawn.test.ts`
- `tests/url.historyHref.test.ts`

Behavior proven by tests:

- CSV preview returns correct file stats.
- Excel preview counts rows.
- Header peek works for CSV and XLSX.
- Bad extensions are rejected.
- More than 20 files are rejected.
- Stored mapping lookup and fallback behavior works.
- Preview and confirm emit audit events.
- History loader respects filters and pagination.
- Mapping admin upsert rejects bad JSON.
- NDJSON ingestor batches correctly.

## Known Source Inconsistencies

Do not treat the current repo as perfectly buildable source code. The intended behavior is clearer than the current implementation state.

Current issues found:

- `src/lib/server/db.ts` does not export everything the routes expect:
  - missing `ping`
  - missing `countUploadSessions`
  - missing `listMappings`
  - missing `upsertMapping`
- `listUploadSessions` currently accepts a numeric limit, while history route expects a filter object with pagination.
- `src/lib/server/worker.ts` does not export `makeRunEtl`, but the test expects it.
- `scripts/worker.mjs` currently writes to `child.stdin` before `child` is declared.
- `src/routes/upload/+page.svelte` preview typing omits `headers`.
- `src/lib/server/db.ts` uses Mongo client topology access that fails type-checking under current driver typings.

Validation results from this repo on April 13, 2026:

- `npm run check` reports 22 TypeScript/Svelte errors.
- `npm test -- --run` could not be executed inside the sandbox because `esbuild` hit `spawn EPERM`.

Migration guidance:

- Rebuild from the route behavior and tests, not from the broken seams above.
- If a detail conflicts between route code and DB implementation, trust the route behavior plus tests.

## Target App Stack And Constraints

The destination app at `../small-projects/intercom-engagement-job` is not a blank Svelte app. It already has patterns that should be respected.

Key traits:

- Svelte 5
- SvelteKit 2
- Tailwind 4
- Node adapter available
- Bits UI / shadcn-style component structure under `src/lib/components/ui`
- App shell layout under `src/lib/components/app-shell`
- Engagement section under `/engagement/*`
- JSON API endpoints under `/API/engagement/*`
- Job/polling client helpers already exist:
  - `src/lib/client/job-api.ts`
  - `src/lib/client/job-runtime.ts`
- API request history is already tracked in `src/hooks.server.ts`

Useful target files:

- `src/lib/components/app-shell/nav.ts`
- `src/routes/engagement/+layout.svelte`
- `src/routes/engagement/+page.svelte`
- `src/routes/engagement/history/+page.svelte`
- `src/routes/layout.css`

Target repo dependencies currently do not include:

- `mongodb`
- `xlsx`
- `devalue`

Migration recommendation:

- Add only the dependencies you truly need.
- Prefer the target app's existing UI primitives over porting the raw Tailwind-only source markup.
- Prefer the target app's API/job patterns over custom `use:enhance` response decoding if possible.

## Recommended Destination Design

### Route Placement

Recommended route family inside target app:

- `/engagement/claims-upload`
- `/engagement/claims-upload/history`
- `/engagement/claims-upload/mappings`

This avoids colliding with the existing `/engagement/history` page, which is already used for API history.

### Navigation

Add a new nav item to `engagementNav` in:

- `../small-projects/intercom-engagement-job/src/lib/components/app-shell/nav.ts`

Suggested label:

- `Claims Upload`

### UI Strategy

Rebuild the current utilitarian UI using target components such as:

- `Button`
- `Input`
- `Card`
- `Select`
- `Badge`
- `Dialog` if mapping JSON needs an expandable editor

Suggested page structure:

1. Upload page in a card-based layout.
2. Preview results in a second card or table panel.
3. History in the target app's existing card/table style.
4. Mappings page as a management screen, likely card plus table.

### Server Architecture

Preferred approach in target repo:

1. Put parsing and validation in a dedicated server module, for example:
   - `src/lib/server/claims-upload.ts`
2. Put persistence in a separate module, for example:
   - `src/lib/server/claims-upload-store.ts`
3. Expose API endpoints under `/API/engagement/claims-upload/*` if you want consistency with the target app.
4. Use existing job runtime patterns if background processing should be long-running and observable.

Alternative:

- Use `+page.server.ts` actions for upload preview/confirm if you want the simplest migration.

Recommendation:

- For this target repo, API endpoints plus existing job helpers are the better long-term fit.

## What Codex Should Rebuild

At minimum:

1. Upload page with preview and confirm.
2. File parsing for CSV, TSV, PSV, TXT, XLS, XLSX.
3. Header peek and row counting.
4. Stored mapping lookup plus optional provided mapping JSON.
5. Upload session persistence.
6. History page with filters and pagination.
7. Mapping admin page with list and upsert.
8. Audit logging.

Optional but useful:

1. Background worker/job queue persistence.
2. NDJSON ingestion helper.
3. Debug DB ping endpoint.
4. File-system persistence under a target-specific upload directory.

## Dependencies And Config Codex Will Likely Need In The Target Repo

Likely dependencies:

- `mongodb`
- `xlsx`

Maybe avoid adding `devalue`:

- The source upload page uses custom `use:enhance` response decoding.
- In the target app, it may be cleaner to use JSON APIs or plain SvelteKit action data without the custom envelope parsing.

Environment variables if Mongo-backed:

- `MONGODB_URI`
- `MONGODB_DB`
- optionally `MAPPING_LOOKUP_TIMEOUT_MS`
- optionally worker-related ETL env vars if legacy ETL remains in scope

Storage decision to make explicitly:

- Continue using Mongo plus file-system uploads
- Or adapt to the target app's preferred storage model if it already has one

## Suggested File Map In The Target Repo

One reasonable implementation map:

```text
src/lib/server/claims-upload.ts
src/lib/server/claims-upload-store.ts
src/lib/server/claims-upload-worker.ts
src/routes/engagement/claims-upload/+page.svelte
src/routes/engagement/claims-upload/+page.server.ts
src/routes/engagement/claims-upload/history/+page.svelte
src/routes/engagement/claims-upload/history/+page.server.ts
src/routes/engagement/claims-upload/mappings/+page.svelte
src/routes/engagement/claims-upload/mappings/+page.server.ts
src/routes/API/engagement/claims-upload/preview/+server.ts
src/routes/API/engagement/claims-upload/confirm/+server.ts
src/routes/API/engagement/claims-upload/history/+server.ts
src/routes/API/engagement/claims-upload/mappings/+server.ts
```

You would not need every one of these. Choose either page actions or API-first flows and keep the shape consistent.

## Ready-To-Use Prompt For Codex

Use this prompt in the target repo:

```text
Recreate the claims upload app behavior from `C:\Users\kcoyle\Desktop\svelte-app-claims` inside this repo: `C:\Users\kcoyle\Desktop\small-projects\intercom-engagement-job`.

Important:
- The target repo already has an `/engagement` section, app shell, Tailwind 4, and shadcn-style UI components. Use those existing patterns instead of copying the old raw Tailwind UI directly.
- Do not copy broken seams from the source repo blindly. Rebuild from intended behavior.

Please implement:
- a new route family under `/engagement/claims-upload`
- upload preview and confirm flow
- file validation for csv/tsv/txt/psv/xls/xlsx
- max 20 files
- max 200 MB total
- optional eligibility start date for eligibility files
- stored mapping lookup and optional provided mapping JSON
- row counting and header peeking for text and Excel files
- upload session persistence
- history page with account/file-type filters and pagination
- mappings admin page with list and upsert
- audit logging for preview and confirm

Source behavior to preserve:
- Preview returns uploaderUserId, accountId, fileType, optional eligibilityStartDate, usedMapping, optional mappingVersion, optional mappingFieldCount, and per-file stats.
- Text files count non-empty lines and include the header row.
- Excel files use first sheet only.
- Header peek returns first 10 headers.
- If `useStoredMapping` is checked and no mapping exists, return an error.
- If neither stored mapping nor manual JSON is provided, try stored mapping as a fallback without hard failing.
- Confirm saves files under a session-specific upload directory and queues or records a job for later processing.

Source references:
- `src/routes/upload/+page.server.ts`
- `src/routes/upload/history/+page.server.ts`
- `src/routes/admin/mappings/+page.server.ts`
- `src/lib/server/ndjson.ts`
- tests in `tests/upload.preview.test.ts`, `tests/upload.validation.test.ts`, `tests/upload.headers.test.ts`, `tests/mapping.lookup.test.ts`, `tests/upload.audit.test.ts`, `tests/upload.history.load.test.ts`, and `tests/admin.mappins.test.ts`

Known source issues to avoid carrying over:
- source `db.ts` is incomplete and missing exports used by routes
- source worker code is mid-refactor
- source app has type-check errors

Use the target repo's existing components and route conventions. Add only the dependencies needed. After implementation, run the repo checks and summarize any follow-up decisions still needed.
```

## Recommended Decision Points Before Building

These are the only meaningful choices that still need to be made:

1. Should the migrated feature use page actions or `/API/engagement/claims-upload/*` endpoints?
2. Should Mongo remain the persistence layer in the target repo?
3. Should the worker remain file-system plus child-process based, or should the first pass stop at upload-session capture and queue metadata?

If you want lowest-risk first delivery:

- Build upload, preview, mappings, and history first.
- Stub background processing with queued job records.
- Add legacy ETL integration second.
