const { MongoClient } = require("mongodb");

let client;
let clientPromise;
let indexesPromise;

function getConfig() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "mindforge2026";

  if (!uri) {
    throw new Error("MONGODB_URI is missing. Add it in your .env or Vercel env vars.");
  }

  return { uri, dbName };
}

async function getDb() {
  const { uri, dbName } = getConfig();

  if (!clientPromise) {
    client = new MongoClient(uri);
    clientPromise = client.connect();
  }

  const connected = await clientPromise;
  const db = connected.db(dbName);

  if (!indexesPromise) {
    indexesPromise = Promise.all([
      db.collection("teams").createIndex({ teamId: 1 }, { unique: true }),
      db.collection("candidate_sessions").createIndex({ teamId: 1 }, { unique: true }),
      db.collection("coding_sessions").createIndex({ teamId: 1 }, { unique: true }),
      db.collection("quiz_responses").createIndex({ setId: 1, teamId: 1 }, { unique: true }),
      db.collection("coding_submissions").createIndex({ roundId: 1, teamId: 1 }, { unique: true }),
      db.collection("quiz_sets").createIndex({ isActive: 1, endAt: 1 }),
      db.collection("coding_rounds").createIndex({ isActive: 1, endAt: 1 }),
      db.collection("announcements").createIndex({ createdAt: -1 }),
      db.collection("leaderboard_state").createIndex({ key: 1 }, { unique: true }),
      db.collection("coding_leaderboard_state").createIndex({ key: 1 }, { unique: true })
    ]).catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }

  await indexesPromise;
  return db;
}

module.exports = { getDb };
