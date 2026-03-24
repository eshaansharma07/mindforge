const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, requireAdminOrJudge } = require("./_lib/http");
const { remember, forget } = require("./_lib/runtime-cache");

const ADMIN_SHARED_CACHE_TTL_MS = 1500;
const ADMIN_ACTIVE_SET_CACHE_TTL_MS = 1000;
const ADMIN_RESULT_CACHE_TTL_MS = 1200;

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);
  if (!requireAdminOrJudge(req, res)) return;

  try {
    const db = await getDb();

    const [sharedState, activeSetFound, latestSetRaw] = await Promise.all([
      remember("admin-overview-shared", ADMIN_SHARED_CACHE_TTL_MS, async () => {
        const [teamsCount, latestTeams, latestAnnouncementsRaw, leaderboardState] = await Promise.all([
          db.collection("teams").countDocuments(),
          db.collection("teams")
            .find({}, { projection: { _id: 0, teamId: 1, teamName: 1, department: 1, createdAt: 1 } })
            .sort({ createdAt: -1 })
            .limit(8)
            .toArray(),
          db.collection("announcements").find({}).sort({ createdAt: -1 }).limit(8).toArray(),
          db.collection("leaderboard_state").findOne({ key: "public" })
        ]);

        return { teamsCount, latestTeams, latestAnnouncementsRaw, leaderboardState };
      }),
      remember("admin-overview-active-set", ADMIN_ACTIVE_SET_CACHE_TTL_MS, () =>
        db.collection("quiz_sets").findOne({ isActive: true })
      ),
      remember("admin-overview-latest-set", ADMIN_RESULT_CACHE_TTL_MS, () =>
        db.collection("quiz_sets").find({}).sort({ createdAt: -1 }).limit(1).next()
      )
    ]);

    let activeSetRaw = activeSetFound;
    if (activeSetRaw && new Date(activeSetRaw.endAt).getTime() <= Date.now()) {
      await db.collection("quiz_sets").updateOne(
        { _id: activeSetRaw._id },
        { $set: { isActive: false } }
      );
      forget("admin-overview-active-set");
      activeSetRaw = null;
    }

    const latestAnnouncements = (sharedState.latestAnnouncementsRaw || []).map((announcement) => ({
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
    let judgeVerdicts = [];

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
      const roundState = await remember(`admin-overview-round-state:${sourceSet.setId}`, ADMIN_RESULT_CACHE_TTL_MS, async () => {
        const [leaderboardRows, verdictRows] = await Promise.all([
          db
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
              }
            ])
            .toArray(),
          db.collection("judge_verdicts")
            .find(
              { roundType: "quiz", sourceId: sourceSet.setId },
              { projection: { _id: 0, teamId: 1, verdict: 1, judgeName: 1, comments: 1, updatedAt: 1 } }
            )
            .sort({ updatedAt: -1 })
            .toArray()
        ]);

        return { leaderboardRows, verdictRows };
      });

      leaderboard = roundState.leaderboardRows;
      judgeVerdicts = roundState.verdictRows;

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
      teamsCount: sharedState.teamsCount,
      latestTeams: sharedState.latestTeams,
      activeSet,
      sourceSetId: sourceSet ? sourceSet.setId : null,
      latestAnnouncements,
      leaderboard,
      leaderboardState: {
        isVisible: Boolean(sharedState.leaderboardState?.isVisible),
        isReset: Boolean(sharedState.leaderboardState?.isReset),
        entries: Array.isArray(sharedState.leaderboardState?.entries) ? sharedState.leaderboardState.entries : []
      },
      responseBreakdown,
      judgeVerdicts
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load admin overview" });
  }
};
