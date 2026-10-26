"""Fixture tests mirroring js/scoring.js (EQGM BiS rules)."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLES = json.loads((ROOT / "data/weights/roles.json").read_text(encoding="utf-8"))
CLASSES = json.loads((ROOT / "data/weights/classes.json").read_text(encoding="utf-8"))
OVERLAYS = json.loads((ROOT / "data/weights/slot_overlays.json").read_text(encoding="utf-8"))

STAT_KEYS = {
    "ac", "hp", "mana", "endurance", "str", "sta", "agi", "dex", "wis", "int", "cha",
    "hstr", "hsta", "hagi", "hdex", "hwis", "hint", "hcha", "atk", "accuracy",
    "combat_effects", "avoidance", "shielding", "spell_shield", "dot_shield",
    "stun_resist", "strikethrough", "heal_amount", "spell_damage", "clairvoyance",
}
CLASS_TO_PROFILE = {
    "WAR": "dex", "PAL": "dex", "SHD": "dex", "MNK": "dex", "RNG": "dex", "ROG": "dex",
    "BST": "dex", "BRD": "dex", "BER": "dex", "ENC": "int", "WIZ": "int", "MAG": "int",
    "NEC": "int", "SHM": "wis", "CLR": "wis", "DRU": "wis",
}
PET_FOCUS = {"MAG", "BST", "NEC"}
NON_LORE = {"Wrist-1", "Wrist-2"}
SCORED = [
    "Ear-1", "Head", "Face", "Ear-2", "Chest", "Neck", "Arms", "Back", "Waist",
    "Shoulders", "Wrist-1", "Wrist-2", "Legs", "Hands", "Charm", "Feet",
    "Fingers-1", "Fingers-2", "Range",
]
WAIST_LABELS = (
    "Overdrive Punch",
    "Treaded Boon of Potential",
    "Crippling Slicer",
)
_EM_RE = re.compile(r"enhanced\s+minion\s+([ivxlcdm]+|\d+)\b", re.I)
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman_to_int(token: str) -> int:
    raw = (token or "").strip().upper()
    if not raw:
        return 0
    if raw.isdigit():
        return int(raw)
    if not all(ch in _ROMAN for ch in raw):
        return 0
    total = i = 0
    while i < len(raw):
        value = _ROMAN[raw[i]]
        if i + 1 < len(raw) and _ROMAN[raw[i + 1]] > value:
            total += _ROMAN[raw[i + 1]] - value
            i += 2
            continue
        total += value
        i += 1
    return total


def em_level(*texts: str) -> int:
    best = 0
    for text in texts:
        for m in _EM_RE.finditer(text or ""):
            best = max(best, roman_to_int(m.group(1)))
    return best


def slot_base(slot: str) -> str:
    if slot.startswith("Ear"):
        return "Ear"
    if slot.startswith("Wrist"):
        return "Wrist"
    if slot.startswith("Fingers"):
        return "Fingers"
    return slot


def resolve_weights(class_abbr: str, gear_slot: str) -> dict[str, float]:
    key = (class_abbr or "").upper()
    packaged = (CLASSES.get("classes") or {}).get(key) or {}
    role = packaged.get("role") or (
        "pure_caster" if CLASS_TO_PROFILE.get(key) == "int"
        else "priest" if CLASS_TO_PROFILE.get(key) == "wis"
        else "melee_dps"
    )
    base = dict((ROLES.get("roles") or {}).get(role) or {})
    mods = dict(packaged.get("modifiers") or {})
    overlays: dict[str, float] = {}
    feet = False
    sb = slot_base(gear_slot)
    for overlay in OVERLAYS.get("overlays") or []:
        slots = overlay.get("slots") or []
        if sb not in slots and gear_slot not in slots:
            continue
        classes = overlay.get("classes")
        if classes is not None and key not in {c.upper() for c in classes}:
            continue
        if overlay.get("require_shield"):
            continue
        if overlay.get("id") == "feet_high_ac":
            feet = True
        for k, v in (overlay.get("modifiers") or {}).items():
            overlays[k] = overlays.get(k, 0.0) + float(v)
    merged: dict[str, float] = {}
    for src in (base, mods, overlays):
        for k, v in src.items():
            if k not in STAT_KEYS:
                continue
            merged[k] = merged.get(k, 0.0) + float(v)
    merged = {k: v for k, v in merged.items() if abs(v) > 1e-9}
    if feet:
        return {"ac": float(merged.get("ac", 0.0))}
    return merged


def score(stats: dict, weights: dict) -> float:
    return sum(float(stats.get(k, 0)) * float(w) for k, w in weights.items())


def normalize(raw: dict) -> dict:
    if raw.get("class_all"):
        classes: list[str] | None = []
    elif raw.get("classes") is None:
        classes = None
    else:
        classes = [str(c).upper() for c in raw.get("classes") or []]
    return {
        "item_id": int(raw.get("item_id") or 0),
        "name": str(raw.get("name") or ""),
        "stats": dict(raw.get("stats") or {}),
        "classes": classes,
        "slots": set(raw.get("slots") or []),
        "tier": str(raw.get("tier") or ""),
        "lore_group": raw.get("lore_group"),
        "focus": str(raw.get("focus") or ""),
        "effect": str(raw.get("effect") or ""),
    }


def fits_class(item: dict, class_abbr: str) -> bool:
    if item["classes"] is None:
        return False
    if not item["classes"]:
        return True
    return class_abbr.upper() in item["classes"]


def fits_slot(item: dict, gear_slot: str) -> bool:
    return slot_base(gear_slot) in item["slots"]


def is_pet(item: dict) -> bool:
    if "Ear" not in item["slots"]:
        return False
    name_hit = "summoner" in item["name"].casefold()
    focus_hit = "enhanced minion" in item["focus"].casefold()
    if not (name_hit or focus_hit):
        return False
    if item["classes"] is None:
        return False
    if item["classes"] and not (set(item["classes"]) & PET_FOCUS):
        return False
    return True


def lore_key(item: dict) -> str:
    if item["lore_group"]:
        return str(item["lore_group"]).strip().casefold()
    return str(item["item_id"])


def block_keys(item: dict) -> set[str]:
    keys = {lore_key(item)}
    if item["item_id"] > 0:
        keys.add(str(item["item_id"]))
    return keys


def rank_tuple(item: dict, class_abbr: str, gear_slot: str) -> tuple:
    weights = resolve_weights(class_abbr, gear_slot)
    return (
        -score(item["stats"], weights),
        -int(item["stats"].get("hp", 0)),
        -int(item["stats"].get("ac", 0)),
        item["name"].casefold(),
    )


def best_of(pool: list[dict], class_abbr: str, gear_slot: str, used: set[str]):
    legal = []
    for c in pool:
        if not (fits_class(c, class_abbr) and fits_slot(c, gear_slot)):
            continue
        if block_keys(c) & used:
            continue
        legal.append(c)
    if not legal:
        return None
    legal.sort(key=lambda c: rank_tuple(c, class_abbr, gear_slot))
    return legal[0]


def waist_match(item: dict, label: str) -> bool:
    hay = f"{item['effect']} {item['focus']}".casefold()
    return label.casefold() in hay


def best_waist(pool: list[dict], class_abbr: str, used: set[str]):
    picks = []
    for label in WAIST_LABELS:
        match = [c for c in pool if waist_match(c, label)]
        pick = best_of(match, class_abbr, "Waist", used)
        if pick:
            picks.append(pick)
    if picks:
        picks.sort(key=lambda c: rank_tuple(c, class_abbr, "Waist"))
        return picks[0]
    return best_of(pool, class_abbr, "Waist", used)


def is_ranger_bow(item: dict) -> bool:
    return "Range" in item["slots"] and item["classes"] == ["RNG"]


def build_loadout(catalog: list[dict], class_abbr: str, mode: str = "BIS") -> dict:
    pool = [normalize(c) for c in catalog]
    if mode == "T1":
        pool = [c for c in pool if c["tier"] == "T1"]
    if mode == "T2":
        pool = [c for c in pool if c["tier"] == "T2"]
    used: set[str] = set()
    loadout: dict[str, dict] = {}
    key = class_abbr.upper()
    if key == "RNG":
        bows = [c for c in pool if is_ranger_bow(c) and fits_class(c, key) and fits_slot(c, "Range")]
        if bows:
            bows.sort(key=lambda c: rank_tuple(c, key, "Range"))
            loadout["Range"] = bows[0]
            used |= block_keys(bows[0])
    if key in PET_FOCUS:
        ears = [c for c in pool if is_pet(c) and fits_class(c, key) and fits_slot(c, "Ear-1")]
        if ears:
            ears.sort(key=lambda c: (-em_level(c["focus"], c["effect"], c["name"]), c["name"].casefold()))
            loadout["Ear-1"] = ears[0]
            used |= block_keys(ears[0])
    for slot in SCORED:
        if slot in loadout:
            continue
        slot_used: set[str] = set() if slot in NON_LORE else used
        pick = best_waist(pool, key, slot_used) if slot == "Waist" else best_of(pool, key, slot, slot_used)
        if not pick:
            continue
        loadout[slot] = pick
        if slot not in NON_LORE:
            used |= block_keys(pick)
    return loadout


class ScoringFixtures(unittest.TestCase):
    def test_t1_can_beat_t2(self) -> None:
        catalog = [
            {"item_id": 1, "name": "T2 Ear Weak", "tier": "T2", "classes": ["WAR"], "slots": ["Ear"],
             "stats": {"hp": 100, "hdex": 10, "ac": 10}},
            {"item_id": 2, "name": "T1 Ear Strong", "tier": "T1", "classes": ["WAR"], "slots": ["Ear"],
             "stats": {"hp": 100, "hdex": 50, "ac": 10}},
            {"item_id": 3, "name": "T2 Ear Stronger", "tier": "T2", "classes": ["WAR"], "slots": ["Ear"],
             "stats": {"hp": 100, "hdex": 40, "ac": 10}},
        ]
        loadout = build_loadout(catalog, "WAR", "BIS")
        self.assertEqual(loadout["Ear-1"]["name"], "T1 Ear Strong")

    def test_pet_focus_ear(self) -> None:
        catalog = [
            {"item_id": 10, "name": "Summoner Stud Weak Stats", "tier": "T2",
             "classes": ["MAG", "BST", "NEC"], "slots": ["Ear"],
             "focus": "Enhanced Minion VIII", "stats": {"hp": 10, "hint": 1}},
            {"item_id": 11, "name": "Caster Ear Huge Stats", "tier": "T2",
             "classes": ["MAG"], "slots": ["Ear"], "focus": "",
             "stats": {"hp": 99999, "hint": 99}},
            {"item_id": 12, "name": "Summoner Stud Higher EM", "tier": "T1",
             "classes": ["MAG", "BST", "NEC"], "slots": ["Ear"],
             "focus": "Enhanced Minion X", "stats": {"hp": 5, "hint": 1}},
        ]
        loadout = build_loadout(catalog, "MAG", "BIS")
        self.assertEqual(loadout["Ear-1"]["name"], "Summoner Stud Higher EM")

    def test_waist_three_belts(self) -> None:
        catalog = [
            {"item_id": 20, "name": "Belt Overdrive", "tier": "T2", "class_all": True,
             "slots": ["Waist"], "effect": "Overdrive Punch", "stats": {"hp": 100, "hdex": 20}},
            {"item_id": 21, "name": "Belt Boon", "tier": "T2", "class_all": True,
             "slots": ["Waist"], "effect": "Treaded Boon of Potential", "stats": {"hp": 100, "hdex": 40}},
            {"item_id": 22, "name": "Belt Slicer", "tier": "T2", "class_all": True,
             "slots": ["Waist"], "effect": "Crippling Slicer", "stats": {"hp": 100, "hdex": 10}},
            {"item_id": 23, "name": "Belt Random High", "tier": "T2", "class_all": True,
             "slots": ["Waist"], "effect": "Something Else", "stats": {"hp": 100, "hdex": 99}},
        ]
        loadout = build_loadout(catalog, "ROG", "BIS")
        self.assertEqual(loadout["Waist"]["name"], "Belt Boon")

    def test_ranger_range_is_ranger_bow(self) -> None:
        catalog = [
            {"item_id": 30, "name": "All Class Idol", "tier": "T2", "class_all": True,
             "slots": ["Range"], "stats": {"hp": 99999, "hdex": 99, "ac": 99}},
            {"item_id": 31, "name": "Short Bow", "tier": "T2",
             "classes": ["WAR", "PAL", "SHD", "ROG"], "slots": ["Range"],
             "skill": "Archery", "stats": {"hp": 5000, "hdex": 40, "ac": 40}},
            {"item_id": 32, "name": "Ranger Longbow", "tier": "T2",
             "classes": ["RNG"], "slots": ["Range"],
             "skill": "Archery", "stats": {"hp": 100, "hdex": 5, "ac": 5}},
        ]
        ranger = build_loadout(catalog, "RNG", "T2")
        self.assertEqual(ranger["Range"]["name"], "Ranger Longbow")
        warrior = build_loadout(catalog, "WAR", "T2")
        self.assertEqual(warrior["Range"]["name"], "All Class Idol")


if __name__ == "__main__":
    unittest.main()
