const roundForm = document.getElementById("codingRoundForm");
const closeRoundBtn = document.getElementById("closeCodingRoundBtn");
const logoutBtn = document.getElementById("codingControllerLogoutBtn");
const controllerStatus = document.getElementById("codingControllerStatus");
const activeState = document.getElementById("codingActiveState");
const submissionCount = document.getElementById("codingSubmissionCount");
const leaderboardCount = document.getElementById("codingLeaderboardCount");
const roundSummary = document.getElementById("codingRoundSummary");
const leaderboardTable = document.getElementById("codingLeaderboardTable");
const submissionReview = document.getElementById("codingSubmissionReview");
const submissionFilter = document.getElementById("codingSubmissionFilter");
const judgeTeamSelect = document.getElementById("codingJudgeTeamSelect");
const judgeVerdictSelect = document.getElementById("codingJudgeVerdictSelect");
const judgeNameInput = document.getElementById("codingJudgeNameInput");
const judgeCommentsInput = document.getElementById("codingJudgeCommentsInput");
const saveJudgeVerdictBtn = document.getElementById("saveCodingJudgeVerdictBtn");
const judgeVerdictStatus = document.getElementById("codingJudgeVerdictStatus");
const judgeVerdictBox = document.getElementById("codingJudgeVerdictBox");
const leaderboardEditor = document.getElementById("codingLeaderboardEditor");
const leaderboardStatus = document.getElementById("codingLeaderboardStatus");
const showLeaderboardBtn = document.getElementById("showCodingLeaderboardBtn");
const saveLeaderboardBtn = document.getElementById("saveCodingLeaderboardBtn");
const hideLeaderboardBtn = document.getElementById("hideCodingLeaderboardBtn");
const resetLeaderboardBtn = document.getElementById("resetCodingLeaderboardBtn");

let adminKey = sessionStorage.getItem("mindforge_admin_key") || "";
let sourceRoundId = null;
let latestComputedLeaderboard = [];
let leaderboardEditorDirty = false;
let selectedSubmissionTeamId = "all";
let latestJudgeVerdicts = [];
let overviewRequestInFlight = false;
let overviewPollTimeout = null;

const ACTIVE_REFRESH_MS = 4000;
const IDLE_REFRESH_MS = 7000;
const ERROR_REFRESH_MS = 9000;

function nextRefreshDelay(hasActiveRound, hadError = false) {
  const base = hadError ? ERROR_REFRESH_MS : hasActiveRound ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
  return base + Math.floor(Math.random() * 700);
}

