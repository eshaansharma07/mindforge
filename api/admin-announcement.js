const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const data = readBody(req);
    const title = String(data.title || "").trim();
    const body = String(data.body || "").trim();
    const type = String(data.type || "info").trim().toLowerCase();

    if (!title || !body) {
      return send(res, 400, { success: false, message: "title and body are required." });
    }

    const db = await getDb();
    await db.collection("announcements").insertOne({
      title,
      body,
      type,
      createdAt: new Date()
    });

    return send(res, 200, { success: true });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to publish announcement" });
  }
};
