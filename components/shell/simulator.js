// ============================================================
// components/shell/simulator.js — TEST-ENV "View as" switcher.
//
// Renders ONLY when /api/me returns simulator:true (the Docker test instance with
// app.simulator.enabled=true). Lets a tester become any employee; the choice is stored
// server-side in the session (POST /api/sim/login) and the page reloads so the whole hub
// re-renders through that person's real tier + scope. Absent in production.
// ============================================================

import { getCurrentUser, TM_BASE } from "../../js/auth.js";

const STYLE = `
  #sim-panel { position: fixed; bottom: 14px; right: 14px; z-index: 4000;
    background: #1f2937; color: #fff; border-radius: 10px; padding: 8px 12px;
    box-shadow: 0 6px 24px rgba(0,0,0,.3); font-size: 12px; display: flex; align-items: center; gap: 8px; }
  #sim-panel .sim-label { font-weight: 700; letter-spacing: .02em; }
  #sim-panel .sim-who { opacity: .8; }
  #sim-panel select { background: #111827; color: #fff; border: 1px solid #374151;
    border-radius: 6px; padding: 4px 6px; font-size: 12px; max-width: 220px; }
  #sim-panel button { background: #ef4444; color: #fff; border: none; border-radius: 6px;
    padding: 4px 8px; cursor: pointer; font-size: 12px; }
`;

export default async function initSimulator() {
  const user = getCurrentUser();
  if (!user || !user.simulator) return; // only in the test instance

  let emps = [];
  try {
    emps = await fetch(`${TM_BASE}/api/sim/employees`, {
      credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" },
    }).then(r => (r.ok ? r.json() : []));
  } catch { emps = []; }

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "sim-panel";
  panel.innerHTML = `
    <span class="sim-label">🧪 View as</span>
    <span class="sim-who">${escapeAttr(user.name || user.email)} · ${user.tier}</span>
    <select id="sim-select" aria-label="View as employee">
      <option value="">— pick employee —</option>
      ${emps.map(e => `<option value="${escapeAttr(e.code)}">${escapeAttr(e.name)} (${escapeAttr(e.code)})</option>`).join("")}
    </select>
    <button id="sim-reset" title="Exit simulation">Reset</button>`;
  document.body.appendChild(panel);

  document.getElementById("sim-select").addEventListener("change", async (e) => {
    const code = e.target.value;
    if (!code) return;
    await fetch(`${TM_BASE}/api/sim/login?code=${encodeURIComponent(code)}`, { method: "POST", credentials: "include" });
    location.reload();
  });
  document.getElementById("sim-reset").addEventListener("click", async () => {
    await fetch(`${TM_BASE}/api/sim/logout`, { method: "POST", credentials: "include" });
    location.reload();
  });
}

function escapeAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
