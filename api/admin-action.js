const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");

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

      return send(res, 200, { success: true, isVisible: mode === "show", entryCount: entries.length });
    }

    return send(res, 400, { success: false, message: "Unsupported admin action." });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Admin action failed" });
  }
};
