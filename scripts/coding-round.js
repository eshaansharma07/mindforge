const loginForm = document.getElementById("codingLoginForm");
const loginStatus = document.getElementById("codingLoginStatus");
const logoutBtn = document.getElementById("codingLogoutBtn");
const teamBox = document.getElementById("codingTeamBox");
const announcementBox = document.getElementById("codingAnnouncementBox");
const leaderboardBox = document.getElementById("codingLeaderboardBox");
const problemHeader = document.getElementById("codingProblemHeader");
const problemBody = document.getElementById("codingProblemBody");
const countdownEl = document.getElementById("codingCountdown");
const submitBtn = document.getElementById("codingSubmitBtn");
const answerStatus = document.getElementById("codingAnswerStatus");

let activeTeamId = localStorage.getItem("mindforge_coding_team_id") || "";
let activeSessionToken = localStorage.getItem("mindforge_coding_session_token") || "";
let activeRoundId = null;
let renderedRoundId = null;
let timer;
let autoSubmitting = false;
let stateRequestInFlight = false;
let pollTimeout = null;
let codeDraft = "";
let caseAnswers = {};

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 4500;
const ERROR_POLL_MS = 8000;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nextPollDelay(hasActiveRound, hadError = false) {
  const base = hadError ? ERROR_POLL_MS : hasActiveRound ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  return base + Math.floor(Math.random() * 700);
}

function queueNextLoad(hasActiveRound = Boolean(activeRoundId), hadError = false) {
  clearTimeout(pollTimeout);
  pollTimeout = setTimeout(() => {
    loadState();
  }, nextPollDelay(hasActiveRound, hadError));
}

function getOrCreateSessionToken() {
  if (activeSessionToken) return activeSessionToken;
  activeSessionToken =
    (window.crypto && typeof window.crypto.randomUUID === "function" && window.crypto.randomUUID()) ||
    `coding-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("mindforge_coding_session_token", activeSessionToken);
  return activeSessionToken;
}

function setStatus(el, msg, type = "") {
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${type}`.trim();
}

function clearAccess() {
  activeTeamId = "";
  activeSessionToken = "";
  activeRoundId = null;
  renderedRoundId = null;
  codeDraft = "";
  caseAnswers = {};
  clearInterval(timer);
  clearTimeout(pollTimeout);
  localStorage.removeItem("mindforge_coding_team_id");
  localStorage.removeItem("mindforge_coding_session_token");
  if (loginForm) loginForm.reset();
  teamBox.innerHTML = "";
  announcementBox.innerHTML = "";
  leaderboardBox.innerHTML = "";
  problemBody.innerHTML = "";
  problemHeader.textContent = "No active coding round yet.";
  problemHeader.className = "item muted";
  countdownEl.textContent = "--";
  submitBtn.style.display = "none";
  answerStatus.textContent = "";
  answerStatus.className = "status";
}

