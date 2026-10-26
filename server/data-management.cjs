const crypto = require("node:crypto");
const { types } = require("./domain.cjs");
const TABLES = [
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
const DELETE_ORDER = [
  "storefront_requests",
  "lines",
  "ledger",
  "movements",
  "documents",
  "parties",
  "items",
  "settings",
  "audit",
];
const MAX_BYTES = 20 * 1024 * 1024;
function fingerprint(tables) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          TABLES.filter((table) => Object.hasOwn(tables, table)).map(
            (table) => [
              table,
              tables[table].map((row) =>
                Object.fromEntries(
                  Object.keys(row)
                    .sort()
                    .map((key) => [key, row[key]]),
                ),
              ),
            ],
          ),
        ),
      ),
    )
    .digest("hex");
}
async function readBackup(db) {
  const tables = Object.fromEntries(
    await Promise.all(
      TABLES.map(async (table) => [
        table,
        await db
          .prepare(
            `SELECT * FROM ${table} ORDER BY ${table === "settings" ? "`key`" : "id"}`,
          )
          .all(),
      ]),
    ),
  );
  return {
    version: 1,
    exported: new Date().toISOString(),
    tables,
    checksum: fingerprint(tables),
  };
}
async function createBackup(db) {
  return db.transaction(() => readBackup(db));
}
async function dataSummary(db) {
  const backup = await createBackup(db);
  return {
    fingerprint: backup.checksum,
    counts: Object.fromEntries(
      TABLES.map((table) => [table, backup.tables[table].length]),
    ),
  };
}
async function validateBackup(db, backup) {
  if (
    !backup ||
    backup.version !== 1 ||
    !backup.tables ||
    typeof backup.tables !== "object" ||
    Array.isArray(backup.tables) ||
    !TABLES.filter((table) => table !== "storefront_requests").every((table) =>
      Object.hasOwn(backup.tables, table),
    ) ||
    Object.keys(backup.tables).some((table) => !TABLES.includes(table))
  )
    throw Error("Invalid business backup. Login data cannot be imported.");
  if (
    Object.keys(backup).some(
      (key) => !["version", "exported", "tables", "checksum"].includes(key),
    )
  )
    throw Error("Unsupported backup fields. Login data cannot be imported.");
  if (Buffer.byteLength(JSON.stringify(backup)) > MAX_BYTES)
    throw Error("Backup must be 20 MB or smaller");
  let totalRows = 0;
  for (const table of TABLES) {
    if (table === "storefront_requests" && !Object.hasOwn(backup.tables, table))
      continue;
    const rows = backup.tables[table];
    if (!Array.isArray(rows)) throw Error("Missing backup table: " + table);
    totalRows += rows.length;
    if (totalRows > 50000) throw Error("Backup exceeds the 50,000 row limit");
    const columns = await db.columns(table),
      seen = new Set();
    for (const row of rows) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).length !== columns.length ||
        columns.some((column) => !Object.hasOwn(row, column)) ||
        Object.keys(row).some((column) => !columns.includes(column))
      )
        throw Error("Invalid columns in backup table: " + table);
      for (const value of Object.values(row))
        if (
          value !== null &&
          typeof value !== "string" &&
          !(
            typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) <= Number.MAX_SAFE_INTEGER
          )
        )
          throw Error("Invalid backup value in " + table);
      const id = table === "settings" ? row.key : row.id;
      if (table !== "settings" && (!Number.isSafeInteger(id) || id <= 0))
        throw Error("Invalid backup ID in " + table);
      if (seen.has(id)) throw Error("Duplicate backup ID in " + table);
      seen.add(id);
    }
  }
  if (backup.checksum && backup.checksum !== fingerprint(backup.tables))
    throw Error(
      "Backup checksum does not match; the file may be damaged or modified",
    );
  for (const d of backup.tables.documents)
    if (
      !types.includes(d.type) ||
      !Number.isSafeInteger(d.total) ||
      d.total < 0 ||
      !Number.isSafeInteger(d.paid) ||
      d.paid < 0 ||
      d.paid > d.total
    )
      throw Error("Invalid document in backup");
  for (const item of backup.tables.items)
    if (
      typeof item.stock !== "number" ||
      item.stock < 0 ||
      !Number.isSafeInteger(item.cost) ||
      item.cost < 0 ||
      !Number.isSafeInteger(item.price) ||
      item.price < 0
    )
      throw Error("Invalid item in backup");
  for (const row of backup.tables.ledger)
    if (
      !Number.isSafeInteger(row.debit) ||
      row.debit < 0 ||
      !Number.isSafeInteger(row.credit) ||
      row.credit < 0
    )
      throw Error("Invalid ledger amount in backup");
  const perDocument = new Map();
  let balance = 0;
  for (const row of backup.tables.ledger) {
    balance += row.debit - row.credit;
    if (row.document_id != null)
      perDocument.set(
        row.document_id,
        (perDocument.get(row.document_id) || 0) + row.debit - row.credit,
      );
  }
  if (balance !== 0 || [...perDocument.values()].some((value) => value !== 0))
    throw Error("Backup accounting entries do not balance");
  for (const request of backup.tables.storefront_requests || []) {
    let payload;
    try {
      payload = JSON.parse(request.payload);
    } catch {
      throw Error("Invalid store request in backup");
    }
    if (
      !["pending", "accepted", "fulfilled", "rejected"].includes(
        request.status,
      ) ||
      !["customer", "supplier"].includes(request.role) ||
      !Array.isArray(payload.lines) ||
      !payload.lines.length ||
      payload.lines.length > 100 ||
      !Number.isSafeInteger(payload.total) ||
      payload.total < 0 ||
      payload.lines.some(
        (l) =>
          !Number.isSafeInteger(l.item_id) ||
          !Number.isFinite(l.qty) ||
          l.qty <= 0 ||
          !Number.isSafeInteger(l.price) ||
          l.price < 0,
      )
    )
      throw Error("Invalid store request in backup");
  }
  return {
    ...backup,
    tables: {
      ...backup.tables,
      storefront_requests: backup.tables.storefront_requests || [],
    },
  };
}
async function clearBusinessData(db) {
  // Clear self references before deleting invoices, without disabling foreign keys.
  await db
    .prepare(
      "UPDATE documents SET reference_id=NULL WHERE reference_id IS NOT NULL",
    )
    .run();
  for (const table of DELETE_ORDER)
    await db.prepare(`DELETE FROM ${table}`).run();
}
async function replaceBusinessData(
  db,
  { backup, fingerprint: expected, mode },
) {
  if (!["reset", "restore"].includes(mode))
    throw Error("Invalid data operation");
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    throw Error("Refresh the data preview before continuing");
  if (mode === "restore") backup = await validateBackup(db, backup);
  return db.transaction(async () => {
    const before = await readBackup(db);
    if (before.checksum !== expected)
      throw Error(
        "Business data changed after this preview. Close the dialog and try again.",
      );
    await clearBusinessData(db);
    if (mode === "restore")
      for (const table of TABLES) {
        const rows = [...backup.tables[table]].sort((a, b) =>
          table === "settings"
            ? String(a.key).localeCompare(String(b.key))
            : a.id - b.id,
        );
        const columns = await db.columns(table);
        // Referenced documents are inserted in ID order; all other tables use batches.
        const batchSize = table === "documents" ? 1 : 100;
        for (let offset = 0; offset < rows.length; offset += batchSize) {
          const batch = rows.slice(offset, offset + batchSize);
          const marks = "(" + columns.map(() => "?").join(",") + ")";
          await db
            .prepare(
              `INSERT INTO ${table} (${columns.map((column) => "`" + column + "`").join(",")}) VALUES ${batch.map(() => marks).join(",")}`,
            )
            .run(
              ...batch.flatMap((row) => columns.map((column) => row[column])),
            );
        }
      }
    await db
      .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
      .run(
        "data." + mode,
        "Business data " +
          (mode === "reset" ? "cleared" : "restored") +
          "; existing users and login sessions preserved",
      );
    return {
      ok: true,
      settings: Object.fromEntries(
        (await db.prepare("SELECT * FROM settings").all()).map((row) => [
          row.key,
          row.value,
        ]),
      ),
    };
  });
}
module.exports = {
  TABLES,
  MAX_BYTES,
  createBackup,
  dataSummary,
  validateBackup,
  replaceBusinessData,
};
