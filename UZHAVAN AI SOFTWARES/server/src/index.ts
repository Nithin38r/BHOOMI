/** BHOOMI hub server: HTTP API + live stream + MQTT broker + weather + rules. */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHttp } from "./http.ts";
import { Hub } from "./hub.ts";
import { DOWN_TOPIC, startMqtt } from "./mqtt.ts";
import { Store } from "./store.ts";
import { fetchWeather } from "./weather.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const MQTT_PORT = Number(process.env.MQTT_PORT ?? 1883);
const DB = process.env.DB_PATH ?? join(here, "..", "data", "bhoomi.db");
const TOKEN = process.env.INGEST_TOKEN || null;
const HUB_ID = (process.env.HUB_ID ?? "HUB001").toUpperCase();
const WEATHER = (process.env.WEATHER ?? "on") !== "off";

if (!/^[0-9A-Z]{4,12}$/.test(HUB_ID)) throw new Error("HUB_ID must be 4-12 letters/digits");
mkdirSync(dirname(DB), { recursive: true });
const hub = new Hub(new Store(DB), HUB_ID);

async function refreshWeather() {
  if (!WEATHER) return;
  const s = hub.store.settings();
  try { hub.setWeather(await fetchWeather(s.lat, s.lon, Date.now()), Date.now()); }
  catch (e) { console.warn(`[weather] ${e instanceof Error ? e.message : e} (rules treat the forecast as unknown)`); }
}

const app = await buildHttp(hub, { token: TOKEN, webDist: join(here, "..", "..", "web", "dist") });
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[http] API and app on http://localhost:${PORT} · hub ID ${HUB_ID}`);

try {
  await startMqtt(hub, MQTT_PORT, TOKEN);
  console.log(`[mqtt] broker on port ${MQTT_PORT} (bhoomi/<gateway>/up in, ${DOWN_TOPIC} out)`);
} catch (e) {
  console.warn(`[mqtt] could not start on port ${MQTT_PORT}: ${e instanceof Error ? e.message : e}. HTTP ingest still works.`);
}
if (TOKEN) console.log("[auth] INGEST_TOKEN required for ingest and MQTT");

await refreshWeather();
setInterval(refreshWeather, 30 * 60_000);
setInterval(() => hub.tick(Date.now()), 15_000);

const stop = () => { console.log("shutting down"); app.close().finally(() => process.exit(0)); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
