#!/usr/bin/env python3
"""Build the FoF item cache and catalog from HTML saved by scripts/fof_inbox.py."""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))

import warm_cache  # noqa: E402

RAW = REPO / "cache" / "raw" / "fof"
CACHE = REPO / "cache"
WEAPON_LISTS = ("1h", "2h", "hth", "bow")
# Slots that are not on the visible armor matrix.
GEAR_SLOTS = (
    ("back", "Back"),
    ("charm", "Charm"),
    ("ear", "Ear"),
    ("face", "Face"),
    ("finger", "Fingers"),
    ("neck", "Neck"),
    ("rangex", "Range"),
    ("shoulder", "Shoulders"),
    ("waist", "Waist"),
)
ARMOR_SLOTS = {"Wrist", "Hands", "Feet", "Head", "Arms", "Legs", "Chest"}
_LINK_RE = re.compile(r"<a\b([^>]*)>", re.IGNORECASE)
_ID_RE = re.compile(r"items\.php\?id=(\d+)", re.IGNORECASE)
_LABEL_RE = re.compile(r'aria-label="([A-Z]{3})\s+([^"]+)"')
_TIER_SPLIT_RE = re.compile(r'<a\s+id="tier(\d+)"\s*>\s*</a>', re.IGNORECASE)
_PREMIUM_RE = re.compile(r"only accessible to EQResource Premium", re.IGNORECASE)
_SHIELD_RE = re.compile(r"shield|buckler", re.IGNORECASE)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def parse_fof_armor(html: str):
    from inventory_parser.raid_bis.models import ARMOR_SLOT_HEADERS, RaidGearCandidate

    parts = _TIER_SPLIT_RE.split(html or "")
    items = []
    seen: set[int] = set()
    i = 1
    while i + 1 < len(parts):
        tier_n = parts[i].strip()
        block = parts[i + 1]
        i += 2
        if tier_n not in {"1", "2"}:
            continue
        tier = f"T{tier_n}"
        for tag in _LINK_RE.finditer(block):
            attrs = tag.group(1)
            id_m = _ID_RE.search(attrs)
            label_m = _LABEL_RE.search(attrs)
            if not id_m or not label_m:
                continue
            item_id = int(id_m.group(1))
            if item_id in seen:
                continue
            seen.add(item_id)
            slot_raw = label_m.group(2).strip()
            slot = ARMOR_SLOT_HEADERS.get(slot_raw.casefold(), slot_raw)
            items.append(
                RaidGearCandidate(
                    item_id=item_id,
                    name=f"{label_m.group(1).upper()} {slot}",
                    classes=frozenset({label_m.group(1).upper()}),
                    slots=frozenset({slot}),
                    tier=tier,
                    source="EQ Resource raidarmor",
                )
            )
    return items


def parse_weapon_list(html: str, gear_type: str):
    from inventory_parser.raid_bis.catalog import parse_raidgear_html
    from inventory_parser.raid_bis.models import RaidGearCandidate

    parsed = parse_raidgear_html(html, default_tier="T2")
    if not parsed:
        seen: set[int] = set()
        for id_m in _ID_RE.finditer(html or ""):
            item_id = int(id_m.group(1))
            if item_id in seen or item_id < 1000:
                continue
            seen.add(item_id)
            parsed.append(
                RaidGearCandidate(
                    item_id=item_id,
                    name=f"Item {item_id}",
                    tier="T2",
                    source=f"EQ Resource raidgear {gear_type}",
                )
            )
    kept = []
    for item in parsed:
        if warm_cache._should_skip_name(item.name or ""):
            continue
        if _SHIELD_RE.search(item.name or ""):
            continue
        item.tier = "T2"
        kept.append(item)
    return kept


def parse_gear_list(html: str, gear_type: str, slot: str, tier: str):
    from inventory_parser.raid_bis.catalog import parse_raidgear_html
    from inventory_parser.raid_bis.models import RaidGearCandidate

    parsed = parse_raidgear_html(html, default_slot=slot, default_tier=tier)
    if not parsed:
        seen: set[int] = set()
        for id_m in _ID_RE.finditer(html or ""):
            item_id = int(id_m.group(1))
            if item_id in seen or item_id < 1000:
                continue
            seen.add(item_id)
            parsed.append(
                RaidGearCandidate(
                    item_id=item_id,
                    name=f"Item {item_id}",
                    slots=frozenset({slot}),
                    tier=tier,
                    source=f"EQ Resource raidgear {gear_type}",
                )
            )
    kept = []
    for item in parsed:
        if warm_cache._should_skip_name(item.name or ""):
            continue
        if _SHIELD_RE.search(item.name or ""):
            continue
        if not item.slots:
            item.slots = frozenset({slot})
        if not item.tier:
            item.tier = tier
        kept.append(item)
    return kept


def _is_catalog_weapon(payload: dict) -> bool:
    slots = set(payload.get("slots") or [])
    skill = str(payload.get("skill") or "").casefold()
    name = str(payload.get("name") or "")
    if _SHIELD_RE.search(name) or "block" in skill or skill == "shield":
        return False
    if skill == "archery" or "bow" in skill:
        return True
    if slots & {"Primary", "Secondary"}:
        return True
    return False


