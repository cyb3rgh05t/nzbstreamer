const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const runtimeEnv = require("../../config/runtimeEnv");

const backendProjectPath = path.resolve(
  __dirname,
  "../../vendor/nzbdavex/backend/NzbWebDAV.csproj",
);
const publishedAssemblyPath = path.resolve(
  __dirname,
  "../../vendor/nzbdavex/publish/NzbWebDAV.dll",
);
const developmentAssemblyPath = path.resolve(
  __dirname,
  "../../vendor/nzbdavex/backend/bin/Release/net10.0/NzbWebDAV.dll",
);
const STARTUP_TIMEOUT_MS = 45000;
const externalEnvironmentKeys = [
  "NZBDAV_URL",
  "NZBDAV_API_KEY",
  "NZBDAV_WEBDAV_URL",
  "NZBDAV_WEBDAV_USER",
  "NZBDAV_WEBDAV_PASS",
];

let backendProcess = null;
let startPromise = null;
let stopRequested = false;
let internalEnabled = false;
let serviceUrl = "";
let apiKey = "";
let providerSyncPromise = null;
let originalExternalEnvironment = null;

function getBackendMode() {
  const configured = (process.env.NZBDAV_BACKEND || "").trim().toLowerCase();
  if (configured === "internal" || configured === "external") return configured;
  return (process.env.NZBDAV_URL || "").trim() ? "external" : "internal";
}

function configure() {
  if (!originalExternalEnvironment) {
    originalExternalEnvironment = Object.fromEntries(
      externalEnvironmentKeys.map((key) => [key, process.env[key]]),
    );
  }

  internalEnabled = getBackendMode() === "internal";
  if (!internalEnabled) {
    const savedEnvironment = runtimeEnv.getRuntimeEnv();
    for (const key of externalEnvironmentKeys) {
      const value = Object.prototype.hasOwnProperty.call(savedEnvironment, key)
        ? savedEnvironment[key]
        : originalExternalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.env.NZBDAV_BACKEND = "external";
    return false;
  }

  const portValue = Number.parseInt(
    process.env.NZBDAV_INTERNAL_PORT || "7071",
    10,
  );
  const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 7071;
  serviceUrl = `http://127.0.0.1:${port}`;
  if (!apiKey) apiKey = crypto.randomBytes(32).toString("hex");

  process.env.NZBDAV_BACKEND = "internal";
  process.env.NZBDAV_URL = serviceUrl;
  process.env.NZBDAV_WEBDAV_URL = serviceUrl;
  process.env.NZBDAV_API_KEY = apiKey;
  process.env.NZBDAV_WEBDAV_USER = "";
  process.env.NZBDAV_WEBDAV_PASS = "";
  process.env.FRONTEND_BACKEND_API_KEY = apiKey;
  return true;
}

function resolveDotnet() {
  if (process.env.DOTNET_PATH) return process.env.DOTNET_PATH;
  if (process.platform === "win32") {
    const standardPath = "C:\\Program Files\\dotnet\\dotnet.exe";
    if (fs.existsSync(standardPath)) return standardPath;
  }
  return "dotnet";
}

function getDotnetArguments(args) {
  if (fs.existsSync(publishedAssemblyPath)) {
    return [publishedAssemblyPath, ...args];
  }
  if (fs.existsSync(developmentAssemblyPath)) {
    return [developmentAssemblyPath, ...args];
  }
  return [
    "run",
    "--project",
    backendProjectPath,
    "--configuration",
    "Release",
    "--no-launch-profile",
    "--",
    ...args,
  ];
}

function buildChildEnvironment() {
  const configPath = path.join(
    path.dirname(runtimeEnv.RUNTIME_ENV_FILE),
    "nzbdavex",
  );
  fs.mkdirSync(configPath, { recursive: true });
  return {
    ...process.env,
    ASPNETCORE_URLS: serviceUrl,
    CONFIG_PATH: configPath,
    DISABLE_WEBDAV_AUTH: "true",
    FRONTEND_BACKEND_API_KEY: apiKey,
    LOG_LEVEL: process.env.NZBDAV_INTERNAL_LOG_LEVEL || "warning",
  };
}

function pipeChildOutput(child) {
  const attach = (source, write) => {
    let pending = "";
    source.setEncoding("utf8");
    source.on("data", (chunk) => {
      const lines = `${pending}${chunk}`.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        writeBackendLine(line, write);
      }
    });
    source.on("end", () => {
      writeBackendLine(pending, write);
    });
  };

  attach(child.stdout, console.log);
  attach(child.stderr, console.warn);
}

function writeBackendLine(rawLine, defaultWrite) {
  const line = rawLine.trim();
  if (!line) return;
  const match = line.match(/^\[[^\]]+\s+(INF|WRN|ERR|FTL|DBG|VRB)\]\s*(.*)$/);
  const level = match?.[1];
  const message = match ? match[2] : line;
  const write =
    level === "WRN"
      ? console.warn
      : level === "ERR" || level === "FTL"
        ? console.error
        : level === "INF"
          ? console.info
          : defaultWrite;
  write(`[NZBDAV INTERNAL] ${message}`);
}

