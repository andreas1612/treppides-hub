// ============================================================
// components/pages/tbratio.js
// TB Ratio Tool — upload an E-Soft trial balance, map it to a P&L +
// Balance Sheet + financial ratios, review/adjust the mapping, and
// export the statements to .xlsx.
//
// Self-contained like the other hub pages (valuation.js, companies.js):
// the parser, mapper, ratios, bridge and export all live here. The one
// thing kept separate is the EDITABLE MAPPING TABLE — tbratio.config.js —
// so a non-developer can adjust the accounting policy without scrolling
// through this file.
//
// Fully client-side: the TB never leaves the browser. SheetJS (vendored)
// reads the upload and writes the export. Mounts into #section-tbratio,
// toggled by the sidebar via window.__hub_tbratio. Same page-overlay
// pattern as components/pages/valuation.js.
// ============================================================

import { escapeHtml } from "../../utils/dom.js";

const SECTION_ID = "section-tbratio";
const BACK_BTN_ID = "tbratio-back-btn";

// ============================================================
// MAPPING TABLE (inline) — which trial-balance accounts roll up into which
// statement line. Detection is automatic by group code + name keywords; the
// user can still override any account per-upload via the review panel.
//
// Rules are matched FIRST-MATCH-WINS, most specific first. A rule matches
// when ALL its conditions hold:
//   group   — top-level group code "1".."8" (omit = any)
//   type    — normalized Type: Asset/Receivable/Payable/Liability/
//             Expenditure/Income/Capital/Header (string or array; omit = any)
//   name    — keyword test on the account NAME (string substring or /regex/)
//   nameNot — reject if the name matches this
// A target's `sign` controls accumulation: "natural" += net (debit-natured:
// assets, expenses); "invert" += -net (credit-natured: income, liabilities,
// equity, so they read positive).
// ============================================================

const PNL_TARGETS = [
  { id: "revenue",           label: "Revenue",                     section: "Trading",   sign: "invert"  },
  { id: "costOfSales",       label: "Cost of Sales",               section: "Trading",   sign: "natural" },
  { id: "operatingExpenses", label: "Operating Expenses",          section: "Operating", sign: "natural" },
  { id: "depreciation",      label: "Depreciation & Amortisation", section: "Operating", sign: "natural" },
  { id: "tax",               label: "Taxation",                    section: "Tax",       sign: "natural" },
];

const BS_TARGETS = [
  // Fixed assets (group 1)
  { id: "tangibleAssets",    label: "Tangible Assets (net)",      section: "Fixed Assets",          sign: "natural" },
  { id: "intangibleAssets",  label: "Intangible Assets",          section: "Fixed Assets",          sign: "natural" },
  // Current assets (group 2)
  { id: "bank",              label: "Bank & Cash",                section: "Current Assets",        sign: "natural" },
  { id: "tradeDebtors",      label: "Trade Debtors",              section: "Current Assets",        sign: "natural" },
  { id: "stock",             label: "Stock / Inventory",          section: "Current Assets",        sign: "natural" },
  { id: "prepayments",       label: "Prepayments",                section: "Current Assets",        sign: "natural" },
  // Current liabilities (group 3) — credit-natured, shown positive
  { id: "tradeCreditors",    label: "Trade Creditors",            section: "Current Liabilities",   sign: "invert" },
  { id: "shortTermLoans",    label: "Short-term Loans",           section: "Current Liabilities",   sign: "invert" },
  { id: "vatPaye",           label: "VAT / PAYE",                 section: "Current Liabilities",   sign: "invert" },
  { id: "accruals",          label: "Accruals",                   section: "Current Liabilities",   sign: "invert" },
  // Long-term liabilities (may live in group 3 or 4 — see GROUP4_SPLIT)
  { id: "longTermLoans",     label: "Long-term Loans",            section: "Long-term Liabilities", sign: "invert" },
  // Equity (group 4)
  { id: "shareCapital",      label: "Share Capital",              section: "Equity",                sign: "invert" },
  { id: "retainedEarnings",  label: "Retained Earnings",          section: "Equity",                sign: "invert" },
];

// Accounts in group 4 ("Capital Employed") whose NAME matches a keyword here
// are treated as LONG-TERM LIABILITIES (some charts park long-term loans in
// group 4); all other group-4 accounts fall through to the equity rules.
const GROUP4_SPLIT = {
  longTermLiabilityKeywords: [
    "long term loan", "long-term loan", "loan", "borrowing",
    "debenture", "mortgage", "hire purchase", "lease liability",
    "directors loan", "director's loan", "intercompany loan",
  ],
};

// Break D&A onto its own P&L line regardless of which group it sits in.
const DEPRECIATION_KEYWORDS = ["depreciation", "amortisation", "amortization", "depn", "amort"];

const rules = [
  // ---- P&L ----
  { target: "depreciation", name: new RegExp(DEPRECIATION_KEYWORDS.join("|"), "i") },
  { target: "revenue", group: "5" },
  { target: "costOfSales", group: "6" },
  { target: "operatingExpenses", group: "7" },
  { target: "tax", group: "8" },
  // ---- Balance Sheet ----
  { target: "intangibleAssets", group: "1", name: /intangible|goodwill|trademark|patent|software/i },
  { target: "tangibleAssets",   group: "1" },
  { target: "bank",         group: "2", name: /bank|cash|petty cash/i },
  { target: "tradeDebtors", group: "2", type: "Receivable" },
  { target: "tradeDebtors", group: "2", name: /debtor|receivable/i },
  { target: "stock",        group: "2", name: /stock|inventory|wip|work in progress/i },
  { target: "prepayments",  group: "2", name: /prepay|prepaid|deposit/i },
  { target: "tradeDebtors", group: "2" },
  { target: "vatPaye",        group: "3", name: /vat|paye|social insurance|gesy|tax payable/i },
  { target: "accruals",       group: "3", name: /accrual|accrued/i },
  { target: "shortTermLoans", group: "3", name: /loan|overdraft|borrowing/i },
  { target: "tradeCreditors", group: "3", type: "Payable" },
  { target: "tradeCreditors", group: "3", name: /creditor|payable/i },
  { target: "tradeCreditors", group: "3" },
  { target: "shareCapital",     group: "4", name: /share capital|share premium|ordinary shares/i },
  { target: "retainedEarnings", group: "4", name: /retained|reserve|profit and loss|accumulated|p&l/i },
  { target: "retainedEarnings", group: "4" },
];

// Derived P&L figures (formulas next to the mapping they depend on).
// Labels/structure mirror the firm's Excel P&L:
//   Gross Profit = Revenue − Cost of Sales
//   Operating Profit (EBIT) = Gross Profit − Total Operating Expenses (excl. D&A)
//   EBITDA = Operating Profit (EBIT) − Depreciation & Amortization  (per the firm's sheet)
//   Net Profit = Operating Profit (EBIT) − D&A − Tax
const derived = {
  grossProfit: (t) => num(t.revenue) - num(t.costOfSales),
  operatingProfit: (t) => derived.grossProfit(t) - num(t.operatingExpenses),
  ebitda: (t) => derived.operatingProfit(t) - num(t.depreciation),
  netProfit: (t) => derived.operatingProfit(t) - num(t.depreciation) - num(t.tax),
};

export const DEFAULT_MAPPING = {
  pnlTargets: PNL_TARGETS,
  bsTargets: BS_TARGETS,
  rules,
  derived,
  group4Split: GROUP4_SPLIT,
  depreciationKeywords: DEPRECIATION_KEYWORDS,
};

function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

// Vendored libs — LAN browsers cannot reach a CDN. Lazy-loaded on first page
// open so the hub homepage isn't slowed for users who never open this tool
// (same approach as valuation.js). SheetJS = read/write xlsx; Chart.js = the
// Profitability Ratios bar chart; jsPDF + html2canvas = the PDF export.
const VENDOR_SCRIPTS = [
  "vendor/xlsx.full.min.js",
  "vendor/chart.umd.min.js",
  "vendor/jspdf.umd.min.js",
  "vendor/html2canvas.min.js",
];

const EPSILON = 0.01; // currency rounding tolerance for balance checks

// ============================================================
// PART 1 — PARSER  (E-Soft trial-balance sheet → posting rows)
//
// The E-Soft export is a formatted sheet, not a clean table: metadata
// rows on top, a header row with Code / Name / Type + three Debit/Credit
// pairs (Opening, Period Movement, Closing), hierarchical accounts keyed
// by a 1-digit group code, and roll-up rows. We locate the table by its
// header, resolve columns by header text (not fixed index), skip blank +
// roll-up rows, and derive figures from posting rows only.
// ============================================================

// Code (1 digit) -> canonical top-level group name.
export const TOP_LEVEL_GROUPS = {
  "1": "FIXED ASSETS",
  "2": "CURRENT ASSETS",
  "3": "CURRENT LIABILITIES",
  "4": "CAPITAL EMPLOYED",
  "5": "INCOME",
  "6": "COSTS",
  "7": "EXPENSES",
  "8": "TAXATION",
};

// Roll-up / total rows — captured for validation, never mapped.
const ROLLUP_PATTERNS = [
  /second\s*level\s*sub\s*total/i,
  /second\s*level\s*balance/i,
  /first\s*level\s*sub\s*total/i,
  /first\s*level\s*balance/i,
  /report\s*total/i,
  /report\s*balance/i,
  /number\s*of\s*records/i,
  /grand\s*total/i,
];

// Header-cell synonyms used to locate the header row + resolve columns.
const HEADER_SYNONYMS = {
  co:    ["co", "company", "cmp"],
  code:  ["code", "account code", "acc code", "a/c code", "account"],
  name:  ["name", "description", "account name", "narrative"],
  type:  ["type", "nature", "account type"],
  debit:  ["debit", "dr", "dr.", "debit balance"],
  credit: ["credit", "cr", "cr.", "credit balance"],
};

// The three Debit/Credit pairs, left to right.
const PAIR_ORDER = ["opening", "movement", "closing"];

export class ParseError extends Error {
  constructor(message) { super(message); this.name = "ParseError"; }
}

/**
 * Parse an E-Soft trial-balance sheet (array-of-arrays of cells).
 * @returns {{meta, rows, rollups, headerRowIndex, columns}}
 */
