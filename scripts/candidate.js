const loginForm = document.getElementById("candidateLoginForm");
const loginStatus = document.getElementById("loginStatus");
const teamBox = document.getElementById("teamBox");
const announcementBox = document.getElementById("announcementBox");
const questionText = document.getElementById("questionText");
const optionsBox = document.getElementById("optionsBox");
const answerStatus = document.getElementById("answerStatus");
const countdownEl = document.getElementById("countdown");

let activeTeamId = localStorage.getItem("mindforge_team_id") || "";
let currentQuestionId = null;
let timer;

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

function startCountdown(endAt) {
  clearInterval(timer);
  const end = new Date(endAt).getTime();

  const tick = () => {
    const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    countdownEl.textContent = `${left}s`;
    if (left <= 0) {
      clearInterval(timer);
      countdownEl.textContent = "0s";
    }
  };

  tick();
  timer = setInterval(tick, 500);
}

async function submitAnswer(selectedIndex) {
  if (!activeTeamId || !currentQuestionId) return;

  try {
    const response = await fetch("/api/submit-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: activeTeamId,
        questionId: currentQuestionId,
        selectedIndex
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Submission failed.");
    }

    const tag = result.isCorrect ? "Correct" : "Submitted";
    setStatus(answerStatus, `${tag}. Response time: ${Math.round(result.elapsedMs / 1000)}s`, "ok");
    optionsBox.innerHTML = "";
    await loadState();
  } catch (error) {
    setStatus(answerStatus, error.message || "Could not submit.", "err");
  }
}

async function loadState() {
  if (!activeTeamId) return;

  try {
    const response = await fetch(`/api/candidate-state?teamId=${encodeURIComponent(activeTeamId)}`);
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
        `Members: ${team.leaderName}, ${team.member2Name}${team.member3Name ? `, ${team.member3Name}` : ""}`,
        `Domain: ${team.domain || "Not selected"}`
      ],
      "No team data"
    );

    renderList(
      announcementBox,
      result.announcements.map((a) => `<strong>${a.title}</strong><br/>${a.body}`),
      "No announcements yet"
    );

    const q = result.currentQuestion;
    if (!q) {
      currentQuestionId = null;
      questionText.textContent = "No active question yet.";
      questionText.className = "item muted";
      optionsBox.innerHTML = "";
      countdownEl.textContent = "--";
      return;
    }

    currentQuestionId = q.questionId;
    questionText.textContent = q.text;
    questionText.className = "item";
    startCountdown(q.endAt);

    if (result.hasAnswered) {
      optionsBox.innerHTML = "";
      setStatus(answerStatus, "Answer already submitted for this question.", "ok");
      return;
    }

    optionsBox.innerHTML = "";
    q.options.forEach((option, idx) => {
      const btn = document.createElement("button");
      btn.className = "opt";
      btn.type = "button";
      btn.textContent = `${String.fromCharCode(65 + idx)}. ${option}`;
      btn.addEventListener("click", () => submitAnswer(idx));
      optionsBox.appendChild(btn);
    });
  } catch (error) {
    setStatus(loginStatus, error.message || "Failed to load state.", "err");
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(loginForm).entries());
  data.teamId = String(data.teamId || "").trim().toUpperCase();

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
    localStorage.setItem("mindforge_team_id", activeTeamId);
    setStatus(loginStatus, "Dashboard connected.", "ok");
    await loadState();
  } catch (error) {
    setStatus(loginStatus, error.message || "Login failed.", "err");
  }
});

if (activeTeamId) {
  setStatus(loginStatus, `Auto-connected with ${activeTeamId}`, "ok");
  loadState();
}

setInterval(loadState, 3000);
