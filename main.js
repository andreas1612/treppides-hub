// ============================================================
// main.js — single entry point.
// Imports and initialises all components in render order.
// ============================================================

import CONFIG            from "./config.js";
import { initAuth }      from "./js/auth.js";
import initSidebar       from "./components/shell/sidebar.js";
import initTopbar        from "./components/shell/topbar.js";
import initAnnouncements from "./components/widgets/announcements.js";
import initKnowledgeBase from "./components/pages/knowledgebase.js";
import initPolicies      from "./components/widgets/policies.js";
import initTraining      from "./components/widgets/training.js";
import initQuicklinks    from "./components/widgets/quicklinks.js";
import initReader        from "./components/pages/reader.js";
import initFees          from "./components/pages/fees.js";
import initAdmin         from "./components/shell/admin.js";
import initSupport       from "./components/shell/support.js";
import initStaff         from "./components/pages/staff.js";
import initAml           from "./components/pages/aml.js";
import initProjects      from "./components/pages/projects.js";
import initValuation     from "./components/pages/valuation.js";
import initCompanies      from "./components/pages/companies.js";
import initPerformance    from "./components/pages/performance.js";
import initBudgetKpi      from "./components/pages/budget-kpi.js";
import initTbratio        from "./components/pages/tbratio.js";
import initForms          from "./components/pages/forms.js";
import initFinancials     from "./components/pages/financials.js";

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

  // Content sections — initialise in visual page order.
  // Each runs independently; a failure in one does not block others.
  await Promise.allSettled([
    initAnnouncements(CONFIG),
    initStaff(CONFIG),
    initPolicies(CONFIG),
    initTraining(CONFIG),
    initQuicklinks(CONFIG),
    initFees(CONFIG),
  ]);
}

document.addEventListener("DOMContentLoaded", boot);