export function parseTrialBalance(aoa) {
  if (!Array.isArray(aoa) || aoa.length === 0) {
    throw new ParseError("Empty sheet: no rows found.");
  }

  const headerRowIndex = findHeaderRow(aoa);
  if (headerRowIndex === -1) {
    throw new ParseError(
      "Could not locate the data table: no header row containing Code, Name and Type was found."
    );
  }

  const columns = resolveColumns(aoa[headerRowIndex]);
  const meta = extractMeta(aoa, headerRowIndex);

  const rows = [];
  const rollups = [];
  let currentGroupCode = null;
  let currentGroupName = null;

  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const raw = aoa[r] || [];
    if (isBlankRow(raw)) continue;

    const code = cellStr(raw[columns.code]);
    const name = cellStr(raw[columns.name]);
    const type = cellStr(raw[columns.type]);

    if (isRollupRow(code, name)) {
      rollups.push({
        rowIndex: r,
        label: name || code,
        opening:  readPair(raw, columns, "opening"),
        movement: readPair(raw, columns, "movement"),
        closing:  readPair(raw, columns, "closing"),
      });
      continue;
    }

    // Top-level group header: a 1-digit code sets the group context but is not
    // itself a posting row.
    if (isTopLevelCode(code)) {
      currentGroupCode = code;
      currentGroupName = TOP_LEVEL_GROUPS[code] || name || `GROUP ${code}`;
      continue;
    }

    // Only rows with a populated Code column are postings. This keeps metadata
    // rows (company name, report titles, page numbers, blank-code lines) out of
    // the tool — they have no Code.
    if (!code) continue;

    // Ignore any row explicitly typed as a group/section header (Type = "Header"),
    // even if it carries a code — these are sub-group headings, not accounts.
    if (normalizeType(type) === "Header") continue;

    const opening  = readPair(raw, columns, "opening");
    const movement = readPair(raw, columns, "movement");
    const closing  = readPair(raw, columns, "closing");

    rows.push({
      rowIndex: r,
      co: cellStr(raw[columns.co]),
      code,
      name,
      type: normalizeType(type),
      rawType: type,
      groupCode: currentGroupCode,
      groupName: currentGroupName,
      opening, movement, closing,
      // Signed nets: Debit positive, Credit negative.
      openingNet:  netOf(opening),
      movementNet: netOf(movement),
      closingNet:  netOf(closing),
    });
  }

  // hasOpening drives comparative handling: if every opening balance is
  // zero/absent, this is a first-period export — never fabricate a prior year.
  meta.hasOpening = rows.some(row => Math.abs(row.openingNet) > 0.005);

  return { meta, rows, rollups, headerRowIndex, columns };
}

function findHeaderRow(aoa) {
  for (let r = 0; r < aoa.length; r++) {
    const cells = (aoa[r] || []).map(c => cellStr(c).toLowerCase());
    const hasCode = cells.some(c => matchesAny(c, HEADER_SYNONYMS.code));
    const hasName = cells.some(c => matchesAny(c, HEADER_SYNONYMS.name));
    const hasType = cells.some(c => matchesAny(c, HEADER_SYNONYMS.type));
    if (hasCode && hasName && hasType) return r;
  }
  return -1;
}

function resolveColumns(headerRow) {
  const cells = (headerRow || []).map(c => cellStr(c).toLowerCase());
  const findCol = (syns) => cells.findIndex(c => matchesAny(c, syns));

  const cols = {
    co:   findCol(HEADER_SYNONYMS.co),
    code: findCol(HEADER_SYNONYMS.code),
    name: findCol(HEADER_SYNONYMS.name),
    type: findCol(HEADER_SYNONYMS.type),
  };

  const debitCols = [];
  const creditCols = [];
  cells.forEach((c, i) => {
    if (matchesAny(c, HEADER_SYNONYMS.debit)) debitCols.push(i);
    else if (matchesAny(c, HEADER_SYNONYMS.credit)) creditCols.push(i);
  });

  cols.pairs = {};
  for (let p = 0; p < PAIR_ORDER.length; p++) {
    cols.pairs[PAIR_ORDER[p]] = {
      debit:  debitCols[p]  ?? -1,
      credit: creditCols[p] ?? -1,
    };
  }

  // Fallback: infer six numeric columns to the right of Type if Debit/Credit
  // headers weren't found by name.
  const anyPairFound = PAIR_ORDER.some(
    k => cols.pairs[k].debit >= 0 || cols.pairs[k].credit >= 0
  );
  if (!anyPairFound) {
    const start = Math.max(cols.type, cols.name, cols.code) + 1;
    for (let p = 0; p < PAIR_ORDER.length; p++) {
      cols.pairs[PAIR_ORDER[p]] = { debit: start + p * 2, credit: start + p * 2 + 1 };
    }
  }

  return cols;
}

function extractMeta(aoa, headerRowIndex) {
  const meta = { company: null, periodLabel: null, startYear: null, endYear: null, hasOpening: false };

  for (let r = 0; r < headerRowIndex; r++) {
    const joined = (aoa[r] || []).map(cellStr).filter(Boolean).join(" ").trim();
    if (!joined) continue;

    const period = joined.match(
      /(\d{1,2})\s*[\/.-]\s*(\d{4})\s*(?:-|to|–|—)\s*(\d{1,2})\s*[\/.-]\s*(\d{4})/i
    );
    if (period && !meta.periodLabel) {
      meta.periodLabel = period[0].trim();
      meta.startYear = parseInt(period[2], 10);
      meta.endYear = parseInt(period[4], 10);
      continue;
    }

    if (!meta.company && looksLikeCompanyName(joined)) {
      meta.company = joined;
    }
  }

  return meta;
}

// Metadata-label words that appear on header/footer rows of an E-Soft export
// (NOT the company name). A row mentioning any of these is skipped.
const META_LABELS = /\b(trial\s*balance|period|date|time|printed|report|page|prepared|as\s*at|currency|account|balance\s*sheet|profit|company\s*no|reg(?:istration)?\s*no|vat\s*no)\b/i;

/**
 * Heuristic: is this metadata row the COMPANY NAME (vs a "Time:"/timestamp/page
 * row)? The company line is free text that isn't a known metadata label and
 * isn't dominated by digits (E-Soft timestamps come through as decimals like
 * "0.5423611", and dates/page numbers are mostly numeric).
 */
function looksLikeCompanyName(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (META_LABELS.test(t)) return false;
  // Reject a "Label: value" metadata pair (e.g. "Time: 0.54", "Report No: 12").
  if (/^[A-Za-z][\w\s./-]{0,20}:\s*\S/.test(t)) return false;
  // Reject rows that are mostly digits/punctuation (timestamps, dates, page nums).
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const digits  = (t.match(/\d/g) || []).length;
  if (letters < 3) return false;          // needs real words
  if (digits > letters) return false;     // numeric-dominant → not a name
  return true;
}

function isBlankRow(raw) { return !raw || raw.every(c => cellStr(c) === ""); }
function isTopLevelCode(code) { return /^[1-8]$/.test(code); }
function isRollupRow(code, name) {
  const probe = `${name} ${code}`.trim();
  return ROLLUP_PATTERNS.some(re => re.test(probe));
}

function cellStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function matchesAny(cell, synonyms) {
  const c = cell.replace(/\s+/g, " ").trim();
  if (!c) return false;
  return synonyms.some(s => c === s || c.startsWith(s + " ") || c.endsWith(" " + s) || c.includes(" " + s + " "));
}

/** Parse a numeric cell: blanks/dashes→0, strip separators, parens=negative, CR/DR suffix. */
export function parseNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;

  let s = String(v).trim();
  if (s === "" || s === "-" || s === "–" || s === "—") return 0;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/cr$/i.test(s)) { negative = true; s = s.replace(/cr$/i, ""); }
  s = s.replace(/dr$/i, "");
  s = s.replace(/[^\d.\-]/g, "");
  if (s === "" || s === "-" || s === ".") return 0;

  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

function readPair(raw, columns, which) {
  const pair = columns.pairs[which] || { debit: -1, credit: -1 };
  return {
    debit:  pair.debit  >= 0 ? parseNumber(raw[pair.debit])  : 0,
    credit: pair.credit >= 0 ? parseNumber(raw[pair.credit]) : 0,
  };
}

/** Signed net of a {debit, credit} pair: Debit positive, Credit negative. */
export function netOf(pair) { return (pair.debit || 0) - (pair.credit || 0); }

const TYPE_MAP = {
  asset: "Asset", receivable: "Receivable", payable: "Payable",
  liability: "Liability", expenditure: "Expenditure", expense: "Expenditure",
  income: "Income", revenue: "Income", header: "Header",
  capital: "Capital", equity: "Capital",
};

export function normalizeType(type) {
  const key = cellStr(type).toLowerCase();
  if (!key) return "";
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    if (key === k || key.startsWith(k)) return v;
  }
  return cellStr(type);
}

// ============================================================
// PART 2 — MAPPER  (posting rows + config → statements + ratios)
//
// Sign convention: rows carry signed nets (Debit +, Credit −). A target's
// `sign` decides accumulation: "natural" += net (assets/expenses),
// "invert" += -net (income/liabilities/equity).
// ============================================================

/**
 * @param {object} parsed   parser output for the primary TB
 * @param {object} config   mapping config (DEFAULT_MAPPING)
 * @param {object} [opts]   { priorParsed, overrides }
 * @returns {object} model
 */
export function mapAccounts(parsed, config, opts = {}) {
  const { priorParsed = null, overrides = {} } = opts;

  const rows = parsed.rows || [];
  const hasComparative = !!priorParsed || !!parsed.meta?.hasOpening;
  const priorMode = priorParsed ? "secondTb" : (parsed.meta?.hasOpening ? "opening" : "none");

  // 1. Pre-map validation: does the TB balance?
  const tb = validateTrialBalance(rows);

  // 2. Assign every posting row to a target.
  // An override of "__unmapped__" is an EXPLICIT user choice to exclude the row
  // (distinct from no override, which falls back to auto-detection).
  const assignments = [];
  const unmapped = [];
  for (const row of rows) {
    const ov = overrides[row.rowIndex];
    const targetId = ov === "__unmapped__" ? null : (ov || classify(row, config));
    if (!targetId) {
      unmapped.push({
        rowIndex: row.rowIndex, code: row.code, name: row.name,
        type: row.type, groupCode: row.groupCode, closingNet: row.closingNet,
      });
      continue;
    }
    assignments.push({ row, targetId });
  }

  // 3. P&L line totals (period movement). Prior P&L only with a 2nd TB.
  const pnlCurrent = sumByTarget(assignments, config.pnlTargets, r => r.movementNet);
  let pnlPrior = null;
  if (priorMode === "secondTb") {
    pnlPrior = sumByTarget(assignFor(priorParsed.rows || [], config, overrides), config.pnlTargets, r => r.movementNet);
  }

  // 4. Balance Sheet line totals (closing = current; prior per priorMode).
  const bsCurrent = sumByTarget(assignments, config.bsTargets, r => r.closingNet);
  let bsPrior = null;
  if (priorMode === "secondTb") {
    bsPrior = sumByTarget(assignFor(priorParsed.rows || [], config, overrides), config.bsTargets, r => r.closingNet);
  } else if (priorMode === "opening") {
    bsPrior = sumByTarget(assignments, config.bsTargets, r => r.openingNet);
  }

  // 5. Derived P&L figures.
  const derivedCurrent = computeDerived(pnlCurrent, config);
  const derivedPrior = pnlPrior ? computeDerived(pnlPrior, config) : null;

  // 6. The bridge: closing retained earnings = opening RE + net profit,
  //    so total assets = total liabilities + equity by construction.
  applyRetainedEarningsBridge(bsCurrent, derivedCurrent.netProfit, assignments);

  // 7. Build the rendered statement structures.
  const pnl = buildPnl(config, pnlCurrent, pnlPrior, derivedCurrent, derivedPrior);
  const balanceSheet = buildBalanceSheet(config, bsCurrent, bsPrior);

  // 8. Post-map validation: does the balance sheet balance?
  const bs = validateBalanceSheet(balanceSheet);

  const model = {
    pnl, balanceSheet, unmapped,
    assignments: assignments.map(a => ({ rowIndex: a.row.rowIndex, code: a.row.code, name: a.row.name, targetId: a.targetId, closingNet: a.row.closingNet })),
    validation: {
      tbBalanced: tb.balanced, tbDifference: tb.difference, tbDebits: tb.debits, tbCredits: tb.credits,
      bsBalanced: bs.balanced, bsDifference: bs.difference,
    },
    meta: {
      company: parsed.meta?.company || null,
      periodLabel: parsed.meta?.periodLabel || null,
      hasComparative, priorMode,
    },
    // Raw figure sources for the ratio engines (internal). Kept on the model so
    // the ratio functions can derive totals without re-running the mapper.
    __bsCurrent: bsCurrent,
    __bsPrior: bsPrior,
    __pnlCurrent: { pnl: pnlCurrent, derived: derivedCurrent, bs: bsCurrent },
    __pnlPrior: (pnlPrior ? { pnl: pnlPrior, derived: derivedPrior, bs: bsPrior }
                          : (bsPrior ? { pnl: null, derived: null, bs: bsPrior } : null)),
  };

  // 9. P&L ratios (profitability, with Good/Watch/Bad status + comments).
  model.ratios = computePnlRatios(model);
  // 10. Balance Sheet ratios (the firm's 5, with Good/Caution/Bad + commentary).
  model.bsRatios = computeBalanceSheetRatios(model);

  return model;
}

