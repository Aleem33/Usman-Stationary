// Stop the API before restoring. Requires a new, empty business database.
const fs = require("node:fs");
const { openConfiguredDatabase } = require("../server/db.cjs");
(async () => {
  const file = process.argv[2];
  if (!file)
    throw Error("Usage: node scripts/restore.cjs /path/to/backup.json");
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
    "storefront_requests",
  ];
  if (
    data.version !== 1 ||
    !data.tables ||
    !names.every(
      (n) =>
        Array.isArray(data.tables[n]) ||
        (n === "storefront_requests" && data.tables[n] == null),
    )
  )
    throw Error("Invalid backup");
  const db = await openConfiguredDatabase();
  try {
    await db.transaction(async () => {
      for (const name of names)
        if ((await db.prepare(`SELECT COUNT(*) n FROM ${name}`).get()).n)
          throw Error(
            "Restore requires an empty business database; original data was not changed",
          );
      for (const name of names) {
        const allowed = await db.columns(name);
        for (const row of data.tables[name] || []) {
          const keys = Object.keys(row);
          if (!keys.length || keys.some((k) => !allowed.includes(k)))
            throw Error("Invalid backup columns");
          const quoted = keys.map((k) => "`" + k + "`").join(",");
          await db
            .prepare(
              `INSERT INTO ${name} (${quoted}) VALUES (${keys.map(() => "?").join(",")})`,
            )
            .run(...keys.map((k) => row[k]));
        }
      }
    });
    console.log(
      "Business data restored. Existing sign-in credentials were not imported.",
    );
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
