const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const path = require("node:path");
const { openDatabase } = require("./db.cjs");
const { post, getDocument, saveItem, text, reports } = require("./domain.cjs");
const { report } = require("./reports.cjs");
const {
  createBackup,
  dataSummary,
  replaceBusinessData,
} = require("./data-management.cjs");
function createApp(db = openDatabase()) {
  const app = express();
  app.disable("x-powered-by");
  const smallJson = express.json({
    limit: "1mb",
  });
  app.use((req, res, next) =>
    req.path === "/api/restore" ? next() : smallJson(req, res, next),
  );
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
      Promise.resolve(fn(req, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };
  app.get("/api/health", async (req, res) =>
    res.json({
      ok: true,
      setup: !(await db.prepare("SELECT id FROM users LIMIT 1").get()),
      version: "1.0.4",
      qa: process.env.QA_MODE === "1" && process.env.NODE_ENV !== "production",
    }),
  );
  const attempts = new Map();
  app.post(
    "/api/auth",
    wrap(async (req, res) => {
      const key = req.ip,
        now = Date.now(),
        a = attempts.get(key) || {
          count: 0,
          until: now + 900000,
        };
      if (a.until < now) {
        a.count = 0;
        a.until = now + 900000;
      }
      if (a.count >= 15)
        return res.status(429).json({
          error: "Too many attempts; try again in 15 minutes",
        });
      a.count++;
      attempts.set(key, a);
      let user = await db.prepare("SELECT * FROM users LIMIT 1").get();
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
        await db
          .prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)")
          .run(text(req.body.name), bcrypt.hashSync(password, 12));
        user = await db.prepare("SELECT * FROM users LIMIT 1").get();
      }
      if (
        req.body.name !== user.name ||
        !bcrypt.compareSync(req.body.password || "", user.password)
      )
        return res.status(401).json({
          error: "Invalid username or password",
        });
      attempts.delete(key);
      const token = crypto.randomBytes(32).toString("hex");
      await db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
      await db
        .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
        .run(hash(token), user.id, now + 12 * 3600000);
      res.json({
        token,
        name: user.name,
      });
    }),
  );
  app.use("/api", async (req, res, next) => {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const session = await db
      .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now());
    if (!session)
      return res.status(401).json({
        error: "Please sign in",
      });
    req.session = hash(token);
    req.userId = session.user_id;
    next();
  });
  app.post("/api/logout", async (req, res) => {
    await db.prepare("DELETE FROM sessions WHERE token=?").run(req.session);
    res.json({
      ok: true,
    });
  });
  app.get(
    "/api/state",
    wrap(async (req, res) =>
      res.json(
        await db.transaction(async () => ({
          items: await db.prepare("SELECT * FROM items ORDER BY name").all(),
          parties: await db
            .prepare("SELECT * FROM parties ORDER BY name")
            .all(),
          documents: await db
            .prepare(
              "SELECT d.*,p.name party_name FROM documents d LEFT JOIN parties p ON p.id=d.party_id ORDER BY d.date DESC,d.id DESC",
            )
            .all(),
          accounts: await db
            .prepare(
              "SELECT account,SUM(debit-credit) balance FROM ledger GROUP BY account",
            )
            .all(),
          settings: Object.fromEntries(
            (await db.prepare("SELECT * FROM settings").all()).map((r) => [
              r.key,
              r.value,
            ]),
          ),
          reports,
        })),
      ),
    ),
  );
  app.post(
    "/api/items",
    wrap(async (req, res) => {
      const id = await saveItem(db, req.body);
      res.json({
        id,
      });
    }),
  );
  app.post(
    "/api/parties",
    wrap(async (req, res) => {
      await db.transaction(async () => {
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
          await db
            .prepare(
              "UPDATE parties SET name=?,kind=?,phone=?,address=? WHERE id=?",
            )
            .run(...p, Number(b.id));
        else
          await db
            .prepare(
              "INSERT INTO parties(name,kind,phone,address) VALUES(?,?,?,?)",
            )
            .run(...p);
      });
      res.json({
        ok: true,
      });
    }),
  );
  app.post(
    "/api/documents",
    wrap(async (req, res) => res.json(await post(db, req.body))),
  );
  app.get(
    "/api/documents/:id",
    wrap(async (req, res) =>
      res.json(
        await db.transaction(async () => await getDocument(db, req.params.id)),
      ),
    ),
  );
  app.get(
    "/api/reports",
    wrap(async (req, res) =>
      res.json(
        await db.transaction(
          async () => await report(db, req.query.name, req.query),
        ),
      ),
    ),
  );
  app.put(
    "/api/settings",
    wrap(async (req, res) => {
      await db.transaction(async () => {
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
            await db
              .prepare(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              )
              .run(key, req.body[key].slice(0, 500));
      });
      res.json({
        ok: true,
      });
    }),
  );
  app.get(
    "/api/backup",
    wrap(async (req, res) => {
      res.set("Content-Disposition", "attachment; filename=usman-backup.json");
      res.json(await createBackup(db));
    }),
  );
  app.get(
    "/api/data/summary",
    wrap(async (req, res) => res.json(await dataSummary(db))),
  );
  const sensitiveAttempts = new Map();
  async function confirmDataAction(req, res, confirmation) {
    if (req.body?.confirmation !== confirmation) {
      res.status(400).json({
        error: "Type " + confirmation + " to confirm this action",
      });
      return false;
    }
    const now = Date.now();
    let attempt = sensitiveAttempts.get(req.userId);
    if (!attempt || attempt.until < now)
      attempt = {
        count: 0,
        until: now + 15 * 60 * 1000,
      };
    if (attempt.count >= 5) {
      res.status(429).json({
        error: "Too many incorrect passwords. Try again in 15 minutes.",
      });
      return false;
    }
    const user = await db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(req.userId);
    const password = req.body?.password;
    if (
      !user ||
      typeof password !== "string" ||
      password.length > 200 ||
      !bcrypt.compareSync(password, user.password)
    ) {
      attempt.count++;
      sensitiveAttempts.set(req.userId, attempt);
      res.status(403).json({
        error: "Administrator password is incorrect",
      });
      return false;
    }
    sensitiveAttempts.delete(req.userId);
    return true;
  }
  app.post(
    "/api/reset",
    wrap(async (req, res) => {
      if (!(await confirmDataAction(req, res, "RESET"))) return;
      res.json(
        await replaceBusinessData(db, {
          mode: "reset",
          fingerprint: req.body.fingerprint,
        }),
      );
    }),
  );
  app.post(
    "/api/restore",
    express.json({
      limit: "25mb",
    }),
    wrap(async (req, res) => {
      if (!(await confirmDataAction(req, res, "RESTORE"))) return;
      res.json(
        await replaceBusinessData(db, {
          mode: "restore",
          fingerprint: req.body.fingerprint,
          backup: req.body.backup,
        }),
      );
    }),
  );
  app.use(express.static(path.join(__dirname, "../dist")));
  app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(err.status === 413 ? 413 : 400).json({
      error:
        err.status === 413
          ? "Backup upload is too large (maximum 20 MB)"
          : err.message.includes("UNIQUE") || err.code === "ER_DUP_ENTRY"
            ? "This barcode or document already exists"
            : err.message,
    });
  });
  return app;
}
module.exports = {
  createApp,
};
