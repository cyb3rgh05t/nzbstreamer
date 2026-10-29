const connectionTests = require("../utils/connectionTests");
const newznab = require("./newznab");
const easynews = require("./easynews");

function safeFailure(error) {
  const status =
    error?.response?.status ||
    Number(error?.message?.match(/\bHTTP (\d{3})\b/)?.[1]);
  if (
    status === 401 ||
    status === 403 ||
    /Unauthorized|authentication|api key/i.test(error?.message || "")
  ) {
    return "Authentication failed; check credentials and subscription.";
  }
  if (status === 429) return "API rate limit reached.";
  if (Number.isInteger(status)) return `API returned HTTP ${status}.`;
  if (
    /timeout|timed out/i.test(error?.message || "") ||
    ["ETIMEDOUT", "ECONNABORTED"].includes(error?.code)
  ) {
    return "Connection timed out.";
  }
  return "Connection or API validation failed.";
}

function createHealthMonitor({
  getValues = () => process.env,
  tests = connectionTests,
  indexers = newznab,
  easynewsService = easynews,
  request = (...args) => fetch(...args),
} = {}) {
  let snapshot = [];
  let running = null;
  let timer = null;
  const states = new Map();
  const enabled = (value) =>
    !["false", "0", "off", "no"].includes(
      String(value ?? "true").toLowerCase(),
    );

  function targets(values) {
    const items = [];
    if (values.NZB_TRIAGE_NNTP_HOST)
      items.push({
        id: "provider",
        kind: "provider",
        name: "Usenet provider",
        check: () => tests.testUsenetConnection(values),
      });
    if (values.INDEXER_MANAGER_URL && values.INDEXER_MANAGER !== "none")
      items.push({
        id: "manager",
        kind: "indexer",
        name:
          values.INDEXER_MANAGER === "nzbhydra"
            ? "NZBHydra"
            : "Indexer manager",
        check: () => tests.testIndexerConnection(values, { strict: true }),
      });
    if (enabled(values.EASYNEWS_ENABLED ?? "false"))
      items.push({
        id: "easynews",
        kind: "provider",
        name: "Easynews",
        check: () =>
          easynewsService.testEasynewsCredentials({
            username: values.EASYNEWS_USERNAME,
            password: values.EASYNEWS_PASSWORD,
          }),
      });
    for (const config of enabled(values.NEWZNAB_ENABLED)
      ? indexers.getNewznabConfigsFromValues(values)
      : []) {
      if (!config.enabled || !config.endpoint) continue;
      items.push({
        id: `newznab:${config.id}`,
        kind: "indexer",
        name: config.displayName || "Newznab",
        check: () =>
          indexers.validateNewznabSearch(config, {
            query: "usenetstreamer",
            debug: false,
            strictResponse: true,
            limit: 1,
            timeoutMs: 8000,
          }),
      });
    }
    return items;
  }

  async function send(values, text, channel) {
    let url;
    let body;
    if (channel === "telegram") {
      if (!values.HEALTH_TELEGRAM_BOT_TOKEN || !values.HEALTH_TELEGRAM_CHAT_ID)
        return false;
      url = `https://api.telegram.org/bot${values.HEALTH_TELEGRAM_BOT_TOKEN}/sendMessage`;
      body = { chat_id: values.HEALTH_TELEGRAM_CHAT_ID, text };
    } else {
      if (!values.HEALTH_DISCORD_WEBHOOK_URL) return false;
      const webhook = new URL(values.HEALTH_DISCORD_WEBHOOK_URL);
      if (
        webhook.protocol !== "https:" ||
        !["discord.com", "discordapp.com"].includes(webhook.hostname) ||
        !/^\/api\/webhooks\/[^/]+\/[^/]+$/.test(webhook.pathname)
      ) {
        throw new Error("Invalid Discord webhook");
      }
      url = webhook;
      body = { content: text, allowed_mentions: { parse: [] } };
    }
    const response = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Notification delivery failed");
    if (channel === "telegram" && (await response.json()).ok !== true) {
      throw new Error("Notification delivery failed");
    }
    return true;
  }

  async function run() {
    const values = { ...getValues() };
    if (!enabled(values.HEALTH_MONITOR_ENABLED)) {
      snapshot = [];
      states.clear();
      return [];
    }
    const items = targets(values);
    const active = new Set(items.map((item) => item.id));
    for (const id of states.keys()) if (!active.has(id)) states.delete(id);
    snapshot = await Promise.all(
      items.map(async (item) => {
        let status = "healthy";
        let message = "Connection verified.";
        try {
          await item.check();
        } catch (error) {
          status = "unhealthy";
          message = safeFailure(error);
        }
        return {
          id: item.id,
          kind: item.kind,
          name: item.name,
          status,
          message,
          checkedAt: new Date().toISOString(),
        };
      }),
    );
    await Promise.all(
      snapshot.map(async (item) => {
        const state = states.get(item.id) || { failures: 0, announced: {} };
        state.failures = item.status === "unhealthy" ? state.failures + 1 : 0;
        states.set(item.id, state);
        if (item.status === "unhealthy" && state.failures < 2) return;
        const text = `NZBStreamer: ${item.name} ${item.status === "healthy" ? "recovered" : "unavailable"}. ${item.message}`;
        await Promise.all(
          ["telegram", "discord"].map(async (channel) => {
            if (state.announced[channel] === item.status) return;
            if (!state.announced[channel] && item.status === "healthy") return;
            try {
              if (await send(values, text, channel))
                state.announced[channel] = item.status;
            } catch {
              console.warn(`[HEALTH] ${channel} notification delivery failed.`);
            }
          }),
        );
      }),
    );
    return getSnapshot();
  }

  function checkNow() {
    if (!running)
      running = run().finally(() => {
        running = null;
      });
    return running;
  }

  function getSnapshot() {
    return snapshot.map((item) => ({ ...item }));
  }

  async function testNotification(values, channel) {
    if (!["telegram", "discord"].includes(channel))
      throw new Error("Unknown notification channel.");
    try {
      const sent = await send(
        values,
        "NZBStreamer: test notification. Delivery is working.",
        channel,
      );
      if (!sent) throw new Error("Missing notification settings.");
    } catch {
      throw new Error(
        `Could not send ${channel} test notification. Check settings and network access.`,
      );
    }
    return "Test notification sent.";
  }

  function start() {
    if (timer) return;
    const tick = async () => {
      try {
        await checkNow();
      } catch {
        console.warn("[HEALTH] Health check failed.");
      }
      const minutes = Number(getValues().HEALTH_CHECK_INTERVAL_MINUTES) || 5;
      if (timer)
        timer = setTimeout(
          tick,
          Math.min(1440, Math.max(1, minutes)) * 60000,
        ).unref();
    };
    timer = setTimeout(tick, 1000).unref();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  return { checkNow, getSnapshot, testNotification, start, stop };
}

module.exports = { createHealthMonitor, ...createHealthMonitor() };
