const loginForm = document.getElementById("candidateLoginForm");
const loginStatus = document.getElementById("loginStatus");
const teamBox = document.getElementById("teamBox");
const announcementBox = document.getElementById("announcementBox");
const questionText = document.getElementById("questionText");
const optionsBox = document.getElementById("optionsBox");
const answerStatus = document.getElementById("answerStatus");
const countdownEl = document.getElementById("countdown");
const submitSetBtn = document.getElementById("submitSetBtn");

let activeTeamId = localStorage.getItem("mindforge_team_id") || "";
let activeSetId = null;
let selectedAnswers = {};
let renderedSetId = null;
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
      submitSetBtn.style.display = "none";
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

async function submitAllAnswers() {
  if (!activeTeamId || !activeSetId) return;

  const answers = Object.entries(selectedAnswers).map(([questionId, selectedIndex]) => ({
    questionId,
    selectedIndex
  }));

  if (answers.length === 0) {
    setStatus(answerStatus, "Select at least one answer before submitting.", "err");
    return;
  }

  try {
    const response = await fetch("/api/submit-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: activeTeamId,
        setId: activeSetId,
        answers
      })
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Submission failed.");
    }

    setStatus(
      answerStatus,
      `Submitted. Correct: ${result.correctCount}/${result.totalQuestions} | Points: ${result.points} | Time: ${Math.round(result.elapsedMs / 1000)}s`,
      "ok"
    );

    submitSetBtn.style.display = "none";
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

    const set = result.activeSet;
    if (!set) {
      activeSetId = null;
      renderedSetId = null;
      selectedAnswers = {};
      questionText.textContent = "No active question set yet.";
      questionText.className = "item muted";
      optionsBox.innerHTML = "";
      countdownEl.textContent = "--";
      submitSetBtn.style.display = "none";
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
        `Already submitted. Correct: ${s.correctCount}/${s.totalQuestions} | Points: ${s.points} | Time: ${Math.round(s.elapsedMs / 1000)}s`,
        "ok"
      );
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
  } catch (error) {
    setStatus(loginStatus, error.message || "Failed to load state.", "err");
  }
}

submitSetBtn?.addEventListener("click", submitAllAnswers);

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
