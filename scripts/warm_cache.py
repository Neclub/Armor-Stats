#!/usr/bin/env python3
"""Warm Armor Stats cache/ from EQ Resource (EQGM Web schema).

Run from the Armor Stats repo root:

  py -3 scripts/warm_cache.py
  py -3 scripts/warm_cache.py --expansions sor,tob
  py -3 scripts/warm_cache.py --seed-from-eqgm-web

Fetches only on cache miss (missing id or not ok). Commits cache/ after a warm.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = REPO_ROOT / "cache"
ITEM_CACHE_NAME = "raid_bis_item_cache.json"
ITEM_CACHE_VERSION = 8

EXPANSIONS: tuple[tuple[str, str], ...] = (
    ("tov", "Torment of Velious"),
    ("cov", "Claws of Veeshan"),
    ("tol", "Terror of Luclin"),
    ("nos", "Night of Shadows"),
    ("ls", "Laurion's Song"),
    ("tob", "The Outer Brood"),
    ("sor", "Shattering of Ro"),
    ("fof", "Favors of Fortune"),
)

JEWELRY_TYPES: tuple[tuple[str, str], ...] = (
    ("ear", "Ear"),
    ("finger", "Fingers"),
    ("neck", "Neck"),
    ("face", "Face"),
    ("charm", "Charm"),
    ("waist", "Waist"),
    ("back", "Back"),
    ("shoulder", "Shoulders"),
    ("rangex", "Range"),
)

WEAPON_TYPES: tuple[str, ...] = (
    "1hs",
    "1hb",
    "1hp",
    "2hs",
    "2hb",
    "2hp",
    "h2h",
    "archery",
    "throwing",
)

WEAPON_SLOTS = frozenset({"Primary", "Secondary", "Range"})

USER_AGENT = (
    "Mozilla/5.0 (compatible; ArmorStatsCache/1.0; +https://github.com/) "
    "AppleWebKit/537.36"
)

_SKIP_NAME_RE = re.compile(
    r"diminished|riven arcana|emblem of|crate of|armor lining|fractured armor",
    re.IGNORECASE,
)
_DAMAGE_RE = re.compile(
    r"(?:Damage|DMG)\s*:\s*</?(?:b|label|span)[^>]*>\s*(\d+)|"
    r"(?:Damage|DMG)\s*:\s*(\d+)|"
    r">\s*(\d+)\s*</(?:b|span|font)>\s*(?:Damage|DMG)",
    re.IGNORECASE,
)
_DELAY_RE = re.compile(
    r"Delay\s*:\s*</?(?:b|label|span)[^>]*>\s*(\d+)|"
    r"Delay\s*:\s*(\d+)",
    re.IGNORECASE,
)
_SKILL_RE = re.compile(
    r"Skill\s*:\s*</?(?:b|label|span)[^>]*>\s*([^<\n]+)|"
    r"Skill\s*:\s*([^<\n]+)",
    re.IGNORECASE,
)
_RAID_TIER_RE = re.compile(r"Raid\s*[-–]\s*Tier\s*(\d+)", re.IGNORECASE)
_GROUP_TIER_RE = re.compile(r"Group\s*[-–]\s*Tier\s*(\d+)", re.IGNORECASE)
_STUB_NAME_RE = re.compile(r"^[A-Z]{3} \w+$")

ALLOWED_HOSTS = frozenset(
    {
        "eqresource.com",
        "www.eqresource.com",
        "items.eqresource.com",
        *(f"{code}.eqresource.com" for code, _ in EXPANSIONS),
        *(f"www.{code}.eqresource.com" for code, _ in EXPANSIONS),
    }
)


def _log(msg: str) -> None:
    print(msg, flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _configure_eqgm_path(eqgm_root: Path | None) -> Path | None:
    candidates: list[Path] = []
    if eqgm_root:
        candidates.append(eqgm_root)
    parent = REPO_ROOT.parent
    candidates.extend(
        [
            parent / "EQGM_Web",
            parent / "EQ Gear Management",
        ]
    )
    for root in candidates:
        src = root / "src"
        if (src / "inventory_parser" / "raid_bis" / "catalog.py").is_file():
            for entry in (str(root), str(src)):
                if entry not in sys.path:
                    sys.path.insert(0, entry)
            return root
    return None


def _http_get(url: str, *, timeout: float = 45.0) -> str:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").casefold()
    if parsed.scheme != "https" or host not in ALLOWED_HOSTS:
        raise urllib.error.URLError(f"Refusing request to {host or url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(5_000_000)
    return raw.decode("utf-8", errors="replace")


def _load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _item_cache_path(cache_dir: Path) -> Path:
    return cache_dir / ITEM_CACHE_NAME


def _catalog_path(cache_dir: Path, code: str) -> Path:
    return cache_dir / f"raid_bis_catalog_{code}.json"


def _load_item_cache(cache_dir: Path) -> dict[str, Any]:
    data = _load_json(_item_cache_path(cache_dir))
    version = int(data.get("_version") or 0)
    if version and version != ITEM_CACHE_VERSION:
        _log(f"  WARN item cache version {version} != {ITEM_CACHE_VERSION}; keeping entries")
    return {k: v for k, v in data.items() if k != "_version"}


def _save_item_cache(cache_dir: Path, cache: dict[str, Any]) -> None:
    payload = dict(cache)
    payload["_version"] = ITEM_CACHE_VERSION
    _save_json(_item_cache_path(cache_dir), payload)


def _seed_from_eqgm_web(cache_dir: Path, eqgm_web: Path) -> int:
    src = eqgm_web / "cache" / ITEM_CACHE_NAME
    if not src.is_file():
        _log(f"  No seed cache at {src}")
        return 0
    existing = _load_item_cache(cache_dir)
    donor = _load_json(src)
    added = 0
    for key, entry in donor.items():
        if key == "_version":
            continue
        if key in existing and isinstance(existing[key], dict) and existing[key].get("ok"):
            continue
        if isinstance(entry, dict) and entry.get("ok"):
            existing[key] = entry
            added += 1
    _save_item_cache(cache_dir, existing)
    _log(f"  Seeded {added} item cache entries from EQGM_Web")
    return added


def _should_skip_name(name: str) -> bool:
    return bool(_SKIP_NAME_RE.search(name or ""))


def _is_stub_name(name: str) -> bool:
    return bool(_STUB_NAME_RE.fullmatch((name or "").strip()))


def _parse_damage_delay(html: str) -> tuple[int | None, int | None]:
    m = re.search(
        r"Base\s*Dmg:<br>(?:[^:]*Dmg:<br>)*Delay:<br>Dmg Bon:<br>Ratio:\s*</t[dh]>\s*"
        r"<td[^>]*>\s*(\d+)<br>(?:\d+<br>)*(\d+)<br>",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        return int(m.group(1)), int(m.group(2))
    bow = re.search(
        r"Base\s*Dmg:<br>\s*Delay:<br>\s*Range:<br>\s*Ratio:\s*</td>\s*"
        r"<td[^>]*>\s*(\d+)<br>\s*(\d+)<br>",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    if bow:
        return int(bow.group(1)), int(bow.group(2))
    dmg = delay = None
    m2 = _DAMAGE_RE.search(html or "")
    if m2:
        dmg = int(next(g for g in m2.groups() if g))
    m3 = _DELAY_RE.search(html or "")
    if m3:
        delay = int(next(g for g in m3.groups() if g))
    return dmg, delay


def _parse_skill(html: str) -> str:
    m = re.search(
        r"Size:<br>Weight:<br>Tribute:<br>Req Lvl:<br><b>Skill</b><br>.*?"
        r"</td>\s*<td[^>]*>\s*([^<]+)<br>\s*([^<]+)<br>\s*([^<]+)<br>\s*([^<]+)<br>\s*([^<]+)",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(5)).strip()
    m2 = _SKILL_RE.search(html or "")
    if not m2:
        return ""
    raw = next((g for g in m2.groups() if g), "") or ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", raw)).strip()


def _tier_from_html(html: str) -> str:
    m = _RAID_TIER_RE.search(html or "")
    if m:
        return f"T{m.group(1)}"
    if _GROUP_TIER_RE.search(html or ""):
        return "GROUP"
    return ""


def _raidgear_url(code: str, gear_type: str) -> str:
    q = urllib.parse.urlencode(
        {
            "class": "",
            "type": gear_type,
            "stat": "ac",
            "tier": "4",
            "Submit": "Submit",
        }
    )
    return f"https://www.eqresource.com/{code}/raidgear.php?{q}"


def _raidarmor_url(code: str) -> str:
    return f"https://www.eqresource.com/{code}/raidarmor.php"


def _item_url(item_id: int) -> str:
    return f"https://items.eqresource.com/items.php?id={item_id}"


def _candidate_to_dict(item: Any) -> dict:
    classes = item.classes
    if classes is None:
        stored_classes = None
        class_all = False
    elif not classes:
        from inventory_parser.raid_bis.models import ALL_CLASS_ABBRS

        stored_classes = sorted(ALL_CLASS_ABBRS)
        class_all = True
    else:
        stored_classes = sorted(classes)
        class_all = False
    payload = {
        "item_id": int(item.item_id),
        "name": item.name,
        "stats": dict(item.stats or {}),
        "classes": stored_classes,
        "class_all": class_all,
        "slots": sorted(item.slots or []),
        "tier": item.tier or "",
        "lore_group": item.lore_group,
        "icon_id": item.icon_id,
        "focus": item.focus or "",
        "effect": item.effect or "",
        "source": item.source or "EQ Resource",
    }
    return payload


def _needs_hydrate(entry: dict | None, stub_name: str = "") -> bool:
    if not entry or not entry.get("ok"):
        return True
    item = entry.get("item") or {}
    if not isinstance(item, dict):
        return True
    name = str(item.get("name") or stub_name)
    if _is_stub_name(name) or name.startswith("Item "):
        return True
    if item.get("classes") is None and not item.get("class_all"):
        return True
    if not item.get("icon_id"):
        return True
    if not item.get("stats"):
        return True
    return False


def _entry_from_candidate(
    item: Any,
    *,
    inspect: dict | None = None,
    damage: int | None = None,
    delay: int | None = None,
    skill: str = "",
) -> dict:
    payload = _candidate_to_dict(item)
    if damage is not None:
        payload["damage"] = int(damage)
    if delay is not None:
        payload["delay"] = int(delay)
    if skill:
        payload["skill"] = skill
    entry: dict[str, Any] = {
        "ok": True,
        "fetched_at": _now(),
        "classes": payload["classes"],
        "class_all": payload["class_all"],
        "item": payload,
    }
    if inspect:
        stored = dict(inspect)
        stored["itemId"] = int(item.item_id)
        entry["inspect"] = stored
    return entry


def _keep_list_item(item: Any, *, weapons: bool) -> bool:
    if _should_skip_name(item.name or ""):
        return False
    tier = (item.tier or "").upper()
    if weapons:
        return tier == "T2"
    return tier in {"T1", "T2", ""}


def warm_expansion(
    code: str,
    *,
    cache_dir: Path,
    item_cache: dict[str, Any],
    polite_delay: float,
    force_refresh: bool,
) -> dict[str, Any]:
    from inventory_parser.raid_bis.catalog import (
        parse_item_page,
        parse_raidarmor_html,
        parse_raidgear_html,
        merge_hydrated,
        should_skip_name,
    )
    from inventory_parser.item_inspect import inspect_to_dict, parse_item_inspect

    urls: list[str] = []
    list_items: list[Any] = []
    warning: str | None = None

    armor_url = _raidarmor_url(code)
    urls.append(armor_url)
    try:
        if polite_delay > 0:
            time.sleep(polite_delay)
        armor_html = _http_get(armor_url)
        armor_items = parse_raidarmor_html(armor_html)
        # Keep T1/T2 only (parser tags T1/T2 from page anchors).
        armor_items = [i for i in armor_items if (i.tier or "").upper() in {"T1", "T2"}]
        list_items.extend(armor_items)
        _log(f"  {code} raidarmor: {len(armor_items)} items")
    except Exception as exc:
        warning = f"raidarmor failed ({exc})"
        _log(f"  WARN {code} raidarmor: {exc}")

    for gear_type, slot_name in JEWELRY_TYPES:
        url = _raidgear_url(code, gear_type)
        urls.append(url)
        try:
            if polite_delay > 0:
                time.sleep(polite_delay)
            html = _http_get(url)
            parsed = parse_raidgear_html(html, default_slot=slot_name)
            kept = []
            for item in parsed:
                if should_skip_name(item.name):
                    continue
                # Drop group-tier rows when caption/tier says Group.
                caption_tier = ""
                m = re.search(r"Raid Tier\s+(\d+)", html, re.I)
                g = re.search(r"Group Tier\s+(\d+)", html, re.I)
                if g and not m:
                    continue
                if m:
                    item.tier = item.tier or f"T{m.group(1)}"
                if (item.tier or "").upper() in {"T1", "T2"} or not item.tier:
                    # Prefer raid tiers from item page later; keep candidates for now.
                    kept.append(item)
            list_items.extend(kept)
            _log(f"  {code} {gear_type}: {len(kept)} items")
        except Exception as exc:
            _log(f"  WARN {code} {gear_type}: {exc}")

    weapon_items: list[Any] = []
    for gear_type in WEAPON_TYPES:
        url = _raidgear_url(code, gear_type)
        urls.append(url)
        try:
            if polite_delay > 0:
                time.sleep(polite_delay)
            html = _http_get(url)
            parsed = parse_raidgear_html(html)
            for item in parsed:
                if should_skip_name(item.name):
                    continue
                weapon_items.append(item)
            _log(f"  {code} weapon {gear_type}: {len(parsed)} items")
        except Exception as exc:
            _log(f"  WARN {code} weapon {gear_type}: {exc}")

    # Deduplicate by id; prefer first (armor stubs get hydrated).
    by_id: dict[int, Any] = {}
    for item in list_items + weapon_items:
        by_id.setdefault(int(item.item_id), item)

    hydrated_ids: list[int] = []
    for item_id, base in by_id.items():
        key = str(item_id)
        entry = None if force_refresh else item_cache.get(key)
        if not _needs_hydrate(entry, stub_name=base.name):
            # Still refresh tier filter for weapons from cached item.
            continue
        try:
            if polite_delay > 0:
                time.sleep(polite_delay)
            html = _http_get(_item_url(item_id))
            extra = parse_item_page(html, item_id, name_hint=base.name)
            if extra is None:
                continue
            merged = merge_hydrated(base, extra)
            inspect_obj = parse_item_inspect(html, item_id, name_hint=merged.name)
            inspect = inspect_to_dict(inspect_obj) if inspect_obj else None
            damage, delay = _parse_damage_delay(html)
            skill = _parse_skill(html)
            page_tier = _tier_from_html(html)
            if page_tier:
                merged.tier = page_tier
            item_cache[key] = _entry_from_candidate(
                merged,
                inspect=inspect,
                damage=damage,
                delay=delay,
                skill=skill,
            )
            hydrated_ids.append(item_id)
        except Exception as exc:
            _log(f"  WARN hydrate {item_id}: {exc}")

    if hydrated_ids:
        _log(f"  {code} hydrated {len(hydrated_ids)} items")

    catalog_items: list[dict] = []
    seen: set[int] = set()
    for item_id, base in by_id.items():
        if item_id in seen:
            continue
        key = str(item_id)
        entry = item_cache.get(key)
        if not entry or not entry.get("ok"):
            # Keep unhydrated list row when possible.
            if _should_skip_name(base.name):
                continue
            payload = _candidate_to_dict(base)
            tier = (payload.get("tier") or "").upper()
            slots = set(payload.get("slots") or [])
            is_weapon = bool(slots & WEAPON_SLOTS) or item_id in {
                int(w.item_id) for w in weapon_items
            }
            if is_weapon and tier != "T2":
                continue
            if not is_weapon and tier not in {"T1", "T2"}:
                continue
            catalog_items.append(payload)
            seen.add(item_id)
            continue
        payload = dict(entry["item"])
        tier = (payload.get("tier") or "").upper()
        if tier == "GROUP":
            continue
        slots = set(payload.get("slots") or [])
        is_weapon = bool(slots & {"Primary", "Secondary"}) and "Range" not in slots
        # Range is jewelry/armor catalog.
        if "Range" in slots and not (slots & {"Primary", "Secondary"}):
            is_weapon = False
        if is_weapon:
            if tier != "T2":
                continue
        else:
            if tier not in {"T1", "T2"}:
                continue
        if _should_skip_name(str(payload.get("name") or "")):
            continue
        catalog_items.append(payload)
        seen.add(item_id)

    catalog = {
        "catalog": {
            "fetched_at": _now(),
            "urls": urls,
            "items": catalog_items,
            "warning": warning,
            "expansion": code,
        }
    }
    _save_json(_catalog_path(cache_dir, code), catalog)
    _log(f"  {code} catalog: {len(catalog_items)} items")
    return catalog


def _seed_sor_catalog_from_eqgm_web(cache_dir: Path, eqgm_web: Path) -> None:
    """Copy current SoR BiS catalog as raid_bis_catalog_sor.json when missing."""
    dest = _catalog_path(cache_dir, "sor")
    if dest.is_file():
        return
    src = eqgm_web / "cache" / "raid_bis_catalog.json"
    if not src.is_file():
        return
    data = _load_json(src)
    if not data.get("catalog"):
        return
    catalog = dict(data["catalog"])
    catalog["expansion"] = "sor"
    # Drop vendor-only / skip names; keep T1/T2.
    items = []
    for raw in catalog.get("items") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "")
        if _should_skip_name(name):
            continue
        tier = str(raw.get("tier") or "").upper()
        if tier not in {"T1", "T2"}:
            continue
        items.append(raw)
    catalog["items"] = items
    _save_json(dest, {"catalog": catalog})
    _log(f"  Seeded sor catalog with {len(items)} items from EQGM_Web")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Warm Armor Stats EQ Resource cache/")
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE,
        help=f"Cache directory (default: {DEFAULT_CACHE})",
    )
    p.add_argument(
        "--expansions",
        type=str,
        default=",".join(code for code, _ in EXPANSIONS),
        help="Comma-separated expansion codes (default: all)",
    )
    p.add_argument(
        "--eqgm-root",
        type=Path,
        default=None,
        help="Path to EQGM_Web or EQ Gear Management (for parsers)",
    )
    p.add_argument(
        "--seed-from-eqgm-web",
        action="store_true",
        help="Copy missing item-cache entries from sibling EQGM_Web/cache",
    )
    p.add_argument(
        "--force-refresh",
        action="store_true",
        help="Re-hydrate items even when cache entry is ok",
    )
    p.add_argument(
        "--polite-delay",
        type=float,
        default=0.05,
        help="Delay between live fetches (seconds)",
    )
    p.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Only seed / write empty catalogs; do not hit EQ Resource",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    cache_dir = args.cache_dir
    if not cache_dir.is_absolute():
        cache_dir = REPO_ROOT / cache_dir
    cache_dir.mkdir(parents=True, exist_ok=True)

    eqgm = _configure_eqgm_path(args.eqgm_root)
    if eqgm is None:
        _log("ERROR: Could not find EQGM_Web or EQ Gear Management parsers.")
        _log("Pass --eqgm-root pointing at that repo.")
        return 1
    _log(f"Using parsers from {eqgm}")

    # Soft-seed from sibling EQGM_Web when present.
    web = eqgm if (eqgm / "cache" / ITEM_CACHE_NAME).is_file() else (
        REPO_ROOT.parent / "EQGM_Web"
    )
    if args.seed_from_eqgm_web or (web / "cache" / ITEM_CACHE_NAME).is_file():
        if (web / "cache" / ITEM_CACHE_NAME).is_file():
            _seed_from_eqgm_web(cache_dir, web)
            _seed_sor_catalog_from_eqgm_web(cache_dir, web)

    item_cache = _load_item_cache(cache_dir)
    wanted = {c.strip().lower() for c in args.expansions.split(",") if c.strip()}
    for code, label in EXPANSIONS:
        if code not in wanted:
            continue
        _log(f"=== {label} ({code}) ===")
        if args.skip_fetch:
            path = _catalog_path(cache_dir, code)
            if not path.is_file():
                _save_json(
                    path,
                    {
                        "catalog": {
                            "fetched_at": _now(),
                            "urls": [],
                            "items": [],
                            "warning": "skipped fetch",
                            "expansion": code,
                        }
                    },
                )
                _log(f"  wrote empty catalog for {code}")
            continue
        try:
            warm_expansion(
                code,
                cache_dir=cache_dir,
                item_cache=item_cache,
                polite_delay=args.polite_delay,
                force_refresh=args.force_refresh,
            )
            _save_item_cache(cache_dir, item_cache)
        except Exception as exc:
            _log(f"  ERROR {code}: {exc}")
            if code == "fof":
                _save_json(
                    _catalog_path(cache_dir, code),
                    {
                        "catalog": {
                            "fetched_at": _now(),
                            "urls": [_raidarmor_url(code)],
                            "items": [],
                            "warning": str(exc),
                            "expansion": code,
                        }
                    },
                )
            else:
                raise

    _save_item_cache(cache_dir, item_cache)
    _log(f"Done. Item cache entries: {len(item_cache)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
