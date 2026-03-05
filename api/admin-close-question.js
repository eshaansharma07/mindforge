const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const db = await getDb();

    const active = await db.collection("quiz_questions").findOne({ isActive: true });
    if (!active) {
      return send(res, 200, { success: true, message: "No active question." });
    }

    await db.collection("quiz_questions").updateOne(
      { _id: active._id },
      { $set: { isActive: false, endAt: new Date() } }
    );

    return send(res, 200, { success: true, questionId: active.questionId });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to close question" });
  }
};
