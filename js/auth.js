// ============================================================
// js/auth.js — Hub authentication via Task Manager session.
//
// Reuses TM's Spring Boot OAuth2 session via /projects proxy:
//   1. Hub calls /projects/api/me — if OK, user is already logged in.
//   2. If 401 — redirect to hub login page → Azure AD SSO.
//   3. After Azure login, Spring redirects to /dashboard.html which
//      loads the hub SPA — auth.js restores the original URL.
//
// Admin gate: only users with isAdmin=true can access the hub.
// Non-admins see a "not eligible" message.
// ============================================================

const TM_BASE = window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : "/projects";

let _user = null;

/**
 * Call once at the top of boot().
 * Returns user object if authenticated admin, or null while redirect is in flight.
 * Blocks non-admins with a "not eligible" message.
 */
export async function initAuth() {
  try {
    const res = await fetch(`${TM_BASE}/api/me`, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });

    if (res.ok) {
      _user = await res.json();

      // Admin gate — block non-admins
      if (!_user.isAdmin) {
        document.body.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa">
            <div style="text-align:center;max-width:440px;padding:2rem">
              <div style="font-size:48px;margin-bottom:16px">🔒</div>
              <h2 style="margin:0 0 12px;font-size:22px;color:#1a1a2e">Access Restricted</h2>
              <p style="margin:0 0 24px;color:#666;line-height:1.6">
                You are not eligible to access the Hub yet.<br>
                Contact IT if you believe this is an error.
              </p>
              <p style="margin:0;color:#999;font-size:13px">Signed in as ${_user.email || ""}</p>
            </div>
          </div>`;
        return null;
      }

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
    console.error("[hub-auth] Task Manager unreachable.");
    document.body.innerHTML = '<div style="padding:2rem;text-align:center"><h2>Service unavailable</h2><p>Authentication service is unreachable. Please try again later.</p></div>';
    throw new Error("Auth service unreachable");
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

/** TM base URL for API calls from other components. */
export { TM_BASE };
