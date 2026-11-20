# BHOOMI Digital Twin

**Interactive 3D digital twins of the BHOOMI LoRa smart-farm network, with a live Node.js backend.**

HackWithAditya 2026 · AgriTech & Aquaculture track · Andhra Pradesh, India

| Stage 1 · Single soil node | Stage 2 · Multi soil node field | Stage 3 · Mesh hub and farm |
|---|---|---|
| ![Stage 1 twin in Live mode](media/stage-1/02-live-from-backend.png) | ![Stage 2 field in Live mode](media/stage-2/02-live-seven-nodes.png) | ![Stage 3 farm in Live mode](media/stage-3/02-live-whole-farm-on-one-mesh.png) |

BHOOMI puts small solar LoRa nodes in the field. Each twin here is a 3D copy of that hardware: it runs its own simulation, and when served by the backend it switches to **live data**, so judges and farmers see exactly what the real nodes report.

## Stages

| Stage | Folder | Status |
|---|---|---|
| 1 · Single soil node | [`stage-1-single-soil-node`](stage-1-single-soil-node/) | ✅ Twin + backend + live data |
| 2 · Multi soil node field | [`stage-2-multi-soil-node`](stage-2-multi-soil-node/) | ✅ 7-node mesh twin + live routes + simulator controls |
| 3 · Mesh hub and farm | [`stage-3-mesh-hub`](stage-3-mesh-hub/) | ✅ Whole farm, hub rules, two-way commands, hub bridge firmware |

## Quick start

Needs **Node.js 18 or newer**. No `npm install` for the core.

```bash
git clone https://github.com/<your-user>/bhoomi-digital-twin.git
cd bhoomi-digital-twin/backend
npm start
```

Open **http://localhost:8080**, pick a stage and press **Go live**. The built-in simulator runs the whole farm (seven soil nodes, pond, pump and tanks) and sends one round of reports every 15 s, standing in for the 15-minute reports.

Send your own packet, or change the simulated field:

```bash
node tools/send-packet.js --dry                                          # a dry-topsoil packet
curl -X POST localhost:8080/api/sim/nodes/3F21A0 -d '{"on":false}'       # fail node N2
curl -X POST localhost:8080/api/sim/weather -d '{"preset":"monsoon"}'    # change the weather
curl -X POST localhost:8080/api/command -d '{"dst":"P1A2B3","set":{"RUN":1}}'   # start the pump
curl localhost:8080/api/hub                                              # what the hub decides
```

Settings are environment variables (see [docs/api.md](docs/api.md)). On Windows PowerShell use `$env:SIM="0"; npm start`; on macOS/Linux `SIM=0 npm start`.

With Docker (backend + Mosquitto MQTT broker):

```bash
docker compose up --build
```

## Repository

```
backend/                     Node.js server: REST, WebSocket, simulator, MQTT/serial inputs, tests
shared/                      Three.js (vendored) and the live client used by every twin
stage-1-single-soil-node/    Stage 1 twin: one soil node (frontend/)
stage-2-multi-soil-node/     Stage 2 twin: seven-node field and mesh (frontend/)
stage-3-mesh-hub/            Stage 3 twin: whole farm and hub (frontend/) + hub bridge firmware
docs/                        Architecture, API, packet format, technology stack
media/                       Screenshots of each stage with captions
```

## Real hardware

1. Flash [`stage-3-mesh-hub/firmware/BhoomiHubBridge`](stage-3-mesh-hub/firmware/BhoomiHubBridge/BhoomiHubBridge.ino) on the farmhouse ESP32 + SX1278 (set Wi-Fi and the broker address).
2. `docker compose up` (Mosquitto + backend), or `npm install mqtt` and `SIM=0 MQTT_URL=mqtt://localhost:1883 npm start`.
3. Soil nodes running `soil_node_v2.2` appear in every twin as soon as their first packet arrives.

No Wi-Fi? Plug the hub into the laptop and run `npm install serialport` then `SIM=0 SERIAL_PORT=COM5 npm start`.

## Technology

Three.js (WebGL) · vanilla JavaScript · HTML/CSS · Node.js · WebSocket · REST · MQTT · JSONL · ESP32 · LoRa. Details: [docs/tech-stack.md](docs/tech-stack.md).

## Docs

- [Architecture](docs/architecture.md)
- [Backend API](docs/api.md)
- [AM1 packet format](docs/packet-format.md)
- [Technology stack](docs/tech-stack.md)

## Licence

MIT. Three.js is © Three.js authors, MIT.
