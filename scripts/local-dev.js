const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const root = path.join(__dirname, "..");

const handlers = {
  "/api/register": require("../api/register"),
  "/api/candidate-login": require("../api/candidate-login"),
  "/api/candidate-logout": require("../api/candidate-logout"),
  "/api/candidate-state": require("../api/candidate-state"),
  "/api/submit-answer": require("../api/submit-answer"),
  "/api/admin-action": require("../api/admin-action"),
  "/api/admin-overview": require("../api/admin-overview")
};

app.use(express.json());
app.use(express.static(root));

Object.entries(handlers).forEach(([route, handler]) => {
  app.all(route, async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message || "Server error" });
    }
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Mind Forge dev server running on http://localhost:${PORT}`);
});
