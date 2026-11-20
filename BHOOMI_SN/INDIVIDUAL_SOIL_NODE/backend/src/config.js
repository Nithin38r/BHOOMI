// All settings come from environment variables, so the same code runs on a laptop, a Raspberry Pi or Docker.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const bool = (k, d) => ['1', 'true', 'yes', 'on'].includes(String(env(k, d)).toLowerCase());

export const config = {
  port: Number(env('PORT', 8080)),
  host: env('HOST', '0.0.0.0'),
  // repository root: the backend serves the stage frontends, shared/ and media/ from here
  webRoot: path.resolve(env('WEB_ROOT', path.join(here, '..', '..'))),
  dataDir: path.resolve(env('DATA_DIR', path.join(here, '..', 'data'))),
  historyPerNode: Number(env('HISTORY_PER_NODE', 500)),

  // built-in simulator: lets the twin run "live" with no hardware
  sim: bool('SIM', '1'),
  simStage: Number(env('SIM_STAGE', 1)),
  simIntervalS: Number(env('SIM_INTERVAL_S', 15)), // real nodes report every 900 s; 15 s keeps demos lively

  // optional HTTP ingest token (hub posts AM1 lines to /api/ingest)
  ingestToken: env('INGEST_TOKEN', ''),

  // optional MQTT input (npm install mqtt)
  mqttUrl: env('MQTT_URL', ''),
  mqttUpTopic: env('MQTT_UP_TOPIC', 'bhoomi/+/up'),
  mqttDownTopic: env('MQTT_DOWN_TOPIC', 'bhoomi/hub/down'),

  // optional USB serial input from a hub ESP32 (npm install serialport)
  serialPort: env('SERIAL_PORT', ''),
  serialBaud: Number(env('SERIAL_BAUD', 115200)),
};
