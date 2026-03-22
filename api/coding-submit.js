const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");
const { validateCandidateSession } = require("./_lib/candidate-session");
const { scoreCodingSubmission } = require("./_lib/coding-round");
const { forget } = require("./_lib/runtime-cache");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();
    const roundId = String(data.roundId || "").trim();
    const code = String(data.code || "");
    const answers = Array.isArray(data.answers) ? data.answers : [];
    const sessionToken = String(data.sessionToken || "").trim();
    const submissionMode = String(data.submissionMode || "manual").trim().toLowerCase();

    if (!teamId || !roundId || !sessionToken) {
      return send(res, 400, {
        success: false,
        message: "teamId, roundId and sessionToken are required."
      });
    }

    const db = await getDb();
    const session = await validateCandidateSession(db, teamId, sessionToken, "coding");
    if (!session.ok) {
      return send(res, session.code, { success: false, message: session.message });
    }

    const [team, round] = await Promise.all([
      db.collection("teams").findOne({ teamId }),
      db.collection("coding_rounds").findOne({
        roundId,
        isActive: true,
        endAt: { $gt: new Date() }
      })
    ]);

    if (!team) {
      return send(res, 404, { success: false, message: "Team not found." });
    }

    if (!round) {
      return send(res, 400, { success: false, message: "Coding round not active." });
    }

    const now = Date.now();
    const startAt = new Date(round.startAt).getTime();
    const elapsedMs = Math.max(0, now - startAt);
    const scored = scoreCodingSubmission(round, answers);

    await db.collection("coding_submissions").insertOne({
      roundId,
      teamId,
      teamName: team.teamName,
      code,
      totalCases: scored.totalCases,
      correctCount: scored.correctCount,
      totalPoints: scored.totalPoints,
      elapsedMs,
      submissionMode,
      evaluatedCases: scored.evaluatedCases,
      submittedAt: new Date()
    });

    forget(`coding-overview-submissions:${roundId}`);
    forget(`coding-overview-round-state:${roundId}`);
    forget("coding-overview-shared");

    return send(res, 200, {
      success: true,
      totalCases: scored.totalCases,
      correctCount: scored.correctCount,
      totalPoints: scored.totalPoints,
      elapsedMs
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return send(res, 409, { success: false, message: "Coding round already submitted." });
    }
    return send(res, 500, { success: false, message: error.message || "Failed to submit coding round" });
  }
};
