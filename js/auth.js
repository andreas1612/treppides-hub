// ============================================================
// js/auth.js — Hub authentication via Task Manager session.
//
// No new Azure AD app registration needed.
// Reuses the TM's existing Spring Boot OAuth2 login:
//   1. Hub calls TM /api/me — if OK, user is already logged in.
//   2. If 401 — redirect to TM login page (Azure AD SSO, no password).
//   3. TM login page stores our URL, after Azure AD login TM
//      redirects back here automatically.
// ============================================================

// In production both are on hub.treppides.com so TM_BASE = '/projects'.
// Locally TM runs on 8080, hub on a different port.
const TM_BASE = window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : "/projects";

let _user = null;

/**
 * Call once at the top of boot().
 * Returns { email, name } if authenticated, or null while redirect is in flight.
 */
export async function initAuth() {
  try {
    const res = await fetch(`${TM_BASE}/api/me`, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });

    if (res.ok) {
      _user = await res.json();   // { email, name }
      return _user;
    }

    // Not authenticated — send to TM login, passing our URL to return to.
    const returnTo = encodeURIComponent(window.location.href);
    window.location.href = `${TM_BASE}/login.html?returnTo=${returnTo}`;
    return null;

  } catch {
    // TM unreachable (local dev with TM stopped) — fail open so hub still loads.
    console.warn("[hub-auth] Task Manager unreachable — running unauthenticated.");
    return { email: "", name: "" };
  }
}

/** Returns the current signed-in user, or null. */
export function getCurrentUser() {
  return _user;
}

/** Send the user to TM logout (clears the Spring session). */
export function signOut() {
  window.location.href = `${TM_BASE}/logout`;
}
