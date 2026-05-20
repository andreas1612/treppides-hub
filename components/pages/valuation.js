// ============================================================
// components/pages/valuation.js
// Auditor-facing valuation report builder.
// Ported from the standalone Valtrix tool (index.html + app.js + style.css).
// All Valtrix DOM IDs are preserved unchanged so html2canvas/jsPDF
// selectors keep working without edits.
// Mounts into: #section-valuation
// ============================================================

const SECTION_ID  = "section-valuation";
const BACK_BTN_ID = "valuation-back-btn";

// jsPDF + html2canvas are loaded lazily on first page open so the hub
// homepage isn't slowed down for users who never open this tool.
// Vendored locally — LAN browsers cannot reach a CDN.
const VENDOR_SCRIPTS = [
  "vendor/jspdf.umd.min.js",
  "vendor/html2canvas.min.js",
];

// ---- Page visibility -----------------------------------------

function showValuationPage() {
  const main = document.querySelector(".main");
  if (!main) return;
  main.classList.remove(
    "fees-active", "aml-active", "staff-active",
    "kb-active", "projects-active"
  );
  main.classList.add("valuation-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "valuation" } }));
  bootValuationOnce();
}

function hideValuationPage() {
  document.querySelector(".main")?.classList.remove("valuation-active");
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: "home" } }));
}

window.__hub_valuation = { show: showValuationPage, hide: hideValuationPage };

// ---- State that must outlive callbacks -----------------------
// In the original Valtrix app.js this lived at module scope too.

const referenceDataState = {
  industry: null,
  country: null,
  currency: null,
  changeInWorkingCapital: null,
};

// ---- Lazy vendor load + boot ---------------------------------

let _booted = false;
let _vendorPromise = null;

function loadVendor() {
  if (_vendorPromise) return _vendorPromise;
  _vendorPromise = Promise.all(VENDOR_SCRIPTS.map(src => new Promise((ok, fail) => {
    if ([...document.scripts].some(s => s.src === src)) return ok();
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = ok;
    tag.onerror = () => fail(new Error("Failed to load: " + src));
    document.head.appendChild(tag);
  })));
  return _vendorPromise;
}

async function bootValuationOnce() {
  if (_booted) return;
  _booted = true;
  try {
    await loadVendor();
  } catch (err) {
    console.error("Valuation: vendor load failed", err);
    _booted = false; // allow retry the next time the page is opened
    return;
  }
  bootValuation();
}

// ---- Component init ------------------------------------------

