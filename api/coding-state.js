const { getDb } = require("./_lib/db");
const { send, methodNotAllowed } = require("./_lib/http");
const { validateCandidateSession } = require("./_lib/candidate-session");
const { remember, forget } = require("./_lib/runtime-cache");

const TEAM_CACHE_TTL_MS = 30 * 1000;
const SHARED_CACHE_TTL_MS = 1500;
const ACTIVE_ROUND_CACHE_TTL_MS = 1000;

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);

  try {
    const teamId = String(req.query.teamId || "").trim().toUpperCase();
    const sessionToken = String(req.headers["x-session-token"] || "").trim();

    if (!teamId) {
      return send(res, 400, { success: false, message: "teamId query is required." });
    }

    const db = await getDb();
    const session = await validateCandidateSession(db, teamId, sessionToken, "coding");
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
            domain: 1
          }
        }
      )
    );

    if (!team) {
      forget(`team:${teamId}`);
      return send(res, 404, { success: false, message: "Team not found." });
    }

    const sharedState = await remember("coding-shared-state", SHARED_CACHE_TTL_MS, async () => {
      const [announcements, leaderboardState] = await Promise.all([
        db
          .collection("announcements")
          .find({}, { projection: { _id: 0 } })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray(),
        db.collection("coding_leaderboard_state").findOne({ key: "public" })
      ]);

      return {
        announcements,
        publicLeaderboard: {
          isVisible: Boolean(leaderboardState?.isVisible),
          entries: Array.isArray(leaderboardState?.entries) ? leaderboardState.entries : []
        }
      };
    });

    let activeRoundRaw = await remember("active-coding-round", ACTIVE_ROUND_CACHE_TTL_MS, () =>
      db.collection("coding_rounds").findOne({ isActive: true })
    );

    if (activeRoundRaw && new Date(activeRoundRaw.endAt).getTime() <= Date.now()) {
      await db.collection("coding_rounds").updateOne(
        { _id: activeRoundRaw._id },
        { $set: { isActive: false } }
      );
      forget("active-coding-round");
      activeRoundRaw = null;
    }

    const activeRound = activeRoundRaw
      ? {
          roundId: activeRoundRaw.roundId,
          title: activeRoundRaw.title,
          subtitle: activeRoundRaw.subtitle,
          instructions: activeRoundRaw.instructions,
          problemStatement: activeRoundRaw.problemStatement,
          constraints: activeRoundRaw.constraints,
          inputFormat: activeRoundRaw.inputFormat,
          outputFormat: activeRoundRaw.outputFormat,
          sampleInput: activeRoundRaw.sampleInput,
          sampleOutput: activeRoundRaw.sampleOutput,
          durationSec: activeRoundRaw.durationSec,
          startAt: activeRoundRaw.startAt,
          endAt: activeRoundRaw.endAt,
          testCases: (activeRoundRaw.testCases || []).map((testCase) => ({
            caseId: testCase.caseId,
            label: testCase.label,
            input: testCase.input,
            points: testCase.points
          }))
        }
      : null;

    let hasSubmitted = false;
    let submission = null;
    if (activeRound) {
      const existing = await db.collection("coding_submissions").findOne({
        roundId: activeRound.roundId,
        teamId
      });

      if (existing) {
        hasSubmitted = true;
        submission = {
          totalPoints: existing.totalPoints,
          correctCount: existing.correctCount,
          totalCases: existing.totalCases,
          elapsedMs: existing.elapsedMs,
          submissionMode: existing.submissionMode,
          evaluatedCases: (existing.evaluatedCases || []).map((item) => ({
            caseId: item.caseId,
            label: item.label,
            isCorrect: item.isCorrect,
            points: item.points
          }))
        };
      }
    }

    return send(res, 200, {
      success: true,
      team,
      announcements: sharedState.announcements,
      activeRound,
      hasSubmitted,
      submission,
      publicLeaderboard: sharedState.publicLeaderboard,
      now: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load coding round" });
  }
};
