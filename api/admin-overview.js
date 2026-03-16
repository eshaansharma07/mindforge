const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const db = await getDb();

    const [teamsCount, latestTeams, activeSetRaw, latestSetRaw, latestAnnouncementsRaw, leaderboardState] = await Promise.all([
      db.collection("teams").countDocuments(),
      db.collection("teams")
        .find({}, { projection: { _id: 0, teamId: 1, teamName: 1, department: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray(),
      db.collection("quiz_sets").findOne({ isActive: true }),
      db.collection("quiz_sets").find({}).sort({ createdAt: -1 }).limit(1).next(),
      db.collection("announcements").find({}).sort({ createdAt: -1 }).limit(8).toArray(),
      db.collection("leaderboard_state").findOne({ key: "public" })
    ]);

    const latestAnnouncements = latestAnnouncementsRaw.map((announcement) => ({
      announcementId: String(announcement._id),
      title: announcement.title,
      body: announcement.body,
      type: announcement.type,
      createdAt: announcement.createdAt
    }));

    const sourceSet = activeSetRaw || latestSetRaw || null;

    let activeSet = null;
    let leaderboard = [];
    let responseBreakdown = [];

    if (activeSetRaw) {
      activeSet = {
        setId: activeSetRaw.setId,
        startAt: activeSetRaw.startAt,
        endAt: activeSetRaw.endAt,
        durationSec: activeSetRaw.durationSec,
        pointsPerCorrect: activeSetRaw.pointsPerCorrect,
        questionCount: (activeSetRaw.questions || []).length,
        questions: (activeSetRaw.questions || []).map((q) => ({
          questionId: q.questionId,
          text: q.text,
          options: q.options,
          correctIndex: q.correctIndex
        }))
      };

    }

    if (sourceSet) {
      leaderboard = await db
        .collection("quiz_responses")
        .aggregate([
          { $match: { setId: sourceSet.setId } },
          { $sort: { points: -1, elapsedMs: 1 } },
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
              points: 1,
              correctCount: 1,
              totalQuestions: 1,
              elapsedMs: 1,
              answers: 1,
              teamName: { $arrayElemAt: ["$team.teamName", 0] }
            }
          },
          { $limit: 20 }
        ])
        .toArray();

      responseBreakdown = leaderboard.map((row) => ({
        teamId: row.teamId,
        teamName: row.teamName,
        points: row.points,
        correctCount: row.correctCount,
        totalQuestions: row.totalQuestions,
        elapsedMs: row.elapsedMs,
        answers: (row.answers || []).map((a) => ({
          questionId: a.questionId,
          selectedIndex: a.selectedIndex,
          correctIndex: a.correctIndex,
          isCorrect: a.isCorrect
        }))
      }));
    }

    return send(res, 200, {
      success: true,
      teamsCount,
      latestTeams,
      activeSet,
      sourceSetId: sourceSet ? sourceSet.setId : null,
      latestAnnouncements,
      leaderboard,
      leaderboardState: {
        isVisible: Boolean(leaderboardState?.isVisible),
        isReset: Boolean(leaderboardState?.isReset),
        entries: Array.isArray(leaderboardState?.entries) ? leaderboardState.entries : []
      },
      responseBreakdown
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load admin overview" });
  }
};