function runMigration(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolveDotnet(),
      getDotnetArguments(["--db-migration"]),
      {
        cwd: path.dirname(backendProjectPath),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    pipeChildOutput(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Database migration exited (${signal || code})`));
    });
  });
}

function waitForHealth() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (stopRequested) {
        reject(new Error("Internal NZBDav startup was cancelled"));
        return;
      }
      if (
        backendProcess?.exitCode !== null &&
        backendProcess?.exitCode !== undefined
      ) {
        reject(
          new Error(`Internal NZBDav exited (${backendProcess.exitCode})`),
        );
        return;
      }
      try {
        const response = await fetch(`${serviceUrl}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // The listener may not be ready yet.
      }
      if (Date.now() >= deadline) {
        reject(new Error("Timed out waiting for internal NZBDav health check"));
        return;
      }
      setTimeout(check, 500).unref();
    };
    check();
  });
}

function buildProviderConfig() {
  const host = (process.env.NZB_TRIAGE_NNTP_HOST || "").trim();
  const providers = host
    ? [
        {
          Type: 1,
          Host: host,
          Port:
            Number.parseInt(process.env.NZB_TRIAGE_NNTP_PORT || "119", 10) ||
            119,
          UseSsl: /^(1|true|yes|on)$/i.test(
            process.env.NZB_TRIAGE_NNTP_TLS || "",
          ),
          User: (process.env.NZB_TRIAGE_NNTP_USER || "").trim(),
          Pass: process.env.NZB_TRIAGE_NNTP_PASS || "",
          MaxConnections:
            Number.parseInt(
              process.env.NZB_TRIAGE_NNTP_MAX_CONNECTIONS || "12",
              10,
            ) || 12,
          Priority: 0,
        },
      ]
    : [];
  return JSON.stringify({ Providers: providers });
}

async function syncProviderConfig() {
  if (!internalEnabled) return false;
  if (providerSyncPromise) return providerSyncPromise;

  providerSyncPromise = (async () => {
    const expectedProviders = JSON.parse(buildProviderConfig()).Providers;
    const body = new URLSearchParams({
      "usenet.providers": buildProviderConfig(),
    });
    const response = await fetch(`${serviceUrl}/api/update-config`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.status) {
      throw new Error(
        result.error || `Provider config update returned ${response.status}`,
      );
    }

    const verifyBody = new URLSearchParams({
      "config-keys": "usenet.providers",
    });
    const verifyResponse = await fetch(`${serviceUrl}/api/get-config`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: verifyBody,
      signal: AbortSignal.timeout(10000),
    });
    const verifyResult = await verifyResponse.json().catch(() => ({}));
    const configItem = (verifyResult.configItems || []).find(
      (item) => item.configName === "usenet.providers",
    );
    let storedProviders = [];
    try {
      storedProviders =
        JSON.parse(configItem?.configValue || "{}").Providers || [];
    } catch {
      storedProviders = [];
    }
    const providersMatch =
      verifyResponse.ok &&
      verifyResult.status &&
      storedProviders.length === expectedProviders.length &&
      expectedProviders.every(
        (expected, index) =>
          storedProviders[index]?.Host === expected.Host &&
          storedProviders[index]?.Port === expected.Port &&
          storedProviders[index]?.UseSsl === expected.UseSsl,
      );
    if (!providersMatch) {
      throw new Error(
        "Internal NZBDav did not persist the configured NNTP provider; check provider schema compatibility.",
      );
    }
    console.info("[NZBDAV INTERNAL] NNTP provider config verified", {
      providerCount: storedProviders.length,
      host: storedProviders[0]?.Host || "not configured",
    });
    return true;
  })();

  try {
    return await providerSyncPromise;
  } finally {
    providerSyncPromise = null;
  }
}

async function testConnection() {
  if (!internalEnabled) {
    throw new Error("Save the built-in backend selection before testing it.");
  }
  const response = await fetch(`${serviceUrl}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Built-in NZBDav health check returned ${response.status}`);
  }
  await syncProviderConfig();
  return "Built-in NZBDavEx is healthy and the NNTP provider settings are synchronized.";
}

async function start() {
  if (!internalEnabled) return false;
  if (startPromise) return startPromise;

  stopRequested = false;
  startPromise = (async () => {
    const env = buildChildEnvironment();
    await runMigration(env);
    backendProcess = spawn(resolveDotnet(), getDotnetArguments([]), {
      cwd: path.dirname(backendProjectPath),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    pipeChildOutput(backendProcess);
    backendProcess.once("error", (error) => {
      console.error(
        "[NZBDAV INTERNAL] Failed to start backend:",
        error.message,
      );
    });
    backendProcess.once("exit", (code, signal) => {
      const unexpected = !stopRequested;
      backendProcess = null;
      if (unexpected) {
        console.error(
          `[NZBDAV INTERNAL] Backend stopped unexpectedly (${signal || code})`,
        );
      }
    });

    await waitForHealth();
    await syncProviderConfig();
    console.log(`[NZBDAV INTERNAL] Ready at ${serviceUrl}`);
    return true;
  })();

  try {
    return await startPromise;
  } catch (error) {
    await stop();
    throw error;
  } finally {
    startPromise = null;
  }
}

async function stop() {
  stopRequested = true;
  const child = backendProcess;
  if (!child) return;
  backendProcess = null;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
    timeout.unref();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

async function reconfigure() {
  configure();
  if (internalEnabled) {
    if (backendProcess) return syncProviderConfig();
    return start();
  }
  await stop();
  return false;
}

module.exports = {
  configure,
  isEnabled: () => internalEnabled,
  start,
  stop,
  reconfigure,
  syncProviderConfig,
  testConnection,
};