/** Decide a row's target id, or null if nothing matches. First match wins. */
export function classify(row, config) {
  // Group-4 long-term-liability carve-out (before generic group-4 equity rules).
  if (row.groupCode === "4" && config.group4Split) {
    const kws = config.group4Split.longTermLiabilityKeywords || [];
    const name = (row.name || "").toLowerCase();
    if (kws.some(k => name.includes(k.toLowerCase()))) return "longTermLoans";
  }
  for (const rule of config.rules) {
    if (ruleMatches(rule, row)) return rule.target;
  }
  return null;
}

function ruleMatches(rule, row) {
  if (rule.group !== undefined && String(rule.group) !== String(row.groupCode)) return false;
  if (rule.type !== undefined) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some(t => String(t).toLowerCase() === String(row.type).toLowerCase())) return false;
  }
  if (rule.name !== undefined && !keywordMatch(rule.name, row.name)) return false;
  if (rule.nameNot !== undefined && keywordMatch(rule.nameNot, row.name)) return false;
  return true;
}

function keywordMatch(matcher, value) {
  const v = String(value || "");
  if (matcher instanceof RegExp) return matcher.test(v);
  return v.toLowerCase().includes(String(matcher).toLowerCase());
}

function assignFor(rows, config, overrides) {
  const out = [];
  for (const row of rows) {
    const ov = overrides[row.rowIndex];
    if (ov === "__unmapped__") continue; // explicitly excluded by the user
    const targetId = ov || classify(row, config);
    if (targetId) out.push({ row, targetId });
  }
  return out;
}

function sumByTarget(assignments, targets, pick) {
  const signById = Object.fromEntries(targets.map(t => [t.id, t.sign]));
  const totals = Object.fromEntries(targets.map(t => [t.id, 0]));
  for (const { row, targetId } of assignments) {
    if (!(targetId in totals)) continue;
    const net = pick(row);
    totals[targetId] += signById[targetId] === "invert" ? -net : net;
  }
  return totals;
}

function computeDerived(pnlTotals, config) {
  return {
    grossProfit: round(config.derived.grossProfit(pnlTotals)),
    operatingProfit: round(config.derived.operatingProfit(pnlTotals)),
    ebitda: round(config.derived.ebitda(pnlTotals)),
    netProfit: round(config.derived.netProfit(pnlTotals)),
  };
}

/**
 * Make the bridge explicit: closing RE = opening RE + net profit. Net profit
 * is derived from the same posting rows, so this keeps A = L + E.
 */
function applyRetainedEarningsBridge(bsCurrent, netProfit, assignments) {
  let openingRE = 0;
  for (const { row, targetId } of assignments) {
    if (targetId !== "retainedEarnings") continue;
    openingRE += -netOf(row.opening); // invert: equity is credit-natured
  }
  bsCurrent.openingRetainedEarnings = round(openingRE);
  bsCurrent.retainedEarnings = round(openingRE + netProfit);
  bsCurrent.netProfitBridged = round(netProfit);
}

function buildPnl(config, current, prior, derivedCurrent, derivedPrior) {
  const lines = [];
  const get = (totals, id) => (totals ? round(totals[id] ?? 0) : null);

  // Line order + labels mirror the firm's Excel P&L.
  lines.push(line("revenue", "Revenue"));
  lines.push(line("costOfSales", "Cost of Sales"));
  lines.push(derivedLine("grossProfit", "Gross Profit"));
  lines.push(line("operatingExpenses", "Total Operating Expenses"));
  lines.push(derivedLine("operatingProfit", "Operating Profit (EBIT)"));
  lines.push(line("depreciation", "Depreciation and Amortization"));
  lines.push(derivedLine("ebitda", "EBITDA"));
  lines.push(line("tax", "Taxation"));
  lines.push(derivedLine("netProfit", "Net Profit"));

  function line(id, label) {
    const meta = config.pnlTargets.find(t => t.id === id);
    return { id, label: label || meta?.label, section: meta?.section, current: get(current, id), prior: get(prior, id), subtotal: false };
  }
  function derivedLine(id, label) {
    return { id, label, section: "Result", current: derivedCurrent ? round(derivedCurrent[id]) : null, prior: derivedPrior ? round(derivedPrior[id]) : null, subtotal: true };
  }

  return { lines, derived: { current: derivedCurrent, prior: derivedPrior } };
}

function buildBalanceSheet(config, current, prior) {
  const get = (totals, id) => (totals ? round(totals[id] ?? 0) : null);
  const sumSection = (totals, section) =>
    totals === null ? null
      : round(config.bsTargets.filter(t => t.section === section)
          .reduce((s, t) => s + (totals[t.id] ?? 0), 0));

  // Section totals (internal keys, used by ratios + the grand totals).
  const totals = {
    fixedAssets:         { current: sumSection(current, "Fixed Assets"),          prior: sumSection(prior, "Fixed Assets") },
    currentAssets:       { current: sumSection(current, "Current Assets"),        prior: sumSection(prior, "Current Assets") },
    currentLiabilities:  { current: sumSection(current, "Current Liabilities"),   prior: sumSection(prior, "Current Liabilities") },
    longTermLiabilities: { current: sumSection(current, "Long-term Liabilities"), prior: sumSection(prior, "Long-term Liabilities") },
    equity:              { current: sumSection(current, "Equity"),                prior: sumSection(prior, "Equity") },
  };
  totals.totalAssets = {
    current: addN(totals.fixedAssets.current, totals.currentAssets.current),
    prior:   addN(totals.fixedAssets.prior, totals.currentAssets.prior),
  };
  totals.totalLiabilitiesEquity = {
    current: addN(addN(totals.currentLiabilities.current, totals.longTermLiabilities.current), totals.equity.current),
    prior:   addN(addN(totals.currentLiabilities.prior, totals.longTermLiabilities.prior), totals.equity.prior),
  };

  // Ordered render lines, matching the firm's Excel layout: a CAPS section
  // header, its accounts, then a bold TOTAL row — current assets before fixed,
  // then the asset grand total; liabilities, long-term, equity, then the
  // liabilities-and-equity grand total. `kind` drives row styling:
  //   "header"  → section heading      "account" → a posting line
  //   "total"   → section subtotal      "grand"   → grand total
  const lines = [];
  const acct = (section) => config.bsTargets
    .filter(t => t.section === section)
    .map(t => ({ kind: "account", label: t.label, current: get(current, t.id), prior: get(prior, t.id) }));
  const header = (label) => ({ kind: "header", label });
  const total  = (label, key) => ({ kind: "total", label, current: totals[key].current, prior: totals[key].prior });
  const grand  = (label, key) => ({ kind: "grand", label, current: totals[key].current, prior: totals[key].prior });

  // ---- ASSETS ----
  lines.push(header("CURRENT ASSETS"));
  lines.push(...acct("Current Assets"));
  lines.push(total("TOTAL CURRENT ASSETS", "currentAssets"));
  lines.push(header("FIXED ASSETS"));
  lines.push(...acct("Fixed Assets"));
  lines.push(total("TOTAL FIXED ASSETS", "fixedAssets"));
  lines.push(grand("TOTAL ASSETS", "totalAssets"));

  // ---- LIABILITIES AND OWNER'S EQUITY ----
  lines.push(header("LIABILITIES AND OWNER'S EQUITY"));
  lines.push(header("CURRENT LIABILITIES"));
  lines.push(...acct("Current Liabilities"));
  lines.push(total("TOTAL CURRENT LIABILITIES", "currentLiabilities"));
  lines.push(header("LONG TERM LIABILITIES"));
  lines.push(...acct("Long-term Liabilities"));
  lines.push(total("TOTAL LONG TERM LIABILITIES", "longTermLiabilities"));
  lines.push(header("OWNER'S EQUITY"));
  lines.push(...acct("Equity"));
  lines.push(total("TOTAL OWNER'S EQUITY", "equity"));
  lines.push(grand("TOTAL LIABILITIES AND OWNER'S EQUITY", "totalLiabilitiesEquity"));

  return { lines, totals };
}

export function validateTrialBalance(rows) {
  let debits = 0, credits = 0;
  for (const row of rows) {
    debits += row.closing.debit || 0;
    credits += row.closing.credit || 0;
  }
  const difference = round(debits - credits);
  return { balanced: Math.abs(difference) <= EPSILON, difference, debits: round(debits), credits: round(credits) };
}

export function validateBalanceSheet(balanceSheet) {
  const a = balanceSheet.totals.totalAssets.current ?? 0;
  const le = balanceSheet.totals.totalLiabilitiesEquity.current ?? 0;
  const difference = round(a - le);
  return { balanced: Math.abs(difference) <= EPSILON, difference };
}

// ============================================================
// P&L (PROFITABILITY) RATIOS — the firm's 6, each with Year 1 / Year 2 values
// (shown as decimals, e.g. 0.44), a Good/Watch/Bad status, and a comment.
//
// All six use the firm's single margin test:
//   value > 0.35 → Good ;  value >= 0.20 → Watch ;  else → Bad
// (transcribed from the sheet's =IF(B>0.35,"Good",IF(B>=0.2,"Watch","Bad"))).
//
// Comments are keyed on that status, per the firm's IF-formulas:
//   Good / Watch / Bad wording differs per ratio.
//
// Inputs detected from the mapped figures (Revenue, derived profits, Total
// Assets, Equity) — no separate config.
// ============================================================

