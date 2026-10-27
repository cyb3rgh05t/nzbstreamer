const { test } = require("node:test");
const assert = require("node:assert/strict");
const embeddedNzbdav = require("./embeddedNzbdav");
const cache = require("../cache");
const { getDashboard } = require("./adminDashboard");

function setup(t, internal = true) {
  const saved = { url: process.env.NZBDAV_URL, key: process.env.NZBDAV_API_KEY };
  process.env.NZBDAV_URL = "http://127.0.0.1:7071";
  process.env.NZBDAV_API_KEY = "test-backend-key";
  t.after(() => {
    for (const [name, value] of Object.entries({
      NZBDAV_URL: saved.url, NZBDAV_API_KEY: saved.key,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(embeddedNzbdav, "isEnabled", () => internal);
  t.mock.method(cache, "getAllCacheStats", () => ({
    stream: { entries: 2, bytes: 100 },
    nzbdav: { entries: 1, byStatus: { ready: 1, pending: 0 } },
    disk: { entries: 3, totalBytes: 200, maxBytes: 1000, cacheDir: "private-path" },
  }));
}

function fixture(url) {
  if (url.pathname === "/api/get-overview-stats") {
    return { tiles: { activeReads: 2, bytesServedPerMinute: 123, errorsPerMinute: 0 },
      catalogue: { fileCount: 4, totalBytes: 999 } };
  }
  if (url.pathname === "/api/get-provider-usage") {
    return { providers: [{ host: "provider", nickname: "Primary", bytesUsed: 55,
      byteLimit: 100, overLimit: false, password: "secret" }] };
  }
  if (url.searchParams.get("mode") === "queue") {
    return { queue: { noofslots: 1, slots: [{ nzo_id: "1", filename: "<test>",
      status: "Downloading", cat: "Movies", true_percentage: "45",
      percentage: "5", privateUrl: "secret" }] } };
  }
  return { history: { noofslots: 1, slots: [{ nzo_id: "2", name: "Done",
    category: "TV", bytes: 1024, status: "Completed", storage: "private-path" }] } };
}

test("internal dashboard aggregates and allowlists backend data", async (t) => {
  setup(t);
  const calls = [];
  t.mock.method(global, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.headers["x-api-key"], "test-backend-key");
    assert.equal(options.redirect, "error");
    assert.equal(url.searchParams.has("apikey"), false);
    return Response.json(fixture(url));
  });
  const result = await getDashboard();
  assert.equal(calls.length, 4);
  assert.equal(result.backend.reachable, true);
  assert.equal(result.queue.items[0].percentage, 45);
  assert.equal(result.overview.activeReads, 2);
  assert.equal(result.providers[0].name, "Primary");
  assert.equal(result.errors.length, 0);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("private-path"), false);
});

test("external backend only requests SAB-compatible data", async (t) => {
  setup(t, false);
  t.mock.method(global, "fetch", async (url) => {
    assert.equal(url.pathname, "/api");
    return Response.json(fixture(url));
  });
  const result = await getDashboard();
  assert.equal(global.fetch.mock.calls.length, 2);
  assert.equal(result.overview, null);
  assert.equal(result.providers, null);
  assert.equal(result.backend.mode, "external");
});

test("partial failures retain cache and history without pretending queue is empty", async (t) => {
  setup(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(global, "fetch", async (url) => {
    if (url.searchParams.get("mode") === "queue") return new Response("private response", { status: 503 });
    return Response.json(fixture(url));
  });
  const result = await getDashboard();
  assert.equal(result.queue, null);
  assert.equal(result.history.items.length, 1);
  assert.equal(result.caches.disk.entries, 3);
  assert.deepEqual(result.errors, [{ source: "queue", message: "Backend returned HTTP 503" }]);
  assert.equal(JSON.stringify(result).includes("private response"), false);
});

test("invalid responses and network errors are reported without upstream details", async (t) => {
  setup(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(global, "fetch", async (url) => {
    if (url.searchParams.get("mode") === "queue") return Response.json({});
    throw new Error("private URL and credentials");
  });
  const result = await getDashboard();
  assert.equal(result.backend.reachable, false);
  assert.equal(result.queue, null);
  assert.equal(result.errors.length, 4);
  assert.equal(JSON.stringify(result).includes("credentials"), false);
});

test("unconfigured backend reports setup issue and keeps cache statistics", async (t) => {
  setup(t);
  delete process.env.NZBDAV_URL;
  t.mock.method(global, "fetch", () => { throw new Error("must not fetch"); });
  const result = await getDashboard();
  assert.equal(global.fetch.mock.calls.length, 0);
  assert.equal(result.errors[0].source, "backend");
  assert.equal(result.caches.disk.entries, 3);
});

test("timeouts and malformed metric values are explicit partial failures", async (t) => {
  setup(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(global, "fetch", async (url) => {
    if (url.pathname === "/api/get-provider-usage") {
      throw new DOMException("private URL", "TimeoutError");
    }
    if (url.pathname === "/api/get-overview-stats") {
      return Response.json({ tiles: {}, catalogue: {} });
    }
    return Response.json(fixture(url));
  });
  const result = await getDashboard();
  assert.equal(result.overview, null);
  assert.equal(result.providers, null);
  assert.equal(result.history.items.length, 1);
  assert.deepEqual(result.errors, [
    { source: "overview", message: "Backend returned an unexpected response" },
    { source: "providers", message: "Backend request timed out" },
  ]);
});

test("queue progress stays within 0..100 and backend authentication errors are visible", async (t) => {
  setup(t, false);
  t.mock.method(console, "error", () => {});
  t.mock.method(global, "fetch", async (url) => {
    if (url.searchParams.get("mode") === "history") {
      return new Response("private key", { status: 401 });
    }
    const data = fixture(url);
    data.queue.slots[0].true_percentage = "110";
    data.queue.slots.push({ ...data.queue.slots[0], true_percentage: "-5" });
    return Response.json(data);
  });
  const result = await getDashboard();
  assert.deepEqual(result.queue.items.map((item) => item.percentage), [100, 0]);
  assert.equal(result.history, null);
  assert.deepEqual(result.errors, [
    { source: "history", message: "Backend returned HTTP 401" },
  ]);
});
