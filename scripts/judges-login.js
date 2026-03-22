const judgeLoginForm = document.getElementById("judgeLoginForm");
const judgeAccessStatus = document.getElementById("judgeAccessStatus");

function status(msg, type = "") {
  if (!judgeAccessStatus) return;
  judgeAccessStatus.textContent = msg;
  judgeAccessStatus.className = `status ${type}`.trim();
}

if (sessionStorage.getItem("mindforge_judge_key")) {
  window.location.replace("/judges-dashboard.html");
}

judgeLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = new FormData(judgeLoginForm).get("key");
  status("Authenticating judge key...");

  try {
    const response = await fetch("/api/admin-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "judgeAuth", key })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Auth failed");
    }

    sessionStorage.setItem("mindforge_judge_key", key);
    status("Judge access granted. Opening portal...", "ok");
    window.location.replace("/judges-dashboard.html");
  } catch (error) {
    status(error.message || "Invalid judge key.", "err");
  }
});
