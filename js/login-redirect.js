// Go straight to Azure OAuth — no intermediate TM login page.
// hub_pre_login_url is read by auth.js after login to restore the original page.
const oauthBase = window.location.hostname === "localhost"
    ? "http://localhost:8080"
    : "";
document.getElementById("signInBtn").href =
    `${oauthBase}/oauth2/authorization/azure`;
