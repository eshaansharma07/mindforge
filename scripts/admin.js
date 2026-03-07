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
const responsesBox = document.getElementById("responsesBox");

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

async function deleteTeam(teamId) {
  if (lockRequired()) return;
  const confirmDelete = window.confirm(`Delete team ${teamId}? This cannot be undone.`);
  if (!confirmDelete) return;

  try {
    await api("/api/admin-delete-team", "POST", { teamId });
    status(`Team ${teamId} deleted.`, "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Failed to delete team.", "err");
  }
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

function parseBatchQuestions(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const questions = [];

  for (const line of lines) {
    const parts = line.split("||").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 4) continue;

    const correctIndex = Number(parts[parts.length - 1]);
    const text = parts[0];
    const options = parts.slice(1, -1);

    if (!text || options.length < 2 || !Number.isInteger(correctIndex)) continue;

    questions.push({ text, options, correctIndex });
  }

  return questions;
}

async function refreshOverview() {
  if (!adminKey) return;

  try {
    const data = await api("/api/admin-overview");
    teamsCount.textContent = String(data.teamsCount);
    activeQuestion.textContent = data.activeSet ? "Yes" : "No";
    leaderboardCount.textContent = String(data.leaderboard.length);

    renderRows(
      teamsBox,
      data.latestTeams.map(
        (t) =>
          `<strong>${t.teamName}</strong> (${t.teamId})<br/><span class="muted">${t.department}</span><br/><button class="btn" type="button" data-delete-team="${t.teamId}" style="margin-top:8px;">Delete Team</button>`
      ),
      "No registrations yet"
    );

    teamsBox.querySelectorAll("[data-delete-team]").forEach((btn) => {
      btn.addEventListener("click", () => deleteTeam(btn.getAttribute("data-delete-team")));
    });

    renderRows(
      leaderboardBox,
      data.leaderboard.map(
        (l, i) =>
          `#${i + 1} <strong>${l.teamName || l.teamId}</strong> | Points: ${l.points} | Correct: ${l.correctCount}/${l.totalQuestions} | Time: ${Math.round(l.elapsedMs / 1000)}s`
      ),
      "No submissions yet"
    );

    renderRows(
      responsesBox,
      data.responseBreakdown.map((r) => {
        const answers = (r.answers || [])
          .map(
            (a, idx) =>
              `Q${idx + 1}: selected ${a.selectedIndex >= 0 ? a.selectedIndex : "-"}, correct ${a.correctIndex} -> <strong style=\"color:${a.isCorrect ? "#73ffa4" : "#ff7595"}\">${a.isCorrect ? "Correct" : "Wrong"}</strong>`
          )
          .join("<br/>");

        return `<strong>${r.teamName || r.teamId}</strong> (${r.teamId})<br/>Points: ${r.points} | Correct: ${r.correctCount}/${r.totalQuestions} | Time: ${Math.round(r.elapsedMs / 1000)}s<br/><span class="muted">${answers}</span>`;
      }),
      "No team submissions yet"
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
  const questions = parseBatchQuestions(raw.batchQuestions);

  if (questions.length === 0) {
    status("Add valid question lines in the required format.", "err");
    return;
  }

  const payload = {
    questions,
    durationSec: Number(raw.durationSec),
    pointsPerCorrect: Number(raw.pointsPerCorrect)
  };

  status("Launching question set...");

  try {
    const result = await api("/api/admin-launch-question", "POST", payload);
    status(`Question set launched. Set ID: ${result.setId} (${result.questionCount} questions)`, "ok");
    questionForm.reset();
    refreshOverview();
  } catch (error) {
    status(error.message || "Launch failed.", "err");
  }
});

closeQuestionBtn?.addEventListener("click", async () => {
  if (lockRequired()) return;
  status("Closing active set...");

  try {
    await api("/api/admin-close-question", "POST");
    status("Question set closed.", "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not close set.", "err");
  }
});

if (adminKey) {
  status("Controller session restored.", "ok");
  refreshOverview();
}

setInterval(refreshOverview, 3000);