function queueNextRefresh(hasActiveRound = false, hadError = false) {
  clearTimeout(overviewPollTimeout);
  overviewPollTimeout = setTimeout(() => {
    refreshOverview();
  }, nextRefreshDelay(hasActiveRound, hadError));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function status(msg, type = "") {
  controllerStatus.textContent = msg;
  controllerStatus.className = `status ${type}`.trim();
}

function leaderboardMessage(msg, type = "") {
  leaderboardStatus.textContent = msg;
  leaderboardStatus.className = `status ${type}`.trim();
}

function judgeStatus(msg, type = "") {
  if (!judgeVerdictStatus) return;
  judgeVerdictStatus.textContent = msg;
  judgeVerdictStatus.className = `status ${type}`.trim();
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

function renderRows(container, rows, empty = "No data") {
  container.innerHTML = "";
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="item muted">${empty}</div>`;
    return;
  }

  rows.forEach((html) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = html;
    container.appendChild(item);
  });
}

function syncSubmissionFilter(submissions) {
  if (!submissionFilter) return;

  const previousValue = selectedSubmissionTeamId || submissionFilter.value || "all";
  const options = [
    `<option value="all">All Submissions</option>`,
    ...(submissions || []).map(
      (submission) =>
        `<option value="${escapeHtml(submission.teamId)}">${escapeHtml(submission.teamName || submission.teamId)} (${escapeHtml(submission.teamId)})</option>`
    )
  ];

  submissionFilter.innerHTML = options.join("");
  const hasPrevious = previousValue === "all" || (submissions || []).some((submission) => submission.teamId === previousValue);
  selectedSubmissionTeamId = hasPrevious ? previousValue : "all";
  submissionFilter.value = selectedSubmissionTeamId;
}

function syncJudgeTeamOptions(submissions) {
  if (!judgeTeamSelect) return;

  const rows = Array.isArray(submissions) ? submissions : [];
  const selectedValue = judgeTeamSelect.value || "";
  judgeTeamSelect.innerHTML = [
    `<option value="">Select Team</option>`,
    ...rows.map(
      (submission) =>
        `<option value="${escapeHtml(submission.teamId)}">${escapeHtml(submission.teamName || submission.teamId)} (${escapeHtml(submission.teamId)})</option>`
    )
  ].join("");

  const stillExists = rows.some((submission) => submission.teamId === selectedValue);
  judgeTeamSelect.value = stillExists ? selectedValue : "";
  fillJudgeForm();
}

function fillJudgeForm() {
  const teamId = judgeTeamSelect?.value || "";
  if (!teamId) {
    if (judgeVerdictSelect) judgeVerdictSelect.value = "Approved";
    if (judgeNameInput) judgeNameInput.value = "";
    if (judgeCommentsInput) judgeCommentsInput.value = "";
    return;
  }

  const existing = latestJudgeVerdicts.find((item) => item.teamId === teamId);
  if (judgeVerdictSelect) judgeVerdictSelect.value = existing?.verdict || "Approved";
  if (judgeNameInput) judgeNameInput.value = existing?.judgeName || "";
  if (judgeCommentsInput) judgeCommentsInput.value = existing?.comments || "";
}

async function saveJudgeVerdict() {
  if (lockRequired()) return;
  const teamId = judgeTeamSelect?.value || "";

  if (!sourceRoundId || !teamId) {
    judgeStatus("Select a team submission before saving a verdict.", "err");
    return;
  }

  judgeStatus("Saving judge verdict...");

  try {
    await api("/api/admin-action", "POST", {
      action: "saveCodingJudgeVerdict",
      roundId: sourceRoundId,
      teamId,
      verdict: judgeVerdictSelect?.value || "Approved",
      judgeName: judgeNameInput?.value || "",
      comments: judgeCommentsInput?.value || ""
    });
    judgeStatus(`Verdict saved for ${teamId}.`, "ok");
    refreshOverview();
  } catch (error) {
    judgeStatus(error.message || "Could not save judge verdict.", "err");
  }
}

function decodeField(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function parseTestCases(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("||").map((part) => part.trim());
      if (parts.length < 4) return null;

      return {
        label: parts[0],
        input: decodeField(parts[1]),
        expectedOutput: decodeField(parts[2]),
        points: Number(parts[3] || 0)
      };
    })
    .filter(Boolean);
}

function serializeCodingLeaderboardEntries(entries) {
  return (entries || [])
    .map(
      (entry) =>
        `${entry.teamId || ""} || ${entry.teamName || ""} || ${Number(entry.points || 0)} || ${Number(entry.correctCount || 0)} || ${Number(entry.totalCases || 0)} || ${Math.round(Number(entry.elapsedMs || 0) / 1000)}`
    )
    .join("\n");
}

function parseCodingLeaderboardEntries(text) {
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
        totalCases: Number(parts[4] || 0),
        elapsedMs: Math.max(0, Number(parts[5] || 0) * 1000)
      };
    })
    .filter(Boolean);
}

function getLeaderboardEntriesForAction(action) {
  if (action === "hide" || action === "reset") return [];

  const manualEntries = parseCodingLeaderboardEntries(leaderboardEditor?.value || "");
  if (manualEntries.length > 0) return manualEntries;
  return Array.isArray(latestComputedLeaderboard) ? latestComputedLeaderboard : [];
}

async function updateCodingLeaderboard(action) {
  if (lockRequired()) return;

  const entries = getLeaderboardEntriesForAction(action);
  if (action !== "hide" && action !== "reset" && entries.length === 0) {
    leaderboardMessage("No coding leaderboard data is available yet. Wait for submissions first.", "err");
    return;
  }

  if (action === "reset") {
    const confirmed = window.confirm("Reset the coding leaderboard and remove all published coding leaderboard data?");
    if (!confirmed) return;
  }

  leaderboardMessage(
    action === "show"
      ? "Publishing coding leaderboard..."
      : action === "save"
        ? "Saving coding leaderboard edits..."
        : action === "hide"
          ? "Hiding coding leaderboard..."
          : "Resetting coding leaderboard..."
  );

  try {
    await api("/api/admin-action", "POST", { action: "codingLeaderboard", mode: action, entries });
    leaderboardEditorDirty = false;
    leaderboardMessage(
      action === "show"
        ? "Coding leaderboard is now visible on the candidate portal."
        : action === "save"
          ? "Coding leaderboard edits saved."
          : action === "hide"
            ? "Coding leaderboard hidden from the candidate portal."
            : "Coding leaderboard reset and cleared.",
      "ok"
    );
    refreshOverview();
  } catch (error) {
    leaderboardMessage(error.message || "Could not update coding leaderboard.", "err");
  }
}

async function allowCodingRetry(teamId) {
  if (lockRequired()) return;
  const confirmed = window.confirm(`Allow ${teamId} to attempt the coding round again?`);
  if (!confirmed) return;

  try {
    await api("/api/admin-action", "POST", {
      action: "resetCodingAttempt",
      teamId,
      roundId: sourceRoundId
    });
    status(`Coding retry enabled for ${teamId}.`, "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not reset this coding attempt.", "err");
  }
}

async function refreshOverview() {
  if (!adminKey || overviewRequestInFlight) return;
  overviewRequestInFlight = true;

  try {
    const data = await api("/api/coding-overview");
    sourceRoundId = data.sourceRound?.roundId || null;
    latestComputedLeaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];

    activeState.textContent = data.activeRound ? "Yes" : "No";
    submissionCount.textContent = String((data.submissions || []).length);
    leaderboardCount.textContent = String((data.leaderboard || []).length);

    renderRows(
      roundSummary,
      data.sourceRound
        ? [
            `<strong>${data.sourceRound.title}</strong> (${data.sourceRound.roundId})`,
            `${escapeHtml(data.sourceRound.subtitle || "Round 2 | Sudden Coding")}`,
            `Duration: ${data.sourceRound.durationSec}s`,
            `Test Cases: ${(data.sourceRound.testCases || []).length}`,
            `<pre class="code-preview">${escapeHtml(data.sourceRound.problemStatement || "")}</pre>`,
            `<pre class="code-preview">${(data.sourceRound.testCases || [])
              .map((item) => `${escapeHtml(item.label)} | ${item.points} pts\nInput:\n${escapeHtml(item.input)}\nExpected Output:\n${escapeHtml(item.expectedOutput)}`)
              .join("\n\n")}</pre>`
          ]
        : [],
      "No coding round has been published yet."
    );

    renderRows(
      leaderboardTable,
      (data.leaderboard || []).map(
        (entry, index) =>
          `#${index + 1} <strong>${entry.teamName || entry.teamId}</strong> | Points: ${entry.points} | Correct: ${entry.correctCount}/${entry.totalCases} | Time: ${Math.round(entry.elapsedMs / 1000)}s`
      ),
      "No coding submissions yet."
    );

    const publicEntries =
      Array.isArray(latestComputedLeaderboard) && latestComputedLeaderboard.length > 0
        ? latestComputedLeaderboard
        : Array.isArray(data.leaderboardState?.entries)
          ? data.leaderboardState.entries
          : [];

    if (leaderboardEditor && document.activeElement !== leaderboardEditor && !leaderboardEditorDirty) {
      leaderboardEditor.value = serializeCodingLeaderboardEntries(publicEntries);
    }

    leaderboardMessage(
      data.leaderboardState?.isVisible
        ? "Coding leaderboard is currently visible on the candidate portal."
        : "Coding leaderboard is currently hidden from the candidate portal.",
      data.leaderboardState?.isVisible ? "ok" : ""
    );

    const allSubmissions = data.submissions || [];
    latestJudgeVerdicts = Array.isArray(data.judgeVerdicts) ? data.judgeVerdicts : [];
    syncSubmissionFilter(allSubmissions);
    syncJudgeTeamOptions(allSubmissions);
    const visibleSubmissions =
      selectedSubmissionTeamId === "all"
        ? allSubmissions
        : allSubmissions.filter((submission) => submission.teamId === selectedSubmissionTeamId);

    renderRows(
      submissionReview,
        visibleSubmissions.map((submission) => {
          const cases = (submission.evaluatedCases || [])
          .map(
            (item) =>
              `${escapeHtml(item.label)}: <strong style="color:${item.isCorrect ? "var(--ok)" : "var(--danger)"}">${item.isCorrect ? "Correct" : "Wrong"}</strong> | ${item.points} pts<br/><span class="muted">Submitted:</span><pre class="code-preview">${escapeHtml(item.submittedOutput || "-")}</pre><span class="muted">Expected:</span><pre class="code-preview">${escapeHtml(item.expectedOutput || "-")}</pre>`
          )
          .join("<div class=\"panel-divider\"></div>");

        return `<strong>${escapeHtml(submission.teamName || submission.teamId)}</strong> (${escapeHtml(submission.teamId)})<br/>Points: ${submission.totalPoints} | Correct: ${submission.correctCount}/${submission.totalCases} | Time: ${Math.round(submission.elapsedMs / 1000)}s | Mode: ${escapeHtml(submission.submissionMode)}<br/><div class="panel-divider"></div><span class="muted">Code</span><pre class="code-preview">${escapeHtml(submission.code || "No code submitted.")}</pre><div class="panel-divider"></div>${cases}<br/><button class="btn" type="button" data-reset-coding="${submission.teamId}" style="margin-top:8px;">Allow Retry</button>`;
      }),
      selectedSubmissionTeamId === "all" ? "No coding submissions yet." : "No submission found for the selected team."
    );

    submissionReview.querySelectorAll("[data-reset-coding]").forEach((button) => {
      button.addEventListener("click", () => allowCodingRetry(button.getAttribute("data-reset-coding")));
    });
    renderRows(
      judgeVerdictBox,
      latestJudgeVerdicts.map(
        (item) =>
          `<strong>${escapeHtml(item.teamId)}</strong> | <span class="muted">${escapeHtml(item.verdict)}</span><br/>Judge: ${escapeHtml(item.judgeName || "Not specified")}<br/>${escapeHtml(item.comments || "No comments")}`
      ),
      "No judge verdicts saved yet."
    );
    queueNextRefresh(Boolean(data.activeRound), false);
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("unauthorized")) {
      sessionStorage.removeItem("mindforge_admin_key");
      redirectToAccess();
      return;
    }
    status(error.message || "Unable to refresh coding controller overview.", "err");
    queueNextRefresh(Boolean(sourceRoundId), true);
  } finally {
    overviewRequestInFlight = false;
  }
}

roundForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (lockRequired()) return;

  const raw = Object.fromEntries(new FormData(roundForm).entries());
  const testCases = parseTestCases(raw.testCasesText);
  if (testCases.length === 0) {
    status("Add at least one valid testcase in the required format.", "err");
    return;
  }

  status("Publishing coding problem...");

  try {
    const result = await api("/api/admin-action", "POST", {
      action: "launchCodingRound",
      title: raw.title,
      subtitle: raw.subtitle,
      instructions: raw.instructions,
      problemStatement: raw.problemStatement,
      constraints: raw.constraints,
      inputFormat: raw.inputFormat,
      outputFormat: raw.outputFormat,
      sampleInput: raw.sampleInput,
      sampleOutput: raw.sampleOutput,
      durationSec: Number(raw.durationSec),
      testCases
    });
    status(`Coding problem published. Round ID: ${result.roundId} (${result.testCaseCount} test cases)`, "ok");
    roundForm.reset();
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not publish coding problem.", "err");
  }
});

closeRoundBtn?.addEventListener("click", async () => {
  if (lockRequired()) return;
  status("Closing coding round...");

  try {
    await api("/api/admin-action", "POST", { action: "closeCodingRound" });
    status("Coding round closed.", "ok");
    refreshOverview();
  } catch (error) {
    status(error.message || "Could not close coding round.", "err");
  }
});

logoutBtn?.addEventListener("click", () => {
  clearTimeout(overviewPollTimeout);
  sessionStorage.removeItem("mindforge_admin_key");
  redirectToAccess();
});

leaderboardEditor?.addEventListener("input", () => {
  leaderboardEditorDirty = true;
});

submissionFilter?.addEventListener("change", () => {
  selectedSubmissionTeamId = submissionFilter.value || "all";
  refreshOverview();
});
judgeTeamSelect?.addEventListener("change", fillJudgeForm);
saveJudgeVerdictBtn?.addEventListener("click", saveJudgeVerdict);

showLeaderboardBtn?.addEventListener("click", () => updateCodingLeaderboard("show"));
saveLeaderboardBtn?.addEventListener("click", () => updateCodingLeaderboard("save"));
hideLeaderboardBtn?.addEventListener("click", () => updateCodingLeaderboard("hide"));
resetLeaderboardBtn?.addEventListener("click", () => updateCodingLeaderboard("reset"));

status("Coding controller session restored.", "ok");
refreshOverview();
