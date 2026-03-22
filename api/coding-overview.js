const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, requireAdminOrJudge } = require("./_lib/http");
const { buildCodingLeaderboardRows } = require("./_lib/coding-round");
const { remember, forget } = require("./_lib/runtime-cache");

const CODING_ACTIVE_ROUND_CACHE_TTL_MS = 1000;
const CODING_RESULT_CACHE_TTL_MS = 1200;
const CODING_SHARED_CACHE_TTL_MS = 1500;

module.exports = async (req, res) => {
  if (req.method !== "GET") return methodNotAllowed(res);
  if (!requireAdminOrJudge(req, res)) return;

  try {
    const db = await getDb();

    const [activeRoundFound, latestRoundRaw, leaderboardState] = await Promise.all([
      remember("coding-overview-active-round", CODING_ACTIVE_ROUND_CACHE_TTL_MS, () =>
        db.collection("coding_rounds").findOne({ isActive: true })
      ),
      remember("coding-overview-latest-round", CODING_RESULT_CACHE_TTL_MS, () =>
        db.collection("coding_rounds").find({}).sort({ createdAt: -1 }).limit(1).next()
      ),
      remember("coding-overview-shared", CODING_SHARED_CACHE_TTL_MS, () =>
        db.collection("coding_leaderboard_state").findOne({ key: "public" })
      )
    ]);

    let activeRoundRaw = activeRoundFound;
    if (activeRoundRaw && new Date(activeRoundRaw.endAt).getTime() <= Date.now()) {
      await db.collection("coding_rounds").updateOne(
        { _id: activeRoundRaw._id },
        { $set: { isActive: false } }
      );
      forget("coding-overview-active-round");
      activeRoundRaw = null;
    }

    const sourceRound = activeRoundRaw || latestRoundRaw || null;

    let activeRound = null;
    let leaderboard = [];
    let submissions = [];
    let judgeVerdicts = [];

    if (activeRoundRaw) {
      activeRound = {
        roundId: activeRoundRaw.roundId,
        title: activeRoundRaw.title,
        subtitle: activeRoundRaw.subtitle,
        durationSec: activeRoundRaw.durationSec,
        startAt: activeRoundRaw.startAt,
        endAt: activeRoundRaw.endAt,
        totalCases: (activeRoundRaw.testCases || []).length
      };
    }

    if (sourceRound) {
      const roundState = await remember(`coding-overview-round-state:${sourceRound.roundId}`, CODING_RESULT_CACHE_TTL_MS, async () => {
        const [submissionRows, verdictRows] = await Promise.all([
          db
            .collection("coding_submissions")
            .find({ roundId: sourceRound.roundId }, {
              projection: {
                _id: 0,
                roundId: 1,
                teamId: 1,
                teamName: 1,
                code: 1,
                totalCases: 1,
                correctCount: 1,
                totalPoints: 1,
                elapsedMs: 1,
                submissionMode: 1,
                evaluatedCases: 1,
                submittedAt: 1
              }
            })
            .sort({ totalPoints: -1, correctCount: -1, elapsedMs: 1, submittedAt: 1 })
            .toArray(),
          db.collection("judge_verdicts")
            .find(
              { roundType: "coding", sourceId: sourceRound.roundId },
              { projection: { _id: 0, teamId: 1, verdict: 1, judgeName: 1, comments: 1, updatedAt: 1 } }
            )
            .sort({ updatedAt: -1 })
            .toArray()
        ]);

        return { submissionRows, verdictRows };
      });

      submissions = roundState.submissionRows;
      judgeVerdicts = roundState.verdictRows;

      leaderboard = buildCodingLeaderboardRows(submissions);
    }

    return send(res, 200, {
      success: true,
      activeRound,
      sourceRound: sourceRound
        ? {
            roundId: sourceRound.roundId,
            title: sourceRound.title,
            subtitle: sourceRound.subtitle,
            problemStatement: sourceRound.problemStatement,
            instructions: sourceRound.instructions,
            inputFormat: sourceRound.inputFormat,
            outputFormat: sourceRound.outputFormat,
            constraints: sourceRound.constraints,
            sampleInput: sourceRound.sampleInput,
            sampleOutput: sourceRound.sampleOutput,
            durationSec: sourceRound.durationSec,
            startAt: sourceRound.startAt,
            endAt: sourceRound.endAt,
            testCases: (sourceRound.testCases || []).map((item) => ({
              caseId: item.caseId,
              label: item.label,
              input: item.input,
              expectedOutput: item.expectedOutput,
              points: item.points
            }))
          }
        : null,
      leaderboard,
      leaderboardState: {
        isVisible: Boolean(leaderboardState?.isVisible),
        entries: Array.isArray(leaderboardState?.entries) ? leaderboardState.entries : []
      },
      submissions,
      judgeVerdicts
    });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to load coding controller overview" });
  }
};
