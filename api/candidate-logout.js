const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");
const { normalizeToken, getSessionCollectionName } = require("./_lib/candidate-session");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();
    const sessionToken = normalizeToken(data.sessionToken);
    const scope = String(data.scope || "quiz").trim().toLowerCase();

    if (!teamId || !sessionToken) {
      return send(res, 200, { success: true });
    }

    const db = await getDb();
    await db.collection(getSessionCollectionName(scope)).deleteOne({ teamId, sessionToken });

    return send(res, 200, { success: true });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Logout failed" });
  }
};
