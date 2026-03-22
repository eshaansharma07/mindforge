const SESSION_TTL_MS = 90 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 15 * 1000;

function getSessionCollectionName(scope = "quiz") {
  return scope === "coding" ? "coding_sessions" : "candidate_sessions";
}

function normalizeToken(value) {
  return String(value || "").trim();
}

function sessionExpired(session) {
  if (!session || !session.lastSeenAt) return true;
  const lastSeen = new Date(session.lastSeenAt).getTime();
  return !Number.isFinite(lastSeen) || Date.now() - lastSeen > SESSION_TTL_MS;
}

async function getSession(db, teamId, scope = "quiz") {
  return db.collection(getSessionCollectionName(scope)).findOne({ teamId });
}

async function createOrRefreshSession(db, teamId, sessionToken, scope = "quiz") {
  const now = new Date().toISOString();
  await db.collection(getSessionCollectionName(scope)).updateOne(
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

async function validateCandidateSession(db, teamId, sessionToken, scope = "quiz") {
  const token = normalizeToken(sessionToken);
  if (!teamId || !token) {
    return { ok: false, code: 401, message: "Candidate session is required." };
  }

  const collectionName = getSessionCollectionName(scope);
  const existing = await getSession(db, teamId, scope);
  if (!existing || sessionExpired(existing)) {
    return { ok: false, code: 401, message: "Candidate session expired. Please log in again." };
  }

  if (existing.sessionToken !== token) {
    return { ok: false, code: 409, message: "This team is already logged in on another device." };
  }

  const lastSeen = new Date(existing.lastSeenAt).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= SESSION_TOUCH_INTERVAL_MS) {
    await db.collection(collectionName).updateOne(
      { teamId, sessionToken: token },
      { $set: { lastSeenAt: new Date().toISOString() } }
    );
  }

  return { ok: true };
}

module.exports = {
  SESSION_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  normalizeToken,
  getSessionCollectionName,
  sessionExpired,
  getSession,
  createOrRefreshSession,
  validateCandidateSession
};
