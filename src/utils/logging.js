const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api.?key|authorization|cookie|credential/i;
const fs = require("fs");
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

let consoleLoggingInstalled = false;
let secretValues = [];

function refreshSecrets() {
  secretValues = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        SENSITIVE_KEY_PATTERN.test(key) &&
        typeof value === "string" &&
        value.length >= 4,
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

function redactText(text) {
  let safeText = String(text);
  for (const secret of secretValues) {
    safeText = safeText.split(secret).join("[REDACTED]");
  }
  return safeText;
}

function redactValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.code ? { code: value.code } : {}),
    };
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) &&
      (typeof entry === "string" || typeof entry === "object")
        ? "[REDACTED]"
        : redactValue(entry, seen),
    ]),
  );
}

function formatArgument(value) {
  if (typeof value === "string") return redactText(value);
  return formatHumanValue(redactValue(value));
}

function formatHumanValue(value) {
  if (typeof value === "undefined") return "not set";
  if (value === null) return "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(formatHumanValue).join(", ") : "none";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).map(
      ([key, entry]) => `${formatLogKey(key)}: ${formatHumanValue(entry)}`,
    );
    return entries.length ? entries.join(" | ") : "none";
  }
  return String(value);
}

function formatLogKey(key) {
  const labels = {
    hasApiKey: "API key configured",
    tmdbEnabled: "TMDb enabled",
    tvdbEnabled: "TVDB enabled",
    adminLoginConfigured: "admin login configured",
    legacySharedSecretConfigured: "legacy shared secret configured",
    streamTokenConfigured: "stream token configured",
    managerUrlConfigured: "indexer manager URL configured",
    providerSynchronized: "NNTP provider synchronized",
    externalUrlConfigured: "external backend URL configured",
    jsonValuesLoaded: "JSON config values loaded",
    runtimeEnvValues: "runtime config values",
    runtimeOverridesJsonKeys: "runtime overrides JSON keys",
  };
  if (labels[key]) return labels[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bapi\b/gi, "API")
    .replace(/\btmdb\b/gi, "TMDb")
    .replace(/\btvdb\b/gi, "TVDB")
    .replace(/\bnntp\b/gi, "NNTP")
    .replace(/\burl\b/gi, "URL")
    .replace(/\bhttp\b/gi, "HTTP")
    .toLowerCase();
}

function normalizeMessage(args) {
  return args
    .map(formatArgument)
    .join(" ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getArea(tag) {
  const normalized = tag.toUpperCase();
  if (normalized.includes("NZBDAV INTERNAL")) return "BACKEND/NZBDAV";
  if (normalized.includes("NZBDAV")) return "STREAM/NZBDAV";
  if (normalized.includes("NEWZNAB") || normalized.includes("INDEXER")) {
    return "INDEXERS/NEWZNAB";
  }
  if (normalized.includes("PROWLARR") || normalized.includes("HYDRA")) {
    return "INDEXERS/MANAGER";
  }
  if (normalized.includes("TMDB")) return "METADATA/TMDB";
  if (normalized.includes("TVDB")) return "METADATA/TVDB";
  if (normalized.includes("ANIME") || normalized.includes("CINEMETA")) {
    return "METADATA/IDS";
  }
  if (normalized.includes("NNTP") || normalized.includes("TRIAGE")) {
    return "PROVIDERS/NNTP";
  }
  if (normalized.includes("SECURITY") || normalized.includes("AUTH")) {
    return "SECURITY";
  }
  if (normalized.includes("ADMIN")) return "ADMIN";
  if (normalized.includes("CACHE")) return "CACHE";
  if (normalized.includes("REQUEST") || normalized.includes("STREAM")) {
    return "STREAMING";
  }
  if (normalized.includes("CONFIG") || normalized.includes("MIGRATION")) {
    return "CONFIG";
  }
  if (normalized.includes("HTTP")) return "HTTP";
  return "APP";
}

function timestamp() {
  if ((process.env.LOG_TIMESTAMPS || "auto").trim().toLowerCase() === "never") {
    return "";
  }
  return new Date().toISOString();
}

function colorsEnabled() {
  const setting = (process.env.LOG_COLORS || "auto").trim().toLowerCase();
  if (setting === "always" || setting === "true" || setting === "1")
    return true;
  if (setting === "never" || setting === "false" || setting === "0")
    return false;
  return !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
}

function write(level, area, message, stream = process.stdout) {
  const colors = colorsEnabled();
  const time = timestamp();
  const levelColor =
    level === "ERROR"
      ? ANSI.red
      : level === "WARN"
        ? ANSI.yellow
        : message.includes(" ready") || message.includes("started")
          ? ANSI.green
          : ANSI.cyan;
  const areaColor = area.startsWith("HTTP/") ? ANSI.blue : ANSI.magenta;
  const timePrefix = time
    ? colors
      ? `${ANSI.dim}${time}${ANSI.reset} `
      : `${time} `
    : "";
  stream.write(
    `${timePrefix}${colors ? `${levelColor}${level.padEnd(5)}${ANSI.reset}` : level.padEnd(5)} ${colors ? `${areaColor}[${area}]${ANSI.reset}` : `[${area}]`} ${message}\n`,
  );
}

function installConsoleLogging() {
  if (consoleLoggingInstalled) return;
  refreshSecrets();
  for (const [method, level] of [
    ["log", "INFO"],
    ["info", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],
  ]) {
    console[method] = (...args) => {
      const message = normalizeMessage(args);
      const tagMatch = message.match(/^\[([^\]]+)\]\s*/);
      const tag = tagMatch ? tagMatch[1] : "APP";
      const detail = tagMatch ? message.slice(tagMatch[0].length) : message;
      write(
        level,
        getArea(tag),
        detail,
        level === "ERROR" ? process.stderr : process.stdout,
      );
    };
  }
  consoleLoggingInstalled = true;
}

function safeRequestPath(requestPath) {
  const parts = String(requestPath || "/").split("/");
  const resources = new Set([
    "manifest.json",
    "stream",
    "catalog",
    "meta",
    "subtitles",
    "nzb",
    "easynews",
    "admin",
  ]);
  const resourceIndex = parts.findIndex(
    (part, index) => index > 0 && resources.has(part.toLowerCase()),
  );
  if (resourceIndex > 1) parts[1] = ":token";
  return parts.join("/");
}

function requestArea(requestPath) {
  const path = String(requestPath || "/");
  if (path.startsWith("/admin/api")) return "HTTP/ADMIN-API";
  if (
    path === "/" ||
    path.startsWith("/admin") ||
    path.startsWith("/utils/") ||
    /\.(html|js|css)$/i.test(path)
  ) {
    return "HTTP/FRONTEND";
  }
  if (
    /\/(manifest\.json|stream|catalog|meta|subtitles|nzb|easynews)(\/|$)/i.test(
      path,
    )
  ) {
    return "HTTP/ADDON";
  }
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/vendor/") ||
    /\.(svg|png|ico|woff2?)$/i.test(path)
  ) {
    return "HTTP/ASSETS";
  }
  return "HTTP/APP";
}

function requestMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level =
      res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
    write(
      level,
      requestArea(req.path),
      `${req.method} ${safeRequestPath(req.path)} -> ${res.statusCode} (${elapsedMs.toFixed(1)} ms)`,
      level === "ERROR" ? process.stderr : process.stdout,
    );
  });
  next();
}

function info(area, message, details = null) {
  write(
    "INFO",
    area,
    details ? `${message} ${formatArgument(details)}` : message,
  );
}

module.exports = {
  installConsoleLogging,
  requestMiddleware,
  info,
  refreshSecrets,
};