/** Extract the figures the P&L ratios need from a side ({pnl, derived, bs}). */
function pnlFigures(side) {
  if (!side || !side.pnl || !side.derived) return null;
  const f = bsFigures(side.bs) || { totalAssets: 0, equity: 0 };
  return {
    revenue: num(side.pnl.revenue),
    grossProfit: num(side.derived.grossProfit),
    operatingProfit: num(side.derived.operatingProfit),
    netProfit: num(side.derived.netProfit),
    ebitda: num(side.derived.ebitda),
    totalAssets: f.totalAssets,
    equity: f.equity,
  };
}

const PL_RATIO_DEFS = [
  {
    id: "grossMargin", label: "Gross Profit Margin",
    compute: (f) => safeDiv(f.grossProfit, f.revenue),
    comments: { Good: "Healthy margin", Watch: "Monitor costs", Bad: "Review pricing & supplier costs" },
  },
  {
    id: "operatingMargin", label: "Operating Profit Margin",
    compute: (f) => safeDiv(f.operatingProfit, f.revenue),
    comments: { Good: "Efficient operations", Watch: "Control overheads", Bad: "Check payroll & admin costs" },
  },
  {
    id: "netMargin", label: "Net Profit Margin",
    compute: (f) => safeDiv(f.netProfit, f.revenue),
    comments: { Good: "Strong profitability", Watch: "Watch tax/finance costs", Bad: "Review total cost structure" },
  },
  {
    id: "ebitdaMargin", label: "EBITDA Margin",
    compute: (f) => safeDiv(f.ebitda, f.revenue),
    comments: { Good: "Healthy cash flow", Watch: "Improve efficiency", Bad: "Investigate operating expenses" },
  },
  {
    id: "roa", label: "ROA",
    compute: (f) => safeDiv(f.netProfit, f.totalAssets),
    comments: { Good: "Assets performing well", Watch: "Check asset utilization", Bad: "Identify idle assets" },
  },
  {
    id: "roe", label: "ROE",
    compute: (f) => safeDiv(f.netProfit, f.equity),
    comments: { Good: "Strong return to shareholders", Watch: "Monitor equity returns", Bad: "Review leverage & profitability" },
  },
];

/** The firm's shared P&L status test. Returns "Good" | "Watch" | "Bad" | null. */
function pnlStatus(value) {
  if (value === null || value === undefined || !isFinite(value)) return null;
  if (value > 0.35) return "Good";
  if (value >= 0.20) return "Watch";
  return "Bad";
}

/**
 * Build the rich P&L ratios from a mapped model.
 * @returns Array<{ id, label, current, prior, statusCurrent, statusPrior,
 *                  comment: string }>  (comment reflects the CURRENT-year status)
 */
export function computePnlRatios(model) {
  const curFig = pnlFigures(model.__pnlCurrent);
  const priFig = pnlFigures(model.__pnlPrior); // null unless a 2nd TB gave a prior P&L

  return PL_RATIO_DEFS.map(def => {
    const current = curFig ? round2(def.compute(curFig)) : null;
    const prior = priFig ? round2(def.compute(priFig)) : null;
    const statusCurrent = pnlStatus(current);
    const statusPrior = pnlStatus(prior);
    const comment = statusCurrent ? def.comments[statusCurrent] : "";
    return { id: def.id, label: def.label, current, prior, statusCurrent, statusPrior, comment };
  });
}

// ============================================================
// BALANCE SHEET RATIOS — the 5 ratios from the firm's Excel sheet, each with
// Year 1 / Year 2 values, a Good/Caution/Bad status, and commentary + advice.
//
// Inputs are DETECTED dynamically from the trial balance (the mapped BS line
// totals) — no separate config. The figures each ratio needs:
//   totalAssets        = fixed assets + current assets
//   currentAssets      = bank + tradeDebtors + stock + prepayments
//   currentLiabilities = tradeCreditors + shortTermLoans + vatPaye + accruals
//   equity             = shareCapital + retainedEarnings  (total owner's equity)
//   debt               = longTermLoans + shortTermLoans   (ALL types of loans)
//
// "Debt" means interest-bearing loans, NOT total liabilities — matching the
// firm's Excel formula  Debt-to-Equity = (loans + loans) / total equity.
//
// Each definition carries the thresholds (good/bad tests) and the commentary +
// advice text, transcribed from the firm's "comments" sheet. A value that is
// neither clearly good nor clearly bad is reported as "Caution".
// ============================================================

/** Extract the figures the BS ratios need from a flat bs-totals object. */
function bsFigures(bs) {
  if (!bs) return null;
  const n = (k) => num(bs[k]);
  const currentAssets = n("bank") + n("tradeDebtors") + n("stock") + n("prepayments");
  const currentLiabilities = n("tradeCreditors") + n("shortTermLoans") + n("vatPaye") + n("accruals");
  const fixedAssets = n("tangibleAssets") + n("intangibleAssets");
  const equity = n("shareCapital") + n("retainedEarnings");
  const debt = n("longTermLoans") + n("shortTermLoans");
  return {
    totalAssets: fixedAssets + currentAssets,
    currentAssets, currentLiabilities, equity, debt,
  };
}

const BS_RATIO_DEFS = [
  {
    id: "debtRatio", label: "Debt ratio", format: "ratio",
    compute: (f) => safeDiv(f.debt, f.totalAssets),
    good: (v) => v <= 0.50,
    bad:  (v) => v >= 0.60,
    commentGood: [
      "Indicates the company is financing its assets mainly with equity, not debt.",
      "Lower financial risk and greater stability.",
      "Easier access to new financing.",
    ],
    commentBad: [
      "Shows high reliance on debt.",
      "Higher financial risk and exposure to interest rate increases.",
      "Possible concerns about long-term solvency.",
    ],
    advice: [
      "Reduce unnecessary borrowing.",
      "Improve equity base by retaining profits.",
      "Improve profitability to lower leverage naturally.",
    ],
  },
  {
    id: "currentRatio", label: "Current ratio", format: "ratio",
    compute: (f) => safeDiv(f.currentAssets, f.currentLiabilities),
    good: (v) => v >= 1.5 && v <= 3.0,
    bad:  (v) => v < 1.0 || v > 3.0,
    commentGood: [
      "Strong short-term liquidity.",
      "Company can comfortably cover its short-term obligations.",
      "Working capital is well managed.",
    ],
    commentBad: [
      "Below 1.0: inability to meet short-term obligations → liquidity risk.",
      "Too high (>3): excess idle assets → inefficient use of resources.",
    ],
    advice: [
      "Improve cash collections.",
      "Refinance short-term debt into long-term.",
      "Reduce slow-moving inventory.",
    ],
  },
  {
    id: "workingCapital", label: "Working capital", format: "money",
    compute: (f) => f.currentAssets - f.currentLiabilities,
    good: (v) => v > 0,
    bad:  (v) => v <= 0,
    commentGood: [
      "Indicates the company has enough short-term assets relative to total assets.",
      "Suggests good liquidity and operational flexibility.",
    ],
    commentBad: [
      "Negative working capital means current liabilities exceed current assets.",
      "Signals liquidity pressure and possible inability to fund operations.",
    ],
    advice: [
      "Increase current assets (cash, receivables).",
      "Reduce reliance on short-term liabilities.",
      "Optimize inventory turnover.",
    ],
  },
  {
    id: "assetsToEquity", label: "Assets to Equity", format: "ratio",
    compute: (f) => safeDiv(f.totalAssets, f.equity),
    good: (v) => v >= 1.5 && v <= 2.5,
    bad:  (v) => v > 3.0,
    commentGood: [
      "Balanced use of equity to finance assets.",
      "Indicates moderate leverage levels.",
    ],
    commentBad: [
      "Shows heavy reliance on liabilities to finance assets.",
      "Higher solvency risk and weaker financial stability.",
    ],
    advice: [
      "Increase equity through retained earnings.",
      "Reduce total debt.",
      "Improve asset efficiency (dispose of non-productive assets).",
    ],
  },
  {
    id: "debtToEquity", label: "Debt to Equity ratio", format: "ratio",
    compute: (f) => safeDiv(f.debt, f.equity),
    good: (v) => v < 1.0,
    bad:  (v) => v > 1.5,
    commentGood: [
      "Equity financing is stronger than debt.",
      "Lower financial risk; better positioned to absorb losses.",
    ],
    commentBad: [
      "Company is highly leveraged.",
      "Higher interest cost, higher default risk.",
      "Investors and lenders may perceive the business as risky.",
    ],
    advice: [
      "Pay down debt to reduce leverage.",
      "Convert short-term debt into long-term where possible.",
      "Strengthen equity position through reinvested profits.",
    ],
  },
];

/** Classify a value into Good / Caution / Bad using a definition's tests. */
function ratioStatus(def, value) {
  if (value === null || value === undefined || !isFinite(value)) return null;
  if (def.bad(value)) return "Bad";
  if (def.good(value)) return "Good";
  return "Caution";
}

/**
 * Build the rich Balance Sheet ratios from a mapped model.
 * @returns Array<{ id, label, format, current, prior, statusCurrent, statusPrior,
 *                  comment: string[], advice: string[] }>
 * `comment` reflects the CURRENT-year status (Good→commentGood, else commentBad);
 * Caution shows both so the reviewer sees where it sits.
 */
export function computeBalanceSheetRatios(model) {
  const curFig = bsFigures(model.__bsCurrent);
  const priFig = model.meta.hasComparative ? bsFigures(model.__bsPrior) : null;

  return BS_RATIO_DEFS.map(def => {
    const current = curFig ? round2(def.compute(curFig)) : null;
    const prior = priFig ? round2(def.compute(priFig)) : null;
    const statusCurrent = ratioStatus(def, current);
    const statusPrior = ratioStatus(def, prior);

    let comment;
    if (statusCurrent === "Good") comment = def.commentGood;
    else if (statusCurrent === "Bad") comment = def.commentBad;
    else comment = [...def.commentGood, "—", ...def.commentBad]; // Caution: show both

    return {
      id: def.id, label: def.label, format: def.format,
      current, prior, statusCurrent, statusPrior,
      comment, advice: def.advice,
    };
  });
}

export function safeDiv(numr, denom) {
  if (!denom || Math.abs(denom) < EPSILON) return 0;
  return numr / denom;
}

