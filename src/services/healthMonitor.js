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

function checkInterval(values) {
  return Math.min(
    1440,
    Math.max(1, Number(values.HEALTH_CHECK_INTERVAL_MINUTES) || 5),
  );
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [
    days && `${days}d`,
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    !days && !hours && !minutes && `${seconds}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildNotification(event) {
  const styles = {
    unhealthy: {
      title: "Service unavailable",
      color: 0xef4444,
      summary: "Repeated checks failed. This service needs attention.",
    },
    healthy: {
      title: "Back online",
      color: 0x22c55e,
      summary: "The connection is working again. Service has recovered.",
    },
    test: {
      title: "Notifications connected",
      color: 0xe5a209,
      summary:
        "Test delivered successfully. This channel is ready for service alerts.",
    },
  };
  const style = styles[event.status];
  const fields =
    event.status === "test"
      ? [{ name: "Channel", value: event.name }]
      : [
          { name: "Service", value: event.name },
          {
            name: "Type",
            value:
              event.kind === "provider"
                ? "Usenet provider"
                : "Indexer / Newznab",
          },
          {
            name: event.status === "healthy" ? "Status" : "Reason",
            value: event.message,
          },
        ];
  if (event.status === "unhealthy")
    fields.push({ name: "Failed checks", value: String(event.failures) });
  if (event.firstFailureAt)
    fields.push({
      name: "First detected",
      value: event.firstFailureAt
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC"),
    });
  if (event.downtimeMs !== undefined)
    fields.push({
      name: "Observed downtime",
      value: formatDuration(event.downtimeMs),
    });
  fields.push({
    name: "Check interval",
    value: `${event.intervalMinutes} min`,
  });
  const clean = (value) =>
    String(value)
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 300);
  const escapeHtml = (value) =>
    clean(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const escapeMarkdown = (value) =>
    clean(value).replace(/([\\`*_{}\[\]()<>~|])/g, "\\$1");
  const timestamp = event.checkedAt
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
  return {
    text: [
      "<b>NZBStreamer</b>",
      `<b>${style.title.toUpperCase()}</b>`,
      "",
      style.summary,
      "",
      ...fields.map(
        (field) => `<b>${field.name}:</b> ${escapeHtml(field.value)}`,
      ),
      "",
      `<i>Service Monitor | ${timestamp}</i>`,
    ].join("\n"),
    embed: {
      author: { name: "NZBStreamer | Service Monitor" },
      title: style.title,
      description: style.summary,
      color: style.color,
      fields: fields.map((field) => ({
        name: field.name,
        value: escapeMarkdown(field.value),
        inline: [
          "Service",
          "Type",
          "Channel",
          "Failed checks",
          "Check interval",
        ].includes(field.name),
      })),
      timestamp: event.checkedAt,
      footer: { text: "NZBStreamer | Automated service monitoring" },
    },
  };
}

function createHealthMonitor({
  getValues = () => process.env,
  tests = connectionTests,
  indexers = newznab,
  easynewsService = easynews,
  request = (...args) => fetch(...args),
  now = () => Date.now(),
} = {}) {
  let snapshot = [];
  let running = null;
  let timer = null;
  const states = new Map();
  const enabled = (value) =>
    !["false", "0", "off", "no"].includes(
      String(value ?? "true").toLowerCase(),
    );
  const channelEnabled = (values, channel) =>
    enabled(values[`HEALTH_${channel.toUpperCase()}_ENABLED`]);

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

  async function send(values, notification, channel) {
    if (!channelEnabled(values, channel)) return false;
    let url;
    let body;
    if (channel === "telegram") {
      if (!values.HEALTH_TELEGRAM_BOT_TOKEN || !values.HEALTH_TELEGRAM_CHAT_ID)
        return false;
      url = `https://api.telegram.org/bot${values.HEALTH_TELEGRAM_BOT_TOKEN}/sendMessage`;
      body = {
        chat_id: values.HEALTH_TELEGRAM_CHAT_ID,
        text: notification.text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      };
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
      body = {
        username: "NZBStreamer",
        embeds: [notification.embed],
        allowed_mentions: { parse: [] },
      };
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
          checkedAt: new Date(now()).toISOString(),
        };
      }),
    );
    await Promise.all(
      snapshot.map(async (item) => {
        const state = states.get(item.id) || { failures: 0, announced: {} };
        if (item.status === "unhealthy" && state.failures === 0) {
          state.firstFailureAt = item.checkedAt;
          state.recoveredAt = null;
        }
        if (
          item.status === "healthy" &&
          state.firstFailureAt &&
          !state.recoveredAt
        ) {
          state.recoveredAt = item.checkedAt;
        }
        state.failures = item.status === "unhealthy" ? state.failures + 1 : 0;
        states.set(item.id, state);
        if (item.status === "unhealthy" && state.failures < 2) return;
        const notification = buildNotification({
          ...item,
          checkedAt: state.recoveredAt || item.checkedAt,
          failures: state.failures,
          firstFailureAt: state.firstFailureAt,
          downtimeMs: state.recoveredAt
            ? Date.parse(state.recoveredAt) - Date.parse(state.firstFailureAt)
            : undefined,
          intervalMinutes: checkInterval(values),
        });
        await Promise.all(
          ["telegram", "discord"].map(async (channel) => {
            if (!channelEnabled(values, channel)) {
              delete state.announced[channel];
              return;
            }
            if (state.announced[channel] === item.status) return;
            if (!state.announced[channel] && item.status === "healthy") return;
            try {
              if (await send(values, notification, channel))
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
    if (!channelEnabled(values, channel))
      throw new Error(
        `${channel === "telegram" ? "Telegram" : "Discord"} notifications are disabled.`,
      );
    try {
      const sent = await send(
        values,
        buildNotification({
          status: "test",
          name: channel === "telegram" ? "Telegram" : "Discord",
          checkedAt: new Date(now()).toISOString(),
          intervalMinutes: checkInterval(values),
        }),
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
      const minutes = checkInterval(getValues());
      if (timer) timer = setTimeout(tick, minutes * 60000).unref();
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
