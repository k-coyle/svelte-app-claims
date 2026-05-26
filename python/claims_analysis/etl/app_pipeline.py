"""App-owned ETL pipeline for canonical claims ingestion artifacts."""

from __future__ import annotations

import csv
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd


MEDICAL_COLUMNS = [
    "member_id",
    "claim_id",
    "date_service_start",
    "date_service_end",
    "service_year",
    "amount_total",
    "pos_code",
    "procedure_code",
    "is_ip",
    "is_op",
    "is_ov",
    "is_er",
    "days_spent",
    "is_trauma",
    "is_excluded",
    "main_chronic_condition",
]

PHARMACY_COLUMNS = [
    "member_id",
    "claim_id",
    "date_filled",
    "date_written",
    "fill_year",
    "amount_total",
    "ndc",
    "drug_name",
    "is_excluded",
]

ELIGIBILITY_COLUMNS = [
    "member_id",
    "coverage_start",
    "coverage_end",
    "eligible_months",
    "member_relationship",
    "member_gender",
    "is_member_excluded",
    "risk_group",
    "source",
]

DIAGNOSIS_COLUMNS = [
    "claim_id",
    "member_id",
    "icd_code",
    "diagnosis_position",
    "condition_group",
    "date_service_start",
    "service_year",
    "amount_total",
    "pos_code",
    "procedure_code",
    "is_ip",
    "is_er",
    "is_op",
    "is_ov",
]

COMORBIDITY_COLUMNS = [
    "member_id",
    "condition_group",
    "condition_groups",
    "comorbidity_count",
    "medical_total",
    "pharmacy_total",
    "total_cost",
    "has_single_condition",
    "has_multiple_conditions",
]

IP_POS = {"21", "25", "51", "61"}
OP_POS = {"22", "62"}
OV_POS = {"11"}
ER_POS = {"23"}
ER_PROCEDURES = {"99281", "99282", "99283", "99284", "99285"}


