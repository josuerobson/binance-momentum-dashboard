const rawBase = (process.env.EASYPANEL_BASE_URL || "").replace(/\/$/, "");
const base = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
const token = process.env.EASYPANEL_API_KEY;
if (!base || !token) throw new Error("Easypanel credentials are not configured");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${body?.message || body?.error || "unknown error"}`);
  return body;
}

const database = await api("/api/inspectMySQLService?projectName=binance&serviceName=dashboard-db");
const dashboard = await api("/api/inspectAppService?projectName=binance&serviceName=dashboard");
const required = ["BOT_API_BASE_URL", "BOT_LOGS_URL", "DASHBOARD_API_KEY", "DASHBOARD_ADMIN_PASSWORD", "DASHBOARD_JWT_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is not configured in the server environment`);
}

const databaseUrl = `mysql://${database.user}:${database.password}@dashboard-db:3306/${database.databaseName}`;
const replaceKeys = new Set(["DATABASE_URL", ...required, "NODE_ENV"]);
const existing = String(dashboard.env || "").split(/\r?\n/).filter(line => line && !replaceKeys.has(line.split("=", 1)[0]));
const additions = {
  DATABASE_URL: databaseUrl,
  BOT_API_BASE_URL: process.env.BOT_API_BASE_URL,
  BOT_LOGS_URL: process.env.BOT_LOGS_URL,
  DASHBOARD_API_KEY: process.env.DASHBOARD_API_KEY,
  DASHBOARD_ADMIN_PASSWORD: process.env.DASHBOARD_ADMIN_PASSWORD,
  DASHBOARD_JWT_SECRET: process.env.DASHBOARD_JWT_SECRET,
  NODE_ENV: "production",
};
const merged = [...existing, ...Object.entries(additions).map(([key, value]) => `${key}=${JSON.stringify(value)}`)].join("\n");
await api("/api/updateAppEnv", { method: "POST", body: JSON.stringify({ projectName: "binance", serviceName: "dashboard", env: merged }) });
console.log(JSON.stringify({ updated: true, serviceName: "dashboard", preservedLines: existing.length, configuredKeys: Object.keys(additions) }));
