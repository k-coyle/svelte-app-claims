# MVP Demo Runbook

This demo uses local artifacts instead of MongoDB.

## Current Demo Path

1. Start the app:

   ```powershell
   cmd /c npm run dev -- --host 127.0.0.1
   ```

2. Import a mapping at `/admin/mappings`.

   Recommended sample:

   - Account: `clientC`
   - File type: `medical`
   - Mapping file: `sample_client_mappings/client_C_medical_claims_column_map.csv`
   - Set active: checked

3. Upload raw claims at `/upload`.

   Recommended sample:

   - Account: `clientC`
   - File type: `medical`
   - Require stored mapping: checked
   - Claims file: `sample_client_data/client_C_medical_claims_sample.csv`

4. Confirm the upload.

   The app writes:

   - `var/uploads/<sessionId>/` raw upload files
   - `var/analysis/<sessionId>/manifest.json`
   - `var/analysis/<sessionId>/claims-profile.json`
   - `var/analysis/<sessionId>/python-status.json`
   - `var/analysis/<sessionId>/report-sections.json`
   - `var/analysis/<sessionId>/dashboard.json`

5. Open `/analysis`.

   The dashboard shows pipeline status, claims profile, Python report sections, yearly trend, chronic-condition views, risk profile, matrix, and key findings.

## Python Runtime

Target runtime for the legacy-compatible environment is Python 3.11 with:

```text
python/claims_analysis/requirements.txt
```

This machine currently has Python 3.13 and Python 3.7. Until Python 3.11 is installed, `run_analysis.py` runs in `stdlib_mvp` mode. That mode still produces dashboard-ready report sections from raw claims while recording missing legacy dependencies in `python-status.json`.

## Eligibility Behavior

If eligibility is uploaded, the future legacy-cleaner path should use it.

If eligibility is missing, the MVP runner uses deterministic demo eligibility: unique claim members count as full-year eligible members for denominator calculations.

## Reference Workbook

The workbook import on `/analysis` is optional and only for comparing generated dashboard output against the historical Excel/PPT example. It is not the primary MVP flow.
