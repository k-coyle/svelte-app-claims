# Stakeholder Demo Runbook

This runbook keeps the demo focused on the local raw-claims-to-analytics-QA path. No database connection is required.

## Walkthrough Path

1. Start the app.

   ```powershell
   cmd /c npm run dev -- --host 127.0.0.1
   ```

2. Open `/` and use the inline mapping panel to import a claims mapping CSV.

   Recommended local sample:
   - Account: `clientC`
   - File type: `medical`
   - Mapping file: `sample_client_mappings/client_C_medical_claims_column_map.csv`
   - Set active: checked

3. Use the Upload step on `/` to upload raw claims.

   Recommended local sample:
   - Account: `clientC`
   - File type: `medical`
   - Mapping mode: `stored`
   - Claims file: `sample_client_data/client_C_medical_claims_sample.csv`

4. Preview, validate, and confirm the upload.

   The app creates:
   - `var/sessions/<sessionId>/session.json`
   - `var/analysis/<sessionId>/manifest.json`
   - `var/analysis/<sessionId>/claims-profile.json`
   - `var/analysis/<sessionId>/python-status.json`
   - `var/analysis/<sessionId>/canonical/` cleaned CSVs
   - `var/analysis/<sessionId>/etl/` analysis-ready CSVs
   - `var/analysis/<sessionId>/etl/etl_validation.json`
   - `var/analysis/<sessionId>/report-sections.json`
   - `var/analysis/<sessionId>/dashboard.json`

5. Review the Run and Review steps on `/`.

   The QA console shows pipeline status, production readiness, warning counts, row counts, rejected rows, members, medical/Rx claims, medical/Rx totals, raw-retention status, and curated downloads.

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

If eligibility is uploaded, the runner writes cleaned eligibility under the session `canonical/` and `etl/` folders.

If eligibility is not uploaded, the user must explicitly accept the claim-member eligibility assumption. The runner may generate preview eligibility from unique claim members, but the session is marked not production-ready for full analytics.

## Cleanup

Use the recent-runs sidebar to delete one demo session, or use **Clear demo sessions** to remove all local demo sessions and generated artifacts while keeping stored mappings.
