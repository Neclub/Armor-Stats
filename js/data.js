/** Load committed per-expansion catalogs. */

export const EXPANSIONS = [
  { code: "tov", abbr: "ToV", name: "Torment of Velious", order: 0 },
  { code: "cov", abbr: "CoV", name: "Claws of Veeshan", order: 1 },
  { code: "tol", abbr: "ToL", name: "Terror of Luclin", order: 2 },
  { code: "nos", abbr: "NoS", name: "Night of Shadows", order: 3 },
  { code: "ls", abbr: "LS", name: "Laurion's Song", order: 4 },
  { code: "tob", abbr: "ToB", name: "The Outer Brood", order: 5 },
  { code: "sor", abbr: "SoR", name: "Shattering of Ro", order: 6 },
  { code: "fof", abbr: "FoF", name: "Favors of Fortune", order: 7 },
];

export const CLASSES = [
  "WAR", "PAL", "SHD", "RNG", "MNK", "ROG", "BER", "BST", "BRD",
  "CLR", "DRU", "SHM", "WIZ", "MAG", "NEC", "ENC",
];

const catalogCache = new Map();

export async function loadCatalog(code) {
  if (catalogCache.has(code)) return catalogCache.get(code);
  const url = `cache/raid_bis_catalog_${code}.json`;
  let payload = null;
  try {
    const resp = await fetch(url);
    if (resp.ok) payload = await resp.json();
  } catch {
    payload = null;
  }
  const catalog = payload?.catalog || {
    items: [],
    warning: payload ? null : "Catalog not found",
    expansion: code,
  };
  if (!Array.isArray(catalog.items)) catalog.items = [];
  catalogCache.set(code, catalog);
  return catalog;
}

export function itemUrl(itemId) {
  return `https://items.eqresource.com/items.php?id=${itemId}`;
}

export function orderedPair(codeA, codeB) {
  const a = EXPANSIONS.find((e) => e.code === codeA);
  const b = EXPANSIONS.find((e) => e.code === codeB);
  if (!a || !b) return [codeA, codeB];
  return a.order <= b.order ? [codeA, codeB] : [codeB, codeA];
}

export function weaponSkillKey(item) {
  if (item.skill) return String(item.skill).trim().toLowerCase();
  const slots = item.slots || [];
  const slotList = Array.isArray(slots) ? slots : [...slots];
  return `${slotList.sort().join(",")}|${(item.name || "").toLowerCase()}`;
}

/** Strip expansion set prefixes/suffixes so "Injection Dagger of Rebellion" → "Injection Dagger". */
export function weaponFamily(name) {
  let n = String(name || "").trim();
  n = n.replace(
    /^(Velium Enhanced|Velium Endowed|Luclinite Coagulated|Spectral Luclinite)\s+/i,
    ""
  );
  n = n.replace(
    /\s+of\s+(?:Eternal Reverie|Heroic Reflections|Rebellion|the Bound|Resonant Fracture|Shattered Dominion|Gilded Thorns|Spectral Luclinite|Luclinite Coagulated|Velium Endowed|Velium Enhanced)\s*$/i,
    ""
  );
  return n.trim();
}

export function weaponFamilyKey(item) {
  return weaponFamily(item?.name || "").toLowerCase();
}

export function isWeaponItem(item) {
  if ((item.tier || "").toUpperCase() !== "T2") return false;
  const name = (item.name || "").toLowerCase();
  if (name.includes("shield") || name.includes("buckler")) return false;
  const skill = (item.skill || "").toLowerCase();
  if (skill.includes("block") || skill === "shield") return false;
  if (skill === "archery" || skill.includes("archery")) return true;
  const slots = item.slots || [];
  const set = new Set(Array.isArray(slots) ? slots : [...slots]);
  return set.has("Primary") || set.has("Secondary");
}

/** Exact class pairs that share a weapon and nobody else does. */
const EXCLUSIVE_WEAPON_CLASSES = {
  "pal-shd": ["PAL", "SHD"],
  "mnk-bst": ["MNK", "BST"],
};

export function weaponClassSet(item) {
  return new Set((item?.classes || []).map((c) => String(c).toUpperCase()));
}

/** "pal-shd" or "mnk-bst" when the weapon is usable by that pair only. */
export function weaponClassGroupId(item) {
  if (!item || item.class_all) return "";
  const set = weaponClassSet(item);
  for (const [id, classes] of Object.entries(EXCLUSIVE_WEAPON_CLASSES)) {
    if (set.size === classes.length && classes.every((c) => set.has(c))) return id;
  }
  return "";
}

export function classListLabel(item) {
  if (!item) return "—";
  if (item.class_all) return "All";
  const have = weaponClassSet(item);
  const ordered = CLASSES.filter((c) => have.has(c));
  const extra = [...have].filter((c) => !CLASSES.includes(c)).sort();
  const labels = [...ordered, ...extra];
  return labels.length ? labels.join(", ") : "—";
}
