const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();

    if (!teamId) {
      return send(res, 400, { success: false, message: "teamId is required." });
    }

    const db = await getDb();

    const result = await db.collection("teams").deleteOne({ teamId });

    if (result.deletedCount === 0) {
      return send(res, 404, { success: false, message: "Team not found." });
    }

    await db.collection("quiz_responses").deleteMany({ teamId });
    await db.collection("candidate_sessions").deleteMany({ teamId });

    return send(res, 200, { success: true, teamId });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to delete team" });
  }
};
