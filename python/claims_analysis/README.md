# Vendored Claims Analysis

This folder contains the app-owned copy of selected ETL and BI reporting code from:

`C:\Users\kcoyle\Desktop\claims-analysis`

The original repo is now reference material only. Changes for the Svelte claims app should happen here.

Current scope copied into this app:

- `etl/common`: BI and Excel-report generation, including `Cleaner.write_excel_report()`
- `etl/ingestion`: generic reader classes and stream/file cleaner
- `etl/test`: mock-data reader config useful for local validation
- `etl/code_mappings`: condition, diagnosis, POS, and exclusion mapping CSVs
- `etl/abstract.py` and `etl/utils.py`

Runtime notes:

- The historical project targeted Python 3.8 and older pandas/numpy versions.
- This app should call the vendored code through a thin adapter rather than importing it directly into SvelteKit routes.
- `run_analysis.py` is the app-owned adapter. It reads the app manifest, standardizes uploaded claims with stored mapping fields, and writes `python-status.json` plus `report-sections.json`.
- Until Python 3.11 and the legacy dependencies are provisioned, the adapter runs in `stdlib_mvp` mode. That mode still produces dashboard-ready report sections from raw claims and records missing legacy dependencies in `python-status.json`.
- The target legacy-compatible runtime is Python 3.11 with the pinned dependencies in `requirements.txt`.
