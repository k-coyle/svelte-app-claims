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
- Until the Python environment is provisioned, the Svelte app writes local analysis manifests under `var/analysis/<sessionId>/` and surfaces dashboard-ready placeholder/summary artifacts.
