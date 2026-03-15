const crypto = require("crypto");
const { getDb } = require("./_lib/db");
const { send, methodNotAllowed, readBody } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const data = readBody(req);

    const requiredFields = [
      "teamName",
      "department",
      "leaderName",
      "leaderEmail",
      "leaderPhone",
      "leaderRoll"
    ];

    for (const field of requiredFields) {
      if (!data[field] || String(data[field]).trim() === "") {
        return send(res, 400, { success: false, message: `Missing required field: ${field}` });
      }
    }

    if (!data.terms) {
      return send(res, 400, { success: false, message: "You must accept event terms." });
    }

    const db = await getDb();
    const teamId = `MF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    await db.collection("teams").insertOne({
      teamId,
      teamName: String(data.teamName).trim(),
      department: String(data.department).trim(),
      leaderName: String(data.leaderName).trim(),
      leaderEmail: String(data.leaderEmail).trim().toLowerCase(),
      leaderPhone: String(data.leaderPhone).trim(),
      leaderRoll: String(data.leaderRoll).trim(),
      member2Name: String(data.member2Name || "").trim(),
      member2Email: String(data.member2Email || "").trim().toLowerCase(),
      member2Roll: String(data.member2Roll || "").trim(),
      member3Name: String(data.member3Name || "").trim(),
      member3Email: String(data.member3Email || "").trim().toLowerCase(),
      member3Roll: String(data.member3Roll || "").trim(),
      member4Name: String(data.member4Name || "").trim(),
      member4Email: String(data.member4Email || "").trim().toLowerCase(),
      member4Roll: String(data.member4Roll || "").trim(),
      domain: String(data.domain || "").trim(),
      termsAccepted: true,
      createdAt: new Date()
    });

    return send(res, 200, { success: true, teamId });
  } catch (error) {
    return send(res, 500, { success: false, message: error.message || "Registration failed" });
  }
};
