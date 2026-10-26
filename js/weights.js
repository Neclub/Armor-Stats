/** Resolve EQGM-style class/slot weights from bundled JSON. */

export const STAT_KEYS = [
  "ac", "hp", "mana", "endurance",
  "str", "sta", "agi", "dex", "wis", "int", "cha",
  "hstr", "hsta", "hagi", "hdex", "hwis", "hint", "hcha",
  "atk", "accuracy", "combat_effects", "avoidance", "shielding",
  "spell_shield", "dot_shield", "stun_resist", "strikethrough",
  "heal_amount", "spell_damage", "clairvoyance",
];

export const STAT_DISPLAY = {
  ac: "AC", hp: "HP", mana: "Mana", endurance: "End",
  str: "STR", sta: "STA", agi: "AGI", dex: "DEX", wis: "WIS", int: "INT", cha: "CHA",
  hstr: "HStr", hsta: "HSta", hagi: "HAgi", hdex: "HDex", hwis: "HWis", hint: "HInt", hcha: "HCha",
  atk: "ATK", accuracy: "Accuracy", combat_effects: "Combat Effects",
  avoidance: "Avoidance", shielding: "Shielding", spell_shield: "Spell Shield",
  dot_shield: "DoT Shield", stun_resist: "Stun Resist", strikethrough: "Strike Through",
  heal_amount: "Heal Amount", spell_damage: "Spell Damage", clairvoyance: "Clairvoyance",
};

export const POOL_STATS = ["ac", "hp", "mana", "endurance"];
export const HEROIC_STATS = ["hstr", "hsta", "hagi", "hdex", "hwis", "hint", "hcha"];
export const SECONDARY_STATS = STAT_KEYS.filter(
  (k) => !POOL_STATS.includes(k) && !HEROIC_STATS.includes(k) &&
    !["str", "sta", "agi", "dex", "wis", "int", "cha"].includes(k)
);

const CLASS_TO_PROFILE = {
  WAR: "dex", PAL: "dex", SHD: "dex", MNK: "dex", RNG: "dex", ROG: "dex",
  BST: "dex", BRD: "dex", BER: "dex",
  ENC: "int", WIZ: "int", MAG: "int", NEC: "int",
  SHM: "wis", CLR: "wis", DRU: "wis",
};

let tables = { roles: {}, classes: {}, overlays: [] };

export async function loadWeightTables(base = "data/weights") {
  const [roles, classes, overlays] = await Promise.all([
    fetch(`${base}/roles.json`).then((r) => r.json()),
    fetch(`${base}/classes.json`).then((r) => r.json()),
    fetch(`${base}/slot_overlays.json`).then((r) => r.json()),
  ]);
  tables = {
    roles: roles.roles || {},
    classes: classes.classes || {},
    overlays: overlays.overlays || [],
  };
  return tables;
}

function gearSlotBase(gearSlot) {
  if (gearSlot.startsWith("Ear")) return "Ear";
  if (gearSlot.startsWith("Wrist")) return "Wrist";
  if (gearSlot.startsWith("Fingers")) return "Fingers";
  return gearSlot;
}

function defaultRole(profile) {
  if (profile === "int") return "pure_caster";
  if (profile === "wis") return "priest";
  return "melee_dps";
}

function mergeMaps(...maps) {
  const out = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [k, v] of Object.entries(map)) {
      if (!STAT_KEYS.includes(k)) continue;
      out[k] = (out[k] || 0) + Number(v);
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => Math.abs(v) > 1e-9));
}

function feetAcDominance(weights) {
  return { ac: Number(weights.ac || 0) };
}

export function resolveWeights(classAbbr, gearSlot) {
  const key = (classAbbr || "").trim().toUpperCase() || null;
  const packaged = key ? (tables.classes[key] || {}) : {};
  let roleName = packaged.role || "";
  if (!roleName) {
    roleName = defaultRole(CLASS_TO_PROFILE[key] || "dex");
  }
  const roleBase = { ...(tables.roles[roleName] || {}) };
  const classMods = { ...(packaged.modifiers || {}) };
  const slotBase = gearSlotBase(gearSlot);
  const overlayMods = {};
  let feetAcPriority = false;
  for (const overlay of tables.overlays) {
    const slots = overlay.slots || [];
    if (!slots.includes(slotBase) && !slots.includes(gearSlot)) continue;
    if (overlay.classes != null) {
      const allowed = new Set(overlay.classes.map((c) => String(c).toUpperCase()));
      if (!key || !allowed.has(key)) continue;
    }
    if (overlay.require_shield) continue;
    if (overlay.id === "feet_high_ac") feetAcPriority = true;
    for (const [k, v] of Object.entries(overlay.modifiers || {})) {
      overlayMods[k] = (overlayMods[k] || 0) + Number(v);
    }
  }
  const merged = mergeMaps(roleBase, classMods, overlayMods);
  if (feetAcPriority) return feetAcDominance(merged);
  return merged;
}

export function scoreStats(stats, weights) {
  let total = 0;
  const data = stats || {};
  for (const [key, weight] of Object.entries(weights || {})) {
    total += Number(data[key] || 0) * Number(weight);
  }
  return total;
}
