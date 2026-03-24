const loginForm = document.getElementById("candidateLoginForm");
const loginStatus = document.getElementById("loginStatus");
const teamBox = document.getElementById("teamBox");
const announcementBox = document.getElementById("announcementBox");
const leaderboardPublicBox = document.getElementById("leaderboardPublicBox");
const questionText = document.getElementById("questionText");
const optionsBox = document.getElementById("optionsBox");
const answerStatus = document.getElementById("answerStatus");
const countdownEl = document.getElementById("countdown");
const submitSetBtn = document.getElementById("submitSetBtn");
const logoutBtn = document.getElementById("logoutBtn");

let activeTeamId = localStorage.getItem("mindforge_team_id") || "";
let activeSessionToken = localStorage.getItem("mindforge_session_token") || "";
let activeSetId = null;
let selectedAnswers = {};
let renderedSetId = null;
let timer;
let autoSubmitting = false;
let stateRequestInFlight = false;
let pollTimeout = null;

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 4000;
const ERROR_POLL_MS = 8000;

function nextPollDelay(hasActiveSet, hadError = false) {
  const base = hadError ? ERROR_POLL_MS : hasActiveSet ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  return base + Math.floor(Math.random() * 700);
}

function queueNextLoad(hasActiveSet = Boolean(activeSetId), hadError = false) {
  clearTimeout(pollTimeout);
  pollTimeout = setTimeout(() => {
    loadState();
  }, nextPollDelay(hasActiveSet, hadError));
}

function getOrCreateSessionToken() {
  if (activeSessionToken) return activeSessionToken;
  activeSessionToken =
    (window.crypto && typeof window.crypto.randomUUID === "function" && window.crypto.randomUUID()) ||
    `mf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("mindforge_session_token", activeSessionToken);
  return activeSessionToken;
}

function clearCandidateAccess() {
  activeTeamId = "";
  activeSessionToken = "";
  activeSetId = null;
  renderedSetId = null;
  selectedAnswers = {};
  clearInterval(timer);
  clearTimeout(pollTimeout);
  localStorage.removeItem("mindforge_team_id");
  localStorage.removeItem("mindforge_session_token");
  if (loginForm) loginForm.reset();
  teamBox.innerHTML = "";
  announcementBox.innerHTML = "";
  leaderboardPublicBox.innerHTML = "";
  optionsBox.innerHTML = "";
  questionText.textContent = "No active question set yet.";
  questionText.className = "item muted";
  countdownEl.textContent = "--";
  submitSetBtn.style.display = "none";
  answerStatus.textContent = "";
  answerStatus.className = "status";
}

function setStatus(el, msg, type = "") {
  el.textContent = msg;
  el.className = `status ${type}`.trim();
}

function renderList(container, rows, emptyText) {
  container.innerHTML = "";
  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="item muted">${emptyText}</div>`;
    return;
  }
  rows.forEach((row) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = row;
    container.appendChild(div);
  });
}

function renderPublicLeaderboard(entries) {
  leaderboardPublicBox.innerHTML = "";

  if (!entries || entries.length === 0) {
    leaderboardPublicBox.innerHTML =
      `<div class="item muted">Leaderboard will appear here when published by the controller.</div>`;
    return;
  }

  const topThree = entries.slice(0, 3);
  const others = entries.slice(3);

  const podium = document.createElement("div");
  podium.className = "leaderboard-podium";

  const podiumOrder = [
    topThree[1] ? { entry: topThree[1], rank: 2, tone: "silver", medal: "🥈" } : null,
    topThree[0] ? { entry: topThree[0], rank: 1, tone: "gold", medal: "🥇" } : null,
    topThree[2] ? { entry: topThree[2], rank: 3, tone: "bronze", medal: "🥉" } : null
  ].filter(Boolean);

  podiumOrder.forEach(({ entry, rank, tone, medal }) => {
    const card = document.createElement("article");
    card.className = `podium-card podium-${tone}`;
    card.innerHTML = `
      <div class="podium-rank">#${rank}</div>
      <div class="podium-medal" aria-hidden="true">${medal}</div>
      <div class="podium-team">${entry.teamName || entry.teamId}</div>
      <div class="podium-id">${entry.teamId}</div>
      <div class="podium-score">${entry.points}</div>
      <div class="podium-meta">Points</div>
      <div class="podium-stats">Correct ${entry.correctCount}/${entry.totalQuestions} • ${Math.round(entry.elapsedMs / 1000)}s</div>
    `;
    podium.appendChild(card);
  });

  leaderboardPublicBox.appendChild(podium);

  if (others.length > 0) {
    const list = document.createElement("div");
    list.className = "leaderboard-table";

    others.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";
      row.innerHTML = `
        <div class="leaderboard-row-rank">#${index + 4}</div>
        <div class="leaderboard-row-main">
          <div class="leaderboard-row-name">${entry.teamName || entry.teamId}</div>
          <div class="leaderboard-row-id">${entry.teamId}</div>
        </div>
        <div class="leaderboard-row-points">${entry.points} pts</div>
        <div class="leaderboard-row-extra">${entry.correctCount}/${entry.totalQuestions} • ${Math.round(entry.elapsedMs / 1000)}s</div>
      `;
      list.appendChild(row);
    });

    leaderboardPublicBox.appendChild(list);
  }
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
      submitSetBtn.style.display = "none";
      if (activeSetId && activeSessionToken && !autoSubmitting) {
        autoSubmitting = true;
        submitAllAnswers({ force: true, auto: true, reason: "timer_end" }).finally(() => {
          autoSubmitting = false;
        });
      }
    }
  };

  tick();
  timer = setInterval(tick, 400);
}