function renderList(container, rows, emptyText) {
  container.innerHTML = "";
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="item muted">${emptyText}</div>`;
    return;
  }

  rows.forEach((row) => {
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = row;
    container.appendChild(card);
  });
}

function renderCodingLeaderboard(entries) {
  leaderboardBox.innerHTML = "";
  if (!entries || entries.length === 0) {
    leaderboardBox.innerHTML = `<div class="item muted">Coding leaderboard will appear here when published by the controller.</div>`;
    return;
  }

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "leaderboard-row";
    row.innerHTML = `
      <div class="leaderboard-row-rank">#${index + 1}</div>
      <div class="leaderboard-row-main">
        <div class="leaderboard-row-name">${entry.teamName || entry.teamId}</div>
        <div class="leaderboard-row-id">${entry.teamId}</div>
      </div>
      <div class="leaderboard-row-points">${entry.points} pts</div>
      <div class="leaderboard-row-extra">${entry.correctCount}/${entry.totalCases} • ${Math.round(entry.elapsedMs / 1000)}s</div>
    `;
    leaderboardBox.appendChild(row);
  });
}

function startCountdown(endAt) {
  clearInterval(timer);
  const end = new Date(endAt).getTime();

  const tick = () => {
    const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    countdownEl.textContent = `${left}s`;
    if (left <= 0) {
      clearInterval(timer);
      countdownEl.textContent = "0s";
      submitBtn.style.display = "none";
      if (activeRoundId && activeSessionToken && !autoSubmitting) {
        autoSubmitting = true;
        submitCodingRound({ force: true, auto: true, reason: "timer_end" }).finally(() => {
          autoSubmitting = false;
        });
      }
    }
  };

  tick();
  timer = setInterval(tick, 400);
}

function attachEditorState() {
  const codeInput = document.getElementById("codingCodeInput");
  codeInput?.addEventListener("input", () => {
    codeDraft = codeInput.value;
  });

  problemBody.querySelectorAll("[data-case-id]").forEach((field) => {
    field.addEventListener("input", () => {
      caseAnswers[field.getAttribute("data-case-id")] = field.value;
    });
  });
}

function renderRound(round) {
  problemBody.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "coding-round-layout";
  shell.innerHTML = `
    <article class="coding-card">
      <div class="coding-block-label">Problem</div>
      <h3>${round.title}</h3>
      <p class="muted">${round.subtitle || "Round 2 | Sudden Coding"}</p>
      <div class="coding-block">
      <div class="coding-block-label">Instructions</div>
        <pre class="code-preview">${escapeHtml(round.instructions || "Solve the problem, fill testcase outputs, and submit before time ends.")}</pre>
      </div>
      <div class="coding-block">
        <div class="coding-block-label">Statement</div>
        <pre class="code-preview">${escapeHtml(round.problemStatement || "")}</pre>
      </div>
      <div class="coding-block-grid">
        <div class="coding-block">
          <div class="coding-block-label">Constraints</div>
          <pre class="code-preview">${escapeHtml(round.constraints || "No extra constraints provided.")}</pre>
        </div>
        <div class="coding-block">
          <div class="coding-block-label">Input Format</div>
          <pre class="code-preview">${escapeHtml(round.inputFormat || "No input format provided.")}</pre>
        </div>
      </div>
      <div class="coding-block-grid">
        <div class="coding-block">
          <div class="coding-block-label">Output Format</div>
          <pre class="code-preview">${escapeHtml(round.outputFormat || "No output format provided.")}</pre>
        </div>
        <div class="coding-block">
          <div class="coding-block-label">Sample</div>
          <pre class="code-preview">Input\n${escapeHtml(round.sampleInput || "-")}\n\nOutput\n${escapeHtml(round.sampleOutput || "-")}</pre>
        </div>
      </div>
    </article>
    <article class="coding-card">
      <div class="coding-block-label">Code Submission</div>
      <textarea id="codingCodeInput" class="code-editor" placeholder="Paste or write your solution here...">${escapeHtml(codeDraft)}</textarea>
      <div class="coding-block-label" style="margin-top:18px;">Test Case Outputs</div>
      <div class="coding-cases" id="codingCasesWrap"></div>
    </article>
  `;

  problemBody.appendChild(shell);

  const casesWrap = document.getElementById("codingCasesWrap");
  (round.testCases || []).forEach((testCase) => {
    const card = document.createElement("div");
    card.className = "coding-case-card";
    card.innerHTML = `
      <div class="coding-case-header">
        <strong>${testCase.label}</strong>
        <span>${testCase.points} pts</span>
      </div>
      <div class="coding-block-label">Input</div>
      <pre class="code-preview">${escapeHtml(testCase.input || "")}</pre>
      <div class="coding-block-label">Your Output</div>
      <textarea class="input testcase-output" data-case-id="${testCase.caseId}" placeholder="Write the exact expected output here...">${escapeHtml(caseAnswers[testCase.caseId] || "")}</textarea>
    `;
    casesWrap.appendChild(card);
  });

  attachEditorState();
}

async function submitCodingRound({ force = false, auto = false, reason = "" } = {}) {
  if (!activeTeamId || !activeRoundId || !activeSessionToken) return;

  const answers = Object.entries(caseAnswers).map(([caseId, output]) => ({ caseId, output }));
  if (!force && !codeDraft.trim() && answers.filter((item) => String(item.output || "").trim()).length === 0) {
    setStatus(answerStatus, "Write code or fill at least one testcase output before submitting.", "err");
    return;
  }

  try {
    const response = await fetch("/api/coding-submit", {
      method: "POST",
      keepalive: auto,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: activeTeamId,
        roundId: activeRoundId,
        code: codeDraft,
        answers,
        sessionToken: activeSessionToken,
        submissionMode: reason || (auto ? "tab_switch" : "manual")
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Coding round submission failed.");
    }

    setStatus(
      answerStatus,
      auto
        ? "Auto-submitted successfully."
        : "Submitted successfully.",
      "ok"
    );
    submitBtn.style.display = "none";
    await loadState();
  } catch (error) {
    setStatus(answerStatus, error.message || "Could not submit coding round.", "err");
  }
}

async function loadState() {
  if (!activeTeamId || !activeSessionToken || stateRequestInFlight) return;
  stateRequestInFlight = true;

  try {
    const response = await fetch(`/api/coding-state?teamId=${encodeURIComponent(activeTeamId)}`, {
      headers: { "x-session-token": activeSessionToken }
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to load coding round.");
    }

    const team = result.team;
    renderList(
      teamBox,
      [
        `<strong>${team.teamName}</strong> (${team.teamId})`,
        `Department: ${team.department}`,
        `Members: ${[team.leaderName, team.member2Name, team.member3Name, team.member4Name].filter(Boolean).join(", ")}`,
        `Domain: ${team.domain || "Not selected"}`
      ],
      "No team data"
    );

    renderList(
      announcementBox,
      (result.announcements || []).map((item) => `<strong>${item.title}</strong><br/>${item.body}`),
      "No announcements yet"
    );

    if (result.publicLeaderboard?.isVisible && (result.publicLeaderboard.entries || []).length > 0) {
      renderCodingLeaderboard(result.publicLeaderboard.entries);
    } else {
      renderCodingLeaderboard([]);
    }

    const round = result.activeRound;
    if (!round) {
      if (activeRoundId && activeSessionToken && !result.hasSubmitted && !autoSubmitting) {
        autoSubmitting = true;
        try {
          await submitCodingRound({ force: true, auto: true, reason: "timer_end" });
          queueNextLoad(false, false);
          return;
        } finally {
          autoSubmitting = false;
        }
      }
      activeRoundId = null;
      renderedRoundId = null;
      codeDraft = "";
      caseAnswers = {};
      problemHeader.textContent = "No active coding round yet.";
      problemHeader.className = "item muted";
      problemBody.innerHTML = "";
      countdownEl.textContent = "--";
      submitBtn.style.display = "none";
      queueNextLoad(false, false);
      return;
    }

    activeRoundId = round.roundId;
    problemHeader.innerHTML = `<strong>${round.title}</strong> | ${round.testCases.length} test cases | ${round.durationSec}s`;
    problemHeader.className = "item";
    startCountdown(round.endAt);

    if (result.hasSubmitted) {
      problemBody.innerHTML = "";
      renderedRoundId = null;
      submitBtn.style.display = "none";
      setStatus(
        answerStatus,
        "You have already submitted your coding round response. Please wait for further updates from the controller.",
        "ok"
      );
      queueNextLoad(true, false);
      return;
    }

    if (renderedRoundId !== round.roundId || problemBody.children.length === 0) {
      if (renderedRoundId !== round.roundId) {
        codeDraft = "";
        caseAnswers = {};
      }
      renderRound(round);
      renderedRoundId = round.roundId;
    }

    submitBtn.style.display = "inline-block";
    setStatus(answerStatus, "Solve the problem, fill testcase outputs, and submit before time ends.", "");
    queueNextLoad(true, false);
  } catch (error) {
    const message = error.message || "Failed to load coding round.";
    if (
      message.includes("already logged in") ||
      message.includes("session expired") ||
      message.includes("session is required")
    ) {
      clearAccess();
      return;
    }
    setStatus(loginStatus, message, "err");
    queueNextLoad(Boolean(activeRoundId), true);
  } finally {
    stateRequestInFlight = false;
  }
}

async function logoutCoding({ silent = false, useBeacon = false } = {}) {
  if (!activeTeamId || !activeSessionToken) {
    clearAccess();
    return;
  }

  const payload = JSON.stringify({
    teamId: activeTeamId,
    sessionToken: activeSessionToken,
    scope: "coding"
  });

  try {
    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/candidate-logout", blob);
    } else {
      await fetch("/api/candidate-logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      });
    }
  } catch (_error) {
    // best effort
  }

  clearAccess();
  if (!silent) {
    setStatus(loginStatus, "Round 2 session closed.", "ok");
  }
}

submitBtn?.addEventListener("click", () => submitCodingRound());
logoutBtn?.addEventListener("click", () => logoutCoding());

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm).entries());
  data.teamId = String(data.teamId || "").trim().toUpperCase();
  data.sessionToken = getOrCreateSessionToken();
  setStatus(loginStatus, "Verifying team for Round 2...", "");

  try {
    const response = await fetch("/api/coding-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Round 2 login failed.");
    }

    activeTeamId = result.teamId;
    activeSessionToken = result.sessionToken;
    localStorage.setItem("mindforge_coding_team_id", activeTeamId);
    localStorage.setItem("mindforge_coding_session_token", activeSessionToken);
    setStatus(loginStatus, "Coding round portal connected.", "ok");
    await loadState();
  } catch (error) {
    setStatus(loginStatus, error.message || "Round 2 login failed.", "err");
  }
});

if (activeTeamId && activeSessionToken) {
  setStatus(loginStatus, `Auto-connected with ${activeTeamId}`, "ok");
  loadState();
} else if (activeTeamId || activeSessionToken) {
  clearAccess();
}
