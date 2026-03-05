const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();
    const questionId = String(data.questionId || "").trim();
    const selectedIndex = Number(data.selectedIndex);

    if (!teamId || !questionId || !Number.isInteger(selectedIndex)) {
      return send(res, 400, { success: false, message: "teamId, questionId and selectedIndex are required." });
    }

    const db = await getDb();
    const [team, question] = await Promise.all([
      db.collection("teams").findOne({ teamId }),
      db.collection("quiz_questions").findOne({ questionId, isActive: true })
    ]);

    if (!team) {
      return send(res, 404, { success: false, message: "Team not found." });
    }

    if (!question) {
      return send(res, 400, { success: false, message: "Question not active." });
    }

    const now = Date.now();
    const endAt = new Date(question.endAt).getTime();
    const startAt = new Date(question.startAt).getTime();

    if (now > endAt) {
      return send(res, 400, { success: false, message: "Time is up for this question." });
    }

    const existing = await db.collection("quiz_responses").findOne({ questionId, teamId });
    if (existing) {
      return send(res, 409, { success: false, message: "Answer already submitted." });
    }

    const elapsedMs = Math.max(0, now - startAt);
    const isCorrect = selectedIndex === question.correctIndex;

    await db.collection("quiz_responses").insertOne({
      teamId,
      questionId,
      selectedIndex,
      isCorrect,
      elapsedMs,
      submittedAt: new Date()
    });

    return send(res, 200, {
      success: true,
      isCorrect,
      elapsedMs
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to submit answer" });
  }
};
