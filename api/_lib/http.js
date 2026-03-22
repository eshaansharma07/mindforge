function send(res, status, payload) {
  res.status(status).json(payload);
}

function methodNotAllowed(res) {
  return send(res, 405, { success: false, message: "Method not allowed" });
}

function unauthorized(res) {
  return send(res, 401, { success: false, message: "Unauthorized" });
}

function getJudgeKey() {
  return process.env.JUDGE_KEY || process.env.ADMIN_KEY || "";
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

function requireJudge(req, res) {
  const judgeKey = getJudgeKey();
  const key = req.headers["x-judge-key"];

  if (!judgeKey || !key || key !== judgeKey) {
    unauthorized(res);
    return false;
  }

  return true;
}

function requireAdminOrJudge(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  const judgeKey = getJudgeKey();
  const adminHeader = req.headers["x-admin-key"];
  const judgeHeader = req.headers["x-judge-key"];

  const isAdmin = Boolean(adminKey && adminHeader && adminHeader === adminKey);
  const isJudge = Boolean(judgeKey && judgeHeader && judgeHeader === judgeKey);

  if (!isAdmin && !isJudge) {
    unauthorized(res);
    return false;
  }

  return true;
}

module.exports = { send, methodNotAllowed, readBody, requireAdmin, requireJudge, requireAdminOrJudge, getJudgeKey };
