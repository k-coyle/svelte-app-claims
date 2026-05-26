# Claims BI Demo

Local web app for walking stakeholders from raw claims intake to Python-generated BI dashboard output.

## What This App Does

- Imports client column mappings for medical, pharmacy, and eligibility files.
- Uploads raw claims files into local session folders.
- Runs the app-owned Python analysis runner against those files.
- Writes canonical CSVs, status JSON, dashboard JSON, report sections, and an optional trace workbook.
- Renders dashboard-ready KPIs, trends, condition views, risk profile, findings, and recommendations.

No database is required for the current demo build. Runtime data is stored under `var/`.

## Run Locally

```powershell
npm install
cmd /c npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite, then use:

1. `/admin/mappings` to import a column mapping CSV.
2. `/upload` to upload raw claims and confirm analysis.
3. `/analysis` to review the generated BI dashboard and trace artifacts.

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
var/uploads/<sessionId>/       raw uploaded files
var/analysis/<sessionId>/      manifest, status, dashboard, report artifacts
var/analysis/<sessionId>/canonical/
                               cleaned medical/pharmacy/eligibility CSVs
```
