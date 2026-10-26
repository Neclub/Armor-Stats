#!/usr/bin/env python3
"""Hydrate damage/delay/skill on T2 weapons already in the item cache."""

from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CACHE = REPO / "cache"
ITEM_CACHE = CACHE / "raid_bis_item_cache.json"
USER_AGENT = "Mozilla/5.0 (compatible; ArmorStatsCache/1.0)"

_BASE_DMG_BLOCK = re.compile(
    r"Base\s*Dmg:<br>(?:[^:]*Dmg:<br>)*Delay:<br>Dmg Bon:<br>Ratio:\s*</t[dh]>\s*"
    r"<td[^>]*>\s*(\d+)<br>(?:\d+<br>)*(\d+)<br>",
    re.IGNORECASE | re.DOTALL,
)
_SKILL_BLOCK = re.compile(
    r"<b>\s*Skill\s*</b>\s*<br>.*?</td>\s*<td[^>]*>.*?Req\s*Lvl:\s*<br>\s*"
    r"(?:[^<]*<br>\s*){0,6}([A-Za-z][^<\n]*)",
    re.IGNORECASE | re.DOTALL,
)
_SKILL_SIMPLE = re.compile(
    r"<b>\s*Skill\s*</b>.*?<td[^>]*>\s*(?:LARGE|MEDIUM|SMALL|TINY)?\s*<br>\s*"
    r"[\d.]+\s*<br>\s*[^<]*<br>\s*[^<]*<br>\s*([A-Za-z][^<\n]*)",
    re.IGNORECASE | re.DOTALL,
)


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read(5_000_000).decode("utf-8", errors="replace")


def parse_weapon_fields(html: str) -> tuple[int | None, int | None, str]:
    dmg = delay = None
    m = _BASE_DMG_BLOCK.search(html or "")
    if m:
        dmg, delay = int(m.group(1)), int(m.group(2))
    skill = ""
    # Prefer the value cell after Skill label in the meta column.
    m2 = re.search(
        r"Base\s*Dmg:.*?</table>",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    # Skill often sits in: labels Size/Weight/Tribute/Req Lvl/Skill vs values
    m3 = re.search(
        r"Size:<br>Weight:<br>Tribute:<br>Req Lvl:<br><b>Skill</b><br>.*?"
        r"</td>\s*<td[^>]*>\s*([^<]+)<br>\s*([^<]+)<br>\s*([^<]+)<br>\s*([^<]+)<br>\s*([^<]+)",
        html or "",
        re.IGNORECASE | re.DOTALL,
    )
    if m3:
        skill = re.sub(r"\s+", " ", m3.group(5)).strip()
    return dmg, delay, skill


def weapon_ids() -> set[int]:
    ids: set[int] = set()
    for path in CACHE.glob("raid_bis_catalog_*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for item in (data.get("catalog") or {}).get("items") or []:
            slots = set(item.get("slots") or [])
            if not (slots & {"Primary", "Secondary"}):
                continue
            if (item.get("tier") or "").upper() != "T2":
                continue
            name = (item.get("name") or "").casefold()
            if "shield" in name or "buckler" in name:
                continue
            ids.add(int(item["item_id"]))
    return ids


def main() -> int:
    cache = json.loads(ITEM_CACHE.read_text(encoding="utf-8"))
    ids = sorted(weapon_ids())
    print(f"Weapons to enrich: {len(ids)}")
    updated = 0
    for i, item_id in enumerate(ids, start=1):
        key = str(item_id)
        entry = cache.get(key)
        if not isinstance(entry, dict) or not entry.get("ok"):
            continue
        item = entry.get("item") or {}
        if item.get("damage") and item.get("delay") and item.get("skill"):
            continue
        try:
            html = http_get(f"https://items.eqresource.com/items.php?id={item_id}")
            dmg, delay, skill = parse_weapon_fields(html)
            if dmg is not None:
                item["damage"] = dmg
            if delay is not None:
                item["delay"] = delay
            if skill:
                item["skill"] = skill
            entry["item"] = item
            cache[key] = entry
            updated += 1
            print(f"  {item_id} {item.get('name')}: dmg={dmg} delay={delay} skill={skill}")
        except Exception as exc:
            print(f"  WARN {item_id}: {exc}")
        if i < len(ids):
            time.sleep(0.05)
        if updated and updated % 25 == 0:
            ITEM_CACHE.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    ITEM_CACHE.write_text(json.dumps(cache, indent=2), encoding="utf-8")

    # Push enriched fields into catalogs.
    for path in CACHE.glob("raid_bis_catalog_*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        catalog = data.get("catalog") or {}
        items = catalog.get("items") or []
        changed = False
        filtered = []
        for item in items:
            name = (item.get("name") or "").casefold()
            slots = set(item.get("slots") or [])
            is_weapon = bool(slots & {"Primary", "Secondary"})
            if is_weapon and ("shield" in name or "buckler" in name):
                changed = True
                continue
            key = str(item.get("item_id"))
            cached = (cache.get(key) or {}).get("item") or {}
            for field in ("damage", "delay", "skill"):
                if cached.get(field) is not None and item.get(field) != cached.get(field):
                    item[field] = cached[field]
                    changed = True
            filtered.append(item)
        if changed:
            catalog["items"] = filtered
            data["catalog"] = catalog
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            print(f"Updated {path.name}")
    print(f"Done. Enriched {updated} weapons.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
