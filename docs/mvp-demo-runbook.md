# Stakeholder Demo Runbook

This runbook keeps the demo focused on the local raw-claims-to-dashboard path. No database connection is required.

## Walkthrough Path

1. Start the app.

   ```powershell
   cmd /c npm run dev -- --host 127.0.0.1
   ```

2. Open `/admin/mappings` and import a claims mapping CSV.

   Recommended local sample:
   - Account: `clientC`
   - File type: `medical`
   - Mapping file: `sample_client_mappings/client_C_medical_claims_column_map.csv`
   - Set active: checked

3. Open `/upload` and upload raw claims.

   Recommended local sample:
   - Account: `clientC`
   - File type: `medical`
   - Require stored mapping: checked
   - Claims file: `sample_client_data/client_C_medical_claims_sample.csv`

4. Confirm the upload.

   The app creates:
   - `var/uploads/<sessionId>/` raw upload files
   - `var/analysis/<sessionId>/manifest.json`
   - `var/analysis/<sessionId>/claims-profile.json`
   - `var/analysis/<sessionId>/python-status.json`
   - `var/analysis/<sessionId>/canonical/` cleaned CSVs
   - `var/analysis/<sessionId>/report-sections.json`
   - `var/analysis/<sessionId>/analysis-report.xlsx`
   - `var/analysis/<sessionId>/dashboard.json`

5. Open `/analysis`.

   The dashboard shows the analysis pipeline, claims profile, report sections, cost trends, PPPY trend, chronic-condition cost and prevalence, disease risk profile, matrix view, findings, recommendations, and trace workbook link.

## Python Check

Use the local Python 3.11 environment:

```powershell
.\.venv\Scripts\python.exe python\claims_analysis\run_analysis.py --probe
```

Expected mode: `source_ready`.

If dependency setup breaks, `python-status.json` will show missing packages and the runner will switch to `fallback_analysis` for inspectable local output.

## Parity Check

Before a PM or stakeholder walkthrough, verify this repo still matches the historic analytics source:

```powershell
npm run test:analytics-parity
```

The check compares:

- Shared copied ETL files against `C:\Users\kcoyle\Desktop\claims-analysis`
- The report methods used by `write_excel_report()`
- The sample data path documented in the historic README usage notes

Current expected result: `ok: true`.

## Eligibility Behavior

If eligibility is uploaded, the runner writes cleaned eligibility under the session `canonical/` folder.

If eligibility is not uploaded, the runner generates deterministic full-year eligibility from unique claim members so dashboard denominators remain stable for the demo.

## Reference Workbook

The workbook import on `/analysis` is a comparison tool only. The primary walkthrough should start with raw claims upload and end with generated dashboard artifacts.