def main() -> int:
    eqgm = warm_cache._configure_eqgm_path(None)
    if eqgm is None:
        print("ERROR: Could not find EQGM parsers.", flush=True)
        return 1
    print(f"Using parsers from {eqgm}", flush=True)

    from inventory_parser.item_inspect import inspect_to_dict, parse_item_inspect
    from inventory_parser.raid_bis.catalog import merge_hydrated, parse_item_page

    armor_path = RAW / "raidarmor.html"
    if not armor_path.is_file():
        print(f"Missing {armor_path}", flush=True)
        return 1
    by_id = {}
    armor_items = parse_fof_armor(_read(armor_path))
    print(f"armor stubs: {len(armor_items)}", flush=True)
    for item in armor_items:
        by_id[int(item.item_id)] = item

    weapon_ids: set[int] = set()
    for gear_type in WEAPON_LISTS:
        path = RAW / f"raidgear_{gear_type}.html"
        if not path.is_file():
            print(f"WARN missing {path.name}", flush=True)
            continue
        weapons = parse_weapon_list(_read(path), gear_type)
        print(f"weapons {gear_type}: {len(weapons)}", flush=True)
        for item in weapons:
            weapon_ids.add(int(item.item_id))
            by_id.setdefault(int(item.item_id), item)

    for gear_type, slot in GEAR_SLOTS:
        for tier_n, tier in (("1", "T1"), ("2", "T2")):
            path = RAW / f"raidgear_{gear_type}_t{tier_n}.html"
            if not path.is_file():
                print(f"WARN missing {path.name}", flush=True)
                continue
            gear = parse_gear_list(_read(path), gear_type, slot, tier)
            print(f"gear {gear_type} {tier}: {len(gear)}", flush=True)
            for item in gear:
                by_id.setdefault(int(item.item_id), item)

    item_cache = warm_cache._load_item_cache(CACHE)
    missing = []
    hydrated = 0
    for item_id, base in by_id.items():
        html_path = RAW / "items" / f"{item_id}.html"
        if not html_path.is_file():
            missing.append(item_id)
            continue
        html = _read(html_path)
        if _PREMIUM_RE.search(html):
            print(f"WARN premium wall {item_id}", flush=True)
            missing.append(item_id)
            continue
        extra = parse_item_page(html, item_id, name_hint=base.name)
        if extra is None:
            print(f"WARN unparsed {item_id}", flush=True)
            missing.append(item_id)
            continue
        merged = merge_hydrated(base, extra)
        page_tier = warm_cache._tier_from_html(html)
        if page_tier:
            merged.tier = page_tier
        elif item_id in weapon_ids:
            merged.tier = "T2"
        inspect_obj = parse_item_inspect(html, item_id, name_hint=merged.name)
        inspect = inspect_to_dict(inspect_obj) if inspect_obj else {}
        inspect["itemId"] = int(item_id)
        inspect["expansionCode"] = "fof"
        damage, delay = warm_cache._parse_damage_delay(html)
        skill = warm_cache._parse_skill(html)
        slots = {str(s).casefold() for s in (merged.slots or [])}
        if not skill and "range" in slots and damage is not None:
            skill = "Archery"
        weaponish = bool(slots & {"primary", "secondary", "range"}) or skill.casefold() == "archery"
        if not weaponish:
            damage = None
            delay = None
            skill = ""
        item_cache[str(item_id)] = warm_cache._entry_from_candidate(
            merged,
            inspect=inspect,
            damage=damage,
            delay=delay,
            skill=skill,
        )
        hydrated += 1

    print(f"hydrated {hydrated}; missing {len(missing)}", flush=True)
    if missing:
        print("missing ids: " + ",".join(str(i) for i in missing[:40]), flush=True)

    catalog_items = []
    armor_n = gear_n = weapon_n = 0
    for item_id, base in by_id.items():
        entry = item_cache.get(str(item_id))
        if not entry or not entry.get("ok"):
            continue
        payload = dict(entry["item"])
        if warm_cache._should_skip_name(str(payload.get("name") or "")):
            continue
        tier = str(payload.get("tier") or "").upper()
        if tier == "GROUP":
            continue
        if item_id in weapon_ids:
            if tier != "T2":
                continue
            if _SHIELD_RE.search(str(payload.get("name") or "")):
                continue
            catalog_items.append(payload)
            weapon_n += 1
            continue
        if tier not in {"T1", "T2"}:
            continue
        if _is_catalog_weapon(payload) and tier == "T2":
            catalog_items.append(payload)
            weapon_n += 1
            continue
        catalog_items.append(payload)
        slots = set(payload.get("slots") or [])
        if slots and slots.isdisjoint(ARMOR_SLOTS):
            gear_n += 1
        else:
            armor_n += 1

    catalog = {
        "catalog": {
            "fetched_at": warm_cache._now(),
            "urls": [
                "https://fof.eqresource.com/raidarmor.php",
                *[
                    f"https://fof.eqresource.com/raidgear.php?class=&type={gear_type}&stat=ac&tier=2&Submit=Submit"
                    for gear_type in WEAPON_LISTS
                ],
                *[
                    f"https://fof.eqresource.com/raidgear.php?class=&type={gear_type}&stat=ac&tier={tier_n}&Submit=Submit"
                    for gear_type, _slot in GEAR_SLOTS
                    for tier_n in ("1", "2")
                ],
            ],
            "items": catalog_items,
            "warning": None,
            "expansion": "fof",
        }
    }
    warm_cache._save_item_cache(CACHE, item_cache)
    warm_cache._save_json(CACHE / "raid_bis_catalog_fof.json", catalog)
    print(
        f"catalog armor {armor_n} gear {gear_n} weapons {weapon_n} total {len(catalog_items)}",
        flush=True,
    )
    return 0 if not missing else 2


if __name__ == "__main__":
    raise SystemExit(main())
