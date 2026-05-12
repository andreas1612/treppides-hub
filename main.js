// ============================================================
// main.js — single entry point.
// Imports and initialises all components in render order.
// ============================================================

import CONFIG            from "./config.js";
import initSidebar       from "./components/sidebar.js";
import initTopbar        from "./components/topbar.js";
import initAnnouncements from "./components/announcements.js";
import initKnowledgeBase from "./components/knowledgebase.js";
import initPolicies      from "./components/policies.js";
import initTraining      from "./components/training.js";
import initQuicklinks    from "./components/quicklinks.js";
import initReader        from "./components/reader.js";
import initFees          from "./components/fees.js";
import initAdmin         from "./components/admin.js";
import initSupport       from "./components/support.js";
import initStaff         from "./components/staff.js";
import initAml           from "./components/aml.js";
import initProjects      from "./components/projects.js";

async function boot() {
  // Structural components (no async data needed — run in parallel)
  await Promise.all([
    initSidebar(CONFIG),
    initTopbar(CONFIG),
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
