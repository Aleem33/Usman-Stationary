const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const path = require("node:path");
const { openDatabase } = require("./db.cjs");
const { post, getDocument, saveItem, text, reports } = require("./domain.cjs");
const { report } = require("./reports.cjs");
function createApp(db = openDatabase()) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  const origins = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://store.aleemcore.com",
    ...(process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean),
  ]);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin === "null" || origins.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
      res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
  const wrap = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (e) {
      next(e);
    }
  };
  app.get("/api/health", (req, res) =>
    res.json({
      ok: true,
      setup: !db.prepare("SELECT id FROM users LIMIT 1").get(),
      version: "1.0.0",
      qa: process.env.QA_MODE === "1" && process.env.NODE_ENV !== "production",
    }),
  );
  const attempts = new Map();
  app.post(
    "/api/auth",
    wrap((req, res) => {
      const key = req.ip,
        now = Date.now(),
        a = attempts.get(key) || { count: 0, until: now + 900000 };
      if (a.until < now) {
        a.count = 0;
        a.until = now + 900000;
      }
      if (a.count >= 15)
        return res
          .status(429)
          .json({ error: "Too many attempts; try again in 15 minutes" });
      a.count++;
      attempts.set(key, a);
      let user = db.prepare("SELECT * FROM users LIMIT 1").get();
      if (!user) {
        if (
          !process.env.SETUP_KEY ||
          req.body.setup_key !== process.env.SETUP_KEY
        )
          return res.status(403).json({
            error:
              "Ask the server administrator for the SETUP_KEY to create your account",
          });
        const password = text(req.body.password);
        if (password.length < 12)
          throw Error("Use at least 12 characters for the password");
        db.prepare("INSERT INTO users(name,password) VALUES(?,?)").run(
          text(req.body.name),
          bcrypt.hashSync(password, 12),
        );
        user = db.prepare("SELECT * FROM users LIMIT 1").get();
      }
      if (
        req.body.name !== user.name ||
        !bcrypt.compareSync(req.body.password || "", user.password)
      )
        return res.status(401).json({ error: "Invalid username or password" });
      attempts.delete(key);
      const token = crypto.randomBytes(32).toString("hex");
      db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
      db.prepare(
        "INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)",
      ).run(hash(token), user.id, now + 12 * 3600000);
      res.json({ token, name: user.name });
    }),
  );
  app.use("/api", (req, res, next) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const session = db
      .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now());
    if (!session) return res.status(401).json({ error: "Please sign in" });
    req.session = hash(token);
    next();
  });
  app.post("/api/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.session);
    res.json({ ok: true });
  });
  app.get(
    "/api/state",
    wrap((req, res) =>
      res.json({
        items: db.prepare("SELECT * FROM items ORDER BY name").all(),
        parties: db.prepare("SELECT * FROM parties ORDER BY name").all(),
        documents: db
          .prepare(
            "SELECT d.*,p.name party_name FROM documents d LEFT JOIN parties p ON p.id=d.party_id ORDER BY d.date DESC,d.id DESC",
          )
          .all(),
        accounts: db
          .prepare(
            "SELECT account,SUM(debit-credit) balance FROM ledger GROUP BY account",
          )
          .all(),
        settings: Object.fromEntries(
          db
            .prepare("SELECT * FROM settings")
            .all()
            .map((r) => [r.key, r.value]),
        ),
        reports,
      }),
    ),
  );
  app.post(
    "/api/items",
    wrap((req, res) => {
      const id = saveItem(db, req.body);
      res.json({ id });
    }),
  );
  app.post(
    "/api/parties",
    wrap((req, res) => {
      const b = req.body;
      if (!["customer", "supplier", "both"].includes(b.kind))
        throw Error("Invalid party type");
      const p = [
        text(b.name),
        b.kind,
        String(b.phone || "").slice(0, 30),
        String(b.address || "").slice(0, 300),
      ];
      if (b.id)
        db.prepare(
          "UPDATE parties SET name=?,kind=?,phone=?,address=? WHERE id=?",
        ).run(...p, Number(b.id));
      else
        db.prepare(
          "INSERT INTO parties(name,kind,phone,address) VALUES(?,?,?,?)",
        ).run(...p);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/documents",
    wrap((req, res) => res.json(post(db, req.body))),
  );
  app.get(
    "/api/documents/:id",
    wrap((req, res) => res.json(getDocument(db, req.params.id))),
  );
  app.get(
    "/api/reports",
    wrap((req, res) => res.json(report(db, req.query.name, req.query))),
  );
  app.put(
    "/api/settings",
    wrap((req, res) => {
      for (const key of [
        "business_name",
        "phone",
        "address",
        "invoice_footer",
        "printer",
        "paper",
        "default_tax",
      ])
        if (typeof req.body[key] === "string")
          db.prepare(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          ).run(key, req.body[key].slice(0, 500));
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/backup",
    wrap((req, res) => {
      const tables = [
        "items",
        "parties",
        "documents",
        "lines",
        "ledger",
        "movements",
        "settings",
        "audit",
      ];
      res.set("Content-Disposition", "attachment; filename=usman-backup.json");
      res.json({
        version: 1,
        exported: new Date().toISOString(),
        tables: Object.fromEntries(
          tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
        ),
      });
    }),
  );
  app.use(express.static(path.join(__dirname, "../dist")));
  app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(400).json({
      error: err.message.includes("UNIQUE")
        ? "This barcode or document already exists"
        : err.message,
    });
  });
  return app;
}
if (require.main === module) {
  if (process.env.NODE_ENV === "production" && !process.env.DB_PATH)
    throw Error(
      "Set DB_PATH to an absolute persistent storage path outside the deployment directory",
    );
  const app = createApp();
  app.listen(
    Number(process.env.PORT) || 4000,
    process.env.HOST || "127.0.0.1",
    () =>
      console.log("Usman API listening on port " + (process.env.PORT || 4000)),
  );
}
module.exports = { createApp };
