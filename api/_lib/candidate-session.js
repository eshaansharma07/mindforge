const SESSION_TTL_MS = 90 * 1000;

function normalizeToken(value) {
  return String(value || "").trim();
}

function sessionExpired(session) {
  if (!session || !session.lastSeenAt) return true;
  const lastSeen = new Date(session.lastSeenAt).getTime();
  return !Number.isFinite(lastSeen) || Date.now() - lastSeen > SESSION_TTL_MS;
}

async function getSession(db, teamId) {
  return db.collection("candidate_sessions").findOne({ teamId });
}

async function createOrRefreshSession(db, teamId, sessionToken) {
  const now = new Date().toISOString();
  await db.collection("candidate_sessions").updateOne(
    { teamId },
    {
      $set: {
        teamId,
        sessionToken,
        lastSeenAt: now,
        createdAt: now
      }
    },
    { upsert: true }
  );
}

async function validateCandidateSession(db, teamId, sessionToken) {
  const token = normalizeToken(sessionToken);
  if (!teamId || !token) {
    return { ok: false, code: 401, message: "Candidate session is required." };
  }

  const existing = await getSession(db, teamId);
  if (!existing || sessionExpired(existing)) {
    return { ok: false, code: 401, message: "Candidate session expired. Please log in again." };
  }

  if (existing.sessionToken !== token) {
    return { ok: false, code: 409, message: "This team is already logged in on another device." };
  }

  await db.collection("candidate_sessions").updateOne(
    { teamId, sessionToken: token },
    { $set: { lastSeenAt: new Date().toISOString() } }
  );

  return { ok: true };
}

module.exports = {
  SESSION_TTL_MS,
  normalizeToken,
  sessionExpired,
  getSession,
  createOrRefreshSession,
  validateCandidateSession
};
