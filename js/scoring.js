/** EQGM Raid BiS loadout ranking ported for the Armor Stats site. */

import { resolveWeights, roleForClass, scoreStats } from "./weights.js";

export const SCORED_SLOTS = [
  "Ear-1", "Head", "Face", "Ear-2", "Chest", "Neck", "Arms", "Back", "Waist",
  "Shoulders", "Wrist-1", "Wrist-2", "Legs", "Hands", "Charm", "Feet",
  "Fingers-1", "Fingers-2", "Range",
];

export const NON_LORE_SLOTS = new Set(["Wrist-1", "Wrist-2"]);
export const PET_FOCUS_CLASSES = new Set(["MAG", "BST", "NEC"]);

/** Fixed waist by role. Name match first; effect/focus fallback for older expansions. */
export const WAIST_BY_ROLE = {
  tank: {
    label: "Defender's Waistguard",
    nameNeedle: "defender's waistguard",
    effectNeedle: "crippling slicer",
  },
  priest: {
    label: "Mystic's Sash",
    nameNeedle: "mystic's sash",
    effectNeedle: "treaded boon of potential",
  },
  pure_caster: {
    label: "Mystic's Sash",
    nameNeedle: "mystic's sash",
    effectNeedle: "treaded boon of potential",
  },
  melee_dps: {
    label: "Acrobat's Belt",
    nameNeedle: "acrobat's",
    effectNeedle: "overdrive punch",
  },
  hybrid_dps: {
    label: "Acrobat's Belt",
    nameNeedle: "acrobat's",
    effectNeedle: "overdrive punch",
  },
};

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(token) {
  const raw = String(token || "").trim().toUpperCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (![...raw].every((ch) => ch in ROMAN)) return 0;
  let total = 0;
  let i = 0;
  while (i < raw.length) {
    const value = ROMAN[raw[i]];
    if (i + 1 < raw.length) {
      const nxt = ROMAN[raw[i + 1]];
      if (nxt > value) {
        total += nxt - value;
        i += 2;
        continue;
      }
    }
    total += value;
    i += 1;
  }
  return total;
}

export function parseEnhancedMinionLevel(...texts) {
  let best = 0;
  const re = /enhanced\s+minion\s+([ivxlcdm]+|\d+)\b/gi;
  for (const text of texts) {
    if (!text) continue;
    for (const match of String(text).matchAll(re)) {
      const level = romanToInt(match[1]);
      if (level > best) best = level;
    }
  }
  return best;
}

export function slotBase(gearSlot) {
  if (gearSlot.startsWith("Ear")) return "Ear";
  if (gearSlot.startsWith("Wrist")) return "Wrist";
  if (gearSlot.startsWith("Fingers")) return "Fingers";
  return gearSlot;
}

function asList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value === "string") {
    return value.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  }
  return [value];
}

export function normalizeItem(raw) {
  if (!raw) return null;
  const classes = raw.class_all
    ? []
    : (raw.classes == null ? null : asList(raw.classes).map((c) => String(c).toUpperCase()));
  return {
    item_id: Number(raw.item_id || 0),
    name: String(raw.name || ""),
    stats: { ...(raw.stats || {}) },
    classes,
    slots: new Set(asList(raw.slots).map(String)),
    tier: String(raw.tier || ""),
    lore_group: raw.lore_group || null,
    icon_id: raw.icon_id || null,
    focus: String(raw.focus || ""),
    effect: String(raw.effect || ""),
    damage: raw.damage != null ? Number(raw.damage) : null,
    delay: raw.delay != null ? Number(raw.delay) : null,
    skill: String(raw.skill || ""),
    source: String(raw.source || "EQ Resource"),
  };
}

export function fitsClass(item, classAbbr) {
  if (!classAbbr) return false;
  if (item.classes == null) return false;
  if (item.classes.length === 0) return true;
  return item.classes.includes(String(classAbbr).toUpperCase());
}

function slotSet(item) {
  if (item.slots instanceof Set) return item.slots;
  return new Set(item.slots || []);
}

export function fitsSlot(item, gearSlot) {
  return slotSet(item).has(slotBase(gearSlot));
}

export function isRangerOnlyBow(item) {
  if (!slotSet(item).has("Range")) return false;
  const classes = item.classes;
  return Array.isArray(classes) && classes.length === 1 && classes[0] === "RNG";
}

export function isPetFocusEar(item) {
  if (!slotSet(item).has("Ear")) return false;
  const nameHit = (item.name || "").toLowerCase().includes("summoner");
  const focusHit = (item.focus || "").toLowerCase().includes("enhanced minion");
  if (!nameHit && !focusHit) return false;
  if (item.classes == null) return false;
  if (item.classes.length && !item.classes.some((c) => PET_FOCUS_CLASSES.has(c))) {
    return false;
  }
  return true;
}

export function enhancedMinionLevel(item) {
  return parseEnhancedMinionLevel(item.focus, item.effect, item.name);
}

export function loreKey(item) {
  if (item.lore_group) return String(item.lore_group).trim().toLowerCase();
  return String(item.item_id);
}

export function blockKeys(item) {
  const keys = new Set([loreKey(item)]);
  if (item.item_id > 0) keys.add(String(item.item_id));
  return keys;
}

export function rankTuple(item, classAbbr, gearSlot) {
  const weights = resolveWeights(classAbbr, gearSlot);
  const score = scoreStats(item.stats, weights);
  const hp = Number(item.stats.hp || 0);
  const ac = Number(item.stats.ac || 0);
  return [-score, -hp, -ac, (item.name || "").toLowerCase()];
}

