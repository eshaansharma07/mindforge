const announcementForm = document.getElementById("announcementForm");
const questionForm = document.getElementById("questionForm");
const closeQuestionBtn = document.getElementById("closeQuestionBtn");
const controllerLogoutBtn = document.getElementById("controllerLogoutBtn");
const adminStatus = document.getElementById("adminStatus");
const teamsCount = document.getElementById("teamsCount");
const activeQuestion = document.getElementById("activeQuestion");
const leaderboardCount = document.getElementById("leaderboardCount");
const teamsBox = document.getElementById("teamsBox");
const leaderboardBox = document.getElementById("leaderboardBox");
const responsesBox = document.getElementById("responsesBox");
const announcementsBox = document.getElementById("announcementsBox");
const leaderboardEditor = document.getElementById("leaderboardEditor");
const showLeaderboardBtn = document.getElementById("showLeaderboardBtn");
const saveLeaderboardBtn = document.getElementById("saveLeaderboardBtn");
const hideLeaderboardBtn = document.getElementById("hideLeaderboardBtn");
const resetLeaderboardBtn = document.getElementById("resetLeaderboardBtn");
const leaderboardStatus = document.getElementById("leaderboardStatus");

let adminKey = sessionStorage.getItem("mindforge_admin_key") || "";
let sourceSetId = null;
let latestComputedLeaderboard = [];
let leaderboardEditorDirty = false;
let overviewRequestInFlight = false;
let overviewPollTimeout = null;

const ACTIVE_REFRESH_MS = 4000;
const IDLE_REFRESH_MS = 7000;
const ERROR_REFRESH_MS = 9000;

function nextRefreshDelay(hasActiveSet, hadError = false) {
  const base = hadError ? ERROR_REFRESH_MS : hasActiveSet ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
  return base + Math.floor(Math.random() * 700);
}

function queueNextRefresh(hasActiveSet = false, hadError = false) {
  clearTimeout(overviewPollTimeout);
  overviewPollTimeout = setTimeout(() => {
    refreshOverview();
  }, nextRefreshDelay(hasActiveSet, hadError));
}

function status(msg, type = "") {
  adminStatus.textContent = msg;
  adminStatus.className = `status ${type}`.trim();
}

function leaderboardMessage(msg, type = "") {
  if (!leaderboardStatus) return;
  leaderboardStatus.textContent = msg;
  leaderboardStatus.className = `status ${type}`.trim();
}

function redirectToAccess() {
  window.location.replace("/admin.html");
}

if (!adminKey) {
  redirectToAccess();
}

function lockRequired() {
  if (!adminKey) {
    redirectToAccess();
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
    await api("/api/admin-action", "POST", { action: "deleteTeam", teamId });
    status(`Team ${teamId} deleted.`, "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Failed to delete team.", "err");
  }
}

async function deleteAnnouncement(announcementId) {
  if (lockRequired()) return;
  const confirmDelete = window.confirm("Remove this published update?");
  if (!confirmDelete) return;

  try {
    await api("/api/admin-action", "POST", { action: "deleteAnnouncement", announcementId });
    status("Published update removed.", "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Failed to delete announcement.", "err");
  }
}

async function allowRetry(teamId) {
  if (lockRequired()) return;
  const confirmReset = window.confirm(`Allow ${teamId} to attempt this quiz set again?`);
  if (!confirmReset) return;

  try {
    await api("/api/admin-action", "POST", {
      action: "resetAttempt",
      teamId,
      setId: sourceSetId
    });
    status(`Retry enabled for ${teamId}.`, "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not reset this team attempt.", "err");
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
    const prompt = parts[0];
    const options = parts.slice(1, -1);

    if (!prompt || options.length < 2 || !Number.isInteger(correctIndex)) continue;

    questions.push({ text: prompt, options, correctIndex });
  }

  return questions;
}

function serializeLeaderboardEntries(entries) {
  return (entries || [])
    .map(
      (entry) =>
        `${entry.teamId || ""} || ${entry.teamName || ""} || ${Number(entry.points || 0)} || ${Number(entry.correctCount || 0)} || ${Number(entry.totalQuestions || 0)} || ${Math.round(Number(entry.elapsedMs || 0) / 1000)}`
    )
    .join("\n");
}

