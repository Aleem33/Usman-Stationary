const fs = require("node:fs");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const mysql = require("mysql2/promise");
async function openMySQL(config = process.env) {
  for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]) {
    if (!config[key] || String(config[key]).startsWith("REPLACE_"))
      throw Error("Set " + key + " in Hostinger environment variables");
  }
  const port = Number(config.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid DB_PORT");
  const pool = mysql.createPool({
    host: config.DB_HOST,
    port,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: 10000,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true,
    charset: "utf8mb4",
    multipleStatements: false,
  });
  const context = new AsyncLocalStorage();
  function sqlForMySQL(sql) {
    return sql
      .replace(/settings\(key,value\)/g, "settings(`key`,value)")
      .replace(
        /ON CONFLICT\(key\) DO UPDATE SET value=excluded.value/g,
        "ON DUPLICATE KEY UPDATE value=VALUES(value)",
      );
  }
  async function query(sql, params = []) {
    const [rows] = await (context.getStore() || pool).execute(
      sqlForMySQL(sql),
      params,
    );
    return rows;
  }
  const db = {
    dialect: "mysql",
    prepare(sql) {
      return {
        async get(...params) {
          return (await query(sql, params))[0];
        },
        async all(...params) {
          return query(sql, params);
        },
        async run(...params) {
          const r = await query(sql, params);
          return { lastInsertRowid: r.insertId, changes: r.affectedRows };
        },
      };
    },
    async columns(table) {
      const rows = await query(
        "SELECT COLUMN_NAME name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
        [table],
      );
      return rows.map((r) => r.name);
    },
    async transaction(fn) {
      if (context.getStore()) return fn();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        // Serialize business posting across every API process, keeping stock checks,
        // return limits and document numbering in the same database transaction.
        await conn.execute("SELECT id FROM write_lock WHERE id=1 FOR UPDATE");
        const result = await context.run(conn, fn);
        await conn.commit();
        return result;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
  try {
    const schema = fs.readFileSync(
      path.join(__dirname, "mysql-schema.sql"),
      "utf8",
    );
    for (const sql of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await pool.query(sql);
    await pool.query("SELECT 1");
    return db;
  } catch (e) {
    await pool.end();
    throw e;
  }
}
module.exports = { openMySQL };
