const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");
const { normalizeToken } = require("./_lib/candidate-session");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();
    const sessionToken = normalizeToken(data.sessionToken);

    if (!teamId || !sessionToken) {
      return send(res, 200, { success: true });
    }

    const db = await getDb();
    await db.collection("candidate_sessions").deleteOne({ teamId, sessionToken });

    return send(res, 200, { success: true });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Logout failed" });
  }
};
