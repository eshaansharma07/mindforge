function send(res, status, payload) {
  res.status(status).json(payload);
}

function methodNotAllowed(res) {
  return send(res, 405, { success: false, message: "Method not allowed" });
}

function unauthorized(res) {
  return send(res, 401, { success: false, message: "Unauthorized" });
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function requireAdmin(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  const key = req.headers["x-admin-key"];

  if (!adminKey || !key || key !== adminKey) {
    unauthorized(res);
    return false;
  }

  return true;
}

module.exports = { send, methodNotAllowed, readBody, requireAdmin };