function parseLeaderboardEntries(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("||").map((part) => part.trim());
      if (parts.length < 6) return null;
      return {
        teamId: parts[0].toUpperCase(),
        teamName: parts[1],
        points: Number(parts[2] || 0),
        correctCount: Number(parts[3] || 0),
        totalQuestions: Number(parts[4] || 0),
        elapsedMs: Math.max(0, Number(parts[5] || 0) * 1000)
      };
    })
    .filter(Boolean);
}

function getLeaderboardEntriesForAction(action) {
  if (action === "hide" || action === "reset") {
    return [];
  }

  const manualEntries = parseLeaderboardEntries(leaderboardEditor?.value || "");
  if (manualEntries.length > 0) {
    return manualEntries;
  }

  return Array.isArray(latestComputedLeaderboard) ? latestComputedLeaderboard : [];
}

async function updatePublicLeaderboard(action) {
  if (lockRequired()) return;

  const entries = getLeaderboardEntriesForAction(action);
  if (action !== "hide" && action !== "reset") {
    if (entries.length === 0) {
      leaderboardMessage("No leaderboard data is available yet. Wait for submissions first.", "err");
      return;
    }
  }

  if (action === "reset") {
    const confirmReset = window.confirm("Reset the leaderboard and remove all pre-existing leaderboard data?");
    if (!confirmReset) return;
  }

  leaderboardMessage(
    action === "show"
      ? "Publishing leaderboard..."
      : action === "save"
        ? "Saving leaderboard edits..."
        : action === "hide"
          ? "Hiding leaderboard..."
          : "Resetting leaderboard..."
  );

  try {
    await api("/api/admin-action", "POST", { action: "leaderboard", mode: action, entries });
    leaderboardEditorDirty = false;
    leaderboardMessage(
      action === "show"
        ? "Leaderboard is now visible on the candidate portal."
        : action === "save"
          ? "Leaderboard edits saved."
          : action === "hide"
            ? "Leaderboard hidden from the candidate portal."
            : "Leaderboard reset and cleared.",
      "ok"
    );
    refreshOverview();
  } catch (error) {
    leaderboardMessage(error.message || "Could not update leaderboard.", "err");
  }
}

