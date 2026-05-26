# Claims Analysis Runtime

This folder contains the app-owned Python analysis runtime for the Claims BI demo.

The historic source repo is:

```text
C:\Users\kcoyle\Desktop\claims-analysis
```

Treat that repo as the analytics source of truth. Changes for this Svelte app happen here, then parity should be checked against the source repo.

## Included Scope

- `etl/common`: BI report generation, including `Cleaner.write_excel_report()`
- `etl/ingestion`: reader classes and file cleaning helpers
- `etl/test`: sample reader config for local validation
- `etl/code_mappings`: condition, diagnosis, POS, and exclusion mapping CSVs
- `run_analysis.py`: app-owned orchestration for local upload sessions
- `tools/source_parity.py`: output parity check against the historic source repo

## Runtime Contract

`run_analysis.py` accepts an app-generated manifest and writes all artifacts into the session analysis folder.

```powershell
.\.venv\Scripts\python.exe python\claims_analysis\run_analysis.py --probe
.\.venv\Scripts\python.exe python\claims_analysis\run_analysis.py --manifest var\analysis\<sessionId>\manifest.json --out-dir var\analysis\<sessionId>
```

Primary outputs:

- `python-status.json`
- `canonical/*.csv`
- `report-sections.json`
- `dashboard.json`
- `analysis-report.xlsx` when workbook dependencies are available

## Modes

- `source_ready`: pinned Python dependencies are present and canonical CSV outputs are written.
- `fallback_analysis`: dependency setup is incomplete; the runner still produces local dashboard artifacts and records missing packages.

The target runtime is Python 3.11 with the pinned dependencies in `requirements.txt`.

## Parity Check

Run this before analytics-sensitive demos or after changing copied ETL/BI logic:

```powershell
npm run test:analytics-parity
```

The parity check compares shared ETL file hashes and report-method outputs for the historic README sample data. It applies the same runtime shim to both repos so the checked-in README sample can execute without editing either repository.
