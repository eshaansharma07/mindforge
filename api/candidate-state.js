const { getDb } = require("./_lib/db");
const { send, methodNotAllowed } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);

  try {
    const teamId = String(req.query.teamId || "").trim().toUpperCase();
    if (!teamId) {
      return send(res, 400, { success: false, message: "teamId query is required." });
    }

    const db = await getDb();
    const team = await db.collection("teams").findOne(
      { teamId },
      {
        projection: {
          _id: 0,
          teamId: 1,
          teamName: 1,
          department: 1,
          leaderName: 1,
          member2Name: 1,
          member3Name: 1,
          domain: 1,
          createdAt: 1
        }
      }
    );

    if (!team) {
      return send(res, 404, { success: false, message: "Team not found." });
    }

    const announcements = await db
      .collection("announcements")
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray();

    const currentQuestion = await db.collection("quiz_questions").findOne(
      { isActive: true },
      { projection: { _id: 0, questionId: 1, text: 1, options: 1, startAt: 1, endAt: 1, isActive: 1 } }
    );

    let hasAnswered = false;
    if (currentQuestion) {
      const existing = await db.collection("quiz_responses").findOne({
        questionId: currentQuestion.questionId,
        teamId
      });
      hasAnswered = Boolean(existing);
    }

    return send(res, 200, {
      success: true,
      team,
      announcements,
      currentQuestion,
      hasAnswered,
      now: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load dashboard" });
  }
};
