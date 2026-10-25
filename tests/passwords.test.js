const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { openDatabase } = require("../server/db.cjs");
const { createApp } = require("../server/app.cjs");
const { saveItem } = require("../server/domain.cjs");
async function fixture(existing = true) {
  const db = openDatabase(":memory:");
  if (existing)
    db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
      "admin",
      bcrypt.hashSync("old-password", 4),
    );
  const item = await saveItem(db, {
    name: "Preserved item",
    barcode: "PW01",
    cost: 10,
    price: 20,
    stock: 4,
  });
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let token = "";
  return {
    db,
    item,
    setToken(value) {
      token = value;
    },
    async request(route, body) {
      const r = await fetch(
        "http://127.0.0.1:" + server.address().port + "/api" + route,
        {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      return { status: r.status, body: await r.json() };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
test("first administrator can use six characters; five characters is rejected", async () => {
  process.env.SETUP_KEY = "private-test-setup-key";
  const f = await fixture(false);
  try {
    assert.equal(
      (
        await f.request("/auth", {
          name: "admin",
          password: "12345",
          setup_key: process.env.SETUP_KEY,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/auth", {
          name: "admin",
          password: "123456",
          setup_key: process.env.SETUP_KEY,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/auth", { name: "admin", password: "123456" })).status,
      200,
    );
  } finally {
    await f.close();
  }
});
test("password change keeps current login, revokes other logins and preserves business data", async () => {
  const f = await fixture();
  try {
    const first = await f.request("/auth", {
      name: "admin",
      password: "old-password",
    });
    const second = await f.request("/auth", {
      name: "admin",
      password: "old-password",
    });
    f.setToken(first.body.token);
    const change = {
      current_password: "old-password",
      new_password: "new123",
      confirm_password: "new123",
    };
    assert.equal(
      (await f.request("/password", { ...change, current_password: "wrong" }))
        .status,
      403,
    );
    assert.equal(
      (
        await f.request("/password", {
          ...change,
          new_password: "short",
          confirm_password: "short",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/password", { ...change, confirm_password: "other6" }))
        .status,
      400,
    );
    assert.equal((await f.request("/password", change)).status, 200);
    assert.equal((await f.request("/state")).status, 200);
    f.setToken(second.body.token);
    assert.equal((await f.request("/state")).status, 401);
    assert.equal(
      (await f.request("/auth", { name: "admin", password: "old-password" }))
        .status,
      401,
    );
    assert.equal(
      (await f.request("/auth", { name: "admin", password: "new123" })).status,
      200,
    );
    assert.equal(
      f.db.prepare("SELECT stock FROM items WHERE id=?").get(f.item).stock,
      4,
    );
  } finally {
    await f.close();
  }
});
test("recovery requires the private key and matching username, revokes sessions and preserves data", async () => {
  process.env.PASSWORD_RESET_KEY = "private-long-test-recovery-key";
  const f = await fixture();
  try {
    const login = await f.request("/auth", {
      name: "admin",
      password: "old-password",
    });
    f.setToken(login.body.token);
    const body = {
      name: "admin",
      recovery_key: process.env.PASSWORD_RESET_KEY,
      new_password: "reset6",
      confirm_password: "reset6",
    };
    assert.equal(
      (
        await f.request("/auth/reset-password", {
          ...body,
          recovery_key: "incorrect",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/auth/reset-password", {
          ...body,
          name: "someone-else",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/auth/reset-password", {
          ...body,
          new_password: "12345",
          confirm_password: "12345",
        })
      ).status,
      400,
    );
    assert.equal((await f.request("/auth/reset-password", body)).status, 200);
    assert.equal((await f.request("/state")).status, 401);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
    assert.equal(
      (await f.request("/auth", { name: "admin", password: "old-password" }))
        .status,
      401,
    );
    const loginNew = await f.request("/auth", {
      name: "admin",
      password: "reset6",
    });
    assert.equal(loginNew.status, 200);
    f.setToken(loginNew.body.token);
    assert.equal(
      (await f.request("/state")).body.items[0].name,
      "Preserved item",
    );
    const backup = (await f.request("/backup")).body;
    assert.ok(!JSON.stringify(backup).includes(process.env.PASSWORD_RESET_KEY));
    assert.equal(backup.tables.users, undefined);
  } finally {
    await f.close();
    delete process.env.PASSWORD_RESET_KEY;
  }
});
test("recovery supports the existing setup key and refuses missing or placeholder keys", async () => {
  const f = await fixture();
  try {
    delete process.env.PASSWORD_RESET_KEY;
    delete process.env.SETUP_KEY;
    const body = {
      name: "admin",
      recovery_key: "a-private-existing-setup-key",
      new_password: "sixsix",
      confirm_password: "sixsix",
    };
    assert.equal((await f.request("/auth/reset-password", body)).status, 503);
    process.env.SETUP_KEY = "replace-with-a-long-random-secret";
    assert.equal((await f.request("/auth/reset-password", body)).status, 503);
    process.env.SETUP_KEY = body.recovery_key;
    assert.equal((await f.request("/auth/reset-password", body)).status, 200);
  } finally {
    await f.close();
    delete process.env.SETUP_KEY;
  }
});
test("recovery attempts are rate limited without changing the password", async () => {
  process.env.PASSWORD_RESET_KEY = "private-recovery-key-for-rate-test";
  const f = await fixture();
  try {
    const body = {
      name: "admin",
      recovery_key: "incorrect",
      new_password: "new123",
      confirm_password: "new123",
    };
    for (let i = 0; i < 5; i++)
      assert.equal((await f.request("/auth/reset-password", body)).status, 403);
    assert.equal(
      (
        await f.request("/auth/reset-password", {
          ...body,
          recovery_key: process.env.PASSWORD_RESET_KEY,
        })
      ).status,
      429,
    );
    assert.equal(
      (await f.request("/auth", { name: "admin", password: "old-password" }))
        .status,
      200,
    );
  } finally {
    await f.close();
    delete process.env.PASSWORD_RESET_KEY;
  }
});
