// All settings come from environment variables, so the same code runs on a laptop, a Raspberry Pi or Docker.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const bool = (k, d) => ['1', 'true', 'yes', 'on'].includes(String(env(k, d)).toLowerCase());

export const config = {
  port: Number(env('PORT', 8080)),
  host: env('HOST', '0.0.0.0'),
  // repository root: the backend serves frontend/, shared/ and media/ from here
  webRoot: path.resolve(env('WEB_ROOT', path.join(here, '..', '..'))),
  dataDir: path.resolve(env('DATA_DIR', path.join(here, '..', 'data'))),
  historyPerNode: Number(env('HISTORY_PER_NODE', 500)),

  // built-in simulator: runs the pond firmware models so every layer can go "live" with no hardware
  sim: bool('SIM', '1'),
  simDevices: env('SIM_DEVICES', 'field,tank').split(',').map((s) => s.trim()).filter(Boolean),
  simFieldSpeed: Number(env('SIM_FIELD_SPEED', 60)),   // field pond: simulated seconds per real second (1 min / s)
  simTankSpeed: Number(env('SIM_TANK_SPEED', 5)),      // prototype tank, demo timers (20 s samples)

  // gateway rules
  silentAfterS: Number(env('SILENT_AFTER_S', 35 * 60)),
  farmerLang: env('FARMER_LANG', 'te'),                // SMS language: en, te or ta

  ingestToken: env('INGEST_TOKEN', ''),
  mqttUrl: env('MQTT_URL', ''),
  mqttUpTopic: env('MQTT_UP_TOPIC', 'bhoomi/+/up'),
  mqttDownTopic: env('MQTT_DOWN_TOPIC', 'bhoomi/hub/down'),
  serialPort: env('SERIAL_PORT', ''),
  serialBaud: Number(env('SERIAL_BAUD', 115200)),
};
