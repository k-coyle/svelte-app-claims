# Claims Support Docs Review

Source ZIP inspected:

`C:\Users\kcoyle\Downloads\claims_support_docs.zip`

Temporary extraction used for analysis:

`C:\tmp\claims_support_docs_extract\20260507_160456`

## What The Support Pack Contains

### `example_outputs`

- `report_example.xlsx`
- `claims_analysis _demo_report.pptx`

The workbook confirms the intended reporting shape:

- `year_1`, `year_2`, and `year_3` are the raw yearly outputs from `write_excel_report()`.
- `Tables`, `ROI Projection`, `PPPY Projections`, `Grouped Utilzation`, and `ROI` are downstream Excel modeling/presentation layers built from the three yearly tabs.
- The PPT is the stakeholder-facing presentation built from those workbook tabs.

Formula references found:

- `Tables` references `year_1`, `year_2`, `year_3`, and `ROI Projection`.
- `ROI Projection` references `Tables`.
- `ROI` references `ROI Projection`, `year_1`, `year_2`, and `year_3`.

Each yearly report tab has the same 17 report sections:

| Section | Purpose |
| --- | --- |
| `get_summary` | Full medical/pharmacy total, FTE, PPPY |
| `get_summary_w_exlusions` | Same summary after exclusions/stop loss |
| `get_cc_costs` | Chronic condition costs |
| `get_cc_costs_exclusions` | Chronic condition costs after exclusions |
| `get_cc_costs_ip_er_w_exclusions` | IP/ER costs after exclusions |
| `get_ccuh_ip_er_visits_w_exclusions` | IP/ER visit counts and scaled utilization |
| `get_medical__cc_matrix` | Chronic-condition comorbidity hierarchy matrix |
| `get_cc__prevalence` | Chronic-condition prevalence counts |
| `get_primary_icd_cost` | Cost attribution by primary ICD slot |
| `get_mh6_breakout` | MH6 condition breakout |
| `get_mh6_breakout_cost` | MH6 cost breakout |
| `get_cost_per_comorbidity_count` | Cost by comorbidity count |
| `get_cc_summary_enhanced` | Enhanced chronic-condition claimant counts |
| `get_disease_risk_acuity_profile_no_filters` | Risk profile without filters |
| `get_disease_risk_acuity_profile_CC_subpop` | Risk profile for chronic-condition subpopulation |
| `get_disease_risk_acuity_profile_exclusions_applied` | Risk profile after exclusions |
| `get_disease_risk_acuity_profile_CC_subgrouping` | Risk profile by condition subgroup |

PPT views to reproduce in the app dashboard:

- Full medical costs and exclusions by employee/spouse/dependent group
- Annual percent change in medical cost
- Three-year PPPY actual vs projected costs
- Annual medical cost trend
- Employees with one or more chronic conditions
- Chronic-condition hierarchy matrix
- Medical costs by condition
- Chronic-condition prevalence rates
- Clinical disease risk acuity profile
- ROI and medical cost projections
- Key findings and recommendations

### `sample_client_data`

Sample claims files:

| File | Size | Lines | Notes |
| --- | ---: | ---: | --- |
| `client_B_medical_claims_sample.csv` | 25,213,425 bytes | 100,001 | Medical claims |
| `client_B_pharmacy_claims_sample.csv` | 28,140,388 bytes | 100,001 | Pharmacy claims |
| `client_C_medical_claims_sample.csv` | 1,943,702 bytes | 5,912 | Medical claims with numeric header positions |
| `client_D_medical_claims_sample.csv` | 29,004,901 bytes | 100,001 | Medical claims with human-readable headers |
| `client_D_pharmacy_claims_sample.csv` | 31,823,415 bytes | 100,001 | Pharmacy claims with human-readable headers |

No eligibility sample file was included in this ZIP. Full BI reporting still needs eligibility records to calculate FTE/member-month denominator logic. Until a client-specific eligibility sample is available, the existing `claims-analysis/data/test/eligibility` sample can be used for compatibility work.

### `sample_client_mappings`

Mapping files are in the same shape the historical Python readers expect:

`column_number,column,column_uspm,dtype,parse_date`

Notable patterns:

- Client B files already use canonical-like column names.
- Client C medical claims use numeric input headers (`0`, `1`, `2`, ...), so position-based/headerless ingestion must remain supported.
- Client D files use payer-style human-readable headers and need exact column mapping.
- Client C has a pharmacy mapping but no matching pharmacy sample file in this ZIP.

### `project_documents`

Key requirements from the BRD and MVP feature document:

- Upload via UI/API for CSV and Excel.
- Configurable client-specific mappings.
- Structure/date/encoding/required-column validation.
- Duplicate file prevention by filename or hash.
- Ingestion summary stats and receipts.
- Raw to canonical to FHIR transformation path.
- Mapping version tracking per run.
- Rejected-row/dead-letter queue behavior.
- Enriched analytics attributes such as `condition_group`, `condition_count`, `comorbid_count`, `risk_score`, `amount_total`, relationship/date/eligibility fields.
- Dashboard views for upload status, validation results, downloadable outputs, cost trends, chronic-condition prevalence, and risk segmentation.
- Long-term DB plan remains Mongo/FHIR-oriented, but current implementation should continue using local `var/` artifacts until DB allocation exists.

The canonical/FHIR mapping workbook has 84 rows and defines fields such as:

- `date_service_start`
- `date_service_end`
- `date_submitted`
- `icd_1` through `icd_10`
- FHIR targets for `Claim`, `Patient`, and `Coverage`

## App Integration Implications

Short-term no-DB implementation should use local artifacts:

- `var/uploads/<sessionId>/` for raw uploads
- `var/analysis/<sessionId>/manifest.json` for run metadata
- `var/analysis/<sessionId>/dashboard.json` for dashboard-ready summaries
- later: `var/analysis/<sessionId>/year_1.json`, `year_2.json`, `year_3.json` or equivalent parsed report tables

Next integration steps:

1. Add mapping import support for historical `column_number,column,column_uspm,dtype,parse_date` CSVs.
2. Add a report-table parser for the `write_excel_report()` output structure.
3. Add multi-year run grouping so `year_1`, `year_2`, and `year_3` artifacts can feed one dashboard.
4. Create BI dashboard panels that mirror the PPT views.
5. Provision Python dependencies and wire `python/claims_analysis/run_analysis.py` into the worker path.
6. Add a compatibility run using the included client B/D sample medical and pharmacy files plus an eligibility sample.

## Implemented In This Slice

- Mapping admin can import historical mapping CSVs and store them in the local mapping store.
- Imported mappings preserve source-column mappings, position-based mappings, dtype metadata, and date-field metadata.
- Upload normalization can use position-based mappings when uploaded headers are numeric.
- Confirmed claims uploads now write a `claims-profile.json` artifact with mapped field coverage, member counts, service-year distribution, top diagnosis codes, and amount summaries when amount fields are present.
- The BI dashboard can import an old Excel report workbook and write dashboard artifacts under `var/analysis/<sessionId>/`.
- The report parser extracts `year_1`, `year_2`, and `year_3` sections, yearly medical trend summaries, top condition costs, prevalence rows, and risk acuity rows.
