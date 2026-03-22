const judgeLogoutBtn = document.getElementById("judgeLogoutBtn");
const judgeDashboardStatus = document.getElementById("judgeDashboardStatus");

const judgeQuizTeamSelect = document.getElementById("judgeQuizTeamSelect");
const judgeQuizReviewBox = document.getElementById("judgeQuizReviewBox");
const judgeQuizVerdictTeamSelect = document.getElementById("judgeQuizVerdictTeamSelect");
const judgeQuizVerdictSelect = document.getElementById("judgeQuizVerdictSelect");
const judgeQuizNameInput = document.getElementById("judgeQuizNameInput");
const judgeQuizCommentsInput = document.getElementById("judgeQuizCommentsInput");
const saveJudgeQuizVerdictBtn = document.getElementById("saveJudgeQuizVerdictBtn");
const judgeQuizVerdictStatus = document.getElementById("judgeQuizVerdictStatus");
const judgeQuizVerdictList = document.getElementById("judgeQuizVerdictList");

const judgeCodingTeamSelect = document.getElementById("judgeCodingTeamSelect");
const judgeCodingReviewBox = document.getElementById("judgeCodingReviewBox");
const judgeCodingVerdictTeamSelect = document.getElementById("judgeCodingVerdictTeamSelect");
const judgeCodingVerdictSelect = document.getElementById("judgeCodingVerdictSelect");
const judgeCodingNameInput = document.getElementById("judgeCodingNameInput");
const judgeCodingCommentsInput = document.getElementById("judgeCodingCommentsInput");
const saveJudgeCodingVerdictBtn = document.getElementById("saveJudgeCodingVerdictBtn");
const judgeCodingVerdictStatus = document.getElementById("judgeCodingVerdictStatus");
const judgeCodingVerdictList = document.getElementById("judgeCodingVerdictList");

let judgeKey = sessionStorage.getItem("mindforge_judge_key") || "";
let quizSetId = null;
let codingRoundId = null;
let latestQuizRows = [];
let latestQuizVerdicts = [];
let latestCodingRows = [];
let latestCodingVerdicts = [];
let refreshInFlight = false;
let refreshTimeout = null;

const ACTIVE_REFRESH_MS = 4500;
const IDLE_REFRESH_MS = 7000;
const ERROR_REFRESH_MS = 9000;

function queueNextRefresh(hasLiveRound = false, hadError = false) {
  clearTimeout(refreshTimeout);
  const base = hadError ? ERROR_REFRESH_MS : hasLiveRound ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
  refreshTimeout = setTimeout(refreshDashboard, base + Math.floor(Math.random() * 700));
}

function redirectToAccess() {
  window.location.replace("/judges.html");
}

if (!judgeKey) {
  redirectToAccess();
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
  if (!judgeDashboardStatus) return;
  judgeDashboardStatus.textContent = msg;
  judgeDashboardStatus.className = `status ${type}`.trim();
}

function quizVerdictStatus(msg, type = "") {
  if (!judgeQuizVerdictStatus) return;
  judgeQuizVerdictStatus.textContent = msg;
  judgeQuizVerdictStatus.className = `status ${type}`.trim();
}

function codingVerdictStatus(msg, type = "") {
  if (!judgeCodingVerdictStatus) return;
  judgeCodingVerdictStatus.textContent = msg;
  judgeCodingVerdictStatus.className = `status ${type}`.trim();
}

