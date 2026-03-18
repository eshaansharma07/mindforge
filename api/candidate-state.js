const { getDb } = require("./_lib/db");
const { send, methodNotAllowed } = require("./_lib/http");
const { validateCandidateSession } = require("./_lib/candidate-session");
const { remember, forget } = require("./_lib/runtime-cache");

const TEAM_CACHE_TTL_MS = 30 * 1000;
const DASHBOARD_CACHE_TTL_MS = 1500;
const ACTIVE_SET_CACHE_TTL_MS = 1000;

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);

  try {
    const teamId = String(req.query.teamId || "").trim().toUpperCase();
    const sessionToken = String(req.headers["x-session-token"] || "").trim();
    if (!teamId) {
      return send(res, 400, { success: false, message: "teamId query is required." });
    }

    const db = await getDb();
    const session = await validateCandidateSession(db, teamId, sessionToken);
    if (!session.ok) {
      return send(res, session.code, { success: false, message: session.message });
    }

    const team = await remember(`team:${teamId}`, TEAM_CACHE_TTL_MS, () =>
      db.collection("teams").findOne(
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
            member4Name: 1,
            domain: 1,
            createdAt: 1
          }
        }
      )
    );

    if (!team) {
      forget(`team:${teamId}`);
      return send(res, 404, { success: false, message: "Team not found." });
    }

    const dashboardState = await remember("candidate-dashboard-state", DASHBOARD_CACHE_TTL_MS, async () => {
      const [announcements, leaderboardState] = await Promise.all([
        db
          .collection("announcements")
          .find({}, { projection: { _id: 0 } })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray(),
        db.collection("leaderboard_state").findOne({ key: "public" })
      ]);

      return {
        announcements,
        publicLeaderboard: {
          isVisible: Boolean(leaderboardState?.isVisible),
          entries: Array.isArray(leaderboardState?.entries) ? leaderboardState.entries : []
        }
      };
    });

    let activeSetRaw = await remember("active-quiz-set", ACTIVE_SET_CACHE_TTL_MS, () =>
      db.collection("quiz_sets").findOne({ isActive: true })
    );
    if (activeSetRaw && new Date(activeSetRaw.endAt).getTime() <= Date.now()) {
      await db.collection("quiz_sets").updateOne(
        { _id: activeSetRaw._id },
        { $set: { isActive: false } }
      );
      forget("active-quiz-set");
      activeSetRaw = null;
    }

    const activeSet = activeSetRaw
      ? {
          setId: activeSetRaw.setId,
          startAt: activeSetRaw.startAt,
          endAt: activeSetRaw.endAt,
          durationSec: activeSetRaw.durationSec,
          pointsPerCorrect: activeSetRaw.pointsPerCorrect,
          questions: (activeSetRaw.questions || []).map((q) => ({
            questionId: q.questionId,
            text: q.text,
            options: q.options
          }))
        }
      : null;

    let hasSubmitted = false;
    let submission = null;
    if (activeSet) {
      const existing = await db.collection("quiz_responses").findOne({
        setId: activeSet.setId,
        teamId
      });

      if (existing) {
        hasSubmitted = true;
        submission = {
          correctCount: existing.correctCount,
          points: existing.points,
          totalQuestions: existing.totalQuestions,
          elapsedMs: existing.elapsedMs
        };
      }
    }

    return send(res, 200, {
      success: true,
      team,
      announcements: dashboardState.announcements,
      activeSet,
      hasSubmitted,
      submission,
      publicLeaderboard: dashboardState.publicLeaderboard,
      now: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load dashboard" });
  }
};
