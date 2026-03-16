const adminLoginForm = document.getElementById("adminLoginForm");
const adminStatus = document.getElementById("adminStatus");

function status(msg, type = "") {
  if (!adminStatus) return;
  adminStatus.textContent = msg;
  adminStatus.className = `status ${type}`.trim();
}

if (sessionStorage.getItem("mindforge_admin_key")) {
  window.location.replace("/controller-dashboard.html");
}

adminLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = new FormData(adminLoginForm).get("key");
  status("Authenticating controller key...");

  try {
    const response = await fetch("/api/admin-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "auth", key })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Auth failed");
    }

    sessionStorage.setItem("mindforge_admin_key", key);
    status("Controller access granted. Opening dashboard...", "ok");
    window.location.replace("/controller-dashboard.html");
  } catch (error) {
    status(error.message || "Invalid key.", "err");
  }
});
