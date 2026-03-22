const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");
const { forget } = require("./_lib/runtime-cache");

function normalizeEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      rank: index + 1,
      teamId: String(entry.teamId || "").trim().toUpperCase(),
      teamName: String(entry.teamName || "").trim(),
      points: Number(entry.points || 0),
      correctCount: Number(entry.correctCount || 0),
      totalQuestions: Number(entry.totalQuestions || 0),
      elapsedMs: Math.max(0, Number(entry.elapsedMs || 0))
    }))
    .filter((entry) => entry.teamId || entry.teamName);
}

function normalizeCodingLeaderboardEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      rank: index + 1,
      teamId: String(entry.teamId || "").trim().toUpperCase(),
      teamName: String(entry.teamName || "").trim(),
      points: Number(entry.points || 0),
      correctCount: Number(entry.correctCount || 0),
      totalCases: Number(entry.totalCases || 0),
      elapsedMs: Math.max(0, Number(entry.elapsedMs || 0))
    }))
    .filter((entry) => entry.teamId || entry.teamName);
}

function invalidateQuizCaches(setId = "") {
  forget("candidate-dashboard-state");
  forget("active-quiz-set");
  forget("admin-overview-shared");
  forget("admin-overview-active-set");
  forget("admin-overview-latest-set");
  if (setId) {
    forget(`admin-overview-leaderboard:${setId}`);
  }
}