def run_app_etl(manifest: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    """Write analysis-ready ETL artifacts and return status metadata."""

    etl_dir = Path(out_dir) / "etl"
    etl_dir.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    context = build_context()
    mappings = load_code_mappings(root)

    source_frames = load_source_frames(manifest)
    medical_source = source_frames.get("medical", empty_frame())
    pharmacy_source = source_frames.get("pharmacy", empty_frame())
    eligibility_present = "eligibility" in source_frames and not source_frames["eligibility"].empty
    assumption_accepted = claim_member_assumption_accepted(manifest)

    eligibility_clean = empty_frame(ELIGIBILITY_COLUMNS)
    if eligibility_present:
        eligibility_clean = clean_eligibility(source_frames["eligibility"], context, source="uploaded")
    elif not medical_source.empty or not pharmacy_source.empty:
        if assumption_accepted:
            eligibility_clean = build_assumed_eligibility(medical_source, pharmacy_source)
            add_warning(
                context,
                "blocking",
                "assumed_eligibility",
                "Eligibility was generated from claim members for preview only; full production analytics remain blocked.",
            )
        else:
            add_warning(
                context,
                "blocking",
                "missing_eligibility",
                "Eligibility is missing and no claim-member eligibility assumption was approved.",
            )
    else:
        add_warning(context, "blocking", "missing_claims", "No medical or pharmacy claim rows were available for ETL.")

    eligible_members = set(eligibility_clean["member_id"].dropna().astype(str)) if not eligibility_clean.empty else set()
    medical_clean, diagnosis_long = clean_medical(medical_source, eligibility_clean, eligible_members, mappings, context)
    pharmacy_clean = clean_pharmacy(pharmacy_source, eligible_members, context)
    eligibility_clean = apply_member_exclusions(eligibility_clean, diagnosis_long, medical_clean, mappings)
    medical_clean = apply_medical_exclusions(medical_clean, diagnosis_long, eligibility_clean)
    member_comorbidity = build_member_comorbidity(medical_clean, pharmacy_clean, diagnosis_long)

    validation = build_validation(
        context,
        manifest,
        source_frames,
        eligibility_clean,
        medical_clean,
        pharmacy_clean,
        diagnosis_long,
        member_comorbidity,
        eligibility_present,
        assumption_accepted,
    )
    status = status_for(validation)

    artifacts = {
        "eligibilityClean": str(etl_dir / "eligibility_clean.csv"),
        "medicalClean": str(etl_dir / "medical_clean.csv"),
        "pharmacyClean": str(etl_dir / "pharmacy_clean.csv"),
        "medicalDiagnosisLong": str(etl_dir / "medical_diagnosis_long.csv"),
        "memberComorbidity": str(etl_dir / "member_comorbidity.csv"),
        "validation": str(etl_dir / "etl_validation.json"),
    }

    write_frame(Path(artifacts["eligibilityClean"]), eligibility_clean, ELIGIBILITY_COLUMNS)
    write_frame(Path(artifacts["medicalClean"]), medical_clean, MEDICAL_COLUMNS)
    write_frame(Path(artifacts["pharmacyClean"]), pharmacy_clean, PHARMACY_COLUMNS)
    write_frame(Path(artifacts["medicalDiagnosisLong"]), diagnosis_long, DIAGNOSIS_COLUMNS)
    write_frame(Path(artifacts["memberComorbidity"]), member_comorbidity, COMORBIDITY_COLUMNS)
    write_json(Path(artifacts["validation"]), validation)

    return {
        "status": status,
        "artifacts": artifacts,
        "validation": validation,
        "warnings": validation["warnings"],
        "analyticsReady": validation["analyticsReady"],
    }


def build_context() -> dict[str, Any]:
    return {
        "droppedRows": {
            "eligibility": {},
            "medical": {},
            "pharmacy": {},
        },
        "duplicateCounts": {
            "medical": 0,
            "pharmacy": 0,
        },
        "dateParseFailures": {
            "eligibility": 0,
            "medical": 0,
            "pharmacy": 0,
        },
        "numericParseFailures": {
            "medical": 0,
            "pharmacy": 0,
        },
        "unmappedCounts": {
            "icd": 0,
            "pos": 0,
        },
        "missingFields": {
            "eligibility": [],
            "medical": [],
            "pharmacy": [],
        },
        "warnings": {
            "blocking": [],
            "quality": [],
        },
    }


def empty_frame(columns: list[str] | None = None) -> pd.DataFrame:
    return pd.DataFrame(columns=columns or [])


def add_warning(context: dict[str, Any], bucket: str, code: str, message: str) -> None:
    warning = {"code": code, "message": message}
    warnings = context["warnings"][bucket]
    if not any(existing.get("code") == code for existing in warnings):
        warnings.append(warning)


def file_source_path(file_info: dict[str, Any]) -> Path:
    artifacts = file_info.get("artifacts") or {}
    return Path(artifacts.get("canonicalCsv") or file_info.get("canonicalCsv") or file_info.get("path") or "")


def file_mapping(file_info: dict[str, Any], manifest: dict[str, Any]) -> dict[str, str]:
    file_level = ((file_info.get("mapping") or {}).get("fields") or {})
    if file_level:
        return {str(key): str(value) for key, value in file_level.items()}
    session_level = ((manifest.get("mapping") or {}).get("fields") or {})
    return {str(key): str(value) for key, value in session_level.items()}


def is_v2_canonical_file(file_info: dict[str, Any]) -> bool:
    artifacts = file_info.get("artifacts") or {}
    return bool(artifacts.get("canonicalCsv") or file_info.get("canonicalCsv"))


def canonicalize_dataframe(df: pd.DataFrame, mapping: dict[str, str]) -> pd.DataFrame:
    rename_map: dict[str, str] = {}
    for index, column in enumerate(list(df.columns)):
        source = str(column).strip().replace("\ufeff", "")
        target = mapping.get(source) or mapping.get(str(index)) or source
        rename_map[column] = target
    return df.rename(columns=rename_map)


def load_source_frames(manifest: dict[str, Any]) -> dict[str, pd.DataFrame]:
    frames: dict[str, list[pd.DataFrame]] = {}
    for file_info in manifest.get("files", []):
        file_type = str(file_info.get("fileType") or "")
        if file_type not in {"eligibility", "medical", "pharmacy"}:
            continue
        path = file_source_path(file_info)
        if not path.exists():
            continue
        df = pd.read_csv(path, dtype=str).fillna("")
        if not is_v2_canonical_file(file_info):
            df = canonicalize_dataframe(df, file_mapping(file_info, manifest))
        frames.setdefault(file_type, []).append(df)
    return {
        file_type: pd.concat(items, ignore_index=True, sort=False).fillna("")
        for file_type, items in frames.items()
        if items
    }


def claim_member_assumption_accepted(manifest: dict[str, Any]) -> bool:
    validation = manifest.get("validation") or {}
    session = validation.get("session") or {}
    return bool(manifest.get("demoMode") or validation.get("demoMode") or session.get("claimMembersEligibleAssumptionAccepted"))


def normalize_member_id(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def normalize_code(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().upper().replace(".", "")
    if text.endswith(".0") and text[:-2].isdigit():
        text = text[:-2]
    return text


def normalize_pos(value: Any) -> str:
    code = normalize_code(value)
    if code.isdigit():
        return str(int(code))
    return code


def first_existing(df: pd.DataFrame, names: list[str]) -> str | None:
    for name in names:
        if name in df.columns:
            return name
    return None


def parse_dates(series: pd.Series) -> tuple[pd.Series, int]:
    raw = series.fillna("").astype(str).str.strip()
    parsed = pd.to_datetime(raw, errors="coerce")
    failures = int(((raw != "") & parsed.isna()).sum())
    return parsed, failures


def parse_numeric(series: pd.Series) -> tuple[pd.Series, int]:
    raw = series.fillna("").astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False).str.strip()
    parsed = pd.to_numeric(raw, errors="coerce")
    failures = int(((raw != "") & parsed.isna()).sum())
    return parsed, failures


def month_count(start: pd.Timestamp | None, end: pd.Timestamp | None) -> int:
    if pd.isna(start) or pd.isna(end):
        return 0
    return max(((end.year - start.year) * 12) + (end.month - start.month) + 1, 1)


def date_string(value: Any) -> str:
    if pd.isna(value):
        return ""
    return pd.Timestamp(value).date().isoformat()


def clean_eligibility(df: pd.DataFrame, context: dict[str, Any], source: str) -> pd.DataFrame:
    if df.empty:
        return empty_frame(ELIGIBILITY_COLUMNS)

    work = df.copy()
    member_col = first_existing(work, ["member_id", "employee_id", "responsible_party_id"])
    if member_col is None:
        context["missingFields"]["eligibility"].append("member_id")
        add_warning(context, "blocking", "eligibility_missing_member_id", "Eligibility is missing a member identifier field.")
        return empty_frame(ELIGIBILITY_COLUMNS)

    work["member_id"] = work[member_col].map(normalize_member_id)
    before_member = len(work)
    work = work[work["member_id"] != ""].copy()
    context["droppedRows"]["eligibility"]["missing_member_id"] = before_member - len(work)

    start_col = first_existing(work, ["coverage_start", "eligibility_start", "eligibility_start_date", "date_eligibility_start"])
    end_col = first_existing(work, ["coverage_end", "eligibility_end", "eligibility_end_date", "date_eligibility_end"])
    as_of_col = first_existing(work, ["medical_eligibility_date_as_of", "eligibility_date_as_of", "coverage_as_of", "as_of_date"])

    if start_col:
        work["_coverage_start"], failures = parse_dates(work[start_col])
        context["dateParseFailures"]["eligibility"] += failures
    elif as_of_col:
        parsed, failures = parse_dates(work[as_of_col])
        context["dateParseFailures"]["eligibility"] += failures
        work["_coverage_start"] = parsed.dt.to_period("M").dt.to_timestamp()
    else:
        context["missingFields"]["eligibility"].append("coverage_start_or_as_of")
        work["_coverage_start"] = pd.NaT

    if end_col:
        work["_coverage_end"], failures = parse_dates(work[end_col])
        context["dateParseFailures"]["eligibility"] += failures
    elif as_of_col:
        parsed, _failures = parse_dates(work[as_of_col])
        work["_coverage_end"] = parsed.dt.to_period("M").dt.to_timestamp("M")
    else:
        context["missingFields"]["eligibility"].append("coverage_end_or_as_of")
        work["_coverage_end"] = work["_coverage_start"]

    relationship_col = first_existing(work, ["member_relationship", "relationship"])
    gender_col = first_existing(work, ["member_gender", "gender"])
    grouped = work.groupby("member_id", dropna=False)
    rows: list[dict[str, Any]] = []
    for member_id, group in grouped:
        coverage_start = group["_coverage_start"].min()
        coverage_end = group["_coverage_end"].max()
        rows.append(
            {
                "member_id": member_id,
                "coverage_start": date_string(coverage_start),
                "coverage_end": date_string(coverage_end),
                "eligible_months": month_count(coverage_start, coverage_end),
                "member_relationship": first_non_empty(group[relationship_col]) if relationship_col else "",
                "member_gender": first_non_empty(group[gender_col]) if gender_col else "",
                "is_member_excluded": False,
                "risk_group": "",
                "source": source,
            }
        )
    return pd.DataFrame(rows, columns=ELIGIBILITY_COLUMNS)


def first_non_empty(series: pd.Series) -> str:
    for value in series.fillna("").astype(str):
        text = value.strip()
        if text:
            return text
    return ""


def build_assumed_eligibility(medical: pd.DataFrame, pharmacy: pd.DataFrame) -> pd.DataFrame:
    claim_dates: list[pd.DataFrame] = []
    for df, date_candidates in [
        (medical, ["date_service_start", "service_date"]),
        (pharmacy, ["date_filled", "date_written", "date_claim_processed"]),
    ]:
        if df.empty:
            continue
        member_col = first_existing(df, ["member_id", "responsible_party_id"])
        date_col = first_existing(df, date_candidates)
        if member_col is None:
            continue
        part = pd.DataFrame({"member_id": df[member_col].map(normalize_member_id)})
        if date_col:
            part["claim_date"] = pd.to_datetime(df[date_col], errors="coerce")
        else:
            part["claim_date"] = pd.NaT
        claim_dates.append(part[part["member_id"] != ""])

    if not claim_dates:
        return empty_frame(ELIGIBILITY_COLUMNS)

    claims = pd.concat(claim_dates, ignore_index=True)
    rows: list[dict[str, Any]] = []
    current_year = datetime.now(UTC).year
    for member_id, group in claims.groupby("member_id"):
        valid_dates = group["claim_date"].dropna()
        if valid_dates.empty:
            start = pd.Timestamp(year=current_year, month=1, day=1)
            end = pd.Timestamp(year=current_year, month=12, day=31)
        else:
            start = pd.Timestamp(year=int(valid_dates.min().year), month=1, day=1)
            end = pd.Timestamp(year=int(valid_dates.max().year), month=12, day=31)
        rows.append(
            {
                "member_id": member_id,
                "coverage_start": date_string(start),
                "coverage_end": date_string(end),
                "eligible_months": month_count(start, end),
                "member_relationship": "",
                "member_gender": "",
                "is_member_excluded": False,
                "risk_group": "",
                "source": "assumed_from_claim_members",
            }
        )
    return pd.DataFrame(rows, columns=ELIGIBILITY_COLUMNS)


def load_code_mappings(root: Path) -> dict[str, Any]:
    mapping_root = root / "etl" / "code_mappings"
    condition_map: dict[str, str] = {}
    for name in ["icd__condition_group_expanded.csv", "icd__condition_group.csv"]:
        path = mapping_root / name
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                code = normalize_code(row.get("icd_code"))
                group = str(row.get("condition_group") or "").strip()
                if code and group:
                    condition_map.setdefault(code, group)

    icd_exclusions = load_code_set(mapping_root / "icd__condition_group_exclusions.csv", "icd_code")
    cpt_exclusions = load_code_set(mapping_root / "cpt__procedure_exclusions.csv", "cpt_code")
    pos_exclusions = load_code_set(mapping_root / "pos__pos_exclusions.csv", "pos_code")
    return {
        "condition": condition_map,
        "icdExclusions": icd_exclusions,
        "cptExclusions": cpt_exclusions,
        "posExclusions": pos_exclusions,
    }


def load_code_set(path: Path, field: str) -> set[str]:
    values: set[str] = set()
    if not path.exists():
        return values
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = normalize_code(row.get(field))
            if code:
                values.add(code)
    return values


def condition_for_code(code: str, condition_map: dict[str, str]) -> str:
    normalized = normalize_code(code)
    for length in range(len(normalized), 2, -1):
        match = condition_map.get(normalized[:length])
        if match:
            return match
    return ""


def is_trauma_code(code: str) -> bool:
    normalized = normalize_code(code)
    if not normalized:
        return False
    if normalized[0] in {"S", "T"}:
        return True
    if normalized.isdigit():
        value = int(normalized)
        return 800 <= value <= 9999
    return False


def clean_medical(
    df: pd.DataFrame,
    eligibility: pd.DataFrame,
    eligible_members: set[str],
    mappings: dict[str, Any],
    context: dict[str, Any],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if df.empty:
        context["missingFields"]["medical"].append("medical_file")
        return empty_frame(MEDICAL_COLUMNS), empty_frame(DIAGNOSIS_COLUMNS)

    work = df.copy()
    member_col = first_existing(work, ["member_id", "responsible_party_id"])
    date_col = first_existing(work, ["date_service_start", "service_date"])
    amount_col = first_existing(work, ["amount_total", "amount_allowed", "amount_net_payment", "paid_amount"])
    if member_col is None:
        context["missingFields"]["medical"].append("member_id")
    if date_col is None:
        context["missingFields"]["medical"].append("date_service_start")
    if amount_col is None:
        context["missingFields"]["medical"].append("amount_total")

    work["member_id"] = work[member_col].map(normalize_member_id) if member_col else ""
    work["date_service_start"], date_failures = parse_dates(work[date_col]) if date_col else (pd.NaT, len(work))
    context["dateParseFailures"]["medical"] += date_failures
    end_col = first_existing(work, ["date_service_end", "service_end"])
    work["date_service_end"], end_failures = parse_dates(work[end_col]) if end_col else (work["date_service_start"], 0)
    context["dateParseFailures"]["medical"] += end_failures
    work["amount_total"], amount_failures = parse_numeric(work[amount_col]) if amount_col else (pd.NA, len(work))
    context["numericParseFailures"]["medical"] += amount_failures

    work["claim_id"] = build_medical_claim_ids(work)
    context["duplicateCounts"]["medical"] = int(work.duplicated(subset=["claim_id"]).sum())
    before = len(work)
    work = work.drop_duplicates(subset=["claim_id"], keep="first").copy()
    context["droppedRows"]["medical"]["duplicate_claim_id"] = before - len(work)

    before = len(work)
    work = work[work["member_id"] != ""].copy()
    context["droppedRows"]["medical"]["missing_member_id"] = before - len(work)
    before = len(work)
    work = work[work["date_service_start"].notna()].copy()
    context["droppedRows"]["medical"]["invalid_service_date"] = before - len(work)
    before = len(work)
    work = work[work["amount_total"].notna()].copy()
    context["droppedRows"]["medical"]["invalid_amount"] = before - len(work)
    if eligible_members:
        before = len(work)
        work = work[work["member_id"].isin(eligible_members)].copy()
        context["droppedRows"]["medical"]["ineligible_member"] = before - len(work)
    elif eligibility.empty:
        work = work.iloc[0:0].copy()

    work["date_service_end"] = work["date_service_end"].where(work["date_service_end"].notna(), work["date_service_start"])
    work["service_year"] = work["date_service_start"].dt.year.astype("Int64")
    work["pos_code"] = source_series(work, ["pos_code", "place_of_service"]).map(normalize_pos)
    work["procedure_code"] = source_series(work, ["procedure_code", "cpt_code"]).map(normalize_code)
    work["is_er"] = work["pos_code"].isin(ER_POS) | work["procedure_code"].isin(ER_PROCEDURES)
    work["is_ip"] = work["pos_code"].isin(IP_POS) & ~work["is_er"]
    work["is_op"] = work["pos_code"].isin(OP_POS) & ~work["is_er"]
    work["is_ov"] = work["pos_code"].isin(OV_POS) & ~work["is_er"]
    work["days_spent"] = (work["date_service_end"] - work["date_service_start"]).dt.days.add(1).clip(lower=1).astype("Int64")

    diagnosis_long = build_diagnosis_long(work, mappings, context)
    main_conditions = (
        diagnosis_long[diagnosis_long["condition_group"] != ""]
        .groupby("claim_id")["condition_group"]
        .first()
        .to_dict()
    )
    trauma_mask = diagnosis_long["icd_code"].map(is_trauma_code).astype(bool)
    trauma_claims = set(diagnosis_long[trauma_mask]["claim_id"])
    work["is_trauma"] = work["claim_id"].isin(trauma_claims)
    work["main_chronic_condition"] = work["claim_id"].map(main_conditions).fillna("")
    work["is_excluded"] = False

    output = pd.DataFrame(
        {
            "member_id": work["member_id"],
            "claim_id": work["claim_id"],
            "date_service_start": work["date_service_start"].dt.date.astype(str),
            "date_service_end": work["date_service_end"].dt.date.astype(str),
            "service_year": work["service_year"],
            "amount_total": work["amount_total"].round(2),
            "pos_code": work["pos_code"],
            "procedure_code": work["procedure_code"],
            "is_ip": work["is_ip"],
            "is_op": work["is_op"],
            "is_ov": work["is_ov"],
            "is_er": work["is_er"],
            "days_spent": work["days_spent"],
            "is_trauma": work["is_trauma"],
            "is_excluded": work["is_excluded"],
            "main_chronic_condition": work["main_chronic_condition"],
        }
    )
    return output.reindex(columns=MEDICAL_COLUMNS), diagnosis_long


def build_medical_claim_ids(work: pd.DataFrame) -> pd.Series:
    existing = source_series(work, ["claim_id"])
    number = source_series(work, ["claim_number", "number"])
    sequence = source_series(work, ["claim_sequence", "sequence", "line_number"])
    ids = []
    for index, existing_value in existing.items():
        existing_text = str(existing_value).strip()
        number_text = str(number.loc[index]).strip() if index in number.index else ""
        sequence_text = str(sequence.loc[index]).strip() if index in sequence.index else ""
        if existing_text:
            ids.append(existing_text)
        elif number_text and sequence_text:
            ids.append(f"{number_text}.{sequence_text}")
        elif number_text:
            ids.append(number_text)
        else:
            ids.append(f"medical-row-{index + 1:08d}")
    return pd.Series(ids, index=work.index)


def source_series(df: pd.DataFrame, names: list[str]) -> pd.Series:
    column = first_existing(df, names)
    if column is None:
        return pd.Series([""] * len(df), index=df.index, dtype=str)
    return df[column].fillna("").astype(str)


def build_diagnosis_long(work: pd.DataFrame, mappings: dict[str, Any], context: dict[str, Any]) -> pd.DataFrame:
    diagnosis_columns = sorted(
        [column for column in work.columns if str(column).lower().startswith("icd_")],
        key=diagnosis_position,
    )
    rows: list[dict[str, Any]] = []
    condition_map = mappings["condition"]
    for _, row in work.iterrows():
        for position, column in enumerate(diagnosis_columns, start=1):
            code = normalize_code(row.get(column))
            if not code:
                continue
            condition = condition_for_code(code, condition_map)
            if not condition:
                context["unmappedCounts"]["icd"] += 1
            rows.append(
                {
                    "claim_id": row["claim_id"],
                    "member_id": row["member_id"],
                    "icd_code": code,
                    "diagnosis_position": position,
                    "condition_group": condition,
                    "date_service_start": row["date_service_start"].date().isoformat(),
                    "service_year": int(row["service_year"]) if not pd.isna(row["service_year"]) else "",
                    "amount_total": round(float(row["amount_total"]), 2),
                    "pos_code": row["pos_code"],
                    "procedure_code": row["procedure_code"],
                    "is_ip": bool(row["is_ip"]),
                    "is_er": bool(row["is_er"]),
                    "is_op": bool(row["is_op"]),
                    "is_ov": bool(row["is_ov"]),
                }
            )
    return pd.DataFrame(rows, columns=DIAGNOSIS_COLUMNS).drop_duplicates()


def diagnosis_position(column: str) -> tuple[int, str]:
    suffix = str(column).split("_", 1)[-1]
    return (int(suffix) if suffix.isdigit() else 999, str(column))


def clean_pharmacy(df: pd.DataFrame, eligible_members: set[str], context: dict[str, Any]) -> pd.DataFrame:
    if df.empty:
        add_warning(context, "quality", "missing_pharmacy", "No pharmacy file was uploaded; pharmacy ETL output is empty.")
        return empty_frame(PHARMACY_COLUMNS)

    work = df.copy()
    member_col = first_existing(work, ["member_id", "responsible_party_id"])
    date_col = first_existing(work, ["date_filled", "date_written", "date_claim_processed", "fill_date"])
    amount_col = first_existing(work, ["amount_total", "amount_allowed", "amount_net_payment", "paid_amount"])
    if member_col is None:
        context["missingFields"]["pharmacy"].append("member_id")
    if date_col is None:
        context["missingFields"]["pharmacy"].append("fill_or_written_date")
    if amount_col is None:
        context["missingFields"]["pharmacy"].append("amount_total")

    work["member_id"] = work[member_col].map(normalize_member_id) if member_col else ""
    parsed_date, date_failures = parse_dates(work[date_col]) if date_col else (pd.NaT, len(work))
    context["dateParseFailures"]["pharmacy"] += date_failures
    work["_fill_date"] = parsed_date
    work["amount_total"], amount_failures = parse_numeric(work[amount_col]) if amount_col else (pd.NA, len(work))
    context["numericParseFailures"]["pharmacy"] += amount_failures
    work["claim_id"] = build_pharmacy_claim_ids(work)
    context["duplicateCounts"]["pharmacy"] = int(work.duplicated(subset=["claim_id"]).sum())
    before = len(work)
    work = work.drop_duplicates(subset=["claim_id"], keep="first").copy()
    context["droppedRows"]["pharmacy"]["duplicate_claim_id"] = before - len(work)
    before = len(work)
    work = work[work["member_id"] != ""].copy()
    context["droppedRows"]["pharmacy"]["missing_member_id"] = before - len(work)
    before = len(work)
    work = work[work["_fill_date"].notna()].copy()
    context["droppedRows"]["pharmacy"]["invalid_fill_date"] = before - len(work)
    before = len(work)
    work = work[work["amount_total"].notna()].copy()
    context["droppedRows"]["pharmacy"]["invalid_amount"] = before - len(work)
    if eligible_members:
        before = len(work)
        work = work[work["member_id"].isin(eligible_members)].copy()
        context["droppedRows"]["pharmacy"]["ineligible_member"] = before - len(work)
    else:
        work = work.iloc[0:0].copy()

    date_written = source_series(work, ["date_written"])
    parsed_written, _failures = parse_dates(date_written)
    output = pd.DataFrame(
        {
            "member_id": work["member_id"],
            "claim_id": work["claim_id"],
            "date_filled": work["_fill_date"].dt.date.astype(str),
            "date_written": parsed_written.dt.date.astype(str).replace("NaT", ""),
            "fill_year": work["_fill_date"].dt.year.astype("Int64"),
            "amount_total": work["amount_total"].round(2),
            "ndc": source_series(work, ["ndc", "ndc_code"]).map(normalize_code),
            "drug_name": source_series(work, ["drug_name", "drug"]),
            "is_excluded": False,
        }
    )
    return output.reindex(columns=PHARMACY_COLUMNS)


def build_pharmacy_claim_ids(work: pd.DataFrame) -> pd.Series:
    existing = source_series(work, ["claim_id"])
    rx = source_series(work, ["rx_number", "number"])
    ids = []
    for index, existing_value in existing.items():
        existing_text = str(existing_value).strip()
        rx_text = str(rx.loc[index]).strip() if index in rx.index else ""
        if existing_text:
            ids.append(existing_text)
        elif rx_text:
            ids.append(rx_text)
        else:
            ids.append(f"pharmacy-row-{index + 1:08d}")
    return pd.Series(ids, index=work.index)


def apply_member_exclusions(
    eligibility: pd.DataFrame,
    diagnosis: pd.DataFrame,
    medical: pd.DataFrame,
    mappings: dict[str, Any],
) -> pd.DataFrame:
    if eligibility.empty:
        return eligibility
    excluded_members: set[str] = set()
    if not diagnosis.empty:
        diagnosis_copy = diagnosis.copy()
        excluded_diag_members = diagnosis_copy[
            diagnosis_copy["icd_code"].map(normalize_code).isin(mappings["icdExclusions"])
        ]["member_id"]
        excluded_members.update(excluded_diag_members.astype(str))
    if not medical.empty:
        excluded_claim_members = medical[
            medical["procedure_code"].map(normalize_code).isin(mappings["cptExclusions"])
            | medical["pos_code"].map(normalize_pos).isin(mappings["posExclusions"])
        ]["member_id"]
        excluded_members.update(excluded_claim_members.astype(str))
    output = eligibility.copy()
    output["is_member_excluded"] = output["member_id"].astype(str).isin(excluded_members)
    return output


def apply_medical_exclusions(
    medical: pd.DataFrame,
    diagnosis: pd.DataFrame,
    eligibility: pd.DataFrame,
) -> pd.DataFrame:
    if medical.empty:
        return medical
    member_exclusions: set[str] = set()
    if not eligibility.empty and "is_member_excluded" in eligibility.columns:
        member_exclusions = set(eligibility[eligibility["is_member_excluded"].astype(bool)]["member_id"].astype(str))
    trauma_claims = (
        set(diagnosis[diagnosis["icd_code"].map(is_trauma_code).astype(bool)]["claim_id"])
        if not diagnosis.empty
        else set()
    )
    output = medical.copy()
    output["is_trauma"] = output["claim_id"].isin(trauma_claims)
    output["is_excluded"] = output["is_trauma"] | output["member_id"].astype(str).isin(member_exclusions)
    return output


def build_member_comorbidity(
    medical: pd.DataFrame,
    pharmacy: pd.DataFrame,
    diagnosis: pd.DataFrame,
) -> pd.DataFrame:
    members = sorted(
        set(medical.get("member_id", pd.Series(dtype=str)).dropna().astype(str))
        | set(pharmacy.get("member_id", pd.Series(dtype=str)).dropna().astype(str))
    )
    medical_costs = (
        medical.groupby("member_id")["amount_total"].sum().to_dict() if not medical.empty else {}
    )
    pharmacy_costs = (
        pharmacy.groupby("member_id")["amount_total"].sum().to_dict() if not pharmacy.empty else {}
    )
    condition_groups = (
        diagnosis[diagnosis["condition_group"] != ""].groupby("member_id")["condition_group"].apply(lambda values: sorted(set(values))).to_dict()
        if not diagnosis.empty
        else {}
    )
    rows = []
    for member_id in members:
        groups = condition_groups.get(member_id, [])
        medical_total = round(float(medical_costs.get(member_id, 0) or 0), 2)
        pharmacy_total = round(float(pharmacy_costs.get(member_id, 0) or 0), 2)
        count = len(groups)
        rows.append(
            {
                "member_id": member_id,
                "condition_group": groups[0] if count == 1 else ("Multiple Conditions" if count > 1 else ""),
                "condition_groups": ";".join(groups),
                "comorbidity_count": count,
                "medical_total": medical_total,
                "pharmacy_total": pharmacy_total,
                "total_cost": round(medical_total + pharmacy_total, 2),
                "has_single_condition": count == 1,
                "has_multiple_conditions": count > 1,
            }
        )
    return pd.DataFrame(rows, columns=COMORBIDITY_COLUMNS)


def build_validation(
    context: dict[str, Any],
    manifest: dict[str, Any],
    source_frames: dict[str, pd.DataFrame],
    eligibility: pd.DataFrame,
    medical: pd.DataFrame,
    pharmacy: pd.DataFrame,
    diagnosis: pd.DataFrame,
    comorbidity: pd.DataFrame,
    eligibility_present: bool,
    assumption_accepted: bool,
) -> dict[str, Any]:
    blocking = context["warnings"]["blocking"]
    analytics_ready = not blocking and not eligibility.empty and not medical.empty
    return {
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "analyticsReady": analytics_ready,
        "productionReady": bool((manifest.get("validation") or {}).get("productionReady")) and analytics_ready,
        "eligibility": {
            "present": eligibility_present,
            "assumedFromClaims": bool(not eligibility_present and assumption_accepted and not eligibility.empty),
            "claimMembersEligibleAssumptionAccepted": assumption_accepted,
        },
        "rowCounts": {
            "source": {
                "eligibility": int(len(source_frames.get("eligibility", []))),
                "medical": int(len(source_frames.get("medical", []))),
                "pharmacy": int(len(source_frames.get("pharmacy", []))),
            },
            "clean": {
                "eligibility": int(len(eligibility)),
                "medical": int(len(medical)),
                "pharmacy": int(len(pharmacy)),
                "medicalDiagnosisLong": int(len(diagnosis)),
                "memberComorbidity": int(len(comorbidity)),
            },
        },
        "droppedRows": context["droppedRows"],
        "missingFields": context["missingFields"],
        "dateParseFailures": context["dateParseFailures"],
        "numericParseFailures": context["numericParseFailures"],
        "duplicateCounts": context["duplicateCounts"],
        "unmappedCounts": context["unmappedCounts"],
        "warnings": context["warnings"],
    }


def status_for(validation: dict[str, Any]) -> str:
    blocking_codes = {warning["code"] for warning in validation["warnings"]["blocking"]}
    if "missing_eligibility" in blocking_codes or "missing_claims" in blocking_codes:
        return "blocked"
    if blocking_codes or validation["warnings"]["quality"]:
        return "complete_with_warnings"
    return "complete"


def write_frame(path: Path, df: pd.DataFrame, columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = df.reindex(columns=columns).copy()
    for column in output.columns:
        if output[column].dtype == bool:
            output[column] = output[column].map(lambda value: "true" if value else "false")
    output.to_csv(path, index=False)


def jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): jsonable(val) for key, val in value.items()}
    if isinstance(value, list):
        return [jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [jsonable(item) for item in value]
    if isinstance(value, set):
        return sorted(jsonable(item) for item in value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if pd.isna(value) if not isinstance(value, (dict, list, tuple, set)) else False:
        return None
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(jsonable(payload), indent=2) + "\n", encoding="utf-8")
