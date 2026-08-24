// ============================================================
// components/pages/financials.js — Financials Report (SPA component)
//
// Board/admin only. Reproduces the KT Financials v7 Power BI model from the
// InternalTools eSoft datamart via TaskManager /api/reports/financials/*.
// Mounts into: #section-financials
//
// Tabs: Revenue (verified) · Budget vs Actual · Recoverability · Debtors.
// The latter three are flagged PROVISIONAL — their datamart reconciliation
// against the .pbix is still in progress (see financials/BUILD_PROGRESS.md).
// ============================================================

import { escapeHtml } from "../../utils/dom.js?v=2";
import { TM_BASE, getCurrentUser } from "../../js/auth.js";

const SECTION_ID = "section-financials";
const PROVISIONAL = new Set(["recoverability", "debtors"]);

// ---- State --------------------------------------------------

let currentTab = "overview";
let currentYear = new Date().getFullYear();
let currentCompany = "";        // "" = all companies
let currentDept = "";           // "" = all departments (Power-BI-style cross-filter)
let yearsLoaded = false;
const charts = {};              // id -> Chart instance (destroyed before re-render)

// ---- Page visibility ----------------------------------------

function showPage() {
  // Hide every sibling overlay so only Financials is visible.
  [
    "fees", "aml", "staff", "kb", "projects", "valuation",
    "companies", "tbratio", "performance", "budgetkpi", "forms",
  ].forEach(k => window["__hub_" + k]?.hide?.());
  window.__hub_reader?.goHome?.();

  const main = document.querySelector(".main");
  if (main) main.classList.add("financials-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "financials" } }));
  if (!yearsLoaded) loadAndRender();
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("financials-active");
}

// Registered in init() after the feature check — no-op for users without "financials".
window.__hub_financials = { show: () => {}, hide: () => {} };

// ---- Chart.js (lazy-loaded; bundled at /vendor) -------------

let chartPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}
function ensureChart() {
  if (window.__finChartReady) return Promise.resolve(window.Chart);
  if (!chartPromise) {
    // Resolve relative to THIS module (works under /hub/ in dev and / in prod) —
    // an absolute "/vendor/..." misses the dev /hub mount and 500s.
    const chartUrl = new URL("../../vendor/chart.umd.min.js", import.meta.url).href;
    const dlUrl = new URL("../../vendor/chartjs-plugin-datalabels.min.js", import.meta.url).href;
    chartPromise = loadScript(chartUrl)
      .then(() => loadScript(dlUrl).catch(() => {}))
      .then(() => {
        if (window.ChartDataLabels) window.Chart.register(window.ChartDataLabels);
        // off by default; enabled per-chart where PBI-style value labels are wanted
        window.Chart.defaults.set("plugins.datalabels", { display: false });
        window.__finChartReady = true;
        return window.Chart;
      });
  }
  return chartPromise;
}

const ACCENT = "#2f9e7e";      // hub green (matches the PBI theme)
const ACCENT_LT = "#8fd3bd";

async function drawChart(canvasId, config) {
  const Chart = await ensureChart();
  const el = document.getElementById(canvasId);
  if (!el) return;
  charts[canvasId]?.destroy();
  charts[canvasId] = new Chart(el.getContext("2d"), config);
}

// ---- Init ---------------------------------------------------

