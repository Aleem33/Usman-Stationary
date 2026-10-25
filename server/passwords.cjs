const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
function validatePassword(password, confirmation) {
  if (typeof password !== "string" || password.length < 6)
    throw Error("Use at least 6 characters for the password");
  if (Buffer.byteLength(password, "utf8") > 72)
    throw Error("Password is too long (maximum 72 UTF-8 bytes)");
  if (confirmation !== undefined && password !== confirmation)
    throw Error("The new passwords do not match");
  return password;
}
function createPasswordHandlers(db) {
  const attempts = new Map();
  function begin(key) {
    const now = Date.now();
    let a = attempts.get(key);
    if (!a || a.until < now) a = { count: 0, until: now + 15 * 60 * 1000 };
    if (a.count >= 5) {
      const e = Error("Too many incorrect attempts. Try again in 15 minutes.");
      e.status = 429;
      throw e;
    }
    return a;
  }
  function fail(key, attempt, message) {
    attempt.count++;
    attempts.set(key, attempt);
    const e = Error(message);
    e.status = 403;
    throw e;
  }
  function newPassword(body) {
    if (typeof body?.confirm_password !== "string")
      throw Error("Confirm the new password");
    return validatePassword(body.new_password, body.confirm_password);
  }
  return {
    async reset(req, res) {
      const key = "recovery:" + req.ip,
        attempt = begin(key);
      const configured =
        process.env.PASSWORD_RESET_KEY || process.env.SETUP_KEY;
      if (
        typeof configured !== "string" ||
        configured.length < 16 ||
        /^replace[_-]/i.test(configured)
      ) {
        const e = Error(
          "Password recovery is not configured. Set a private PASSWORD_RESET_KEY in Hostinger.",
        );
        e.status = 503;
        throw e;
      }
      const supplied = req.body?.recovery_key;
      const digest = (value) =>
        crypto.createHash("sha256").update(value).digest();
      if (
        typeof supplied !== "string" ||
        supplied.length > 256 ||
        !crypto.timingSafeEqual(digest(supplied), digest(configured))
      )
        fail(key, attempt, "Invalid username or recovery key");
      const name = req.body?.name;
      if (typeof name !== "string" || name.length > 200)
        fail(key, attempt, "Invalid username or recovery key");
      const password = newPassword(req.body);
      await db.transaction(async () => {
        const user = await db
          .prepare("SELECT id,name FROM users WHERE name=?")
          .get(name);
        if (!user || user.name !== name)
          fail(key, attempt, "Invalid username or recovery key");
        await db
          .prepare("UPDATE users SET password=? WHERE id=?")
          .run(bcrypt.hashSync(password, 12), user.id);
        await db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        await db
          .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
          .run(
            "auth.password_reset",
            "Administrator password reset with recovery key; sessions revoked",
          );
      });
      attempts.delete(key);
      res.json({ ok: true });
    },
    async change(req, res) {
      const key = "change:" + req.userId,
        attempt = begin(key);
      const password = newPassword(req.body),
        current = req.body?.current_password;
      await db.transaction(async () => {
        const user = await db
          .prepare("SELECT password FROM users WHERE id=?")
          .get(req.userId);
        if (
          !user ||
          typeof current !== "string" ||
          current.length > 200 ||
          !bcrypt.compareSync(current, user.password)
        )
          fail(key, attempt, "Current password is incorrect");
        await db
          .prepare("UPDATE users SET password=? WHERE id=?")
          .run(bcrypt.hashSync(password, 12), req.userId);
        await db
          .prepare("DELETE FROM sessions WHERE user_id=? AND token<>?")
          .run(req.userId, req.session);
        await db
          .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
          .run(
            "auth.password_changed",
            "Administrator changed password; other sessions revoked",
          );
      });
      attempts.delete(key);
      res.json({ ok: true });
    },
  };
}
module.exports = { validatePassword, createPasswordHandlers };