function addN(a, b) {
  if (a === null && b === null) return null;
  return round((a ?? 0) + (b ?? 0));
}
function round(n)  { return typeof n === "number" && isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function round2(n) { return typeof n === "number" && isFinite(n) ? Math.round(n * 100) / 100 : 0; }

// ============================================================
// PART 3 — EXPORT  (statement model → SheetJS workbook)
// Requires the XLSX global (loaded from vendor/xlsx.full.min.js).
// ============================================================

/**
 * Build TWO sheets as arrays-of-arrays:
 *   profitAndLoss = the P&L statement, then its ratios appended below.
 *   balanceSheet  = the BS statement, then its ratios + comments below.
 * Each statement keeps its own ratios on the same tab.
 */
export function buildSheets(model) {
  const hasPrior = model.meta?.hasComparative && model.balanceSheet.totals.totalAssets.prior !== null;
  const valCols = hasPrior ? ["Current", "Prior"] : ["Current"];
  const cell = (line) => hasPrior ? [line.current, line.prior] : [line.current];
  const SPACER = [[], []]; // two blank rows between a statement and its ratios
  const title = exportTitle(model);

  // ---- Profit & Loss tab: statement + P&L ratios ----
  const pnl = [];
  pnl.push([title]);
  pnl.push([`Profit & Loss${model.meta?.periodLabel ? " — " + model.meta.periodLabel : ""}`]);
  pnl.push([]);
  pnl.push(["Line", ...valCols]);
  for (const line of model.pnl.lines) {
    pnl.push([line.label, ...cell(line)]);
  }
  // P&L ratios appended on the same tab (firm's layout: a Profitability Ratios
  // block Year 1/Year 2, then a Comments block with Status Y1/Y2 columns).
  const statusColsPnl = hasPrior ? ["Status Y1", "Status Y2"] : ["Status Y1"];
  pnl.push(...SPACER);
  pnl.push(["Profitability Ratios", ...valCols]);
  for (const r of (model.ratios || [])) {
    pnl.push([r.label, ...(hasPrior ? [r.current, r.prior] : [r.current])]);
  }
  pnl.push([]);
  pnl.push(["Comments", ...statusColsPnl]);
  for (const r of (model.ratios || [])) {
    pnl.push([r.comment || "",
      ...(hasPrior ? [r.statusCurrent || "", r.statusPrior || ""] : [r.statusCurrent || ""])]);
  }

  // ---- Balance Sheet tab: statement + BS ratios + comments ----
  const bs = [];
  bs.push([title]);
  bs.push(["Balance Sheet"]);
  bs.push([]);
  bs.push(["Line", ...valCols]);
  const t = model.balanceSheet.totals;
  // The ordered lines already carry section headers, per-section TOTAL rows,
  // and the two grand totals (TOTAL ASSETS / TOTAL LIABILITIES AND OWNER'S
  // EQUITY) — emit them as-is. Header rows have no values.
  for (const line of model.balanceSheet.lines) {
    if (line.kind === "header") { bs.push([line.label]); continue; }
    bs.push([line.label, ...cell(line)]);
  }
  bs.push([]);
  bs.push(["Difference (A − L − E)",
    ...(hasPrior
      ? [round(t.totalAssets.current - t.totalLiabilitiesEquity.current),
         round((t.totalAssets.prior ?? 0) - (t.totalLiabilitiesEquity.prior ?? 0))]
      : [round(t.totalAssets.current - t.totalLiabilitiesEquity.current)])]);

  // BS ratios + comments appended on the same tab (firm's Excel layout):
  // a Financial Ratio block (Year 1/Year 2), then a Comments block with
  // Status Y1/Y2 columns + the commentary and advice text.
  const statusCols = hasPrior ? ["Status Y1", "Status Y2"] : ["Status Y1"];
  bs.push(...SPACER);
  bs.push(["Financial Ratio", ...valCols]);
  for (const r of (model.bsRatios || [])) {
    bs.push([r.label, ...(hasPrior ? [r.current, r.prior] : [r.current])]);
  }
  bs.push([]);
  bs.push(["Comments", "", ...statusCols]);
  for (const r of (model.bsRatios || [])) {
    bs.push([r.label, "",
      ...(hasPrior ? [r.statusCurrent || "", r.statusPrior || ""] : [r.statusCurrent || ""])]);
    for (const line of r.comment) {
      if (line === "—") { bs.push([]); continue; }
      bs.push(["  " + line]);
    }
    bs.push(["  Advice:"]);
    for (const a of r.advice) bs.push(["    " + a]);
    bs.push([]);
  }

  return { profitAndLoss: pnl, balanceSheet: bs };
}

/** Build a SheetJS workbook from the model and download it. Two tabs. */
export function exportWorkbook(model, filename) {
  if (typeof XLSX === "undefined") throw new Error("SheetJS (XLSX) is not loaded.");
  const sheets = buildSheets(model);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets.profitAndLoss), "Profit & Loss");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets.balanceSheet), "Balance Sheet");

  XLSX.writeFile(wb, filename || `${safeFileBase(model)}_financial_statements.xlsx`);
}

/** Display title for exports: the uploaded filename (name detection is unreliable). */
function exportTitle(model) {
  return stripExt(state.fileName) || "Financial Statements";
}
/** Filesystem-safe base derived from the export title. */
function safeFileBase(model) {
  return (exportTitle(model) || "statements")
    .replace(/[^\w\d-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "statements";
}
/** Drop a trailing .xlsx/.xls/.csv extension from a filename for display. */
function stripExt(name) {
  return (name || "").replace(/\.(xlsx|xls|csv)$/i, "").trim();
}

// ============================================================
// PART 4 — PAGE / UI
// ============================================================

const state = {
  primary: null,   // parsed primary TB
  prior: null,     // parsed comparative TB (optional)
  model: null,     // last mapAccounts() result
  overrides: {},   // { rowIndex: targetId } user reassignments (current upload)
  fileName: null,
};

// ---- Trial-balance override persistence (localStorage) -------------------
// An auditor re-running the same client each period shouldn't redo every manual
// drag. E-Soft exports DON'T reliably contain a company name, so we DON'T key
// on the name. Instead each TB gets a content FINGERPRINT — a hash of its set
// of account codes (the chart of accounts). The same client's TB has the same
// chart period to period, so the fingerprint is a stable, name-free identity;
// a different client (different codes) gets a different key automatically.
// Overrides themselves are keyed by ACCOUNT CODE (stable across row reordering).
//
// Two safety measures (stored payload is only accountCode→targetLine — no
// amounts/financials — but it lives in shared-origin localStorage):
//   • Key is a HASH (not readable client info) → `tbr_overrides_v1:h<hash>`.
//   • Each entry is STAMPED + EXPIRES after MAX_AGE_DAYS; stale entries are
//     ignored on load and swept from storage.
const OVERRIDES_NS = "tbr_overrides_v1";
const OVERRIDES_MAX_AGE_DAYS = 400;
const OVERRIDES_MAX_AGE_MS = OVERRIDES_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** Small non-cryptographic string hash (FNV-1a), hex string. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Stable, name-free key for a parsed TB: a hash of its sorted DISTINCT account
 * codes (the chart of accounts). Returns null if there are too few codes to
 * form a meaningful identity (don't persist for near-empty sheets).
 */
function tbKey(parsed) {
  const codes = Array.from(new Set(
    (parsed?.rows || []).map(r => String(r.code || "").trim()).filter(Boolean)
  )).sort();
  if (codes.length < 3) return null;
  return `${OVERRIDES_NS}:h${hashStr(codes.join("|"))}`;
}

/** A timestamp source that tolerates the no-Date sandbox used in tests. */
function nowMs() { try { return Date.now(); } catch (_) { return 0; } }

/** Save current overrides as a stamped { savedAt, byCode } record for this company. */
function saveOverrides(parsed) {
  const key = tbKey(parsed);
  if (!key) return;
  // Map the in-memory rowIndex→target overrides to code→target.
  const byCode = {};
  for (const row of parsed.rows || []) {
    const t = state.overrides[row.rowIndex];
    if (t !== undefined && row.code) byCode[row.code] = t;
  }
  try {
    if (Object.keys(byCode).length) {
      localStorage.setItem(key, JSON.stringify({ savedAt: nowMs(), byCode }));
    } else {
      localStorage.removeItem(key);
    }
  } catch (_) { /* storage full / disabled — non-fatal */ }
}

/** Load saved code→target overrides for this company and translate to rowIndex→target. */
function loadOverrides(parsed) {
  purgeExpiredOverrides(); // opportunistic sweep of stale client data
  const key = tbKey(parsed);
  if (!key) return {};
  let rec;
  try { rec = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return {}; }
  if (!rec || typeof rec !== "object") return {};
  // Expired? ignore + remove.
  if (rec.savedAt && nowMs() && (nowMs() - rec.savedAt) > OVERRIDES_MAX_AGE_MS) {
    try { localStorage.removeItem(key); } catch (_) {}
    return {};
  }
  const byCode = rec.byCode && typeof rec.byCode === "object" ? rec.byCode : {};
  const out = {};
  for (const row of parsed.rows || []) {
    if (row.code && Object.prototype.hasOwnProperty.call(byCode, row.code)) {
      out[row.rowIndex] = byCode[row.code];
    }
  }
  return out;
}

/** Remove any tbr override entries older than the max age (best-effort). */
function purgeExpiredOverrides() {
  const now = nowMs();
  if (!now) return;
  let keys;
  try { keys = Object.keys(localStorage); } catch (_) { return; }
  for (const k of keys) {
    if (!k.startsWith(OVERRIDES_NS + ":")) continue;
    try {
      const rec = JSON.parse(localStorage.getItem(k) || "null");
      if (rec && rec.savedAt && (now - rec.savedAt) > OVERRIDES_MAX_AGE_MS) {
        localStorage.removeItem(k);
      }
    } catch (_) { /* corrupt entry — leave it */ }
  }
}

// All mapping target ids/labels, for the reassignment dropdowns.
const ALL_TARGETS = [
  ...DEFAULT_MAPPING.pnlTargets.map(t => ({ id: t.id, label: `P&L · ${t.label}` })),
  ...DEFAULT_MAPPING.bsTargets.map(t => ({ id: t.id, label: `BS · ${t.label}` })),
];

// ---- Page visibility -----------------------------------------

function showPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove(
    "fees-active", "aml-active", "staff-active",
    "kb-active", "projects-active", "valuation-active", "companies-active"
  );
  main.classList.add("tbratio-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "tbratio" } }));
  bootOnce();
}

function hidePage() {
  document.querySelector(".main")?.classList.remove("tbratio-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_tbratio = { show: showPage, hide: hidePage };

// ---- Lazy vendor load ----------------------------------------
let _vendorPromise = null;
function loadVendor() {
  if (_vendorPromise) return _vendorPromise;
  _vendorPromise = Promise.all(VENDOR_SCRIPTS.map(src => new Promise((ok, fail) => {
    if ([...document.scripts].some(s => s.src.endsWith(src))) return ok();
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = ok;
    tag.onerror = () => fail(new Error("Failed to load: " + src));
    document.head.appendChild(tag);
  })));
  return _vendorPromise;
}

let _booted = false;
async function bootOnce() {
  if (_booted) return;
  _booted = true;
  try {
    await loadVendor();
  } catch (err) {
    console.error("TB Ratio Tool: vendor load failed", err);
    _booted = false;
    const status = document.getElementById("tbr-status");
    if (status) status.innerHTML = errorBanner("Could not load the spreadsheet engine. Reload and try again.");
  }
}

// ---- Component init ------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = SHELL_HTML;

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hidePage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  wirePrimaryUpload(section);
}

// ---- Upload wiring -------------------------------------------

/**
 * Wire the PERSISTENT primary upload controls (the drop zone + #tbr-file).
 * These live in the static shell and must be wired exactly ONCE (in init),
 * NOT on every render — re-wiring stacked duplicate listeners, which fired
 * handleFile multiple times per upload and broke re-uploads.
 */
function wirePrimaryUpload(section) {
  const drop = section.querySelector("#tbr-drop");
  const fileInput = section.querySelector("#tbr-file");

  drop?.addEventListener("click", () => fileInput?.click());
  drop?.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover"); });
  drop?.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop?.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("dragover");
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f, "primary");
  });

  fileInput?.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (f) handleFile(f, "primary");
    // Clear so selecting the SAME filename again still fires 'change'.
    e.target.value = "";
  });
}

