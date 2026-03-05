const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const db = await getDb();

    const [teamsCount, latestTeams, activeQuestion, latestAnnouncements] = await Promise.all([
      db.collection("teams").countDocuments(),
      db.collection("teams")
        .find({}, { projection: { _id: 0, teamId: 1, teamName: 1, department: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray(),
      db.collection("quiz_questions").findOne({ isActive: true }, { projection: { _id: 0, correctIndex: 0 } }),
      db.collection("announcements").find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(5).toArray()
    ]);

    let leaderboard = [];
    if (activeQuestion) {
      leaderboard = await db
        .collection("quiz_responses")
        .aggregate([
          { $match: { questionId: activeQuestion.questionId, isCorrect: true } },
          { $sort: { elapsedMs: 1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: "teams",
              localField: "teamId",
              foreignField: "teamId",
              as: "team"
            }
          },
          {
            $project: {
              _id: 0,
              teamId: 1,
              elapsedMs: 1,
              teamName: { $arrayElemAt: ["$team.teamName", 0] }
            }
          }
        ])
        .toArray();
    }

    return send(res, 200, {
      success: true,
      teamsCount,
      latestTeams,
      activeQuestion,
      latestAnnouncements,
      leaderboard
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load admin overview" });
  }
};
