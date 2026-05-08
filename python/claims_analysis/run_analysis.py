"""Thin adapter for the vendored claims-analysis package.

The Svelte app owns this file. It is intentionally separate from the
historical ETL modules so we can modernize runtime behavior without editing
the original copied source directly.
"""

from __future__ import annotations

import argparse
import importlib
import json
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


def dependency_report() -> dict[str, Any]:
    missing: list[str] = []
    loaded: dict[str, str] = {}

    for module_name in REQUIRED_MODULES:
        try:
            module = importlib.import_module(module_name)
            loaded[module_name] = str(getattr(module, "__version__", "unknown"))
        except Exception as exc:  # pragma: no cover - used by external runtime checks
            missing.append(f"{module_name}: {type(exc).__name__}: {exc}")

    return {
        "ok": not missing,
        "loaded": loaded,
        "missing": missing,
    }


def write_status(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run vendored claims analysis adapters.")
    parser.add_argument("--probe", action="store_true", help="Print dependency status and exit.")
    parser.add_argument("--manifest", help="Path to an app-generated analysis manifest.")
    args = parser.parse_args()

    deps = dependency_report()
    if args.probe:
        print(json.dumps(deps, indent=2))
        return 0 if deps["ok"] else 2

    if not args.manifest:
        print(json.dumps({"ok": False, "error": "--manifest is required unless --probe is used"}))
        return 2

    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    status_path = manifest_path.parent / "python-status.json"

    if not deps["ok"]:
        write_status(
            status_path,
            {
                "ok": False,
                "stage": "dependency_check",
                "dependencies": deps,
                "message": "Install python/claims_analysis/requirements.txt before running deep ETL/BI.",
            },
        )
        print(json.dumps({"ok": False, "statusPath": str(status_path), "dependencies": deps}))
        return 2

    # Deep ETL/BI execution will be implemented in the next slice. The
    # manifest contract is already in place, so the app can remain stable while
    # this adapter grows.
    write_status(
        status_path,
        {
            "ok": True,
            "stage": "ready",
            "sessionId": manifest.get("sessionId"),
            "message": "Dependencies are available. Deep ETL/BI execution is ready to wire.",
        },
    )
    print(json.dumps({"ok": True, "statusPath": str(status_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
