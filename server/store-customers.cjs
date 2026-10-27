const crypto = require("node:crypto"),
  bcrypt = require("bcryptjs");
const { validatePassword } = require("./passwords.cjs");
const { text } = require("./domain.cjs");
const { GROUPS } = require("./store-pricing.cjs");
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const safe = (c) =>
  c
    ? {
        id: c.id,
        name: c.name,
        phone: c.phone,
        login: c.login,
        status: c.status,
        segment: c.status === "active" ? c.segment : "public",
      }
    : null;
async function current(db, req) {
  const match = String(req.headers.cookie || "").match(
    /(?:^|;\s*)usman_store=([a-f0-9]{64})(?:;|$)/,
  );
  if (!match) return null;
  return (
    (await db
      .prepare(
        "SELECT c.* FROM store_customers c JOIN store_customer_sessions s ON s.customer_id=c.id WHERE s.token=? AND s.expires>? AND c.status<>'blocked'",
      )
      .get(hash(match[1]), Date.now())) || null
  );
}
function registerPublic(app, db, wrap) {
  const attempts = new Map();
  const guard = (req) => {
    const now = Date.now();
    for (const [k, a] of attempts) if (a.until < now) attempts.delete(k);
    const a = attempts.get(req.ip) || { count: 0, until: now + 900000 };
    if (a.count >= 15 || attempts.size > 10000)
      fail("Too many account attempts. Try again in 15 minutes.", 429);
    a.count++;
    attempts.set(req.ip, a);
  };
  const cookie = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/storefront",
    maxAge: 7 * 86400000,
  };
  app.post(
    "/api/storefront/account/register",
    wrap(async (req, res) => {
      guard(req);
      const b = req.body,
        login = text(b.login, 80).toLowerCase(),
        name = text(b.name),
        phone = text(b.phone, 30).replace(/[\s()+-]/g, "");
      if (!/^[a-z0-9_.@+-]{3,80}$/.test(login) || !/^\d{7,15}$/.test(phone))
        fail("Enter a valid login (3+ letters/numbers) and phone number");
      const password = validatePassword(b.password);
      await db.transaction(async () => {
        if (
          await db
            .prepare("SELECT id FROM store_customers WHERE login=?")
            .get(login)
        )
          fail("This login is unavailable", 409);
        await db
          .prepare(
            "INSERT INTO store_customers(customer_key,name,phone,login,password) VALUES(?,?,?,?,?)",
          )
          .run(
            crypto.randomUUID(),
            name,
            phone,
            login,
            bcrypt.hashSync(password, 12),
          );
      });
      res.json({
        ok: true,
        message:
          "Account requested. Sign in at public prices while the owner reviews your pricing group.",
      });
    }),
  );
  app.post(
    "/api/storefront/account/login",
    wrap(async (req, res) => {
      guard(req);
      const c = await db
        .prepare("SELECT * FROM store_customers WHERE login=?")
        .get(
          String(req.body.login || "")
            .trim()
            .toLowerCase(),
        );
      if (
        !c ||
        c.status === "blocked" ||
        typeof req.body.password !== "string" ||
        req.body.password.length > 200 ||
        !bcrypt.compareSync(req.body.password, c.password)
      )
        fail("Invalid login or password", 401);
      const token = crypto.randomBytes(32).toString("hex");
      await db
        .prepare("DELETE FROM store_customer_sessions WHERE expires<?")
        .run(Date.now());
      await db
        .prepare(
          "INSERT INTO store_customer_sessions(token,customer_id,expires) VALUES(?,?,?)",
        )
        .run(hash(token), c.id, Date.now() + 7 * 86400000);
      res.cookie("usman_store", token, cookie).json({ customer: safe(c) });
    }),
  );
  app.post(
    "/api/storefront/account/logout",
    wrap(async (req, res) => {
      const match = String(req.headers.cookie || "").match(
        /(?:^|;\s*)usman_store=([a-f0-9]{64})(?:;|$)/,
      );
      if (match)
        await db
          .prepare("DELETE FROM store_customer_sessions WHERE token=?")
          .run(hash(match[1]));
      res
        .clearCookie("usman_store", { ...cookie, maxAge: undefined })
        .json({ ok: true });
    }),
  );
  app.get(
    "/api/storefront/account/orders",
    wrap(async (req, res) => {
      const c = await current(db, req);
      if (!c) fail("Sign in to see your purchases", 401);
      const rows = await db
        .prepare(
          "SELECT r.id,r.code,r.payload,r.created_at,d.number FROM storefront_requests r JOIN store_order_links l ON l.request_id=r.id JOIN documents d ON d.id=r.document_id WHERE l.customer_key=? AND r.role='customer' AND r.status='fulfilled' ORDER BY r.id DESC LIMIT 50",
        )
        .all(c.customer_key);
      res.json(
        rows.map((r) => ({
          id: r.id,
          code: r.code,
          number: r.number,
          created_at: r.created_at,
          lines: JSON.parse(r.payload).lines,
        })),
      );
    }),
  );
}
function registerPrivate(app, db, wrap) {
  app.get(
    "/api/storefront/customers",
    wrap(async (req, res) =>
      res.json(
        (
          await db
            .prepare(
              "SELECT id,name,phone,login,status,segment FROM store_customers ORDER BY id DESC LIMIT 2000",
            )
            .all()
        ).map((c) => ({ ...safe(c), segment: c.segment })),
      ),
    ),
  );
  app.put(
    "/api/storefront/customers/:id",
    wrap(async (req, res) => {
      const b = req.body;
      if (
        !["active", "pending", "blocked"].includes(b.status) ||
        !GROUPS.includes(b.segment)
      )
        fail("Invalid account status or pricing group");
      await db.transaction(async () => {
        if (
          !(await db
            .prepare("SELECT id FROM store_customers WHERE id=?")
            .get(Number(req.params.id)))
        )
          fail("Customer not found", 404);
        await db
          .prepare("UPDATE store_customers SET status=?,segment=? WHERE id=?")
          .run(b.status, b.segment, Number(req.params.id));
        if (b.status === "blocked")
          await db
            .prepare("DELETE FROM store_customer_sessions WHERE customer_id=?")
            .run(Number(req.params.id));
        if (b.password) {
          const password = validatePassword(b.password);
          await db
            .prepare("UPDATE store_customers SET password=? WHERE id=?")
            .run(bcrypt.hashSync(password, 12), Number(req.params.id));
          await db
            .prepare("DELETE FROM store_customer_sessions WHERE customer_id=?")
            .run(Number(req.params.id));
        }
        await db
          .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
          .run("store.customer.updated", String(req.params.id));
      });
      res.json({ ok: true });
    }),
  );
}
module.exports = { safe, current, registerPublic, registerPrivate };
