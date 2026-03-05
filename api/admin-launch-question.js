const crypto = require("crypto");
const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const data = readBody(req);
    const text = String(data.text || "").trim();
    const options = Array.isArray(data.options)
      ? data.options.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const correctIndex = Number(data.correctIndex);
    const durationSec = Number(data.durationSec || 60);

    if (!text || options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return send(res, 400, { success: false, message: "Provide valid question text, options and correct index." });
    }

    const db = await getDb();
    await db.collection("quiz_questions").updateMany({ isActive: true }, { $set: { isActive: false } });

    const startAt = new Date();
    const endAt = new Date(Date.now() + Math.max(15, durationSec) * 1000);
    const questionId = `Q-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    await db.collection("quiz_questions").insertOne({
      questionId,
      text,
      options,
      correctIndex,
      isActive: true,
      startAt,
      endAt,
      createdAt: new Date()
    });

    return send(res, 200, { success: true, questionId, startAt, endAt });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to launch question" });
  }
};