function cmpTuple(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export function legalForSlot(item, classAbbr, gearSlot) {
  return fitsClass(item, classAbbr) && fitsSlot(item, gearSlot);
}

function bestOf(candidates, classAbbr, gearSlot, used) {
  const legal = candidates.filter((c) => {
    if (!legalForSlot(c, classAbbr, gearSlot)) return false;
    for (const k of blockKeys(c)) {
      if (used.has(k)) return false;
    }
    return true;
  });
  if (!legal.length) return null;
  legal.sort((a, b) => cmpTuple(rankTuple(a, classAbbr, gearSlot), rankTuple(b, classAbbr, gearSlot)));
  return legal[0];
}

export function matchesWaistLabel(item, label) {
  const needle = label.toLowerCase();
  const hay = `${item.effect || ""} ${item.focus || ""}`.toLowerCase();
  return hay.includes(needle);
}

export function preferredWaistSpec(classAbbr) {
  const role = roleForClass(classAbbr);
  return WAIST_BY_ROLE[role] || WAIST_BY_ROLE.melee_dps;
}

export function matchesPreferredWaist(item, spec, preferName) {
  if (!spec) return false;
  if (preferName) {
    return (item.name || "").toLowerCase().includes(spec.nameNeedle);
  }
  return matchesWaistLabel(item, spec.effectNeedle);
}

/** Role-locked waist pick: [[label, item]] or []. */
export function waistChoicesForClass(catalog, classAbbr, used = new Set()) {
  const pool = catalog.map(normalizeItem).filter(Boolean);
  const spec = preferredWaistSpec(classAbbr);
  const byName = pool.filter((c) => matchesPreferredWaist(c, spec, true));
  let pick = bestOf(byName, classAbbr, "Waist", used);
  if (!pick) {
    const byEffect = pool.filter((c) => matchesPreferredWaist(c, spec, false));
    pick = bestOf(byEffect, classAbbr, "Waist", used);
  }
  return pick ? [[spec.label, pick]] : [];
}

function bestWaist(catalog, classAbbr, used) {
  const choices = waistChoicesForClass(catalog, classAbbr, used);
  if (choices.length) return choices[0][1];
  return bestOf(catalog, classAbbr, "Waist", used);
}

function chooseRangerBow(catalog, classAbbr) {
  const bows = catalog.filter(
    (c) => isRangerOnlyBow(c) && legalForSlot(c, classAbbr, "Range")
  );
  if (!bows.length) return null;
  bows.sort((a, b) => cmpTuple(rankTuple(a, classAbbr, "Range"), rankTuple(b, classAbbr, "Range")));
  return bows[0];
}

function choosePetFocusEar(catalog, classAbbr) {
  const ears = catalog.filter(
    (c) => isPetFocusEar(c) && legalForSlot(c, classAbbr, "Ear-1")
  );
  if (!ears.length) return [null, null];
  ears.sort((a, b) => {
    const la = -enhancedMinionLevel(a);
    const lb = -enhancedMinionLevel(b);
    if (la !== lb) return la - lb;
    return (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
  });
  return ["Ear-1", ears[0]];
}

/**
 * Best unique item per scored slot (EQGM build_ideal_loadout).
 * @param {object[]} catalog normalized items
 * @param {string} classAbbr
 * @param {"T1"|"T2"|"BIS"} mode
 */
export function buildIdealLoadout(catalog, classAbbr, mode = "BIS") {
  let pool = catalog.map(normalizeItem).filter(Boolean);
  if (mode === "T1") pool = pool.filter((i) => i.tier === "T1");
  if (mode === "T2") pool = pool.filter((i) => i.tier === "T2");

  const used = new Set();
  const loadout = {};
  const classKey = (classAbbr || "").trim().toUpperCase() || null;

  if (classKey === "RNG") {
    const bow = chooseRangerBow(pool, classKey);
    if (bow) {
      loadout.Range = bow;
      for (const k of blockKeys(bow)) used.add(k);
    }
  }

  if (classKey && PET_FOCUS_CLASSES.has(classKey)) {
    const [pinSlot, pinItem] = choosePetFocusEar(pool, classKey);
    if (pinSlot && pinItem) {
      loadout[pinSlot] = pinItem;
      for (const k of blockKeys(pinItem)) used.add(k);
    }
  }

  for (const slot of SCORED_SLOTS) {
    if (loadout[slot]) continue;
    const slotUsed = NON_LORE_SLOTS.has(slot) ? new Set() : used;
    const pick = slot === "Waist"
      ? bestWaist(pool, classKey, slotUsed)
      : bestOf(pool, classKey, slot, slotUsed);
    if (!pick) continue;
    loadout[slot] = pick;
    if (!NON_LORE_SLOTS.has(slot)) {
      for (const k of blockKeys(pick)) used.add(k);
    }
  }
  return loadout;
}

export function sumLoadoutStats(loadout) {
  const totals = {};
  for (const item of Object.values(loadout)) {
    for (const [k, v] of Object.entries(item.stats || {})) {
      totals[k] = (totals[k] || 0) + Number(v || 0);
    }
  }
  return totals;
}

export function percentChange(baseline, other) {
  const b = Number(baseline || 0);
  const o = Number(other || 0);
  if (b === 0) return o === 0 ? 0 : null;
  return ((o - b) / b) * 100;
}

export function compareTotals(baseTotals, otherTotals, keys) {
  return keys.map((key) => {
    const left = Number(baseTotals[key] || 0);
    const right = Number(otherTotals[key] || 0);
    return {
      key,
      baseline: left,
      other: right,
      change: right - left,
      percent: percentChange(left, right),
    };
  });
}