/**
 * Wire the dynamic "Add comparative TB" input, which is re-created inside
 * #tbr-output on every render — so this must run each render.
 */
function wirePriorUpload(out) {
  const priorInput = out.querySelector("#tbr-file-prior");
  priorInput?.addEventListener("change", e => {
    const f = e.target.files?.[0];
    if (f) handleFile(f, "prior");
    e.target.value = "";
  });
}

// Reject files larger than this before parsing. A normal E-Soft trial balance
// is well under 1 MB; this guards against an oversized/crafted file hanging or
// OOM-ing the user's tab (self-DoS — the file is parsed in-browser).
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

async function handleFile(file, slot) {
  const status = document.getElementById("tbr-status");

  if (file.size > MAX_FILE_BYTES) {
    status.innerHTML = errorBanner(
      `<strong>${escapeHtml(file.name)}</strong> is ${(file.size / (1024 * 1024)).toFixed(1)} MB — too large. ` +
      `Please upload a trial-balance export under ${MAX_FILE_BYTES / (1024 * 1024)} MB.`
    );
    return;
  }

  status.innerHTML = infoBanner(`Reading <strong>${escapeHtml(file.name)}</strong>…`);
  try {
    await loadVendor();
    const aoa = await readSheet(file);
    const parsed = parseTrialBalance(aoa);

    if (slot === "primary") {
      // A new primary book replaces everything from the previous one, but we
      // RESTORE any saved per-company overrides so manual mapping from a prior
      // period for the same client carries over.
      state.primary = parsed;
      state.fileName = file.name;
      state.overrides = loadOverrides(parsed);
      // Count of mappings restored from a previous period (for the notice
      // banner). Cleared once the user starts dragging, so the notice only
      // reflects the initial restore, not subsequent manual edits.
      state.restoredCount = Object.keys(state.overrides).length;
      state.prior = null;
      state.model = null;
      _mapTab = "bs"; // reset the mapping tab to the default
    } else {
      state.prior = parsed;
    }

    runMapping();
  } catch (err) {
    console.error("TB Ratio Tool: parse failed", err);
    const msg = err instanceof ParseError ? err.message : "Could not read this file. Make sure it is an E-Soft trial-balance export (.xlsx or .csv).";
    status.innerHTML = errorBanner(escapeHtml(msg));
  }
}

/** Read a File into an array-of-arrays via SheetJS (xlsx or csv). */
function readSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, raw: true });
        resolve(aoa);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsArrayBuffer(file);
  });
}

// ---- Mapping + render ----------------------------------------

function runMapping() {
  if (!state.primary) return;
  state.model = mapAccounts(state.primary, DEFAULT_MAPPING, {
    priorParsed: state.prior,
    overrides: state.overrides,
  });
  render();
}

function render() {
  const out = document.getElementById("tbr-output");
  const status = document.getElementById("tbr-status");
  const m = state.model;
  if (!m) return;

  const bsActive = _mapTab === "bs";
  status.innerHTML = renderValidation(m);
  out.innerHTML = `
    <div class="tbr-tabs" role="tablist">
      <button class="tbr-map-tab ${bsActive ? "active" : ""}" data-maptab="bs" role="tab">Balance Sheet</button>
      <button class="tbr-map-tab ${bsActive ? "" : "active"}" data-maptab="pnl" role="tab">Profit &amp; Loss</button>
    </div>

    ${renderUnmappedPanel(m)}

    <div id="tbr-statements">
      <section class="tbr-tabpane" data-pane="bs" ${bsActive ? "" : "hidden"}>
        ${renderMappingPanel(m, "bs")}
        <section class="tbr-group">
          <h2 class="tbr-group-title">Balance Sheet</h2>
          ${renderBalanceSheet(m)}
          ${renderBalanceSheetRatios(m)}
        </section>
      </section>

      <section class="tbr-tabpane" data-pane="pnl" ${bsActive ? "hidden" : ""}>
        ${renderMappingPanel(m, "pnl")}
        <section class="tbr-group">
          <h2 class="tbr-group-title">Profit &amp; Loss</h2>
          ${renderStatement("Statement", m.pnl.lines, m)}
          ${renderPnlRatios(m)}
        </section>
      </section>
    </div>

    <div class="tbr-actions">
      <button class="tbr-btn tbr-btn-primary" id="tbr-export">Export to .xlsx</button>
      <button class="tbr-btn tbr-btn-ghost" id="tbr-pdf">Download PDF</button>
      <label class="tbr-btn tbr-btn-ghost">
        Add comparative TB
        <input type="file" id="tbr-file-prior" accept=".xlsx,.xls,.csv" hidden>
      </label>
    </div>
  `;

  wirePriorUpload(out);
  out.querySelector("#tbr-export")?.addEventListener("click", onExport);
  out.querySelector("#tbr-pdf")?.addEventListener("click", onExportPdf);
  wireMappingPanel(out);

  // "Clear saved mappings" link lives in the #tbr-status banner.
  document.getElementById("tbr-clear-overrides")?.addEventListener("click", (e) => {
    e.preventDefault();
    clearSavedOverrides();
  });

  // Profitability bar chart (canvas is in the DOM now that innerHTML is set).
  renderPnlChart(m);
}

/** Wipe this company's saved overrides + current in-memory ones, then re-map fresh. */
function clearSavedOverrides() {
  const key = tbKey(state.primary);
  if (key) { try { localStorage.removeItem(key); } catch (_) {} }
  state.overrides = {};
  state.restoredCount = 0;
  runMapping(); // re-detect everything from scratch
}

/** Wire the tabbed drag-and-drop mapping panel: tab switching + DnD remap. */
function wireMappingPanel(out) {
  // ---- Tab switching (no full re-render; just toggle panes) ----
  // One shared tab strip drives BOTH the mapping buckets and the rendered
  // statement/ratios for that statement — each lives inside the same .tbr-tabpane.
  out.querySelectorAll(".tbr-map-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      _mapTab = btn.getAttribute("data-maptab");
      out.querySelectorAll(".tbr-map-tab").forEach(b =>
        b.classList.toggle("active", b.getAttribute("data-maptab") === _mapTab));
      out.querySelectorAll(".tbr-tabpane").forEach(p =>
        p.hidden = p.getAttribute("data-pane") !== _mapTab);
      // The profitability chart's canvas sits in the P&L pane; Chart.js can't
      // size a canvas while its container is display:none, so nudge it to
      // resize once the pane becomes visible.
      if (_mapTab === "pnl" && _pnlChart) _pnlChart.resize();
    });
  });

  // ---- Drag and drop ----
  // _dragRow / _dropHandled let us implement "drop in empty space → Unmapped":
  // a successful bucket drop sets _dropHandled; if dragend fires with it still
  // false, the chip was released outside any bucket, so we unmap it.
  out.querySelectorAll(".tbr-chip").forEach(chip => {
    chip.addEventListener("dragstart", e => {
      _dragRow = Number(chip.getAttribute("data-rowindex"));
      _dropHandled = false;
      e.dataTransfer.setData("text/plain", chip.getAttribute("data-rowindex"));
      e.dataTransfer.effectAllowed = "move";
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("dragging");
      stopAutoScroll();
      // Released outside any drop target → move to Unmapped.
      if (!_dropHandled && Number.isFinite(_dragRow)) {
        applyOverride(_dragRow, "__unmapped__");
      }
      _dragRow = null;
    });
  });

  // Auto-scroll the window while dragging near the top/bottom edge, so buckets
  // off-screen in a long mapping list are reachable without dropping first.
  out.addEventListener("dragover", e => {
    e.preventDefault();          // allow drop anywhere in the panel
    autoScrollNearEdges(e.clientY);
  });

  // Only the bucket BODIES with a data-target are real drop targets. The
  // "Mapped elsewhere" body is read-only (data-readonly) — a source, not a sink.
  out.querySelectorAll(".tbr-bucket-body[data-target]").forEach(body => {
    body.addEventListener("dragover", e => { e.preventDefault(); body.classList.add("dragover"); });
    body.addEventListener("dragleave", () => body.classList.remove("dragover"));
    body.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      body.classList.remove("dragover");
      _dropHandled = true;
      stopAutoScroll();
      const rowIndex = Number(e.dataTransfer.getData("text/plain"));
      if (!Number.isFinite(rowIndex)) return;
      applyOverride(rowIndex, body.getAttribute("data-target"));
    });
  });
}

/**
 * Record a manual mapping override and re-map. targetId is a statement-line id
 * or "__unmapped__". Stored as an EXPLICIT override (including "__unmapped__")
 * so an account that would auto-detect stays where the user put it.
 */
function applyOverride(rowIndex, targetId) {
  state.overrides[rowIndex] = targetId;
  // A manual edit supersedes the "restored from previous upload" notice.
  state.restoredCount = 0;
  // Persist for this company so the manual mapping survives future uploads.
  saveOverrides(state.primary);
  // Re-map + re-render (preserves the active tab via _mapTab).
  runMapping();
}

// ---- Drag auto-scroll (reach off-screen buckets in long lists) -------------
let _dragRow = null;        // rowIndex of the chip currently being dragged
let _dropHandled = false;   // set true by a successful bucket drop
let _autoScrollRAF = null;  // requestAnimationFrame id for the scroll loop
let _autoScrollDir = 0;     // -1 up, +1 down, 0 idle

const AUTOSCROLL_EDGE_PX = 90;   // distance from a viewport edge that triggers scroll
const AUTOSCROLL_SPEED_PX = 18;  // pixels per animation frame

/** Start/adjust the edge auto-scroll based on the pointer's Y in the viewport. */
function autoScrollNearEdges(clientY) {
  const h = window.innerHeight;
  if (clientY < AUTOSCROLL_EDGE_PX) _autoScrollDir = -1;
  else if (clientY > h - AUTOSCROLL_EDGE_PX) _autoScrollDir = 1;
  else _autoScrollDir = 0;

  if (_autoScrollDir === 0) { stopAutoScroll(); return; }
  if (_autoScrollRAF != null) return; // already looping
  const step = () => {
    if (_autoScrollDir === 0) { _autoScrollRAF = null; return; }
    window.scrollBy(0, _autoScrollDir * AUTOSCROLL_SPEED_PX);
    _autoScrollRAF = requestAnimationFrame(step);
  };
  _autoScrollRAF = requestAnimationFrame(step);
}

