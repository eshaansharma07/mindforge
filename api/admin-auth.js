const { send, methodNotAllowed, readBody } = require("./_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return methodNotAllowed(res);

  const data = readBody(req);
  const key = String(data.key || "");

  if (!process.env.ADMIN_KEY) {
    return send(res, 500, { success: false, message: "ADMIN_KEY missing in environment." });
  }

  if (key === process.env.ADMIN_KEY) {
    return send(res, 200, { success: true });
  }

  return send(res, 401, { success: false, message: "Invalid controller key." });
};