export default async function init(_config) {
  const section = document.getElementById(SECTION_ID);
  if (!section) return;

  section.innerHTML = SHELL_HTML;

  document.getElementById(BACK_BTN_ID)?.addEventListener("click", () => {
    hideValuationPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// ---- Page HTML -----------------------------------------------
// Verbatim port of the Valtrix <form> tree, wrapped in the hub
// page shell (back button + title + form-container).
// IDs are NOT prefixed - kept identical to the original so the
// ported app.js below works unchanged.

const SHELL_HTML = `
  <div class="val-container">
    <div class="valuation-header-left">
      <button class="valuation-back-btn" id="${BACK_BTN_ID}" aria-label="Back to Hub">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <div>
        <h2 class="val-page-title">Valuation Tool</h2>
        <p class="val-subtitle">Report input parameters &mdash; auditor report builder.</p>
      </div>
    </div>

    <div class="form-container">
      <form id="valuationForm" novalidate>
                      
                      <div class="tab-navigation">
                          <div class="tab-group tab-group--inputs" role="group" aria-label="Inputs">
                              <span class="tab-group-label">Inputs</span>
                              <div class="tab-group-buttons">
                                  <button type="button" class="tab-btn tab-btn--input active" data-target="tab-1">
                                      <svg class="tab-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                      <span>Project Setup</span>
                                  </button>
                                  <button type="button" class="tab-btn tab-btn--input" data-target="tab-2">
                                      <svg class="tab-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                      <span>Income Statement</span>
                                  </button>
                              </div>
                          </div>
                          <div class="tab-group-divider" aria-hidden="true"></div>
                          <div class="tab-group tab-group--results" role="group" aria-label="Results">
                              <span class="tab-group-label">Results</span>
                              <div class="tab-group-buttons">
                                  <button type="button" class="tab-btn tab-btn--result" data-target="tab-3">
                                      <svg class="tab-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="12" y2="14"></line></svg>
                                      <span>Cash Flow</span>
                                  </button>
                                  <button type="button" class="tab-btn tab-btn--result" data-target="tab-4">
                                      <svg class="tab-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                                      <span>DCF &amp; Sensitivity</span>
                                  </button>
                                  <button type="button" class="tab-btn tab-btn--result" data-target="tab-5">
                                      <svg class="tab-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                      <span>Valuation Summary &amp; Range</span>
                                  </button>
                              </div>
                          </div>
                      </div>
      
                      <div class="tab-content tab-content--input active" id="tab-1">
                      <div class="tab-banner tab-banner--input">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          <span>Enter your assumptions here &mdash; results update automatically in the Cash Flow, DCF and Summary tabs.</span>
                      </div>
                      <!-- Section 1: Company Overview -->
                      <details class="accordion-item native-details" open>
                          <summary class="accordion-header">
                              <span class="accordion-title">1. Company Overview</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="form-grid">
                                  <div class="input-group">
                                      <label for="companyName">Company's Name</label>
                                      <input type="text" id="companyName" name="companyName" placeholder="e.g. Acme Corp" required>
                                  </div>
                                  <div class="input-group full-width">
                                      <label for="companyDescription">Company Description</label>
                                      <textarea id="companyDescription" name="companyDescription" rows="4" placeholder="Brief overview of the company's operations..."></textarea>
                                  </div>
                                  <div class="input-group full-width">
                                      <label for="coverImage">Cover Image</label>
                                      <input type="file" id="coverImage" name="coverImage" accept=".jpg, .jpeg, .png">
                                      <div id="imagePreviewContainer" class="image-preview-container">
                                          <img id="imagePreview" alt="Cover Image Preview">
                                      </div>
                                  </div>
                                  <div class="input-group full-width dynamic-list-group">
                                      <label>Company UBO/Shareholders</label>
                                      <div id="shareholdersContainer">
                                          <div class="dynamic-list-item" style="display: grid; grid-template-columns: 2fr 1fr; gap: 0.5rem;">
                                              <input type="text" name="shareholders[]" placeholder="Enter shareholder name">
                                              <input type="number" name="shareholderPct[]" placeholder="% share" min="0" max="100" step="0.01">
                                          </div>
                                      </div>
                                      <button type="button" id="addShareholderBtn" class="btn btn-secondary btn-sm">+ Add Another Shareholder</button>
                                  </div>
                              </div>
                          </div>
                      </details>
      
                      <!-- Section 2: Valuation & Dates -->
                      <details class="accordion-item native-details">
                          <summary class="accordion-header">
                              <span class="accordion-title">2. Valuation & Dates</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="form-grid">
                                  <div class="input-group">
                                      <label for="valuationDate">Valuation Date</label>
                                      <input type="date" id="valuationDate" name="valuationDate" required>
                                  </div>
                                  <div class="input-group">
                                      <label for="referenceDate">Reference Date</label>
                                      <input type="date" id="referenceDate" name="referenceDate">
                                  </div>
                                  <div class="input-group">
                                      <label for="reportDate">Report Generation Date</label>
                                      <input type="date" id="reportDate" name="reportDate" required>
                                  </div>
                                  <div class="input-group">
                                      <label for="currency">Reporting Currency</label>
                                      <select id="currency" name="currency" required>
                                          <option value="" disabled selected>Select a currency...</option>
                                      </select>
                                  </div>
                                  <div class="input-group">
                                      <label for="valuationMethodology">Valuation Methodology</label>
                                      <select id="valuationMethodology" name="valuationMethodology">
                                          <option value="Equity value" selected>Equity value</option>
                                          <option value="Enterprise value">Enterprise value</option>
                                          <option value="IP Value">IP Value</option>
                                      </select>
                                  </div>
                                  <div class="input-group">
                                      <label for="baseYear">Base Historical Year</label>
                                      <input type="number" id="baseYear" name="baseYear" min="1990" max="2100" placeholder="e.g. 2024">
                                  </div>
                                  <div class="input-group">
                                      <label for="eurUsdRate">Exchange rate to USD <span title="Auto-populated from the valuation date + selected currency when reference data is available. Editable — overwrite if you have a more authoritative rate. The value is read as: 1 USD = rate × {currency}." style="cursor:help; border-bottom: 1px dotted #ccc;">ℹ️</span></label>
                                      <input type="number" id="eurUsdRate" name="eurUsdRate" step="0.0001" placeholder="e.g. 0.9627">
                                      <div class="calc-detail" id="usdRateHint" style="display: none; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.25rem;"></div>
                                  </div>
                                  <div class="input-group full-width">
                                      <label for="valuationScope">Scope of Valuation</label>
                                      <textarea id="valuationScope" name="valuationScope" rows="4" placeholder="Describe the purpose (e.g., M&A, internal reporting, tax)..."></textarea>
                                  </div>
                              </div>
                          </div>
                      </details>
      
                      <!-- Section 3: Corporate Legal Details -->
                      <details class="accordion-item native-details">
                          <summary class="accordion-header">
                              <span class="accordion-title">3. Corporate Legal Details</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="form-grid">
                                  <div class="input-group">
                                      <label for="continent">Continent</label>
                                      <select id="continent" name="continent" required>
                                          <option value="" disabled selected>Select a continent...</option>
                                      </select>
                                  </div>
                                  <div class="input-group">
                                      <label for="operatingCountry">Country</label>
                                      <select id="operatingCountry" name="operatingCountry" required>
                                          <option value="" disabled selected>Select a country...</option>
                                      </select>
                                  </div>
                                  <div class="input-group">
                                      <label for="industry">Company Industry</label>
                                      <select id="industry" name="industry" required>
                                          <option value="" disabled selected>Select an industry...</option>
                                      </select>
                                  </div>
                                  <div class="input-group">
                                      <label for="incCountry">Incorporation Country</label>
                                      <select id="incCountry" name="incCountry" disabled required>
                                          <option value="" disabled selected>Select continent first...</option>
                                      </select>
                                  </div>
                                  <div class="input-group">
                                      <label for="incDate">Incorporation Date</label>
                                      <input type="date" id="incDate" name="incDate" required>
                                  </div>
                                  <div class="input-group">
                                      <label for="legalForm">Legal Form</label>
                                      <input type="text" id="legalForm" name="legalForm" placeholder="e.g. Limited liability company">
                                  </div>
                                  <div class="input-group">
                                      <label for="regNumber">Registration Number</label>
                                      <input type="text" id="regNumber" name="regNumber" placeholder="e.g. 123456">
                                  </div>
                                  <div class="input-group full-width">
                                      <label for="registeredAddress">Company Registered Address</label>
                                      <textarea id="registeredAddress" name="registeredAddress" rows="3" placeholder="Full registered address..."></textarea>
                                  </div>
                              </div>
                          </div>
                      </details>
      
                      <!-- Section 4: Financial Parameters -->
                      <details class="accordion-item native-details">
                          <summary class="accordion-header">
                              <span class="accordion-title">4. Financial Parameters</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="form-grid">
                                  <div class="input-group">
                                      <label for="riskFreeRate">Risk-Free Rate (%)</label>
                                      <input type="number" id="riskFreeRate" name="riskFreeRate" step="0.01" placeholder="Select above..." readonly>
                                  </div>
                                  <div class="input-group">
                                      <label for="statutoryTaxRate">Statutory Tax Rate (%)</label>
                                      <input type="number" id="statutoryTaxRate" name="statutoryTaxRate" step="0.01" placeholder="Select above..." readonly>
                                  </div>
                                  <div class="input-group">
                                      <label for="taxRate">Effective Corporate Tax Rate (%)</label>
                                      <input type="number" id="taxRate" name="taxRate" step="0.01" placeholder="Select above..." readonly>
                                  </div>
                                  <div class="input-group">
                                      <label for="erp">Equity Risk Premium (%)</label>
                                      <input type="number" id="erp" name="erp" step="0.01" placeholder="Select above..." readonly>
                                  </div>
                                  <div class="input-group">
                                      <label for="changeInWorkingCapital">Change In Working Capital</label>
                                      <input type="number" id="changeInWorkingCapital" name="changeInWorkingCapital" step="0.01" placeholder="e.g. 50000.00">
                                  </div>
                                  <div class="input-group">
                                      <label for="revenueGrowthOverride">Revenue Growth Override (%) <span title="Annual growth rate applied uniformly to all P&L line items in the projection. Leave blank to use the industry-derived growth rate from reference data." style="cursor:help; border-bottom: 1px dotted #ccc;">ℹ️</span></label>
                                      <input type="number" id="revenueGrowthOverride" name="revenueGrowthOverride" step="0.01" placeholder="Blank = use industry default">
                                  </div>
                                  <div class="input-group">
                                      <label for="capex" id="capexLabel">Capital Expenditure (USD)</label>
                                      <input type="number" id="capex" name="capex" step="0.01" placeholder="e.g. 1500000.00">
                                  </div>
                                  <div class="input-group">
                                      <label for="investmentsShare">Investments Share <span title="Share of profit from investments / associates (e.g., equity-method income from JVs). Entered for the base year; subsequent years scale with the projection growth rate." style="cursor:help; border-bottom: 1px dotted #ccc;">ℹ️</span></label>
                                      <input type="number" id="investmentsShare" name="investmentsShare" step="0.01" placeholder="e.g. 25000.00">
                                  </div>
                                  <div class="input-group">
                                      <label id="summaryCashLabel" for="totalCash">Cash as at 31/12/2024</label>
                                      <input type="number" id="totalCash" name="totalCash" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="input-group">
                                      <label id="summaryDebtLabel" for="totalDebt">Debt 31/12/2024</label>
                                      <input type="number" id="totalDebt" name="totalDebt" step="0.01" placeholder="0.00">
                                  </div>
                              </div>
                          </div>
                      </details>

                      </div>

                      <div class="tab-content tab-content--input" id="tab-2">
                      <div class="tab-banner tab-banner--input">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          <span>Enter the historical income statement. Projected results flow into the Cash Flow, DCF and Summary tabs.</span>
                      </div>
                      <div class="calc-toggle-bar">
                          <button type="button" class="calc-toggle" data-calc-toggle>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="12" y2="14"></line></svg>
                              <span class="calc-toggle-label">Show Calculations</span>
                          </button>
                      </div>
                      <!-- Section 5: Audited Financial Statements - Income Statement -->
                      <details class="accordion-item native-details">
                          <summary class="accordion-header">
                              <span class="accordion-title">5. Audited Financial Statements - Income Statement</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="ledger-container" style="padding: 0 1.5rem 1.5rem 1.5rem;">
                                  <div class="ledger-row">
                                      <label for="revenue">Revenue</label>
                                      <input type="number" id="revenue" class="calc-input" name="revenue" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="cogs">Cost of sales</label>
                                      <input type="number" id="cogs" class="calc-input" name="cogs" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row total-row">
                                      <label for="grossProfit">Gross Profit</label>
                                      <input type="text" id="grossProfit" name="grossProfit" readonly placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="otherIncome">Other operating income</label>
                                      <input type="number" id="otherIncome" class="calc-input" name="otherIncome" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="adminExpenses">Administration expenses</label>
                                      <input type="number" id="adminExpenses" class="calc-input" name="adminExpenses" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="depreciation">Depreciation</label>
                                      <input type="number" id="depreciation" class="calc-input" name="depreciation" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="otherExpenses">Other expenses</label>
                                      <input type="number" id="otherExpenses" class="calc-input" name="otherExpenses" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row total-row">
                                      <label for="operatingProfit">Operating profit</label>
                                      <input type="text" id="operatingProfit" name="operatingProfit" readonly placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="financeIncome">Finance Income</label>
                                      <input type="number" id="financeIncome" class="calc-input" name="financeIncome" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="financeCosts">Finance Costs</label>
                                      <input type="number" id="financeCosts" class="calc-input" name="financeCosts" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row total-row">
                                      <label for="profitBeforeTax">Profit before tax</label>
                                      <input type="text" id="profitBeforeTax" name="profitBeforeTax" readonly placeholder="0.00">
                                  </div>
                                  <div class="ledger-row">
                                      <label for="tax">Tax</label>
                                      <input type="number" id="tax" class="calc-input" name="tax" step="0.01" placeholder="0.00">
                                  </div>
                                  <div class="ledger-row final-total-row">
                                      <label for="netProfit">Net profit for the year</label>
                                      <input type="text" id="netProfit" name="netProfit" readonly placeholder="0.00">
                                  </div>
                              </div>
                          </div>
                      </details>
      
                      <!-- Section 7: P&L Projections -->
                      <details class="accordion-item native-details">
                          <summary class="accordion-header">
                              <span class="accordion-title">7. P&L Projections</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="ledger-container" style="padding: 1.5rem; overflow-x: auto;">
                                  <table style="width: 100%; border-collapse: collapse; text-align: right; min-width: 800px;">
                                      <thead>
                                          <tr style="border-bottom: 2px solid var(--border-color);">
                                              <th style="text-align: left; padding: 0.75rem;">Line Item</th>
                                              <th style="padding: 0.75rem;">2025</th>
                                              <th style="padding: 0.75rem;">2026</th>
                                              <th style="padding: 0.75rem;">2027</th>
                                              <th style="padding: 0.75rem;">2028</th>
                                              <th style="padding: 0.75rem;">2029</th>
                                          </tr>
                                      </thead>
                                      <tbody id="plProjectionsBody">
                                          <!-- Rows will be injected by JS -->
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      </details>
      
                      </div>
      
                      <div class="tab-content tab-content--result" id="tab-3">
                      <div class="tab-banner tab-banner--result">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                          <span>Calculated from your inputs in <a href="#" data-jump-tab="tab-1">Project Setup</a> &amp; <a href="#" data-jump-tab="tab-2">Income Statement</a>.</span>
                      </div>
                      <!-- Section 8: Cash Flow Projections -->
                      <details class="accordion-item native-details" open>
                          <summary class="accordion-header">
                              <span class="accordion-title">8. Cash Flow Projections</span>
                              <span class="accordion-icon">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                              </span>
                          </summary>
                          <div>
                              <div class="ledger-container" style="padding: 1.5rem; overflow-x: auto;">
                                  <table style="width: 100%; border-collapse: collapse; text-align: right; min-width: 800px;">
                                      <thead>
                                          <tr style="border-bottom: 2px solid var(--border-color);">
                                              <th style="text-align: left; padding: 0.75rem;">Forecast values</th>
                                              <th style="padding: 0.75rem;">2025</th>
                                              <th style="padding: 0.75rem;">2026</th>
                                              <th style="padding: 0.75rem;">2027</th>
                                              <th style="padding: 0.75rem;">2028</th>
                                              <th style="padding: 0.75rem;">2029</th>
                                          </tr>
                                      </thead>
                                      <tbody id="cfProjectionsBody">
                                          <!-- Rows will be injected by JS -->
                                      </tbody>
                                  </table>
                              </div>
                          </div>
                      </details>
                      </div>
      
                      <div class="tab-content tab-content--result" id="tab-4">
                          <div class="tab-banner tab-banner--result">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                              <span>Calculated from your inputs in <a href="#" data-jump-tab="tab-1">Project Setup</a> &amp; <a href="#" data-jump-tab="tab-2">Income Statement</a>. A few assumptions on this tab (CRP, Debt Weight, Perpetual Growth) remain editable.</span>
                          </div>
                          <div class="calc-toggle-bar">
                              <button type="button" class="calc-toggle" data-calc-toggle>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="12" y2="14"></line></svg>
                                  <span class="calc-toggle-label">Show Calculations</span>
                              </button>
                          </div>
                          <!-- Section A: Valuation Assumptions -->
                          <div class="accordion-item expanded" style="margin-bottom: 1.5rem; padding: 1.5rem;">
                              <h2 style="color: var(--text-primary); margin-bottom: 1rem; font-size: 1.25rem;">Section A: Valuation Assumptions</h2>
                              <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
                                  <!-- CAPM -->
                                  <div style="border-right: 1px solid var(--border-color); padding-right: 1rem;">
                                      <h3 style="color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 1rem;">Cost of Equity (CAPM)</h3>
                                      <div class="input-group">
                                          <label>Risk Free Rate (%)</label>
                                          <input type="number" id="dcfRiskFreeRate" readonly>
                                      </div>
                                      <div class="input-group">
                                          <label>Equity Risk Premium (%)</label>
                                          <input type="number" id="dcfErp" readonly>
                                      </div>
                                      <div class="input-group">
                                          <label>Country Risk Premium (%) <span title="Auto-populated from Damodaran's per-country data when an operating country is selected. Editable — adjust if company-specific risk warrants." style="cursor:help; border-bottom: 1px dotted #ccc;">ℹ️</span></label>
                                          <input type="number" id="dcfCrp" value="0.00" step="0.01">
                                      </div>
                                      <div class="input-group">
                                          <label>Company Beta</label>
                                          <input type="number" id="companyBeta" readonly>
                                      </div>
                                      <div class="input-group">
                                          <label>Small Stock Premium (%)</label>
                                          <input type="number" id="smallStockPremium" readonly>
                                      </div>
                                      <div class="input-group">
                                          <label style="font-weight: bold; color: var(--text-primary);">Cost of Equity (%)</label>
                                          <input type="number" id="costOfEquity" readonly style="font-weight: bold;">
                                          <div class="calc-detail" id="costOfEquityCalc" style="text-align: left;"></div>
                                      </div>
                                  </div>
                                  
                                  <!-- Cost of Debt -->
                                  <div style="border-right: 1px solid var(--border-color); padding-right: 1rem;">
                                      <h3 style="color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 1rem;">Cost of Debt</h3>
                                      <div class="input-group">
                                          <label>Debt Weight (%)</label>
                                          <input type="number" id="debtWeight" value="0.00" step="0.01">
                                      </div>
                                      <div class="input-group">
                                          <label>Equity Weight (%)</label>
                                          <input type="number" id="equityWeight" value="100.00" readonly>
                                      </div>
                                      <div class="input-group">
                                          <label>Average Interest Paid (%)</label>
                                          <input type="number" id="averageInterestPaid" value="0.00" step="0.01">
                                      </div>
                                      <div class="input-group">
                                          <label>Tax Rate (%)</label>
                                          <input type="number" id="dcfTaxRate" readonly>
                                      </div>
                                      <div class="input-group">
                                          <label style="font-weight: bold; color: var(--text-primary);">Cost of Debt (After Tax) (%)</label>
                                          <input type="number" id="costOfDebtAfterTax" readonly style="font-weight: bold;">
                                          <div class="calc-detail" id="costOfDebtCalc" style="text-align: left;"></div>
                                      </div>
                                  </div>
      
                                  <!-- WACC & DCF -->
                                  <div>
                                      <h3 style="color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 1rem;">WACC & Modifiers</h3>
                                      <div class="input-group">
                                          <label style="font-weight: bold; color: var(--text-primary);">WACC (%)</label>
                                          <input type="number" id="wacc" readonly style="font-weight: bold;">
                                          <div class="calc-detail" id="waccCalc" style="text-align: left;"></div>
                                      </div>
                                      <div class="input-group" style="margin-top: 1rem;">
                                          <label>Perpetual Growth Rate (%)</label>
                                          <input type="number" id="perpetualGrowthRate" value="5.67" step="0.01">
                                      </div>
                                      <div class="input-group">
                                          <label>Discount for Lack of Marketability (DLOM) (%)</label>
                                          <input type="number" id="dlom" readonly>
                                      </div>
                                  </div>
                              </div>
                          </div>
      
                          <!-- Section B: DCF Valuation Model -->
                          <div class="accordion-item expanded" style="margin-bottom: 1.5rem; padding: 1.5rem; overflow-x: auto;">
                              <h2 style="color: var(--text-primary); margin-bottom: 1rem; font-size: 1.25rem;">Section B: DCF Valuation Model</h2>
                              <table style="width: 100%; border-collapse: collapse; text-align: right; min-width: 800px;">
                                  <thead>
                                      <tr style="border-bottom: 2px solid var(--border-color);">
                                          <th style="text-align: left; padding: 0.75rem;">CAPM - Multi Stage Valuation Model</th>
                                          <th style="padding: 0.75rem;">31/12/2025</th>
                                          <th style="padding: 0.75rem;">31/12/2026</th>
                                          <th style="padding: 0.75rem;">31/12/2027</th>
                                          <th style="padding: 0.75rem;">31/12/2028</th>
                                          <th style="padding: 0.75rem;">31/12/2029</th>
                                          <th style="padding: 0.75rem;">Terminal (31/12/2030)</th>
                                      </tr>
                                  </thead>
                                  <tbody id="dcfModelBody">
                                      <!-- Rendered via JS -->
                                  </tbody>
                              </table>
                              <div id="dcfFinalValuation" style="margin-top: 1.5rem; text-align: left;">
                                  <!-- Output NPV, DLOM, EV here -->
                              </div>
                          </div>
      
                          <!-- Section C: Sensitivity Analysis -->
                          <div class="accordion-item expanded" style="padding: 1.5rem; overflow-x: auto;">
                              <h2 style="color: var(--text-primary); margin-bottom: 1rem; font-size: 1.25rem;">Section C: Sensitivity Analysis</h2>

                              <!-- Sensitivity step controls (drive the ± offsets used in the two tables below) -->
                              <div class="sensitivity-controls" style="display: flex; flex-wrap: wrap; gap: 1.25rem; align-items: end; margin-bottom: 1.25rem; padding: 0.75rem 1rem; background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                                  <div class="input-group" style="flex: 0 0 160px;">
                                      <label for="sensGrowthStep" title="The growth-rate sensitivity table uses base ± this step.">Growth ± step (%)</label>
                                      <input type="number" id="sensGrowthStep" value="3.00" min="0" step="0.25">
                                  </div>
                                  <div class="input-group" style="flex: 0 0 160px;">
                                      <label for="sensDiscountStep" title="The discount-rate sensitivity table uses base ± this step.">Discount ± step (%)</label>
                                      <input type="number" id="sensDiscountStep" value="3.00" min="0" step="0.25">
                                  </div>
                                  <div class="input-group" style="flex: 0 0 130px;">
                                      <label for="sensFcfLower" title="Lower FCF multiplier applied to all projected free cash flows.">FCF lower (%)</label>
                                      <input type="number" id="sensFcfLower" value="90" min="1" step="1">
                                  </div>
                                  <div class="input-group" style="flex: 0 0 130px;">
                                      <label for="sensFcfUpper" title="Upper FCF multiplier applied to all projected free cash flows.">FCF upper (%)</label>
                                      <input type="number" id="sensFcfUpper" value="110" min="1" step="1">
                                  </div>
                                  <div style="font-size: 0.75rem; color: var(--text-muted); flex: 1; min-width: 200px; line-height: 1.4;">
                                      Centre cells use the base WACC, base perpetual growth and 100% FCF. The summary range averages all nine scenarios per dimension.
                                  </div>
                              </div>

                              <div style="display: flex; gap: 2rem; flex-wrap: wrap;">
                                  <div style="flex: 1; min-width: 400px;">
                                      <h3 style="color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 1rem;">Sensitivity analysis 1 - Growth rate</h3>
                                      <table style="width: 100%; border-collapse: collapse; text-align: right;" class="sensitivity-table">
                                          <thead>
                                              <tr style="border-bottom: 1px solid var(--border-color);">
                                                  <th style="text-align: left; padding: 0.5rem;">Growth Rate</th>
                                                  <th id="sensGrowthColLower" style="padding: 0.5rem; text-align: center;">90% FCF</th>
                                                  <th style="padding: 0.5rem; text-align: center;">100% FCF</th>
                                                  <th id="sensGrowthColUpper" style="padding: 0.5rem; text-align: center;">110% FCF</th>
                                              </tr>
                                          </thead>
                                          <tbody id="sensGrowthBody">
                                          </tbody>
                                      </table>
                                  </div>

                                  <div style="flex: 1; min-width: 400px;">
                                      <h3 style="color: var(--accent-primary); margin-bottom: 0.5rem; font-size: 1rem;">Sensitivity analysis 2 - Discount rate</h3>
                                      <table style="width: 100%; border-collapse: collapse; text-align: right;" class="sensitivity-table">
                                          <thead>
                                              <tr style="border-bottom: 1px solid var(--border-color);">
                                                  <th style="text-align: left; padding: 0.5rem;">Discount Rate</th>
                                                  <th id="sensDiscountColLower" style="padding: 0.5rem; text-align: center;">90% FCF</th>
                                                  <th style="padding: 0.5rem; text-align: center;">100% FCF</th>
                                                  <th id="sensDiscountColUpper" style="padding: 0.5rem; text-align: center;">110% FCF</th>
                                              </tr>
                                          </thead>
                                          <tbody id="sensDiscountBody">
                                          </tbody>
                                      </table>
                                  </div>
                              </div>
                          </div>
                      </div>
      
                      <div class="tab-content tab-content--result" id="tab-5">
                          <div class="tab-banner tab-banner--result">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                              <span>Final summary &mdash; calculated end-to-end from your inputs. Edit values in <a href="#" data-jump-tab="tab-1">Project Setup</a> or <a href="#" data-jump-tab="tab-2">Income Statement</a> to update.</span>
                          </div>
                          <div class="calc-toggle-bar">
                              <button type="button" class="calc-toggle" data-calc-toggle>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="12" y2="14"></line></svg>
                                  <span class="calc-toggle-label">Show Calculations</span>
                              </button>
                          </div>
                          <div class="accordion-item expanded" style="margin-bottom: 1.5rem; padding: 1.5rem;">
                              <h2 style="color: var(--text-primary); margin-bottom: 2rem; font-size: 1.25rem; text-align: center;">Valuation Summary & Range</h2>
                              
                              <!-- Range Graphic -->
                              <div id="rangeGraphicContainer" style="margin-bottom: 3rem; position: relative; padding: 2rem 0;">
                                  <h3 style="text-align: center; color: var(--text-secondary); margin-bottom: 2rem;">Equity Valuation Range</h3>
                                  
                                  <!-- Visualization Container -->
                                  <div style="position: relative; width: 80%; margin: 0 auto; height: 100px;">
                                      <!-- Point Estimate Label & Dashed Line -->
                                      <div id="rangePointMarker" style="position: absolute; left: 50%; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; z-index: 10; transition: left 0.5s ease;">
                                          <div id="rangePointLabel" style="background-color: var(--bg-surface); border: 1px solid var(--border-color); padding: 0.25rem 0.75rem; border-radius: 4px; font-weight: bold; font-size: 0.9rem; margin-bottom: 4px; color: var(--text-primary);">--</div>
                                          <div style="height: 40px; border-left: 2px dashed var(--text-muted);"></div>
                                      </div>
                                      
                                      <!-- Horizontal Bar Container -->
                                      <div style="position: absolute; top: 60px; left: 0; width: 100%; height: 20px; background-color: var(--bg-surface-hover); border-radius: 10px; overflow: hidden; border: 1px solid var(--border-color);">
                                          <!-- Dynamic Filled Bar -->
                                          <div id="rangeFilledBar" style="position: absolute; left: 20%; right: 20%; height: 100%; background-color: chartreuse; opacity: 0.8; transition: all 0.5s ease;"></div>
                                      </div>
                                      
                                      <!-- Endpoints -->
                                      <div id="rangeMinLabel" style="position: absolute; left: 20%; top: 85px; transform: translateX(-50%); font-size: 0.8rem; color: var(--text-muted); transition: left 0.5s ease;">--</div>
                                      <div id="rangeMaxLabel" style="position: absolute; right: 20%; top: 85px; transform: translateX(50%); font-size: 0.8rem; color: var(--text-muted); transition: right 0.5s ease;">--</div>
                                  </div>
                                  
                                  <!-- X-Axis Scale (rendered dynamically) -->
                                  <div id="rangeAxisTicks" style="display: flex; justify-content: space-between; width: 80%; margin: 1.5rem auto 0; border-top: 1px solid var(--border-color); padding-top: 0.5rem; font-size: 0.75rem; color: var(--text-muted);">
                                      <span>--</span>
                                  </div>
                              </div>
      
                              <!-- Summary Tables -->
                              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.5rem; align-items: start;">
      
                                  <!-- Left Card: 100% Equity Value Summary -->
                                  <div class="summary-card">
                                      <div class="summary-card-header">100% Equity Value Summary</div>
                                      <table class="summary-table">
                                          <thead>
                                              <tr>
                                                  <th id="summaryEquityDateLabel">31/12/2024</th>
                                                  <th>
                                                      <span class="summary-th-main">Sensitivity 1</span>
                                                      <span id="summaryEquityCurr1" class="summary-th-sub">--</span>
                                                  </th>
                                                  <th>
                                                      <span class="summary-th-main">Sensitivity 2</span>
                                                      <span id="summaryEquityCurr2" class="summary-th-sub">--</span>
                                                  </th>
                                              </tr>
                                          </thead>
                                          <tbody id="summaryEquityTableBody">
                                              <!-- Rendered via JS -->
                                          </tbody>
                                      </table>
                                  </div>
      
                                  <!-- Right Card: 100% Enterprise Value range -->
                                  <div class="summary-card">
                                      <div class="summary-card-header">100% Enterprise Value range</div>
                                      <table class="summary-table">
                                          <thead>
                                              <tr>
                                                  <th id="summaryEvDateLabel">31/12/2024</th>
                                                  <th>
                                                      <span class="summary-th-main">Sensitivity 1</span>
                                                      <span id="summaryEvCurr1" class="summary-th-sub">--</span>
                                                  </th>
                                                  <th>
                                                      <span class="summary-th-main">Sensitivity 2</span>
                                                      <span id="summaryEvCurr2" class="summary-th-sub">--</span>
                                                  </th>
                                              </tr>
                                          </thead>
                                          <tbody id="summaryEvTableBody">
                                              <!-- Rendered via JS -->
                                          </tbody>
                                      </table>
                                  </div>
      
                              </div>
                          </div>
                      </div>
      
                      <!-- Action Bar -->
                      <div class="form-actions">
                          <button type="button" class="btn btn-secondary">Discard</button>
                          <button type="button" class="btn btn-primary" id="exportPdfBtn">Export PDF</button>
                      </div>
      
                  </form>
    </div>
  </div>
`;

// ---- bootValuation() - Valtrix app.js body ported verbatim ---
// Original entry point was:
//   document.addEventListener('DOMContentLoaded', () => { ... });
// Here the body runs once after the page HTML is in the DOM and
// the CDN vendor scripts have loaded.

function bootValuation() {
    // Nginx proxies /api/valuation/* → http://127.0.0.1:8002 on the server.
    // Relative path so it works on LAN browsers regardless of host.
    const API_BASE = '/api/valuation';

    const getBaseYear = () => {
        const val = parseInt(document.getElementById('baseYear')?.value);
        return (!isNaN(val) && val >= 1990 && val <= 2100) ? val : new Date().getFullYear() - 1;
    };

    // Tab Navigation Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    const activateTab = (targetId) => {
        if (!targetId) return;
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        const targetBtn = document.querySelector(`.tab-btn[data-target="${targetId}"]`);
        if (targetBtn) targetBtn.classList.add('active');
        const targetContent = document.getElementById(targetId);
        if (targetContent) targetContent.classList.add('active');
    };

    if (tabBtns.length > 0 && tabContents.length > 0) {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => activateTab(btn.getAttribute('data-target')));
        });
    }

    document.querySelectorAll('[data-jump-tab]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            activateTab(link.getAttribute('data-jump-tab'));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Currency display helpers — symbol-first (e.g. "€1,234,567") instead of
    // code/name ("EUR 1,234,567"). jsPDF's default font lacks unicode glyphs,
    // so the PDF path keeps ISO codes via getCurrencyCodeForPdf().
    const CURRENCY_SYMBOLS = {
        'Australian $': 'A$', 'Brazilian Reai': 'R$', 'British Pound': '£',
        'Bulgarian Lev': 'лв ', 'Canadian $': 'C$', 'Chilean Peso': 'CLP$ ',
        'Chinese Yuan': '¥', 'Colombian Peso': 'COL$ ', 'Croatian Kuna': 'kn ',
        'Czech Koruna': 'Kč ', 'Danish Krone': 'kr ', 'Euro': '€',
        'HK $': 'HK$', 'Hungarian Forint': 'Ft ', 'Iceland Krona': 'kr ',
        'Indian Rupee': '₹', 'Indonesian Rupiah': 'Rp ', 'Israeli Shekel': '₪',
        'Japanese Yen': '¥', 'Kenyan Shilling': 'KSh ', 'Korean Won': '₩',
        'Malyasian Ringgit': 'RM ', 'Mexican Peso': 'Mex$', 'Nigerian Naira': '₦',
        'Norwegian Krone': 'kr ', 'NZ $': 'NZ$', 'Pakistani Rupee': '₨ ',
        'Peruvian Sol': 'S/ ', 'Phillipine Peso': '₱', 'Polish Zloty': 'zł ',
        'Qatari Dinar': 'QAR ', 'Romanian Lev': 'lei ', 'Russian Ruble': '₽',
        'Singapore $': 'S$', 'South African Rand': 'R ', 'Swedish Krona': 'kr ',
        'Swiss Franc': 'CHF ', 'Taiwanese $': 'NT$', 'Thai Baht': '฿',
        'Turkish Lira': '₺', 'US $': '$', 'Vietnamese Dong': '₫',
        'Zambian kwacha': 'ZK ',
        EUR: '€', USD: '$', GBP: '£', JPY: '¥', CNY: '¥',
        CHF: 'CHF ', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
        SEK: 'kr ', NOK: 'kr ', DKK: 'kr ',
        SGD: 'S$', HKD: 'HK$', INR: '₹', KRW: '₩', ZAR: 'R ',
        TRY: '₺', RUB: '₽', BRL: 'R$', MXN: 'Mex$',
    };
    const getCurrencySymbol = (code) => {
        if (!code || code === '--') return '';
        return CURRENCY_SYMBOLS[code] || `${code} `;
    };

    // Accordion Logic
    const accordionHeaders = document.querySelectorAll('.accordion-header');

    accordionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            const currentItem = header.parentElement;

            // Do not run custom JS toggle logic for native details elements
            if (currentItem.tagName === 'DETAILS') return;

            const isExpanded = currentItem.classList.contains('expanded');

            // Close all other accordions
            document.querySelectorAll('.accordion-item').forEach(item => {
                if (item !== currentItem) {
                    item.classList.remove('expanded');
                    item.querySelector('.accordion-header').setAttribute('aria-expanded', 'false');
                }
            });

            // Toggle current accordion
            if (isExpanded) {
                currentItem.classList.remove('expanded');
                header.setAttribute('aria-expanded', 'false');
            } else {
                currentItem.classList.add('expanded');
                header.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Image Preview Logic
    const coverImageInput = document.getElementById('coverImage');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const imagePreview = document.getElementById('imagePreview');

    if (coverImageInput) {
        coverImageInput.addEventListener('change', function () {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    imagePreview.src = e.target.result;
                    imagePreviewContainer.style.display = 'block';
                }
                reader.readAsDataURL(file);
            } else {
                imagePreview.src = '';
                imagePreviewContainer.style.display = 'none';
            }
        });
    }

    // Dynamic Shareholders List Logic
    const addShareholderBtn = document.getElementById('addShareholderBtn');
    const shareholdersContainer = document.getElementById('shareholdersContainer');

    if (addShareholderBtn) {
        addShareholderBtn.addEventListener('click', () => {
            const newItem = document.createElement('div');
            newItem.className = 'dynamic-list-item';
            newItem.style.marginTop = '8px';
            newItem.style.display = 'grid';
            newItem.style.gridTemplateColumns = '2fr 1fr';
            newItem.style.gap = '0.5rem';
            newItem.innerHTML = '<input type="text" name="shareholders[]" placeholder="Enter shareholder name"><input type="number" name="shareholderPct[]" placeholder="% share" min="0" max="100" step="0.01">';
            shareholdersContainer.appendChild(newItem);
        });
    }

    // --- Dropdown Fetching Logic ---
    const continentSelect = document.getElementById('continent');
    const operatingCountrySelect = document.getElementById('operatingCountry');
    const incCountrySelect = document.getElementById('incCountry');
    const industryInput = document.getElementById('industry');
    const currencySelect = document.getElementById('currency');

    const populateDropdown = async (url, selectElement, defaultText) => {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();

            selectElement.innerHTML = `<option value="" disabled selected>${defaultText}</option>`;
            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item;
                option.textContent = item;
                selectElement.appendChild(option);
            });
            selectElement.disabled = false;
        } catch (err) {
            console.error(`Error populating ${selectElement.id}:`, err);
        }
    };

    const fetchDropdowns = async () => {
        if (continentSelect) populateDropdown(`${API_BASE}/dropdowns/continents`, continentSelect, 'Select a continent...');
        if (operatingCountrySelect) {
            await populateDropdown(`${API_BASE}/dropdowns/countries`, operatingCountrySelect, 'Select a country...');
            // Copy options to incorporation country
            if (incCountrySelect) {
                incCountrySelect.innerHTML = operatingCountrySelect.innerHTML;
                incCountrySelect.disabled = false;
            }
        }
        if (industryInput) populateDropdown(`${API_BASE}/dropdowns/industries`, industryInput, 'Select an industry...');
        if (currencySelect) populateDropdown(`${API_BASE}/dropdowns/currencies`, currencySelect, 'Select a currency...');
    };

    fetchDropdowns();

    // Damodaran edition (e.g. "January 2024") used in Section III prose.
    // Loaded from /api/meta/damodaran-edition which reads from the ReportMeta table
    // populated by update_damodaran.py. Falls back to a default if the call fails.
    let damodaranEdition = 'January 2024';
    (async () => {
        try {
            const res = await fetch(`${API_BASE}/meta/damodaran-edition`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.edition) damodaranEdition = data.edition;
            }
        } catch (err) {
            console.warn('Damodaran edition meta unavailable, using default:', err);
        }
    })();

    // Dynamic Currency Label Logic for Capital Expenditure
    const capexLabel = document.getElementById('capexLabel');

    if (currencySelect && capexLabel) {
        currencySelect.addEventListener('change', function () {
            const selectedCurrency = this.value;
            capexLabel.textContent = `Capital Expenditure (${selectedCurrency})`;
        });
    }

    // --- API Reference Data Fetching ---

    if (continentSelect) {
        continentSelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            try {
                const res = await fetch(`${API_BASE}/reference/continent/${encodeURIComponent(val)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.equity_risk_premium != null) {
                        const erpVal = (data.equity_risk_premium * 100).toFixed(2);
                        document.getElementById('erp').value = erpVal;
                        const dcfErp = document.getElementById('dcfErp');
                        if(dcfErp) dcfErp.value = erpVal;
                    } else {
                        document.getElementById('erp').value = "";
                        if(document.getElementById('dcfErp')) document.getElementById('dcfErp').value = "";
                    }
                }
            } catch (err) { console.error('API Fetch Error:', err); }
        });
    }

    // Stores the most recent projections object so updateDcfTaxRate can read
    // 'Tax due' / 'Net profit before tax' (mirrors Excel's L27/L25 fallback path).
    let lastProjections = null;

    // Effective tax rate computed from the P&L projections — equivalent to Excel's
    // 'P&L Projections'!L27/'P&L Projections'!L25. Picks the first projection year
    // since the ratio is identical across all years.
    const computeEffectiveTaxFromPL = () => {
        if (!lastProjections) return null;
        const baseYear = getBaseYear();
        const data = lastProjections[baseYear + 1];
        if (!data) return null;
        const pbt = data['Net profit before tax'];
        const taxDue = data['Tax due'];
        if (!pbt || Math.abs(pbt) < 1e-6) return null;
        return Math.abs(taxDue / pbt) * 100;
    };

    // Mirrors Excel's IFERROR(VLOOKUP(country, Tax Rates, ...), 'P&L Projections'!L27/L25).
    // Primary: country statutory rate from the Tax Rates CSV (Damodaran source).
    // Rare fallback: effective rate computed from the P&L (kicks in only when the
    // country isn't found in the table — country-name mismatches, etc.).
    // Last resort: industry effective rate.
    const updateDcfTaxRate = () => {
        let rate = null;
        if (referenceDataState.country && referenceDataState.country.statutory_tax_rate != null) {
            rate = referenceDataState.country.statutory_tax_rate * 100;
        }
        if (rate == null) {
            rate = computeEffectiveTaxFromPL();
        }
        if (rate == null && referenceDataState.industry && referenceDataState.industry.effective_tax_rate != null) {
            rate = referenceDataState.industry.effective_tax_rate * 100;
        }
        const dcfTaxRate = document.getElementById('dcfTaxRate');
        if (dcfTaxRate) {
            dcfTaxRate.value = rate != null ? rate.toFixed(2) : '';
        }
    };

    if (industryInput) {
        industryInput.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            try {
                const res = await fetch(`${API_BASE}/reference/industry/${encodeURIComponent(val)}`);
                if (res.ok) {
                    referenceDataState.industry = await res.json();
                    console.log('Industry Reference Data Loaded:', referenceDataState.industry);
                    if (referenceDataState.industry.effective_tax_rate != null) {
                        document.getElementById('taxRate').value = (referenceDataState.industry.effective_tax_rate * 100).toFixed(2);
                    } else {
                        document.getElementById('taxRate').value = "";
                    }
                    updateDcfTaxRate();
                    if (referenceDataState.industry.unlevered_beta != null) {
                        const betaVal = referenceDataState.industry.unlevered_beta.toFixed(2);
                        const companyBetaEl = document.getElementById('companyBeta');
                        if (companyBetaEl) companyBetaEl.value = betaVal;
                    } else {
                        const companyBetaEl = document.getElementById('companyBeta');
                        if (companyBetaEl) companyBetaEl.value = "";
                    }
                    if (typeof calculatePlProjections === 'function') calculatePlProjections();
                } else {
                    referenceDataState.industry = null;
                }
            } catch (err) { console.error('API Fetch Error:', err); }
        });
    }

    if (operatingCountrySelect) {
        operatingCountrySelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            try {
                // Two parallel lookups: statutory tax rate + country risk metrics
                // (CRP, per-country ERP, default spread). Both feed Tab 1.
                const [taxRes, countryRes] = await Promise.all([
                    fetch(`${API_BASE}/reference/tax-rate/${encodeURIComponent(val)}`),
                    fetch(`${API_BASE}/reference/country/${encodeURIComponent(val)}`),
                ]);

                if (taxRes.ok) {
                    referenceDataState.country = await taxRes.json();
                    console.log('Country Reference Data Loaded:', referenceDataState.country);
                    if (referenceDataState.country.statutory_tax_rate != null) {
                        document.getElementById('statutoryTaxRate').value = (referenceDataState.country.statutory_tax_rate * 100).toFixed(2);
                    } else {
                        document.getElementById('statutoryTaxRate').value = "";
                    }
                    updateDcfTaxRate();
                } else {
                    referenceDataState.country = null;
                }

                // Per-country CRP + ERP from Damodaran's Rates2 sheet. ERP here
                // is per-country, more precise than the continent average set by
                // the continent dropdown — let it overwrite. Field stays editable
                // so auditors can adjust for company-specific risk.
                //
                // Mirrors the source workbook's CRP formula:
                //   =IFERROR(VLOOKUP(country, Table14, n, 0),
                //            AVERAGEIF(References!B:B, continent, References!F:F))
                // If the country isn't in Damodaran's Rates2 table, fall back to
                // the user-selected continent's average CRP/ERP from
                // ContinentAverages. Excel uses col 5 (= ERP, mis-labelled
                // "Country Risk Premium" in the workbook); we deliberately read
                // country_risk_premium here, which is the *correct* concept.
                const setCrpErp = (crp, erp, sourceLabel) => {
                    if (crp != null) {
                        const dcfCrp = document.getElementById('dcfCrp');
                        if (dcfCrp) dcfCrp.value = (crp * 100).toFixed(2);
                    }
                    if (erp != null) {
                        const erpVal = (erp * 100).toFixed(2);
                        const erpEl = document.getElementById('erp');
                        if (erpEl) erpEl.value = erpVal;
                        const dcfErpEl = document.getElementById('dcfErp');
                        if (dcfErpEl) dcfErpEl.value = erpVal;
                    }
                    referenceDataState.countryRiskSource = sourceLabel;
                };

                if (countryRes.ok) {
                    const countryRisk = await countryRes.json();
                    referenceDataState.countryRisk = countryRisk;
                    setCrpErp(
                        countryRisk.country_risk_premium,
                        countryRisk.equity_risk_premium,
                        `Damodaran Rates2 (${val})`,
                    );
                } else if (countryRes.status === 404) {
                    // Country not in Damodaran's table — average the continent.
                    // Use whatever continent the user picked on the Tab 1 dropdown;
                    // if none picked yet, the fallback silently skips and the
                    // existing field values (likely from the continent dropdown
                    // itself) stand.
                    const continentEl = document.getElementById('continent');
                    const continent = continentEl ? continentEl.value : '';
                    if (continent) {
                        try {
                            const contRes = await fetch(`${API_BASE}/reference/continent/${encodeURIComponent(continent)}`);
                            if (contRes.ok) {
                                const contAvg = await contRes.json();
                                referenceDataState.countryRisk = {
                                    country_name: val,
                                    country_risk_premium: contAvg.country_risk_premium,
                                    equity_risk_premium: contAvg.equity_risk_premium,
                                    fallback: true,
                                };
                                setCrpErp(
                                    contAvg.country_risk_premium,
                                    contAvg.equity_risk_premium,
                                    `${continent} average (fallback — ${val} not in Rates2)`,
                                );
                                console.log(`CRP/ERP fallback: ${val} not in Rates2, using ${continent} averages`);
                            }
                        } catch (fbErr) {
                            console.warn('Continent-average fallback failed:', fbErr);
                        }
                    }
                }

                if (typeof calculatePlProjections === 'function') calculatePlProjections();
            } catch (err) { console.error('API Fetch Error:', err); }
        });
    }

    // Auto-fetch FX rate (currency → USD) keyed on the valuation date. Called
    // when either currency or valuation date changes. Field stays editable so
    // an auditor can overwrite with a more authoritative rate.
    const fetchAndApplyFxRate = async () => {
        const currency = document.getElementById('currency')?.value;
        const valuationDate = document.getElementById('valuationDate')?.value;
        const fxInput = document.getElementById('eurUsdRate');
        const hintEl = document.getElementById('usdRateHint');
        if (!currency || !fxInput) return;

        // USD reporting currency: rate is identity, no fetch needed.
        if (currency === 'US $' || currency === 'USD') {
            fxInput.value = '1.0000';
            if (hintEl) { hintEl.textContent = 'Reporting in USD — no conversion needed.'; hintEl.style.display = 'block'; }
            return;
        }

        try {
            const qs = valuationDate ? `?date=${encodeURIComponent(valuationDate)}` : '';
            const res = await fetch(`${API_BASE}/reference/fx/${encodeURIComponent(currency)}${qs}`);
            if (!res.ok) {
                if (hintEl) { hintEl.textContent = 'No reference rate on file — please enter manually.'; hintEl.style.display = 'block'; }
                return;
            }
            const data = await res.json();
            fxInput.value = Number(data.rate_per_usd).toFixed(4);
            if (hintEl) {
                const matchNote = data.exact_match ? 'exact match' : 'nearest prior date';
                const sourceNote = data.source ? ` · ${data.source}` : '';
                hintEl.textContent = `${currency} per 1 USD on ${data.as_of_date} (${matchNote})${sourceNote}`;
                hintEl.style.display = 'block';
            }
            if (typeof calculatePlProjections === 'function') calculatePlProjections();
        } catch (err) {
            console.error('FX Fetch Error:', err);
            if (hintEl) { hintEl.textContent = 'Could not load reference rate — please enter manually.'; hintEl.style.display = 'block'; }
        }
    };

    if (currencySelect) {
        currencySelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            try {
                const res = await fetch(`${API_BASE}/reference/currency/${encodeURIComponent(val)}`);
                if (res.ok) {
                    referenceDataState.currency = await res.json();
                    console.log('Currency Reference Data Loaded:', referenceDataState.currency);
                    if (referenceDataState.currency.risk_free_rate != null) {
                        const rfVal = (referenceDataState.currency.risk_free_rate * 100).toFixed(2);
                        document.getElementById('riskFreeRate').value = rfVal;
                        const dcfRiskFreeRate = document.getElementById('dcfRiskFreeRate');
                        if (dcfRiskFreeRate) dcfRiskFreeRate.value = rfVal;
                    } else {
                        document.getElementById('riskFreeRate').value = "";
                        if (document.getElementById('dcfRiskFreeRate')) document.getElementById('dcfRiskFreeRate').value = "";
                    }
                    if (typeof calculatePlProjections === 'function') calculatePlProjections();
                } else {
                    referenceDataState.currency = null;
                }
            } catch (err) { console.error('API Fetch Error:', err); }
            // Refresh FX after currency change (and any time the date changes too)
            fetchAndApplyFxRate();
        });
    }

    const eurUsdRateInput = document.getElementById('eurUsdRate');
    if (eurUsdRateInput) {
        eurUsdRateInput.addEventListener('input', () => {
            if (typeof calculatePlProjections === 'function') calculatePlProjections();
        });
    }

    const baseYearInput = document.getElementById('baseYear');
    if (baseYearInput) {
        baseYearInput.addEventListener('input', () => {
            if (typeof calculatePlProjections === 'function') calculatePlProjections();
        });
    }

    // valuationDate auto-fills baseYear (year - 1). User can still override manually.
    const valuationDateInput = document.getElementById('valuationDate');
    if (valuationDateInput && baseYearInput) {
        valuationDateInput.addEventListener('change', () => {
            const v = valuationDateInput.value;
            if (!v) return;
            const y = parseInt(v.substring(0, 4), 10);
            if (isNaN(y)) return;
            baseYearInput.value = y - 1;
            if (typeof calculatePlProjections === 'function') calculatePlProjections();
            // Refresh FX so it tracks the new valuation date
            fetchAndApplyFxRate();
        });
    }

    // Income Statement Real-Time Calculations
    const calcInputs = document.querySelectorAll('.calc-input');

    const getVal = (id) => {
        const val = parseFloat(document.getElementById(id).value);
        return isNaN(val) ? 0 : val;
    };

    const getRawVal = (id) => {
        const el = document.getElementById(id);
        if (!el) return 0;
        const val = parseFloat(el.value.replace(/,/g, ''));
        return isNaN(val) ? 0 : val;
    };

    const formatCurrency = (val) => {
        return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const calculateIncomeStatement = () => {
        // Gross Profit = Revenue - Cost of sales
        const grossProfit = getVal('revenue') - getVal('cogs');
        document.getElementById('grossProfit').value = formatCurrency(grossProfit);

        // Operating profit = Gross Profit + Other operating income - Admin expenses - Depreciation - Other expenses
        const operatingProfit = grossProfit + getVal('otherIncome') - getVal('adminExpenses') - getVal('depreciation') - getVal('otherExpenses');
        document.getElementById('operatingProfit').value = formatCurrency(operatingProfit);

        // Profit before tax = Operating profit + Finance Income - Finance Costs
        const profitBeforeTax = operatingProfit + getVal('financeIncome') - getVal('financeCosts');
        document.getElementById('profitBeforeTax').value = formatCurrency(profitBeforeTax);

        // Net profit = Profit before tax - Tax
        const netProfit = profitBeforeTax - getVal('tax');
        document.getElementById('netProfit').value = formatCurrency(netProfit);

        if (typeof calculatePlProjections === 'function') calculatePlProjections();
    };

    calcInputs.forEach(input => {
        input.addEventListener('input', calculateIncomeStatement);
    });

    // P&L Projections Logic
    const calculatePlProjections = () => {
        const baseYear = getBaseYear();
        const firstProjYear = baseYear + 1;
        const lastProjYear = baseYear + 5;

        // Step 1: Initialization & Variable Setup
        // Growth rate: user override takes precedence over industry default
        const overrideInput = document.getElementById('revenueGrowthOverride');
        const overrideRaw = overrideInput ? overrideInput.value.trim() : '';
        const overrideVal = overrideRaw === '' ? NaN : parseFloat(overrideRaw);

        let multiplier;
        if (!isNaN(overrideVal)) {
            multiplier = 1 + (overrideVal / 100);
        } else {
            let exp_revenue_growth_2yr = 0;
            if (referenceDataState.industry && referenceDataState.industry.exp_revenue_growth_2yr) {
                exp_revenue_growth_2yr = referenceDataState.industry.exp_revenue_growth_2yr;
            }
            multiplier = 1 + (exp_revenue_growth_2yr / 2);
        }

        const invShareInput = document.getElementById('investmentsShare');
        const invShareBase = invShareInput ? (parseFloat(invShareInput.value) || 0) : 0;

        const cwcInput = document.getElementById('changeInWorkingCapital');
        const cwcBase = cwcInput ? (parseFloat(cwcInput.value) || 0) : 0;

        const capexInput = document.getElementById('capex');
        const capexBase = capexInput ? (parseFloat(capexInput.value) || 0) : 0;

        const baseData = {
            'Revenue': getVal('revenue'),
            'Cost of sales': getVal('cogs'),
            'Other Income': getVal('otherIncome'),
            'Administration expenses': getVal('adminExpenses'),
            'Finance income': getVal('financeIncome'),
            'Finance costs': getVal('financeCosts'),
            'Depreciation': getVal('depreciation'),
            'INVESTMENTS share': invShareBase,
            'Change In Working Capital': cwcBase,
            'Capital Expenditure': capexBase
        };

        const projections = {
            [baseYear]: baseData
        };

        let statTaxRate = referenceDataState.country?.statutory_tax_rate || 0;
        projections._meta = { multiplier, statTaxRate };

        // Step 2: The Projection Loop (5 years forward from base year)
        for (let year = firstProjYear; year <= lastProjYear; year++) {
            let prevYear = projections[year - 1];
            let current = {};

            current['Revenue'] = prevYear['Revenue'] * multiplier;
            current['Cost of sales'] = prevYear['Cost of sales'] * multiplier;
            current['Other Income'] = prevYear['Other Income'] * multiplier;
            current['Administration expenses'] = prevYear['Administration expenses'] * multiplier;
            current['Finance income'] = prevYear['Finance income'] * multiplier;
            current['Finance costs'] = prevYear['Finance costs'] * multiplier;
            current['Depreciation'] = prevYear['Depreciation'] * multiplier;

            current['Gross Profit'] = current['Revenue'] - current['Cost of sales'];
            current['EBITDA'] = current['Gross Profit'] + current['Other Income'] - current['Administration expenses'];
            current['Total Finance cost and depreciation'] = current['Finance income'] - current['Finance costs'] - current['Depreciation'];
            current['Income before tax and share allocation'] = current['EBITDA'] + current['Total Finance cost and depreciation'];

            current['INVESTMENTS share'] = prevYear['INVESTMENTS share'] * multiplier;

            current['Net profit before tax'] = current['Income before tax and share allocation'] + current['INVESTMENTS share'];
            current['Tax due'] = current['Net profit before tax'] * statTaxRate * -1;
            current['Net profit after tax'] = current['Tax due'] + current['Net profit before tax'];

            current['Change In Working Capital'] = prevYear['Change In Working Capital'] * multiplier;
            current['Capital Expenditure'] = prevYear['Capital Expenditure'] * multiplier;
            current['Depreciation Expense'] = Math.abs(current['Depreciation']);
            current['Free Cash Flow to the Firm'] = current['Net profit after tax'] + current['Change In Working Capital'] + current['Capital Expenditure'] + current['Depreciation Expense'];

            projections[year] = current;
        }

        // Stash projections + refresh dcfTaxRate from the P&L effective rate (L27/L25)
        // BEFORE the DCF runs, so the WACC reads the freshly-computed value.
        lastProjections = projections;
        updateDcfTaxRate();

        renderPlProjections(projections, baseYear);
        if (typeof renderCfProjections === 'function') {
            renderCfProjections(projections, baseYear);
        }
        if (typeof calculateDcf === 'function') {
            calculateDcf(projections, baseYear);
        }
    };

    const formatProjCurrency = (val) => {
        return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    };

    const getPlCalcDetail = (key, year, projections, baseYear) => {
        if (year === baseYear) return '';
        const prev = projections[year - 1];
        const cur = projections[year];
        if (!prev || !cur) return '';
        const meta = projections._meta || {};
        const mult = meta.multiplier;
        const tax = meta.statTaxRate;
        const f = formatProjCurrency;
        const multStr = (mult != null) ? mult.toFixed(4) : '—';

        switch (key) {
            case 'Revenue':
            case 'Cost of sales':
            case 'Other Income':
            case 'Administration expenses':
            case 'Finance income':
            case 'Finance costs':
            case 'Depreciation':
            case 'INVESTMENTS share':
            case 'Change In Working Capital':
            case 'Capital Expenditure':
                return `${f(prev[key])} × ${multStr}`;
            case 'Gross Profit':
                return `${f(cur['Revenue'])} − ${f(cur['Cost of sales'])}`;
            case 'EBITDA':
                return `${f(cur['Gross Profit'])} + ${f(cur['Other Income'])} − ${f(cur['Administration expenses'])}`;
            case 'Total Finance cost and depreciation':
                return `${f(cur['Finance income'])} − ${f(cur['Finance costs'])} − ${f(cur['Depreciation'])}`;
            case 'Income before tax and share allocation':
                return `${f(cur['EBITDA'])} + ${f(cur['Total Finance cost and depreciation'])}`;
            case 'Net profit before tax':
                return `${f(cur['Income before tax and share allocation'])} + ${f(cur['INVESTMENTS share'])}`;
            case 'Tax due':
                return `${f(cur['Net profit before tax'])} × ${((tax || 0) * 100).toFixed(2)}% × −1`;
            case 'Net profit after tax':
                return `${f(cur['Net profit before tax'])} + (${f(cur['Tax due'])})`;
            case 'Depreciation Expense':
                return `|${f(cur['Depreciation'])}|`;
            case 'Free Cash Flow to the Firm':
                return `${f(cur['Net profit after tax'])} + ${f(cur['Change In Working Capital'])} + ${f(cur['Capital Expenditure'])} + ${f(cur['Depreciation Expense'])}`;
            default:
                return '';
        }
    };

    const renderPlProjections = (projections, baseYear) => {
        const tbody = document.getElementById('plProjectionsBody');
        if (!tbody) return;

        const firstProjYear = baseYear + 1;
        const lastProjYear = baseYear + 5;

        // Update table column headers to match the current base year
        const headerThs = tbody.closest('table').querySelectorAll('thead tr th:not(:first-child)');
        headerThs.forEach((th, i) => { th.textContent = firstProjYear + i; });

        const rows = [
            { key: 'Revenue', label: 'Revenue', isTotal: false },
            { key: 'Cost of sales', label: 'Cost of sales', isTotal: false },
            { key: 'Gross Profit', label: 'Gross Profit', isTotal: true },
            { key: 'Other Income', label: 'Other Income', isTotal: false },
            { key: 'Administration expenses', label: 'Administration expenses', isTotal: false },
            { key: 'EBITDA', label: 'EBITDA', isTotal: true },
            { key: 'Finance income', label: 'Finance income', isTotal: false },
            { key: 'Finance costs', label: 'Finance costs', isTotal: false },
            { key: 'Depreciation', label: 'Depreciation', isTotal: false },
            { key: 'Total Finance cost and depreciation', label: 'Total Finance cost and depreciation', isTotal: true },
            { key: 'Income before tax and share allocation', label: 'Income before tax and share allocation', isTotal: true },
            { key: 'INVESTMENTS share', label: 'INVESTMENTS share', isTotal: false },
            { key: 'Net profit before tax', label: 'Net profit before tax', isTotal: true },
            { key: 'Tax due', label: 'Tax due', isTotal: false },
            { key: 'Net profit after tax', label: 'Net profit after tax', isTotal: true },
            { key: 'Depreciation Expense', label: 'Depreciation Expense', isTotal: false },
            { key: 'Free Cash Flow to the Firm', label: 'Free Cash Flow to the Firm', isTotal: true }
        ];

        tbody.innerHTML = '';

        rows.forEach(row => {
            const tr = document.createElement('tr');

            if (row.isTotal) {
                tr.style.fontWeight = '600';
                tr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                tr.style.color = 'var(--accent-primary, #60A5FA)';
            } else {
                tr.style.borderBottom = '1px solid var(--border-color)';
            }

            let html = `<td style="text-align: left; padding: 0.75rem;">${row.label}</td>`;
            for (let year = firstProjYear; year <= lastProjYear; year++) {
                const val = formatProjCurrency(projections[year][row.key]);
                const detail = getPlCalcDetail(row.key, year, projections, baseYear);
                const detailHtml = detail ? `<div class="calc-detail">${detail}</div>` : '';
                html += `<td style="padding: 0.75rem;">${val}${detailHtml}</td>`;
            }
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    };

    const renderCfProjections = (projections, baseYear) => {
        const tbody = document.getElementById('cfProjectionsBody');
        if (!tbody) return;

        const firstProjYear = baseYear + 1;
        const lastProjYear = baseYear + 5;

        // Update table column headers to match the current base year
        const headerThs = tbody.closest('table').querySelectorAll('thead tr th:not(:first-child)');
        headerThs.forEach((th, i) => { th.textContent = firstProjYear + i; });

        const rows = [
            { label: 'Revenues', plKey: 'Revenue', isTotal: false },
            { label: 'Total Revenues', plKey: 'Revenue', isTotal: true },
            { label: 'Cost of Sales', plKey: 'Cost of sales', isTotal: false },
            { label: 'Gross Profit', plKey: 'Gross Profit', isTotal: true },
            { label: 'General & administrative', plKey: 'Administration expenses', isTotal: false },
            { label: 'Total OPEX', plKey: 'Administration expenses', isTotal: true },
            { label: 'Other Income', plKey: 'Other Income', isTotal: false },
            { label: 'EBITDA', plKey: 'EBITDA', isTotal: true },
            { label: 'Finance Income', plKey: 'Finance income', isTotal: false },
            { label: 'Finance Costs', plKey: 'Finance costs', isTotal: false },
            { label: 'Depreciation and Amortization', plKey: 'Depreciation', isTotal: false },
            { label: 'Profit Before Tax', plKey: 'Net profit before tax', isTotal: true },
            { label: 'Income Tax', plKey: 'Tax due', isTotal: false },
            { label: 'Net Profit', plKey: 'Net profit after tax', isTotal: true },
            { label: 'Change In Working Capital', plKey: 'Change In Working Capital', isTotal: false },
            { label: 'Capital Expenditure', plKey: 'Capital Expenditure', isTotal: false },
            { label: 'Depreciation Expense', plKey: 'Depreciation Expense', isTotal: false },
            { label: 'Free Cash Flow to the Firm', plKey: 'Free Cash Flow to the Firm', isTotal: true }
        ];

        tbody.innerHTML = '';

        rows.forEach(row => {
            const tr = document.createElement('tr');

            if (row.isTotal) {
                tr.style.fontWeight = '600';
                tr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                tr.style.color = 'var(--accent-primary, #60A5FA)';
            } else {
                tr.style.borderBottom = '1px solid var(--border-color)';
            }

            let html = `<td style="text-align: left; padding: 0.75rem;">${row.label}</td>`;
            for (let year = firstProjYear; year <= lastProjYear; year++) {
                html += `<td style="padding: 0.75rem;">${formatProjCurrency(projections[year][row.plKey])}</td>`;
            }
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    };

    // --- DCF & Sensitivity Logic ---
    const calculateDcf = (projections, baseYear) => {
        const firstProjYear = baseYear + 1;
        if (!projections || !projections[firstProjYear]) return;

        const getVal = (id) => parseFloat(document.getElementById(id).value) || 0;
        
        // --- 0. Auto-calculate DLOM and SSP based on USD Revenue ---
        // Rate semantics: 1 USD = rate_per_usd × {currency}. So to convert a
        // local-currency amount into USD we divide. USD itself short-circuits.
        const getUsdRevenue = (projRevenue) => {
            const currencyInput = document.getElementById('currency');
            const currency = currencyInput ? currencyInput.value : '';
            if (!currency || currency === 'US $' || currency === 'USD') {
                return projRevenue;
            }
            const fxInput = document.getElementById('eurUsdRate');
            const rate = fxInput && fxInput.value ? parseFloat(fxInput.value) : NaN;
            if (!isFinite(rate) || rate <= 0) return projRevenue; // missing rate → assume already-USD
            return projRevenue / rate;
        };

        const getDlom = (usdRevenue) => {
            if (usdRevenue >= 100000000) return 0.1490;
            if (usdRevenue >= 50000000) return 0.1940;
            if (usdRevenue >= 30000000) return 0.2520;
            if (usdRevenue >= 10000000) return 0.3080;
            return 0.3290;
        };

        const getSmallStockPremium = (usdRevenue) => {
            if (usdRevenue >= 24361659000) return -0.0035;
            if (usdRevenue >= 10784101000) return 0.0061;
            if (usdRevenue >= 5683991000) return 0.0089;
            if (usdRevenue >= 3520566000) return 0.0098;
            if (usdRevenue >= 2392689000) return 0.0151;
            if (usdRevenue >= 1571193000) return 0.0166;
            if (usdRevenue >= 1033341000) return 0.0172;
            if (usdRevenue >= 569279000) return 0.0208;
            if (usdRevenue >= 263715000) return 0.0268;
            return 0.0559;
        };

        const projRevenue2025 = projections[firstProjYear]['Revenue'] || 0;
        const usdRevenue = getUsdRevenue(projRevenue2025);
        
        const dlomAuto = getDlom(usdRevenue);
        const dlomEl = document.getElementById('dlom');
        if (dlomEl) dlomEl.value = (dlomAuto * 100).toFixed(2);
        
        const sspAuto = getSmallStockPremium(usdRevenue);
        const sspEl = document.getElementById('smallStockPremium');
        if (sspEl) sspEl.value = (sspAuto * 100).toFixed(2);

        // 1. Valuation Assumptions
        const rf = getVal('dcfRiskFreeRate') / 100;
        const erp = getVal('dcfErp') / 100;
        const crp = getVal('dcfCrp') / 100;
        const beta = getVal('companyBeta');
        const ssp = getVal('smallStockPremium') / 100;

        const costOfEquity = rf + (beta * erp) + crp + ssp;
        const costOfEquityEl = document.getElementById('costOfEquity');
        if (costOfEquityEl) costOfEquityEl.value = (costOfEquity * 100).toFixed(2);
        const costOfEquityCalc = document.getElementById('costOfEquityCalc');
        if (costOfEquityCalc) {
            const pct = (v) => (v * 100).toFixed(2) + '%';
            costOfEquityCalc.textContent = `rf + β × ERP + CRP + SSP = ${pct(rf)} + ${beta.toFixed(2)} × ${pct(erp)} + ${pct(crp)} + ${pct(ssp)}`;
        }

        const debtWeight = getVal('debtWeight') / 100;
        const equityWeight = 1 - debtWeight;
        const equityWeightEl = document.getElementById('equityWeight');
        if (equityWeightEl) equityWeightEl.value = (equityWeight * 100).toFixed(2);

        const avgInterest = getVal('averageInterestPaid') / 100;
        const taxRate = getVal('dcfTaxRate') / 100;
        const costOfDebt = avgInterest * (1 - taxRate);
        const costOfDebtEl = document.getElementById('costOfDebtAfterTax');
        if (costOfDebtEl) costOfDebtEl.value = (costOfDebt * 100).toFixed(2);
        const costOfDebtCalc = document.getElementById('costOfDebtCalc');
        if (costOfDebtCalc) {
            const pct = (v) => (v * 100).toFixed(2) + '%';
            costOfDebtCalc.textContent = `Avg interest × (1 − tax) = ${pct(avgInterest)} × (1 − ${pct(taxRate)})`;
        }

        const wacc = (costOfEquity * equityWeight) + (costOfDebt * debtWeight);
        const waccEl = document.getElementById('wacc');
        if (waccEl) waccEl.value = (wacc * 100).toFixed(2);
        const waccCalc = document.getElementById('waccCalc');
        if (waccCalc) {
            const pct = (v) => (v * 100).toFixed(2) + '%';
            waccCalc.textContent = `CoE × equity_w + CoD × debt_w = ${pct(costOfEquity)} × ${pct(equityWeight)} + ${pct(costOfDebt)} × ${pct(debtWeight)}`;
        }
        
        const perpetualGrowth = getVal('perpetualGrowthRate') / 100;
        const dlom = getVal('dlom') / 100;

        // 2. Base DCF Valuation
        const baseEv = runDcfEngine(projections, wacc, perpetualGrowth, dlom, 1.0, baseYear);
        renderDcfTable(baseEv);

        // 3. Sensitivity Matrices
        const sensBounds = renderSensitivityMatrices(projections, wacc, perpetualGrowth, dlom, baseYear);
        
        if (typeof renderValuationSummaryAndRange === 'function') {
            renderValuationSummaryAndRange(baseEv, sensBounds.s1Ev, sensBounds.s2Ev, baseYear);
        }
    };

    const runDcfEngine = (projections, wacc, perpetualGrowth, dlom, fcfMultiplier, baseYear) => {
        const firstProjYear = baseYear + 1;
        const lastProjYear = baseYear + 5;
        let pvSum = 0;
        let dcfData = [];

        for (let year = firstProjYear; year <= lastProjYear; year++) {
            const t = year - baseYear; // 1.0 to 5.0
            const factor = 1 / Math.pow(1 + wacc, t);
            const fcff = projections[year]['Free Cash Flow to the Firm'] * fcfMultiplier;
            const pv = fcff * factor;
            pvSum += pv;
            
            dcfData.push({
                year: year,
                t: t,
                fcff: fcff,
                factor: factor,
                pv: pv
            });
        }
        
        // Terminal Value
        const lastFcff = dcfData[dcfData.length - 1].fcff;
        const terminalFcff = lastFcff * (1 + perpetualGrowth);
        
        let tv = 0;
        let pvOfTv = 0;
        let isTvValid = perpetualGrowth < wacc;
        
        if (isTvValid) {
            tv = terminalFcff / (wacc - perpetualGrowth);
            pvOfTv = tv * dcfData[dcfData.length - 1].factor;
        }
        
        dcfData.push({
            year: 'Terminal',
            t: 5.0,
            fcff: terminalFcff,
            factor: dcfData[dcfData.length - 1].factor,
            pv: isTvValid ? pvOfTv : null
        });
        
        const npv = pvSum + pvOfTv;
        const dlomAmount = npv * dlom;
        const ev = npv - dlomAmount;

        return {
            wacc,
            perpetualGrowth,
            fcfMultiplier,
            dlom,
            data: dcfData,
            pvSum,
            pvOfTv,
            tv,
            terminalFcff,
            npv,
            dlomAmount,
            ev,
            isTvValid
        };
    };

    const renderDcfTable = (baseEv) => {
        const tbody = document.getElementById('dcfModelBody');
        const finalDiv = document.getElementById('dcfFinalValuation');
        if (!tbody || !finalDiv) return;

        const fmt = (v) => v == null ? 'N/A' : Math.round(v).toLocaleString('en-US');
        const fmtPct = (v) => (v * 100).toFixed(2) + '%';
        const fmtFactor = (v) => v.toFixed(4);
        const calcCell = (val, detail) => `<td style="padding: 0.75rem;">${val}${detail ? `<div class="calc-detail">${detail}</div>` : ''}</td>`;
        const calcCellBold = (val, detail) => `<td style="padding: 0.75rem; font-weight: bold;">${val}${detail ? `<div class="calc-detail" style="font-weight: 400;">${detail}</div>` : ''}</td>`;

        const lastNonTerminal = baseEv.data[baseEv.data.length - 2];

        let html = '';

        html += `<tr><td style="text-align: left; padding: 0.75rem;">Discount periods</td>`;
        baseEv.data.forEach(d => html += `<td style="padding: 0.75rem;">${d.t.toFixed(1)}</td>`);
        html += `</tr>`;

        // FCFF row — terminal cell gets calc detail showing terminal-FCFF derivation
        html += `<tr><td style="text-align: left; padding: 0.75rem;">Free Cash Flow to the Firm</td>`;
        baseEv.data.forEach(d => {
            const detail = (d.year === 'Terminal' && lastNonTerminal)
                ? `${fmt(lastNonTerminal.fcff)} × (1 + ${fmtPct(baseEv.perpetualGrowth)})`
                : '';
            html += calcCell(fmt(d.fcff), detail);
        });
        html += `</tr>`;

        // Discount factor row — every cell shows 1 / (1 + WACC)^t
        let rowFactor = `<tr><td style="text-align: left; padding: 0.75rem;">WACC: <span style="margin-left: 20px;">${fmtPct(baseEv.wacc)}</span><br>Discount Factor</td>`;
        baseEv.data.forEach(d => {
            const detail = `1 / (1 + ${fmtPct(baseEv.wacc)})^${d.t.toFixed(1)}`;
            rowFactor += calcCell(fmtFactor(d.factor), detail);
        });
        rowFactor += `</tr>`;
        html += rowFactor;

        // Present Value row — terminal cell shows (TV / (WACC − g)) × factor; others show FCFF × factor
        html += `<tr style="border-top: 1px solid var(--border-color); border-bottom: 2px solid var(--border-color);">
                 <td style="text-align: left; padding: 0.75rem; font-weight: bold;">Present Value (USD)</td>`;
        baseEv.data.forEach(d => {
            let detail = '';
            if (d.year === 'Terminal') {
                if (baseEv.isTvValid) {
                    detail = `(${fmt(baseEv.terminalFcff)} / (${fmtPct(baseEv.wacc)} − ${fmtPct(baseEv.perpetualGrowth)})) × ${fmtFactor(d.factor)}`;
                } else {
                    detail = `g ≥ WACC → terminal invalid`;
                }
            } else {
                detail = `${fmt(d.fcff)} × ${fmtFactor(d.factor)}`;
            }
            html += calcCellBold(fmt(d.pv), detail);
        });
        html += `</tr>`;

        tbody.innerHTML = html;

        const npvDetail = `Σ PVs + PV(TV) = ${fmt(baseEv.pvSum)} + ${fmt(baseEv.pvOfTv)}`;
        const dlomDetail = `NPV × DLOM = ${fmt(baseEv.npv)} × ${fmtPct(baseEv.dlom)}`;
        const evDetail = `NPV − DLOM = ${fmt(baseEv.npv)} − ${fmt(baseEv.dlomAmount)}`;

        finalDiv.innerHTML = `
            <table style="width: 400px; border-collapse: collapse;">
                <tr>
                    <td style="padding: 0.5rem 0;">Net Present Value - Based on CAPM</td>
                    <td style="text-align: right; font-weight: bold;">
                        ${fmt(baseEv.npv)}
                        <div class="calc-detail">${npvDetail}</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 0.5rem 0;">Less: Discounts (DLOM)</td>
                    <td style="text-align: right;">
                        ${fmt(-baseEv.dlomAmount)}
                        <div class="calc-detail">${dlomDetail}</div>
                    </td>
                </tr>
                <tr style="border-top: 2px solid var(--border-color); border-bottom: 4px double var(--border-color); background-color: var(--bg-surface-hover);">
                    <td style="padding: 0.5rem 0; font-weight: bold; color: var(--accent-primary);">Enterprise Value (EV)</td>
                    <td style="text-align: right; font-weight: bold; color: var(--accent-primary);">
                        ${fmt(baseEv.ev)}
                        <div class="calc-detail" style="color: var(--text-muted);">${evDetail}</div>
                    </td>
                </tr>
            </table>
        `;
    };

    const renderSensitivityMatrices = (projections, baseWacc, baseGrowth, dlom, baseYear) => {
        const growthTbody = document.getElementById('sensGrowthBody');
        const discTbody = document.getElementById('sensDiscountBody');
        if (!growthTbody || !discTbody) return { s1Ev: 0, s2Ev: 0 };

        // Read user-controlled step + FCF bounds; fall back to defaults if blank/invalid.
        const readNum = (id, fallback) => {
            const raw = parseFloat(document.getElementById(id)?.value);
            return (isFinite(raw) && raw > 0) ? raw : fallback;
        };
        const growthStep = readNum('sensGrowthStep', 3.00) / 100;
        const discountStep = readNum('sensDiscountStep', 3.00) / 100;
        const fcfLowerPct = readNum('sensFcfLower', 90);
        const fcfUpperPct = readNum('sensFcfUpper', 110);
        const fcfMults = [fcfLowerPct / 100, 1.0, fcfUpperPct / 100];

        // Sync column headers so labels track the user's bounds.
        const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        setText('sensGrowthColLower', `${fcfLowerPct}% FCF`);
        setText('sensGrowthColUpper', `${fcfUpperPct}% FCF`);
        setText('sensDiscountColLower', `${fcfLowerPct}% FCF`);
        setText('sensDiscountColUpper', `${fcfUpperPct}% FCF`);

        const fmt = (v) => v == null ? 'N/A' : Math.round(v).toLocaleString('en-US');
        const fmtPct = (v) => (v * 100).toFixed(2) + '%';

        // Sensitivity 1 — Growth rate table
        const gEvs = [];
        let gHtml = '';
        const gRates = [baseGrowth - growthStep, baseGrowth, baseGrowth + growthStep];
        gRates.forEach(g => {
            gHtml += `<tr><td style="text-align: left; padding: 0.5rem; font-weight: bold;">${fmtPct(g)}</td>`;
            fcfMults.forEach(m => {
                const evObj = runDcfEngine(projections, baseWacc, g, dlom, m, baseYear);
                gEvs.push(evObj.ev);
                const isCenter = (Math.abs(g - baseGrowth) < 0.0001 && Math.abs(m - 1.0) < 0.0001);
                const bg = isCenter ? 'background-color: rgba(16, 185, 129, 0.15);' : '';
                const detail = `NPV ${fmt(evObj.npv)} − DLOM ${fmt(evObj.dlomAmount)}`;
                gHtml += `<td style="padding: 0.5rem; text-align: center; ${bg}">${fmt(evObj.ev)}<div class="calc-detail" style="text-align: center;">${detail}</div></td>`;
            });
            gHtml += `</tr>`;
        });
        growthTbody.innerHTML = gHtml;

        // Sensitivity 2 — Discount rate table
        const dEvs = [];
        let dHtml = '';
        const dRates = [baseWacc - discountStep, baseWacc, baseWacc + discountStep];
        dRates.forEach(w => {
            dHtml += `<tr><td style="text-align: left; padding: 0.5rem; font-weight: bold;">${fmtPct(w)}</td>`;
            fcfMults.forEach(m => {
                const evObj = runDcfEngine(projections, w, baseGrowth, dlom, m, baseYear);
                dEvs.push(evObj.ev);
                const isCenter = (Math.abs(w - baseWacc) < 0.0001 && Math.abs(m - 1.0) < 0.0001);
                const bg = isCenter ? 'background-color: rgba(16, 185, 129, 0.15);' : '';
                const detail = `NPV ${fmt(evObj.npv)} − DLOM ${fmt(evObj.dlomAmount)}`;
                dHtml += `<td style="padding: 0.5rem; text-align: center; ${bg}">${fmt(evObj.ev)}<div class="calc-detail" style="text-align: center;">${detail}</div></td>`;
            });
            dHtml += `</tr>`;
        });
        discTbody.innerHTML = dHtml;

        const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
        return { s1Ev: avg(gEvs), s2Ev: avg(dEvs) };
    };

    const renderValuationSummaryAndRange = (baseEv, s1Ev, s2Ev, baseYear) => {
        const getInputVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;
        const totalCash = getInputVal('totalCash');
        const totalDebt = getInputVal('totalDebt');

        const avgEv = (s1Ev + s2Ev) / 2;

        const equityVal1 = s1Ev - totalDebt + totalCash;
        const equityVal2 = s2Ev - totalDebt + totalCash;
        const avgEquity = (equityVal1 + equityVal2) / 2;

        const fmt = (v) => (v == null || !isFinite(v)) ? '--' : Math.round(v).toLocaleString('en-US');

        const currencyEl = document.getElementById('currency');
        const currCode = (currencyEl && currencyEl.value) ? currencyEl.value : '--';
        const currSymbol = getCurrencySymbol(currCode);
        const dateStr = `31/12/${baseYear}`;

        // Update dynamic header cells — show the symbol (€, $, …) under each
        // sensitivity column, falling back to the code if no symbol mapping.
        const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        setEl('summaryEquityDateLabel', dateStr);
        setEl('summaryEvDateLabel', dateStr);
        const headerCurrLabel = currCode === '--' ? '--' : (currSymbol.trim() || currCode);
        ['summaryEquityCurr1', 'summaryEquityCurr2', 'summaryEvCurr1', 'summaryEvCurr2'].forEach(id => setEl(id, headerCurrLabel));

        // Update tfoot Cash / Debt labels with current base year
        setEl('summaryCashLabel', `Cash as at ${dateStr}`);
        setEl('summaryDebtLabel', `Debt ${dateStr}`);

        // Render Equity Table (3 columns: Label | S1 | S2)
        const eqDetail1 = `${fmt(s1Ev)} − ${fmt(totalDebt)} + ${fmt(totalCash)}`;
        const eqDetail2 = `${fmt(s2Ev)} − ${fmt(totalDebt)} + ${fmt(totalCash)}`;
        const eqAvgDetail = `(${fmt(equityVal1)} + ${fmt(equityVal2)}) / 2`;
        const eqTbody = document.getElementById('summaryEquityTableBody');
        if (eqTbody) {
            eqTbody.innerHTML = `
                <tr>
                    <td>Equity Value</td>
                    <td>${fmt(equityVal1)}<div class="calc-detail">${eqDetail1}</div></td>
                    <td>${fmt(equityVal2)}<div class="calc-detail">${eqDetail2}</div></td>
                </tr>
                <tr class="summary-average-row">
                    <td>Average Equity Value</td>
                    <td colspan="2">${currSymbol}${fmt(avgEquity)}<div class="calc-detail">${eqAvgDetail}</div></td>
                </tr>
            `;
        }

        // Render EV Table (3 columns: Label | S1 | S2)
        const evDetail1 = `average of growth-sensitivity scenarios`;
        const evDetail2 = `average of discount-sensitivity scenarios`;
        const evAvgDetail = `(${fmt(s1Ev)} + ${fmt(s2Ev)}) / 2`;
        const evTbody = document.getElementById('summaryEvTableBody');
        if (evTbody) {
            evTbody.innerHTML = `
                <tr>
                    <td>Enterprise Value</td>
                    <td>${fmt(s1Ev)}<div class="calc-detail">${evDetail1}</div></td>
                    <td>${fmt(s2Ev)}<div class="calc-detail">${evDetail2}</div></td>
                </tr>
                <tr class="summary-average-row">
                    <td>Average Enterprise Value</td>
                    <td colspan="2">${currSymbol}${fmt(avgEv)}<div class="calc-detail">${evAvgDetail}</div></td>
                </tr>
            `;
        }

        // Render range graphic
        const minEq = Math.min(equityVal1, equityVal2);
        const maxEq = Math.max(equityVal1, equityVal2);

        // Auto-scale axis with rounded step
        const niceScale = (minVal, maxVal) => {
            if (!isFinite(minVal) || !isFinite(maxVal)) return { min: 0, max: 1e6, step: 2e5 };
            if (minVal === 0 && maxVal === 0) return { min: 0, max: 1e6, step: 2e5 };
            let lo = minVal, hi = maxVal;
            if (lo === hi) { const p = Math.abs(lo) * 0.2 || 1; lo -= p; hi += p; }
            const range = hi - lo;
            const padding = Math.max(range * 0.5, Math.abs(hi) * 0.05);
            let rawMin = lo - padding;
            let rawMax = hi + padding;
            if (minVal >= 0 && rawMin < 0) rawMin = 0;
            const targetTicks = 6;
            const roughStep = (rawMax - rawMin) / targetTicks;
            const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
            const niceMultipliers = [1, 2, 2.5, 5, 10];
            let step = magnitude * 10;
            for (const m of niceMultipliers) {
                if (m * magnitude >= roughStep) { step = m * magnitude; break; }
            }
            return {
                min: Math.floor(rawMin / step) * step,
                max: Math.ceil(rawMax / step) * step,
                step
            };
        };

        const axis = niceScale(minEq, maxEq);
        const axisRange = axis.max - axis.min;
        const posPct = (v) => axisRange > 0 ? ((v - axis.min) / axisRange) * 100 : 50;

        const formatAxisVal = (v, code, step) => {
            const prefix = getCurrencySymbol(code);
            const absV = Math.abs(v);
            let denom = 1, suffix = '';
            if (absV >= 1e9 || step >= 1e9) { denom = 1e9; suffix = 'B'; }
            else if (absV >= 1e6 || step >= 1e6) { denom = 1e6; suffix = 'M'; }
            else if (absV >= 1e3 || step >= 1e3) { denom = 1e3; suffix = 'K'; }
            const scaled = v / denom;
            const stepScaled = step / denom;
            const decimals = stepScaled < 0.1 ? 2 : (stepScaled < 1 ? 1 : 0);
            return `${prefix}${scaled.toFixed(decimals)}${suffix}`;
        };

        // Position filled bar
        const fillBar = document.getElementById('rangeFilledBar');
        if (fillBar) {
            fillBar.style.left = `${posPct(minEq)}%`;
            fillBar.style.right = `${100 - posPct(maxEq)}%`;
        }

        // Position endpoint labels (both anchored via `left` for consistency)
        const minLabel = document.getElementById('rangeMinLabel');
        const maxLabel = document.getElementById('rangeMaxLabel');
        if (minLabel) {
            minLabel.style.left = `${posPct(minEq)}%`;
            minLabel.style.right = 'auto';
            minLabel.style.transform = 'translateX(-50%)';
            minLabel.innerText = fmt(minEq);
        }
        if (maxLabel) {
            maxLabel.style.left = `${posPct(maxEq)}%`;
            maxLabel.style.right = 'auto';
            maxLabel.style.transform = 'translateX(-50%)';
            maxLabel.innerText = fmt(maxEq);
        }

        // Position average marker
        const pointLabel = document.getElementById('rangePointLabel');
        if (pointLabel) pointLabel.innerText = fmt(avgEquity);
        const pointMarker = document.getElementById('rangePointMarker');
        if (pointMarker) pointMarker.style.left = `${posPct(avgEquity)}%`;

        // Render axis ticks
        const axisEl = document.getElementById('rangeAxisTicks');
        if (axisEl) {
            const ticks = [];
            for (let v = axis.min; v <= axis.max + axis.step * 0.001; v += axis.step) {
                ticks.push(v);
            }
            axisEl.innerHTML = ticks.map(v => `<span>${formatAxisVal(v, currCode, axis.step)}</span>`).join('');
        }
    };

    // Initialize DCF Input Listeners
    const dcfInputs = ['dcfCrp', 'debtWeight', 'averageInterestPaid', 'perpetualGrowthRate', 'totalCash', 'totalDebt', 'sensGrowthStep', 'sensDiscountStep', 'sensFcfLower', 'sensFcfUpper'];
    dcfInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (typeof calculatePlProjections === 'function') calculatePlProjections();
        });
    });

    // Projection-driver inputs (override growth, capex, investments share) trigger recalc
    const projectionInputs = ['revenueGrowthOverride', 'capex', 'investmentsShare'];
    projectionInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (typeof calculatePlProjections === 'function') calculatePlProjections();
        });
    });

    // Calculation-detail toggle: per-tab "Show Calculations" buttons
    document.querySelectorAll('[data-calc-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.closest('.tab-content');
            if (!tab) return;
            const on = tab.classList.toggle('show-calc');
            const label = btn.querySelector('.calc-toggle-label');
            if (label) label.textContent = on ? 'Hide Calculations' : 'Show Calculations';
        });
    });

    // Initialize the projections with default zeros
    calculatePlProjections();

    // Change In Working Capital State Capture
    const cwcInput = document.getElementById('changeInWorkingCapital');
    if (cwcInput) {
        cwcInput.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            referenceDataState.changeInWorkingCapital = isNaN(val) ? null : val;
            console.log('Change In Working Capital Updated:', referenceDataState.changeInWorkingCapital);
        });
    }

    // PDF Export
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', async () => {
            if (!window.jspdf || !window.html2canvas) {
                alert('PDF libraries failed to load. Check your internet connection and reload the page.');
                return;
            }
            const originalText = exportPdfBtn.innerText;
            exportPdfBtn.innerText = 'Generating PDF...';
            exportPdfBtn.disabled = true;
            try {
                await generatePdfReport();
            } catch (err) {
                console.error('PDF generation failed:', err);
                alert('PDF generation failed: ' + err.message);
            } finally {
                exportPdfBtn.innerText = originalText;
                exportPdfBtn.disabled = false;
            }
        });
    }

    const generatePdfReport = async () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 18;
        const contentW = pageW - 2 * margin;
        const colGap = 8;
        const colW = (contentW - colGap) / 2;

        // Palette
        const TEXT = [25, 25, 25];
        const MUTED = [120, 120, 120];
        const RULE = [200, 200, 200];
        const BRAND = [196, 214, 0];
        const BRAND_LIGHT = [232, 240, 130];
        const RED = [192, 32, 32];

        // Damodaran edition — pulled at page load from /api/meta/damodaran-edition,
        // which reads the ReportMeta row written by update_damodaran.py. Falls back
        // to the default string if the meta call hasn't completed (or failed).
        const DAMODARAN_EDITION = damodaranEdition;
        // OECD reference year for the terminal growth paragraph. Static — edit here
        // when you refresh OECD projections.
        const OECD_REFERENCE_YEAR = 2027;

        // --- Helpers ---
        const getFieldVal = (id) => {
            const el = document.getElementById(id);
            return el ? (el.value || '').trim() : '';
        };

        const formatLongDate = (s) => {
            if (!s) return '—';
            const d = new Date(s);
            if (isNaN(d.getTime())) return s;
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        };

        const formatMonthYear = (s) => {
            if (!s) return '—';
            const d = new Date(s);
            if (isNaN(d.getTime())) return s;
            return `${d.toLocaleString('en-US', { month: 'long' })}, ${d.getFullYear()}`;
        };

        // Matches Excel TEXT(date, "dd mmm yyyy") e.g. "25 Jun 2018"
        const formatExcelDate = (s) => {
            if (!s) return '';
            const d = new Date(s);
            if (isNaN(d.getTime())) return s;
            const day = String(d.getDate()).padStart(2, '0');
            const month = d.toLocaleString('en-US', { month: 'short' });
            return `${day} ${month} ${d.getFullYear()}`;
        };

        // Matches the valuation-date format used in cover ("31 December 2024") but without the
        // em-dash fallback, so empty fields concatenate as empty strings (Excel behavior).
        const formatLongDateRaw = (s) => {
            if (!s) return '';
            const d = new Date(s);
            if (isNaN(d.getTime())) return s;
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        };

        const drawSectionHeading = (text, x, y) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(13);
            doc.setTextColor(...TEXT);
            doc.text(text, x, y);
            doc.setDrawColor(...RULE);
            doc.line(x, y + 2, x + contentW, y + 2);
            return y + 9;
        };

        const drawSubheading = (text, x, y, size = 10) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(size);
            doc.setTextColor(...TEXT);
            doc.text(text, x, y);
            return y + size * 0.45 + 1.5;
        };

        const drawBody = (text, x, y, w, size = 9, style = 'normal') => {
            doc.setFont('helvetica', style);
            doc.setFontSize(size);
            doc.setTextColor(...TEXT);
            const lines = doc.splitTextToSize(text || '—', w);
            doc.text(lines, x, y);
            return y + lines.length * size * 0.45 + 1;
        };

        // Centered italic math equation
        const drawFormula = (text, x, y, w) => {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(10);
            doc.setTextColor(...TEXT);
            const lines = doc.splitTextToSize(text, w);
            lines.forEach((line, i) => {
                doc.text(line, x + w / 2, y + 4 + i * 5, { align: 'center' });
            });
            return y + 4 + lines.length * 5;
        };

        // Small underlined caption (e.g. "DCF valuation inputs:")
        const drawUnderlineLine = (text, x, y, size = 9) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(size);
            doc.setTextColor(...TEXT);
            doc.text(text, x, y);
            const tw = doc.getTextWidth(text);
            doc.setDrawColor(...TEXT);
            doc.line(x, y + 0.8, x + tw, y + 0.8);
            return y + size * 0.45 + 1;
        };

        // Small footnote-style URL/citation
        const drawFootnoteLine = (text, x, y, w) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(80, 80, 160);
            const lines = doc.splitTextToSize(text, w);
            doc.text(lines, x, y);
            return y + lines.length * 3 + 1;
        };

        // Compact factor table (Factor | Factor name | optional Factor value).
        // columns: [{ name, widthPct, align?, headerAlign? }]
        // rows: [[c0, c1, c2?]]
        const drawFactorTable = (x, y, w, columns, rows, opts = {}) => {
            const rowH = opts.rowH || 5.5;
            const fontSize = opts.fontSize || 7.5;
            let yCur = y;

            // Header row
            doc.setFillColor(...BRAND);
            doc.rect(x, yCur, w, rowH, 'F');
            doc.setDrawColor(...RULE);
            let xCur = x;
            columns.forEach(col => {
                const cw = w * col.widthPct;
                doc.rect(xCur, yCur, cw, rowH);
                xCur += cw;
            });
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(fontSize);
            doc.setTextColor(...TEXT);
            xCur = x;
            columns.forEach(col => {
                const cw = w * col.widthPct;
                const ha = col.headerAlign || 'left';
                const tx = ha === 'right' ? xCur + cw - 1.5
                    : ha === 'center' ? xCur + cw / 2
                    : xCur + 1.5;
                doc.text(col.name, tx, yCur + rowH / 2 + 1.3, { align: ha });
                xCur += cw;
            });
            yCur += rowH;

            // Data rows
            rows.forEach(row => {
                xCur = x;
                columns.forEach((col, i) => {
                    const cw = w * col.widthPct;
                    doc.setDrawColor(...RULE);
                    doc.rect(xCur, yCur, cw, rowH);
                    if (i === 0) doc.setFont('helvetica', 'bolditalic');
                    else doc.setFont('helvetica', 'normal');
                    doc.setFontSize(fontSize);
                    doc.setTextColor(...TEXT);
                    const align = col.align || 'left';
                    const tx = align === 'right' ? xCur + cw - 1.5
                        : align === 'center' ? xCur + cw / 2
                        : xCur + 1.5;
                    doc.text(String(row[i] || ''), tx, yCur + rowH / 2 + 1.3, { align });
                    xCur += cw;
                });
                yCur += rowH;
            });
            return yCur;
        };

        // Render a column of blocks.
        // Supported block types:
        //   { type: 'sub', text, size? }       — bold subheading
        //   { type: 'underline', text, size? } — small bold underlined caption
        //   { type: 'body', text, size? }      — body text
        //   { type: 'formula', text }          — centered italic equation
        //   { type: 'footnote', text }         — small blue citation/URL line
        //   { type: 'factable', columns, rows, opts? } — compact factor table
        //   { type: 'spacer', h? }             — vertical gap
        const drawColumn = (blocks, x, y, w) => {
            let yCur = y;
            blocks.forEach(b => {
                if (b.type === 'sub') yCur = drawSubheading(b.text, x, yCur, b.size || 10) + 2;
                else if (b.type === 'underline') yCur = drawUnderlineLine(b.text, x, yCur, b.size || 9) + 1;
                else if (b.type === 'spacer') yCur += (b.h || 4);
                else if (b.type === 'formula') yCur = drawFormula(b.text, x, yCur, w) + 3;
                else if (b.type === 'footnote') yCur = drawFootnoteLine(b.text, x, yCur, w) + 2;
                else if (b.type === 'factable') yCur = drawFactorTable(x, yCur, w, b.columns, b.rows, b.opts || {}) + 3;
                else yCur = drawBody(b.text, x, yCur, w, b.size || 9, b.style || 'normal') + 3;
            });
            return yCur;
        };

        const drawTwoCol = (leftBlocks, rightBlocks, yStart) => {
            const leftEnd = drawColumn(leftBlocks, margin, yStart, colW);
            const rightEnd = drawColumn(rightBlocks, margin + colW + colGap, yStart, colW);
            return Math.max(leftEnd, rightEnd);
        };

        // Native table renderer. Supports an optional spanning sub-header above the main header row.
        const drawTable = ({ x, y, colWidths, headers, rows, baseCaseIdx, headerLabel, rowH = 7 }) => {
            const totalW = colWidths.reduce((a, b) => a + b, 0);
            let yCur = y;

            if (headerLabel) {
                // First col blank, remaining cols spanned by headerLabel with brand-light fill
                const spannedW = colWidths.slice(1).reduce((a, b) => a + b, 0);
                doc.setFillColor(...BRAND_LIGHT);
                doc.rect(x + colWidths[0], yCur, spannedW, rowH, 'F');
                doc.setDrawColor(...RULE);
                doc.rect(x + colWidths[0], yCur, spannedW, rowH);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(...TEXT);
                doc.text(headerLabel, x + colWidths[0] + spannedW / 2, yCur + rowH / 2 + 1, { align: 'center' });
                yCur += rowH;
            }

            // Header row with brand fill
            doc.setFillColor(...BRAND);
            doc.rect(x, yCur, totalW, rowH, 'F');
            doc.setDrawColor(...RULE);
            let xCur = x;
            for (let i = 0; i < headers.length; i++) {
                doc.rect(xCur, yCur, colWidths[i], rowH);
                xCur += colWidths[i];
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...TEXT);
            xCur = x;
            for (let i = 0; i < headers.length; i++) {
                doc.text(headers[i], xCur + colWidths[i] / 2, yCur + rowH / 2 + 1, { align: 'center' });
                xCur += colWidths[i];
            }
            yCur += rowH;

            // Data rows
            rows.forEach((row, rIdx) => {
                xCur = x;
                for (let i = 0; i < row.length; i++) {
                    doc.setDrawColor(...RULE);
                    doc.rect(xCur, yCur, colWidths[i], rowH);
                    const isBase = baseCaseIdx && rIdx === baseCaseIdx[0] && i === baseCaseIdx[1];
                    if (isBase) {
                        doc.setFont('helvetica', 'bold');
                        doc.setTextColor(...RED);
                    } else {
                        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
                        doc.setTextColor(...TEXT);
                    }
                    doc.setFontSize(8);
                    const align = i === 0 ? 'left' : 'center';
                    const tx = i === 0 ? xCur + 2 : xCur + colWidths[i] / 2;
                    doc.text(String(row[i] || ''), tx, yCur + rowH / 2 + 1, { align });
                    xCur += colWidths[i];
                }
                yCur += rowH;
            });
            return yCur;
        };

        const extractTableRows = (tbodyId) => {
            const tbody = document.getElementById(tbodyId);
            if (!tbody) return [];
            return Array.from(tbody.querySelectorAll('tr')).map(tr =>
                Array.from(tr.querySelectorAll('td')).map(td => {
                    const clone = td.cloneNode(true);
                    clone.querySelectorAll('.calc-detail').forEach(d => d.remove());
                    return clone.textContent.trim();
                })
            );
        };

        // --- Gather data ---
        const companyName = getFieldVal('companyName') || 'Untitled Company';
        const valuationDate = formatLongDate(getFieldVal('valuationDate'));
        const reportDate = formatMonthYear(getFieldVal('reportDate'));

        const sectionPages = {};

        // ========== PAGE 1: COVER ==========
        const imagePreview = document.getElementById('imagePreview');
        if (imagePreview && imagePreview.src && imagePreview.src.startsWith('data:image')) {
            try {
                const imgProps = doc.getImageProperties(imagePreview.src);
                const targetW = colW;
                let imgH = targetW * imgProps.height / imgProps.width;
                let imgW = targetW;
                if (imgH > 70) { imgH = 70; imgW = imgH * imgProps.width / imgProps.height; }
                doc.addImage(imagePreview.src, 'PNG', margin, margin + 10, imgW, imgH);
            } catch (e) { console.warn('Cover image embed failed:', e); }
        }

        let coverY = margin + 25;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor(...TEXT);
        const nameLines = doc.splitTextToSize(companyName, colW);
        doc.text(nameLines, pageW - margin, coverY, { align: 'right' });
        coverY += nameLines.length * 8 + 14;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(15);
        doc.text('Equity Value', pageW - margin, coverY, { align: 'right' });
        coverY += 7;
        doc.text('Compact Report', pageW - margin, coverY, { align: 'right' });
        coverY += 16;

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(11);
        doc.setTextColor(...MUTED);
        doc.text(`Valuation as at ${valuationDate}`, pageW - margin, coverY, { align: 'right' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...TEXT);
        doc.text(reportDate, pageW - margin, margin + 100, { align: 'right' });

        // ========== PAGE 2: TOC (placeholder, filled later) ==========
        doc.addPage();
        const tocPageNum = doc.internal.getCurrentPageInfo().pageNumber;

        // ========== PAGE 3: SECTION I ==========
        doc.addPage();
        sectionPages.I = doc.internal.getCurrentPageInfo().pageNumber;
        let y = margin + 8;
        y = drawSectionHeading('I. Scope of the Valuation Exercise and Company Overview', margin, y);
        y += 4;

        // --- Compose Section I paragraphs from live inputs ---
        const legalForm = getFieldVal('legalForm');
        const regNumber = getFieldVal('regNumber');
        const incCountry = getFieldVal('incCountry');
        const incDateFmt = formatExcelDate(getFieldVal('incDate'));
        const registeredAddress = getFieldVal('registeredAddress');
        const companyDescription = getFieldVal('companyDescription');
        const valuationDateLong = formatLongDateRaw(getFieldVal('valuationDate'));

        const shareholderEls = document.querySelectorAll('input[name="shareholders[]"]');
        const shareholderPctEls = document.querySelectorAll('input[name="shareholderPct[]"]');
        const shareholderList = Array.from(shareholderEls)
            .map((el, i) => ({
                name: el.value.trim(),
                pct: shareholderPctEls[i] ? shareholderPctEls[i].value.trim() : ''
            }))
            .filter(s => s.name);

        const joinWithAnd = (items) => {
            if (items.length === 0) return '';
            if (items.length === 1) return items[0];
            if (items.length === 2) return `${items[0]} and ${items[1]}`;
            return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
        };

        const buildUboParagraph = () => {
            if (shareholderList.length === 0) {
                return 'The Ultimate Beneficial Owners (hereafter "UBOs") of the Company are .';
            }
            const names = joinWithAnd(shareholderList.map(s => s.name));
            const pcts = joinWithAnd(shareholderList.map(s => s.pct ? `${s.pct}%` : ''));
            const verb = shareholderList.length === 1 ? 'is' : 'are';
            const holds = shareholderList.length === 1 ? 'holds' : 'each one holds';
            return `The Ultimate Beneficial Owners (hereafter "UBOs") of the Company ${verb} ${names} and ${holds} ${pcts} of its shares respectively.`;
        };

        const scopeP1 = `The objective of this valuation is to appraise the 100% of the Equity Value (hereafter the "EqV") of ${companyName} (hereafter the "Company") as at ${valuationDateLong}, which will facilitate the Company and its management to their internal and fund related decisions.`;
        const scopeP2 = `Our mandate included conducting an independent 100% Equity Value of the Company.`;
        const scopeP3 = `The Valuation Compact Report (hereafter the "Report") was drafted by placing reliance on the information and assumptions provided by the management, current market data, a set of other assumptions provided by management and the valuation model results.`;
        const scopeP4 = `Our work and report extent are limited by the engagement purpose which is the preparation of the Report.`;

        const overviewP1 = `The Company was incorporated as a ${legalForm} with registration number ${regNumber} under the laws of ${incCountry} on ${incDateFmt} and has its registered address at ${registeredAddress}.`;
        const overviewP2 = buildUboParagraph();
        const overviewP3 = `The main activity of the Company is the provision of ${companyDescription}.`;

        drawTwoCol(
            [
                { type: 'sub', text: 'Scope of the Valuation Exercise' },
                { type: 'body', text: scopeP1 },
                { type: 'body', text: scopeP2 },
                { type: 'spacer', h: 5 },
                { type: 'body', text: scopeP3 },
                { type: 'body', text: scopeP4 },
            ],
            [
                { type: 'sub', text: 'Company Overview' },
                { type: 'body', text: overviewP1 },
                { type: 'body', text: overviewP2 },
                { type: 'body', text: overviewP3 },
            ],
            y
        );

        // ========== PAGE 4: SECTION II ==========
        doc.addPage();
        sectionPages.II = doc.internal.getCurrentPageInfo().pageNumber;
        y = margin + 8;
        y = drawSectionHeading('II. Equity Valuation Results', margin, y);
        y += 4;

        // --- Compose Section II paragraph from live inputs (mirrors Excel formula) ---
        const currencyCode = getFieldVal('currency');
        const methodology = getFieldVal('valuationMethodology') || 'Equity value';
        const valuationTypeLabel =
            methodology === 'IP Value' ? 'IP valuation' :
            methodology === 'Enterprise value' ? 'Enterprise valuation' :
            'Equity valuation';

        // Pull Sensitivity 1 / Sensitivity 2 equity values from the rendered summary table.
        const extractCellText = (cell) => {
            if (!cell) return '';
            const clone = cell.cloneNode(true);
            clone.querySelectorAll('.calc-detail').forEach(d => d.remove());
            return clone.textContent.trim();
        };
        let s1EquityStr = '', s2EquityStr = '';
        const eqRow = document.querySelector('#summaryEquityTableBody tr:first-child');
        if (eqRow) {
            const cells = eqRow.querySelectorAll('td');
            if (cells.length >= 3) {
                s1EquityStr = extractCellText(cells[1]);
                s2EquityStr = extractCellText(cells[2]);
            }
        }

        // PDF uses ISO code + space (e.g. "EUR 1,234,567") not the Unicode
        // symbol, because jsPDF's default Helvetica font does not render
        // glyphs like €/£/¥/₹. Switching to a Unicode font (~200 KB) is the
        // only way to use symbols here.
        const pdfCurrPrefix = currencyCode ? `${currencyCode} ` : '';
        const sec2Paragraph = `Based on the management representation and taking into account the assumptions provided in relation to the projections, the final ${valuationTypeLabel} of the Company, as at ${valuationDateLong}, ranges between ${pdfCurrPrefix}${s1EquityStr} (Sensitivity 1) and ${pdfCurrPrefix}${s2EquityStr} (Sensitivity 2). This considers the Discounted Cash Flow approach.`;

        y = drawTwoCol(
            [
                { type: 'sub', text: 'Equity value range' },
                { type: 'body', text: sec2Paragraph },
            ],
            [
                { type: 'sub', text: 'Steps to the final Equity value range' },
                { type: 'spacer', h: 6 },
                { type: 'sub', text: 'Equity valuation results' },
            ],
            y
        );
        y += 6;

        // Range chart capture
        const rangeEl = document.getElementById('rangeGraphicContainer');
        if (rangeEl) {
            // Ensure tab-5 is active so chart is laid out for capture
            const tab5 = document.getElementById('tab-5');
            const tabContentsAll = Array.from(document.querySelectorAll('.tab-content'));
            const originallyActiveIdx = tabContentsAll.findIndex(t => t.classList.contains('active'));
            tabContentsAll.forEach(t => t.classList.remove('active'));
            if (tab5) tab5.classList.add('active');
            await new Promise(r => setTimeout(r, 150));

            try {
                const canvas = await window.html2canvas(rangeEl, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: '#ffffff',
                    logging: false
                });
                const imgData = canvas.toDataURL('image/png');
                const imgProps = doc.getImageProperties(imgData);
                const targetW = contentW;
                const imgH = targetW * imgProps.height / imgProps.width;
                doc.addImage(imgData, 'PNG', margin, y, targetW, imgH);
                y += imgH + 4;
            } catch (e) {
                console.warn('Range chart capture failed:', e);
            }

            // Restore original tab state
            tabContentsAll.forEach(t => t.classList.remove('active'));
            if (originallyActiveIdx >= 0) tabContentsAll[originallyActiveIdx].classList.add('active');
            else if (tabContentsAll[0]) tabContentsAll[0].classList.add('active');
        }

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text('* Average value of the Equity Value range.', margin, y);

        // ========== SECTION III METHODOLOGY ==========
        doc.addPage();
        sectionPages.III = doc.internal.getCurrentPageInfo().pageNumber;
        y = margin + 8;
        y = drawSectionHeading('III. Methodology and Assumptions', margin, y);
        y += 4;

        // --- Compose Section III inputs from live form values ---
        const opCountry = getFieldVal('operatingCountry');
        const industryName = getFieldVal('industry');
        const baseYear = parseInt(getFieldVal('baseYear'), 10) || (new Date().getFullYear() - 1);

        // Beta — full precision from referenceDataState if available, else input value
        let betaStr = getFieldVal('companyBeta') || '0';
        if (referenceDataState.industry && referenceDataState.industry.unlevered_beta != null) {
            betaStr = String(referenceDataState.industry.unlevered_beta);
        }

        // Growth rate (g) as % rounded to 2dp — same logic as calculatePlProjections multiplier
        let growthPct = '0.00';
        const overrideRaw = getFieldVal('revenueGrowthOverride');
        if (overrideRaw !== '') {
            growthPct = (parseFloat(overrideRaw) || 0).toFixed(2);
        } else if (referenceDataState.industry && referenceDataState.industry.exp_revenue_growth_2yr) {
            growthPct = (referenceDataState.industry.exp_revenue_growth_2yr / 2 * 100).toFixed(2);
        }

        // WACC factor table values (already in %)
        const equityWeightPct = getFieldVal('equityWeight') || '0.00';
        const debtWeightPct = getFieldVal('debtWeight') || '0.00';
        const costOfEquityPct = getFieldVal('costOfEquity') || '0.00';
        const avgInterestPct = getFieldVal('averageInterestPaid') || '0.00';
        const dcfTaxRatePct = getFieldVal('dcfTaxRate') || '0.00';
        const isDebtFree = parseFloat(debtWeightPct) === 0;

        // DLOM — live auto-computed value
        const dlomPct = getFieldVal('dlom') || '0.00';

        // Factor table column definitions
        const factorCols2 = [
            { name: 'Factor', widthPct: 0.22, align: 'left' },
            { name: 'Factor name', widthPct: 0.78, align: 'left' },
        ];
        const factorCols3 = [
            { name: 'Factor', widthPct: 0.13, align: 'left' },
            { name: 'Factor name', widthPct: 0.60, align: 'left' },
            { name: 'Factor value', widthPct: 0.27, align: 'right', headerAlign: 'right' },
        ];

        const npvFactorRows = [
            ['Ct', 'Net cash inflow during the period'],
            ['Co', 'Initial investment'],
            ['r',  'Discount rate'],
            ['t',  'Number of time periods-0.5 (mid-year adj.)'],
        ];
        const tvFactorRows = [
            ['Ct+1', 'Final projected year cash flow'],
            ['g',    'Perpetual (terminal) growth rate'],
            ['r',    'Discount rate'],
            ['t',    'Number of time periods'],
        ];
        const waccFactorRows = [
            ['We', 'Equity weight in the capital structure', `${equityWeightPct}%`],
            ['Wd', 'Debt weight in the capital structure',   `${debtWeightPct}%`],
            ['Re', 'Cost of capital (using CAPM)',           `${costOfEquityPct}%`],
            ['Rd', 'Cost of debt',                           `${avgInterestPct}%`],
            ['Tc', 'Corporate tax rate',                     `${dcfTaxRatePct}%`],
        ];

        // --- Section III, Page A: methodology, factor formulas, factor tables ---
        const sec3LeftA = [
            { type: 'body', text: 'DCF provides an estimation of the Company\'s total value EV, based on its "free cash flows (FCFF) to the firm", discounted at the weighted average cost of capital (WACC).' },
            { type: 'spacer', h: 2 },
            { type: 'sub', text: 'Equity valuation range - Steps analysis' },
            { type: 'underline', text: 'DCF valuation inputs:' },
            { type: 'spacer', h: 2 },
            { type: 'sub', text: '1. Free Cash Flow "FCF" – Projection assumptions' },
            { type: 'body', text: 'For the DCF valuation to be performed, several assumptions were made on FCF projections. The assumptions used are based on management estimations.' },
            { type: 'spacer', h: 2 },
            { type: 'body', text: `The Company's revenues and expenses are expected to be affected by the ${opCountry}'s GDP. In this respect the Company's revenues and expenses were estimated to increase by ${growthPct}% compared to its revenues and expenses as at the year end ${baseYear}.` },
            { type: 'spacer', h: 2 },
            { type: 'sub', text: '2. Discount Factors' },
            { type: 'body', text: 'The formula for calculating Capital Asset Pricing Model (CAPM) is as follows:' },
            { type: 'formula', text: 'Re = Rf + Beta * ERP + CRP + SSP' },
            { type: 'spacer', h: 2 },
            { type: 'body', text: 'A secondary study "Valuation Handbook" by Duff & Phelps of 2017 was used for the average discount of small stock companies.' },
            { type: 'spacer', h: 2 },
            { type: 'body', text: 'The formula for calculating Weighted Average Cost of Capital is as follows:' },
            { type: 'formula', text: 'WACC = (We * Re) + (Wd * Rd * (1 - Tc))' },
            { type: 'spacer', h: 2 },
            { type: 'factable', columns: factorCols3, rows: waccFactorRows },
            ...(isDebtFree ? [
                { type: 'spacer', h: 2 },
                { type: 'body', text: 'It is noted here that since the Company is debt free, effectively the WACC is equal to the Cost of Capital as calculated by the CAPM model.' },
            ] : []),
            { type: 'spacer', h: 2 },
            { type: 'body', text: 'The formula for calculating Net Present Value (NPV) is as follows:' },
            { type: 'formula', text: 'NPV = Sum [ Ct / (1 + r)^t ] - Co' },
            { type: 'spacer', h: 4 },
            { type: 'footnote', text: '1. https://www.duffandphelps.com/insights/publications/cost-of-capital/duff-and-phelps-2017-valuation-handbook-guide-to-cost-of-capital' },
        ];

        const sec3RightA = [
            { type: 'spacer', h: 3 },
            { type: 'body', text: `The Risk Free rate (Rf) of ${opCountry} was used. The Risk Free Rate (Rf) calculated as the interest of a 10 year bond of ${opCountry} ( source ECB).` },
            { type: 'spacer', h: 2 },
            { type: 'body', text: `The Equity Risk Premium of ${opCountry} was used. The Equity Risk Premium has been taken from the study "Country Default spreads and Risk Premiums" edition ${DAMODARAN_EDITION} by Damodaran.` },
            { type: 'spacer', h: 2 },
            { type: 'body', text: `The long term Beta of ${betaStr} has been used. The Beta for the ${industryName} has been taken from the study "Beta, Unlevered beta and other risk measures" (edition:${DAMODARAN_EDITION}) of Damodaran.` },
            { type: 'spacer', h: 2 },
            { type: 'body', text: `The Country Risk Premium the study "Country Default Spreads and Risk Premiums" (edition: ${DAMODARAN_EDITION}) by Damodaran was used. The Country Risk Premium of ${opCountry} has been utilised.` },
            { type: 'spacer', h: 4 },
            { type: 'factable', columns: factorCols2, rows: npvFactorRows },
            { type: 'spacer', h: 3 },
            { type: 'body', text: 'The formula for calculating the Terminal Present Value is as follows:' },
            { type: 'formula', text: 'TV = [ Ct+1 * (1 + g) ] / (r - g)' },
            { type: 'spacer', h: 2 },
            { type: 'factable', columns: factorCols2, rows: tvFactorRows },
            { type: 'spacer', h: 2 },
            { type: 'body', text: `The terminal growth rate (g) was assumed to be at ${growthPct}%. In order to arrive at the long term growth rate the projected GDP YoY% growth of the year ${OECD_REFERENCE_YEAR} has been taken from Organisation for Economic Co-operation and Development ("OECD") .` },
            { type: 'spacer', h: 4 },
            { type: 'footnote', text: '2. http://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html' },
        ];

        drawTwoCol(sec3LeftA, sec3RightA, y);

        // --- Section III, Page B: Valuation Discounts, Other assumptions, Sensitivity intro ---
        doc.addPage();
        y = margin + 8;

        const sec3LeftB = [
            { type: 'sub', text: '3. Valuation Discounts' },
            { type: 'body', text: `Discount For Lack Of Marketability (DLOM) has been set at ${dlomPct}% and has been taken from a secondary study for historical DLOMs applied for companies analyzed by the revenue size.` },
            { type: 'spacer', h: 2 },
            { type: 'body', text: 'Taking into consideration that the Company under consideration as it stands is difficult to be marketed and sold due to its nature a DLOM is applied. The information has been taken from "Discount for lack of marketability"³ by Internal Revenue Service ("IRS") valuation professionals (issued September 2009).' },
            { type: 'spacer', h: 3 },
            { type: 'sub', text: '4. Other important assumptions' },
            { type: 'body', text: `Projected GDP YoY% growth rates of ${opCountry} have been taken from the Organisation for Economic Co-operation and Development ("OECD").` },
            { type: 'spacer', h: 3 },
            { type: 'sub', text: 'Sensitivity Analysis – DCF method' },
            { type: 'body', text: 'Sensitivity analysis has been performed on two categories (Growth rate sensitivity & Discount rate sensitivity) of factors on the DCF calculation, taking into consideration the industry of the revenue generated by the Company where there is a degree of volatility, uncertainty it is considered more appropriate to sensitized DCF calculation and calculate the valuation range.' },
            { type: 'spacer', h: 4 },
            { type: 'footnote', text: '3. https://www.irs.gov/businesses/valuation-of-assets' },
        ];

        const sec3RightB = [
            { type: 'spacer', h: 3 },
            { type: 'body', text: 'The Final Equity Value range is constructed as the average of the sensitized Equity Values under the Growth Rate Sensitivity Analysis and the sensitized Equity Values under the Discount Rate Sensitivity Analysis.' },
        ];

        y = drawTwoCol(sec3LeftB, sec3RightB, y);

        // ========== SENSITIVITY TABLES ==========
        // Make sure sensitivity DOM is rendered (run a recalc in case it hasn't been)
        if (typeof calculatePlProjections === 'function') {
            const tab4 = document.getElementById('tab-4');
            const tabContentsAll = Array.from(document.querySelectorAll('.tab-content'));
            const originallyActiveIdx = tabContentsAll.findIndex(t => t.classList.contains('active'));
            tabContentsAll.forEach(t => t.classList.remove('active'));
            if (tab4) tab4.classList.add('active');
            calculatePlProjections();
            await new Promise(r => setTimeout(r, 50));
            tabContentsAll.forEach(t => t.classList.remove('active'));
            if (originallyActiveIdx >= 0) tabContentsAll[originallyActiveIdx].classList.add('active');
            else if (tabContentsAll[0]) tabContentsAll[0].classList.add('active');
        }

        const growthRows = extractTableRows('sensGrowthBody');
        const discountRows = extractTableRows('sensDiscountBody');

        // Reserve space for two tables + footnotes (~110mm total). New page if not enough.
        if (y > pageH - 130) { doc.addPage(); y = margin + 8; }
        y += 10;

        // -- Sensitivity Analysis - Growth Rate --
        y = drawSubheading('Sensitivity Analysis - Growth Rate', margin, y, 11);
        y += 3;
        const sensColWidths = [40, 40, 40, 40]; // total 160 mm
        y = drawTable({
            x: margin,
            y,
            colWidths: sensColWidths,
            headers: ['Growth Rate', '90%', '100%', '110%'],
            rows: growthRows,
            baseCaseIdx: [1, 2],
            headerLabel: 'Free Cash Flow',
            rowH: 7
        });
        y += 2;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...RED);
        doc.text('*Base Case result (DCF)', margin, y);
        y += 10;

        if (y > pageH - 70) { doc.addPage(); y = margin + 8; }

        // -- Sensitivity Analysis - Discount Rate --
        y = drawSubheading('Sensitivity Analysis - Discount Rate', margin, y, 11);
        y += 3;
        y = drawTable({
            x: margin,
            y,
            colWidths: sensColWidths,
            headers: ['Discount Rate', '90%', '100%', '110%'],
            rows: discountRows,
            baseCaseIdx: [1, 2],
            headerLabel: 'Free Cash Flow',
            rowH: 7
        });
        y += 2;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...RED);
        doc.text('*Base Case result (DCF)', margin, y);

        // ========== DISCLAIMER ==========
        doc.addPage();
        sectionPages.Disclaimer = doc.internal.getCurrentPageInfo().pageNumber;
        y = margin + 8;
        y = drawSectionHeading('IV. Disclaimer', margin, y);
        y += 6;

        const disclaimerLeft1 = 'The material in this report has been prepared by K. Treppides & Co Ltd for information purposes only and it is addressed to the specific recipients as per the mandate of the agreed upon procedures. It does not constitute a legal opinion and no liability will be accepted by any third party in respect of any actions, decisions or any losses arising directly or indirectly as a result of relying on information contained within this report. The views and suggestions expressed herein do not take into consideration the particular personal or company circumstances, objectives or needs of the recipients. In each case, the recipients should conduct their own investigation and analysis of the information contained in this document before taking any actions or decisions. Information in this report is a result of research performed on the information disclosed to us by the company, material from publicly available sources, communication with regulators and relevant legislation.';
        const disclaimerLeft2 = 'The information contained in the present document has been extracted, in good faith, from sources believed to be trustworthy and specifically from the Issuer and the management of the Issuer assessed. Despite this, K. Treppides & Co Ltd does not guarantee the accuracy or completeness of this information and shall not be liable for decisions taken based on this information.';
        const disclaimerRight = 'Each view expressed in this document reflects a certain judgment at the date of issue and may be modified at any time without notice. K. Treppides & Co Ltd cannot be held accountable for the accuracy, wrongful interpretation or validity of this information and recipients of this material should be aware that rules and regulations are subject to constant changes. K. Treppides & Co Ltd and any of its employees shall not be held liable for any loss suffered by the recipient in the course of relying on this information. The report and the information included herein, may not be distributed to, quoted or referred, in whole or in part by any third party without K. Treppides & Co Ltd prior written consent.';

        drawTwoCol(
            [
                { type: 'body', text: disclaimerLeft1, style: 'italic' },
                { type: 'body', text: disclaimerLeft2, style: 'italic' },
            ],
            [
                { type: 'body', text: disclaimerRight, style: 'italic' },
            ],
            y
        );

        // ========== FILL TOC ON PAGE 2 ==========
        doc.setPage(tocPageNum);
        y = margin + 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(...TEXT);
        doc.text('Table of Contents', margin, y);
        doc.setDrawColor(...RULE);
        doc.line(margin, y + 2, margin + contentW, y + 2);
        y += 12;

        const tocItems = [
            { label: 'I. Scope of the Valuation Exercise and Company Overview', page: sectionPages.I, indent: 0, bold: true },
            { label: 'II. Equity Valuation Results', page: sectionPages.II, indent: 0, bold: true },
            { label: 'Equity value range', page: sectionPages.II, indent: 6, bold: false, italic: true },
            { label: 'III. Methodology and Assumptions', page: sectionPages.III, indent: 0, bold: true },
            { label: 'EV valuation range - Steps analysis', page: sectionPages.III, indent: 6, bold: false, italic: true },
            { label: 'a) Discounted Cash Flow (DCF)', page: sectionPages.III, indent: 6, bold: false, italic: false },
            { label: 'Sensitivity Analysis – DCF method', page: sectionPages.III, indent: 6, bold: false, italic: false },
            { label: 'IV. Disclaimer', page: sectionPages.Disclaimer, indent: 0, bold: true },
        ];

        doc.setFontSize(10);
        tocItems.forEach(item => {
            doc.setFont('helvetica', item.bold ? 'bold' : (item.italic ? 'italic' : 'normal'));
            doc.setTextColor(...TEXT);
            doc.text(item.label, margin + item.indent, y);
            doc.text(String(item.page), pageW - margin, y, { align: 'right' });
            y += item.bold ? 7 : 6;
        });

        // ========== PAGE NUMBERS ==========
        const pageCount = doc.internal.getNumberOfPages();
        for (let p = 2; p <= pageCount; p++) {
            doc.setPage(p);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text(`${p}`, pageW - margin, pageH - 8, { align: 'right' });
        }

        const safeName = companyName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Valuation_Report';
        doc.save(`${safeName}_Valuation_Report.pdf`);
    };

    // Prevent accidental form submission (e.g. Enter key) since the report is generated via Export PDF.
    const valuationForm = document.getElementById('valuationForm');
    if (valuationForm) {
        valuationForm.addEventListener('submit', (e) => e.preventDefault());
    }

}
