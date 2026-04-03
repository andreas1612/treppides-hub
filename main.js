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

async function boot() {
  // Structural components (no async data needed — run in parallel)
  await Promise.all([
    initSidebar(CONFIG),
    initTopbar(CONFIG),
  ]);

  // Initialise reader before content sections so openBook/openPage are
  // available on window.__hub_reader when knowledgebase cards render
  await initReader(CONFIG);

  // Content sections — initialise in visual page order.
  // Each runs independently; a failure in one does not block others.
  await Promise.allSettled([
    initAnnouncements(CONFIG),
    initKnowledgeBase(CONFIG),
    initPolicies(CONFIG),
    initTraining(CONFIG),
    initQuicklinks(CONFIG),
  ]);
}

document.addEventListener("DOMContentLoaded", boot);