export default async function init() {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  // Financials is gated by the "financials" feature (FULL + SUPER) — redirect others home.
  if (!getCurrentUser()?.features?.includes("financials")) {
    window.__hub_router?.navigate("/");
    return;
  }

  window.__hub_financials = { show: showPage, hide: hidePage };

  section.innerHTML = `
    <div class="fin-page">
      <div class="fin-header">
        <div class="fin-header-left">
          <button class="fin-back-btn" id="fin-back-btn" title="Back to home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h2>Financials</h2>
            <p id="fin-subtitle">Revenue, budget, recoverability &amp; debtors</p>
          </div>
        </div>
        <div class="fin-controls">
          <select id="fin-year" class="fin-select" title="Year"></select>
          <select id="fin-company" class="fin-select" title="Company"></select>
        </div>
      </div>

      <div class="fin-tabs" role="tablist">
        <button class="fin-tab active" data-tab="overview">Overview</button>
        <button class="fin-tab" data-tab="revenue">Revenue</button>
        <button class="fin-tab" data-tab="budget">Budget vs Actual</button>
        <button class="fin-tab" data-tab="recoverability">Recoverability</button>
        <button class="fin-tab" data-tab="debtors">Debtors</button>
      </div>

      <div id="fin-content"></div>
    </div>`;

  document.getElementById("fin-back-btn")?.addEventListener("click", () => {
    hidePage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Tab switching
  section.querySelectorAll(".fin-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      section.querySelectorAll(".fin-tab").forEach(b => b.classList.toggle("active", b === btn));
      renderTab();
    });
  });

  // Slicers
  document.getElementById("fin-year")?.addEventListener("change", e => {
    currentYear = parseInt(e.target.value);
    renderTab();
  });
  document.getElementById("fin-company")?.addEventListener("change", e => {
    currentCompany = e.target.value || "";
    renderTab();
  });

  // Leave Financials when any other sidebar/mobile nav item is clicked.
  ["sidebar", "mobile-nav"].forEach(navId => {
    document.getElementById(navId)?.addEventListener("click", e => {
      const item = e.target.closest(".nav-item");
      if (item && item.id !== "sb-financials" && item.id !== "mb-financials") hidePage();
    });
  });
}

// ---- API ----------------------------------------------------