function renderQuestionSet(set) {
  optionsBox.innerHTML = "";

  (set.questions || []).forEach((q, index) => {
    const wrap = document.createElement("div");
    wrap.className = "item";

    const title = document.createElement("div");
    title.innerHTML = `<strong>Q${index + 1}.</strong> ${q.text}`;
    title.style.marginBottom = "10px";
    wrap.appendChild(title);

    const choices = document.createElement("div");
    choices.className = "options";

    q.options.forEach((option, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt";
      btn.textContent = `${String.fromCharCode(65 + idx)}. ${option}`;

      btn.addEventListener("click", () => {
        selectedAnswers[q.questionId] = idx;

        const siblings = choices.querySelectorAll("button");
        siblings.forEach((s) => {
          s.style.borderColor = "rgba(63, 126, 188, 0.55)";
          s.style.boxShadow = "none";
        });

        btn.style.borderColor = "rgba(37, 232, 255, 0.88)";
        btn.style.boxShadow = "0 0 14px rgba(40, 228, 255, 0.22)";
      });

      if (selectedAnswers[q.questionId] === idx) {
        btn.style.borderColor = "rgba(37, 232, 255, 0.88)";
        btn.style.boxShadow = "0 0 14px rgba(40, 228, 255, 0.22)";
      }

      choices.appendChild(btn);
    });

    wrap.appendChild(choices);
    optionsBox.appendChild(wrap);
  });
}

