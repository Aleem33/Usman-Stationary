const { test } = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../src/http.mjs");
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
test("temporary HTML responses are retried for reads and never exposed as JSON syntax errors", async () => {
  const { requestJson } = await modulePromise;
  let calls = 0;
  const result = await requestJson(
    "https://store.test/api/state",
    {},
    {
      retryDelayMs: 0,
      fetchImpl: async () =>
        ++calls === 1
          ? new Response("<!DOCTYPE html><h1>Unavailable</h1>", { status: 503 })
          : json({ ok: true }),
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  await assert.rejects(
    () =>
      requestJson(
        "https://store.test/api/state",
        {},
        {
          retryDelayMs: 0,
          fetchImpl: async () =>
            new Response("<!DOCTYPE html><h1>Maintenance</h1>"),
        },
      ),
    (e) =>
      e.code === "INVALID_RESPONSE" &&
      !/DOCTYPE|Unexpected token|valid JSON/.test(e.message),
  );
});
test("logout is retried once with its original token and body", async () => {
  const { requestJson } = await modulePromise;
  const seen = [];
  const result = await requestJson(
    "https://store.test/api/logout",
    {
      method: "POST",
      headers: { Authorization: "Bearer original-token" },
      body: "{}",
    },
    {
      retryDelayMs: 0,
      fetchImpl: async (url, options) => {
        seen.push({ auth: options.headers.Authorization, body: options.body });
        return seen.length === 1
          ? new Response("<!DOCTYPE html>", { status: 502 })
          : json({ ok: true });
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [
    { auth: "Bearer original-token", body: "{}" },
    { auth: "Bearer original-token", body: "{}" },
  ]);
});
test("business writes, restore, reset, authentication and password changes are never retried", async () => {
  const { requestJson } = await modulePromise;
  for (const path of [
    "documents",
    "reset",
    "restore",
    "auth",
    "password",
    "auth/reset-password",
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      requestJson(
        "https://store.test/api/" + path,
        { method: "POST", body: "{}" },
        {
          retryDelayMs: 0,
          fetchImpl: async () => {
            calls++;
            return new Response("<!DOCTYPE html>", { status: 503 });
          },
        },
      ),
    );
    assert.equal(calls, 1, path);
  }
});
test("JSON auth failures retain their status and missing routes have readable errors", async () => {
  const { requestJson } = await modulePromise;
  let calls = 0;
  await assert.rejects(
    () =>
      requestJson(
        "https://store.test/api/state",
        {},
        {
          fetchImpl: async () => {
            calls++;
            return new Response(JSON.stringify({ error: "Please sign in" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            });
          },
        },
      ),
    (e) => e.status === 401 && e.apiResponse && e.message === "Please sign in",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      requestJson(
        "https://store.test/api/missing",
        {},
        {
          fetchImpl: async () =>
            new Response("<!DOCTYPE html>", { status: 404 }),
        },
      ),
    (e) =>
      e.status === 404 &&
      e.message.includes("endpoint") &&
      !e.message.includes("<"),
  );
  assert.deepEqual(
    await requestJson(
      "https://store.test/api/logout",
      { method: "POST" },
      { fetchImpl: async () => new Response(null, { status: 204 }) },
    ),
    {},
  );
});
test("network failures are readable and timeout cancellation is bounded", async () => {
  const { requestJson } = await modulePromise;
  let calls = 0;
  const result = await requestJson(
    "https://store.test/api/health",
    {},
    {
      retryDelayMs: 0,
      fetchImpl: async () => {
        if (++calls === 1) throw new TypeError("private network detail");
        return json({ ok: true });
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  await assert.rejects(
    () =>
      requestJson(
        "https://store.test/api/documents",
        { method: "POST" },
        {
          fetchImpl: async () => {
            throw new TypeError("private network detail");
          },
        },
      ),
    (e) => e.code === "NETWORK_ERROR" && !e.message.includes("private"),
  );
  await assert.rejects(
    () =>
      requestJson(
        "https://store.test/api/health",
        {},
        {
          timeoutMs: 5,
          retries: 0,
          fetchImpl: (url, options) =>
            new Promise((resolve, reject) =>
              options.signal.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              ),
            ),
        },
      ),
    (e) => e.code === "TIMEOUT",
  );
});
