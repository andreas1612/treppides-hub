// ============================================================
// js/auth.js — Hub authentication via Task Manager session.
//
// Reuses TM's Spring Boot OAuth2 session via /projects proxy:
//   1. Hub calls /projects/api/me — if OK, user is already logged in.
//   2. If 401 — redirect to hub login page → Azure AD SSO.
//   3. After Azure login, Spring redirects to /dashboard.html which
//      loads the hub SPA — auth.js restores the original URL.
// ============================================================

const TM_BASE = window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : "https://tasks.treppides.com";

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

      // After login, Spring redirects to /dashboard.html — restore the original page.
      const savedUrl = sessionStorage.getItem("hub_pre_login_url");
      if (savedUrl) {
        sessionStorage.removeItem("hub_pre_login_url");
        if (savedUrl !== window.location.href) {
          window.location.replace(savedUrl);
          return null;
        }
      }
      return _user;
    }

    // Not authenticated — go to the hub's own login page.
    sessionStorage.setItem("hub_pre_login_url", window.location.href);
    window.location.href = "/login.html";
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
