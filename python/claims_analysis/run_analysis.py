"""App-owned claims analysis runner for the Svelte MVP demo.

This file is intentionally independent from the historical modules' file-path
assumptions. It produces the same broad report-section contract as
``write_excel_report()`` from uploaded raw claims, using only the Python
standard library when legacy pandas dependencies are unavailable.
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
    mapping = ((manifest.get("mapping") or {}).get("fields") or {})
    claims: list[dict[str, Any]] = []

    for file_info in manifest.get("files", []):
        path = Path(file_info.get("path", ""))
        file_type = str(file_info.get("fileType") or "")
        if file_type not in {"medical", "pharmacy"} or not path.exists():
            continue

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
    # Demo eligibility fallback: one full-year equivalent per member seen in claims.
    return float(max(len(members(claims)), 1))


def section(name: str, columns: list[str], rows: list[dict[str, Any]], properties: dict[str, Any] | None = None):
    return {"name": name, "columns": columns, "rows": rows, "properties": properties or {}}


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
                "pct": claimant_count / total_members if total_members else 0,
                "cost_medical": round(values["medical"], 2),
                "cost_rx": round(values["rx"], 2),
                "total": total,
                "pppy": round(total / max(claimant_count, 1), 2),
            }
        )
    return sorted(rows, key=lambda row: row["total"], reverse=True)


def ip_er_rows(claims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    filtered = [claim for claim in claims if claim.get("pos_code") in IP_POS | ER_POS]
    rows = condition_rows(filtered, medical_only=True)
    for row in rows:
        row["ip_er_total"] = row["total"]
    return rows


def visits_rows(claims: list[dict[str, Any]], fte: float) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for claim in claims:
        if claim.get("pos_code") not in IP_POS | ER_POS:
            continue
        for condition in claim.get("conditions") or ["Unmapped"]:
            counts[condition] += 1
    return [
        {
            "condition_group": condition,
            "visit_count": count,
            "visits_per_1000": round((count / max(fte, 1)) * 1000, 2),
        }
        for condition, count in counts.most_common()
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
    buckets: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "amount": 0.0})
    for claim in claims:
        code = (claim.get("diagnoses") or ["Unmapped"])[0]
        buckets[code]["count"] += 1
        buckets[code]["amount"] += float(claim.get("amount") or 0)
    return [
        {"icd_code": code, "claim_count": values["count"], "total": round(values["amount"], 2)}
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
        {"condition_group": row["condition_group"], "claimant_count": row["claimant_count"], "pct": row["pct"]}
        for row in cc_costs
    ]
    mh6 = [row for row in cc_costs if row["condition_group"] == "MH6" or "Mental" in row["condition_group"]]

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


def build_report(manifest: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    root = Path(__file__).resolve().parent
    condition_map = load_condition_map(root)
    claims = read_claims(manifest, condition_map)
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
    return {
        "sourceFormat": "python_claims_analysis",
        "parsedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "outDir": str(out_dir),
        "years": reports,
        "summary": summary,
        "warnings": [] if claims else ["No medical or pharmacy claims were found in this manifest."],
    }


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
        "mode": "stdlib_mvp" if not deps["ok"] else "legacy_ready",
        "legacyDependencies": deps,
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
        report = build_report(manifest, out_dir)
        write_json(report_path, report)
        status = {
            "ok": True,
            "stage": "analysis_complete",
            "mode": probe["mode"],
            "sessionId": manifest.get("sessionId"),
            "reportPath": str(report_path),
            "legacyDependencies": deps,
            "warnings": report.get("warnings", []),
        }
        write_json(status_path, status)
        print(json.dumps({"ok": True, "statusPath": str(status_path), "reportPath": str(report_path)}))
        return 0
    except Exception as exc:
        status = {
            "ok": False,
            "stage": "analysis_failed",
            "error": f"{type(exc).__name__}: {exc}",
            "legacyDependencies": deps,
        }
        write_json(status_path, status)
        print(json.dumps({"ok": False, "statusPath": str(status_path), "error": status["error"]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
