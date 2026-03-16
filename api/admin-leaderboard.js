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
  if (!requireAdmin(req, res)) return;

  try {
    const data = readBody(req);
    const action = String(data.action || "").trim().toLowerCase();
    const db = await getDb();

    if (!["show", "hide", "save"].includes(action)) {
      return send(res, 400, { success: false, message: "Invalid leaderboard action." });
    }

    if (action === "hide") {
      await db.collection("leaderboard_state").updateOne(
        { key: "public" },
        {
          $set: {
            key: "public",
            isVisible: false,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      return send(res, 200, { success: true, isVisible: false });
    }

    const entries = normalizeEntries(data.entries);
    if (entries.length === 0) {
      return send(res, 400, { success: false, message: "Add at least one leaderboard row." });
    }

    const isVisible = action === "show" ? true : Boolean(data.isVisible);

    await db.collection("leaderboard_state").updateOne(
      { key: "public" },
      {
        $set: {
          key: "public",
          isVisible,
          entries,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return send(res, 200, { success: true, isVisible, entryCount: entries.length });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to update leaderboard" });
  }
};