async function apiFetch(path) {
  const res = await fetch(`${TM_BASE}${path}`, {
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (res.status === 401) {
    sessionStorage.setItem("hub_pre_login_url", window.location.href);
    window.location.href = "/login.html";
    throw new Error("Redirecting to login");
  }
  if (res.status === 403) throw new Error("FORBIDDEN");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function qs() {
  let s = `?year=${currentYear}`;
  if (currentCompany) s += `&company=${encodeURIComponent(currentCompany)}`;
  if (currentDept) s += `&department=${encodeURIComponent(currentDept)}`;
  return s;
}

// ---- Format helpers -----------------------------------------

const eur = n => (Number(n) || 0).toLocaleString("en-GB", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0,
});
const eur2 = n => (Number(n) || 0).toLocaleString("en-GB", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PALETTE = ["#2f9e7e", "#1f6f59", "#8fd3bd", "#3aa6b9", "#5bc0a6", "#26505f", "#a7d676", "#d9b44a", "#e08a5b", "#94a3b8"];

// Firm-wide caution banner — shown on every Financials tab (temporary, while all
// sections are under review). Previously scoped to the PROVISIONAL tabs only; the
// `tab` argument is retained for call-site compatibility but no longer gates display.
function provisionalBanner(tab) {
  return `<div class="fin-provisional">⚠️ These figures are under review and may not be final. Do not use for external reporting.</div>`;
}

// ---- Load slicers + first render ----------------------------

async function loadAndRender() {
  setLoading();
  let data;
  try {
    data = await apiFetch(`/api/reports/financials/revenue${qs()}`);
  } catch (err) {
    setError(err.message);
    return;
  }
  // Populate year + company slicers from the revenue payload (once).
  if (!yearsLoaded) {
    const ySel = document.getElementById("fin-year");
    const years = (data.byYear || []).map(r => r.year).sort((a, b) => b - a);
    if (years.length && ySel) {
      ySel.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? "selected" : ""}>${y}</option>`).join("");
      if (!years.includes(currentYear)) { currentYear = years[0]; ySel.value = currentYear; }
    }
    const cSel = document.getElementById("fin-company");
    if (cSel) {
      cSel.innerHTML = `<option value="">All companies</option>` +
        (data.companies || []).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }
    yearsLoaded = true;
  }
  renderTab();
}

// ---- Tab dispatch -------------------------------------------

async function renderTab() {
  setLoading();
  try {
    if (currentTab === "overview") {
      await renderOverview();
    } else if (currentTab === "revenue") {
      renderRevenue(await apiFetch(`/api/reports/financials/revenue${qs()}`));
    } else if (currentTab === "budget") {
      renderBudget(await apiFetch(`/api/reports/financials/budget-vs-actual${qs()}`));
    } else if (currentTab === "recoverability") {
      renderRecoverability(await apiFetch(`/api/reports/financials/recoverability${qs()}&top=10`));
    } else if (currentTab === "debtors") {
      renderDebtors(await apiFetch(`/api/reports/financials/debtors${qs()}&top=20`));
    }
  } catch (err) {
    setError(err.message);
  }
}

// ---- Render: Overview dashboard -----------------------------

async function renderOverview() {
  // Two revenue reads: revAll (no dept filter) drives the department doughnut/slicer so you
  // can always pick another; revF is the cross-filtered slice driving KPIs / month / clients.
  const baseQs = `?year=${currentYear}${currentCompany ? "&company=" + encodeURIComponent(currentCompany) : ""}`;
  const revAll = await apiFetch(`/api/reports/financials/revenue${baseQs}`);
  const revF = currentDept ? await apiFetch(`/api/reports/financials/revenue${qs()}`) : revAll;
  const [bud, deb, cash] = await Promise.all([
    apiFetch(`/api/reports/financials/budget-vs-actual${baseQs}`),
    apiFetch(`/api/reports/financials/debtors${baseQs}&top=5`),
    apiFetch(`/api/reports/financials/invoiced-receipts${baseQs}`),
  ]);

  const byYear = [...(revF.byYear || [])].sort((a, b) => a.year - b.year);
  const idx = byYear.findIndex(r => Number(r.year) === Number(currentYear));
  const prevNet = idx > 0 ? Number(byYear[idx - 1].net) : null;
  const curNet = Number(revF.totalNet);
  const yoy = (prevNet && prevNet !== 0) ? ((curNet - prevNet) / Math.abs(prevNet)) * 100 : null;
  const achievement = bud.totalBudget ? (bud.totalActual / bud.totalBudget) * 100 : null;
  const yoyBadge = (yoy == null) ? ""
    : `<span class="fin-delta ${yoy >= 0 ? "pos" : "neg"}">${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy).toFixed(1)}% vs ${byYear[idx - 1].year}</span>`;

  const depts = [...(revAll.byDepartment || [])].filter(r => Number(r.net) > 0).slice(0, 10);
  const selName = currentDept
    ? ((revAll.byDepartment || []).find(r => r.code === currentDept)?.name || currentDept)
    : "";
  const chip = currentDept
    ? `<div class="fin-filters">Filtered: <span class="fin-chip">${escapeHtml(selName)}<button id="fin-clear" title="Clear filter">✕</button></span></div>`
    : "";

  const el = document.getElementById("fin-content");
  if (!el) return;
  el.innerHTML = `
    ${provisionalBanner("overview")}
    ${chip}
    <div class="fin-kpis">
      <div class="fin-kpi"><span class="fin-kpi-label">Net revenue ${currentYear}${currentDept ? " · " + escapeHtml(selName) : ""}</span><span class="fin-kpi-value">${eur(curNet)}</span>${yoyBadge}</div>
      <div class="fin-kpi"><span class="fin-kpi-label">Budget achieved (firm)</span><span class="fin-kpi-value">${achievement != null ? achievement.toFixed(0) + "%" : "—"}</span><span class="fin-kpi-sub">${eur(bud.totalActual)} of ${eur(bud.totalBudget)}</span></div>
      <div class="fin-kpi"><span class="fin-kpi-label">Outstanding debtors (firm)</span><span class="fin-kpi-value">${eur(deb.totalOutstanding)}</span></div>
      <div class="fin-kpi"><span class="fin-kpi-label">Departments billing</span><span class="fin-kpi-value">${depts.length}</span></div>
    </div>
    <div class="fin-grid">
      <div class="fin-card"><h3>Revenue trend <span class="fin-hint">(click a year)</span></h3><div class="fin-chart-wrap"><canvas id="ov-year"></canvas></div></div>
      <div class="fin-card"><h3>Revenue by month — ${currentYear}</h3><div class="fin-chart-wrap"><canvas id="ov-month"></canvas></div></div>
      <div class="fin-card"><h3>Revenue by department <span class="fin-hint">(click to filter)</span></h3><div class="fin-chart-wrap"><canvas id="ov-dept"></canvas></div></div>
      <div class="fin-card"><h3>Budget vs Actual — top departments</h3><div class="fin-chart-wrap"><canvas id="ov-budget"></canvas></div></div>
      <div class="fin-card"><h3>Invoiced vs Receipts by month — ${currentYear}</h3><div class="fin-chart-wrap"><canvas id="ov-cashflow"></canvas></div></div>
      <div class="fin-card"><h3>Top clients — ${currentYear}${currentDept ? " · " + escapeHtml(selName) : ""}</h3>
        <table class="fin-table"><thead><tr><th>Client</th><th class="num">Net</th></tr></thead>
          <tbody>${(revF.topClients || []).slice(0, 5).map(c => `<tr><td>${escapeHtml(c.client || "")}</td><td class="num">${eur(c.net)}</td></tr>`).join("")}</tbody></table></div>
    </div>`;

  document.getElementById("fin-clear")?.addEventListener("click", () => { currentDept = ""; renderTab(); });

  // Revenue trend — click a bar to jump to that year
  const yCfg = barConfig(byYear.map(r => r.year), byYear.map(r => Number(r.net)), "Net revenue");
  yCfg.options.onClick = (evt, els) => {
    if (els && els.length) { currentYear = Number(byYear[els[0].index].year); const s = document.getElementById("fin-year"); if (s) s.value = currentYear; renderTab(); }
  };
  drawChart("ov-year", yCfg);

  // Monthly line
  const months = Array(12).fill(0);
  (revF.byMonth || []).forEach(m => { if (m.month >= 1 && m.month <= 12) months[m.month - 1] = Number(m.net); });
  drawChart("ov-month", lineConfig(MONTHS, months, "Net revenue"));

  // Department doughnut — click a slice to cross-filter (click the same one again to clear)
  const dCfg = doughnutConfig(depts.map(r => r.name || r.code || "Unmapped"), depts.map(r => Number(r.net)));
  dCfg.options.onClick = (evt, els) => {
    if (els && els.length) { const d = depts[els[0].index]; if (d) { currentDept = (currentDept === d.code) ? "" : d.code; renderTab(); } }
  };
  drawChart("ov-dept", dCfg);

  // Budget vs Actual (firm-wide, top departments)
  const bd = (bud.byDirector || []).slice(0, 6);
  drawChart("ov-budget", {
    type: "bar",
    data: {
      labels: bd.map(r => r.name || r.code),
      datasets: [
        { label: "Budget", data: bd.map(r => Number(r.budget)), backgroundColor: "#94a3b8", borderRadius: 4 },
        { label: "Actual", data: bd.map(r => Number(r.actual)), backgroundColor: "#2563eb", borderRadius: 4 },
      ],
    },
    options: baseOptions(true),
  });

  // Invoiced vs Receipts by month
  const cm = cash.months || [];
  drawChart("ov-cashflow", {
    type: "bar",
    data: {
      labels: cm.map(m => MONTHS[m.month - 1] || m.month),
      datasets: [
        { label: "Invoiced", data: cm.map(m => Number(m.invoiced)), backgroundColor: ACCENT, borderRadius: 4 },
        { label: "Receipts", data: cm.map(m => Number(m.receipts)), backgroundColor: ACCENT_LT, borderRadius: 4 },
      ],
    },
    options: baseOptions(true),
  });
}

// ---- Render: Revenue (verified) -----------------------------

function renderRevenue(d) {
  const el = document.getElementById("fin-content");
  if (!el) return;
  const deptName = r => r.name || (r.code ? `(${r.code})` : "Unmapped");

  el.innerHTML = `
    ${provisionalBanner("revenue")}
    <div class="fin-kpis">
      <div class="fin-kpi"><span class="fin-kpi-label">Net revenue ${currentYear}</span><span class="fin-kpi-value">${eur(d.totalNet)}</span></div>
      <div class="fin-kpi"><span class="fin-kpi-label">Invoiced months</span><span class="fin-kpi-value">${(d.byMonth || []).length}</span></div>
      <div class="fin-kpi"><span class="fin-kpi-label">Engagement leaders</span><span class="fin-kpi-value">${(d.byEl || []).filter(r => Number(r.net) > 0).length}</span></div>
    </div>
    <div class="fin-grid">
      <div class="fin-card"><h3>Revenue by year</h3><div class="fin-chart-wrap"><canvas id="fin-c-year"></canvas></div></div>
      <div class="fin-card"><h3>Revenue by month — ${currentYear}</h3><div class="fin-chart-wrap"><canvas id="fin-c-month"></canvas></div></div>
      <div class="fin-card"><h3>Revenue by department <span class="fin-hint">(click to filter)</span></h3><div class="fin-chart-wrap"><canvas id="fin-c-dept"></canvas></div></div>
      <div class="fin-card"><h3>Revenue by Engagement Leader</h3><div class="fin-chart-wrap"><canvas id="fin-c-el"></canvas></div></div>
      <div class="fin-card fin-card-wide">
        <h3>Top clients — ${currentYear}</h3>
        <table class="fin-table"><thead><tr><th>Client</th><th class="num">Net</th><th class="num">Inv.</th></tr></thead>
          <tbody>${(d.topClients || []).map(c => `<tr><td>${escapeHtml(c.client || "")}</td><td class="num">${eur(c.net)}</td><td class="num">${c.invoices}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <div class="fin-card fin-card-wide">
        <h3>Invoice details — ${currentYear} <span class="fin-hint">(latest 100)</span></h3>
        <div id="fin-invoice-list"><div class="fin-loading">Loading invoices…</div></div>
      </div>
    </div>`;

  const byYear = [...(d.byYear || [])].sort((a, b) => a.year - b.year);
  drawChart("fin-c-year", barConfig(byYear.map(r => r.year), byYear.map(r => Number(r.net)), "Net revenue"));

  const months = Array(12).fill(0);
  (d.byMonth || []).forEach(m => { if (m.month >= 1 && m.month <= 12) months[m.month - 1] = Number(m.net); });
  drawChart("fin-c-month", barConfig(MONTHS, months, "Net revenue"));

  const depts = [...(d.byDepartment || [])].slice(0, 10);
  const dCfg = doughnutConfig(depts.map(deptName), depts.map(r => Number(r.net)));
  dCfg.options.onClick = (evt, els) => {
    if (els && els.length) {
      const dep = depts[els[0].index];
      if (dep) { currentDept = (currentDept === dep.code) ? "" : dep.code; renderTab(); }
    }
  };
  drawChart("fin-c-dept", dCfg);

  const els2 = [...(d.byEl || [])].filter(r => Number(r.net) > 0).slice(0, 15);
  drawChart("fin-c-el", doughnutConfig(els2.map(r => r.name || r.code || "Unmapped"), els2.map(r => Number(r.net))));

  // Load invoice detail table
  loadInvoiceList();
}

// ---- Render: Budget vs Actual (provisional) -----------------

function renderBudget(d) {
  const el = document.getElementById("fin-content");
  if (!el) return;
  const rows = (d.byDirector || []).filter(r => Number(r.budget) || Number(r.actual)).slice(0, 16);
  const nm = r => r.name || (r.code ? `(${r.code})` : "—");

  el.innerHTML = `
    ${provisionalBanner("budget")}
    <div class="fin-kpis">
      <div class="fin-kpi"><span class="fin-kpi-label">Total budget ${currentYear}</span><span class="fin-kpi-value">${eur(d.totalBudget)}</span></div>
      <div class="fin-kpi"><span class="fin-kpi-label">Total actual ${currentYear}</span><span class="fin-kpi-value">${eur(d.totalActual)}</span></div>
    </div>
    <div class="fin-card">
      <h3>Budget vs Actual by Department</h3>
      <div class="fin-chart-wrap tall"><canvas id="fin-c-budget"></canvas></div>
    </div>
    <div class="fin-card">
      <table class="fin-table"><thead><tr><th>Department</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th></tr></thead>
        <tbody>${rows.map(r => {
          const v = Number(r.actual) - Number(r.budget);
          return `<tr><td>${escapeHtml(nm(r))}</td><td class="num">${eur(r.budget)}</td><td class="num">${eur(r.actual)}</td><td class="num ${v >= 0 ? "pos" : "neg"}">${eur(v)}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;

  drawChart("fin-c-budget", groupedBarConfig(rows.map(nm), [
    { label: "Budget", data: rows.map(r => Number(r.budget)), backgroundColor: ACCENT_LT, borderRadius: 4 },
    { label: "Actual", data: rows.map(r => Number(r.actual)), backgroundColor: ACCENT, borderRadius: 4 },
  ]));
}

// ---- Render: Recoverability (provisional) -------------------

function renderRecoverability(d) {
  const el = document.getElementById("fin-content");
  if (!el) return;
  const row = r => `<tr><td>${escapeHtml(r.jobcard || "")}</td><td>${escapeHtml(r.client || "")}</td><td class="num">${eur(r.charged)}</td><td class="num">${eur(r.cost)}</td><td class="num">${r.recoverability != null ? (Number(r.recoverability) * 100).toFixed(0) + "%" : "—"}</td></tr>`;
  el.innerHTML = `
    ${provisionalBanner("recoverability")}
    <div class="fin-grid">
      <div class="fin-card"><h3>Top 10 recoverability — ${currentYear}</h3>
        <table class="fin-table"><thead><tr><th>Job</th><th>Client</th><th class="num">Charged</th><th class="num">Cost</th><th class="num">Rec.</th></tr></thead>
          <tbody>${(d.top || []).map(row).join("")}</tbody></table></div>
      <div class="fin-card"><h3>Bottom 10 recoverability — ${currentYear}</h3>
        <table class="fin-table"><thead><tr><th>Job</th><th>Client</th><th class="num">Charged</th><th class="num">Cost</th><th class="num">Rec.</th></tr></thead>
          <tbody>${(d.bottom || []).map(row).join("")}</tbody></table></div>
    </div>`;
}

// ---- Render: Debtors (provisional) --------------------------

function renderDebtors(d) {
  const el = document.getElementById("fin-content");
  if (!el) return;
  el.innerHTML = `
    ${provisionalBanner("debtors")}
    <div class="fin-kpis">
      <div class="fin-kpi"><span class="fin-kpi-label">Total outstanding</span><span class="fin-kpi-value">${eur(d.totalOutstanding)}</span></div>
      <div class="fin-kpi"><span class="fin-kpi-label">Top debtors shown</span><span class="fin-kpi-value">${(d.topDebtors || []).length}</span></div>
    </div>
    <div class="fin-card">
      <h3>Top debtors</h3>
      <table class="fin-table"><thead><tr><th>#</th><th>Client</th><th class="num">Balance</th></tr></thead>
        <tbody>${(d.topDebtors || []).map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.client || "(" + r.account_seq + ")")}</td><td class="num">${eur2(r.balance)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

// ---- Invoice detail list (loaded on demand) -------------------

async function loadInvoiceList() {
  const container = document.getElementById("fin-invoice-list");
  if (!container) return;
  try {
    const data = await apiFetch(`/api/reports/financials/invoice-list${qs()}&top=100`);
    const rows = data.invoices || [];
    if (!rows.length) {
      container.innerHTML = `<div class="fin-empty">No invoices found.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="fin-table-scroll">
      <table class="fin-table fin-table-compact">
        <thead><tr>
          <th>Doc #</th><th>Date</th><th>Client</th><th>Department</th>
          <th>Engagement Leader</th><th>Type</th>
          <th class="num">Gross</th><th class="num">VAT</th><th class="num">Net</th>
        </tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td class="mono">${escapeHtml(r.docno || "")}</td>
          <td>${r.docdate ? new Date(r.docdate).toLocaleDateString("en-GB") : ""}</td>
          <td>${escapeHtml(r.client || "")}</td>
          <td>${escapeHtml(r.department || r.deptCode || "")}</td>
          <td>${escapeHtml(r.elName || r.elCode || "")}</td>
          <td>${escapeHtml(r.doctype || "")}</td>
          <td class="num">${eur(r.gross)}</td>
          <td class="num">${eur(r.vat)}</td>
          <td class="num">${eur(r.net)}</td>
        </tr>`).join("")}</tbody>
      </table>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="fin-error">Could not load invoices: ${escapeHtml(e.message)}</div>`;
  }
}

// ---- Chart config helpers -----------------------------------

function baseOptions(legend) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: !!legend, position: "bottom" },
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${eur(ctx.parsed.y ?? ctx.parsed)}`,
        },
      },
    },
    scales: { y: { ticks: { callback: v => (Math.abs(v) >= 1000 ? (v / 1000) + "k" : v) } } },
  };
}

function barConfig(labels, data, label) {
  return {
    type: "bar",
    data: { labels, datasets: [{ label, data, backgroundColor: ACCENT, borderRadius: 4 }] },
    options: baseOptions(false),
  };
}

function lineConfig(labels, data, label) {
  return {
    type: "line",
    data: { labels, datasets: [{ label, data, borderColor: ACCENT, backgroundColor: "rgba(47,158,126,0.15)", fill: true, tension: 0.3, pointRadius: 3 }] },
    options: baseOptions(false),
  };
}

function doughnutConfig(labels, data) {
  const total = data.reduce((s, v) => s + (Number(v) || 0), 0);
  return {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "55%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${eur(ctx.parsed)} (${total ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)`,
          },
        },
        // PBI-style % labels on each slice (hidden for tiny slivers)
        datalabels: {
          display: ctx => total && (ctx.dataset.data[ctx.dataIndex] / total) >= 0.04,
          color: "#fff", font: { size: 10, weight: "600" },
          formatter: v => total ? ((v / total) * 100).toFixed(1) + "%" : "",
        },
      },
    },
  };
}

/** Grouped bar with €-value data labels (used for Budget vs Actual per service). */
function groupedBarConfig(labels, datasets) {
  const o = baseOptions(true);
  o.plugins.datalabels = {
    display: ctx => Math.abs(ctx.dataset.data[ctx.dataIndex]) > 0,
    anchor: "end", align: "end", offset: -2, color: "#475569",
    font: { size: 9, weight: "600" }, rotation: -90,
    formatter: v => (Math.abs(v) >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v)),
  };
  return { type: "bar", data: { labels, datasets }, options: o };
}

// ---- State helpers ------------------------------------------

function setLoading() {
  const el = document.getElementById("fin-content");
  if (el) el.innerHTML = `<div class="fin-loading"><div class="spinner"></div>Loading…</div>`;
}

function setError(msg) {
  const el = document.getElementById("fin-content");
  if (!el) return;
  if (msg === "FORBIDDEN") {
    el.innerHTML = `<div class="fin-error">Financials is restricted to board members and admins.</div>`;
  } else {
    el.innerHTML = `<div class="fin-error">Could not load financials data.<br><small>${escapeHtml(msg)}</small></div>`;
  }
}