/** Stop the auto-scroll loop (on drop, dragend, or when leaving an edge). */
function stopAutoScroll() {
  _autoScrollDir = 0;
  if (_autoScrollRAF != null) { cancelAnimationFrame(_autoScrollRAF); _autoScrollRAF = null; }
}

// Holds the live Chart.js instance so we can destroy it before re-rendering.
let _pnlChart = null;

/** Render the Profitability Ratios bar chart (vendored Chart.js). */
function renderPnlChart(m) {
  const canvas = document.getElementById("tbr-pnl-chart");
  if (!canvas || typeof window.Chart === "undefined") return;

  if (_pnlChart) { _pnlChart.destroy(); _pnlChart = null; }

  const ratios = m.ratios || [];
  const labels = ratios.map(r => r.label);
  const hasPrior = m.meta.hasComparative;
  // Treppides accent palette + a contrasting set so bars are distinguishable.
  const palette = ["#2f6feb", "#e8833a", "#1f7a44", "#3aa0e8", "#8e44ad", "#5fb33a"];

  const datasets = [{
    label: "Year 1",
    data: ratios.map(r => r.current ?? 0),
    backgroundColor: labels.map((_, i) => palette[i % palette.length]),
  }];
  if (hasPrior) {
    datasets.push({
      label: "Year 2",
      data: ratios.map(r => r.prior ?? 0),
      backgroundColor: labels.map((_, i) => palette[i % palette.length]),
      // distinguish prior with a hatched/lighter look via opacity
      borderColor: "#888", borderWidth: 1,
      backgroundColor: labels.map((_, i) => palette[i % palette.length] + "80"),
    });
  }

  _pnlChart = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: hasPrior },     // single-year: bars already labelled on x-axis
        title: { display: false },
      },
      scales: {
        x: { title: { display: true, text: "Ratios" } },
        y: { title: { display: true, text: "Value" }, beginAtZero: true },
      },
    },
  });
}

function onExport() {
  try {
    exportWorkbook(state.model);
  } catch (err) {
    console.error("TB Ratio Tool: export failed", err);
    const status = document.getElementById("tbr-status");
    if (status) status.innerHTML = errorBanner("Export failed — the spreadsheet engine is not loaded.");
  }
}

/**
 * Export the rendered statements (P&L + Balance Sheet + ratios) to a PDF.
 * Captures the #tbr-statements block with html2canvas and paginates onto A4,
 * mirroring the Valuation tool's vendored jsPDF + html2canvas approach.
 */
