const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");
const {
  normalizeToken,
  sessionExpired,
  getSession,
  createOrRefreshSession
} = require("./_lib/candidate-session");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);
    const teamId = String(data.teamId || "").trim().toUpperCase();
    const email = String(data.email || "").trim().toLowerCase();
    const sessionToken = normalizeToken(data.sessionToken);

    if (!teamId || !email || !sessionToken) {
      return send(res, 400, { success: false, message: "teamId, email and sessionToken are required." });
    }

    const db = await getDb();
    const team = await db.collection("teams").findOne({ teamId });

    if (!team) {
      return send(res, 404, { success: false, message: "Team not found." });
    }

    const allowed = [team.leaderEmail, team.member2Email, team.member3Email, team.member4Email]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    if (!allowed.includes(email)) {
      return send(res, 401, { success: false, message: "Email does not match this team." });
    }

    const existingSession = await getSession(db, teamId, "coding");
    if (existingSession && !sessionExpired(existingSession) && existingSession.sessionToken !== sessionToken) {
      return send(res, 409, {
        success: false,
        message: "This team is already logged in to Round 2 on another device."
      });
    }

    await createOrRefreshSession(db, teamId, sessionToken, "coding");

    return send(res, 200, { success: true, teamId, sessionToken });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Coding round login failed" });
  }
};
