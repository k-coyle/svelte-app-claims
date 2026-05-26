"""App-owned claims analysis runner for the Claims BI workspace.

This orchestration layer keeps the app independent from the source ETL modules'
file-path assumptions. It produces the same report-section contract as
``write_excel_report()`` from uploaded raw claims, using a conservative
standard-library path when the pinned Python analytics dependencies are not
available.
"""

from __future__ import annotations

import argparse
import csv
import importlib
import json
import math
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


REQUIRED_MODULES = [
    "pandas",
    "numpy",
    "munch",
    "pydash",
    "xlsxwriter",
    "fuzzywuzzy",
    "detect_delimiter",
    "stringcase",
]

REPORT_SECTIONS = [
    "get_summary",
    "get_summary_w_exlusions",
    "get_cc_costs",
    "get_cc_costs_exclusions",
    "get_cc_costs_ip_er_w_exclusions",
    "get_ccuh_ip_er_visits_w_exclusions",
    "get_medical__cc_matrix",
    "get_cc__prevalence",
    "get_primary_icd_cost",
    "get_mh6_breakout",
    "get_mh6_breakout_cost",
    "get_cost_per_comorbidity_count",
    "get_cc_summary_enhanced",
    "get_disease_risk_acuity_profile_no_filters",
    "get_disease_risk_acuity_profile_CC_subpop",
    "get_disease_risk_acuity_profile_exclusions_applied",
    "get_disease_risk_acuity_profile_CC_subgrouping",
]

AMOUNT_FIELDS = [
    "amount_total",
    "amount_allowed",
    "amount_net_payment",
    "paid_amount",
    "amount_billed",
    "amount_patient_responsibility",
]

SERVICE_DATE_FIELDS = [
    "date_service_start",
    "date_filled",
    "date_written",
    "date_paid",
    "date_claim_processed",
]

IP_POS = {"21", "25", "51", "61"}
ER_POS = {"23"}
OV_POS = {"11"}

MENTAL_HEALTH_CONDITIONS = {
    "MH6",
    "Depression",
    "Anxiety",
    "Affective Psychosis",
    "Eating Disorders",
    "PTSD",
    "Substance Abuse",
}


