const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHealthMonitor } = require("./healthMonitor");

function setup(overrides = {}) {
  let failing = false;
  const sent = [];
  const values = {
    NZB_TRIAGE_NNTP_HOST: "provider.invalid",
    HEALTH_TELEGRAM_BOT_TOKEN: "private-token",
    HEALTH_TELEGRAM_CHAT_ID: "123",
    HEALTH_DISCORD_WEBHOOK_URL:
      "https://discord.com/api/webhooks/123/private-token",
  };
  const monitor = createHealthMonitor({
    getValues: () => values,
    tests: {
      testUsenetConnection: async () => {
        if (failing) throw new Error("private-token private-password");
      },
    },
    indexers: { getNewznabConfigsFromValues: () => [] },
    request: async (url, options) => {
      sent.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    },
    ...overrides,
  });
  return {
    monitor,
    sent,
    values,
    fail: () => {
      failing = true;
    },
    recover: () => {
      failing = false;
    },
  };
}

test("notifies confirmed outages and recovery once per channel without leaking credentials", async () => {
  const { monitor, sent, fail, recover } = setup();
  await monitor.checkNow();
  assert.equal(sent.length, 0);
  fail();
  await monitor.checkNow();
  assert.equal(sent.length, 0);
  await monitor.checkNow();
  assert.equal(sent.length, 2);
  await monitor.checkNow();
  assert.equal(sent.length, 2);
  assert.equal(
    JSON.stringify(monitor.getSnapshot()).includes("private"),
    false,
  );
  assert.equal(JSON.stringify(sent).includes("private"), false);
  recover();
  await monitor.checkNow();
  assert.equal(sent.length, 4);
  await monitor.checkNow();
  assert.equal(sent.length, 4);
});

test("collects enabled Newznab targets separately, even with no backend", async () => {
  const checked = [];
  const { monitor, values } = setup({
    indexers: {
      getNewznabConfigsFromValues: () => [
        {
          id: "01",
          enabled: true,
          endpoint: "https://indexer.invalid",
          displayName: "Indexer A",
        },
        { id: "02", enabled: false, endpoint: "https://disabled.invalid" },
      ],
      validateNewznabSearch: async (config) => {
        checked.push(config.id);
      },
    },
  });
  delete values.NZB_TRIAGE_NNTP_HOST;
  const result = await monitor.checkNow();
  assert.deepEqual(checked, ["01"]);
  assert.equal(result[0].name, "Indexer A");
  assert.equal(result[0].kind, "indexer");
  assert.equal(JSON.stringify(result).includes("endpoint"), false);
});

test("concurrent checks share a single run and snapshots cannot be mutated", async () => {
  const { monitor } = setup();
  const first = monitor.checkNow();
  assert.equal(monitor.checkNow(), first);
  await first;
  monitor.getSnapshot()[0].status = "changed";
  assert.equal(monitor.getSnapshot()[0].status, "healthy");
});

test("disabled monitoring clears results without probing services", async () => {
  const { monitor, values, sent } = setup({
    tests: {
      testUsenetConnection: async () => {
        throw new Error("must not probe");
      },
    },
  });
  values.HEALTH_MONITOR_ENABLED = "false";
  assert.deepEqual(await monitor.checkNow(), []);
  assert.deepEqual(sent, []);
});

