// ============================================================
// main.js — single entry point.
// Imports and initialises all components in render order.
// ============================================================

import CONFIG            from "./config.js?v=1";
import { initAuth }      from "./js/auth.js";
import { initRouter }    from "./js/router.js?v=2";
import initSidebar       from "./components/shell/sidebar.js?v=3";
import initSimulator     from "./components/shell/simulator.js";
import initTopbar        from "./components/shell/topbar.js";
import initAnnouncements from "./components/widgets/announcements.js";
import initKnowledgeBase from "./components/pages/knowledgebase.js";
import initNewsletter    from "./components/widgets/newsletter.js";
import initQuicklinks    from "./components/widgets/quicklinks.js";
import initReader        from "./components/pages/reader.js";
import initFees          from "./components/pages/fees.js";
import initAdmin         from "./components/shell/admin.js";
import initSupport       from "./components/shell/support.js";
import initStaff         from "./components/pages/staff.js?v=live1";
import initAml           from "./components/pages/aml.js";
import initProjects      from "./components/pages/projects.js";
import initValuation     from "./components/pages/valuation.js";
import initCompanies      from "./components/pages/companies.js?v=2";
import initCrm            from "./components/pages/crm.js";
import initCrmList        from "./components/pages/crm-list.js?v=2";
import initAccounts       from "./components/pages/accounts.js?v=3";
import initPerformance    from "./components/pages/performance.js";
import initBudgetKpi      from "./components/pages/budget-kpi.js";
import initTbratio        from "./components/pages/tbratio.js";
import initForms          from "./components/pages/forms.js";
import initFinancials     from "./components/pages/financials.js";
import initTeamCalendar   from "./components/pages/team-calendar.js";
import initInvoices       from "./components/pages/invoices.js?v=4";

async function boot() {
  // Auth gate — redirects to Microsoft login if no active session.
  // Returns null while the redirect is in flight; boot halts safely.
  const user = await initAuth();
  if (!user) return;

  // Structural components (no async data needed — run in parallel)
  await Promise.all([
    initSidebar(CONFIG),
    initTopbar(CONFIG, user),
  ]);

  // Test-env only (no-op unless /api/me returns simulator:true): the "View as" switcher.
  await initSimulator();

  // Initialise reader before content sections so openBook/openPage are
  // available on window.__hub_reader when knowledgebase cards render
  await initReader(CONFIG);

  // Admin panel + support modal must be ready before content sections
  // so the IT Support widget in quicklinks can call window.__hub_support
  initAdmin(CONFIG);
  initSupport(CONFIG);

  // AML landing must be ready before sidebar clicks fire — sidebar.js
  // calls window.__hub_aml.show(), which aml.js exposes during init.
  await initAml(CONFIG);

  // Knowledge Base must be ready before sidebar clicks fire — sidebar.js
  // calls window.__hub_kb.show(), which knowledgebase.js exposes during init.
  await initKnowledgeBase(CONFIG);

  // Projects must be ready before sidebar clicks fire — sidebar.js
  // calls window.__hub_projects.show(), which projects.js exposes during init.
  await initProjects(CONFIG);

  // Valuation Tool must be ready before sidebar clicks fire — sidebar.js
  // calls window.__hub_valuation.show(), which valuation.js exposes during init.
  await initValuation(CONFIG);

  // Company Task Finder must be ready before sidebar clicks fire — sidebar.js
  // calls window.__hub_companies.show(), which companies.js exposes during init.
  await initCompanies(CONFIG);

  // CRM landing — the list-dashboard picker (Deals / Leads / Accounts). Must be
  // ready before projects.js (Tools grid) fires window.__hub_crm.show().
  await initCrm(CONFIG);

  // CRM list dashboard — generic view for Leads / Accounts, launched from the
  // CRM landing via window.__hub_crmlist.show(key).
  await initCrmList(CONFIG);

  // Accounts directory — read-only Companies / Individuals view for ALL users,
  // launched from the Tools grid via window.__hub_accounts.show(key). Separate
  // from the CRM dashboards (public read-only API, no editing, no fees).
  await initAccounts(CONFIG);

  // Performance Report — admin-only employee chargeability viewer.
  await initPerformance(CONFIG);

  // Budget KPI — admin-only manager budget vs invoiced viewer.
  await initBudgetKpi(CONFIG);

  // TB Ratio Tool must be ready before sidebar clicks fire — sidebar.js
  // calls window.__hub_tbratio.show(), which tbratio.js exposes during init.
  await initTbratio(CONFIG);

  // Forms tool must be ready before the Tools landing renders — projects.js
  // calls window.__hub_forms.show(), which forms.js exposes during init.
  await initForms(CONFIG);

  // Financials — board/admin reporting (revenue, budget, recoverability, debtors).
  // sidebar.js calls window.__hub_financials.show() when the gated nav item is clicked.
  await initFinancials(CONFIG);

  // Team Calendar — leave, meetings & deadlines (tool, launched from Tools grid).
  await initTeamCalendar(CONFIG);

  // Invoices — SUPER-only per-invoice paid/unpaid tracking.
  await initInvoices(CONFIG);

  // Content sections — initialise in visual page order.
  // Each runs independently; a failure in one does not block others.
  await Promise.allSettled([
    initAnnouncements(CONFIG),
    initStaff(CONFIG),
    initNewsletter(CONFIG),
    initQuicklinks(CONFIG),
    initFees(CONFIG),
  ]);

  // SPA router — reads current URL and navigates to the right section.
  // Must run AFTER all components are initialised so window.__hub_* APIs exist.
  initRouter();
}

document.addEventListener("DOMContentLoaded", boot);
