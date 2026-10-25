// Run only with the API stopped. Never reads or prints authentication data.
const fs = require("node:fs");
const { openDatabase } = require("../server/db.cjs");
const file = process.argv[2];
if (!file) throw Error("Usage: node scripts/restore.cjs /path/to/backup.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const names = [
  "items",
  "parties",
  "documents",
  "lines",
  "ledger",
  "movements",
  "settings",
  "audit",
];
if (
  data.version !== 1 ||
  !data.tables ||
  !names.every((n) => Array.isArray(data.tables[n]))
)
  throw Error("Invalid backup");
const db = openDatabase();
if (
  db.prepare("SELECT COUNT(*) n FROM documents").get().n ||
  db.prepare("SELECT COUNT(*) n FROM items").get().n
)
  throw Error(
    "Restore requires an empty business database. Point DB_PATH at a new file; keep the original for recovery.",
  );
db.exec("BEGIN IMMEDIATE");
try {
  for (const name of names) {
    const allowed = db
      .prepare(`PRAGMA table_info(${name})`)
      .all()
      .map((c) => c.name);
    for (const row of data.tables[name]) {
      const keys = Object.keys(row);
      if (!keys.length || keys.some((k) => !allowed.includes(k)))
        throw Error("Invalid columns in " + name);
      db.prepare(
        `INSERT INTO ${name} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ).run(...keys.map((k) => row[k]));
    }
  }
  db.exec("COMMIT");
  console.log(
    "Business data restored. Create a new administrator through first-time setup.",
  );
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
} finally {
  db.close();
}
