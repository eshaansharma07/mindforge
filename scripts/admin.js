const adminLoginForm = document.getElementById("adminLoginForm");
const adminStatus = document.getElementById("adminStatus");
const announcementForm = document.getElementById("announcementForm");
const questionForm = document.getElementById("questionForm");
const closeQuestionBtn = document.getElementById("closeQuestionBtn");
const teamsCount = document.getElementById("teamsCount");
const activeQuestion = document.getElementById("activeQuestion");
const leaderboardCount = document.getElementById("leaderboardCount");
const teamsBox = document.getElementById("teamsBox");
const leaderboardBox = document.getElementById("leaderboardBox");

let adminKey = sessionStorage.getItem("mindforge_admin_key") || "";

function status(msg, type = "") {
  adminStatus.textContent = msg;
  adminStatus.className = `status ${type}`.trim();
}

function lockRequired() {
  if (!adminKey) {
    status("Login first.", "err");
    return true;
  }
  return false;
}

async function api(path, method = "GET", body) {
  const headers = {};
  if (adminKey) headers["x-admin-key"] = adminKey;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Request failed");
  }
  return result;
}

function renderRows(container, rows, empty = "No data") {
  container.innerHTML = "";
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="item muted">${empty}</div>`;
    return;
  }
  rows.forEach((html) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = html;
    container.appendChild(div);
  });
}

async function refreshOverview() {
  if (!adminKey) return;

  try {
    const data = await api("/api/admin-overview");
    teamsCount.textContent = String(data.teamsCount);
    activeQuestion.textContent = data.activeQuestion ? "Yes" : "No";
    leaderboardCount.textContent = String(data.leaderboard.length);

    renderRows(
      teamsBox,
      data.latestTeams.map((t) => `<strong>${t.teamName}</strong> (${t.teamId})<br/><span class="muted">${t.department}</span>`),
      "No registrations yet"
    );

    renderRows(
      leaderboardBox,
      data.leaderboard.map((l, i) => `#${i + 1} <strong>${l.teamName || l.teamId}</strong> - ${Math.round(l.elapsedMs / 1000)}s`),
      "No correct submissions yet"
    );
  } catch (error) {
    status(error.message || "Unable to refresh overview", "err");
  }
}

adminLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = new FormData(adminLoginForm).get("key");
  status("Authenticating controller key...");

  try {
    const response = await fetch("/api/admin-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Auth failed");
    }

    adminKey = key;
    sessionStorage.setItem("mindforge_admin_key", adminKey);
    status("Controller access granted.", "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Invalid key.", "err");
  }
});

announcementForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (lockRequired()) return;

  const form = Object.fromEntries(new FormData(announcementForm).entries());
  status("Publishing announcement...");

  try {
    await api("/api/admin-announcement", "POST", form);
    status("Announcement published.", "ok");
    announcementForm.reset();
  } catch (error) {
    status(error.message || "Failed to publish.", "err");
  }
});

questionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (lockRequired()) return;

  const raw = Object.fromEntries(new FormData(questionForm).entries());
  const payload = {
    text: raw.text,
    options: String(raw.options || "").split("\n").map((x) => x.trim()).filter(Boolean),
    correctIndex: Number(raw.correctIndex),
    durationSec: Number(raw.durationSec)
  };

  status("Launching live question...");

  try {
    await api("/api/admin-launch-question", "POST", payload);
    status("Question launched successfully.", "ok");
    questionForm.reset();
    refreshOverview();
  } catch (error) {
    status(error.message || "Launch failed.", "err");
  }
});

closeQuestionBtn?.addEventListener("click", async () => {
  if (lockRequired()) return;
  status("Closing active question...");

  try {
    await api("/api/admin-close-question", "POST");
    status("Question closed.", "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not close question.", "err");
  }
});

if (adminKey) {
  status("Controller session restored.", "ok");
  refreshOverview();
}

setInterval(refreshOverview, 3000);
