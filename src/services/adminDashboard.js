const cache = require("../cache");
const embeddedNzbdav = require("./embeddedNzbdav");

async function requestBackend(path, validate) {
  try {
    const url = new URL(path, `${process.env.NZBDAV_URL.replace(/\/+$/, "")}/`);
    const response = await fetch(url, {
      headers: { "x-api-key": process.env.NZBDAV_API_KEY },
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
  return Number.isFinite(list?.noofslots) &&
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

async function getDashboard() {
  const stats = cache.getAllCacheStats();
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
  if (!process.env.NZBDAV_URL || !process.env.NZBDAV_API_KEY) {
    result.errors.push({ source: "backend", message: "NZBDav is not configured." });
    return result;
  }

  const requests = [
    ["queue", "api?mode=queue&output=json&start=0&limit=20", (data) => isSlotList(data, "queue")],
    ["history", "api?mode=history&output=json&start=0&limit=20", (data) => isSlotList(data, "history")],
  ];
  if (embeddedNzbdav.isEnabled()) {
    requests.push(
      ["overview", "api/get-overview-stats?window=24h", isOverview],
      ["providers", "api/get-provider-usage", isProviderList],
    );
  }
  const responses = await Promise.allSettled(
    requests.map(([, path, validate]) => requestBackend(path, validate)),
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
        items: data.history.slots.map((item) => ({
          id: item.nzo_id,
          name: item.name || item.nzb_name,
          status: item.status,
          category: item.category,
          bytes: item.bytes,
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

module.exports = { getDashboard };