async function onExportPdf() {
  const status = document.getElementById("tbr-status");
  const btn = document.getElementById("tbr-pdf");
  const target = document.getElementById("tbr-statements");
  if (!target) return;
  try {
    await loadVendor();
    if (!window.jspdf || !window.html2canvas) throw new Error("PDF engine not loaded.");
    if (btn) { btn.disabled = true; btn.textContent = "Preparing PDF…"; }

    // Both statements live in tab panes, one of which is hidden on screen.
    // html2canvas won't render a hidden element, so temporarily reveal every
    // pane for the capture, then restore the on-screen tab state afterwards.
    const panes = Array.from(target.querySelectorAll(".tbr-tabpane"));
    const wasHidden = panes.map(p => p.hidden);
    panes.forEach(p => { p.hidden = false; });

    let canvas;
    try {
      canvas = await window.html2canvas(target, { scale: 2, backgroundColor: "#ffffff", logging: false });
    } finally {
      panes.forEach((p, i) => { p.hidden = wasHidden[i]; });
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;
    const contentW = pageW - margin * 2;

    // Title block.
    const company = exportTitle(state.model);
    const period = state.model?.meta?.periodLabel || "";
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(company, margin, margin + 4);
    if (period) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(period, margin, margin + 10); }
    const headerH = period ? 14 : 8;

    // Paginate by SLICING the tall capture into page-height chunks and adding
    // each slice as its own image (avoids cross-page overlap).
    const imgW = contentW;
    const usableTop = margin + headerH;
    const pxPerMm = canvas.width / imgW;            // capture px per output mm
    const firstSlotPx = Math.floor((pageH - usableTop - margin) * pxPerMm);
    const otherSlotPx = Math.floor((pageH - margin * 2) * pxPerMm);

    let sy = 0;            // source y in the capture canvas
    let firstPage = true;
    while (sy < canvas.height) {
      const slotPx = firstPage ? firstSlotPx : otherSlotPx;
      const sliceH = Math.min(slotPx, canvas.height - sy);

      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceH;
      slice.getContext("2d").drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      const sliceData = slice.toDataURL("image/png");
      const sliceHmm = sliceH / pxPerMm;
      const topY = firstPage ? usableTop : margin;
      if (!firstPage) doc.addPage();
      doc.addImage(sliceData, "PNG", margin, topY, imgW, sliceHmm);

      sy += sliceH;
      firstPage = false;
    }

    const safe = company.replace(/[^\w\d-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "statements";
    doc.save(`${safe}_financial_statements.pdf`);
  } catch (err) {
    console.error("TB Ratio Tool: PDF export failed", err);
    if (status) status.innerHTML = errorBanner("Could not generate the PDF. Try again, or use the .xlsx export.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Download PDF"; }
  }
}

// ---- Render helpers ------------------------------------------

function renderValidation(m) {
  const parts = [];
  const v = m.validation;

  // Display identity = the uploaded FILENAME. E-Soft exports don't reliably
  // carry a company name (the detector kept surfacing stray cells like "From"),
  // so we show the file the auditor uploaded — always accurate, never guessed.
  const displayName = stripExt(state.fileName) || "Trial Balance";

  if (displayName || m.meta.periodLabel) {
    parts.push(`<div class="tbr-meta">${escapeHtml(displayName)}${
      m.meta.periodLabel ? ` &middot; <span>${escapeHtml(m.meta.periodLabel)}</span>` : ""
    }</div>`);
  }

  // Notice when manual mappings were restored from a previous upload of the
  // same trial balance (matched by its chart-of-accounts fingerprint, not a
  // name) — so a stale carry-over is visible, with a one-click way to wipe it.
  if (state.restoredCount > 0) {
    parts.push(infoBanner(
      `Restored <strong>${state.restoredCount}</strong> saved account mapping${state.restoredCount > 1 ? "s" : ""} ` +
      `for ${escapeHtml(displayName || "this trial balance")} from a previous upload — review before finalizing. ` +
      `<a href="#" id="tbr-clear-overrides" class="tbr-link">Clear saved mappings</a>`
    ));
  }

  parts.push(v.tbBalanced
    ? okBanner(`Trial balance balances (debits = credits = ${fmt(v.tbDebits)}).`)
    : errorBanner(`Trial balance does NOT balance. Debits ${fmt(v.tbDebits)} vs credits ${fmt(v.tbCredits)} — difference ${fmt(v.tbDifference)}. Mapping continues, but check the source.`));

  parts.push(v.bsBalanced
    ? okBanner(`Balance sheet balances (assets = liabilities + equity).`)
    : warnBanner(`Balance sheet is out by ${fmt(v.bsDifference)}. Review unmapped accounts and the retained-earnings bridge.`));

  // Loud warning when accounts carrying a balance are excluded — their value is
  // silently dropped from the statements, which is the usual cause of an
  // out-of-balance sheet. (Zero-value unmapped rows aren't worth flagging.)
  const valuedUnmapped = (m.unmapped || []).filter(u => Math.abs(u.closingNet || 0) > 0.005);
  if (valuedUnmapped.length) {
    const total = valuedUnmapped.reduce((s, u) => s + Math.abs(u.closingNet || 0), 0);
    const names = valuedUnmapped.slice(0, 3).map(u => escapeHtml(u.name || u.code)).join(", ");
    const more = valuedUnmapped.length > 3 ? `, +${valuedUnmapped.length - 3} more` : "";
    parts.push(warnBanner(
      `<strong>${valuedUnmapped.length} account${valuedUnmapped.length > 1 ? "s" : ""} excluded</strong> ` +
      `(${names}${more}), totalling ${fmt(total)}. Their balances are NOT in the statements — ` +
      `drag them onto a line in the mapping panel, or leave them excluded if intentional.`
    ));
  }

  if (!m.meta.hasComparative) {
    parts.push(infoBanner(`Single period detected — prior-year column left blank (not fabricated). Upload a comparative TB to fill it.`));
  }

  return parts.join("");
}

// Which mapping tab is showing ("bs" | "pnl"); preserved across re-renders.
let _mapTab = "bs";

/**
 * Drag-and-drop mapping panel for ONE statement (`which` = "bs" | "pnl").
 * Accounts are auto-detected on upload, then the user can drag any account chip
 * into any statement line (a "bucket"), across to the other statement's tab if
 * needed, or into "Unmapped". Dropping remaps immediately. The statement shown
 * is driven by the shared top-level tab strip (see render()), so this panel no
 * longer carries its own tab buttons.
 */
function renderMappingPanel(m, which) {
  // One record per posting row (mapped + unmapped), keyed by rowIndex.
  const accounts = [
    ...m.assignments.map(a => ({ rowIndex: a.rowIndex, code: a.code, name: a.name, value: a.closingNet, targetId: a.targetId })),
    ...m.unmapped.map(u => ({ rowIndex: u.rowIndex, code: u.code, name: u.name, value: u.closingNet, targetId: "__unmapped__" })),
  ];
  const byTarget = (id) => accounts.filter(a => a.targetId === id);

  const chip = (a) => `
    <div class="tbr-chip" draggable="true" data-rowindex="${a.rowIndex}" title="${escapeHtml(a.name)}">
      <span class="tbr-chip-code">${escapeHtml(a.code || "")}</span>
      <span class="tbr-chip-name">${escapeHtml(a.name || "(unnamed)")}</span>
      <span class="tbr-chip-val">${a.value === null || a.value === undefined ? "" : fmt(a.value)}</span>
    </div>`;

  // A drop bucket for one statement line.
  const bucket = (t) => `
    <div class="tbr-bucket" data-target="${t.id}">
      <div class="tbr-bucket-head">${escapeHtml(t.label)}</div>
      <div class="tbr-bucket-body" data-target="${t.id}">${byTarget(t.id).map(chip).join("")}</div>
    </div>`;

  // Buckets for one statement, grouped under their section headers.
  const statementCols = (targets) => {
    const sections = [];
    for (const t of targets) {
      let sec = sections.find(s => s.name === t.section);
      if (!sec) { sec = { name: t.section, targets: [] }; sections.push(sec); }
      sec.targets.push(t);
    }
    return sections.map(s => `
      <div class="tbr-bucket-section">
        <div class="tbr-section-label">${escapeHtml(s.name)}</div>
        ${s.targets.map(bucket).join("")}
      </div>`).join("");
  };

  const unmappedBucket = `
    <div class="tbr-bucket tbr-bucket-unmapped" data-target="__unmapped__">
      <div class="tbr-bucket-head">Unmapped — excluded from the statements</div>
      <div class="tbr-bucket-body" data-target="__unmapped__">${byTarget("__unmapped__").map(chip).join("")}</div>
    </div>`;

  const targets = which === "pnl" ? DEFAULT_MAPPING.pnlTargets : DEFAULT_MAPPING.bsTargets;
  const otherTargets = which === "pnl" ? DEFAULT_MAPPING.bsTargets : DEFAULT_MAPPING.pnlTargets;
  const otherName = which === "pnl" ? "Balance Sheet" : "Profit &amp; Loss";

  // EVERY detected account is reachable from BOTH tabs. Accounts assigned to a
  // line on the OTHER statement are auto-detection's first guess, not a binding
  // choice — so they appear here in a holding area, draggable onto any line in
  // THIS statement (which moves them across). Without this, e.g. a "depreciation"
  // account auto-classified to the P&L was invisible on the Balance Sheet tab and
  // couldn't be reassigned to Fixed Assets.
  const otherTargetIds = new Set(otherTargets.map(t => t.id));
  const mappedElsewhere = accounts.filter(a => otherTargetIds.has(a.targetId));
  const elsewhereBucket = mappedElsewhere.length ? `
    <div class="tbr-bucket tbr-bucket-elsewhere">
      <div class="tbr-bucket-head">Mapped on ${otherName} — drag onto a line here to move it across</div>
      <div class="tbr-bucket-body tbr-bucket-body-readonly" data-readonly="1">${mappedElsewhere.map(chip).join("")}</div>
    </div>` : "";

  return `
    <div class="tbr-card tbr-mapping">
      <div class="tbr-map-head">
        <div>
          <h3 class="tbr-map-title">Account Mapping</h3>
          <p class="tbr-hint">Auto-detected on upload. <strong>Drag any account</strong> into the
            right line — or drop it in empty space to unmap it. Accounts the tool put on the
            ${otherName} statement are shown below so you can pull them onto a line here too.
            Statements and ratios update instantly.</p>
        </div>
      </div>

      <div class="tbr-buckets">${statementCols(targets)}</div>
      ${unmappedBucket}
      ${elsewhereBucket}
    </div>`;
}

function renderUnmappedPanel(m) {
  if (!m.unmapped.length) {
    return `<div class="tbr-card tbr-unmapped ok">All posting rows were mapped — nothing dropped.</div>`;
  }
  const rows = m.unmapped.map(u =>
    `<tr><td>${escapeHtml(u.code)}</td><td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.type || "")}</td><td class="num">${fmt(u.closingNet)}</td></tr>`).join("");
  return `
    <div class="tbr-card tbr-unmapped warn">
      <h3>Unmapped accounts (${m.unmapped.length})</h3>
      <p class="tbr-hint">These matched no mapping rule and are excluded from the statements.
        Assign them in the mapping panel above, or add a rule to the config.</p>
      <div class="tbr-tablewrap">
        <table class="tbr-table">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th class="num">Closing</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderStatement(title, lines, m) {
  const hasPrior = m.meta.hasComparative;
  const head = `<tr><th>${escapeHtml(title)}</th><th class="num">Current</th>${hasPrior ? `<th class="num">Prior</th>` : ""}</tr>`;
  // Flat list — no section headers (subtotal lines like Gross Profit / EBIT
  // are emphasised via the tbr-subtotal class).
  const body = lines.map(l => {
    const cls = l.subtotal ? ' class="tbr-subtotal"' : "";
    return `<tr${cls}>
      <td>${escapeHtml(l.label)}</td>
      <td class="num">${fmt(l.current)}</td>
      ${hasPrior ? `<td class="num">${l.prior === null ? "" : fmt(l.prior)}</td>` : ""}
    </tr>`;
  }).join("");
  return `<div class="tbr-card"><table class="tbr-table tbr-statement"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderBalanceSheet(m) {
  const hasPrior = m.meta.hasComparative;
  const cols = hasPrior ? 3 : 2;
  const head = `<tr><th>Statement</th><th class="num">Current</th>${hasPrior ? `<th class="num">Prior</th>` : ""}</tr>`;

  const valCells = (l) =>
    `<td class="num">${l.current === null || l.current === undefined ? "" : fmt(l.current)}</td>` +
    (hasPrior ? `<td class="num">${l.prior === null || l.prior === undefined ? "" : fmt(l.prior)}</td>` : "");

  const body = m.balanceSheet.lines.map(l => {
    if (l.kind === "header") {
      return `<tr class="tbr-section"><td colspan="${cols}">${escapeHtml(l.label)}</td></tr>`;
    }
    if (l.kind === "total") {
      return `<tr class="tbr-subtotal"><td>${escapeHtml(l.label)}</td>${valCells(l)}</tr>`;
    }
    if (l.kind === "grand") {
      return `<tr class="tbr-grandtotal"><td>${escapeHtml(l.label)}</td>${valCells(l)}</tr>`;
    }
    return `<tr><td>${escapeHtml(l.label)}</td>${valCells(l)}</tr>`;
  }).join("");

  return `<div class="tbr-card"><table class="tbr-table tbr-statement"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ---- P&L ratios: plain list (status/commentary to come with the P&L sheet) ----
// ---- P&L (profitability) ratios: values + status badges + comments + chart ----
function renderPnlRatios(m) {
  const hasPrior = m.meta.hasComparative;
  const ratios = m.ratios || [];

  // (1) Values table — Year 1 / Year 2 as decimals (e.g. 0.44).
  const valHead = `<tr><th>Profitability Ratios</th><th class="num">Year 1</th>${hasPrior ? `<th class="num">Year 2</th>` : ""}</tr>`;
  const valBody = ratios.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td class="num">${fmtDecimal(r.current)}</td>
      ${hasPrior ? `<td class="num">${r.prior === null ? "" : fmtDecimal(r.prior)}</td>` : ""}
    </tr>`).join("");

  // (2) Comments section — per ratio: a single comment line + Status Y1/Y2 badges.
  const comments = ratios.map(r => `
    <div class="tbr-ratio-comment">
      <div class="tbr-ratio-head">
        <span class="tbr-ratio-name">${escapeHtml(r.label)}</span>
        <span class="tbr-statuses">
          ${statusBadge("Y1", r.statusCurrent)}
          ${hasPrior ? statusBadge("Y2", r.statusPrior) : ""}
        </span>
      </div>
      <ul class="tbr-comment-list"><li>${escapeHtml(r.comment || "")}</li></ul>
    </div>`).join("");

  return `
    <div class="tbr-card">
      <table class="tbr-table tbr-statement">
        <thead>${valHead}</thead><tbody>${valBody}</tbody>
      </table>
    </div>
    <div class="tbr-card">
      <h3 class="tbr-chart-title">Profitability Ratios</h3>
      <div class="tbr-chartwrap"><canvas id="tbr-pnl-chart" height="240"></canvas></div>
    </div>
    <div class="tbr-card tbr-comments">
      <h3>Comments</h3>
      ${comments}
    </div>`;
}

/** Decimal ratio formatting (two places, e.g. 0.44). */
function fmtDecimal(v) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---- Balance Sheet ratios: values + status badges + commentary + advice ----
function renderBalanceSheetRatios(m) {
  const hasPrior = m.meta.hasComparative;
  const ratios = m.bsRatios || [];

  // (1) Values table — Year 1 / Year 2, money vs ratio formatting per row.
  const valHead = `<tr><th>Financial Ratio</th><th class="num">Year 1</th>${hasPrior ? `<th class="num">Year 2</th>` : ""}</tr>`;
  const valBody = ratios.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td class="num">${fmtRatioValue(r.current, r.format)}</td>
      ${hasPrior ? `<td class="num">${r.prior === null ? "" : fmtRatioValue(r.prior, r.format)}</td>` : ""}
    </tr>`).join("");

  // (2) Commentary section — per ratio: comment bullets, Status Y1/Y2 badges, advice.
  const comments = ratios.map(r => `
    <div class="tbr-ratio-comment">
      <div class="tbr-ratio-head">
        <span class="tbr-ratio-name">${escapeHtml(r.label)}</span>
        <span class="tbr-statuses">
          ${statusBadge("Y1", r.statusCurrent)}
          ${hasPrior ? statusBadge("Y2", r.statusPrior) : ""}
        </span>
      </div>
      <ul class="tbr-comment-list">
        ${r.comment.map(line => line === "—" ? `<li class="tbr-sep">—</li>` : `<li>${escapeHtml(line)}</li>`).join("")}
      </ul>
      <div class="tbr-advice"><strong>Advice:</strong>
        <ul>${r.advice.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>
      </div>
    </div>`).join("");

  return `
    <div class="tbr-card">
      <table class="tbr-table tbr-statement">
        <thead>${valHead}</thead><tbody>${valBody}</tbody>
      </table>
    </div>
    <div class="tbr-card tbr-comments">
      <h3>Comments</h3>
      ${comments}
    </div>`;
}

function fmtRatioValue(v, format) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (format === "money") return fmt(v);                 // 256,000.00
  return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // 0.20
}

function statusBadge(yearLabel, status) {
  if (!status) return `<span class="tbr-status tbr-status-na">${yearLabel}: —</span>`;
  const cls = status === "Good" ? "good" : status === "Bad" ? "bad" : "caution";
  return `<span class="tbr-status tbr-status-${cls}">${yearLabel}: ${status}</span>`;
}

// ---- Banners + formatting ------------------------------------

function fmt(n) {
  if (n === null || n === undefined || n === "") return "";
  if (typeof n !== "number" || !isFinite(n)) return String(n);
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const okBanner    = (h) => `<div class="tbr-banner ok">${h}</div>`;
const warnBanner  = (h) => `<div class="tbr-banner warn">${h}</div>`;
const errorBanner = (h) => `<div class="tbr-banner error">${h}</div>`;
const infoBanner  = (h) => `<div class="tbr-banner info">${h}</div>`;

// ---- Static shell HTML ---------------------------------------

const SHELL_HTML = `
  <div class="tbr-container">
    <div class="tbr-header-left">
      <button class="tbr-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Hub">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <div>
        <h2 class="tbr-page-title">TB Ratio Tool</h2>
        <p class="tbr-subtitle">Upload an E-Soft trial balance &rarr; Profit &amp; Loss, Balance Sheet &amp; ratios.</p>
      </div>
    </div>

    <div id="tbr-drop" class="tbr-drop" role="button" tabindex="0" aria-label="Upload trial balance">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p><strong>Drop an E-Soft trial balance here</strong> or click to choose a file</p>
      <p class="tbr-hint">.xlsx or .csv &middot; the file is processed in your browser and never uploaded</p>
      <input type="file" id="tbr-file" accept=".xlsx,.xls,.csv" hidden>
    </div>

    <div id="tbr-status"></div>
    <div id="tbr-output"></div>
  </div>
`;
