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
import { initTbratioTour, maybeTbratioPrompt } from "./tbratio-tour.js";

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
  // Bank & Cash by CODE RANGE — the authoritative signal per the firm's charts.
  // In the actual TB files these accounts are typed plain "Asset" and often named
  // "FBME…"/"Eurobank…" (no "bank"/"cash" word), so name/type alone would drop
  // them into Trade Debtors. Each rule is format-scoped so the two charts' code
  // notations never cross:
  //   • Cycom/general: the 27xx range (2711 Cash … 2780) is bank & cash.
  //   • ESOFT (.xlsx): the 350xxx range (350010 bank … 350020 petty cash).
  { target: "bank",         group: "2", format: "cycom", code: /^27\d/ },
  { target: "bank",         group: "2", format: "esoft", code: /^350\d/ },
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

  // ---- Type-column fallbacks (last resort) ----
  // Only reached when NO group-anchored rule above matched — i.e. the account
  // has no group context (no 1-digit header row AND no usable leading digit in
  // its code). The Type column then places it in the right statement section by
  // its broad nature. Name refinements first, then bare Type. Keeps otherwise-
  // unmappable accounts off the "Unmapped" pile for differently-structured TBs.
  { target: "depreciation",     type: "Expenditure", name: new RegExp(DEPRECIATION_KEYWORDS.join("|"), "i") },
  { target: "bank",             type: "Asset", name: /bank|cash|petty cash/i },
  { target: "stock",            type: "Asset", name: /stock|inventory|wip|work in progress/i },
  { target: "prepayments",      type: "Asset", name: /prepay|prepaid|deposit/i },
  { target: "tradeDebtors",     type: "Receivable" },
  { target: "tradeCreditors",   type: "Payable" },
  { target: "shareCapital",     type: "Capital", name: /share capital|share premium|ordinary shares/i },
  { target: "retainedEarnings", type: "Capital" },
  { target: "tradeDebtors",     type: "Asset" },          // generic asset → current asset
  { target: "tradeCreditors",   type: "Liability" },      // generic liability → current liability
  { target: "operatingExpenses", type: "Expenditure" },
  { target: "revenue",          type: "Income" },
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
// PART 1 — PARSER  (trial-balance sheet → posting rows)
//
// Handles three export formats with a similar table shape:
//   • E-Soft — metadata rows on top, a header row with Code / Name / Type +
//     three Debit/Credit pairs (Opening, Period Movement, Closing), accounts
//     under 1-digit group headers, and roll-up rows.
//   • Cycom (.xls, legacy) — same header/columns, number-coded accounts under
//     "Header"-typed category rows, but with a per-category SUBTOTAL row after
//     each group's accounts ("Total <Category>" / "Subtotal"). These are caught
//     as roll-ups (ROLLUP_PATTERNS + Type=Total→Header) so they never post.
//   • ESOFT (.xlsx) — a DIFFERENT layout: Account / Name / Type + a SINGLE
//     Debit/Credit balance pair (not three), no group-header rows, and a
//     NUMERIC "Type" column (100/200/320/420/600/710/720/900/990…) that encodes
//     the category. Detected by pairCount===1 (cols.singleBalance): the one
//     balance feeds both movement (P&L) and closing (BS), it's treated as
//     single-period (no fabricated prior), the group comes from
//     groupFromEsoftType() (which is consulted ONLY for this format — 720=cost of
//     sales, 990=taxation are broken out per the firm's ESOFT chart), and the
//     repeated page-break header + "Number of Accounts" footer are skipped.
//
// The two formats use DISTINCT code notations and never share resolution: the
// numeric-Type → group map (groupFromEsoftType) fires only for a detected ESOFT
// sheet; Cycom/general resolves the group from a 1-digit header row or the
// account code's leading digit (groupFromCode). Sub-category rules that key on a
// code RANGE (e.g. bank & cash — Cycom 27xx vs ESOFT 350xxx) are format-scoped in
// the mapping rules (rule.format), so one chart's codes are never tested against
// the other's.
//
// We locate the table by its header, resolve columns by header text (not fixed
// index), skip blank + roll-up rows, and derive figures from posting rows only.
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
// The `probe` these test against is "<name> <code>" (see isRollupRow).
const ROLLUP_PATTERNS = [
  /second\s*level\s*sub\s*total/i,
  /second\s*level\s*balance/i,
  /first\s*level\s*sub\s*total/i,
  /first\s*level\s*balance/i,
  /report\s*total/i,
  /report\s*balance/i,
  /number\s*of\s*records/i,
  /number\s*of\s*accounts/i,   // ESOFT footer: "Number of Accounts:"
  /grand\s*total/i,
  // Cycom (.xls) emits a per-category subtotal after each group's accounts,
  // labelled like "Total Fixed Assets" / "Sub Total" / "Subtotal" / "Total".
  // Anchor to the START of the label so a real account merely CONTAINING the
  // word "total" (e.g. "Total Insurance Ltd") is NOT swallowed. These rows would
  // otherwise be treated as postings and double-count each category.
  /^\s*sub[\s-]*total\b/i,
  /^\s*total\b/i,
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
  // Some Cycom .xls exports have a header/data column MISALIGNMENT: a spurious or
  // merged empty header cell shifts a "Debit"/"Credit" label one column to the
  // right of where the actual figures are written (seen on the CLOSING pair —
  // header credit at col 10, data at col 9). Left uncorrected, the parser reads an
  // empty column, so every credit-balance account (all liabilities + equity) nets
  // to zero and the whole financing side vanishes. Validate the resolved columns
  // against the real data and nudge any label onto the column that actually holds
  // the numbers. No-op for correctly-aligned files (E-Soft, well-formed Cycom).
  realignColumnsToData(columns, aoa, headerRowIndex);
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

    // Multi-page reports (ESOFT) repeat the column-HEADER row at each page break.
    // Skip a re-occurrence of the header — its code cell literally reads
    // "Account" / "Code" — so it isn't mistaken for an account.
    if (matchesAny(code, HEADER_SYNONYMS.code)) continue;

    // Ignore any row explicitly typed as a group/section header (Type = "Header"),
    // even if it carries a code — these are sub-group headings, not accounts.
    if (normalizeType(type) === "Header") continue;

    const opening  = readPair(raw, columns, "opening");
    const movement = readPair(raw, columns, "movement");
    const closing  = readPair(raw, columns, "closing");

    // Group context. The resolution differs by format:
    //   • CYCOM (coded charts): the account CODE's own leading digit is the
    //     authoritative signal (5xxx=income, 7xxx=expenses…). Prefer it over the
    //     inherited 1-digit section header — a "touched-up" export can DROP a
    //     top-level header (e.g. no "7 EXPENSES" row, only the "72"/"78" sub-
    //     headers), which would otherwise leave 7xxx rows stuck on the previous
    //     section's group (Income) and mis-book every expense. Fall back to the
    //     inherited header only when the code has no usable leading digit.
    //   • ESOFT (single-balance): keep the header → numeric-Type priority; its
    //     codes don't encode the 1–8 group, so the header/Type must drive it.
    const codeGroup = groupFromCode(code);
    const derivedGroup = columns.singleBalance
      ? (currentGroupCode || groupFromEsoftType(type) || codeGroup)
      : (codeGroup || currentGroupCode);
    const derivedGroupName = derivedGroup === currentGroupCode
      ? currentGroupName
      : (derivedGroup ? (TOP_LEVEL_GROUPS[derivedGroup] || `GROUP ${derivedGroup}`) : (currentGroupName || null));

    rows.push({
      rowIndex: r,
      co: cellStr(raw[columns.co]),
      code,
      name,
      type: normalizeType(type),
      rawType: type,
      // Which format this row came from, so code-notation-specific rules (e.g.
      // the bank code ranges, which differ between the two charts) can scope
      // themselves and never cross formats. ESOFT = the single-balance layout.
      format: columns.singleBalance ? "esoft" : "cycom",
      groupCode: derivedGroup,
      groupName: derivedGroupName,
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

  // How many Debit/Credit pairs did we find? E-Soft/Cycom carry THREE (Opening,
  // Period Movement, Closing). The ESOFT (.xlsx) export carries just ONE balance
  // column pair. We record it so the parser can branch on layout.
  cols.pairCount = Math.min(debitCols.length, creditCols.length);

  cols.pairs = {};
  for (let p = 0; p < PAIR_ORDER.length; p++) {
    cols.pairs[PAIR_ORDER[p]] = {
      debit:  debitCols[p]  ?? -1,
      credit: creditCols[p] ?? -1,
    };
  }

  // Single-balance layout (ESOFT): one Debit/Credit pair, no Opening/Movement/
  // Closing split. Alias that one balance to MOVEMENT (drives the P&L) and
  // CLOSING (drives the BS) — but leave OPENING empty, so the tool correctly
  // treats this as a single period and does NOT fabricate a prior-year column
  // (meta.hasOpening keys off opening balances).
  if (cols.pairCount === 1) {
    const only = { debit: debitCols[0], credit: creditCols[0] };
    cols.pairs.opening  = { debit: -1, credit: -1 };
    cols.pairs.movement = { ...only };
    cols.pairs.closing  = { ...only };
    cols.singleBalance = true;
    return cols;
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

/**
 * Correct header/data column MISALIGNMENT in the Debit/Credit pairs (a Cycom .xls
 * quirk: a spurious/merged empty header cell shifts a label one column right of the
 * data). For each resolved Debit/Credit column we count how many posting rows carry
 * a number there vs. in the immediately-adjacent columns; if the labelled column is
 * (near-)empty but an UNCLAIMED neighbour clearly holds the values, we move the
 * column to the neighbour. Conservative by design — only fires on strong evidence,
 * never reassigns a column already used by another pair — so correctly-aligned
 * files (E-Soft, well-formed Cycom) are untouched. Mutates cols.pairs in place.
 */
function realignColumnsToData(cols, aoa, headerRowIndex) {
  if (cols.singleBalance) return;            // ESOFT single-pair: no closing split to fix
  const start = headerRowIndex + 1;
  // Count non-zero numbers in a column, but ONLY over genuine POSTING rows. This
  // is critical: the SUBTOTAL / rollup rows in a Cycom export can carry values in
  // the header-labelled (but for postings empty) column, which would otherwise
  // make a misaligned column look populated and defeat the correction. So we
  // exclude group-header rows (1-digit code), rollup/total rows, header-typed
  // rows, and code-less rows — exactly the rows the parser itself skips.
  const isPosting = (raw) => {
    const code = cellStr(raw[cols.code]);
    const name = cellStr(raw[cols.name]);
    if (!code) return false;
    if (isTopLevelCode(code)) return false;
    if (isRollupRow(code, name)) return false;
    if (matchesAny(code, HEADER_SYNONYMS.code)) return false;
    if (normalizeType(cellStr(raw[cols.type])) === "Header") return false;
    return true;
  };
  const dataCount = (c) => {
    if (c < 0) return 0;
    let n = 0;
    for (let r = start; r < aoa.length; r++) {
      const raw = aoa[r] || [];
      if (isPosting(raw) && Math.abs(parseNumber(raw[c])) > 0) n++;
    }
    return n;
  };
  // Every column index currently claimed by any pair (so we never steal one).
  const claimed = new Set();
  for (const k of PAIR_ORDER) {
    const p = cols.pairs[k];
    if (p.debit  >= 0) claimed.add(p.debit);
    if (p.credit >= 0) claimed.add(p.credit);
  }
  const MIN_EVIDENCE = 3; // need a few real rows before trusting a shift
  const tryFix = (pair, side) => {
    const c = pair[side];
    if (c < 0) return;
    const here = dataCount(c);
    // Look at the unclaimed immediate neighbours. Shift the column there when a
    // neighbour clearly holds the real data — i.e. it has >= MIN_EVIDENCE rows AND
    // MORE THAN DOUBLE the labelled column's count. The "more than double" test
    // (not "labelled column is empty") is essential: a real Cycom export can leak
    // a STRAY value or two into the mislabelled column (seen: closing-credit header
    // at col 10 with 1 stray row, while the actual 8 credit balances sit in col 9).
    // Requiring the labelled column to be totally empty missed that and zeroed all
    // the liabilities/equity. For a correctly-aligned file the labelled column has
    // the most data, so no neighbour can beat it 2:1 → never fires.
    let best = c, bestN = here;
    for (const cand of [c - 1, c + 1]) {
      if (cand < 0 || claimed.has(cand) || cand === c) continue;
      const n = dataCount(cand);
      if (n >= MIN_EVIDENCE && n > here * 2 && n > bestN) { best = cand; bestN = n; }
    }
    if (best !== c) {
      claimed.delete(c); claimed.add(best);
      pair[side] = best;
    }
  };
  for (const k of PAIR_ORDER) {
    tryFix(cols.pairs[k], "debit");
    tryFix(cols.pairs[k], "credit");
  }
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

/**
 * Derive a top-level group (1–8) from an account code's FIRST DIGIT, for TBs
 * that DON'T carry explicit 1-digit group-header rows. Charts of accounts in
 * this firm encode the category in the leading digit (5xxx = income, 2xxx =
 * current assets, …) using the same 1–8 scheme as TOP_LEVEL_GROUPS. Returns the
 * digit as a string ("1".."8") or null if the code doesn't start with 1–8.
 * Only used as a FALLBACK — an explicit group-header row always takes priority,
 * so the original E-Soft format is unaffected.
 */
function groupFromCode(code) {
  const m = /^\s*([1-8])\d*/.exec(String(code || ""));
  return m ? m[1] : null;
}

// ESOFT (.xlsx) uses a NUMERIC "Type" column as the category (e.g. 100, 320,
// 900) rather than a word ("Asset") or a 1-digit group row. This is a code
// notation SPECIFIC TO THE ESOFT FORMAT — never applied to Cycom/general codes
// (those use groupFromCode's leading digit). It's only consulted when the parser
// has detected a single-balance ESOFT sheet (columns.singleBalance).
//
// Map ESOFT's Type onto the tool's 1–8 group scheme so the normal classify()
// rules place the account. Ranges transcribed from the firm's ESOFT chart of
// accounts ("E-soft - Chart of Accounts.xlsx" legend + HD section headers):
//   1xx → Fixed assets                                   → group 1
//   2xx → Investments (200) / non-current assets         → group 2 (current assets)
//   3xx → Current assets (incl. 320 debtors, 350 bank)   → group 2
//   4xx → Liabilities (400 current, 420 creditors, 460 accruals, 490 VAT) → group 3
//   5xx → Long-term liabilities (500/510 long-term loans) → group 3 (name rules
//         + GROUP4_SPLIT still split out the long-term loan line where present)
//   6xx → Capital & reserves (610 equity, 620 retained)  → group 4
//   710 → Income                                          → group 5
//   720 → COST OF SALES                                   → group 6  (NOT income)
//   730 → Other income                                    → group 5
//   9xx → Expenses (900/910/920 admin+selling, 980 finance) → group 7
//   990 → TAXATION                                        → group 8  (NOT expenses)
// Returns a "1".."8" string, or null if the Type code isn't recognised.
function groupFromEsoftType(typeCode) {
  const n = parseInt(String(typeCode || "").trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 100 && n < 200) return "1";   // fixed assets
  if (n >= 200 && n < 400) return "2";   // investments + current assets (incl. 320 debtors, 350 bank)
  if (n >= 400 && n < 600) return "3";   // liabilities (400 current, 500 long-term)
  if (n >= 600 && n < 700) return "4";   // capital & reserves (equity + retained)
  if (n === 720)           return "6";   // cost of sales (before the 7xx income range)
  if (n >= 700 && n < 800) return "5";   // income (710) + other income (730)
  if (n === 990)           return "8";   // taxation (before the 9xx expenses range)
  if (n >= 800 && n < 1000) return "7";  // expenses (8xx/9xx)
  return null;
}
function isRollupRow(code, name) {
  const probe = `${name} ${code}`.trim();
  return ROLLUP_PATTERNS.some(re => re.test(probe));
}

function cellStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function matchesAny(cell, synonyms) {
  // cell may be undefined when a row array is SPARSE (Excel exports with blank/
  // merged header cells produce holes that Array.map preserves) — coerce safely.
  const c = cellStr(cell).replace(/\s+/g, " ").trim().toLowerCase();
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
  // Cycom subtotal rows carry a Type like "Total"/"Subtotal" — treat them as
  // section headers (which the parser skips), so they never count as postings
  // even if their label somehow slips past the rollup patterns.
  total: "Header", subtotal: "Header", "sub total": "Header",
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

  // For a 2nd-TB comparative, carry the user's manual mappings over by account
  // CODE (row indexes differ between files), then auto-classify the rest.
  const priorAssignments = priorMode === "secondTb"
    ? assignFor(priorParsed.rows || [], config,
                remapOverridesByCode(rows, overrides, priorParsed.rows || []))
    : null;

  // 3. P&L line totals (period movement). Prior P&L only with a 2nd TB.
  const pnlCurrent = sumByTarget(assignments, config.pnlTargets, r => r.movementNet);
  let pnlPrior = null;
  if (priorMode === "secondTb") {
    pnlPrior = sumByTarget(priorAssignments, config.pnlTargets, r => r.movementNet);
  }

  // 4. Balance Sheet line totals (closing = current; prior per priorMode).
  const bsCurrent = sumByTarget(assignments, config.bsTargets, r => r.closingNet);
  let bsPrior = null;
  if (priorMode === "secondTb") {
    bsPrior = sumByTarget(priorAssignments, config.bsTargets, r => r.closingNet);
  } else if (priorMode === "opening") {
    bsPrior = sumByTarget(assignments, config.bsTargets, r => r.openingNet);
  }

  // 5. Derived P&L figures.
  const derivedCurrent = computeDerived(pnlCurrent, config);
  const derivedPrior = pnlPrior ? computeDerived(pnlPrior, config) : null;

  // 6. The bridge: closing retained earnings = opening RE + net profit,
  //    so total assets = total liabilities + equity by construction.
  applyRetainedEarningsBridge(bsCurrent, derivedCurrent.netProfit, assignments);
  // Same bridge for the comparative's closing BS, so the Prior column ties out
  // too (its current-year profit likewise still sits in open P&L accounts).
  if (priorMode === "secondTb" && bsPrior && derivedPrior) {
    applyRetainedEarningsBridge(bsPrior, derivedPrior.netProfit, priorAssignments);
  }

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
  // format — restrict a rule to one export format ("esoft" | "cycom"). Used by
  // rules that key on a format-specific code notation (e.g. bank code ranges),
  // so the two charts' distinct code schemes can never be matched against each other.
  if (rule.format !== undefined && String(rule.format) !== String(row.format)) return false;
  if (rule.group !== undefined && String(rule.group) !== String(row.groupCode)) return false;
  // code — regex tested against the account CODE (not the name). Enables routing
  // by code range where a chart encodes the sub-category in the code itself.
  if (rule.code !== undefined && !(rule.code instanceof RegExp ? rule.code.test(String(row.code || "")) : String(row.code || "").startsWith(String(rule.code)))) return false;
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

/**
 * Translate the PRIMARY TB's manual overrides so they apply to the COMPARATIVE
 * TB, matched by account CODE rather than row index.
 *
 * `overrides` is keyed by the primary's rowIndex; the two files rarely share the
 * same row ordering, so applying those keys to the comparative directly would
 * mis-target. Account codes ARE stable for the same client period-to-period, so
 * we go primary rowIndex → code → comparative rowIndex. Any manual correction on
 * the primary thus carries to the same account in the comparative; codes that
 * exist only in one file are simply left to auto-classify.
 */
function remapOverridesByCode(fromRows, overrides, toRows) {
  // primary rowIndex → target, re-expressed as code → target
  const byCode = {};
  for (const row of fromRows || []) {
    const t = overrides[row.rowIndex];
    if (t !== undefined && row.code) byCode[row.code] = t;
  }
  // code → target, re-expressed against the comparative's own rowIndexes
  const out = {};
  for (const row of toRows || []) {
    if (row.code && Object.prototype.hasOwnProperty.call(byCode, row.code)) {
      out[row.rowIndex] = byCode[row.code];
    }
  }
  return out;
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
 * Retained Earnings on the Balance Sheet = the RE rows' CLOSING balances from the
 * trial balance + the P&L net profit for the period.
 *
 * Why this shape: in these E-Soft exports the current-year profit has NOT yet been
 * transferred into Retained Earnings — it is still sitting in the open P&L accounts
 * (revenue/COGS/expenses/tax). The balance sheet drops those P&L accounts, so equity
 * is short by exactly the net profit unless we add it back into RE. (That is why the
 * imbalance, when RE used closing alone, equalled the P&L net profit.)
 *
 *   retainedEarnings (BS) = closing RE  +  net profit
 *
 * We use the RE rows' CLOSING balance (not opening) so we don't depend on the
 * E-Soft "Movement" column, which is unreliable for RE rows — some carry no
 * movement debit/credit at all. Net profit comes from the P&L (period movement on
 * the P&L accounts), exactly the figure the equity side is missing.
 *
 * `bsCurrent.retainedEarnings` arrives here as the closing-based total (sumByTarget
 * at step 4 over r.closingNet); we add net profit to it.
 */
function applyRetainedEarningsBridge(bsCurrent, netProfit, assignments) {
  let openingRE = 0;
  for (const { row, targetId } of assignments) {
    if (targetId !== "retainedEarnings") continue;
    openingRE += -netOf(row.opening); // invert: equity is credit-natured
  }
  const closingRE = bsCurrent.retainedEarnings ?? 0; // closing-based, from step 4
  bsCurrent.openingRetainedEarnings = round(openingRE);
  bsCurrent.retainedEarnings = round(closingRE + netProfit); // P&L profit not yet in RE
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

/** Heading printed on the PDF: the user's chosen file name (the actions-row field,
 *  raw text so spaces read naturally) or, if unset, the uploaded filename — paired
 *  as "<File Name> - Trial Balance Ratios". */
function pdfTitle() {
  const name = (state.exportName && state.exportName.trim())
    || stripExt(state.fileName)
    || "Trial Balance";
  return `${name} - Trial Balance Ratios`;
}
/** Filesystem-safe base for export filenames. Priority:
 *   1. the user's chosen export name (from the actions-row input), sanitised
 *   2. the uploaded trial-balance filename (stripped of extension), sanitised
 *   3. a fixed "TB" fallback
 * A scope suffix (_balance_sheet / _profit_and_loss / _financial_statements) is
 * still appended by the callers, so the three PDF variants + the xlsx stay
 * distinguishable even when the user gives them all the same base name. */
function safeFileBase(model) {
  const chosen = sanitizeFileBase(state.exportName);
  if (chosen) return chosen;
  return defaultExportBase();
}

/** The default export base shown in (and used when the user clears) the file-name
 *  input: the uploaded trial-balance filename, sanitised, or "TB" if none. */
function defaultExportBase() {
  return sanitizeFileBase(stripExt(state.fileName)) || "TB";
}

/** Make a string safe to use as a filename base: drop path separators and
 *  characters illegal on Windows/macOS/Linux, collapse whitespace to underscores,
 *  and cap the length. Returns "" if nothing usable remains (caller falls back). */
function sanitizeFileBase(name) {
  // Strip control chars (0x00–0x1f) without an in-regex control range (which is
  // fragile to save round-trips); do it by char code, then handle the rest.
  const noControl = Array.from(String(name || ""))
    .filter(ch => ch.charCodeAt(0) >= 0x20)
    .join("");
  return noControl
    .replace(/\.(xlsx|xls|csv|pdf)$/i, "")   // drop a trailing extension if the user typed one
    .replace(/[<>:"/\\|?*]/g, "")             // chars reserved on Windows/macOS/Linux
    .replace(/\s+/g, "_")                     // whitespace -> underscores
    .replace(/_{2,}/g, "_")                   // collapse repeats
    .replace(/^[_.]+|[_.]+$/g, "")            // trim leading/trailing _ or .
    .slice(0, 100);
}
/** Drop a trailing .xlsx/.xls/.csv extension from a filename for display. */
function stripExt(name) {
  return (name || "").replace(/\.(xlsx|xls|csv)$/i, "").trim();
}

// ============================================================
// PART 4 — PAGE / UI
// ============================================================

const state = {
  primary: null,       // parsed primary TB
  prior: null,         // parsed comparative TB (optional)
  model: null,         // last mapAccounts() result
  overrides: {},       // { rowIndex: targetId } user reassignments (current upload)
  fileName: null,
  priorFileName: null, // filename of the loaded comparative TB (null = none / opening-balance prior)
  exportName: null,    // user-chosen base name for downloads (null = use the default: uploaded filename)
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
  // First-visit tour prompt — fired here (not at init) so it only appears once
  // the TB Ratio page is actually open, never over the landing page.
  try { maybeTbratioPrompt(); } catch (_) {}
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
    window.__hub_projects?.show();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  wirePrimaryUpload(section);

  // "Clear / New TB" lives in the persistent shell header, so wire it once here.
  document.getElementById("tbr-clear-tb")?.addEventListener("click", resetTool);

  // On-site guided tour: header "Tutorial" button + first-visit prompt.
  // Pure frontend, anchors at existing DOM; guarded so a tour failure can
  // never break the tool itself.
  try { initTbratioTour(); } catch (err) { console.error("TB Ratio tour init failed", err); }
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

/**
 * Wire the export file-name input. The user's raw text is held in state.exportName
 * and only sanitised at download time (safeFileBase), so typing spaces/punctuation
 * stays natural in the field. An empty field means "use the default" (the uploaded
 * filename) — we store null so the placeholder shows through. Re-created inside
 * #tbr-output every render, so this runs each render.
 */
function wireExportName(out) {
  const input = out.querySelector("#tbr-export-name");
  input?.addEventListener("input", e => {
    const v = e.target.value;
    state.exportName = v.trim() === "" ? null : v;
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
      state.exportName = null; // default the export name to this new file's name
      state.overrides = loadOverrides(parsed);
      // Count of mappings restored from a previous period (for the notice
      // banner). Cleared once the user starts dragging, so the notice only
      // reflects the initial restore, not subsequent manual edits.
      state.restoredCount = Object.keys(state.overrides).length;
      state.prior = null;
      state.priorFileName = null;
      state.model = null;
      _mapTab = "bs"; // reset the mapping tab to the default
      _selected.clear(); // a fresh book starts with no selection
      _selectAnchor = null;
      // Start the "No activity" (zero-balance) area collapsed for a fresh book;
      // the user can expand it and that choice then sticks across re-renders.
      _collapsed.clear();
      _collapsed.add("__zero__");
    } else {
      state.prior = parsed;
      state.priorFileName = file.name;
    }

    runMapping();
  } catch (err) {
    console.error("TB Ratio Tool: parse failed", err);
    const msg = err instanceof ParseError ? err.message : "Could not read this file. Make sure it is a trial balance sheet export (.xlsx, .xls or .csv).";
    status.innerHTML = errorBanner(escapeHtml(msg));
  }
}

/**
 * Read a File into an array-of-arrays. Handles the range of things "trial
 * balance export" turns out to mean in practice:
 *   • .xlsx / genuine binary .xls (BIFF)  → SheetJS from the raw bytes
 *   • legacy .xls that is really an HTML TABLE with an .xls extension (common
 *     from old accounting tools like Cycom) → parsed via the browser's own
 *     DOMParser, independent of SheetJS's (limited) HTML support
 *   • .csv / tab-delimited mislabelled .xls → SheetJS string read
 * We try binary first, then sniff the text for HTML, then fall back to a string
 * read. A single clear error is thrown only if every strategy fails.
 */
function readSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read error"));
    reader.onload = e => {
      const bytes = new Uint8Array(e.target.result);

      // Sniff the leading bytes to route to the right reader FIRST. This matters
      // because SheetJS, handed HTML, grabs the FIRST <table> (often a layout /
      // report-header table), not the data grid — so for HTML we parse it
      // ourselves (largest table) instead of letting SheetJS pick wrong.
      const text = bytesToText(bytes);
      const head = text.slice(0, 1000).toLowerCase();
      const looksHtml = head.includes("<table") || head.includes("<html") ||
                        head.includes("<tr") || head.includes("<!doctype html");

      // Strategy A — HTML masquerading as .xls (legacy tools like Cycom).
      if (looksHtml) {
        try {
          const aoa = htmlTableToAoa(text);
          if (aoa && aoa.length) return resolve(aoa);
        } catch (_) { /* fall through */ }
      }

      // Strategy B — binary workbook (.xlsx or real BIFF .xls).
      try {
        const aoa = sheetToAoa(XLSX.read(bytes, { type: "array" }));
        if (aoa && aoa.length) return resolve(aoa);
      } catch (_) { /* fall through */ }

      // Strategy C — delimited text (CSV / TSV) via SheetJS string read.
      // Guard: don't run on HTML (already tried) — CSV read on markup yields junk.
      if (!looksHtml) {
        try {
          const aoa = sheetToAoa(XLSX.read(text, { type: "string" }));
          if (aoa && aoa.length) return resolve(aoa);
        } catch (_) { /* fall through */ }
      }

      reject(new ParseError(
        "Could not read this file. Supported: Excel (.xlsx, .xls) or CSV trial-balance " +
        "exports. If this is from a legacy tool, try re-saving it as .xlsx or .csv."));
    };
    reader.readAsArrayBuffer(file);
  });
}

/** Workbook → array-of-arrays of the first sheet. */
function sheetToAoa(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, raw: true });
}

/** Decode bytes to text, honouring a UTF-16/UTF-8 BOM if present (legacy .xls
 *  HTML exports are often UTF-16). Falls back to UTF-8. */
function bytesToText(bytes) {
  try {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder("utf-16be").decode(bytes);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_) {
    // Last resort: latin1-ish manual decode.
    let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

/**
 * Parse an HTML table (from an HTML-disguised .xls) into an array-of-arrays.
 * Uses DOMParser (always available in-browser). Picks the LARGEST table on the
 * page (the data grid, not a header/layout table). colspan is expanded to blank
 * cells; rowspan is approximated by leaving lower cells blank (fine for a TB —
 * the parser keys on the header row + per-row codes, not merged cells).
 */
function htmlTableToAoa(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const tables = [...doc.querySelectorAll("table")];
  if (!tables.length) return [];
  // Largest by cell count = the real data table.
  let best = tables[0], bestCells = -1;
  for (const t of tables) {
    const n = t.querySelectorAll("td,th").length;
    if (n > bestCells) { best = t; bestCells = n; }
  }
  const aoa = [];
  for (const tr of best.querySelectorAll("tr")) {
    const row = [];
    for (const cell of tr.querySelectorAll("td,th")) {
      const span = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
      const val = cell.textContent.replace(/ /g, " ").trim();
      row.push(val);
      for (let k = 1; k < span; k++) row.push("");   // expand colspan → blanks
    }
    aoa.push(row);
  }
  return aoa;
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
    <div class="tbr-toprow">
      <div class="tbr-tabs" role="tablist">
        <button class="tbr-map-tab ${bsActive ? "active" : ""}" data-maptab="bs" role="tab">Balance Sheet</button>
        <button class="tbr-map-tab ${bsActive ? "" : "active"}" data-maptab="pnl" role="tab">Profit &amp; Loss</button>
      </div>
      <!-- Comparative-TB upload lives at the TOP so it's easy to reach without
           scrolling past all the statements/ratios to the export row. -->
      <div class="tbr-comparative">
        <label class="tbr-btn tbr-btn-ghost tbr-comparative-btn">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          ${state.priorFileName ? "Replace comparative TB" : "Add comparative TB"}
          <input type="file" id="tbr-file-prior" accept=".xlsx,.xls,.csv" hidden>
        </label>
        ${state.priorFileName
          ? `<span class="tbr-prior-name" title="Loaded comparative TB">vs ${escapeHtml(stripExt(state.priorFileName))} <a href="#" id="tbr-remove-prior-2" class="tbr-link">remove</a></span>`
          : `<span class="tbr-comparative-hint">Compare against a prior-year TB (fills the Prior column)</span>`}
      </div>
    </div>

    ${renderUnmappedPanel(m)}

    <div id="tbr-statements">
      <section class="tbr-tabpane" data-pane="bs" ${bsActive ? "" : "hidden"}>
        ${renderMappingPanel(m, "bs")}
        <section class="tbr-group">
          <h2 class="tbr-group-title">Balance Sheet</h2>
          ${renderBalanceSheet(m)}
          ${renderBsCharts(m)}
          ${renderBalanceSheetRatios(m)}
        </section>
      </section>

      <section class="tbr-tabpane" data-pane="pnl" ${bsActive ? "hidden" : ""}>
        ${renderMappingPanel(m, "pnl")}
        <section class="tbr-group">
          <h2 class="tbr-group-title">Profit &amp; Loss</h2>
          ${renderStatement("Statement", m.pnl.lines, m)}
          ${renderPnlWaterfallCard(m)}
          ${renderPnlRatios(m)}
        </section>
      </section>
    </div>

    <div class="tbr-actions">
      <label class="tbr-filename" title="Base name for the downloaded files. A suffix (_balance_sheet / _profit_and_loss / _financial_statements) is added automatically.">
        <span class="tbr-filename-label">File name</span>
        <input type="text" id="tbr-export-name" class="tbr-filename-input"
               value="${escapeHtml(state.exportName ?? defaultExportBase())}"
               placeholder="${escapeHtml(defaultExportBase())}"
               spellcheck="false" autocomplete="off" maxlength="100" />
      </label>
      <button class="tbr-btn tbr-btn-primary" id="tbr-export">Export to .xlsx</button>
      <div class="tbr-pdf-menu" id="tbr-pdf-menu">
        <button class="tbr-btn tbr-btn-ghost" id="tbr-pdf" aria-haspopup="true" aria-expanded="false">Download PDF ▾</button>
        <div class="tbr-pdf-dropdown" role="menu" hidden>
          <button type="button" role="menuitem" data-pdf-scope="all">Both statements</button>
          <button type="button" role="menuitem" data-pdf-scope="bs">Balance Sheet only</button>
          <button type="button" role="menuitem" data-pdf-scope="pnl">P&amp;L only</button>
        </div>
      </div>
    </div>
  `;

  wirePriorUpload(out);
  wireExportName(out);
  out.querySelector("#tbr-export")?.addEventListener("click", onExport);
  wirePdfMenu(out);
  wireMappingPanel(out);

  // "Clear saved mappings" link lives in the #tbr-status banner.
  document.getElementById("tbr-clear-overrides")?.addEventListener("click", (e) => {
    e.preventDefault();
    clearSavedOverrides();
  });

  // Charts (canvases are in the DOM now that innerHTML is set).
  renderPnlChart(m);        // P&L: profitability ratios (existing)
  renderBsCompositionChart(m); // BS: assets vs financing composition
  renderBsGauge(m);         // BS: current-ratio liquidity gauge (SVG, no canvas)
  renderPnlWaterfall(m);    // P&L: revenue → net profit waterfall

  // Reveal the header "Clear / New TB" button + compact the drop zone.
  updateHeaderControls();

  // "Remove comparative" links — one in the comparative banner (renderValidation),
  // one beside the Replace-comparative control in the actions row.
  ["tbr-remove-prior", "tbr-remove-prior-2"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      e.preventDefault();
      removeComparative();
    });
  });
}

/** Wipe this company's saved overrides + current in-memory ones, then re-map fresh. */
function clearSavedOverrides() {
  const key = tbKey(state.primary);
  if (key) { try { localStorage.removeItem(key); } catch (_) {} }
  state.overrides = {};
  state.restoredCount = 0;
  runMapping(); // re-detect everything from scratch
}

/**
 * Clear the loaded trial balance(s) and return to the empty upload screen.
 * Wipes in-memory state only — this client's SAVED per-code overrides in
 * localStorage are kept, so re-uploading the same TB still restores them
 * (matching "Clear / New TB", not a destructive hard reset).
 */
function resetTool() {
  state.primary = null;
  state.prior = null;
  state.priorFileName = null;
  state.model = null;
  state.overrides = {};
  state.restoredCount = 0;
  state.fileName = null;
  state.exportName = null;   // back to the default (next upload's filename)
  _mapTab = "bs";
  _search = "";
  _collapsed.clear();
  _selected.clear();
  _selectAnchor = null;
  destroyCharts();
  // Empty the results + status; the persistent drop zone stays wired (it lives
  // in the shell and was wired once in init), so the tool is ready for a new file.
  const out = document.getElementById("tbr-output");
  const status = document.getElementById("tbr-status");
  if (out) out.innerHTML = "";
  if (status) status.innerHTML = "";
  updateHeaderControls();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Drop a loaded comparative TB, reverting the Prior column to opening-balance
 * mode (or single-period). Re-maps and re-renders. */
function removeComparative() {
  state.prior = null;
  state.priorFileName = null;
  runMapping();
}

/** Show the header "Clear / New TB" button only once a TB is loaded, and shrink
 * the drop zone to a compact strip so the results get the space. */
function updateHeaderControls() {
  const loaded = !!state.primary;
  document.getElementById("tbr-clear-tb")?.toggleAttribute("hidden", !loaded);
  document.getElementById("tbr-drop")?.classList.toggle("tbr-drop-compact", loaded);
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
      // Chart.js can't size a canvas while its pane is display:none, so nudge the
      // now-visible pane's charts to resize once it's shown.
      // BS composition is SVG (auto-scales); only the canvas charts need a resize.
      if (_mapTab === "pnl") { _pnlChart?.resize(); _pnlWaterfallChart?.resize(); _pnlWaterfallChart2?.resize(); }
    });
  });

  // ---- Multi-select (click) ----
  // Plain click toggles a chip's selection; Ctrl/Cmd-click adds/removes without
  // clearing others; Shift-click selects the range from the anchor within the
  // SAME bucket body. Selection is by rowIndex (chips are duplicated across the
  // two tab panes), so we sync the .selected class on every copy afterwards.
  out.querySelectorAll(".tbr-chip").forEach(chip => {
    chip.addEventListener("click", e => {
      const row = Number(chip.getAttribute("data-rowindex"));
      if (!Number.isFinite(row)) return;
      // Stop the bubble so the click-away handler below doesn't immediately clear
      // the selection we're setting here.
      e.stopPropagation();
      if (e.shiftKey && _selectAnchor != null) {
        selectRangeTo(out, chip, row);
      } else if (e.ctrlKey || e.metaKey) {
        toggleSelect(row);
        _selectAnchor = row;
      } else {
        // Plain click: if this is the only selected chip, toggle it off;
        // otherwise make it the sole selection.
        const onlyThis = _selected.size === 1 && _selected.has(row);
        _selected.clear();
        if (!onlyThis) _selected.add(row);
        _selectAnchor = onlyThis ? null : row;
      }
      syncSelectionUI(out);
    });
  });

  // Click away → clear the selection. Chip clicks stopPropagation above, so a
  // click that reaches here is genuinely "not on a chip". Covers clicking
  // elsewhere in the results (statements, ratios, empty space). Wired once per
  // render on the output container; guarded so it's a no-op when nothing's
  // selected. (A drop fires drop/dragend, not click, so this never interferes
  // with drag-moves.)
  out.addEventListener("click", e => {
    if (_selected.size === 0) return;
    if (e.target.closest(".tbr-chip")) return; // safety: never clear on a chip
    _selected.clear();
    _selectAnchor = null;
    syncSelectionUI(out);
  });

  // ---- Drag and drop ----
  // _dragRow / _dropHandled let us implement "drop in empty space → Unmapped":
  // a successful bucket drop sets _dropHandled; if dragend fires with it still
  // false, the chip was released outside any bucket, so we route it accordingly.
  // _dragRows carries the FULL set being moved (the selection if the dragged chip
  // is part of it, else just the one chip) — enabling bulk drag-together.
  out.querySelectorAll(".tbr-chip").forEach(chip => {
    chip.addEventListener("dragstart", e => {
      _dragEl = chip;
      _dragRow = Number(chip.getAttribute("data-rowindex"));
      // If dragging a selected chip, move the whole selection; otherwise this is
      // a lone drag — drop any stale selection so behaviour matches expectation.
      if (_selected.has(_dragRow)) {
        _dragRows = [..._selected];
      } else {
        _selected.clear(); _selectAnchor = null; syncSelectionUI(out);
        _dragRows = [_dragRow];
      }
      _dragIsZero = Math.abs(rowClosingNet(_dragRow)) < EPSILON;
      _dropHandled = false;
      e.dataTransfer.setData("text/plain", String(_dragRow));
      e.dataTransfer.effectAllowed = "move";
      // Visually lift all chips in the moving set (both panes).
      _dragRows.forEach(r => out.querySelectorAll(`.tbr-chip[data-rowindex="${r}"]`)
        .forEach(c => c.classList.add("dragging")));
    });
    chip.addEventListener("dragend", () => {
      out.querySelectorAll(".tbr-chip.dragging").forEach(c => c.classList.remove("dragging"));
      stopAutoScroll();
      // Released outside any drop target. Zero-balance rows go to "No activity"
      // (clear override so isZeroParked re-parks them); valued rows go to Unmapped.
      // Skip rows already sitting where they'd land (no sticky no-op override).
      if (!_dropHandled && _dragRows.length) {
        const toUnmap = [], toClear = [];
        for (const r of _dragRows) {
          const el = _dragEl && Number(_dragEl.getAttribute("data-rowindex")) === r
            ? _dragEl
            : out.querySelector(`.tbr-chip[data-rowindex="${r}"]`);
          const srcBox = el?.closest(".tbr-bucket");
          if (Math.abs(rowClosingNet(r)) < EPSILON) {
            if (!srcBox?.classList.contains("tbr-bucket-zero")) toClear.push(r);
          } else {
            if (!srcBox?.classList.contains("tbr-bucket-unmapped")) toUnmap.push(r);
          }
        }
        // Two buckets of action → apply in as few re-maps as possible.
        if (toClear.length && toUnmap.length) {
          for (const r of toClear) delete state.overrides[r];
          applyOverridesBulk(toUnmap, "__unmapped__");
        } else if (toClear.length) {
          applyOverridesBulk(toClear, null);
        } else if (toUnmap.length) {
          applyOverridesBulk(toUnmap, "__unmapped__");
        }
      }
      _dragEl = null;
      _dragRow = null;
      _dragRows = [];
      _dragIsZero = false;
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
      const target = body.getAttribute("data-target");
      // Move the whole dragged set (selection, or the single chip). Fall back to
      // the dataTransfer rowIndex if _dragRows somehow wasn't populated.
      let rows = _dragRows.length ? _dragRows.slice()
        : [Number(e.dataTransfer.getData("text/plain"))].filter(Number.isFinite);
      // Drop the ones already IN this bucket — no sticky no-op override for a
      // non-move. A chip is "already here" if any of its copies sits in this body.
      rows = rows.filter(r => {
        const here = [...body.querySelectorAll(`.tbr-chip[data-rowindex="${r}"]`)].length > 0;
        return !here;
      });
      if (rows.length === 1) applyOverride(rows[0], target);
      else if (rows.length > 1) applyOverridesBulk(rows, target);
      // else: everything was already here → nothing to do.
    });
  });

  // ---- Discoverability: live search, count + jump, collapse ----
  // All of these mutate the DOM directly (classes / hidden) rather than
  // re-rendering, so drag wiring, scroll position and input focus are kept.
  // Each tab pane renders its own toolbar, so wire EVERY instance (querySelector
  // would only catch the first pane's). Filtering operates across all panes.
  out.querySelectorAll("#tbr-map-search").forEach(input => {
    input.addEventListener("input", () => {
      _search = input.value.trim().toLowerCase();
      applyMapFilter(out);
    });
  });
  out.querySelectorAll("#tbr-search-clear").forEach(btn => {
    btn.addEventListener("click", () => {
      _search = "";
      out.querySelectorAll("#tbr-map-search").forEach(i => { i.value = ""; });
      out.querySelector('.tbr-tabpane:not([hidden]) #tbr-map-search')?.focus();
      applyMapFilter(out);
    });
  });
  out.querySelectorAll("#tbr-search-jump").forEach(btn => {
    btn.addEventListener("click", () => {
      // Jump within the VISIBLE pane only.
      const pane = out.querySelector(".tbr-tabpane:not([hidden])") || out;
      const first = pane.querySelector(".tbr-chip.tbr-match");
      if (first) {
        first.closest(".tbr-bucket")?.classList.remove("collapsed"); // reveal if collapsed
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        first.classList.add("tbr-flash");
        setTimeout(() => first.classList.remove("tbr-flash"), 1200);
      }
    });
  });

  // Collapse / expand a bucket by clicking its head.
  out.querySelectorAll(".tbr-bucket-head[data-collapse]").forEach(head => {
    head.addEventListener("click", () => {
      const id = head.getAttribute("data-collapse");
      const box = head.closest(".tbr-bucket");
      const nowCollapsed = box.classList.toggle("collapsed");
      // Keep both panes' copies of this bucket in sync (id is shared across tabs
      // only for __unmapped__/__zero__; line buckets are unique per pane).
      if (nowCollapsed) _collapsed.add(id); else _collapsed.delete(id);
    });
  });

  // "Collapse empty" — collapse every empty bucket in the VISIBLE pane; if all
  // empties there are already collapsed, expand them again (toggle).
  out.querySelectorAll("#tbr-collapse-empty").forEach(btn => {
    btn.addEventListener("click", () => {
      const pane = btn.closest(".tbr-tabpane") || out;
      const empties = [...pane.querySelectorAll(".tbr-bucket")]
        .filter(b => !b.querySelector(".tbr-chip"));
      const anyOpen = empties.some(b => !b.classList.contains("collapsed"));
      empties.forEach(b => {
        const id = b.getAttribute("data-bucket");
        if (anyOpen) { b.classList.add("collapsed"); _collapsed.add(id); }
        else { b.classList.remove("collapsed"); _collapsed.delete(id); }
      });
    });
  });

  // Re-apply any active filter on (re-)render so it survives drag-drops.
  applyMapFilter(out);
}

/**
 * Apply the live search filter to the mapping panel in `out` (DOM-only):
 *  - chips whose data-search includes _search get .tbr-match; others get .tbr-dim
 *  - buckets containing a match get .tbr-has-match (so you see WHERE it lives)
 *  - the count readout + jump button update.
 * With no search term, all marks are cleared.
 */
function applyMapFilter(out) {
  const term = _search;
  const chips = out.querySelectorAll(".tbr-chip");
  // Each pane has its own toolbar copy — update them all.
  const countEls = out.querySelectorAll("#tbr-search-count");
  const jumpBtns = out.querySelectorAll("#tbr-search-jump");
  const clearBtns = out.querySelectorAll("#tbr-search-clear");
  const setHidden = (els, hide) => els.forEach(el => hide ? el.setAttribute("hidden", "") : el.removeAttribute("hidden"));

  if (!term) {
    chips.forEach(c => c.classList.remove("tbr-match", "tbr-dim"));
    out.querySelectorAll(".tbr-bucket").forEach(b => b.classList.remove("tbr-has-match"));
    countEls.forEach(el => { el.textContent = ""; });
    setHidden(jumpBtns, true);
    setHidden(clearBtns, true);
    return;
  }

  let matches = 0;
  chips.forEach(c => {
    const hay = c.getAttribute("data-search") || "";
    const hit = hay.includes(term);
    c.classList.toggle("tbr-match", hit);
    c.classList.toggle("tbr-dim", !hit);
    if (hit) matches++;
  });
  out.querySelectorAll(".tbr-bucket").forEach(b => {
    b.classList.toggle("tbr-has-match", !!b.querySelector(".tbr-chip.tbr-match"));
  });
  // matches counts chips across BOTH panes (every account renders in each tab),
  // so report the per-pane figure: divide by the number of panes present.
  const paneCount = out.querySelectorAll(".tbr-tabpane").length || 1;
  const perPane = Math.round(matches / paneCount);
  countEls.forEach(el => { el.textContent = `${perPane} match${perPane === 1 ? "" : "es"}`; });
  setHidden(clearBtns, false);
  setHidden(jumpBtns, matches === 0);
}

/**
 * Record a manual mapping override and re-map. targetId is a statement-line id
 * or "__unmapped__" (stored as an EXPLICIT override so an account that would
 * auto-detect stays where the user put it), OR null to CLEAR the override —
 * reverting the row to auto-detection. Clearing a zero-balance row lets
 * isZeroParked() send it back to the "No activity" area.
 */
function applyOverride(rowIndex, targetId) {
  if (targetId === null) delete state.overrides[rowIndex];
  else state.overrides[rowIndex] = targetId;
  // A manual edit supersedes the "restored from previous upload" notice.
  state.restoredCount = 0;
  // Persist for this company so the manual mapping survives future uploads.
  saveOverrides(state.primary);
  // Re-map + re-render (preserves the active tab via _mapTab).
  runMapping();
}

/**
 * Apply one target to MANY rows at once (bulk move), then save + re-map ONCE.
 * `targetId` null clears the override (re-auto-detect / re-park zero rows),
 * "__unmapped__" excludes them. Clears the selection afterwards.
 */
function applyOverridesBulk(rowIndexes, targetId) {
  if (!rowIndexes || !rowIndexes.length) return;
  for (const rowIndex of rowIndexes) {
    if (targetId === null) delete state.overrides[rowIndex];
    else state.overrides[rowIndex] = targetId;
  }
  state.restoredCount = 0;
  _selected.clear();
  _selectAnchor = null;
  saveOverrides(state.primary);
  runMapping();
}

/** Closing net for a parsed row by its rowIndex (0 if not found). */
function rowClosingNet(rowIndex) {
  const row = (state.primary?.rows || []).find(r => r.rowIndex === rowIndex);
  return row ? (row.closingNet || 0) : 0;
}

// ---- Multi-select helpers -------------------------------------------------

function toggleSelect(row) {
  if (_selected.has(row)) _selected.delete(row);
  else _selected.add(row);
}

/**
 * Shift-click range select: select every chip between the anchor and the
 * clicked chip, in DOM order WITHIN the same bucket body (ranges across
 * different buckets don't make sense). Adds to the current selection.
 */
function selectRangeTo(out, chip, row) {
  const body = chip.closest(".tbr-bucket-body");
  if (!body) { toggleSelect(row); _selectAnchor = row; return; }
  const rowsInBody = [...body.querySelectorAll(".tbr-chip")]
    .map(c => Number(c.getAttribute("data-rowindex")));
  const ai = rowsInBody.indexOf(_selectAnchor);
  const bi = rowsInBody.indexOf(row);
  if (ai === -1 || bi === -1) { toggleSelect(row); _selectAnchor = row; return; }
  const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
  for (let i = lo; i <= hi; i++) _selected.add(rowsInBody[i]);
}

/** Reflect _selected onto every chip copy (both tab panes) + show a count pill. */
function syncSelectionUI(out) {
  out.querySelectorAll(".tbr-chip").forEach(c => {
    const r = Number(c.getAttribute("data-rowindex"));
    c.classList.toggle("selected", _selected.has(r));
  });
  out.querySelectorAll("[data-sel-count]").forEach(el => {
    const n = _selected.size;
    el.textContent = n ? `${n} selected — drag any one to move them together` : "";
    el.toggleAttribute("hidden", n === 0);
  });
}

// ---- Drag auto-scroll (reach off-screen buckets in long lists) -------------
let _dragEl = null;         // the chip element currently being dragged
let _dragRow = null;        // rowIndex of the chip currently being dragged
let _dragRows = [];         // ALL rowIndexes moving in the current drag (bulk)
let _dragIsZero = false;    // whether the dragged chip has a zero closing balance
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

// Live Chart.js instances — destroyed before each re-render / reset.
let _pnlChart = null;            // P&L profitability-ratios bars (existing)
// (BS assets-vs-financing composition is now SVG — no Chart.js instance to hold.)
let _pnlWaterfallChart = null;   // P&L revenue→net-profit waterfall (current year)
let _pnlWaterfallChart2 = null;  // prior-year mini-waterfall (comparative only)

// ---- Chart palette (from the validated data-viz reference categorical set) ----
// Light-surface slots, fixed order = the CVD-safety mechanism (worst adjacent
// ΔE 24.2). Cards render on white, brighter than the reference surface, so
// contrast only improves; aqua/yellow are sub-3:1 on white, mitigated by the
// direct value labels every chart here carries (the "relief rule").
const VIZ = {
  blue:   "#2a78d6",
  aqua:   "#1baf7a",
  yellow: "#eda100",
  green:  "#008300",
  violet: "#4a3aa7",
  red:    "#e34948",
  orange: "#eb6834",
  // Chart chrome / ink (reference "Chart chrome & ink", light column).
  ink:     "#0b0b0b",
  ink2:    "#52514e",
  muted:   "#898781",
  grid:    "#e1e0d9",
  neutral: "#c3c2b7",  // subtotal / anchor bars in the waterfall
};
// Status palette (fixed, never themed) — matches the ratio status badges so the
// gauge reads consistently with the commentary.
const VIZ_STATUS = { good: "#0ca30c", warning: "#fab219", bad: "#d03b3b" };

/**
 * Minimal inline Chart.js plugin: draw a value label on each bar/segment.
 * Vendored Chart.js here has no datalabels plugin, and the hub forbids adding CDN/
 * vendor deps for this, so we register a tiny local one. Per-dataset `dataLabel`:
 *   { insideColor, outsideColor, format(v,ctx)->string, skipZero, minInside }
 * A bar tall enough (>= minInside px) gets the label centred INSIDE in insideColor;
 * a short bar gets it just ABOVE the bar in outsideColor, so tiny steps stay
 * readable instead of a label crushed onto a 2px sliver (per marks-and-anatomy:
 * measure first, move outside if it won't fit; never crop).
 */
const tbrDataLabels = {
  id: "tbrDataLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, di) => {
      const cfg = ds.dataLabel;
      if (!cfg) return;
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      const minInside = cfg.minInside ?? 22;
      ctx.save();
      ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      meta.data.forEach((el, i) => {
        const raw = ds.data[i];
        // Floating bars arrive as [start,end]; magnitude is the span between them.
        const val = Array.isArray(raw) ? (raw[1] - raw[0]) : raw;
        if (val == null || (cfg.skipZero && Math.abs(val) < 0.005)) return;
        const { x, y, base } = el.getProps(["x", "y", "base"], true);
        const span = Math.abs((base ?? 0) - y);
        const text = cfg.format ? cfg.format(val, { di, i }) : String(val);
        const top = Math.min(y, base ?? 0);
        if (span >= minInside) {
          ctx.fillStyle = cfg.insideColor || "#fff";
          ctx.textBaseline = "middle";
          ctx.fillText(text, x, (y + (base ?? 0)) / 2);
        } else {
          ctx.fillStyle = cfg.outsideColor || VIZ.ink2;
          ctx.textBaseline = "bottom";
          ctx.fillText(text, x, top - 3); // just above the (short) bar
        }
      });
      ctx.restore();
    });
  },
};

/**
 * Waterfall connector plugin: draws the thin horizontal "step" lines that link
 * each bar's landing level to the next bar, so the chart reads as a cascade
 * (Revenue → less COGS → Gross → …) instead of disconnected columns. Reads
 * chart.$waterfallConnect = [{ from:index, y:value }] set by the waterfall
 * builder; drawn BEFORE the bars so bars sit on top of the hairline.
 */
const tbrWaterfallConnectors = {
  id: "tbrWaterfallConnectors",
  beforeDatasetsDraw(chart) {
    const spec = chart.$waterfallConnect;
    if (!spec) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data.length) return;
    const { ctx } = chart;
    const yScale = chart.scales.y;
    ctx.save();
    ctx.strokeStyle = VIZ.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    for (const c of spec) {
      const a = meta.data[c.from], b = meta.data[c.from + 1];
      if (!a || !b) continue;
      const yPix = yScale.getPixelForValue(c.y);
      // from the right edge of bar `from` to the left edge of the next bar
      ctx.beginPath();
      ctx.moveTo(a.x + a.width / 2, yPix);
      ctx.lineTo(b.x - b.width / 2, yPix);
      ctx.stroke();
    }
    ctx.restore();
  },
};
let _tbrPluginRegistered = false;
function ensureChartPlugin() {
  if (_tbrPluginRegistered || typeof window.Chart === "undefined") return;
  window.Chart.register(tbrDataLabels, tbrWaterfallConnectors);
  _tbrPluginRegistered = true;
}

/** Destroy all live chart instances (before re-render / on reset). */
function destroyCharts() {
  if (_pnlChart) { try { _pnlChart.destroy(); } catch (_) {} _pnlChart = null; }
  if (_pnlWaterfallChart) { try { _pnlWaterfallChart.destroy(); } catch (_) {} _pnlWaterfallChart = null; }
  if (_pnlWaterfallChart2) { try { _pnlWaterfallChart2.destroy(); } catch (_) {} _pnlWaterfallChart2 = null; }
}

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
      animation: false,   // instant final render — no grow-from-zero animation, so
                          // a PDF capture right after (re)render is never mid-animation
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

// ============================================================
// BS-1 — Assets vs Financing composition (stacked bars)
// Two stacked bars: what the assets are made of, and how they're financed. They
// are the same height by construction (the sheet balances), which is the visual
// proof it ties out, while each bar's segments show the mix.
// ============================================================

/** Markup: the composition chart card (SVG host — filled by renderBsCompositionChart). */
function renderBsCharts(m) {
  return `
    <div class="tbr-card">
      <h3 class="tbr-chart-title">Assets vs Financing</h3>
      <p class="tbr-chart-sub">The accounting identity: <strong>Total Assets = Liabilities + Equity</strong>. Each bar's bands show the mix; negative equity shows as a red deficit band. With a comparative loaded, each side shows Year 1 (current) next to Year 2 (prior).</p>
      <div id="tbr-bs-composition"></div>
    </div>
    ${renderBsGaugeCard(m)}`;
}

/**
 * Assets vs Financing as two EQUAL-HEIGHT bars (SVG). Both bars represent the same
 * total (Total Assets = Liabilities + Equity, always equal), so their heights match
 * by construction — the reader compares the *mix*, not guesses whether it balances.
 *
 * SVG (not Chart.js) is deliberate: it gives exact height control, sidesteps
 * stacked-bar negative-value quirks, and renders into the PDF clone like the gauge.
 *
 * Negative equity (accumulated losses) is the case a naive stacked bar mangles.
 * Here the financing bar is always drawn to the full Total-Assets height; the
 * liability bands fill from the bottom, and negative equity is shown as a distinct
 * RED "deficit" band. Because liabilities then exceed total assets, the deficit
 * band overlays the top portion — clearly labelled — instead of a giant below-zero
 * overhang that crushes the asset bars.
 */
function renderBsCompositionChart(m) {
  const host = document.getElementById("tbr-bs-composition");
  if (!host) return;
  const t = m.balanceSheet.totals;
  const val = (k, yr) => num(t[k]?.[yr]);
  // Comparative when a prior column exists (2nd TB loaded, or opening balances).
  const hasComp = !!m.meta.hasComparative && t.totalAssets?.prior != null;
  const years = hasComp ? ["current", "prior"] : ["current"];

  // The two sides' bands for a given year (signed — any section may be negative:
  // a fixed-asset pool net of depreciation, a debit-balance creditor, or
  // accumulated-loss equity).
  const bandsFor = (yr) => ({
    assets: [
      { label: "Current Assets", value: val("currentAssets", yr), color: VIZ.blue },
      { label: "Fixed Assets",   value: val("fixedAssets",   yr), color: VIZ.aqua },
    ],
    fin: [
      { label: "Current Liabilities",   value: val("currentLiabilities",   yr), color: VIZ.yellow },
      { label: "Long-term Liabilities", value: val("longTermLiabilities",  yr), color: VIZ.orange },
      { label: "Equity",                value: val("equity",               yr), color: VIZ.violet },
    ],
  });

  const grossPos = (bands) => bands.reduce((s, b) => s + Math.max(0, b.value), 0);
  const net      = (bands) => bands.reduce((s, b) => s + b.value, 0);

  // Scale to the largest gross-positive stack across BOTH sides and BOTH years, so
  // every bar shares one axis and nothing overflows (year-on-year heights are then
  // directly comparable).
  let scale = 1;
  for (const yr of years) { const b = bandsFor(yr); scale = Math.max(scale, grossPos(b.assets), grossPos(b.fin)); }

  // Geometry. Single year: two wide bars. Comparative: each side is a Year1/Year2
  // pair (narrower bars) so the two periods sit next to each other.
  const W = 620, H = 300, padTop = 14, padBottom = 40, barTop = padTop, barH = H - padTop - padBottom;
  const baseY = barTop + barH;
  const DEFICIT_FILL = "#f3d2d2", DEFICIT_STROKE = "#c0392b";
  const px = (v) => (Math.abs(v) / scale) * barH;

  // Draw one stacked bar at x/width. Positives stack up; negatives draw as RED
  // reducing bands stepping down from the positive-stack top. `faded` dims the
  // Year-2 (prior) bars. Returns { svg, netTopY }.
  const drawBar = (x, barW, bands, faded) => {
    const op = faded ? ' opacity="0.5"' : "";
    const out = [];
    let yTop = baseY;
    for (const b of bands) {
      if (b.value <= 0) continue;
      const h = px(b.value); if (h < 0.5) continue;
      const y = yTop - h;
      out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${b.color}"${op} rx="2"/>`);
      if (h >= 22 && barW >= 60) out.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(y + h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">${escapeHtml(fmtShort(b.value))}</text>`);
      yTop = y;
    }
    let yNeg = yTop;
    for (const b of bands) {
      if (b.value >= 0) continue;
      const h = px(b.value); if (h < 0.5) continue;
      out.push(`<rect x="${x.toFixed(1)}" y="${yNeg.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${DEFICIT_FILL}" stroke="${DEFICIT_STROKE}" stroke-width="1.25" stroke-dasharray="4 2"${op} rx="2"/>`);
      if (h >= 22 && barW >= 60) out.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(yNeg + h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${DEFICIT_STROKE}">−${escapeHtml(fmtShort(Math.abs(b.value)))}</text>`);
      yNeg += h;
    }
    return { svg: out.join(""), netTopY: yNeg };
  };

  // Layout: build a flat list of bar columns + per-group centre for the axis label.
  const barSvg = [], netLineSvg = [], barLabels = [], groupLabels = [];
  const anyNeg = years.some(yr => { const b = bandsFor(yr); return [...b.assets, ...b.fin].some(x => x.value < 0); });

  if (!hasComp) {
    const barW = 190, gap = 110, x0 = (W - (barW * 2 + gap)) / 2;
    const b = bandsFor("current");
    const cols = [
      { x: x0,                 bands: b.assets, group: "Assets",    total: net(b.assets) },
      { x: x0 + barW + gap,    bands: b.fin,    group: "Financing", total: net(b.fin) },
    ];
    for (const c of cols) {
      const r = drawBar(c.x, barW, c.bands, false);
      barSvg.push(r.svg);
      if (anyNeg) netLineSvg.push(`<line x1="${(c.x - 6).toFixed(1)}" y1="${r.netTopY.toFixed(1)}" x2="${(c.x + barW + 6).toFixed(1)}" y2="${r.netTopY.toFixed(1)}" stroke="${VIZ.ink}" stroke-width="1.25"/>`);
      groupLabels.push({ cx: c.x + barW / 2, txt: c.group, sub: fmtShort(c.total) });
    }
  } else {
    // Comparative: two groups (Assets, Financing); each = Year1 + Year2 bars.
    const barW = 96, intra = 16, groupGap = 96;
    const groupW = barW * 2 + intra;
    const x0 = (W - (groupW * 2 + groupGap)) / 2;
    const groups = [
      { key: "assets", label: "Assets",    x: x0 },
      { key: "fin",    label: "Financing", x: x0 + groupW + groupGap },
    ];
    const cur = bandsFor("current"), pri = bandsFor("prior");
    for (const g of groups) {
      const yBars = [
        { x: g.x,               bands: (g.key === "assets" ? cur.assets : cur.fin), faded: false, yr: "Y1" },
        { x: g.x + barW + intra, bands: (g.key === "assets" ? pri.assets : pri.fin), faded: true,  yr: "Y2" },
      ];
      for (const yb of yBars) {
        const r = drawBar(yb.x, barW, yb.bands, yb.faded);
        barSvg.push(r.svg);
        if (anyNeg) netLineSvg.push(`<line x1="${yb.x.toFixed(1)}" y1="${r.netTopY.toFixed(1)}" x2="${(yb.x + barW).toFixed(1)}" y2="${r.netTopY.toFixed(1)}" stroke="${VIZ.ink}" stroke-width="1"/>`);
        barLabels.push({ cx: yb.x + barW / 2, txt: yb.yr, sub: fmtShort(net(yb.bands)) });
      }
      groupLabels.push({ cx: g.x + groupW / 2, txt: g.label, sub: "" });
    }
  }

  // Axis: group name (+ single-year total) low; in comparative, per-bar Y1/Y2 + total.
  const groupLabelSvg = groupLabels.map(l =>
    `<text x="${l.cx.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="13" font-weight="600" fill="${VIZ.ink}">${escapeHtml(l.txt)}</text>` +
    (l.sub ? `<text x="${l.cx.toFixed(1)}" y="${(H - 4 - 14).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${VIZ.ink2}">${escapeHtml(l.sub)}</text>` : "")
  ).join("");
  const barLabelSvg = barLabels.map(l =>
    `<text x="${l.cx.toFixed(1)}" y="${(H - 22).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="${VIZ.ink2}">${escapeHtml(l.txt)} ${escapeHtml(l.sub)}</text>`
  ).join("");

  // Legend: section colours (current-year amounts) + Year1/Year2 key when comparative.
  const cb = bandsFor("current");
  const legendItem = (label, value, color) =>
    `<span class="tbr-bs-comp-leg ${value < 0 ? "neg" : ""}"><i style="background:${value < 0 ? DEFICIT_FILL : color}"></i>${escapeHtml(label)}${hasComp ? "" : ` <b>${fmt(value)}</b>`}</span>`;
  const sectionLegend = [...cb.assets, ...cb.fin].map(b => legendItem(b.label, b.value, b.color)).join("");
  const yearLegend = hasComp
    ? `<div class="tbr-bs-comp-legend tbr-year-key"><span class="tbr-bs-comp-leg"><i style="background:${VIZ.ink2}"></i>Year 1 (current)</span><span class="tbr-bs-comp-leg"><i style="background:${VIZ.ink2};opacity:.5"></i>Year 2 (prior)</span></div>`
    : "";

  const negs = [...cb.assets, ...cb.fin].filter(b => b.value < 0);
  let negNote = "";
  if (negs.length) {
    const names = negs.map(b => `${b.label} (${fmt(b.value)})`).join(", ");
    negNote = `<div class="tbr-bs-comp-note">⚠ Negative section${negs.length > 1 ? "s" : ""} (current year): <strong>${escapeHtml(names)}</strong>. ${
      (cb.fin.find(b => b.label === "Equity")?.value ?? 0) < 0
        ? "Negative equity means liabilities exceed assets (balance-sheet insolvent)."
        : "A negative asset or liability often points to a contra on the wrong mapping line — worth reviewing."
    } Shown as red reducing bands; the black line marks each bar's net total.</div>`;
  }

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="tbr-bs-comp-svg" role="img"
         aria-label="Assets versus financing composition">
      <line x1="16" y1="${baseY}" x2="${W - 16}" y2="${baseY}" stroke="${VIZ.neutral}" stroke-width="1"/>
      ${barSvg.join("")}
      ${netLineSvg.join("")}
      ${barLabelSvg}
      ${groupLabelSvg}
    </svg>
    ${yearLegend}
    <div class="tbr-bs-comp-legend">${sectionLegend}</div>
    ${negNote}`;
}

// ============================================================
// BS-2 — Current-ratio liquidity gauge (SVG bullet)
// One value judged against a standard: the health band (Bad / Caution / Good)
// with a needle at the company's current ratio. SVG (not canvas) so it renders
// crisply and also survives the PDF clone. Reuses the ratio's own thresholds.
// ============================================================

function renderBsGaugeCard(m) {
  const r = (m.bsRatios || []).find(x => x.id === "currentRatio");
  if (!r || r.current == null) return "";
  return `
    <div class="tbr-card">
      <h3 class="tbr-chart-title">Liquidity — Current Ratio</h3>
      <p class="tbr-chart-sub">Current assets ÷ current liabilities. The band shows the firm's health zones; the marker is this period.</p>
      <div id="tbr-bs-gauge"></div>
    </div>`;
}

/** Build the SVG bullet gauge for the current ratio. */
function renderBsGauge(m) {
  const host = document.getElementById("tbr-bs-gauge");
  if (!host) return;
  const r = (m.bsRatios || []).find(x => x.id === "currentRatio");
  if (!r || r.current == null) { host.innerHTML = ""; return; }

  // Scale 0..4 (current ratio rarely exceeds this; clamp the needle if it does).
  // Zones per BS_RATIO_DEFS.currentRatio: Bad <1.0 or >3.0; Good 1.5–3.0; the
  // 1.0–1.5 sliver is Caution. We render Bad│Caution│Good│Bad across 0..4.
  const MAX = 4;
  const W = 620, H = 96, padX = 16, trackY = 40, trackH = 26;
  const usableW = W - padX * 2;
  const x = (v) => padX + Math.max(0, Math.min(MAX, v)) / MAX * usableW;
  const zone = (a, b, fill) => `<rect x="${x(a).toFixed(1)}" y="${trackY}" width="${(x(b) - x(a)).toFixed(1)}" height="${trackH}" fill="${fill}" />`;
  const val = r.current;
  const prior = r.prior;
  const needleX = x(val);

  const tick = (v) => `
    <line x1="${x(v).toFixed(1)}" y1="${trackY + trackH}" x2="${x(v).toFixed(1)}" y2="${trackY + trackH + 5}" stroke="${VIZ.muted}" stroke-width="1"/>
    <text x="${x(v).toFixed(1)}" y="${trackY + trackH + 17}" fill="${VIZ.muted}" font-size="11" text-anchor="middle">${v}</text>`;

  const statusColor = r.statusCurrent === "Good" ? VIZ_STATUS.good
                    : r.statusCurrent === "Bad"  ? VIZ_STATUS.bad : VIZ_STATUS.warning;

  host.innerHTML = `
    <div class="tbr-gauge-headline">
      <span class="tbr-gauge-value" style="color:${statusColor}">${fmtDecimal(val)}</span>
      <span class="tbr-status tbr-status-${r.statusCurrent === "Good" ? "good" : r.statusCurrent === "Bad" ? "bad" : "caution"}">${r.statusCurrent || "—"}</span>
      ${prior != null ? `<span class="tbr-gauge-prior">prior ${fmtDecimal(prior)}</span>` : ""}
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="tbr-gauge-svg" role="img"
         aria-label="Current ratio ${fmtDecimal(val)}, status ${r.statusCurrent || "unknown"}">
      <!-- zones: Bad 0–1, Caution 1–1.5, Good 1.5–3, Bad 3–4 -->
      ${zone(0, 1.0, "#f3d2d2")}
      ${zone(1.0, 1.5, "#fbe6bf")}
      ${zone(1.5, 3.0, "#cfe9cf")}
      ${zone(3.0, MAX, "#f3d2d2")}
      <!-- ticks -->
      ${[0, 1, 1.5, 2, 3, 4].map(tick).join("")}
      ${prior != null ? `<line x1="${x(prior).toFixed(1)}" y1="${trackY - 6}" x2="${x(prior).toFixed(1)}" y2="${trackY + trackH + 6}" stroke="${VIZ.neutral}" stroke-width="2" stroke-dasharray="3 3"/>` : ""}
      <!-- needle -->
      <polygon points="${needleX.toFixed(1)},${trackY - 8} ${(needleX - 6).toFixed(1)},${trackY - 18} ${(needleX + 6).toFixed(1)},${trackY - 18}" fill="${VIZ.ink}"/>
      <line x1="${needleX.toFixed(1)}" y1="${trackY - 8}" x2="${needleX.toFixed(1)}" y2="${trackY + trackH + 6}" stroke="${VIZ.ink}" stroke-width="2.5"/>
    </svg>
    <div class="tbr-gauge-legend">
      <span><i style="background:#cfe9cf"></i>Good (1.5–3.0)</span>
      <span><i style="background:#fbe6bf"></i>Caution (1.0–1.5)</span>
      <span><i style="background:#f3d2d2"></i>Bad (&lt;1.0 or &gt;3.0)</span>
    </div>`;
}

// ============================================================
// PL-1 — Profit waterfall (Revenue → Net Profit)
// A cascade: start at Revenue, step down through each deduction, with the three
// subtotals (Gross / Operating / Net Profit) as anchored bars from zero. Shows
// where the money goes — the single most legible read of the P&L.
// ============================================================

function renderPnlWaterfallCard(m) {
  const hasComp = !!m.meta.hasComparative && !!m.__pnlPrior?.pnl && !!m.pnl.derived.prior;
  const sub = `<strong>Grey</strong> bars are running subtotals (Revenue → Gross → Operating → Net); <strong style="color:#d03b3b">red</strong> bars are the deductions between them. The dotted line carries each subtotal down to the next step.`;
  if (!hasComp) {
    return `
    <div class="tbr-card">
      <h3 class="tbr-chart-title">Profit Waterfall</h3>
      <p class="tbr-chart-sub">${sub}</p>
      <div class="tbr-chartwrap"><canvas id="tbr-pnl-waterfall" height="320"></canvas></div>
    </div>`;
  }
  // Comparative: two stacked mini-waterfalls sharing one y-scale so the periods
  // compare directly. Year 1 (current) above, Year 2 (prior) below.
  return `
    <div class="tbr-card">
      <h3 class="tbr-chart-title">Profit Waterfall</h3>
      <p class="tbr-chart-sub">${sub} Two periods shown for comparison — both on the same scale.</p>
      <div class="tbr-wf-mini-label">Year 1 — current period</div>
      <div class="tbr-chartwrap tbr-chartwrap-mini"><canvas id="tbr-pnl-waterfall" height="230"></canvas></div>
      <div class="tbr-wf-mini-label">Year 2 — prior period</div>
      <div class="tbr-chartwrap tbr-chartwrap-mini"><canvas id="tbr-pnl-waterfall-2" height="230"></canvas></div>
    </div>`;
}

function renderPnlWaterfall(m) {
  const canvas = document.getElementById("tbr-pnl-waterfall");
  if (!canvas || typeof window.Chart === "undefined") return;
  ensureChartPlugin();
  if (_pnlWaterfallChart) { _pnlWaterfallChart.destroy(); _pnlWaterfallChart = null; }
  if (_pnlWaterfallChart2) { _pnlWaterfallChart2.destroy(); _pnlWaterfallChart2 = null; }

  // Build the fixed 8-step cascade for one year's figures. Each step: a label; its
  // bar as [start,end]; a role ("total" = subtotal anchored from 0; "down" = a
  // deduction); and `value` = the SIGNED figure (subtotal's own amount, or the
  // deduction magnitude) — what labels/tooltips use, so a NEGATIVE subtotal
  // (loss-making EBIT/Net Profit) still labels its real figure.
  const buildSteps = (p, d) => {
    const revenue = num(p?.revenue), cogs = num(p?.costOfSales), opex = num(p?.operatingExpenses),
          depr = num(p?.depreciation), tax = num(p?.tax);
    const gross = num(d?.grossProfit), oper = num(d?.operatingProfit), net = num(d?.netProfit);
    return [
      { label: "Revenue",          range: [0, revenue],          role: "total", value: revenue },
      { label: "Cost of Sales",    range: [gross, revenue],      role: "down",  value: -cogs },
      { label: "Gross Profit",     range: [0, gross],            role: "total", value: gross },
      { label: "Operating Exp.",   range: [oper, gross],         role: "down",  value: -opex },
      { label: "Operating Profit", range: [0, oper],             role: "total", value: oper },
      { label: "Deprec. & Amort.", range: [oper - depr, oper],   role: "down",  value: -depr },
      { label: "Taxation",         range: [net, oper - depr],    role: "down",  value: -tax },
      { label: "Net Profit",       range: [0, net],              role: "total", value: net },
    ].map(s => ({ ...s,
      trueRange: [Math.min(s.range[0], s.range[1]), Math.max(s.range[0], s.range[1])],
      landing: s.role === "total" ? s.value : Math.min(s.range[0], s.range[1]),
    }));
  };

  const curSteps = buildSteps(m.__pnlCurrent?.pnl, m.pnl.derived.current);
  const hasComp = !!m.meta.hasComparative && !!m.__pnlPrior?.pnl && !!m.pnl.derived.prior;
  const priSteps = hasComp ? buildSteps(m.__pnlPrior.pnl, m.pnl.derived.prior) : null;

  // Shared axis + min-visible-height across BOTH years, so the two mini-waterfalls
  // are directly comparable (a bar that's taller in Year 1 really is bigger).
  const allSteps = [...curSteps, ...(priSteps || [])];
  const yMax = Math.max(0, ...allSteps.map(s => s.trueRange[1]));
  const yMin = Math.min(0, ...allSteps.map(s => s.trueRange[0]));
  const MINSPAN = Math.max(yMax - yMin, 1) * 0.012;
  const colorFor = (s) => s.role === "total" ? VIZ.neutral : (s.role === "up" ? VIZ.green : VIZ.red);

  // Draw ONE complete cascade (drop zero deductions, dashed connectors, in-bar
  // labels) into a given canvas, on the shared [yMin,yMax] scale. Returns the chart.
  const makeCascade = (canvasEl, allYearSteps) => {
    const steps = allYearSteps.filter(s => s.role === "total" || Math.abs(s.value) >= 0.005);
    const drawRange = steps.map(s => {
      const [lo, hi] = s.trueRange;
      if (s.role !== "total" && (hi - lo) < MINSPAN && (hi - lo) > 0) {
        const mid = (lo + hi) / 2; return [mid - MINSPAN / 2, mid + MINSPAN / 2];
      }
      return [lo, hi];
    });
    canvasEl.__wfSteps = steps; // for tooltip
    const chart = new window.Chart(canvasEl.getContext("2d"), {
      type: "bar",
      data: {
        labels: steps.map(s => s.label),
        datasets: [{
          label: "P&L",
          data: drawRange,
          backgroundColor: steps.map(colorFor),
          borderWidth: 0, borderRadius: 3, maxBarThickness: 46,
          dataLabel: {
            insideColor: "#ffffff", outsideColor: VIZ.ink2, minInside: 22, skipZero: true,
            format: (_v, ctx) => { const fig = steps[ctx.i].value; return Math.abs(fig) < 0.005 ? "" : fmtShort(fig); },
          },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 18 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => { const s = canvasEl.__wfSteps[c.dataIndex]; return s ? `${s.label}: ${fmt(s.value)}` : ""; } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: VIZ.ink2, maxRotation: 40, minRotation: 0, font: { size: 11 } } },
          y: { min: yMin, max: yMax, grid: { color: VIZ.grid }, ticks: { color: VIZ.muted, callback: (v) => fmtShort(v) } },
        },
      },
    });
    chart.$waterfallConnect = steps.map((s, i) => i < steps.length - 1 ? { from: i, y: s.landing } : null).filter(Boolean);
    chart.update();
    return chart;
  };

  // Single year: one cascade. Comparative: two stacked mini-cascades (Year 1
  // current on top, Year 2 prior below) sharing the scale computed above.
  _pnlWaterfallChart = makeCascade(canvas, curSteps);
  if (hasComp) {
    const canvas2 = document.getElementById("tbr-pnl-waterfall-2");
    if (canvas2) _pnlWaterfallChart2 = makeCascade(canvas2, priSteps);
  }
}

/** Compact money for axis ticks / in-bar labels: 12.3k, 4.5M, 890. */
function fmtShort(n) {
  if (n === null || n === undefined || !isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return Math.round(n).toLocaleString("en-GB");
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
 * Export the RESULTS (P&L + Balance Sheet statements + ratios + commentary) to a
 * PDF. Deliberately EXCLUDES the account-mapping panels (.tbr-mapping) — those are
 * a working tool, not a deliverable — by capturing only the result cards inside
 * each pane's .tbr-group.
 *
 * Each result card (.tbr-card) is captured as its own image and placed as a whole
 * block; a page break is inserted whenever the next block would overflow the page,
 * so a result table is never split across pages. (A single block taller than a
 * full page — only possible for a long commentary card — falls back to slicing
 * just that one block.)
 */
/** Wire the "Download PDF ▾" split-button dropdown: toggle open/close, pick a
 *  scope, and close on outside-click / Escape. */
function wirePdfMenu(out) {
  const menu = out.querySelector("#tbr-pdf-menu");
  if (!menu) return;
  const trigger = menu.querySelector("#tbr-pdf");
  const dropdown = menu.querySelector(".tbr-pdf-dropdown");
  const close = () => { dropdown.hidden = true; trigger.setAttribute("aria-expanded", "false"); };
  const open = () => { dropdown.hidden = false; trigger.setAttribute("aria-expanded", "true"); };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.hidden ? open() : close();
  });
  dropdown.querySelectorAll("[data-pdf-scope]").forEach(item => {
    item.addEventListener("click", () => {
      close();
      onExportPdf(item.getAttribute("data-pdf-scope"));
    });
  });
  // Close on outside click / Escape.
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

/**
 * Rasterise a chart element to a PNG data-URL + its natural pixel size, WITHOUT
 * html2canvas. Charts are placed into the PDF directly via jsPDF.addImage, which
 * gives pixel-perfect fidelity and exact sizing — html2canvas 1.4.1 mangled them
 * (wrong fonts, off-centre bars for SVG; tiny corner mish-mash for canvas images).
 *
 * @returns {Promise<{dataUrl,w,h}|null>}  null if the element can't be rasterised.
 */
async function chartElementToImage(el) {
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === "canvas") {
    // Grab the live canvas bitmap 1:1. This is correct because the export
    // activates each pane on-screen before capturing (see onExportPdf) — a visible,
    // fully-rendered Chart.js canvas holds the complete image, INCLUDING per-
    // instance plugin output like the waterfall's dashed connectors (a rebuilt
    // clone would lose that instance state). No rebuild, no resize.
    try {
      return { dataUrl: el.toDataURL("image/png"), w: el.width, h: el.height };
    } catch (_) { return null; }
  }
  if (tag === "svg") {
    // Serialise the SVG, load it into an <img>, then paint it onto an offscreen
    // canvas at 2× for crispness. This is fully under our control — no html2canvas.
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || el.viewBox?.baseVal?.width || 620));
    const h = Math.max(1, Math.round(rect.height || el.viewBox?.baseVal?.height || 300));
    const copy = el.cloneNode(true);
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", w);
    copy.setAttribute("height", h);
    // Bake in the UI sans — a standalone serialised SVG otherwise rasterises text
    // in a default serif, which looks off in the PDF.
    copy.setAttribute("font-family", "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif");
    const xml = new XMLSerializer().serializeToString(copy);
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const img = new Image();
    const loaded = new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    img.src = svgUrl;
    try { await loaded; } catch (_) { return null; }
    const SCALE = 2;
    const cv = document.createElement("canvas");
    cv.width = w * SCALE; cv.height = h * SCALE;
    const cx = cv.getContext("2d");
    cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    try {
      return { dataUrl: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
    } catch (_) { return null; }
  }
  return null;
}

// Load the Treppides logo once (cached) for the PDF header. Resolves to a loaded
// <img> or null if it can't be fetched — the export never fails over a missing logo.
let _logoImgPromise = null;
function loadLogo() {
  if (_logoImgPromise) return _logoImgPromise;
  _logoImgPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/logo.png"; // served at the hub root (see sidebar.js)
  });
  return _logoImgPromise;
}

// Export the statements to PDF. `scope`:
//   "all" → both Balance Sheet and P&L (default)
//   "bs"  → Balance Sheet only (statement + its charts + ratios)
//   "pnl" → Profit & Loss only (statement + its charts + ratios)
async function onExportPdf(scope = "all") {
  const status = document.getElementById("tbr-status");
  const menuBtn = document.getElementById("tbr-pdf");   // the single "Download PDF ▾" button
  const btnLabel = menuBtn ? menuBtn.textContent : "Download PDF ▾";
  const root = document.getElementById("tbr-statements");
  if (!root) return;
  let stage = null;
  let _pdfPrevTab = null; // tab active before export, restored in finally
  try {
    await loadVendor();
    if (!window.jspdf || !window.html2canvas) throw new Error("PDF engine not loaded.");
    if (menuBtn) { menuBtn.disabled = true; menuBtn.textContent = "Preparing PDF…"; }

    // Which panes to include. "all" → both; "bs"/"pnl" → just that one.
    const wantPanes = Array.from(root.querySelectorAll(".tbr-tabpane"))
      .filter(p => scope === "all" || p.getAttribute("data-pane") === scope);

    // Record the current tab so we can restore it after export. A Chart.js canvas
    // only paints a correct, full-size bitmap while its pane is genuinely VISIBLE
    // (a hidden display:none pane → 0×0 → the "tiny mess in the corner"). Every
    // off-screen resize trick raced and failed. So below we capture each pane's
    // cards while that pane is briefly ACTIVE on-screen, via the tool's own tab
    // switch — the exact path that renders charts correctly on a user click.
    _pdfPrevTab = (document.querySelector(".tbr-map-tab.active")?.getAttribute("data-maptab")) || "bs";

    // Off-screen staging container — only TEXT cards (tables/ratios/comments) get
    // cloned into it for html2canvas; charts are rasterised straight from the live
    // elements. Positioned far off-screen so the visible page never reflows.
    // CRITICAL: append it INSIDE #section-tbratio so the tool's scoped CSS
    // (#section-tbratio .tbr-card / .tbr-table …) styles the clones — otherwise the
    // captured text cards render unstyled.
    stage = document.createElement("div");
    stage.className = "tbr-pdf-stage";
    stage.style.cssText =
      "position:fixed; left:-10000px; top:0; width:900px; background:#fff; padding:0; z-index:-1;";
    (document.getElementById(SECTION_ID) || document.body).appendChild(stage);

    // Build the block list. Every card is cloned WHOLE (keeping its title,
    // subtitle, legend, notes); any chart element inside (canvas OR svg) is
    // rasterised and swapped for a static <img>, then the clone goes through
    // html2canvas. html2canvas can't reproduce a live canvas or inline SVG, but
    // renders an <img> + surrounding HTML reliably — so every chart card keeps its
    // full context and they all place identically. Text cards just clone as-is.
    const blocks = []; // {type:"heading",text} | {type:"text",el}
    for (const pane of wantPanes) {
      // Make THIS pane the active/visible one so its charts are fully rendered
      // (real size, correct bitmap + SVG layout) at the moment we rasterise them.
      const paneName = pane.getAttribute("data-pane");
      const tabBtn = document.querySelector(`.tbr-map-tab[data-maptab="${paneName}"]`);
      if (tabBtn && !tabBtn.classList.contains("active")) tabBtn.click();
      void root.offsetHeight;
      // One frame so a newly-activated pane has real layout — needed for the SVG
      // charts' getBoundingClientRect. Canvas charts are rebuilt fresh at a fixed
      // size in chartElementToImage(), so they don't depend on this at all.
      await new Promise(r => requestAnimationFrame(r));

      const group = pane.querySelector(".tbr-group");
      if (!group) continue;
      const title = group.querySelector(".tbr-group-title");
      blocks.push({ type: "heading", text: title ? title.textContent.trim() : "" });
      const cards = Array.from(group.querySelectorAll(":scope > .tbr-card"));
      for (const el of cards) {
        // Clone the WHOLE card so its title/subtitle/legend/notes are always kept.
        const clone = el.cloneNode(true);
        // Any chart element (canvas OR svg) inside it is rasterised and swapped for
        // a static <img> in the clone — html2canvas can't reproduce a live canvas
        // or inline SVG, but renders an <img> + the surrounding HTML perfectly. So
        // EVERY chart card carries its full on-page context (heading + description)
        // and they all place identically (centred). Text cards have no chart to
        // swap and clone as-is.
        const liveCharts = el.querySelectorAll("canvas, svg");
        const cloneCharts = clone.querySelectorAll("canvas, svg");
        for (let i = 0; i < cloneCharts.length; i++) {
          const raster = await chartElementToImage(liveCharts[i]);
          if (!raster) continue;
          const img = document.createElement("img");
          img.src = raster.dataUrl;
          // Fit the chart to its CARD, never to the live on-screen pixel width —
          // the live canvas can be wider than the 900px capture stage, which made
          // it overflow the card and html2canvas cropped the right edge (missing
          // Net Profit / ROE). width:100% + height:auto scales the raster down to
          // fit and preserves its (already-correct) aspect ratio.
          img.style.width = "100%";
          img.style.height = "auto";
          img.style.display = "block";
          img.style.margin = "0 auto";   // centre within the card
          // The canvas charts sit in .tbr-chartwrap (fixed height:260px). With the
          // img at height:auto that fixed height would clip it — let it grow.
          const wrap = cloneCharts[i].closest(".tbr-chartwrap");
          if (wrap) { wrap.style.height = "auto"; }
          cloneCharts[i].replaceWith(img);
        }
        stage.appendChild(clone);
        blocks.push({ type: "text", el: clone });
      }
    }

    // Let any swapped-in raster <img> decode before html2canvas reads it.
    await Promise.all(
      Array.from(stage.querySelectorAll("img")).map(img =>
        (img.complete && img.naturalWidth) ? Promise.resolve()
          : new Promise(res => { img.onload = img.onerror = res; })));

    // Capture every TEXT card (incl. SVG-chart cards) to its own canvas.
    for (const b of blocks) {
      if (b.type !== "text") continue;
      b.canvas = await window.html2canvas(b.el, { scale: 1.5, backgroundColor: "#ffffff", logging: false });
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 10;
    const contentW = pageW - margin * 2;
    const bottom = pageH - margin;

    // Document header: Treppides logo top-right, title + period top-left.
    const company = pdfTitle();
    const period = state.model?.meta?.periodLabel || "";
    let logoBottom = margin;
    const logo = await loadLogo();
    if (logo && logo.naturalWidth) {
      const logoW = 36; // mm
      const logoH = logoW * (logo.naturalHeight / logo.naturalWidth);
      try {
        doc.addImage(logo, "PNG", pageW - margin - logoW, margin - 2, logoW, logoH);
        logoBottom = margin - 2 + logoH;
      } catch (_) { /* logo optional — never block the export */ }
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(company, margin, margin + 4);
    if (period) { doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(period, margin, margin + 10); }
    // Start content below BOTH the title block and the logo, so nothing overlaps.
    let y = Math.max(margin + (period ? 16 : 10), logoBottom + 3);

    const HEADING_H = 9;   // mm reserved for a section heading
    const GAP = 4;         // mm gap between blocks

    // Output height (mm) of a captured card at the current content width.
    const textHmm = (b) => (b.canvas.height / b.canvas.width) * contentW;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === "heading") {
        if (!b.text) continue;
        // Keep a heading WITH its first block: never orphan a heading on a page
        // without what it introduces. Look ahead to the next placeable block.
        const next = blocks.slice(i + 1).find(x => x.type === "text");
        const needed = HEADING_H + (next ? textHmm(next) : 0);
        const atPageTop = y <= margin + 1;
        if (!atPageTop && y + needed > bottom) { doc.addPage(); y = margin; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(13);
        doc.text(b.text, margin, y + 6);
        y += HEADING_H;
        continue;
      }

      // TEXT block: place it whole; if taller than a page, slice across pages.
      const blockHmm = textHmm(b);
      const data = b.canvas.toDataURL("image/png");
      if (y + blockHmm <= bottom) {
        doc.addImage(data, "PNG", margin, y, contentW, blockHmm);
        y += blockHmm + GAP;
        continue;
      }
      if (blockHmm <= pageH - margin * 2) {
        doc.addPage(); y = margin;
        doc.addImage(data, "PNG", margin, y, contentW, blockHmm);
        y += blockHmm + GAP;
        continue;
      }
      const pxPerMm = b.canvas.width / contentW;
      let sy = 0, first = true;
      while (sy < b.canvas.height) {
        if (!first || y + 1 > bottom) { doc.addPage(); y = margin; }
        const slotPx = Math.floor((bottom - y) * pxPerMm);
        const sliceH = Math.min(slotPx, b.canvas.height - sy);
        const slice = document.createElement("canvas");
        slice.width = b.canvas.width;
        slice.height = sliceH;
        slice.getContext("2d").drawImage(b.canvas, 0, sy, b.canvas.width, sliceH, 0, 0, b.canvas.width, sliceH);
        const sliceHmm = sliceH / pxPerMm;
        doc.addImage(slice.toDataURL("image/png"), "PNG", margin, y, contentW, sliceHmm);
        y += sliceHmm + GAP;
        sy += sliceH;
        first = false;
      }
    }

    // Filename: shared "TB_<name>" base (see safeFileBase) + the scope suffix.
    const suffix = scope === "bs" ? "balance_sheet" : scope === "pnl" ? "profit_and_loss" : "financial_statements";
    doc.save(`${safeFileBase(state.model)}_${suffix}.pdf`);
  } catch (err) {
    console.error("TB Ratio Tool: PDF export failed", err);
    if (status) status.innerHTML = errorBanner("Could not generate the PDF. Try again, or use the .xlsx export.");
  } finally {
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);  // remove off-screen clone
    // Restore the tab the user was on before export (we switched tabs to render
    // each pane's charts for capture).
    if (_pdfPrevTab) {
      const btn = document.querySelector(`.tbr-map-tab[data-maptab="${_pdfPrevTab}"]`);
      if (btn && !btn.classList.contains("active")) btn.click();
    }
    if (menuBtn) { menuBtn.disabled = false; menuBtn.textContent = btnLabel; }
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

  // Comparative status — make the Prior column's source explicit, and give a
  // way to drop a loaded comparative. Three cases:
  //   secondTb → an explicit comparative TB was loaded (show its name + Remove)
  //   opening  → prior auto-filled from THIS TB's opening balances
  //   none     → single period, prior column blank
  if (m.meta.priorMode === "secondTb") {
    parts.push(okBanner(
      `Comparative loaded: the Prior column shows <strong>${escapeHtml(stripExt(state.priorFileName) || "the comparative TB")}</strong> (closing balances). ` +
      `<a href="#" id="tbr-remove-prior" class="tbr-link">Remove comparative</a>`
    ));
  } else if (m.meta.priorMode === "opening") {
    parts.push(infoBanner(
      `Prior column shows <strong>this TB's opening balances</strong> (no separate comparative loaded). ` +
      `Use “Add comparative TB” below to compare against a full prior-year trial balance instead.`
    ));
  } else {
    parts.push(infoBanner(`Single period detected — prior-year column left blank (not fabricated). Upload a comparative TB to fill it.`));
  }

  return parts.join("");
}

// Which mapping tab is showing ("bs" | "pnl"); preserved across re-renders.
let _mapTab = "bs";

// Discoverability state, preserved across the re-renders that drag-drops trigger:
//   _search    — current live-filter term (lowercased)
//   _collapsed — set of bucket ids (data-bucket) the user has collapsed
let _search = "";
const _collapsed = new Set();
// Multi-select: rowIndexes of chips the user has selected for a bulk move.
// Persists across the re-renders a move triggers; cleared after a bulk move.
const _selected = new Set();
// Anchor rowIndex for Shift-range selection (last plain/ctrl click).
let _selectAnchor = null;

/**
 * Drag-and-drop mapping panel for ONE statement (`which` = "bs" | "pnl").
 * EVERY account is available on BOTH tabs: an account auto-mapped to a line on
 * THIS statement shows in that line's bucket; anything else (auto-mapped to the
 * other statement, or unmapped) sits in this tab's "Unmapped" bucket, ready to
 * drag onto any line here. Zero-balance accounts park in the "No activity" area.
 * Dropping remaps immediately. The statement shown is driven by the shared
 * top-level tab strip (see render()), so this panel has no tab buttons of its own.
 */
function renderMappingPanel(m, which) {
  // One record per posting row (mapped + unmapped), keyed by rowIndex.
  const accounts = [
    ...m.assignments.map(a => ({ rowIndex: a.rowIndex, code: a.code, name: a.name, value: a.closingNet, targetId: a.targetId })),
    ...m.unmapped.map(u => ({ rowIndex: u.rowIndex, code: u.code, name: u.name, value: u.closingNet, targetId: "__unmapped__" })),
  ];

  // Accounts whose CLOSING balance nets to zero carry no debit/credit and add
  // nothing to the statements. To keep the buckets uncluttered, pull them into a
  // single collapsed "No activity" area at the bottom — UNLESS the user has
  // explicitly mapped one (an override), in which case respect that and leave it
  // on its line. This is display-only grouping; the model/statements are unchanged.
  const isZeroParked = (a) =>
    Math.abs(a.value || 0) < EPSILON &&
    state.overrides[a.rowIndex] === undefined;     // not user-pinned to a line
  const zeroAccounts = accounts.filter(isZeroParked);

  // The line-id sets for each statement. An account whose target is NOT a line on
  // THIS statement (i.e. it auto-mapped to the OTHER statement, or is unmapped)
  // simply sits in this tab's Unmapped bucket — every account is freely draggable
  // onto any line of the current tab. (No "move it across" holding area: that
  // wrongly locked out, e.g., using Tax on the P&L because it sat on the BS.)
  const thisTargets = which === "pnl" ? DEFAULT_MAPPING.pnlTargets : DEFAULT_MAPPING.bsTargets;
  const thisTargetIds = new Set(thisTargets.map(t => t.id));
  // Line ids that belong to the OTHER statement — used to tell "mapped on the
  // other sheet" apart from "mapped to nothing at all".
  const otherTargets = which === "pnl" ? DEFAULT_MAPPING.bsTargets : DEFAULT_MAPPING.pnlTargets;
  const otherTargetIds = new Set(otherTargets.map(t => t.id));
  const otherStatementName = which === "pnl" ? "Balance Sheet" : "Profit & Loss";

  // byTarget for the live buckets EXCLUDES parked-zero chips.
  const byTarget = (id) => accounts.filter(a => a.targetId === id && !isZeroParked(a));
  // Two separate lists for accounts not on a line of THIS statement (zero-parked
  // excluded from both):
  //   1. trulyUnmapped — mapped to NO line on either statement (target is
  //      "__unmapped__"). These are genuinely excluded from the figures.
  //   2. otherSheet — mapped to a line on the OTHER statement. Shown here, fully
  //      draggable, so the user can pull the account across onto a line on this tab.
  const trulyUnmapped = accounts.filter(a =>
    !isZeroParked(a) && a.targetId === "__unmapped__");
  const otherSheet = accounts.filter(a =>
    !isZeroParked(a) && otherTargetIds.has(a.targetId));

  // data-search holds a lowercased code+name haystack for the live filter.
  const chip = (a) => `
    <div class="tbr-chip${_selected.has(a.rowIndex) ? " selected" : ""}" draggable="true" data-rowindex="${a.rowIndex}"
         data-search="${escapeHtml(((a.code || "") + " " + (a.name || "")).toLowerCase())}"
         title="${escapeHtml(a.name)}">
      <span class="tbr-chip-code">${escapeHtml(a.code || "")}</span>
      <span class="tbr-chip-name">${escapeHtml(a.name || "(unnamed)")}</span>
      <span class="tbr-chip-val">${a.value === null || a.value === undefined ? "" : fmt(a.value)}</span>
    </div>`;

  // A drop bucket for one statement line. The head carries a count badge and a
  // collapse caret; collapsed state is keyed by data-bucket and restored across
  // re-renders from _collapsed.
  const bucketBox = (id, label, chips, extraClass = "", readonly = false) => {
    const n = chips.length;
    const collapsed = _collapsed.has(id);
    const bodyAttrs = readonly ? 'data-readonly="1"' : `data-target="${id}"`;
    return `
    <div class="tbr-bucket ${extraClass} ${collapsed ? "collapsed" : ""}" data-bucket="${escapeHtml(id)}">
      <div class="tbr-bucket-head" data-collapse="${escapeHtml(id)}">
        <span class="tbr-bucket-caret" aria-hidden="true">▾</span>
        <span class="tbr-bucket-label">${label}</span>
        <span class="tbr-bucket-count" data-count>${n}</span>
      </div>
      <div class="tbr-bucket-body ${readonly ? "tbr-bucket-body-readonly" : ""}" ${bodyAttrs}>${chips.map(chip).join("")}</div>
    </div>`;
  };

  const bucket = (t) => bucketBox(t.id, escapeHtml(t.label), byTarget(t.id));

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

  const unmappedBucket = bucketBox(
    "__unmapped__", "Unmapped — not on either statement; drag onto any line to include it",
    trulyUnmapped, "tbr-bucket-unmapped");

  // Accounts that ARE mapped, but on the other statement. Read-only source
  // bucket: you don't drop INTO it, you drag chips OUT of it onto a line here.
  const otherSheetBucket = otherSheet.length
    ? bucketBox("__othersheet__",
        `Available from the ${otherStatementName} — drag onto a line to use it here`,
        otherSheet, "tbr-bucket-othersheet", /* readonly */ true)
    : "";

  const targets = thisTargets;

  // Collapsed "No activity" area: accounts with a zero closing balance. Default-
  // collapsed (don't add to _collapsed automatically — instead seed it once below).
  const zeroBucket = zeroAccounts.length
    ? bucketBox("__zero__",
        "No activity — accounts with no debit or credit (zero balance)",
        zeroAccounts, "tbr-bucket-zero", /* readonly */ true)
    : "";

  // Discoverability toolbar: live search (dims non-matches, marks buckets with a
  // hit), a match count + jump-to-first, and a collapse-empty toggle. Wired in
  // wireMappingPanel(); search term + collapsed state persist across re-renders.
  const toolbar = `
    <div class="tbr-map-tools">
      <div class="tbr-search">
        <svg class="tbr-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" id="tbr-map-search" placeholder="Search accounts by code or name…"
               value="${escapeHtml(_search)}" autocomplete="off" spellcheck="false" />
        <button type="button" class="tbr-search-clear" id="tbr-search-clear" title="Clear" aria-label="Clear search" ${_search ? "" : "hidden"}>×</button>
      </div>
      <span class="tbr-search-count" id="tbr-search-count" aria-live="polite"></span>
      <button type="button" class="tbr-tool-btn" id="tbr-search-jump" ${_search ? "" : "hidden"}>Jump to match</button>
      <button type="button" class="tbr-tool-btn" id="tbr-collapse-empty">Collapse empty</button>
      <span class="tbr-sel-count" data-sel-count aria-live="polite" ${_selected.size ? "" : "hidden"}>${_selected.size ? `${_selected.size} selected — drag any one to move them together` : ""}</span>
    </div>`;

  return `
    <div class="tbr-card tbr-mapping">
      <div class="tbr-map-head">
        <div>
          <h3 class="tbr-map-title">Account Mapping</h3>
          <p class="tbr-hint">Auto-detected on upload. <strong>Drag any account</strong> onto any
            line — or drop it in empty space to unmap it. <strong>Click to select</strong> accounts
            (Ctrl/Cmd-click to add, Shift-click for a range), then drag any one to <strong>move them
            all together</strong>. <strong>Unmapped</strong> holds accounts on neither statement;
            <strong>Available from the other statement</strong> holds accounts mapped on the other
            tab, ready to drag across. Statements and ratios update instantly.</p>
        </div>
      </div>
      ${toolbar}

      <div class="tbr-buckets">${statementCols(targets)}</div>
      ${unmappedBucket}
      ${otherSheetBucket}
      ${zeroBucket}
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
        <p class="tbr-subtitle">Upload a trial balance sheet &rarr; Profit &amp; Loss, Balance Sheet &amp; ratios.</p>
      </div>
      <button type="button" class="tbr-clear-btn" id="tbr-clear-tb" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        </svg>
        Clear / New TB
      </button>
    </div>

    <div id="tbr-drop" class="tbr-drop" role="button" tabindex="0" aria-label="Upload trial balance">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p><strong>Drop a trial balance sheet here</strong> or click to choose a file</p>
      <p class="tbr-hint">.xlsx, .xls or .csv &middot; the file is processed in your browser and never uploaded</p>
      <input type="file" id="tbr-file" accept=".xlsx,.xls,.csv" hidden>
    </div>

    <div id="tbr-status"></div>
    <div id="tbr-output"></div>
  </div>
`;