def dependency_report() -> dict[str, Any]:
    missing: list[str] = []
    loaded: dict[str, str] = {}

    for module_name in REQUIRED_MODULES:
        try:
            module = importlib.import_module(module_name)
            loaded[module_name] = str(getattr(module, "__version__", "unknown"))
        except Exception as exc:  # pragma: no cover - external runtime check
            missing.append(f"{module_name}: {type(exc).__name__}: {exc}")

    return {
        "ok": not missing,
        "loaded": loaded,
        "missing": missing,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def run_etl(manifest: dict[str, Any], out_dir: Path, deps: dict[str, Any]) -> dict[str, Any] | None:
    if not deps.get("ok"):
        return None
    from etl.app_pipeline import run_app_etl

    return run_app_etl(manifest, out_dir)


def attach_etl_metadata(manifest: dict[str, Any], etl_result: dict[str, Any] | None) -> None:
    if not etl_result:
        return
    artifacts = etl_result.get("artifacts") or {}
    manifest.setdefault("artifacts", {})
    manifest["artifacts"]["etl"] = artifacts
    manifest["etlArtifacts"] = artifacts
    manifest["etlValidationPath"] = artifacts.get("validation")
    manifest["etlStatus"] = etl_result.get("status")
    manifest["analyticsReady"] = bool(etl_result.get("analyticsReady"))
    manifest["etlValidation"] = {
        "analyticsReady": bool(etl_result.get("analyticsReady")),
        "warnings": (etl_result.get("validation") or {}).get("warnings", {}),
        "rowCounts": (etl_result.get("validation") or {}).get("rowCounts", {}),
    }


def clean_key(value: str) -> str:
    return value.strip().replace("\ufeff", "")


def canonical_row(row: dict[str, str], mapping: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for index, (key, value) in enumerate(row.items()):
        source = clean_key(key)
        target = mapping.get(source) or mapping.get(str(index)) or source
        if target:
            out[target] = (value or "").strip()
    return out


def file_mapping(file_info: dict[str, Any], manifest: dict[str, Any]) -> dict[str, str]:
    file_level = ((file_info.get("mapping") or {}).get("fields") or {})
    if file_level:
        return {str(key): str(value) for key, value in file_level.items()}
    session_level = ((manifest.get("mapping") or {}).get("fields") or {})
    return {str(key): str(value) for key, value in session_level.items()}


def file_source_path(file_info: dict[str, Any]) -> Path:
    artifacts = file_info.get("artifacts") or {}
    return Path(
        artifacts.get("canonicalCsv")
        or file_info.get("canonicalCsv")
        or file_info.get("path")
        or ""
    )


def is_v2_canonical_file(file_info: dict[str, Any]) -> bool:
    artifacts = file_info.get("artifacts") or {}
    return bool(artifacts.get("canonicalCsv") or file_info.get("canonicalCsv"))


def can_generate_eligibility(manifest: dict[str, Any]) -> bool:
    try:
        manifest_version = int(manifest.get("manifestVersion") or 1)
    except (TypeError, ValueError):
        manifest_version = 1
    if manifest_version < 2:
        return True
    validation = manifest.get("validation") or {}
    session = validation.get("session") or {}
    return bool(
        manifest.get("demoMode")
        or validation.get("demoMode")
        or session.get("claimMembersEligibleAssumptionAccepted")
    )


def manifest_version(manifest: dict[str, Any]) -> int:
    try:
        return int(manifest.get("manifestVersion") or 1)
    except (TypeError, ValueError):
        return 1


def parse_amount(row: dict[str, str]) -> float | None:
    for field in AMOUNT_FIELDS:
        value = row.get(field, "").replace("$", "").replace(",", "").strip()
        if not value:
            continue
        try:
            parsed = float(value)
        except ValueError:
            continue
        if math.isfinite(parsed):
            return parsed
    return None


def parse_service_date(row: dict[str, str]) -> datetime | None:
    for field in SERVICE_DATE_FIELDS:
        value = row.get(field, "").strip()
        if not value:
            continue
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(value[:19], fmt)
            except ValueError:
                pass
        try:
            return datetime.fromisoformat(value[:19])
        except ValueError:
            continue
    return None


def diagnosis_codes(row: dict[str, str]) -> list[str]:
    fields = sorted(
        [key for key in row if key.lower().replace("_", "").startswith("icd")],
        key=lambda item: (len(item), item),
    )
    codes: list[str] = []
    for field in fields:
        code = row.get(field, "").replace(".", "").strip().upper()
        if code:
            codes.append(code)
    return codes


def load_condition_map(root: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for name in ["icd__condition_group_expanded.csv", "icd__condition_group.csv"]:
        path = root / "etl" / "code_mappings" / name
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                code = (row.get("icd_code") or "").replace(".", "").strip().upper()
                group = (row.get("condition_group") or "").strip()
                if code and group:
                    mapping.setdefault(code, group)
    return mapping


def condition_for_code(code: str, condition_map: dict[str, str]) -> str | None:
    normalized = code.replace(".", "").strip().upper()
    for length in range(len(normalized), 2, -1):
        match = condition_map.get(normalized[:length])
        if match:
            return match
    return None


def read_claims(manifest: dict[str, Any], condition_map: dict[str, str]) -> list[dict[str, Any]]:
    claims: list[dict[str, Any]] = []

    for file_info in manifest.get("files", []):
        path = file_source_path(file_info)
        file_type = str(file_info.get("fileType") or "")
        if file_type not in {"medical", "pharmacy"} or not path.exists():
            continue
        mapping = file_mapping(file_info, manifest)

        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            for raw in reader:
                row = canonical_row(raw, mapping)
                service_date = parse_service_date(row)
                amount = parse_amount(row)
                member_id = row.get("member_id") or row.get("responsible_party_id") or ""
                diagnoses = diagnosis_codes(row)
                conditions = sorted(
                    {
                        condition_for_code(code, condition_map)
                        for code in diagnoses
                        if condition_for_code(code, condition_map)
                    }
                )
                claims.append(
                    {
                        "file_type": file_type,
                        "member_id": member_id,
                        "service_year": service_date.year if service_date else None,
                        "service_date": service_date.date().isoformat() if service_date else None,
                        "amount": amount,
                        "pos_code": str(row.get("pos_code") or row.get("place_of_service") or "").strip(),
                        "diagnoses": diagnoses,
                        "conditions": conditions,
                    }
                )
    return claims


def canonicalize_dataframe(df: Any, mapping: dict[str, str]) -> Any:
    """Normalize source headers into the app-owned canonical field names."""
    rename_map: dict[str, str] = {}
    for index, column in enumerate(list(df.columns)):
        source = clean_key(str(column))
        target = mapping.get(source) or mapping.get(str(index)) or source
        rename_map[column] = target
    return df.rename(columns=rename_map)


def dataframe_claims(df: Any, file_type: str, condition_map: dict[str, str]) -> list[dict[str, Any]]:
    claims: list[dict[str, Any]] = []
    for raw in df.fillna("").to_dict(orient="records"):
        row = {str(key): str(value).strip() for key, value in raw.items()}
        service_date = parse_service_date(row)
        amount = parse_amount(row)
        member_id = row.get("member_id") or row.get("responsible_party_id") or ""
        diagnoses = diagnosis_codes(row)
        conditions = sorted(
            {
                condition_for_code(code, condition_map)
                for code in diagnoses
                if condition_for_code(code, condition_map)
            }
        )
        claims.append(
            {
                "file_type": file_type,
                "member_id": member_id,
                "service_year": service_date.year if service_date else None,
                "service_date": service_date.date().isoformat() if service_date else None,
                "amount": amount,
                "pos_code": str(row.get("pos_code") or row.get("place_of_service") or "").strip(),
                "diagnoses": diagnoses,
                "conditions": conditions,
            }
        )
    return claims


def generate_demo_eligibility(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    member_years = sorted(
        {
            (claim.get("member_id"), claim.get("service_year"))
            for claim in claims
            if claim.get("member_id") and claim.get("service_year")
        }
    )
    return [
        {
            "member_id": member_id,
            "analysis_year": year,
            "eligible_months": 12,
            "coverage_start": f"{year}-01-01",
            "coverage_end": f"{year}-12-31",
            "relationship": "SELF",
            "source": "generated_from_claim_members",
        }
        for member_id, year in member_years
    ]


def write_csv_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def read_claims_source_ready(
    manifest: dict[str, Any], condition_map: dict[str, str], out_dir: Path
) -> tuple[list[dict[str, Any]], dict[str, str], list[str]]:
    import pandas as pd  # type: ignore[import-not-found]

    canonical_dir = out_dir / "canonical"
    canonical_dir.mkdir(parents=True, exist_ok=True)
    artifacts: dict[str, str] = {}
    warnings: list[str] = []
    claims: list[dict[str, Any]] = []
    uploaded_eligibility = False

    for file_info in manifest.get("files", []):
        path = file_source_path(file_info)
        file_type = str(file_info.get("fileType") or "")
        if file_type not in {"medical", "pharmacy", "eligibility"} or not path.exists():
            continue

        df = pd.read_csv(path, dtype=str).fillna("")
        mapping = file_mapping(file_info, manifest)
        if is_v2_canonical_file(file_info):
            canonical = df
            output_path = path
        else:
            canonical = canonicalize_dataframe(df, mapping)
            safe_name = Path(str(file_info.get("filename") or path.name)).stem.replace(" ", "_")
            output_path = canonical_dir / f"{file_type}-{safe_name}.csv"
            canonical.to_csv(output_path, index=False)
        artifacts.setdefault(file_type, str(output_path))

        if file_type == "eligibility":
            uploaded_eligibility = True
            continue

        claims.extend(dataframe_claims(canonical, file_type, condition_map))

    if claims and not uploaded_eligibility:
        if can_generate_eligibility(manifest):
            eligibility_rows = generate_demo_eligibility(claims)
            eligibility_filename = (
                "eligibility-generated.csv"
                if manifest_version(manifest) < 2
                else "eligibility-assumed-from-claims.csv"
            )
            eligibility_path = canonical_dir / eligibility_filename
            write_csv_rows(eligibility_path, eligibility_rows)
            artifacts["eligibility"] = str(eligibility_path)
            warnings.append(
                "No eligibility file was uploaded; eligibility was explicitly assumed from unique claim members."
            )
        else:
            warnings.append(
                "No eligibility file was uploaded; production-ready denominator analytics are blocked."
            )

    if not any(file_mapping(file_info, manifest) for file_info in manifest.get("files", [])):
        warnings.append("No imported mapping was attached to this session; source headers were used as canonical names.")

    return claims, artifacts, warnings


def selected_years(claims: list[dict[str, Any]]) -> list[int]:
    years = sorted({claim["service_year"] for claim in claims if claim.get("service_year")})
    return years[-3:] if years else [datetime.now().year]


def claims_for_year(claims: list[dict[str, Any]], year: int) -> list[dict[str, Any]]:
    return [claim for claim in claims if claim.get("service_year") == year]


def sum_amount(claims: list[dict[str, Any]], file_type: str | None = None) -> float:
    return round(
        sum(
            float(claim["amount"])
            for claim in claims
            if claim.get("amount") is not None and (file_type is None or claim.get("file_type") == file_type)
        ),
        2,
    )


def members(claims: list[dict[str, Any]]) -> set[str]:
    return {claim["member_id"] for claim in claims if claim.get("member_id")}


def fte_for(claims: list[dict[str, Any]]) -> float:
    # Eligibility fallback: one full-year equivalent per member seen in claims.
    return float(max(len(members(claims)), 1))


def section(name: str, columns: list[str], rows: list[dict[str, Any]], properties: dict[str, Any] | None = None):
    resolved_columns = columns or (list(rows[0].keys()) if rows else [])
    return {"name": name, "columns": resolved_columns, "rows": rows, "properties": properties or {}}


def condition_rows(claims: list[dict[str, Any]], medical_only: bool = False) -> list[dict[str, Any]]:
    by_condition: dict[str, dict[str, Any]] = defaultdict(lambda: {"members": set(), "medical": 0.0, "rx": 0.0})
    total_members = max(len(members(claims)), 1)
    for claim in claims:
        if medical_only and claim.get("file_type") != "medical":
            continue
        amount = float(claim.get("amount") or 0)
        for condition in claim.get("conditions") or []:
            bucket = by_condition[condition]
            if claim.get("member_id"):
                bucket["members"].add(claim["member_id"])
            if claim.get("file_type") == "pharmacy":
                bucket["rx"] += amount
            else:
                bucket["medical"] += amount

    rows = []
    for condition, values in by_condition.items():
        claimant_count = len(values["members"])
        total = round(values["medical"] + values["rx"], 2)
        rows.append(
            {
                "condition_group": condition,
                "claimant_count": claimant_count,
                "member_count": claimant_count,
                "pct": claimant_count / total_members if total_members else 0,
                "cost_medical": round(values["medical"], 2),
                "cost_rx": round(values["rx"], 2),
                "total": total,
                "pppy": round(total / max(claimant_count, 1), 2),
            }
        )
    return sorted(rows, key=lambda row: row["total"], reverse=True)


def ip_er_rows(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_condition: dict[str, dict[str, Any]] = defaultdict(lambda: {"members": set(), "cost_ip": 0.0, "cost_er": 0.0})
    for claim in claims:
        if claim.get("file_type") != "medical" or claim.get("pos_code") not in IP_POS | ER_POS:
            continue
        amount = float(claim.get("amount") or 0)
        for condition in claim.get("conditions") or ["Unmapped"]:
            bucket = by_condition[condition]
            if claim.get("member_id"):
                bucket["members"].add(claim["member_id"])
            if claim.get("pos_code") in IP_POS:
                bucket["cost_ip"] += amount
            if claim.get("pos_code") in ER_POS:
                bucket["cost_er"] += amount
    rows = []
    for condition, values in by_condition.items():
        cost_ip = round(values["cost_ip"], 2)
        cost_er = round(values["cost_er"], 2)
        rows.append(
            {
                "condition_group": condition,
                "claimant_count": len(values["members"]),
                "cost_ip": cost_ip,
                "cost_er": cost_er,
                "cost_ip_er": round(cost_ip + cost_er, 2),
            }
        )
    return sorted(rows, key=lambda row: row["cost_ip_er"], reverse=True)


def visits_rows(claims: list[dict[str, Any]], fte: float) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = defaultdict(lambda: {"members": set(), "ip": 0, "er": 0})
    for claim in claims:
        if claim.get("pos_code") not in IP_POS | ER_POS:
            continue
        for condition in claim.get("conditions") or ["Unmapped"]:
            bucket = counts[condition]
            if claim.get("member_id"):
                bucket["members"].add(claim["member_id"])
            if claim.get("pos_code") in IP_POS:
                bucket["ip"] += 1
            if claim.get("pos_code") in ER_POS:
                bucket["er"] += 1
    return [
        {
            "condition_group": condition,
            "claimant_count": len(values["members"]),
            "ip_visit_count": values["ip"],
            "er_visit_count": values["er"],
            "ip_visit_count_scaled": round((values["ip"] / max(fte, 1)) * 1000, 2),
            "er_visit_count_scaled": round((values["er"] / max(fte, 1)) * 1000, 2),
        }
        for condition, values in sorted(
            counts.items(), key=lambda item: item[1]["ip"] + item[1]["er"], reverse=True
        )
    ]


def cc_matrix(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    member_conditions: dict[str, set[str]] = defaultdict(set)
    for claim in claims:
        member_id = claim.get("member_id")
        if not member_id:
            continue
        member_conditions[member_id].update(claim.get("conditions") or [])
    condition_names = sorted({condition for conditions in member_conditions.values() for condition in conditions})[:12]
    rows: list[dict[str, Any]] = []
    for left in condition_names:
        row: dict[str, Any] = {"condition_group": left}
        for right in condition_names:
            row[right] = sum(1 for conditions in member_conditions.values() if left in conditions and right in conditions)
        rows.append(row)
    return rows


def primary_icd_rows(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = defaultdict(lambda: {"members": set(), "count": 0, "amount": 0.0})
    for claim in claims:
        code = (claim.get("diagnoses") or ["Unmapped"])[0]
        if claim.get("member_id"):
            buckets[code]["members"].add(claim["member_id"])
        buckets[code]["count"] += 1
        buckets[code]["amount"] += float(claim.get("amount") or 0)
    return [
        {
            "icd_code": code,
            "member_count": len(values["members"]),
            "claim_count": values["count"],
            "cost_medical": round(values["amount"], 2),
        }
        for code, values in sorted(buckets.items(), key=lambda item: item[1]["amount"], reverse=True)[:25]
    ]


def comorbidity_rows(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    member_conditions: dict[str, set[str]] = defaultdict(set)
    member_amounts: dict[str, float] = defaultdict(float)
    for claim in claims:
        member_id = claim.get("member_id")
        if not member_id:
            continue
        member_conditions[member_id].update(claim.get("conditions") or [])
        member_amounts[member_id] += float(claim.get("amount") or 0)
    buckets: dict[int, dict[str, Any]] = defaultdict(lambda: {"members": 0, "amount": 0.0})
    for member_id, conditions in member_conditions.items():
        count = len(conditions)
        buckets[count]["members"] += 1
        buckets[count]["amount"] += member_amounts[member_id]
    return [
        {
            "comorbidity_count": count,
            "member_count": values["members"],
            "total": round(values["amount"], 2),
            "pppy": round(values["amount"] / max(values["members"], 1), 2),
        }
        for count, values in sorted(buckets.items())
    ]


def risk_rows(claims: list[dict[str, Any]], subgrouping: bool = False) -> list[dict[str, Any]]:
    member_amounts: dict[str, float] = defaultdict(float)
    member_conditions: dict[str, set[str]] = defaultdict(set)
    for claim in claims:
        member_id = claim.get("member_id")
        if not member_id:
            continue
        member_amounts[member_id] += float(claim.get("amount") or 0)
        member_conditions[member_id].update(claim.get("conditions") or [])
    sorted_members = sorted(member_amounts.items(), key=lambda item: item[1], reverse=True)
    total_members = max(len(sorted_members), 1)

    def risk_for(index: int) -> str:
        pct = (index + 1) / total_members
        if pct <= 0.1:
            return "high"
        if pct <= 0.5:
            return "moderate"
        return "low"

    if subgrouping:
        counter: Counter[tuple[str, str]] = Counter()
        for index, (member_id, _amount) in enumerate(sorted_members):
            risk = risk_for(index)
            for condition in member_conditions.get(member_id) or {"Unmapped"}:
                counter[(condition, risk)] += 1
        return [
            {
                "condition_group": condition,
                "risk_group": risk,
                "counts": count,
                "percent": count / total_members,
            }
            for (condition, risk), count in counter.most_common(50)
        ]

    counts: Counter[str] = Counter(risk_for(index) for index, _item in enumerate(sorted_members))
    return [
        {"risk_group": risk, "counts": count, "percent": count / total_members}
        for risk, count in counts.items()
    ]


def build_year_report(claims: list[dict[str, Any]], year: int, sheet_name: str, client_name: str) -> dict[str, Any]:
    year_claims = claims_for_year(claims, year)
    fte = fte_for(year_claims)
    medical_total = sum_amount(year_claims, "medical")
    pharmacy_total = sum_amount(year_claims, "pharmacy")
    cc_costs = condition_rows(year_claims)
    prevalence = [
        {
            "condition_group": row["condition_group"],
            "claimant_count": row["claimant_count"],
            "member_count": row["member_count"],
            "pct": row["pct"],
        }
        for row in cc_costs
    ]
    mh6 = [row for row in cc_costs if row["condition_group"] in MENTAL_HEALTH_CONDITIONS or "Mental" in row["condition_group"]]

    sections = {
        "get_summary": section(
            "get_summary",
            [],
            [],
            {
                "apply_exclusions": False,
                "client_name": client_name,
                "analysis_year": year,
                "medical_total": medical_total,
                "pharmacy_total": pharmacy_total,
                "fte": fte,
                "medical_total_pppy": round(medical_total / max(fte, 1), 2),
                "pharmacy_total_pppy": round(pharmacy_total / max(fte, 1), 2),
            },
        ),
        "get_summary_w_exlusions": section(
            "get_summary_w_exlusions",
            [],
            [],
            {
                "apply_exclusions": True,
                "client_name": client_name,
                "analysis_year": year,
                "medical_total": medical_total,
                "pharmacy_total": pharmacy_total,
                "fte": fte,
                "medical_total_pppy": round(medical_total / max(fte, 1), 2),
                "pharmacy_total_pppy": round(pharmacy_total / max(fte, 1), 2),
            },
        ),
        "get_cc_costs": section("get_cc_costs", list(cc_costs[0].keys()) if cc_costs else [], cc_costs),
        "get_cc_costs_exclusions": section("get_cc_costs_exclusions", list(cc_costs[0].keys()) if cc_costs else [], cc_costs),
        "get_cc_costs_ip_er_w_exclusions": section("get_cc_costs_ip_er_w_exclusions", [], ip_er_rows(year_claims)),
        "get_ccuh_ip_er_visits_w_exclusions": section("get_ccuh_ip_er_visits_w_exclusions", [], visits_rows(year_claims, fte)),
        "get_medical__cc_matrix": section("get_medical__cc_matrix", [], cc_matrix(year_claims)),
        "get_cc__prevalence": section("get_cc__prevalence", ["condition_group", "claimant_count", "pct"], prevalence),
        "get_primary_icd_cost": section("get_primary_icd_cost", [], primary_icd_rows(year_claims)),
        "get_mh6_breakout": section("get_mh6_breakout", [], prevalence if not mh6 else mh6),
        "get_mh6_breakout_cost": section("get_mh6_breakout_cost", [], mh6),
        "get_cost_per_comorbidity_count": section("get_cost_per_comorbidity_count", [], comorbidity_rows(year_claims)),
        "get_cc_summary_enhanced": section("get_cc_summary_enhanced", [], prevalence),
        "get_disease_risk_acuity_profile_no_filters": section("get_disease_risk_acuity_profile_no_filters", [], risk_rows(year_claims)),
        "get_disease_risk_acuity_profile_CC_subpop": section("get_disease_risk_acuity_profile_CC_subpop", [], risk_rows(year_claims)),
        "get_disease_risk_acuity_profile_exclusions_applied": section("get_disease_risk_acuity_profile_exclusions_applied", [], risk_rows(year_claims)),
        "get_disease_risk_acuity_profile_CC_subgrouping": section("get_disease_risk_acuity_profile_CC_subgrouping", [], risk_rows(year_claims, subgrouping=True)),
    }

    return {
        "sheetName": sheet_name,
        "analysisYear": year,
        "clientName": client_name,
        "sections": sections,
    }


def year_summary(report: dict[str, Any]) -> dict[str, Any]:
    full = report["sections"]["get_summary"]["properties"]
    exclusions = report["sections"]["get_summary_w_exlusions"]["properties"]
    medical_total = full.get("medical_total")
    medical_total_after = exclusions.get("medical_total")
    return {
        "sheetName": report["sheetName"],
        "analysisYear": report["analysisYear"],
        "medicalTotal": medical_total,
        "medicalTotalAfterExclusions": medical_total_after,
        "pharmacyTotal": full.get("pharmacy_total"),
        "fte": exclusions.get("fte") or full.get("fte"),
        "medicalPppy": full.get("medical_total_pppy"),
        "medicalPppyAfterExclusions": exclusions.get("medical_total_pppy"),
        "exclusionSavings": round((medical_total or 0) - (medical_total_after or 0), 2),
    }


def percent_change(current: float | int | None, previous: float | int | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return round(((float(current) - float(previous)) / float(previous)) * 100, 2)


def build_validation_summary(
    claims: list[dict[str, Any]],
    warnings: list[str] | None,
    cleaned_artifacts: dict[str, str] | None,
    manifest_validation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    total_claims = len(claims)
    claims_with_member = sum(1 for claim in claims if claim.get("member_id"))
    claims_with_year = sum(1 for claim in claims if claim.get("service_year"))
    claims_with_amount = sum(1 for claim in claims if claim.get("amount") is not None)
    claims_with_diagnosis = sum(1 for claim in claims if claim.get("diagnoses"))
    claims_with_condition = sum(1 for claim in claims if claim.get("conditions"))
    service_years = selected_years(claims) if claims else []
    checks = [
        {
            "key": "member_id",
            "label": "Member identity",
            "status": "met" if claims_with_member else "missing",
            "coverage": claims_with_member / max(total_claims, 1),
        },
        {
            "key": "service_year",
            "label": "Service/fill date",
            "status": "met" if claims_with_year else "missing",
            "coverage": claims_with_year / max(total_claims, 1),
        },
        {
            "key": "amount",
            "label": "Claim amount",
            "status": "met" if claims_with_amount else "missing",
            "coverage": claims_with_amount / max(total_claims, 1),
        },
        {
            "key": "diagnosis",
            "label": "Diagnosis signal",
            "status": "met" if claims_with_diagnosis else "warning",
            "coverage": claims_with_diagnosis / max(total_claims, 1),
        },
        {
            "key": "condition_group",
            "label": "Condition grouping",
            "status": "met" if claims_with_condition else "warning",
            "coverage": claims_with_condition / max(total_claims, 1),
        },
        {
            "key": "eligibility",
            "label": "Eligibility denominator",
            "status": "met" if cleaned_artifacts and cleaned_artifacts.get("eligibility") else "warning",
            "coverage": 1 if cleaned_artifacts and cleaned_artifacts.get("eligibility") else 0,
        },
    ]

    validation_warnings = list(warnings or [])
    manifest_validation = manifest_validation or {}
    for warning in manifest_validation.get("warnings") or []:
        message = warning.get("message") if isinstance(warning, dict) else None
        if message and message not in validation_warnings:
            validation_warnings.append(str(message))
    if total_claims and not claims_with_amount:
        validation_warnings.append("No amount fields were mapped; cost visuals will be zero.")
    if total_claims and not claims_with_year:
        validation_warnings.append("No service years were detected; the analysis cannot infer year_1/year_2/year_3 from claim dates.")
    if total_claims and not claims_with_condition:
        validation_warnings.append("No diagnosis codes matched the condition mapping; chronic-condition visuals will be sparse.")

    return {
        "claimCount": total_claims,
        "serviceYears": service_years,
        "productionReady": bool(manifest_validation.get("productionReady", False))
        if manifest_validation
        else bool(cleaned_artifacts and cleaned_artifacts.get("eligibility")),
        "session": manifest_validation.get("session", {}),
        "checks": checks,
        "warnings": validation_warnings,
        "cleanedArtifacts": cleaned_artifacts or {},
    }


def build_dashboard_contract(
    reports: list[dict[str, Any]], summary: dict[str, Any], validation: dict[str, Any]
) -> dict[str, Any]:
    year_rows = summary.get("years", [])
    trend = []
    for index, year in enumerate(year_rows):
        previous = year_rows[index - 1] if index else None
        medical_total = year.get("medicalTotalAfterExclusions") or year.get("medicalTotal")
        trend.append(
            {
                "sheetName": year.get("sheetName"),
                "analysisYear": year.get("analysisYear"),
                "medicalTotal": year.get("medicalTotal"),
                "medicalTotalAfterExclusions": year.get("medicalTotalAfterExclusions"),
                "pharmacyTotal": year.get("pharmacyTotal"),
                "medicalPppy": year.get("medicalPppyAfterExclusions") or year.get("medicalPppy"),
                "annualMedicalChangePct": percent_change(
                    medical_total,
                    (previous or {}).get("medicalTotalAfterExclusions") or (previous or {}).get("medicalTotal"),
                ),
            }
        )

    changes = [
        row["annualMedicalChangePct"]
        for row in trend
        if isinstance(row.get("annualMedicalChangePct"), (int, float))
    ]
    average_change = round(sum(changes) / len(changes), 2) if changes else 0
    latest = summary.get("latestYear") or {}
    latest_medical = latest.get("medicalTotalAfterExclusions") or latest.get("medicalTotal") or 0
    projected_next_year = round(float(latest_medical) * (1 + (average_change / 100)), 2)
    roi_opportunity = round(float(latest_medical) * 0.03, 2)
    top_conditions = summary.get("conditionCosts", [])
    top_condition = top_conditions[0] if top_conditions else None

    findings = []
    if latest.get("analysisYear"):
        findings.append(
            {
                "title": "Cost baseline",
                "body": f"Latest analyzed year is {latest.get('analysisYear')} with medical spend of ${float(latest_medical):,.0f}.",
            }
        )
    if top_condition:
        findings.append(
            {
                "title": "Clinical concentration",
                "body": f"{top_condition.get('condition_group')} is the highest-cost detected condition group in the latest year.",
            }
        )
    if validation.get("warnings"):
        findings.append(
            {
                "title": "Data quality",
                "body": "Analysis completed with warnings; review the validation panel before using numbers externally.",
            }
        )

    return {
        "kpis": {
            "latestYear": latest.get("analysisYear"),
            "latestMedicalTotal": latest_medical,
            "latestMedicalPppy": latest.get("medicalPppyAfterExclusions") or latest.get("medicalPppy"),
            "annualMedicalChangePct": trend[-1]["annualMedicalChangePct"] if trend else None,
            "projectedNextYearMedicalTotal": projected_next_year,
            "illustrativeRoiOpportunity": roi_opportunity,
        },
        "trends": {
            "annualMedicalCost": trend,
            "averageAnnualMedicalChangePct": average_change,
        },
        "rankedLists": {
            "conditionCosts": summary.get("conditionCosts", []),
            "conditionPrevalence": summary.get("conditionPrevalence", []),
            "riskProfile": summary.get("riskProfile", []),
        },
        "matrix": (reports[-1]["sections"].get("get_medical__cc_matrix", {}) if reports else {}).get("rows", []),
        "findings": findings,
        "recommendations": [
            "Validate mapped amount, date, member, and diagnosis fields before presenting financial results.",
            "Use uploaded eligibility when available; generated eligibility is deterministic but only demo-grade.",
            "Prioritize care-management review around the highest-cost condition groups and high-risk acuity rows.",
        ],
        "validation": validation,
    }


def write_xlsx_report(report: dict[str, Any], out_dir: Path) -> str | None:
    try:
        import xlsxwriter  # type: ignore[import-not-found]
    except Exception:
        return None

    path = out_dir / "analysis-report.xlsx"
    workbook = xlsxwriter.Workbook(str(path))
    header_format = workbook.add_format({"bold": True, "bg_color": "#E8EEF7", "border": 1})
    section_format = workbook.add_format({"bold": True, "font_color": "#1F2937"})

    summary_sheet = workbook.add_worksheet("summary")
    summary_sheet.write_row(0, 0, ["sheetName", "analysisYear", "medicalTotal", "medicalAfterExclusions", "medicalPppy"], header_format)
    for row_index, year in enumerate(report.get("summary", {}).get("years", []), start=1):
        summary_sheet.write_row(
            row_index,
            0,
            [
                year.get("sheetName"),
                year.get("analysisYear"),
                year.get("medicalTotal"),
                year.get("medicalTotalAfterExclusions"),
                year.get("medicalPppyAfterExclusions") or year.get("medicalPppy"),
            ],
        )

    for year_report in report.get("years", []):
        worksheet = workbook.add_worksheet(str(year_report.get("sheetName", "year"))[:31])
        cursor = 0
        sections = year_report.get("sections", {})
        for section_name in REPORT_SECTIONS:
            table = sections.get(section_name)
            if not table:
                continue
            worksheet.write(cursor, 0, section_name, section_format)
            cursor += 1
            properties = table.get("properties") or {}
            for key, value in properties.items():
                worksheet.write(cursor, 0, key)
                worksheet.write(cursor, 1, value)
                cursor += 1
            rows = table.get("rows") or []
            if rows:
                columns = table.get("columns") or list(rows[0].keys())
                worksheet.write_row(cursor, 0, columns, header_format)
                cursor += 1
                for row in rows:
                    worksheet.write_row(cursor, 0, [row.get(column) for column in columns])
                    cursor += 1
            cursor += 2

    workbook.close()
    return str(path)


def build_report_from_claims(
    manifest: dict[str, Any],
    out_dir: Path,
    claims: list[dict[str, Any]],
    mode: str,
    warnings: list[str] | None = None,
    cleaned_artifacts: dict[str, str] | None = None,
) -> dict[str, Any]:
    validation = build_validation_summary(
        claims, warnings, cleaned_artifacts, manifest.get("validation") or None
    )
    years = selected_years(claims)
    reports = [
        build_year_report(claims, year, f"year_{index + 1}", manifest.get("accountId", "demo"))
        for index, year in enumerate(years)
    ]
    latest = reports[-1] if reports else None
    latest_sections = latest["sections"] if latest else {}
    summary = {
        "sourceFilename": "uploaded raw claims",
        "sourceFormat": "python_claims_analysis",
        "yearCount": len(reports),
        "sectionCount": sum(len(report["sections"]) for report in reports),
        "years": [year_summary(report) for report in reports],
        "latestYear": year_summary(latest) if latest else None,
        "conditionCosts": (latest_sections.get("get_cc_costs_exclusions") or {}).get("rows", [])[:8],
        "conditionPrevalence": (latest_sections.get("get_cc__prevalence") or {}).get("rows", [])[:8],
        "riskProfile": (latest_sections.get("get_disease_risk_acuity_profile_exclusions_applied") or {}).get("rows", [])[:8],
        "availableSections": REPORT_SECTIONS,
    }
    dashboard = build_dashboard_contract(reports, summary, validation)
    return {
        "sourceFormat": "python_claims_analysis",
        "parsedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "outDir": str(out_dir),
        "analysisMode": mode,
        "cleanedArtifacts": cleaned_artifacts or {},
        "validation": validation,
        "dashboard": dashboard,
        "years": reports,
        "summary": summary,
        "warnings": validation["warnings"] if claims else ["No medical or pharmacy claims were found in this manifest."],
    }


def build_report(manifest: dict[str, Any], out_dir: Path, deps: dict[str, Any]) -> dict[str, Any]:
    root = Path(__file__).resolve().parent
    condition_map = load_condition_map(root)

    if deps.get("ok"):
        claims, artifacts, warnings = read_claims_source_ready(manifest, condition_map, out_dir)
        return build_report_from_claims(
            manifest,
            out_dir,
            claims,
            "source_ready",
            warnings=warnings,
            cleaned_artifacts=artifacts,
        )

    claims = read_claims(manifest, condition_map)
    return build_report_from_claims(manifest, out_dir, claims, "fallback_analysis")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run app-owned claims analysis.")
    parser.add_argument("--probe", action="store_true", help="Print runtime status and exit.")
    parser.add_argument("--manifest", help="Path to an app-generated analysis manifest.")
    parser.add_argument("--out-dir", help="Directory for generated artifacts.")
    args = parser.parse_args()

    deps = dependency_report()
    probe = {
        "ok": True,
        "python": ".".join(map(str, __import__("sys").version_info[:3])),
        "mode": "fallback_analysis" if not deps["ok"] else "source_ready",
        "analyticsDependencies": deps,
    }
    if args.probe:
        print(json.dumps(probe, indent=2))
        return 0

    if not args.manifest:
        print(json.dumps({"ok": False, "error": "--manifest is required unless --probe is used"}))
        return 2

    manifest_path = Path(args.manifest)
    out_dir = Path(args.out_dir) if args.out_dir else manifest_path.parent
    status_path = out_dir / "python-status.json"
    report_path = out_dir / "report-sections.json"

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        etl_result = run_etl(manifest, out_dir, deps)
        attach_etl_metadata(manifest, etl_result)
        report = build_report(manifest, out_dir, deps)
        if etl_result:
            report["etl"] = {
                "status": etl_result.get("status"),
                "artifacts": etl_result.get("artifacts"),
                "analyticsReady": etl_result.get("analyticsReady"),
                "validationPath": (etl_result.get("artifacts") or {}).get("validation"),
            }
        xlsx_path = write_xlsx_report(report, out_dir)
        if xlsx_path:
            report["xlsxReportPath"] = xlsx_path
        write_json(report_path, report)
        status = {
            "ok": True,
            "stage": "analysis_complete",
            "mode": probe["mode"],
            "sessionId": manifest.get("sessionId"),
            "reportPath": str(report_path),
            "xlsxReportPath": xlsx_path,
            "cleanedArtifacts": report.get("cleanedArtifacts", {}),
            "etlArtifacts": (etl_result or {}).get("artifacts", {}),
            "etlValidationPath": ((etl_result or {}).get("artifacts") or {}).get("validation"),
            "etlStatus": (etl_result or {}).get("status"),
            "analyticsReady": bool((etl_result or {}).get("analyticsReady", False)),
            "etlValidation": (etl_result or {}).get("validation", {}),
            "validation": report.get("validation", {}),
            "analyticsDependencies": deps,
            "warnings": report.get("warnings", []),
        }
        write_json(status_path, status)
        write_json(manifest_path, manifest)
        print(json.dumps({"ok": True, "statusPath": str(status_path), "reportPath": str(report_path)}))
        return 0
    except Exception as exc:
        status = {
            "ok": False,
            "stage": "analysis_failed",
            "error": f"{type(exc).__name__}: {exc}",
            "analyticsDependencies": deps,
        }
        write_json(status_path, status)
        print(json.dumps({"ok": False, "statusPath": str(status_path), "error": status["error"]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
