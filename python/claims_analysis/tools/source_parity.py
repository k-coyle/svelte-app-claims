"""Compare this repo's analytics with the historic source repo.

The README sample is executed with a runtime shim for reader config lookup so
both checkouts load module-local config files consistently. The shim is applied
equally to both repos at runtime; it does not edit either repo.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any


REPORT_CALLS = [
    ("get_summary", "get_summary"),
    ("get_summary_w_exlusions", "get_summary", {"apply_exclusions": True}),
    ("get_cc_costs", "get_cc_costs"),
    ("get_cc_costs_exclusions", "get_cc_costs", {"apply_exclusions": True}),
    ("get_cc_costs_ip_er_w_exclusions", "get_cc_costs_ip_er", {"apply_exclusions": True}),
    ("get_ccuh_ip_er_visits_w_exclusions", "get_ccuh_ip_er_visits", {"apply_exclusions": True}),
    ("get_medical__cc_matrix", "get_medical__cc_matrix"),
    ("get_cc__prevalence", "get_cc__prevalence"),
    ("get_primary_icd_cost", "get_primary_icd_cost"),
    ("get_mh6_breakout", "get_mh6_breakout"),
    ("get_mh6_breakout_cost", "get_mh6_breakout_cost"),
    ("get_cost_per_comorbidity_count", "get_cost_per_comorbidity_count"),
    ("get_cc_summary_enhanced", "get_cc_summary_enhanced"),
    (
        "get_disease_risk_acuity_profile_no_filters",
        "get_disease_risk_acuity_profile",
        {"cc_filter": False, "cc_subgrouping": False, "apply_exclusions": False},
    ),
    (
        "get_disease_risk_acuity_profile_CC_subpop",
        "get_disease_risk_acuity_profile",
        {"cc_filter": True, "cc_subgrouping": False, "apply_exclusions": False},
    ),
    (
        "get_disease_risk_acuity_profile_exclusions_applied",
        "get_disease_risk_acuity_profile",
        {"cc_filter": True, "cc_subgrouping": False, "apply_exclusions": True},
    ),
    (
        "get_disease_risk_acuity_profile_CC_subgrouping",
        "get_disease_risk_acuity_profile",
        {"cc_filter": True, "cc_subgrouping": True, "apply_exclusions": True},
    ),
]

ALLOWED_FILE_DIFFERENCES = {
    "etl\\abstract.py": "app copy restores the reader public contract and removes PHI-risk debug logging",
    "etl\\app_pipeline.py": "app-owned ETL orchestration module, not copied from the historic repo",
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def file_hash(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def jsonable(value: Any) -> Any:
    try:
        import numpy as np
        import pandas as pd
    except Exception:  # pragma: no cover - dependency check happens in subprocess
        np = None
        pd = None

    if pd is not None:
        if isinstance(value, pd.DataFrame):
            return jsonable(value.reset_index().to_dict(orient="records"))
        if isinstance(value, pd.Series):
            return jsonable(value.reset_index().to_dict(orient="records"))
        if isinstance(value, (pd.Timestamp,)):
            return value.isoformat()

    if np is not None:
        if isinstance(value, np.ndarray):
            return jsonable(value.tolist())
        if isinstance(value, np.generic):
            return jsonable(value.item())

    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float):
        return None if not math.isfinite(value) else round(value, 10)
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): jsonable(val) for key, val in sorted(value.items(), key=lambda item: str(item[0]))}
    if isinstance(value, (list, tuple, set)):
        items = [jsonable(item) for item in value]
        if isinstance(value, set):
            return sorted(items, key=lambda item: json.dumps(item, sort_keys=True))
        return items
    try:
        if pd is not None and pd.isna(value):
            return None
    except Exception:
        pass
    return str(value)


def apply_readme_usage_shim() -> None:
    import pandas as pd
    from munch import Munch

    import etl.abstract as abstract
    import etl.common.cleaner as common

    def patched_reader_init(self: Any, paths: list[str], config_dir: str | None = None) -> None:
        import inspect

        self.paths = paths
        reader_file = Path(inspect.getfile(type(self)))
        config_path = reader_file.parent / "config" / f"{self.file_type}.csv"
        config = pd.read_csv(config_path)
        self.config_csv = config
        extra_config = Munch()
        self.column_mapping = dict(config[["column", "column_uspm"]].dropna().values)
        extra_config.dtype = dict(config.dropna(subset=["dtype"])[["column", "dtype"]].values)
        extra_config.usecols = config[(~pd.isnull(config.dtype) | config.parse_date)].column.values
        extra_config.parse_dates = [*config[config.parse_date].column.values]
        from etl.utils import parse_date_with_cache

        extra_config.date_parser = parse_date_with_cache
        self.extra_config = extra_config

    def patched_read_raw(self: Any) -> None:
        eligibility = self.df.eligibility
        medical = self.df.medical
        pharmacy = self.df.pharmacy

        eligibility.raw = self.readers.eligibility.read()
        eligibility.clean = self.readers.eligibility.clean(eligibility.raw, self.year)

        medical.raw = self.readers.medical.read()
        medical.clean = self.readers.medical.clean(medical.raw, eligibility.clean, self.year)

        pharmacy.raw = self.readers.pharmacy.read()
        pharmacy.clean = self.readers.pharmacy.clean(pharmacy.raw, eligibility.clean, self.year)

    abstract.AbstractReader.__init__ = patched_reader_init
    common.Cleaner.read_raw = patched_read_raw


def emit_report(code_root: Path, data_root: Path, year: int) -> dict[str, Any]:
    os.chdir(code_root)
    sys.path.insert(0, str(code_root))
    apply_readme_usage_shim()

    from etl.test.cleaner import Cleaner

    cleaner = Cleaner(
        eligibility_paths=[str(data_root / "eligibility" / "USPM_mock_claims_data__eligibility.csv")],
        medical_claims_paths=[str(data_root / "medical" / "USPM_mock_claims_data__medical.csv")],
        pharmacy_claims_paths=[str(data_root / "pharmacy" / "USPM_mock_claims_data__pharmacy.csv")],
        year=year,
    )

    outputs: dict[str, Any] = {}
    for call in REPORT_CALLS:
        label = call[0]
        method_name = call[1]
        kwargs = call[2] if len(call) > 2 else {}
        result = getattr(cleaner, method_name)(**kwargs)
        normalized = jsonable(result)
        outputs[label] = {
            "hash": sha256_json(normalized),
            "value": normalized,
        }

    return {
        "codeRoot": str(code_root),
        "dataRoot": str(data_root),
        "year": year,
        "shimApplied": True,
        "methodCount": len(outputs),
        "outputs": outputs,
    }


def shared_file_hashes(current_root: Path, historic_root: Path) -> list[dict[str, Any]]:
    current_etl = current_root / "etl"
    historic_etl = historic_root / "etl"
    rows = []
    for current_file in sorted(current_etl.rglob("*")):
        if not current_file.is_file() or "__pycache__" in current_file.parts:
            continue
        relative = current_file.relative_to(current_root)
        relative_key = str(relative)
        historic_file = historic_root / relative
        if not historic_file.exists():
            rows.append({
                "path": relative_key,
                "status": "missing_in_historic",
                "allowed": relative_key in ALLOWED_FILE_DIFFERENCES,
                "reason": ALLOWED_FILE_DIFFERENCES.get(relative_key),
            })
            continue
        current_hash = file_hash(current_file)
        historic_hash = file_hash(historic_file)
        allowed = relative_key in ALLOWED_FILE_DIFFERENCES
        rows.append(
            {
                "path": relative_key,
                "status": "identical" if current_hash == historic_hash else "different",
                "current": current_hash,
                "historic": historic_hash,
                "allowed": allowed and current_hash != historic_hash,
                "reason": ALLOWED_FILE_DIFFERENCES.get(relative_key) if allowed and current_hash != historic_hash else None,
            }
        )
    return rows


def run_emit(script: Path, code_root: Path, data_root: Path, year: int) -> dict[str, Any]:
    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--emit",
            "--code-root",
            str(code_root),
            "--data-root",
            str(data_root),
            "--year",
            str(year),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return {
            "ok": False,
            "codeRoot": str(code_root),
            "stderr": result.stderr,
            "stdout": result.stdout,
        }
    return {"ok": True, "report": json.loads(result.stdout)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare app-owned analytics with the historic source repo.")
    parser.add_argument("--historic-root", default=r"C:\Users\kcoyle\Desktop\claims-analysis")
    parser.add_argument("--current-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--data-root", default=None)
    parser.add_argument("--year", type=int, default=2018)
    parser.add_argument("--emit", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--code-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.emit:
        payload = emit_report(Path(args.code_root).resolve(), Path(args.data_root).resolve(), args.year)
        print(json.dumps(payload, sort_keys=True))
        return 0

    script = Path(__file__).resolve()
    current_root = Path(args.current_root).resolve()
    historic_root = Path(args.historic_root).resolve()
    data_root = Path(args.data_root).resolve() if args.data_root else historic_root / "data" / "test"

    if not historic_root.exists():
        print(f"Historic repo not found: {historic_root}", file=sys.stderr)
        return 2
    if not data_root.exists():
        print(f"Historic README sample data not found: {data_root}", file=sys.stderr)
        return 2

    hash_rows = shared_file_hashes(current_root, historic_root)
    changed_files = [row for row in hash_rows if row["status"] != "identical" and not row.get("allowed")]
    allowed_file_differences = [row for row in hash_rows if row["status"] != "identical" and row.get("allowed")]

    current = run_emit(script, current_root, data_root, args.year)
    historic = run_emit(script, historic_root, data_root, args.year)

    if not current["ok"] or not historic["ok"]:
        print(json.dumps({"fileParity": hash_rows, "current": current, "historic": historic}, indent=2))
        return 1

    current_outputs = current["report"]["outputs"]
    historic_outputs = historic["report"]["outputs"]
    method_rows = []
    for name in sorted(set(current_outputs) | set(historic_outputs)):
        current_hash = current_outputs.get(name, {}).get("hash")
        historic_hash = historic_outputs.get(name, {}).get("hash")
        method_rows.append(
            {
                "method": name,
                "status": "identical" if current_hash == historic_hash else "different",
                "current": current_hash,
                "historic": historic_hash,
            }
        )

    changed_methods = [row for row in method_rows if row["status"] != "identical"]
    payload = {
        "ok": not changed_files and not changed_methods,
        "historicRoot": str(historic_root),
        "currentRoot": str(current_root),
        "dataRoot": str(data_root),
        "year": args.year,
        "compatibilityShimApplied": True,
        "sharedFileCount": len(hash_rows),
        "changedFiles": changed_files,
        "allowedFileDifferences": allowed_file_differences,
        "methodCount": len(method_rows),
        "changedMethods": changed_methods,
    }
    print(json.dumps(payload, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
