// Lightweight file-based "database" — perfect for a hackathon MVP.
// Swap this module out for a real MongoDB/PostgreSQL layer later without

// touching the route logic, since everything goes through readDB/writeDB.
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], potholes: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw || "{}");
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { readDB, writeDB };
