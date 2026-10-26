#!/usr/bin/env python3
"""Add missing raid range items (bows and idols) for ToV through ToB.

Those expansions were cached from raidgear queries that never included the
bow slot, so Tier 2 range gear was left out. Public EQ Resource pages are used.
"""

from __future__ import annotations

import sys
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

import warm_cache  # noqa: E402

CACHE = REPO / "cache"
EXPANSIONS = ("tov", "cov", "tol", "nos", "ls", "tob", "sor")
QUERIES = (("bow", "2"), ("rangex", "2"), ("bow", "1"), ("rangex", "1"))


def _list_url(code: str, gear_type: str, tier: str) -> str:
    query = urllib.parse.urlencode(
        {"class": "", "type": gear_type, "stat": "ac", "tier": tier, "Submit": "Submit"}
    )
    return f"https://{code}.eqresource.com/raidgear.php?{query}"


def main() -> int:
    if warm_cache._configure_eqgm_path(None) is None:
        print("ERROR: Could not find EQGM parsers.", flush=True)
        return 1
    from inventory_parser.item_inspect import inspect_to_dict, parse_item_inspect
    from inventory_parser.raid_bis.catalog import merge_hydrated, parse_item_page, parse_raidgear_html

    item_cache = warm_cache._load_item_cache(CACHE)
    for code in EXPANSIONS:
        path = CACHE / f"raid_bis_catalog_{code}.json"
        catalog = warm_cache._load_json(path).get("catalog") or {}
        items = list(catalog.get("items") or [])
        by_id = {int(item["item_id"]): item for item in items if item.get("item_id")}
        stubs = {}
        bow_ids: set[int] = set()
        for gear_type, tier_n in QUERIES:
            url = _list_url(code, gear_type, tier_n)
            html = warm_cache._http_get(url)
            parsed = parse_raidgear_html(html, default_slot="Range", default_tier=f"T{tier_n}")
            print(f"{code} {gear_type} T{tier_n}: {len(parsed)}", flush=True)
            for item in parsed:
                if warm_cache._should_skip_name(item.name or ""):
                    continue
                item.tier = item.tier or f"T{tier_n}"
                if not item.slots:
                    item.slots = frozenset({"Range"})
                stubs.setdefault(int(item.item_id), item)
                if gear_type == "bow":
                    bow_ids.add(int(item.item_id))
            time.sleep(0.05)

        added = updated = 0
        for item_id, base in stubs.items():
            existing = by_id.get(item_id)
            cached = item_cache.get(str(item_id)) if isinstance(item_cache.get(str(item_id)), dict) else None
            cached_item = (cached or {}).get("item") or {}
            needs_stats = item_id in bow_ids and not (
                cached_item.get("damage") and cached_item.get("delay") and cached_item.get("skill")
            )
            if existing and cached and cached.get("ok") and not needs_stats:
                continue
            time.sleep(0.05)
            html = warm_cache._http_get(warm_cache._item_url(item_id))
            extra = parse_item_page(html, item_id, name_hint=base.name)
            if extra is None:
                print(f"  WARN unparsed {item_id}", flush=True)
                continue
            merged = merge_hydrated(base, extra)
            page_tier = warm_cache._tier_from_html(html)
            if page_tier:
                merged.tier = page_tier
            inspect_obj = parse_item_inspect(html, item_id, name_hint=merged.name)
            inspect = inspect_to_dict(inspect_obj) if inspect_obj else {}
            inspect["itemId"] = item_id
            inspect["expansionCode"] = code
            damage, delay = warm_cache._parse_damage_delay(html)
            skill = warm_cache._parse_skill(html)
            if item_id in bow_ids and not skill and damage is not None:
                skill = "Archery"
            entry = warm_cache._entry_from_candidate(
                merged, inspect=inspect, damage=damage, delay=delay, skill=skill
            )
            item_cache[str(item_id)] = entry
            payload = dict(entry["item"])
            if existing:
                existing.update(payload)
                updated += 1
            else:
                items.append(payload)
                by_id[item_id] = payload
                added += 1
            print(
                f"  {code} {payload.get('tier')} {item_id} {payload.get('name')} "
                f"dmg={payload.get('damage')} delay={payload.get('delay')} skill={payload.get('skill')}",
                flush=True,
            )
        catalog["items"] = items
        catalog["expansion"] = code
        warm_cache._save_json(path, {"catalog": catalog})
        print(f"{code}: added {added}, updated {updated}, catalog {len(items)}", flush=True)

    warm_cache._save_item_cache(CACHE, item_cache)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
