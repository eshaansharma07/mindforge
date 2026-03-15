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
          member4Name: 1,
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

    const activeSetRaw = await db.collection("quiz_sets").findOne({ isActive: true });
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
      announcements,
      activeSet,
      hasSubmitted,
      submission,
      now: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load dashboard" });
  }
};
