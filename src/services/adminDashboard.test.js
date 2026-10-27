const { test } = require("node:test");
const assert = require("node:assert/strict");
const embeddedNzbdav = require("./embeddedNzbdav");
const cache = require("../cache");
const { getDashboard } = require("./adminDashboard");
const getBackendConnection = embeddedNzbdav.getConnectionConfig;

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
  t.mock.method(embeddedNzbdav, "getConnectionConfig", () => ({
    url: process.env.NZBDAV_URL,
    apiKey: process.env.NZBDAV_API_KEY,
  }));
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

test("history pagination requests exactly ten items at the correct offset", async (t) => {
  setup(t, false);
  t.mock.method(global, "fetch", async (url) => {
    const data = fixture(url);
    if (url.searchParams.get("mode") === "history") {
      assert.equal(url.searchParams.get("start"), "10");
      assert.equal(url.searchParams.get("limit"), "10");
      assert.equal(url.searchParams.get("pageSize"), "10");
      data.history.noofslots = 25;
      data.history.slots = Array.from({ length: 10 }, (_, index) => ({
        ...data.history.slots[0], nzo_id: String(11 + index), name: `Item ${11 + index}`,
      }));
    }
    return Response.json(data);
  });
  const result = await getDashboard({ historyPage: 2 });
  assert.equal(result.history.page, 2);
  assert.equal(result.history.pageSize, 10);
  assert.equal(result.history.total, 25);
  assert.equal(result.history.items.length, 10);
  assert.equal(result.history.items[0].name, "Item 11");
  assert.equal(result.history.items[9].name, "Item 20");
});

test("history page is clamped and refetched when entries disappear", async (t) => {
  setup(t, false);
  const offsets = [];
  t.mock.method(global, "fetch", async (url) => {
    const data = fixture(url);
    if (url.searchParams.get("mode") === "history") {
      const start = Number(url.searchParams.get("start"));
      offsets.push(start);
      data.history.noofslots = 12;
      data.history.slots = start >= 12 ? [] : Array.from({ length: 2 }, (_, index) => ({
        nzo_id: String(start + index), name: `Item ${start + index}`,
        status: "Completed", category: "TV", bytes: 100,
      }));
    }
    return Response.json(data);
  });
  const result = await getDashboard({ historyPage: 3 });
  assert.deepEqual(offsets, [20, 10]);
  assert.equal(result.history.page, 2);
  assert.equal(result.history.items.length, 2);
});

test("empty history has one empty page", async (t) => {
  setup(t, false);
  t.mock.method(global, "fetch", async (url) => {
    const data = fixture(url);
    if (url.searchParams.get("mode") === "history") {
      data.history = { noofslots: 0, slots: [] };
    }
    return Response.json(data);
  });
  const result = await getDashboard({ historyPage: 5 });
  assert.equal(result.history.page, 1);
  assert.equal(result.history.total, 0);
  assert.deepEqual(result.history.items, []);
});

test("invalid history pages are rejected before any backend request", async (t) => {
  setup(t);
  t.mock.method(global, "fetch", () => { throw new Error("must not fetch"); });
  for (const historyPage of [0, -1, 1.5, NaN, Infinity, "2", 214748366, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(getDashboard({ historyPage }), RangeError);
  }
  assert.equal(global.fetch.mock.calls.length, 0);
});

test("internal dashboard keeps backend credentials when runtime environment is overwritten", async (t) => {
  setup(t);
  const keys = [
    "NZBDAV_BACKEND", "NZBDAV_INTERNAL_PORT", "NZBDAV_WEBDAV_URL",
    "NZBDAV_WEBDAV_USER", "NZBDAV_WEBDAV_PASS", "FRONTEND_BACKEND_API_KEY",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NZBDAV_BACKEND = "internal";
  process.env.NZBDAV_INTERNAL_PORT = "7071";
  embeddedNzbdav.configure();
  const connection = getBackendConnection();
  t.mock.method(embeddedNzbdav, "getConnectionConfig", getBackendConnection);
  process.env.NZBDAV_URL = "http://stale-external-backend.invalid";
  process.env.NZBDAV_API_KEY = "stale-saved-key";
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url.origin, "http://127.0.0.1:7071");
    assert.equal(options.headers["x-api-key"], connection.apiKey);
    assert.notEqual(options.headers["x-api-key"], "stale-saved-key");
    return Response.json(fixture(url));
  });
  const result = await getDashboard();
  assert.equal(global.fetch.mock.calls.length, 4);
  assert.deepEqual(result.errors, []);
  assert.equal(JSON.stringify(result).includes(connection.apiKey), false);
});

test("history stays limited to ten entries when upstream ignores the SAB limit", async (t) => {
  setup(t, false);
  t.mock.method(global, "fetch", async (url) => {
    const data = fixture(url);
    if (url.searchParams.get("mode") === "history") {
      assert.equal(url.searchParams.get("pageSize"), "10");
      const start = Number(url.searchParams.get("start"));
      data.history.noofslots = 510;
      data.history.slots = Array.from({ length: 510 - start }, (_, index) => ({
        nzo_id: String(start + index + 1), name: `Item ${start + index + 1}`,
        status: "Completed", category: "TV", bytes: 100,
      }));
    }
    return Response.json(data);
  });
  for (const page of [1, 2, 51]) {
    const result = await getDashboard({ historyPage: page });
    assert.equal(result.history.items.length, 10);
    assert.equal(result.history.items[0].name, `Item ${(page - 1) * 10 + 1}`);
    assert.equal(result.history.page, page);
    assert.equal(result.history.total, 510);
  }
});
