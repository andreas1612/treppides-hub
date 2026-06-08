// ============================================================
// js/auth.js — Hub authentication via Task Manager session.
//
// No Azure AD registration needed for the hub.
// Reuses TM's Spring Boot OAuth2 session:
//   1. Hub calls TM /api/me — if OK, user is already logged in.
//   2. If 401 — store returnTo in a cookie, redirect straight to
//      TM's OAuth2 endpoint. On an org machine Azure SSO is silent
//      (no login page, no button click).
//   3. After Azure AD login, TM redirects to dashboard.html which
//      reads the cookie and bounces back to the hub.
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

    // Not authenticated — store return URL in a cookie (readable by dashboard.html
    // on the same domain) then go straight to the OAuth2 endpoint.
    // On an org machine Azure SSO is fully silent — no login page shown.
    document.cookie = `tm_return_to=${encodeURIComponent(window.location.href)};path=/;SameSite=Lax`;
    window.location.href = `${TM_BASE}/oauth2/authorization/azure`;
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
