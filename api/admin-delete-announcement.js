const { ObjectId } = require("mongodb");
const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody, requireAdmin } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);
  if (!requireAdmin(req, res)) return;

  try {
    const data = readBody(req);
    const announcementId = String(data.announcementId || "").trim();

    if (!announcementId) {
      return send(res, 400, { success: false, message: "announcementId is required." });
    }

    const db = await getDb();
    const result = await db.collection("announcements").deleteOne({ _id: new ObjectId(announcementId) });

    if (!result.deletedCount) {
      return send(res, 404, { success: false, message: "Announcement not found." });
    }

    return send(res, 200, { success: true, announcementId });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Failed to delete announcement" });
  }
};
