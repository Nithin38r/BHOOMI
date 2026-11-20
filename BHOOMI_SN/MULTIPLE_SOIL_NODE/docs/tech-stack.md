# Technology stack

BHOOMI keeps the stack small on purpose: it has to run on a farm laptop or a Raspberry Pi with weak internet, and a student team has to be able to read all of it.

## At a glance

| Layer | Technology | Why this choice |
|---|---|---|
| Field hardware | ESP32 (38-pin DevKit), SX1278 LoRa 433 MHz, capacitive moisture v1.2 ×2, DS18B20, SHT31, LDR, wetness strip, 18650 + TP4056 + HT7833, 0.8 W solar | Low cost in India, deep sleep at ~0.5 mA, long range without Wi-Fi |
| Radio protocol | LoRa SF9 / 125 kHz, **AM1** plain-text packets (`AM1,ID=…,T=SOIL,…`) | Human-readable on a serial monitor, easy to parse on any platform, `NA` for missing sensors |
| Firmware | Arduino C++ on ESP32 (`soil_node_v2.2.ino`) | 15-min reports, low-battery modes, ACK + 3 retries |
| 3D twin | **Three.js r128** (WebGL), procedural geometry, raycast picking, orbit camera, HTML labels projected from 3D | No 3D model files to download; every part is code, so it can be changed with the hardware |
| Twin UI | HTML5, CSS custom properties (light + dark theme), vanilla JavaScript (ES2020), Canvas 2D for sparklines and the day timeline | No build step; opens from disk or from the backend |
| Real-time link | WebSocket (`/ws`), JSON messages | Pushes each packet to every open twin the moment it arrives |
| Backend | **Node.js 18+**, built-in `http` module, own RFC 6455 WebSocket server, ES modules | Zero npm dependencies for the core: `node src/server.js` and it runs |
| API | REST/JSON: `/api/health`, `/api/nodes`, `/api/nodes/:id/history`, `/api/packets`, `/api/ingest` | Easy to call from the hub, a phone app or curl |
| Storage | In-memory twin state + append-only **JSONL** log (`backend/data/packets.jsonl`) | Survives restarts; opens directly in pandas or Excel |
| Packet inputs | Built-in simulator · HTTP POST · **MQTT** (mqtt.js + Mosquitto, optional) · **USB serial** (serialport, optional) | Demo without hardware, then plug in the real hub the way that suits the farm |
| Testing | `node:test` (unit + end-to-end REST/WebSocket), Playwright screenshots | Runs with no extra installs |
| CI / DevOps | GitHub Actions (Node 18/20/22), Docker + docker-compose (backend + Mosquitto) | One command to run the full stack |

## 3D content

Every twin builds its scene in code with Three.js primitives, so nothing heavy is downloaded:

- **Soil node:** PVC body, 3D-printed head, solar lid, 433 MHz antenna, SHT31 sun shield, LDR window, wetness strip, status LED, spiked tip.
- **Soil cutaway:** a sliced block of earth showing the moisture probes at 15 cm and 30 cm and the DS18B20; the soil colour follows real moisture.
- **Inside view:** see-through housing showing the ESP32, LoRa module, 18650 cell and TP4056 charger.
- **Environment:** sky and sun position from the time of day, rain particles, wilting crop, drip line, dew.
- **Interaction:** orbit, zoom, camera presets, tap any part for its pin and job, labels that follow parts in 3D.

Stages 2 and 3 add a whole field with several nodes, mesh links drawn between them, a soil map painted on the ground, the farmhouse hub, the pond, tank and pump.

## Data flow

```
Soil node ──LoRa──► Hub ESP32 ──(MQTT | HTTP | USB serial)──► Backend ──WebSocket──► 3D twins
                                                                │
                                                                ├── REST API (apps, scripts)
                                                                └── packets.jsonl (history)
```

When no hardware is connected, the backend's simulator sends the same AM1 packets, so the twins and API behave exactly as they will on the farm.
