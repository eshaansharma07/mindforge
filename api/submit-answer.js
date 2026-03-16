const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");
const { validateCandidateSession } = require("./_lib/candidate-session");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();
    const setId = String(data.setId || "").trim();
    const answers = Array.isArray(data.answers) ? data.answers : [];
    const sessionToken = String(data.sessionToken || "").trim();
    const submissionMode = String(data.submissionMode || "manual").trim().toLowerCase();

    if (!teamId || !setId || !sessionToken) {
      return send(res, 400, {
        success: false,
        message: "teamId, setId and sessionToken are required."
      });
    }

    const db = await getDb();
    const session = await validateCandidateSession(db, teamId, sessionToken);
    if (!session.ok) {
      return send(res, session.code, { success: false, message: session.message });
    }

    const [team, set] = await Promise.all([
      db.collection("teams").findOne({ teamId }),
      db.collection("quiz_sets").findOne({ setId, isActive: true })
    ]);

    if (!team) {
      return send(res, 404, { success: false, message: "Team not found." });
    }

    if (!set) {
      return send(res, 400, { success: false, message: "Question set not active." });
    }

    const now = Date.now();
    const endAt = new Date(set.endAt).getTime();
    const startAt = new Date(set.startAt).getTime();

    if (now > endAt) {
      return send(res, 400, { success: false, message: "Time is up for this round." });
    }

    const existing = await db.collection("quiz_responses").findOne({ setId, teamId });
    if (existing) {
      return send(res, 409, { success: false, message: "Answers already submitted." });
    }

    const answerMap = new Map();
    for (const item of answers) {
      const qid = String(item.questionId || "").trim();
      const selectedIndex = Number(item.selectedIndex);
      if (qid && Number.isInteger(selectedIndex)) {
        answerMap.set(qid, selectedIndex);
      }
    }

    const evaluatedAnswers = (set.questions || []).map((q) => {
      const selectedIndex = answerMap.has(q.questionId) ? answerMap.get(q.questionId) : -1;
      const isCorrect = selectedIndex === q.correctIndex;
      return {
        questionId: q.questionId,
        questionText: q.text,
        selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect
      };
    });

    const correctCount = evaluatedAnswers.filter((a) => a.isCorrect).length;
    const pointsPerCorrect = Number(set.pointsPerCorrect || 10);
    const points = correctCount * pointsPerCorrect;
    const elapsedMs = Math.max(0, now - startAt);

    await db.collection("quiz_responses").insertOne({
      setId,
      teamId,
      totalQuestions: evaluatedAnswers.length,
      correctCount,
      points,
      elapsedMs,
      submissionMode,
      answers: evaluatedAnswers,
      submittedAt: new Date()
    });

    return send(res, 200, {
      success: true,
      correctCount,
      totalQuestions: evaluatedAnswers.length,
      points,
      elapsedMs
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to submit answers" });
  }
};
