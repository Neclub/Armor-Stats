import {
  EXPANSIONS,
  classListLabel,
  isWeaponItem,
  itemUrl,
  loadCatalog,
  orderedPair,
  weaponClassGroupId,
  weaponFamily,
  weaponFamilyKey,
  weaponSkillKey,
} from "./data.js";
import { percentChange } from "./scoring.js";

const els = {
  expA: document.getElementById("expA"),
  expB: document.getElementById("expB"),
  classGroup: document.getElementById("classFilter"),
  skill: document.getElementById("skillFilter"),
  family: document.getElementById("familyFilter"),
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
  const skill = els.skill.value;
  const family = els.family.value;
  return weapons.filter((w) => {
    if (group && weaponClassGroupId(w) !== group) return false;
    if (skill && weaponSkillKey(w) !== skill) return false;
    if (family && weaponFamilyKey(w) !== family) return false;
    return true;
  });
}

function fillFilterOptions(weapons) {
  const prevSkill = els.skill.value;
  const prevFamily = els.family.value;
  const group = els.classGroup.value;
  const pool = group
    ? weapons.filter((w) => weaponClassGroupId(w) === group)
    : weapons;

  const skills = [...new Set(pool.map((w) => (w.skill || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  els.skill.innerHTML = "";
  const skillAll = document.createElement("option");
  skillAll.value = "";
  skillAll.textContent = "All skills";
  els.skill.appendChild(skillAll);
  for (const skill of skills) {
    const opt = document.createElement("option");
    opt.value = skill.toLowerCase();
    opt.textContent = skill;
    els.skill.appendChild(opt);
  }
  if ([...els.skill.options].some((o) => o.value === prevSkill)) {
    els.skill.value = prevSkill;
  } else {
    els.skill.value = "";
  }

  const activeSkill = els.skill.value;
  const skillFiltered = activeSkill
    ? pool.filter((w) => weaponSkillKey(w) === activeSkill)
    : pool;
  const families = [...new Map(
    skillFiltered.map((w) => [weaponFamilyKey(w), weaponFamily(w.name)])
  ).entries()]
    .filter(([key]) => key)
    .sort((a, b) => a[1].localeCompare(b[1]));

  els.family.innerHTML = "";
  const familyAll = document.createElement("option");
  familyAll.value = "";
  familyAll.textContent = "All weapons";
  els.family.appendChild(familyAll);
  for (const [key, label] of families) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    els.family.appendChild(opt);
  }
  if ([...els.family.options].some((o) => o.value === prevFamily)) {
    els.family.value = prevFamily;
  } else {
    els.family.value = "";
  }
}

function bestByFamily(weapons) {
  const map = new Map();
  for (const w of weapons) {
    const key = weaponFamilyKey(w);
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
        <td>${weaponFamily(w.name)}</td>
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
          <th>Weapon</th><th>Type</th><th>Classes</th><th>Skill</th><th class="num">Dmg</th>
          <th class="num">Delay</th><th class="num">Ratio</th>
          <th class="num">HP</th><th class="num">AC</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderCompare(baseWeapons, otherWeapons, baseLabel, otherLabel) {
  if (!otherWeapons) {
    els.compareBody.innerHTML = `<tr><td colspan="6" class="muted">Pick a second expansion to compare.</td></tr>`;
    return;
  }
  const baseMap = bestByFamily(baseWeapons);
  const otherMap = bestByFamily(otherWeapons);
  const keys = new Set([...baseMap.keys(), ...otherMap.keys()]);
  const rows = [];
  for (const key of [...keys].sort()) {
    const a = baseMap.get(key);
    const b = otherMap.get(key);
    if (!a || !b) continue;
    const ra = ratio(a);
    const rb = ratio(b);
    const pct = ra != null && rb != null ? percentChange(ra, rb) : null;
    rows.push(`<tr>
      <td>${weaponFamily(a.name)}<div class="muted">${a.skill || "—"}</div></td>
      <td><a href="${itemUrl(a.item_id)}" target="_blank" rel="noopener">${a.name}</a>
        <div class="muted">${classListLabel(a)} · ${fmt(a.damage)} / ${fmt(a.delay)} (${ra == null ? "—" : ra.toFixed(2)})</div></td>
      <td><a href="${itemUrl(b.item_id)}" target="_blank" rel="noopener">${b.name}</a>
        <div class="muted">${classListLabel(b)} · ${fmt(b.damage)} / ${fmt(b.delay)} (${rb == null ? "—" : rb.toFixed(2)})</div></td>
      <td class="num">${fmt((b.damage || 0) - (a.damage || 0))}</td>
      <td class="num">${fmt((rb || 0) - (ra || 0))}</td>
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

async function init() {
  fillExpansionSelects();
  for (const el of [els.expA, els.expB, els.classGroup, els.skill, els.family]) {
    el.addEventListener("change", () => { refresh().catch(console.error); });
  }
  await refresh();
}

init().catch((err) => {
  console.error(err);
  els.banner.classList.remove("hidden");
  els.banner.textContent = `Failed to start: ${err.message || err}`;
});
