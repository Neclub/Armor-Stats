#!/usr/bin/env python3
"""Build per-expansion catalogs from raid_bis_item_cache inspect.expansionCode."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CACHE = REPO / "cache"
SKIP = re.compile(
    r"diminished|riven arcana|emblem of|crate of|armor lining|fractured armor",
    re.I,
)
EXP = (
    "tov",
    "cov",
    "tol",
    "nos",
    "ls",
    "tob",
    "sor",
    "fof",
)
WEAPON_SLOTS = {"Primary", "Secondary"}


def main() -> int:
    cache = json.loads((CACHE / "raid_bis_item_cache.json").read_text(encoding="utf-8"))
    by_exp: dict[str, list[dict]] = {code: [] for code in EXP}
    for key, entry in cache.items():
        if key == "_version" or not isinstance(entry, dict) or not entry.get("ok"):
            continue
        item = entry.get("item") or {}
        inspect = entry.get("inspect") or {}
        code = str(inspect.get("expansionCode") or "").lower()
        if code not in by_exp:
            continue
        name = str(item.get("name") or "")
        if SKIP.search(name):
            continue
        tier = str(item.get("tier") or "").upper()
        slots = set(item.get("slots") or [])
        is_weapon = bool(slots & WEAPON_SLOTS)
        if is_weapon:
            if tier != "T2":
                continue
        elif tier not in {"T1", "T2"}:
            continue
        by_exp[code].append(item)

    now = datetime.now(timezone.utc).isoformat()
    for code, items in by_exp.items():
        path = CACHE / f"raid_bis_catalog_{code}.json"
        if path.is_file():
            existing = json.loads(path.read_text(encoding="utf-8"))
            old_n = len((existing.get("catalog") or {}).get("items") or [])
            if code == "sor" and old_n >= len(items):
                print(f"{code}: keep existing {old_n}")
                continue
        payload = {
            "catalog": {
                "fetched_at": now,
                "urls": [],
                "items": items,
                "warning": "Built from seeded item cache inspect.expansionCode",
                "expansion": code,
            }
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"{code}: {len(items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
