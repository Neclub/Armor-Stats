import {
  CLASSES,
  EXPANSIONS,
  WEAPON_HANDS,
  classListLabel,
  isWeaponItem,
  itemUrl,
  loadCatalog,
  orderedPair,
  weaponHand,
  weaponLineLabel,
  weaponMatchKey,
  weaponMatchesClassFilter,
} from "./data.js";
import { percentChange } from "./scoring.js";

const els = {
  expA: document.getElementById("expA"),
  expB: document.getElementById("expB"),
  classGroup: document.getElementById("classFilter"),
  hand: document.getElementById("handFilter"),
  line: document.getElementById("lineFilter"),
  banner: document.getElementById("banner"),
  list: document.getElementById("weaponList"),
  compareBody: document.getElementById("compareBody"),
};

function fillExpansionSelects() {
  for (const sel of [els.expA, els.expB]) {
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = sel === els.expB ? "(none — list only)" : "Select expansion";
    sel.appendChild(blank);
    for (const exp of EXPANSIONS) {
      const opt = document.createElement("option");
      opt.value = exp.code;
      opt.textContent = `${exp.abbr} — ${exp.name}`;
      sel.appendChild(opt);
    }
  }
  els.expA.value = "sor";
  els.expB.value = "tob";
}

function ratio(item) {
  const dmg = Number(item.damage || 0);
  const delay = Number(item.delay || 0);
  if (!dmg || !delay) return null;
  return dmg / delay;
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPct(p) {
  if (p == null || Number.isNaN(p)) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

function pctClass(p) {
  if (p == null || Number.isNaN(p) || p === 0) return "muted";
  return p > 0 ? "pos" : "neg";
}

function weaponPool(catalog) {
  return (catalog.items || []).filter(isWeaponItem);
}

function applyFilters(weapons) {
  const group = els.classGroup.value;
  const hand = els.hand.value;
  const line = els.line.value;
  return weapons.filter((w) => {
    if (!weaponMatchesClassFilter(w, group)) return false;
    if (hand && weaponHand(w) !== hand) return false;
    if (line && weaponMatchKey(w) !== line) return false;
    return true;
  });
}

function fillFilterOptions(weapons) {
  const prevHand = els.hand.value;
  const prevLine = els.line.value;
  const group = els.classGroup.value;
  const pool = weapons.filter((w) => weaponMatchesClassFilter(w, group));

  const hands = new Set(pool.map((w) => weaponHand(w)).filter(Boolean));
  els.hand.innerHTML = "";
  const handAll = document.createElement("option");
  handAll.value = "";
  handAll.textContent = "All hands";
  els.hand.appendChild(handAll);
  for (const hand of WEAPON_HANDS) {
    if (!hands.has(hand.id)) continue;
    const opt = document.createElement("option");
    opt.value = hand.id;
    opt.textContent = hand.label;
    els.hand.appendChild(opt);
  }
  if ([...els.hand.options].some((o) => o.value === prevHand)) {
    els.hand.value = prevHand;
  } else {
    els.hand.value = "";
  }

  const activeHand = els.hand.value;
  const handFiltered = activeHand
    ? pool.filter((w) => weaponHand(w) === activeHand)
    : pool;
  const lines = [...new Map(
    handFiltered.map((w) => [weaponMatchKey(w), weaponLineLabel(w)])
  ).entries()]
    .filter(([key]) => key)
    .sort((a, b) => a[1].localeCompare(b[1]));

  els.line.innerHTML = "";
  const lineAll = document.createElement("option");
  lineAll.value = "";
  lineAll.textContent = "All weapons";
  els.line.appendChild(lineAll);
  for (const [key, label] of lines) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    els.line.appendChild(opt);
  }
  if ([...els.line.options].some((o) => o.value === prevLine)) {
    els.line.value = prevLine;
  } else {
    els.line.value = "";
  }
}

function bestByLine(weapons) {
  const map = new Map();
  for (const w of weapons) {
    const key = weaponMatchKey(w);
    if (!key) continue;
    const prev = map.get(key);
    const score = Number(w.stats?.hp || 0) + Number(w.damage || 0) * 10;
    const prevScore = prev
      ? Number(prev.stats?.hp || 0) + Number(prev.damage || 0) * 10
      : -Infinity;
    if (!prev || score > prevScore) map.set(key, w);
  }
  return map;
}

function renderList(weapons, label) {
  if (!weapons.length) {
    els.list.innerHTML = `<p class="muted">No T2 weapons match the filters for ${label}.</p>`;
    return;
  }
  const rows = weapons
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((w) => {
      const r = ratio(w);
      return `<tr>
        <td><a href="${itemUrl(w.item_id)}" target="_blank" rel="noopener">${w.name}</a></td>
        <td>${weaponLineLabel(w)}</td>
        <td>${classListLabel(w)}</td>
        <td>${w.skill || (w.slots || []).join(", ") || "—"}</td>
        <td class="num">${fmt(w.damage)}</td>
        <td class="num">${fmt(w.delay)}</td>
        <td class="num">${r == null ? "—" : r.toFixed(2)}</td>
        <td class="num">${fmt(w.stats?.hp)}</td>
        <td class="num">${fmt(w.stats?.ac)}</td>
      </tr>`;
    })
    .join("");
  els.list.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Weapon</th><th>Line</th><th>Classes</th><th>Skill</th><th class="num">Dmg</th>
          <th class="num">Delay</th><th class="num">Ratio</th>
          <th class="num">HP</th><th class="num">AC</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function sideCell(item) {
  if (!item) return `<td class="muted">—</td>`;
  const r = ratio(item);
  return `<td><a href="${itemUrl(item.item_id)}" target="_blank" rel="noopener">${item.name}</a>
        <div class="muted">${item.skill || "—"} · ${fmt(item.damage)} / ${fmt(item.delay)} (${r == null ? "—" : r.toFixed(2)})</div></td>`;
}

function renderCompare(baseWeapons, otherWeapons, baseLabel, otherLabel) {
  if (!otherWeapons) {
    els.compareBody.innerHTML = `<tr><td colspan="6" class="muted">Pick a second expansion to compare.</td></tr>`;
    return;
  }
  const baseMap = bestByLine(baseWeapons);
  const otherMap = bestByLine(otherWeapons);
  const keys = new Set([...baseMap.keys(), ...otherMap.keys()]);
  const rows = [];
  for (const key of [...keys].sort((a, b) => {
    const la = weaponLineLabel(baseMap.get(a) || otherMap.get(a));
    const lb = weaponLineLabel(baseMap.get(b) || otherMap.get(b));
    return la.localeCompare(lb);
  })) {
    const a = baseMap.get(key);
    const b = otherMap.get(key);
    const shown = a || b;
    const ra = a ? ratio(a) : null;
    const rb = b ? ratio(b) : null;
    const pct = ra != null && rb != null ? percentChange(ra, rb) : null;
    const deltaDmg = a && b ? fmt((b.damage || 0) - (a.damage || 0)) : "—";
    const deltaRatio = a && b && ra != null && rb != null ? fmt(rb - ra) : "—";
    rows.push(`<tr>
      <td>${weaponLineLabel(shown)}</td>
      ${sideCell(a)}
      ${sideCell(b)}
      <td class="num">${deltaDmg}</td>
      <td class="num">${deltaRatio}</td>
      <td class="num ${pctClass(pct)}">${fmtPct(pct)}</td>
    </tr>`);
  }
  if (!rows.length) {
    els.compareBody.innerHTML = `<tr><td colspan="6" class="muted">No matching weapon types between ${baseLabel} and ${otherLabel} for these filters.</td></tr>`;
    return;
  }
  document.getElementById("baseCol").textContent = baseLabel;
  document.getElementById("otherCol").textContent = otherLabel;
  els.compareBody.innerHTML = rows.join("");
}

async function refresh() {
  const codeA = els.expA.value;
  if (!codeA) return;
  const codeB = els.expB.value;
  const expA = EXPANSIONS.find((e) => e.code === codeA);
  const catA = await loadCatalog(codeA);
  let allForFilters = weaponPool(catA);

  const warnings = [];
  if (!allForFilters.length) {
    warnings.push(`${expA.abbr} has no T2 weapons cached yet${catA.warning ? ` (${catA.warning})` : ""}.`);
  }

  let baseW = [];
  let otherW = null;
  let baseExp = expA;
  let otherExp = null;

  if (codeB) {
    const [baseCode, otherCode] = orderedPair(codeA, codeB);
    baseExp = EXPANSIONS.find((e) => e.code === baseCode);
    otherExp = EXPANSIONS.find((e) => e.code === otherCode);
    const catBase = await loadCatalog(baseCode);
    const catOther = await loadCatalog(otherCode);
    baseW = weaponPool(catBase);
    otherW = weaponPool(catOther);
    allForFilters = [...baseW, ...otherW];
    if (!otherW.length) warnings.push(`${otherExp.abbr} has no T2 weapons cached yet.`);
  } else {
    baseW = allForFilters;
  }

  fillFilterOptions(allForFilters);
  const listWeapons = applyFilters(weaponPool(catA));
  const filteredBase = applyFilters(baseW);
  const filteredOther = otherW ? applyFilters(otherW) : null;

  renderList(listWeapons, expA.abbr);
  renderCompare(
    filteredBase,
    filteredOther,
    baseExp.abbr,
    otherExp ? otherExp.abbr : ""
  );

  if (warnings.length) {
    els.banner.classList.remove("hidden");
    els.banner.textContent = warnings.join(" ");
  } else {
    els.banner.classList.add("hidden");
  }
}

function fillClassSelect() {
  for (const cls of CLASSES) {
    const opt = document.createElement("option");
    opt.value = cls;
    opt.textContent = cls;
    els.classGroup.appendChild(opt);
  }
}

async function init() {
  fillExpansionSelects();
  fillClassSelect();
  for (const el of [els.expA, els.expB, els.classGroup, els.hand, els.line]) {
    el.addEventListener("change", () => { refresh().catch(console.error); });
  }
  await refresh();
}

init().catch((err) => {
  console.error(err);
  els.banner.classList.remove("hidden");
  els.banner.textContent = `Failed to start: ${err.message || err}`;
});
