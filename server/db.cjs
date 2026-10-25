const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
function openDatabase(file = process.env.DB_PATH || "data/store.db") {
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
 `);
  return db;
}
module.exports = { openDatabase };