function invalidateCodingCaches(roundId = "") {
  forget("coding-shared-state");
  forget("active-coding-round");
  forget("coding-overview-active-round");
  forget("coding-overview-latest-round");
  forget("coding-overview-shared");
  if (roundId) {
    forget(`coding-overview-submissions:${roundId}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const action = String(data.action || "").trim().toLowerCase();

    if (!action) {
      return send(res, 400, { success: false, message: "action is required." });
    }

    if (action === "auth") {
      const key = String(data.key || "");

      if (!process.env.ADMIN_KEY) {
        return send(res, 500, { success: false, message: "ADMIN_KEY missing in environment." });
      }

      if (key === process.env.ADMIN_KEY) {
        return send(res, 200, { success: true });
      }

      return send(res, 401, { success: false, message: "Invalid controller key." });
    }

    if (!requireAdmin(req, res)) return;

    const db = await getDb();

    if (action === "publishannouncement") {
      const title = String(data.title || "").trim();
      const body = String(data.body || "").trim();
      const type = String(data.type || "info").trim().toLowerCase();

      if (!title || !body) {
        return send(res, 400, { success: false, message: "title and body are required." });
      }

      await db.collection("announcements").insertOne({
        title,
        body,
        type,
        createdAt: new Date()
      });

      invalidateQuizCaches();
      invalidateCodingCaches();

      return send(res, 200, { success: true });
    }

    if (action === "deleteannouncement") {
      const announcementId = String(data.announcementId || "").trim();

      if (!announcementId) {
        return send(res, 400, { success: false, message: "announcementId is required." });
      }

      const result = await db.collection("announcements").deleteOne({ _id: new ObjectId(announcementId) });

      if (!result.deletedCount) {
        return send(res, 404, { success: false, message: "Announcement not found." });
      }

      invalidateQuizCaches();
      invalidateCodingCaches();

      return send(res, 200, { success: true, announcementId });
    }

    if (action === "launchquestion") {
      const durationSec = Number(data.durationSec || 60);
      const pointsPerCorrect = Number(data.pointsPerCorrect || 10);
      const rawQuestions = Array.isArray(data.questions) ? data.questions : [];

      const questions = rawQuestions
        .map((q) => ({
          questionId: `Q-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          text: String(q.text || "").trim(),
          options: Array.isArray(q.options)
            ? q.options.map((opt) => String(opt || "").trim()).filter(Boolean)
            : [],
          correctIndex: Number(q.correctIndex)
        }))
        .filter((q) => q.text);

      if (questions.length === 0) {
        return send(res, 400, { success: false, message: "Add at least one valid question." });
      }

      for (const q of questions) {
        if (q.options.length < 2) {
          return send(res, 400, { success: false, message: `Question "${q.text}" needs at least 2 options.` });
        }

        if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
          return send(res, 400, { success: false, message: `Question "${q.text}" has invalid correct index.` });
        }
      }

      await db.collection("quiz_sets").updateMany({ isActive: true }, { $set: { isActive: false } });

      const startAt = new Date();
      const endAt = new Date(Date.now() + Math.max(15, durationSec) * 1000);
      const setId = `S-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      await db.collection("quiz_sets").insertOne({
        setId,
        isActive: true,
        durationSec: Math.max(15, durationSec),
        pointsPerCorrect: Math.max(1, pointsPerCorrect),
        questions,
        startAt,
        endAt,
        createdAt: new Date()
      });

      invalidateQuizCaches(setId);

      return send(res, 200, {
        success: true,
        setId,
        questionCount: questions.length,
        startAt,
        endAt
      });
    }

    if (action === "closequestion") {
      const active = await db.collection("quiz_sets").findOne({ isActive: true });
      if (!active) {
        return send(res, 200, { success: true, message: "No active question set." });
      }

      await db.collection("quiz_sets").updateOne(
        { _id: active._id },
        { $set: { isActive: false, endAt: new Date() } }
      );

      invalidateQuizCaches(active.setId);

      return send(res, 200, { success: true, setId: active.setId });
    }

    if (action === "deleteteam") {
      const teamId = String(data.teamId || "").trim().toUpperCase();

      if (!teamId) {
        return send(res, 400, { success: false, message: "teamId is required." });
      }

      const result = await db.collection("teams").deleteOne({ teamId });
      if (!result.deletedCount) {
        return send(res, 404, { success: false, message: "Team not found." });
      }

      await db.collection("quiz_responses").deleteMany({ teamId });
      await db.collection("candidate_sessions").deleteMany({ teamId });
      await db.collection("coding_submissions").deleteMany({ teamId });
      await db.collection("coding_sessions").deleteMany({ teamId });

      const [quizLeaderboardState, codingLeaderboardState] = await Promise.all([
        db.collection("leaderboard_state").findOne({ key: "public" }),
        db.collection("coding_leaderboard_state").findOne({ key: "public" })
      ]);

      if (quizLeaderboardState?.entries?.length) {
        const nextQuizEntries = quizLeaderboardState.entries.filter((entry) => String(entry.teamId || "").toUpperCase() !== teamId);
        await db.collection("leaderboard_state").updateOne(
          { key: "public" },
          { $set: { entries: nextQuizEntries, updatedAt: new Date() } }
        );
      }

      if (codingLeaderboardState?.entries?.length) {
        const nextCodingEntries = codingLeaderboardState.entries.filter((entry) => String(entry.teamId || "").toUpperCase() !== teamId);
        await db.collection("coding_leaderboard_state").updateOne(
          { key: "public" },
          { $set: { entries: nextCodingEntries, updatedAt: new Date() } }
        );
      }

      invalidateQuizCaches();
      invalidateCodingCaches();

      return send(res, 200, { success: true, teamId });
    }

    if (action === "resetattempt") {
      const teamId = String(data.teamId || "").trim().toUpperCase();
      let setId = String(data.setId || "").trim();

      if (!teamId) {
        return send(res, 400, { success: false, message: "teamId is required." });
      }

      if (!setId) {
        const sourceSet =
          (await db.collection("quiz_sets").findOne({ isActive: true })) ||
          (await db.collection("quiz_sets").find({}).sort({ createdAt: -1 }).limit(1).next());

        if (!sourceSet) {
          return send(res, 404, { success: false, message: "No quiz set found." });
        }

        setId = sourceSet.setId;
      }

      const result = await db.collection("quiz_responses").deleteOne({ teamId, setId });
      if (!result.deletedCount) {
        return send(res, 404, { success: false, message: "No submission found for this team and quiz set." });
      }

      const leaderboardState = await db.collection("leaderboard_state").findOne({ key: "public" });
      if (leaderboardState?.entries?.length) {
        const nextEntries = leaderboardState.entries.filter((entry) => String(entry.teamId || "").toUpperCase() !== teamId);
        await db.collection("leaderboard_state").updateOne(
          { key: "public" },
          { $set: { entries: nextEntries, updatedAt: new Date() } }
        );
      }

      invalidateQuizCaches(setId);

      return send(res, 200, { success: true, teamId, setId });
    }

    if (action === "leaderboard") {
      const mode = String(data.mode || "").trim().toLowerCase();
      if (!["show", "hide", "save", "reset"].includes(mode)) {
        return send(res, 400, { success: false, message: "Invalid leaderboard mode." });
      }

      if (mode === "hide") {
        await db.collection("leaderboard_state").updateOne(
          { key: "public" },
          {
            $set: {
              key: "public",
              isVisible: false,
              isReset: false,
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );

        invalidateQuizCaches();
        return send(res, 200, { success: true, isVisible: false });
      }

      if (mode === "reset") {
        await db.collection("leaderboard_state").updateOne(
          { key: "public" },
          {
            $set: {
              key: "public",
              isVisible: false,
              isReset: true,
              entries: [],
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );

        invalidateQuizCaches();
        return send(res, 200, { success: true, isVisible: false, entryCount: 0 });
      }

      const entries = normalizeEntries(data.entries);
      if (entries.length === 0) {
        return send(res, 400, { success: false, message: "Add at least one leaderboard row." });
      }

      await db.collection("leaderboard_state").updateOne(
        { key: "public" },
        {
          $set: {
            key: "public",
            isVisible: mode === "show",
            isReset: false,
            entries,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      invalidateQuizCaches();

      return send(res, 200, { success: true, isVisible: mode === "show", entryCount: entries.length });
    }

    if (action === "launchcodinground") {
      const durationSec = Number(data.durationSec || 1800);
      const title = String(data.title || "").trim();
      const subtitle = String(data.subtitle || "").trim();
      const problemStatement = String(data.problemStatement || "").trim();
      const inputFormat = String(data.inputFormat || "").trim();
      const outputFormat = String(data.outputFormat || "").trim();
      const constraints = String(data.constraints || "").trim();
      const instructions = String(data.instructions || "").trim();
      const sampleInput = String(data.sampleInput || "").trim();
      const sampleOutput = String(data.sampleOutput || "").trim();
      const rawTestCases = Array.isArray(data.testCases) ? data.testCases : [];

      if (!title || !problemStatement || rawTestCases.length === 0) {
        return send(res, 400, { success: false, message: "title, problemStatement and at least one test case are required." });
      }

      const testCases = rawTestCases
        .map((item, index) => ({
          caseId: `TC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          label: String(item.label || `Test Case ${index + 1}`).trim(),
          input: String(item.input || "").trim(),
          expectedOutput: String(item.expectedOutput || "").trim(),
          points: Math.max(0, Number(item.points || 0))
        }))
        .filter((item) => item.input || item.expectedOutput);

      if (testCases.length === 0) {
        return send(res, 400, { success: false, message: "Add at least one valid coding test case." });
      }

      await db.collection("coding_rounds").updateMany({ isActive: true }, { $set: { isActive: false } });

      const startAt = new Date();
      const endAt = new Date(Date.now() + Math.max(60, durationSec) * 1000);
      const roundId = `CR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      await db.collection("coding_rounds").insertOne({
        roundId,
        title,
        subtitle,
        problemStatement,
        inputFormat,
        outputFormat,
        constraints,
        instructions,
        sampleInput,
        sampleOutput,
        durationSec: Math.max(60, durationSec),
        testCases,
        isActive: true,
        startAt,
        endAt,
        createdAt: new Date()
      });

      invalidateCodingCaches(roundId);

      return send(res, 200, {
        success: true,
        roundId,
        testCaseCount: testCases.length,
        startAt,
        endAt
      });
    }

    if (action === "closecodinground") {
      const active = await db.collection("coding_rounds").findOne({ isActive: true });
      if (!active) {
        return send(res, 200, { success: true, message: "No active coding round." });
      }

      await db.collection("coding_rounds").updateOne(
        { _id: active._id },
        { $set: { isActive: false, endAt: new Date() } }
      );

      invalidateCodingCaches(active.roundId);

      return send(res, 200, { success: true, roundId: active.roundId });
    }

    if (action === "resetcodingattempt") {
      const teamId = String(data.teamId || "").trim().toUpperCase();
      let roundId = String(data.roundId || "").trim();

      if (!teamId) {
        return send(res, 400, { success: false, message: "teamId is required." });
      }

      if (!roundId) {
        const sourceRound =
          (await db.collection("coding_rounds").findOne({ isActive: true })) ||
          (await db.collection("coding_rounds").find({}).sort({ createdAt: -1 }).limit(1).next());

        if (!sourceRound) {
          return send(res, 404, { success: false, message: "No coding round found." });
        }

        roundId = sourceRound.roundId;
      }

      const result = await db.collection("coding_submissions").deleteOne({ teamId, roundId });
      if (!result.deletedCount) {
        return send(res, 404, { success: false, message: "No coding submission found for this team and round." });
      }

      const leaderboardState = await db.collection("coding_leaderboard_state").findOne({ key: "public" });
      if (leaderboardState?.entries?.length) {
        const nextEntries = leaderboardState.entries.filter((entry) => String(entry.teamId || "").toUpperCase() !== teamId);
        await db.collection("coding_leaderboard_state").updateOne(
          { key: "public" },
          { $set: { entries: nextEntries, updatedAt: new Date() } }
        );
      }

      invalidateCodingCaches(roundId);

      return send(res, 200, { success: true, teamId, roundId });
    }

    if (action === "codingleaderboard") {
      const mode = String(data.mode || "").trim().toLowerCase();
      if (!["show", "hide", "save", "reset"].includes(mode)) {
        return send(res, 400, { success: false, message: "Invalid coding leaderboard mode." });
      }

      if (mode === "hide") {
        await db.collection("coding_leaderboard_state").updateOne(
          { key: "public" },
          {
            $set: {
              key: "public",
              isVisible: false,
              entries: [],
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );

        invalidateCodingCaches();
        return send(res, 200, { success: true, isVisible: false });
      }

      if (mode === "reset") {
        await db.collection("coding_leaderboard_state").updateOne(
          { key: "public" },
          {
            $set: {
              key: "public",
              isVisible: false,
              entries: [],
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );

        invalidateCodingCaches();
        return send(res, 200, { success: true, isVisible: false, entryCount: 0 });
      }

      const entries = normalizeCodingLeaderboardEntries(data.entries);
      if (entries.length === 0) {
        return send(res, 400, { success: false, message: "Add at least one coding leaderboard row." });
      }

      await db.collection("coding_leaderboard_state").updateOne(
        { key: "public" },
        {
          $set: {
            key: "public",
            isVisible: mode === "show",
            entries,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      invalidateCodingCaches();

      return send(res, 200, { success: true, isVisible: mode === "show", entryCount: entries.length });
    }

    return send(res, 400, { success: false, message: "Unsupported admin action." });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Admin action failed" });
  }
};