test("disabled managers and Newznab are skipped while enabled Easynews is tested", async () => {
  let checked = 0;
  const { monitor, values } = setup({
    indexers: {
      getNewznabConfigsFromValues: () => {
        throw new Error("disabled Newznab");
      },
    },
    easynewsService: {
      testEasynewsCredentials: async () => {
        checked += 1;
      },
    },
  });
  delete values.NZB_TRIAGE_NNTP_HOST;
  Object.assign(values, {
    NEWZNAB_ENABLED: "false",
    INDEXER_MANAGER: "none",
    INDEXER_MANAGER_URL: "https://disabled.invalid",
    EASYNEWS_ENABLED: "true",
  });
  const result = await monitor.checkNow();
  assert.equal(checked, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Easynews");
});

test("failed delivery is retried only for the failed channel", async (t) => {
  t.mock.method(console, "warn", () => {});
  let telegramAttempts = 0;
  let discordAttempts = 0;
  const { monitor, fail, recover } = setup({
    request: async (url) => {
      if (String(url).includes("telegram.org")) {
        telegramAttempts += 1;
        return Response.json({ ok: telegramAttempts > 1 });
      }
      discordAttempts += 1;
      return new Response(null, { status: 204 });
    },
  });
  fail();
  await monitor.checkNow();
  await monitor.checkNow();
  assert.equal(telegramAttempts, 1);
  assert.equal(discordAttempts, 1);
  await monitor.checkNow();
  assert.equal(telegramAttempts, 2);
  assert.equal(discordAttempts, 1);
  recover();
  await monitor.checkNow();
  assert.equal(telegramAttempts, 3);
  assert.equal(discordAttempts, 2);
});

test("manual notification tests validate settings and do not expose delivery errors", async () => {
  let attempts = 0;
  const { monitor, values } = setup({
    request: async () => {
      attempts += 1;
      throw new Error("private-token private-password");
    },
  });
  values.HEALTH_DISCORD_WEBHOOK_URL =
    "https://private.invalid/api/webhooks/123/private-token";
  await assert.rejects(
    monitor.testNotification(values, "discord"),
    /Check settings and network access/,
  );
  assert.equal(attempts, 0);
  await assert.rejects(
    monitor.testNotification(values, "telegram"),
    (error) => !error.message.includes("private"),
  );
  assert.equal(attempts, 1);
  await assert.rejects(
    monitor.testNotification({}, "telegram"),
    /Could not send/,
  );
});

test("notification credentials use existing masking and sentinel roundtripping", () => {
  const {
    maskSensitiveValues,
    CREDENTIAL_MASK_SENTINEL,
  } = require("../utils/credentialMask");
  const result = maskSensitiveValues({
    HEALTH_TELEGRAM_BOT_TOKEN: "private-token",
    HEALTH_DISCORD_WEBHOOK_URL:
      "https://discord.com/api/webhooks/123/private-token",
    HEALTH_TELEGRAM_CHAT_ID: "123",
  });
  assert.equal(result.HEALTH_TELEGRAM_BOT_TOKEN, CREDENTIAL_MASK_SENTINEL);
  assert.equal(result.HEALTH_DISCORD_WEBHOOK_URL, CREDENTIAL_MASK_SENTINEL);
  assert.equal(result.HEALTH_TELEGRAM_CHAT_ID, "123");
});

test("strict manager checks reject failed Hydra searches instead of caps-only success", async (t) => {
  const axios = require("axios");
  const { testIndexerConnection } = require("../utils/connectionTests");
  t.mock.method(axios, "get", async (url, options) => ({
    status: options.params.t === "caps" ? 200 : 503,
    data: options.params.t === "caps" ? { version: "1" } : "unavailable",
  }));
  const values = {
    INDEXER_MANAGER: "nzbhydra",
    INDEXER_MANAGER_URL: "https://hydra.invalid",
    INDEXER_MANAGER_API_KEY: "test-key",
  };
  await assert.rejects(
    testIndexerConnection(values, { strict: true }),
    /HTTP 503/,
  );
  assert.match(await testIndexerConnection(values), /Connected to NZBHydra/);
});

test("strict managers reject HTML and HTTP-200 API errors, and accept real empty feeds", async (t) => {
  const axios = require("axios");
  const { testIndexerConnection } = require("../utils/connectionTests");
  let data = "<html><body>Login</body></html>";
  t.mock.method(axios, "get", async () => ({ status: 200, data }));
  const values = {
    INDEXER_MANAGER: "prowlarr",
    INDEXER_MANAGER_URL: "https://manager.invalid",
    INDEXER_MANAGER_API_KEY: "test-key",
  };
  await assert.rejects(
    testIndexerConnection(values, { strict: true }),
    /Unexpected response/,
  );
  values.INDEXER_MANAGER = "nzbhydra";
  await assert.rejects(
    testIndexerConnection(values, { strict: true }),
    /Unexpected search response/,
  );
  data = { error: { code: "100", description: "Wrong api key" } };
  await assert.rejects(
    testIndexerConnection(values, { strict: true }),
    /Unauthorized/,
  );
  data = { channel: { title: "Empty results" } };
  assert.match(
    await testIndexerConnection(values, { strict: true }),
    /Connected/,
  );
});

test("strict Newznab validates empty RSS but rejects HTML and API errors", async (t) => {
  const axios = require("axios");
  const { validateNewznabSearch } = require("./newznab");
  const config = {
    endpoint: "https://indexer.invalid",
    apiPath: "/api",
    apiKey: "test-key",
  };
  let data = "<html><body>Login</body></html>";
  t.mock.method(axios, "get", async (url, options) => {
    assert.equal(options.params.limit, 1);
    return { status: 200, data, headers: {} };
  });
  const options = { strictResponse: true, limit: 1 };
  await assert.rejects(
    validateNewznabSearch(config, options),
    /missing RSS channel/,
  );
  data = '<error code="100" description="Wrong api key" />';
  await assert.rejects(validateNewznabSearch(config, options), /Wrong api key/);
  data = "<rss><channel><title>Empty results</title></channel></rss>";
  assert.equal(await validateNewznabSearch(config, options), "API validated");
});
