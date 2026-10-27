const fs = require("node:fs");
const path = require("node:path");
function openDatabase(file = process.env.DB_PATH || "data/store.db") {
  const { DatabaseSync } = require("node:sqlite");
  if (file !== ":memory:")
    fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,name TEXT NOT NULL,barcode TEXT UNIQUE NOT NULL,category TEXT NOT NULL DEFAULT 'General',unit TEXT NOT NULL DEFAULT 'pcs',cost INTEGER NOT NULL,price INTEGER NOT NULL,stock REAL NOT NULL DEFAULT 0,min_stock REAL NOT NULL DEFAULT 5,batch TEXT NOT NULL DEFAULT '',serial TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,number TEXT UNIQUE NOT NULL,type TEXT NOT NULL,date TEXT NOT NULL,party_id INTEGER REFERENCES parties(id),account TEXT NOT NULL,subtotal INTEGER NOT NULL,discount INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL,paid INTEGER NOT NULL,cost INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',reference_id INTEGER REFERENCES documents(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS lines(id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),item_id INTEGER REFERENCES items(id),name TEXT NOT NULL,category TEXT NOT NULL,qty REAL NOT NULL,price INTEGER NOT NULL,cost INTEGER NOT NULL,discount INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL,batch TEXT NOT NULL DEFAULT '',serial TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY,document_id INTEGER REFERENCES documents(id),date TEXT NOT NULL,account TEXT NOT NULL,debit INTEGER NOT NULL DEFAULT 0,credit INTEGER NOT NULL DEFAULT 0,party_id INTEGER REFERENCES parties(id),memo TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,document_id INTEGER REFERENCES documents(id),item_id INTEGER REFERENCES items(id),date TEXT NOT NULL,qty REAL NOT NULL,cost INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,action TEXT NOT NULL,detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS storefront_requests(id INTEGER PRIMARY KEY,submission_key TEXT UNIQUE NOT NULL,submission_hash TEXT NOT NULL,code TEXT UNIQUE NOT NULL,role TEXT NOT NULL,contact_name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',order_id INTEGER REFERENCES documents(id),document_id INTEGER REFERENCES documents(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT '');
 `);
  db.dialect = "sqlite";
  db.exec(`CREATE TABLE IF NOT EXISTS store_customers(id INTEGER PRIMARY KEY,customer_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,login TEXT NOT NULL UNIQUE,password TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',segment TEXT NOT NULL DEFAULT 'public');
CREATE TABLE IF NOT EXISTS store_customer_sessions(token TEXT PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES store_customers(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS store_order_links(id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL UNIQUE REFERENCES storefront_requests(id),customer_key TEXT NOT NULL);`);
  db.exec(
    "CREATE TABLE IF NOT EXISTS store_settings(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)",
  );
  db.columns = async (table) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
  let queue = Promise.resolve();
  db.transaction = async (fn) => {
    const previous = queue;
    let unlock;
    queue = new Promise((resolve) => (unlock = resolve));
    await previous;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      unlock();
    }
  };
  return db;
}
async function openConfiguredDatabase() {
  if (process.env.DB_CLIENT === "mysql" || process.env.DB_HOST)
    return require("./mysql.cjs").openMySQL();
  if (process.env.NODE_ENV === "production")
    throw Error(
      "Set DB_CLIENT=mysql and the DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD environment variables",
    );
  return openDatabase();
}
module.exports = { openDatabase, openConfiguredDatabase };
