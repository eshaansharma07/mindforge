const { MongoClient } = require("mongodb");

let client;
let clientPromise;

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
  return connected.db(dbName);
}

module.exports = { getDb };
