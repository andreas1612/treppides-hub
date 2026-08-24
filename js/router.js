// ============================================================
// js/router.js
// Lightweight SPA router — maps URL paths to hub sections.
// Uses History API (pushState / popstate).
// ============================================================

// All CSS-active classes that toggle section visibility on .main
const ACTIVE_CLASSES = [
  "kb-active", "staff-active", "projects-active", "aml-active",
  "fees-active", "valuation-active", "companies-active", "crm-active",
  "crmlist-active", "tbratio-active", "performance-active",
  "budgetkpi-active", "financials-active", "forms-active",
  "teamcalendar-active", "invoices-active",
];

// Route table: path → { section, cssClass, showFn, hideFn }
// showFn/hideFn reference window.__hub_* — resolved at call time.
const ROUTES = [
  { path: "/",             section: "home" },
  { path: "/kb",           section: "kb",           cssClass: "kb-active",           hub: "kb" },
  { path: "/staff",        section: "staff",        cssClass: "staff-active",        hub: "staff" },
  { path: "/tools",        section: "projects",     cssClass: "projects-active",     hub: "projects" },
  { path: "/crm",          section: "crm",          cssClass: "crm-active",          hub: "crm" },
  { path: "/crm/deals",    section: "companies",    cssClass: "companies-active",    hub: "companies" },
  { path: "/crm/leads",                section: "crmlist", cssClass: "crmlist-active", hub: "crmlist", showArg: "leads" },
  { path: "/crm/accounts-companies",  section: "crmlist", cssClass: "crmlist-active", hub: "crmlist", showArg: "accounts_companies" },
  { path: "/crm/accounts-individuals", section: "crmlist", cssClass: "crmlist-active", hub: "crmlist", showArg: "accounts_individuals" },
  { path: "/crm/contacts",            section: "crmlist", cssClass: "crmlist-active", hub: "crmlist", showArg: "contacts" },
  { path: "/crm/aml",      section: "aml",          cssClass: "aml-active",          hub: "aml" },
  { path: "/crm/forms",    section: "forms",        cssClass: "forms-active",        hub: "forms" },
  { path: "/tools/valuation",  section: "valuation",    cssClass: "valuation-active",    hub: "valuation" },
  { path: "/tools/tbratio",    section: "tbratio",      cssClass: "tbratio-active",      hub: "tbratio" },
  { path: "/tools/fees",       section: "fees",         cssClass: "fees-active",         hub: "fees" },
  { path: "/tools/calendar",   section: "teamcalendar", cssClass: "teamcalendar-active", hub: "teamcalendar" },
  { path: "/performance",      section: "performance",  cssClass: "performance-active",  hub: "performance" },
  { path: "/budget-kpi",       section: "budgetkpi",    cssClass: "budgetkpi-active",    hub: "budgetkpi" },
  { path: "/financials",       section: "financials",   cssClass: "financials-active",   hub: "financials" },
  { path: "/invoices",         section: "invoices",     cssClass: "invoices-active",     hub: "invoices" },
];

function findRoute(path) {
  return ROUTES.find(r => r.path === path) || ROUTES[0];
}

/** Hide every section, then show the target. */
function activateRoute(route) {
  const main = document.querySelector(".main");
  if (!main) return;

  // Remove all active classes
  main.classList.remove(...ACTIVE_CLASSES);

  if (route.section === "home") {
    // Home: clear reader overlay too
    if (window.__hub_reader) window.__hub_reader.goHome();
  } else {
    // Show target section via its window.__hub_* API
    const hubObj = window[`__hub_${route.hub}`];
    if (hubObj?.show) {
      hubObj.show(route.showArg);
    } else if (route.cssClass) {
      // Fallback: toggle class directly
      main.classList.add(route.cssClass);
    }
  }

  // Dispatch navchange for sidebar active state
  document.dispatchEvent(new CustomEvent("hub:navchange", { detail: { section: route.section } }));

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * Navigate to a path. Updates URL and activates the section.
 * @param {string} path - e.g. "/crm", "/tools/valuation"
 * @param {object} [opts] - { replace: true } to use replaceState
 */
export function navigate(path, opts = {}) {
  const route = findRoute(path);

  if (opts.replace) {
    history.replaceState({ path }, "", path);
  } else {
    history.pushState({ path }, "", path);
  }

  activateRoute(route);
}

/**
 * Get the route path for a section name (reverse lookup).
 * @param {string} section - e.g. "crm", "kb", "performance"
 * @param {string} [subKey] - e.g. "leads" for crmlist
 * @returns {string} path
 */
export function pathFor(section, subKey) {
  if (section === "crmlist" && subKey) {
    const r = ROUTES.find(r => r.section === "crmlist" && r.showArg === subKey);
    if (r) return r.path;
  }
  const r = ROUTES.find(r => r.section === section || r.hub === section);
  return r ? r.path : "/";
}

// Expose globally so any component can call window.__hub_router.navigate()
// without needing an ES module import.
window.__hub_router = { navigate, pathFor };

/** Initialise: handle popstate and navigate to current URL. */
export function initRouter() {
  // Back/forward button
  window.addEventListener("popstate", () => {
    const path = window.location.pathname;
    const route = findRoute(path);
    activateRoute(route);
  });

  // Navigate to whatever URL the page was loaded with
  const path = window.location.pathname;
  if (path !== "/") {
    const route = findRoute(path);
    activateRoute(route);
    // Replace state so popstate has data
    history.replaceState({ path }, "", path);
  }

  // Remove the pre-render guard (see inline <script> in index.html)
  document.documentElement.classList.remove("route-loading");
}
