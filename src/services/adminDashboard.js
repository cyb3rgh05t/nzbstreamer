const cache = require("../cache");
const embeddedNzbdav = require("./embeddedNzbdav");

async function requestBackend(connection, path, validate, options = {}) {
  try {
    const url = new URL(path, `${connection.url.replace(/\/+$/, "")}/`);
    const response = await fetch(url, {
      ...options,
      headers: { "x-api-key": connection.apiKey },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
    const data = await response.json();
    if (!validate(data)) throw new Error("Backend returned an unexpected response");
    return data;
  } catch (error) {
    // Do not forward upstream bodies or URLs, which can contain credentials.
    const message = error.name === "TimeoutError"
      ? "Backend request timed out"
      : /^Backend returned /.test(error.message)
        ? error.message
        : "Backend request failed";
    throw new Error(message);
  }
}

function isSlotList(data, key) {
  const list = data?.[key];
  return Number.isSafeInteger(list?.noofslots) && list.noofslots >= 0 &&
    Array.isArray(list?.slots) &&
    list.slots.every((item) => item && typeof item.status === "string" &&
      (key === "queue"
        ? typeof item.filename === "string" &&
          Number.isFinite(Number(item.true_percentage ?? item.percentage))
        : typeof (item.name || item.nzb_name) === "string" &&
          Number.isFinite(item.bytes)));
}

function isOverview(data) {
  return [
    data?.tiles?.activeReads,
    data?.tiles?.bytesServedPerMinute,
    data?.catalogue?.fileCount,
    data?.catalogue?.totalBytes,
  ].every(Number.isFinite);
}

function isProviderList(data) {
  return Array.isArray(data?.providers) && data.providers.every((item) =>
    item && typeof (item.nickname || item.host) === "string" &&
    Number.isFinite(item.bytesUsed) &&
    (item.byteLimit == null || Number.isFinite(item.byteLimit)) &&
    typeof item.overLimit === "boolean");
}

async function readHistorySnapshot(connection) {
  const items = new Map();
  let total = null;
  for (let start = 0; total === null || start < total;) {
    const data = await requestBackend(connection,
      `api?mode=history&output=json&start=${start}&limit=100&pageSize=100`,
      (data) => isSlotList(data, "history"));
    total ??= data.history.noofslots;
    if (total === 0) break;
    const slots = data.history.slots;
    if (!slots.length) throw new Error("History changed while loading. Please refresh and try again.");
    const previousSize = items.size;
    for (const item of slots) {
      if (typeof item.nzo_id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(item.nzo_id) || item.nzo_id.toLowerCase() === "all") {
        throw new Error("Backend returned an unexpected history identifier.");
      }
      items.set(item.nzo_id, item);
    }
    if (items.size === previousSize) throw new Error("Backend did not advance history pagination.");
    start += slots.length;
  }
  return [...items.values()];
}

async function getHistoryPage(connection, page, failedOnly) {
  if (failedOnly && !embeddedNzbdav.isEnabled()) {
    const items = (await readHistorySnapshot(connection)).filter((item) => item.status === "Failed");
    page = Math.min(page, Math.max(1, Math.ceil(items.length / 10)));
    return { page, history: { noofslots: items.length, slots: items.slice((page - 1) * 10, page * 10) } };
  }
  const load = (number) => requestBackend(
    connection,
    `api?mode=history&output=json&start=${(number - 1) * 10}&limit=10&pageSize=10${failedOnly ? "&failed_only=1" : ""}`,
    (data) => isSlotList(data, "history") &&
      (!failedOnly || data.history.slots.every((item) => item.status === "Failed")),
  );
  let data = await load(page);
  const lastPage = Math.max(1, Math.ceil(data.history.noofslots / 10));
  if (page > lastPage) {
    page = lastPage;
    data = await load(page);
  }
  return { ...data, page };
}

function historyTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

let clearingHistory = false;

async function clearHistory() {
  if (clearingHistory) throw new Error("History is already being cleared.");
  const connection = embeddedNzbdav.getConnectionConfig();
  if (!connection.url || !connection.apiKey) throw new Error("NZBDav is not configured.");
  clearingHistory = true;
  let removed = 0;
  try {
    const items = await readHistorySnapshot(connection);
    for (let start = 0; start < items.length; start += 50) {
      const batch = items.slice(start, start + 50);
      const query = new URLSearchParams({
        mode: "history", name: "delete", output: "json",
        del_files: "0", del_completed_files: "0",
      });
      if (embeddedNzbdav.isEnabled()) {
        batch.forEach((item) => query.append("value", item.nzo_id));
      } else {
        query.set("value", batch.map((item) => item.nzo_id).join(","));
      }
      await requestBackend(connection, `api?${query}`, (data) => data?.status === true, { method: "POST" });
      removed += batch.length;
    }
    return { removed };
  } catch (error) {
    throw new Error(`Could not clear history (${removed} entries already removed): ${error.message}`);
  } finally {
    clearingHistory = false;
  }
}

async function getDashboard({ historyPage = 1, failedOnly = false } = {}) {
  if (typeof failedOnly !== "boolean") throw new TypeError("failedOnly must be a boolean.");
  if (!Number.isSafeInteger(historyPage) || historyPage < 1 ||
      !Number.isSafeInteger((historyPage - 1) * 10) ||
      (historyPage - 1) * 10 > 2147483647) {
    throw new RangeError("historyPage must be a positive page number within the supported range.");
  }
  const stats = cache.getAllCacheStats();
  const connection = embeddedNzbdav.getConnectionConfig();
  const { cacheDir, ...disk } = stats.disk;
  const result = {
    updatedAt: new Date().toISOString(),
    backend: {
      mode: embeddedNzbdav.isEnabled() ? "internal" : "external",
      reachable: false,
    },
    caches: { stream: stats.stream, nzbdav: stats.nzbdav, disk },
    queue: null,
    history: null,
    overview: null,
    providers: null,
    errors: [],
  };
  if (!connection.url || !connection.apiKey) {
    result.errors.push({ source: "backend", message: "NZBDav is not configured." });
    return result;
  }

  const requests = [
    ["queue", "api?mode=queue&output=json&start=0&limit=20", (data) => isSlotList(data, "queue")],
    ["history"],
  ];
  if (embeddedNzbdav.isEnabled()) {
    requests.push(
      ["overview", "api/get-overview-stats?window=24h", isOverview],
      ["providers", "api/get-provider-usage", isProviderList],
    );
  }
  const responses = await Promise.allSettled(
    requests.map(([source, path, validate]) =>
      source === "history"
        ? getHistoryPage(connection, historyPage, failedOnly)
        : requestBackend(connection, path, validate)),
  );
  responses.forEach((response, index) => {
    const source = requests[index][0];
    if (response.status === "rejected") {
      console.error(`[ADMIN DASHBOARD] ${source}: ${response.reason.message}`);
      result.errors.push({ source, message: response.reason.message });
      return;
    }
    const data = response.value;
    if (source === "queue") {
      result.queue = {
        total: data.queue.noofslots,
        items: data.queue.slots.map((item) => ({
          id: item.nzo_id,
          name: item.filename,
          status: item.status,
          category: item.cat,
          percentage: Math.max(0, Math.min(100, Number(item.true_percentage ?? item.percentage))),
        })),
      };
    } else if (source === "history") {
      result.history = {
        total: data.history.noofslots,
        page: data.page,
        pageSize: 10,
        failedOnly,
        items: data.history.slots.slice(0, 10).map((item) => ({
          id: item.nzo_id,
          name: item.name || item.nzb_name,
          status: item.status,
          category: item.category,
          bytes: item.bytes,
          completedAt: historyTimestamp(item.completed),
        })),
      };
    } else if (source === "overview") {
      result.overview = {
        activeReads: data.tiles.activeReads,
        bytesServedPerMinute: data.tiles.bytesServedPerMinute,
        fileCount: data.catalogue.fileCount,
        totalBytes: data.catalogue.totalBytes,
      };
    } else if (source === "providers") {
      result.providers = data.providers.map((item) => ({
        name: item.nickname || item.host,
        bytesUsed: item.bytesUsed,
        byteLimit: item.byteLimit,
        overLimit: item.overLimit,
      }));
    }
  });
  result.backend.reachable = result.queue !== null || result.history !== null;
  return result;
}

module.exports = { getDashboard, clearHistory };
