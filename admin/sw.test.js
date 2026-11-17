const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWorker(scope = "https://example.test/admin/") {
  const handlers = {};
  const self = {
    location: new URL(scope),
    registration: { scope },
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "sw.js"), "utf8"), {
    self,
    URL,
    caches: {
      match: () => {
        throw new Error("must not cache API");
      },
    },
    fetch: () => {
      throw new Error("API must bypass the service worker");
    },
  });
  return handlers.fetch;
}

test("admin API requests always bypass the service worker cache", () => {
  for (const scope of [
    "https://example.test/admin/",
    "https://example.test/token/admin/",
  ]) {
    const handleFetch = loadWorker(scope);
    for (const endpoint of [
      "api/dashboard?refreshChecks=true",
      "api/dashboard?refreshChecks=false",
      "api/config",
      "api/auth/session",
    ]) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let intercepted = false;
        handleFetch({
          request: { url: new URL(endpoint, scope).href, method: "GET" },
          respondWith: () => {
            intercepted = true;
          },
        });
        assert.equal(intercepted, false, `${scope}${endpoint}`);
      }
    }
  }
});

test("application shell continues to use the service worker", () => {
  let intercepted = false;
  const response = Promise.resolve({ clone: () => ({}) });
  const handlers = {};
  const self = {
    location: new URL("https://example.test/admin/"),
    registration: { scope: "https://example.test/admin/" },
    addEventListener: (type, handler) => {
      handlers[type] = handler;
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "sw.js"), "utf8"), {
    self,
    URL,
    caches: { open: async () => ({ put: () => {} }) },
    fetch: () => response,
  });
  handlers.fetch({
    request: { url: "https://example.test/admin/app.js", method: "GET" },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, true);
});
