# etl/ingestion/stream_cleaner.py
import sys, json, pandas as pd
from etl.ingestion.cleaner import EligibilityReader, MedicalReader, PharmacyReader

def _pick_reader(kind: str):
    if kind == "eligibility": return EligibilityReader()
    if kind == "medical":     return MedicalReader()
    if kind == "pharmacy":    return PharmacyReader()
    sys.stderr.write(json.dumps({"error": f"Invalid reader_type: {kind}"}) + "\n")
    sys.exit(1)

def _read_tabular(path: str) -> pd.DataFrame:
    lower = path.lower()
    if lower.endswith((".xlsx", ".xls")):
        return pd.read_excel(path, dtype=str)
    # CSV / TSV / PSV
    try:
        return pd.read_csv(path, dtype=str)
    except Exception:
        for sep in ["\t", "|", ";"]:
            try:
                return pd.read_csv(path, dtype=str, sep=sep)
            except Exception:
                pass
        return pd.read_csv(path, dtype=str, sep=None, engine="python")

def main():
    # First line on stdin is options JSON
    options = json.loads(sys.stdin.readline() or "{}")
    reader_type = options.get("reader_type")
    clean_args  = options.get("clean_args", {})
    chunk_size  = int(options.get("chunk_size", 100000))
    file_paths  = options.get("file_paths", [])

    reader = _pick_reader(reader_type)

    # ===== Mode 1 (MVP): file_paths supplied → read files, clean, emit NDJSON =====
    if file_paths:
        frames = [ _read_tabular(p) for p in file_paths ]
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        cleaned = reader.clean(df, **clean_args)
        for rec in cleaned.to_dict(orient="records"):
            sys.stdout.write(json.dumps(rec) + "\n")
        sys.stdout.flush()
        return

    # ===== Mode 2 (existing): NDJSON stream on stdin =====
    buffer = []
    for line in sys.stdin:
        try:
            buffer.append(json.loads(line))
            if len(buffer) >= chunk_size:
                df = reader.read(data=buffer) if hasattr(reader, "read") else pd.DataFrame(buffer)
                cleaned = reader.clean(df, **clean_args)
                for rec in cleaned.to_dict(orient="records"):
                    sys.stdout.write(json.dumps(rec) + "\n")
                buffer = []
        except Exception as e:
            sys.stderr.write(json.dumps({"error": str(e)}) + "\n")
            sys.exit(2)
    if buffer:
        df = pd.DataFrame(buffer)
        cleaned = reader.clean(df, **clean_args)
        for rec in cleaned.to_dict(orient="records"):
            sys.stdout.write(json.dumps(rec) + "\n")

if __name__ == "__main__":
    main()