async function refreshOverview() {
  if (!adminKey || overviewRequestInFlight) return;
  overviewRequestInFlight = true;

  try {
    const data = await api("/api/admin-overview");
    sourceSetId = data.sourceSetId || null;
    latestComputedLeaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
    const leaderboardWasReset = Boolean(data.leaderboardState?.isReset);
    teamsCount.textContent = String(data.teamsCount);
    activeQuestion.textContent = data.activeSet ? "Yes" : "No";
    leaderboardCount.textContent = String(leaderboardWasReset ? 0 : data.leaderboard.length);

    renderRows(
      teamsBox,
      data.latestTeams.map(
        (team) =>
          `<strong>${team.teamName}</strong> (${team.teamId})<br/><span class="muted">${team.department}</span><br/><button class="btn" type="button" data-delete-team="${team.teamId}" style="margin-top:8px;">Delete Team</button>`
      ),
      "No registrations yet"
    );

    teamsBox.querySelectorAll("[data-delete-team]").forEach((btn) => {
      btn.addEventListener("click", () => deleteTeam(btn.getAttribute("data-delete-team")));
    });

    renderRows(
      leaderboardBox,
      leaderboardWasReset
        ? []
        : data.leaderboard.map(
            (row, index) =>
              `#${index + 1} <strong>${row.teamName || row.teamId}</strong> | Points: ${row.points} | Correct: ${row.correctCount}/${row.totalQuestions} | Time: ${Math.round(row.elapsedMs / 1000)}s`
          ),
      leaderboardWasReset ? "Leaderboard reset. No data shown." : "No submissions yet"
    );

    const publicEntries =
      leaderboardWasReset
        ? []
        : Array.isArray(data.leaderboardState?.entries) && data.leaderboardState.entries.length > 0
        ? data.leaderboardState.entries
        : latestComputedLeaderboard;
    if (leaderboardEditor && document.activeElement !== leaderboardEditor && !leaderboardEditorDirty) {
      leaderboardEditor.value = serializeLeaderboardEntries(publicEntries);
    }
    leaderboardMessage(
      leaderboardWasReset
        ? "Leaderboard has been reset. Publish or save to generate it again."
        : data.leaderboardState?.isVisible
        ? "Leaderboard is currently visible on the candidate portal."
        : "Leaderboard is currently hidden from the candidate portal.",
      leaderboardWasReset ? "" : data.leaderboardState?.isVisible ? "ok" : ""
    );

    renderRows(
      announcementsBox,
      (data.latestAnnouncements || []).map(
        (announcement) =>
          `<strong>${announcement.title}</strong><br/><span class="muted">${announcement.body}</span><br/><button class="btn" type="button" data-delete-announcement="${announcement.announcementId}" style="margin-top:8px;">Delete Update</button>`
      ),
      "No published updates yet"
    );

    announcementsBox.querySelectorAll("[data-delete-announcement]").forEach((btn) => {
      btn.addEventListener("click", () =>
        deleteAnnouncement(btn.getAttribute("data-delete-announcement"))
      );
    });

    renderRows(
      responsesBox,
      data.responseBreakdown.map((row) => {
        const answers = (row.answers || [])
          .map(
            (answer, index) =>
              `Q${index + 1}: selected ${answer.selectedIndex >= 0 ? answer.selectedIndex : "-"}, correct ${answer.correctIndex} -> <strong style="color:${answer.isCorrect ? "#73ffa4" : "#ff7595"}">${answer.isCorrect ? "Correct" : "Wrong"}</strong>`
          )
          .join("<br/>");

        return `<strong>${row.teamName || row.teamId}</strong> (${row.teamId})<br/>Points: ${row.points} | Correct: ${row.correctCount}/${row.totalQuestions} | Time: ${Math.round(row.elapsedMs / 1000)}s<br/><span class="muted">${answers}</span><br/><button class="btn" type="button" data-allow-retry="${row.teamId}" style="margin-top:8px;">Allow Retry</button>`;
      }),
      "No team submissions yet"
    );

    responsesBox.querySelectorAll("[data-allow-retry]").forEach((btn) => {
      btn.addEventListener("click", () => allowRetry(btn.getAttribute("data-allow-retry")));
    });
    queueNextRefresh(Boolean(data.activeSet), false);
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("unauthorized")) {
      sessionStorage.removeItem("mindforge_admin_key");
      redirectToAccess();
      return;
    }
    status(error.message || "Unable to refresh overview", "err");
    queueNextRefresh(Boolean(sourceSetId), true);
  } finally {
    overviewRequestInFlight = false;
  }
}

announcementForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (lockRequired()) return;

  const form = Object.fromEntries(new FormData(announcementForm).entries());
  status("Publishing announcement...");

  try {
    await api("/api/admin-action", "POST", { action: "publishAnnouncement", ...form });
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
    const result = await api("/api/admin-action", "POST", { action: "launchQuestion", ...payload });
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
    await api("/api/admin-action", "POST", { action: "closeQuestion" });
    status("Question set closed.", "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not close set.", "err");
  }
});

controllerLogoutBtn?.addEventListener("click", () => {
  clearTimeout(overviewPollTimeout);
  sessionStorage.removeItem("mindforge_admin_key");
  redirectToAccess();
});
leaderboardEditor?.addEventListener("input", () => {
  leaderboardEditorDirty = true;
});
showLeaderboardBtn?.addEventListener("click", () => updatePublicLeaderboard("show"));
saveLeaderboardBtn?.addEventListener("click", () => updatePublicLeaderboard("save"));
hideLeaderboardBtn?.addEventListener("click", () => updatePublicLeaderboard("hide"));
resetLeaderboardBtn?.addEventListener("click", () => updatePublicLeaderboard("reset"));

status("Controller session restored.", "ok");
refreshOverview();
