# Claims BI Demo

Local web app for walking stakeholders from raw claims intake to Python-generated analytics QA output.

## What This App Does

- Imports client column mappings for medical, pharmacy, and eligibility files inline.
- Uploads mixed eligibility, medical, and pharmacy files in one guided workspace.
- Runs the app-owned Python analysis runner against canonical artifacts.
- Writes canonical CSVs, ETL CSVs, status JSON, validation JSON, and curated download artifacts.
- Renders core analytics QA metrics for readiness checks, row counts, warnings, claim counts, members, and med/Rx totals.

No database is required for the current demo build. Runtime data is stored under `var/`.

## Run Locally

```powershell
npm install
cmd /c npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite. The MVP workflow lives at `/`:

1. Upload eligibility, medical, and pharmacy files.
2. Validate file types, mappings, PHI posture, and production readiness.
3. Run or rerun the Python QA pipeline.
4. Review ETL-first QA metrics and curated artifacts.

## Python Runtime

The preferred runtime is the repo-local Python 3.11 virtual environment:

```powershell
.\.venv\Scripts\python.exe python\claims_analysis\run_analysis.py --probe
```

Expected analysis mode is `source_ready`. If dependencies are missing, the runner records the missing packages in `python-status.json` and uses `fallback_analysis` so the app can still produce inspectable demo artifacts.

## Analytics Parity

The historic analytics repo remains the source of truth:

```text
C:\Users\kcoyle\Desktop\claims-analysis
```

Run the parity check before stakeholder demos or after analytics changes:

```powershell
npm run test:analytics-parity
```

The check reads the historic README sample data, compares shared ETL file hashes, and verifies the report-method outputs used by `write_excel_report()`. A passing result means the app-owned copy matches the historic source outputs for that sample.

## Useful Commands

```powershell
cmd /c npm run check
cmd /c npm test
cmd /c npm run build
```

## Artifact Layout

```text
var/indexes/                   flat-file indexes for sessions, mappings, and audit events
var/sessions/<sessionId>/      per-session metadata
var/uploads/<sessionId>/       temporary raw upload files
var/analysis/<sessionId>/      manifest, status, dashboard, report artifacts
var/analysis/<sessionId>/canonical/
                               cleaned medical/pharmacy/eligibility CSVs
var/analysis/<sessionId>/etl/  analysis-ready ETL CSVs and etl_validation.json
```