async function submitAllAnswers({ force = false, auto = false, reason = "" } = {}) {
  if (!activeTeamId || !activeSetId || !activeSessionToken) return;

  const answers = Object.entries(selectedAnswers).map(([questionId, selectedIndex]) => ({
    questionId,
    selectedIndex
  }));

  if (answers.length === 0 && !force) {
    setStatus(answerStatus, "Select at least one answer before submitting.", "err");
    return;
  }

  try {
    const response = await fetch("/api/submit-answer", {
      method: "POST",
      keepalive: auto,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: activeTeamId,
        setId: activeSetId,
        answers,
        sessionToken: activeSessionToken,
        submissionMode: reason || (auto ? "tab_switch" : "manual")
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Submission failed.");
    }

    setStatus(
      answerStatus,
      auto
        ? "Auto-submitted successfully."
        : "Submitted successfully.",
      "ok"
    );

    submitSetBtn.style.display = "none";
    await loadState();
  } catch (error) {
    setStatus(answerStatus, error.message || "Could not submit.", "err");
  }
}

async function loadState() {
  if (!activeTeamId || !activeSessionToken) return;
  if (stateRequestInFlight) return;

  stateRequestInFlight = true;

  try {
    const response = await fetch(`/api/candidate-state?teamId=${encodeURIComponent(activeTeamId)}`, {
      headers: {
        "x-session-token": activeSessionToken
      }
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to load dashboard.");
    }

    const team = result.team;
    renderList(
      teamBox,
      [
        `<strong>${team.teamName}</strong> (${team.teamId})`,
        `Department: ${team.department}`,
        `Members: ${[
          team.leaderName,
          team.member2Name,
          team.member3Name,
          team.member4Name
        ].filter(Boolean).join(", ")}`,
        `Domain: ${team.domain || "Not selected"}`
      ],
      "No team data"
    );

    renderList(
      announcementBox,
      result.announcements.map((a) => `<strong>${a.title}</strong><br/>${a.body}`),
      "No announcements yet"
    );

    const publicLeaderboard = result.publicLeaderboard;
    if (publicLeaderboard?.isVisible && (publicLeaderboard.entries || []).length > 0) {
      renderPublicLeaderboard(publicLeaderboard.entries);
    } else {
      renderPublicLeaderboard([]);
    }

    const set = result.activeSet;
    if (!set) {
      if (activeSetId && activeSessionToken && !result.hasSubmitted && !autoSubmitting) {
        autoSubmitting = true;
        try {
          await submitAllAnswers({ force: true, auto: true, reason: "timer_end" });
          queueNextLoad(false, false);
          return;
        } finally {
          autoSubmitting = false;
        }
      }
      activeSetId = null;
      renderedSetId = null;
      selectedAnswers = {};
      questionText.textContent = "No active question set yet.";
      questionText.className = "item muted";
      optionsBox.innerHTML = "";
      countdownEl.textContent = "--";
      submitSetBtn.style.display = "none";
      queueNextLoad(false, false);
      return;
    }

    activeSetId = set.setId;
    questionText.innerHTML = `<strong>Set ${set.setId}</strong> | ${set.questions.length} questions | ${set.durationSec}s total`;
    questionText.className = "item";
    startCountdown(set.endAt);

    if (result.hasSubmitted) {
      optionsBox.innerHTML = "";
      renderedSetId = null;
      submitSetBtn.style.display = "none";
      const s = result.submission;
      setStatus(
        answerStatus,
        "You have already submitted your answers. Please wait for further updates from the controller.",
        "ok"
      );
      queueNextLoad(true, false);
      return;
    }

    const shouldRenderSet = renderedSetId !== set.setId || optionsBox.children.length === 0;
    if (shouldRenderSet) {
      if (renderedSetId !== set.setId) {
        selectedAnswers = {};
      }
      renderQuestionSet(set);
      renderedSetId = set.setId;
    }
    submitSetBtn.style.display = "inline-block";
    setStatus(answerStatus, "Select answers for all questions and click Submit All Answers.", "");
    queueNextLoad(true, false);
  } catch (error) {
    const message = error.message || "Failed to load state.";
    if (
      message.includes("already logged in on another device") ||
      message.includes("session expired") ||
      message.includes("session is required")
    ) {
      clearCandidateAccess();
      return;
    }
    setStatus(loginStatus, message, "err");
    queueNextLoad(Boolean(activeSetId), true);
  } finally {
    stateRequestInFlight = false;
  }
}

async function logoutCandidate({ silent = false, useBeacon = false } = {}) {
  if (!activeTeamId || !activeSessionToken) {
    clearCandidateAccess();
    return;
  }

  const payload = JSON.stringify({
    teamId: activeTeamId,
    sessionToken: activeSessionToken
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
    // Best effort logout keeps teams from being stuck if the request fails.
  }

  clearCandidateAccess();
  if (!silent) {
    setStatus(loginStatus, "Team logged out.", "ok");
  }
}

submitSetBtn?.addEventListener("click", () => submitAllAnswers());
logoutBtn?.addEventListener("click", () => logoutCandidate());

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm).entries());
  data.teamId = String(data.teamId || "").trim().toUpperCase();
  data.sessionToken = getOrCreateSessionToken();

  setStatus(loginStatus, "Verifying team...", "");

  try {
    const response = await fetch("/api/candidate-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Login failed.");
    }

    activeTeamId = result.teamId;
    activeSessionToken = result.sessionToken;
    localStorage.setItem("mindforge_team_id", activeTeamId);
    localStorage.setItem("mindforge_session_token", activeSessionToken);
    setStatus(loginStatus, "Dashboard connected.", "ok");
    await loadState();
  } catch (error) {
    setStatus(loginStatus, error.message || "Login failed.", "err");
  }
});

if (activeTeamId && activeSessionToken) {
  setStatus(loginStatus, `Auto-connected with ${activeTeamId}`, "ok");
  loadState();
} else if (activeTeamId || activeSessionToken) {
  clearCandidateAccess();
}

document.addEventListener("visibilitychange", () => {
  if (
    document.hidden &&
    activeSetId &&
    activeSessionToken &&
    submitSetBtn?.style.display !== "none" &&
    !autoSubmitting
  ) {
    autoSubmitting = true;
    submitAllAnswers({ force: true, auto: true, reason: "tab_switch" }).finally(() => {
      autoSubmitting = false;
    });
  }
});
