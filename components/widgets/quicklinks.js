// ============================================================
// components/quicklinks.js
// Renders the Quick Access widget row at the bottom of the page.
// Mounts into: #section-quicklinks
// ============================================================

// ---- Component ------------------------------------------------

/**
 * Initialises the Quick Links widget row.
 * @param {object} config - Hub config object from config.js.
 */
export default async function init(config) {
  const section = document.getElementById("section-quicklinks");
  if (!section) return;

  section.innerHTML = `
    <div class="widget-row">

      <div class="widget-card" id="ql-kb" role="button" tabindex="0" style="cursor:pointer;">
        <div class="widget-icon blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
        </div>
        <div class="widget-info">
          <h4>Knowledge Base</h4>
          <p>Policies, procedures &amp; docs</p>
        </div>
      </div>

      <div class="widget-card" id="ql-proj" role="button" tabindex="0" style="cursor:pointer;">
        <div class="widget-icon green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3"  y="3"  width="7" height="7"/>
            <rect x="14" y="3"  width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3"  y="14" width="7" height="7"/>
          </svg>
        </div>
        <div class="widget-info">
          <h4>Tools</h4>
          <p>Dashboards, reports &amp; utilities</p>
        </div>
      </div>

      <div class="widget-card" id="ql-support" role="button" tabindex="0"
           style="cursor:pointer;">
        <div class="widget-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8"  x2="12"   y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div class="widget-info">
          <h4>Tech Support</h4>
          <p>Raise a request or query</p>
        </div>
      </div>

    </div>`;

  // KB widget: open Knowledge Base full-page view
  const qlKb = document.getElementById("ql-kb");
  if (qlKb) {
    const openKb = () => window.__hub_router?.navigate("/kb");
    qlKb.addEventListener("click",   openKb);
    qlKb.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openKb(); });
  }

  // Projects widget: open Projects full-page view (under development)
  const qlProj = document.getElementById("ql-proj");
  if (qlProj) {
    const openProj = () => window.__hub_router?.navigate("/tools");
    qlProj.addEventListener("click",   openProj);
    qlProj.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openProj(); });
  }

  // IT Support widget — opens support ticket modal
  const qlSupport = document.getElementById("ql-support");
  if (qlSupport) {
    const openSupport = () => window.__hub_support?.open();
    qlSupport.addEventListener("click",   openSupport);
    qlSupport.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openSupport(); });
  }
}