async function api(path, method = "GET", body) {
  const headers = {};
  if (judgeKey) headers["x-judge-key"] = judgeKey;
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
  if (!container) return;
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

function syncSelectOptions(selectEl, rows, emptyLabel, selectedValue) {
  if (!selectEl) return;
  const options = [`<option value="all">${emptyLabel}</option>`]
    .concat(
      rows.map((row) => `<option value="${escapeHtml(row.teamId)}">${escapeHtml(row.teamName || row.teamId)} (${escapeHtml(row.teamId)})</option>`)
    );
  selectEl.innerHTML = options.join("");
  const stillExists = selectedValue === "all" || rows.some((row) => row.teamId === selectedValue);
  selectEl.value = stillExists ? selectedValue : "all";
}

function syncVerdictTeamOptions(selectEl, rows, currentValue) {
  if (!selectEl) return;
  selectEl.innerHTML = [
    `<option value="">Select Team</option>`,
    ...rows.map((row) => `<option value="${escapeHtml(row.teamId)}">${escapeHtml(row.teamName || row.teamId)} (${escapeHtml(row.teamId)})</option>`)
  ].join("");
  const stillExists = rows.some((row) => row.teamId === currentValue);
  selectEl.value = stillExists ? currentValue : "";
}

function fillQuizVerdictForm() {
  const teamId = judgeQuizVerdictTeamSelect?.value || "";
  const existing = latestQuizVerdicts.find((item) => item.teamId === teamId);
  if (judgeQuizVerdictSelect) judgeQuizVerdictSelect.value = existing?.verdict || "Approved";
  if (judgeQuizNameInput) judgeQuizNameInput.value = existing?.judgeName || "";
  if (judgeQuizCommentsInput) judgeQuizCommentsInput.value = existing?.comments || "";
}

function fillCodingVerdictForm() {
  const teamId = judgeCodingVerdictTeamSelect?.value || "";
  const existing = latestCodingVerdicts.find((item) => item.teamId === teamId);
  if (judgeCodingVerdictSelect) judgeCodingVerdictSelect.value = existing?.verdict || "Approved";
  if (judgeCodingNameInput) judgeCodingNameInput.value = existing?.judgeName || "";
  if (judgeCodingCommentsInput) judgeCodingCommentsInput.value = existing?.comments || "";
}

async function saveQuizVerdict() {
  const teamId = judgeQuizVerdictTeamSelect?.value || "";
  if (!quizSetId || !teamId) {
    quizVerdictStatus("Choose a Round 1 team before saving the verdict.", "err");
    return;
  }

  quizVerdictStatus("Saving Round 1 verdict...");
  try {
    await api("/api/admin-action", "POST", {
      action: "saveJudgeVerdict",
      setId: quizSetId,
      teamId,
      verdict: judgeQuizVerdictSelect?.value || "Approved",
      judgeName: judgeQuizNameInput?.value || "",
      comments: judgeQuizCommentsInput?.value || ""
    });
    quizVerdictStatus(`Round 1 verdict saved for ${teamId}.`, "ok");
    refreshDashboard();
  } catch (error) {
    quizVerdictStatus(error.message || "Could not save Round 1 verdict.", "err");
  }
}

async function saveCodingVerdict() {
  const teamId = judgeCodingVerdictTeamSelect?.value || "";
  if (!codingRoundId || !teamId) {
    codingVerdictStatus("Choose a Round 2 team before saving the verdict.", "err");
    return;
  }

  codingVerdictStatus("Saving Round 2 verdict...");
  try {
    await api("/api/admin-action", "POST", {
      action: "saveCodingJudgeVerdict",
      roundId: codingRoundId,
      teamId,
      verdict: judgeCodingVerdictSelect?.value || "Approved",
      judgeName: judgeCodingNameInput?.value || "",
      comments: judgeCodingCommentsInput?.value || ""
    });
    codingVerdictStatus(`Round 2 verdict saved for ${teamId}.`, "ok");
    refreshDashboard();
  } catch (error) {
    codingVerdictStatus(error.message || "Could not save Round 2 verdict.", "err");
  }
}

function renderQuizReview() {
  const filter = judgeQuizTeamSelect?.value || "all";
  const rows = filter === "all" ? latestQuizRows : latestQuizRows.filter((row) => row.teamId === filter);
  renderRows(
    judgeQuizReviewBox,
    rows.map((row) => {
      const answers = (row.answers || [])
        .map(
          (answer, index) =>
            `Q${index + 1}: selected ${answer.selectedIndex >= 0 ? answer.selectedIndex : "-"}, correct ${answer.correctIndex} -> <strong style="color:${answer.isCorrect ? "var(--ok)" : "var(--danger)"}">${answer.isCorrect ? "Correct" : "Wrong"}</strong>`
        )
        .join("<br/>");

      return `<strong>${escapeHtml(row.teamName || row.teamId)}</strong> (${escapeHtml(row.teamId)})<br/>Points: ${row.points} | Correct: ${row.correctCount}/${row.totalQuestions} | Time: ${Math.round(row.elapsedMs / 1000)}s<br/><span class="muted">${answers}</span>`;
    }),
    filter === "all" ? "No Round 1 submissions yet." : "No Round 1 submission found for the selected team."
  );
}

function renderCodingReview() {
  const filter = judgeCodingTeamSelect?.value || "all";
  const rows = filter === "all" ? latestCodingRows : latestCodingRows.filter((row) => row.teamId === filter);

  renderRows(
    judgeCodingReviewBox,
    rows.map((submission) => {
      const cases = (submission.evaluatedCases || [])
        .map(
          (item) =>
            `${escapeHtml(item.label)}: <strong style="color:${item.isCorrect ? "var(--ok)" : "var(--danger)"}">${item.isCorrect ? "Correct" : "Wrong"}</strong> | ${item.points} pts<br/><span class="muted">Submitted:</span><pre class="code-preview">${escapeHtml(item.submittedOutput || "-")}</pre><span class="muted">Expected:</span><pre class="code-preview">${escapeHtml(item.expectedOutput || "-")}</pre>`
        )
        .join('<div class="panel-divider"></div>');

      return `<strong>${escapeHtml(submission.teamName || submission.teamId)}</strong> (${escapeHtml(submission.teamId)})<br/>Points: ${submission.totalPoints} | Correct: ${submission.correctCount}/${submission.totalCases} | Time: ${Math.round(submission.elapsedMs / 1000)}s | Mode: ${escapeHtml(submission.submissionMode)}<br/><div class="panel-divider"></div><span class="muted">Code</span><pre class="code-preview">${escapeHtml(submission.code || "No code submitted.")}</pre><div class="panel-divider"></div>${cases}`;
    }),
    filter === "all" ? "No Round 2 submissions yet." : "No Round 2 submission found for the selected team."
  );
}

async function refreshDashboard() {
  if (!judgeKey || refreshInFlight) return;
  refreshInFlight = true;

  try {
    const [quizData, codingData] = await Promise.all([
      api("/api/admin-overview"),
      api("/api/coding-overview")
    ]);

    quizSetId = quizData.sourceSetId || null;
    codingRoundId = codingData.sourceRound?.roundId || null;
    latestQuizRows = Array.isArray(quizData.responseBreakdown) ? quizData.responseBreakdown : [];
    latestCodingRows = Array.isArray(codingData.submissions) ? codingData.submissions : [];
    latestQuizVerdicts = Array.isArray(quizData.judgeVerdicts) ? quizData.judgeVerdicts : [];
    latestCodingVerdicts = Array.isArray(codingData.judgeVerdicts) ? codingData.judgeVerdicts : [];

    syncSelectOptions(judgeQuizTeamSelect, latestQuizRows, "All Teams", judgeQuizTeamSelect?.value || "all");
    syncSelectOptions(judgeCodingTeamSelect, latestCodingRows, "All Teams", judgeCodingTeamSelect?.value || "all");
    syncVerdictTeamOptions(judgeQuizVerdictTeamSelect, latestQuizRows, judgeQuizVerdictTeamSelect?.value || "");
    syncVerdictTeamOptions(judgeCodingVerdictTeamSelect, latestCodingRows, judgeCodingVerdictTeamSelect?.value || "");
    fillQuizVerdictForm();
    fillCodingVerdictForm();
    renderQuizReview();
    renderCodingReview();

    renderRows(
      judgeQuizVerdictList,
      latestQuizVerdicts.map(
        (item) =>
          `<strong>${escapeHtml(item.teamId)}</strong> | <span class="muted">${escapeHtml(item.verdict)}</span><br/>Judge: ${escapeHtml(item.judgeName || "Not specified")}<br/>${escapeHtml(item.comments || "No comments")}`
      ),
      "No Round 1 verdicts saved yet."
    );

    renderRows(
      judgeCodingVerdictList,
      latestCodingVerdicts.map(
        (item) =>
          `<strong>${escapeHtml(item.teamId)}</strong> | <span class="muted">${escapeHtml(item.verdict)}</span><br/>Judge: ${escapeHtml(item.judgeName || "Not specified")}<br/>${escapeHtml(item.comments || "No comments")}`
      ),
      "No Round 2 verdicts saved yet."
    );

    status("Judges portal synced.", "ok");
    queueNextRefresh(Boolean(quizData.activeSet || codingData.activeRound), false);
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("unauthorized")) {
      sessionStorage.removeItem("mindforge_judge_key");
      redirectToAccess();
      return;
    }
    status(error.message || "Unable to refresh judges dashboard.", "err");
    queueNextRefresh(Boolean(quizSetId || codingRoundId), true);
  } finally {
    refreshInFlight = false;
  }
}

judgeLogoutBtn?.addEventListener("click", () => {
  clearTimeout(refreshTimeout);
  sessionStorage.removeItem("mindforge_judge_key");
  redirectToAccess();
});

judgeQuizTeamSelect?.addEventListener("change", renderQuizReview);
judgeCodingTeamSelect?.addEventListener("change", renderCodingReview);
judgeQuizVerdictTeamSelect?.addEventListener("change", fillQuizVerdictForm);
judgeCodingVerdictTeamSelect?.addEventListener("change", fillCodingVerdictForm);
saveJudgeQuizVerdictBtn?.addEventListener("click", saveQuizVerdict);
saveJudgeCodingVerdictBtn?.addEventListener("click", saveCodingVerdict);

status("Judge session restored.", "ok");
refreshDashboard();
