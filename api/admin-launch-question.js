const crypto = require("crypto");
const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const data = readBody(req);
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
        return send(res, 400, { success: false, message: `Question \"${q.text}\" needs at least 2 options.` });
      }

      if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        return send(res, 400, { success: false, message: `Question \"${q.text}\" has invalid correct index.` });
      }
    }

    const db = await getDb();
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
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to launch question set" });
  }
};
