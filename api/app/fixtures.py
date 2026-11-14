"""Load fixture JSON: real data (fixtures/real, built locally from the CoStar kit) first, placeholders (fixtures/demo) second."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REAL = ROOT / "fixtures" / "real"
DEMO = ROOT / "fixtures" / "demo"


def load(key: str, name: str) -> dict:
    for base in (REAL, DEMO):
        path = base / key / f"{name}.json"
        if path.exists():
            data = json.loads(path.read_text())
            data.setdefault("_source", "real" if base == REAL else "placeholder")
            return data
    # Unknown suite: fall back to the demo suite's placeholder so the UI still renders
    path = DEMO / "travis_900" / f"{name}.json"
    data = json.loads(path.read_text())
    data["_source"] = "placeholder"
    return data


def available_suites() -> list[str]:
    keys = set()
    for base in (REAL, DEMO):
        if base.exists():
            keys.update(p.name for p in base.iterdir() if p.is_dir())
    return sorted(keys)
