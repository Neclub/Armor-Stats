import {
  CLASSES,
  EXPANSIONS,
  itemUrl,
  loadCatalog,
  orderedPair,
} from "./data.js";
import {
  buildIdealLoadout,
  compareTotals,
  SCORED_SLOTS,
  sumLoadoutStats,
} from "./scoring.js";
import {
  HEROIC_STATS,
  loadWeightTables,
  POOL_STATS,
  SECONDARY_STATS,
  STAT_DISPLAY,
} from "./weights.js";

const els = {
  class: document.getElementById("classSelect"),
  expA: document.getElementById("expA"),
  expB: document.getElementById("expB"),
  mode: document.getElementById("modeSelect"),
  banner: document.getElementById("banner"),
  totalsBody: document.getElementById("totalsBody"),
  slots: document.getElementById("slotList"),
  chart: document.getElementById("pctChart"),
};

let chart;
let ready = false;

function fillSelects() {
  for (const cls of CLASSES) {
    const opt = document.createElement("option");
    opt.value = cls;
    opt.textContent = cls;
    els.class.appendChild(opt);
  }
  for (const sel of [els.expA, els.expB]) {
    for (const exp of EXPANSIONS) {
      const opt = document.createElement("option");
      opt.value = exp.code;
      opt.textContent = `${exp.abbr} — ${exp.name}`;
      sel.appendChild(opt);
    }
  }
  els.expA.value = "ls";
  els.expB.value = "tob";
  els.class.value = "WAR";
  els.mode.value = "BIS";
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
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

function renderTotals(rows) {
  els.totalsBody.innerHTML = "";
  const groups = [
    ["Pools", POOL_STATS],
    ["Heroic", HEROIC_STATS],
    ["Secondary", SECONDARY_STATS],
  ];
  for (const [title, keys] of groups) {
    const groupRows = rows.filter((r) => keys.includes(r.key) && (r.baseline || r.other));
    if (!groupRows.length) continue;
    const trh = document.createElement("tr");
    trh.innerHTML = `<td colspan="5" class="stat-group-title">${title}</td>`;
    els.totalsBody.appendChild(trh);
    for (const row of groupRows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${STAT_DISPLAY[row.key] || row.key}</td>
        <td class="num">${fmt(row.baseline)}</td>
        <td class="num">${fmt(row.other)}</td>
        <td class="num ${row.change > 0 ? "pos" : row.change < 0 ? "neg" : "muted"}">${row.change > 0 ? "+" : ""}${fmt(row.change)}</td>
        <td class="num ${pctClass(row.percent)}">${fmtPct(row.percent)}</td>`;
      els.totalsBody.appendChild(tr);
    }
  }
}

function renderChart(rows) {
  const labels = [];
  const percents = [];
  const changes = [];
  for (const key of [...POOL_STATS, ...HEROIC_STATS]) {
    const row = rows.find((r) => r.key === key);
    if (!row || (!row.baseline && !row.other)) continue;
    if (row.percent == null) continue;
    labels.push(STAT_DISPLAY[key] || key);
    percents.push(Number(row.percent.toFixed(2)));
    changes.push(Number(row.change || 0));
  }
  const colors = percents.map((v) => (v >= 0 ? "rgba(62,207,142,0.75)" : "rgba(240,113,120,0.75)"));
  if (chart) chart.destroy();
  chart = new Chart(els.chart, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "% change",
        data: percents,
        backgroundColor: colors,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const change = changes[ctx.dataIndex] || 0;
              const sign = change > 0 ? "+" : "";
              return `${sign}${change.toLocaleString()}  (${ctx.parsed.y.toFixed(1)}%)`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#9aabbc" }, grid: { color: "#243040" } },
        y: {
          ticks: { color: "#9aabbc", callback: (v) => `${v}%` },
          grid: { color: "#243040" },
          title: { display: true, text: "Percent", color: "#9aabbc" },
        },
      },
    },
    plugins: [{
      id: "absoluteChangeLabels",
      afterDatasetsDraw(chartInstance) {
        const { ctx } = chartInstance;
        const meta = chartInstance.getDatasetMeta(0);
        if (!meta) return;
        const absChanges = chartInstance.$absoluteChanges || changes;
        const pctData = chartInstance.data.datasets[0]?.data || [];
        ctx.save();
        ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "center";
        meta.data.forEach((bar, index) => {
          const change = absChanges[index] || 0;
          const sign = change > 0 ? "+" : "";
          const text = `${sign}${Number(change).toLocaleString()}`;
          const pos = bar.tooltipPosition();
          const above = Number(pctData[index] || 0) >= 0;
          ctx.fillStyle = above ? "#3ecf8e" : "#f07178";
          ctx.textBaseline = above ? "bottom" : "top";
          ctx.fillText(text, pos.x, above ? pos.y - 4 : pos.y + 4);
        });
        ctx.restore();
      },
    }],
  });
  chart.$absoluteChanges = changes;
}

function itemCell(item) {
  if (!item) return `<span class="muted">—</span>`;
  const tier = item.tier ? `<span class="tier">${item.tier}</span>` : "";
  return `<a href="${itemUrl(item.item_id)}" target="_blank" rel="noopener">${item.name}</a>${tier}`;
}

function renderSlots(baseLoadout, otherLoadout, baseLabel, otherLabel) {
  els.slots.innerHTML = `
    <div class="slot-row" style="background:transparent;padding:0 0.65rem">
      <div class="slot-name">Slot</div>
      <div class="muted">${baseLabel}</div>
      <div class="muted">${otherLabel}</div>
    </div>`;
  for (const slot of SCORED_SLOTS) {
    const a = baseLoadout[slot];
    const b = otherLoadout[slot];
    if (!a && !b) continue;
    const row = document.createElement("div");
    row.className = "slot-row";
    row.innerHTML = `
      <div class="slot-name">${slot}</div>
      <div>${itemCell(a)}</div>
      <div>${itemCell(b)}</div>`;
    els.slots.appendChild(row);
  }
}

async function refresh() {
  if (!ready) return;
  const classAbbr = els.class.value;
  const mode = els.mode.value;
  const [baseCode, otherCode] = orderedPair(els.expA.value, els.expB.value);
  const baseExp = EXPANSIONS.find((e) => e.code === baseCode);
  const otherExp = EXPANSIONS.find((e) => e.code === otherCode);

  const [baseCat, otherCat] = await Promise.all([
    loadCatalog(baseCode),
    loadCatalog(otherCode),
  ]);

  const warnings = [];
  if (!baseCat.items.length) {
    warnings.push(`${baseExp.abbr} has no catalog data yet${baseCat.warning ? ` (${baseCat.warning})` : ""}.`);
  }
  if (!otherCat.items.length) {
    warnings.push(`${otherExp.abbr} has no catalog data yet${otherCat.warning ? ` (${otherCat.warning})` : ""}.`);
  }
  if (warnings.length) {
    els.banner.classList.remove("hidden");
    els.banner.textContent = warnings.join(" ");
  } else {
    els.banner.classList.add("hidden");
  }

  document.getElementById("baseCol").textContent = baseExp.abbr;
  document.getElementById("otherCol").textContent = otherExp.abbr;

  const baseLoadout = buildIdealLoadout(baseCat.items, classAbbr, mode);
  const otherLoadout = buildIdealLoadout(otherCat.items, classAbbr, mode);
  const baseTotals = sumLoadoutStats(baseLoadout);
  const otherTotals = sumLoadoutStats(otherLoadout);
  const keys = [...POOL_STATS, ...HEROIC_STATS, ...SECONDARY_STATS];
  const rows = compareTotals(baseTotals, otherTotals, keys);

  renderTotals(rows);
  renderChart(rows);
  renderSlots(baseLoadout, otherLoadout, baseExp.abbr, otherExp.abbr);
}

async function init() {
  fillSelects();
  await loadWeightTables();
  ready = true;
  for (const el of [els.class, els.expA, els.expB, els.mode]) {
    el.addEventListener("change", () => { refresh().catch(console.error); });
  }
  await refresh();
}

init().catch((err) => {
  console.error(err);
  els.banner.classList.remove("hidden");
  els.banner.textContent = `Failed to start: ${err.message || err}`;
});
