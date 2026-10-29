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

test("Telegram and Discord can be disabled independently for outages and recoveries", async () => {
  for (const disabled of ["telegram", "discord"]) {
    const { monitor, sent, values, fail, recover } = setup();
    values[`HEALTH_${disabled.toUpperCase()}_ENABLED`] = "false";
    fail();
    await monitor.checkNow();
    await monitor.checkNow();
    assert.equal(sent.length, 1);
    assert.equal(Boolean(sent[0].embeds), disabled === "telegram");
    recover();
    await monitor.checkNow();
    assert.equal(sent.length, 2);
    assert.equal(Boolean(sent[1].embeds), disabled === "telegram");
    assert.equal(values.HEALTH_TELEGRAM_BOT_TOKEN, "private-token");
    assert.ok(values.HEALTH_DISCORD_WEBHOOK_URL.includes("private-token"));
  }
});

test("disabling both notification channels preserves dashboard health checks", async () => {
  const { monitor, sent, values, fail } = setup();
  values.HEALTH_TELEGRAM_ENABLED = "false";
  values.HEALTH_DISCORD_ENABLED = "false";
  fail();
  await monitor.checkNow();
  await monitor.checkNow();
  assert.equal(sent.length, 0);
  assert.equal(monitor.getSnapshot()[0].status, "unhealthy");
  await assert.rejects(
    monitor.testNotification(values, "telegram"),
    /Telegram notifications are disabled/,
  );
  await assert.rejects(
    monitor.testNotification(values, "discord"),
    /Discord notifications are disabled/,
  );
  assert.equal(sent.length, 0);
});

test("reenabling a channel reports an ongoing outage without duplicating the other channel", async () => {
  const { monitor, sent, values, fail } = setup();
  fail();
  await monitor.checkNow();
  await monitor.checkNow();
  assert.equal(sent.length, 2);
  values.HEALTH_TELEGRAM_ENABLED = "false";
  await monitor.checkNow();
  assert.equal(sent.length, 2);
  values.HEALTH_TELEGRAM_ENABLED = "true";
  await monitor.checkNow();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].parse_mode, "HTML");
});

test("outage and recovery use styled messages with timestamps and observed downtime", async () => {
  let time = Date.parse("2026-10-29T10:00:00Z");
  const { monitor, sent, fail, recover, values } = setup({ now: () => time });
  values.HEALTH_CHECK_INTERVAL_MINUTES = "5";
  fail();
  await monitor.checkNow();
  time += 300000;
  await monitor.checkNow();
  const telegram = sent[0];
  const discord = sent[1];
  assert.equal(telegram.parse_mode, "HTML");
  assert.match(telegram.text, /<b>SERVICE UNAVAILABLE<\/b>/);
  assert.match(telegram.text, /<b>Failed checks:<\/b> 2/);
  assert.equal(telegram.link_preview_options.is_disabled, true);
  assert.equal(discord.username, "NZBStreamer");
  assert.equal(discord.embeds[0].color, 0xef4444);
  assert.equal(discord.embeds[0].timestamp, "2026-10-29T10:05:00.000Z");
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  time += 300000;
  recover();
  await monitor.checkNow();
  assert.match(sent[2].text, /<b>BACK ONLINE<\/b>/);
  assert.match(sent[2].text, /<b>Observed downtime:<\/b> 10m/);
  assert.equal(sent[3].embeds[0].color, 0x22c55e);
});

test("rich test notifications use the gold brand style without pretending there is an outage", async () => {
  const { monitor, sent, values } = setup();
  await monitor.testNotification(values, "telegram");
  await monitor.testNotification(values, "discord");
  assert.match(sent[0].text, /<b>NOTIFICATIONS CONNECTED<\/b>/);
  assert.match(sent[0].text, /<b>Channel:<\/b> Telegram/);
  assert.equal(sent[1].embeds[0].title, "Notifications connected");
  assert.equal(sent[1].embeds[0].color, 0xe5a209);
  assert.equal(JSON.stringify(sent).includes("private"), false);
});

test("service labels are escaped and bounded in both notification formats", async () => {
  const { monitor, sent } = setup({
    indexers: {
      getNewznabConfigsFromValues: () => [
        {
          id: "01",
          enabled: true,
          endpoint: "https://indexer.invalid",
          displayName: "<b>Indexer & [one]</b> " + "name".repeat(500),
        },
      ],
      validateNewznabSearch: async () => {
        throw new Error("private-key");
      },
    },
  });
  await monitor.checkNow();
  await monitor.checkNow();
  assert.match(sent[0].text, /&lt;b&gt;Indexer &amp; \[one\]&lt;\/b&gt;/);
  assert.equal(sent[0].text.includes("<b>Indexer"), false);
  assert.match(sent[1].embeds[0].fields[0].value, /\\\[one\\\]/);
  assert.ok(sent[0].text.length < 4096);
  assert.ok(sent[1].embeds[0].fields[0].value.length <= 1024);
});

test("recovery delivery retries preserve the detected recovery time and downtime", async (t) => {
  t.mock.method(console, "warn", () => {});
  let time = Date.parse("2026-10-29T10:00:00Z");
  let recoveryAttempts = 0;
  const deliveries = [];
  const { monitor, values, fail, recover } = setup({
    now: () => time,
    request: async (url, options) => {
      const body = JSON.parse(options.body);
      deliveries.push(body);
      if (body.embeds[0].title === "Back online" && ++recoveryAttempts === 1) {
        throw new Error("Temporary delivery failure");
      }
      return new Response(null, { status: 204 });
    },
  });
  delete values.HEALTH_TELEGRAM_BOT_TOKEN;
  fail();
  await monitor.checkNow();
  time += 300000;
  await monitor.checkNow();
  time += 300000;
  recover();
  await monitor.checkNow();
  time += 3600000;
  await monitor.checkNow();
  assert.equal(deliveries.length, 3);
  assert.deepEqual(deliveries[1], deliveries[2]);
  assert.equal(deliveries[2].embeds[0].timestamp, "2026-10-29T10:10:00.000Z");
  assert.equal(
    deliveries[2].embeds[0].fields.find(
      (field) => field.name === "Observed downtime",
    ).value,
    "10m",
  );
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
