# BHOOMI software

The software side of BHOOMI: the **hub server** that receives every LoRa packet from the farm gateway, the **farmer app**, and a **field simulator** that stands in for the hardware until it is ready.

```
 soil nodes ─┐                                   ┌─► farmer app (phone / browser, EN · తెలుగు · தமிழ்)
 pump switch ├─ LoRa ─► ESP32 gateway ─ MQTT/HTTP ┤        live readings, alerts, pump & aerator control,
 pond node  ─┘          (hardware team)          │        spray log with safe-harvest timer, voice alerts
                                                 └─► SMS outbox (sent by the gateway's SIM)
                          hub server = this folder: storage · rules · alerts · auto-irrigation · weather forecast
```

Packets and commands follow the team's firmware (soil node v2.2, pond node v2.0), so the nodes need no changes. See [docs/GATEWAY_API.md](docs/GATEWAY_API.md).

## Run it (Node.js 22.18 or newer, no other installs)

From this folder:

```bash
npm install
```

Three terminals:

```bash
npm run server
```
```bash
npm run sim -- --reset --scenario drought
```
```bash
npm run web
```

Open **http://localhost:5173** for the BHOOMI landing page (made for judges) and **http://localhost:5173/app/** for the farmer app. Within a few seconds the nodes register, the dry soil triggers an alert, and the hub starts the pump by itself.

Add `?still` to the landing page URL to turn off its motion, for screenshots and slides. Landing text lives in `web/src/landing/content.ts`.

For a single-process demo (no Vite): `npm run build`, then `npm run server`, then open **http://localhost:8080**.

### Simulator controls
`npm run sim -- [--scenario normal|monsoon|cyclone|heatwave|drought|winter|fog|pondcrash] [--speed 60] [--nodes 7] [--reset] [--backfill 24] [--http] [--real-weather]`

While it runs, press **1–8** to change the weather, **d** borewell dry, **p** phase failure, **a** aerator fault, **k** kill node N2, **n** add a new node, **q** quit.
`--speed 60` means one simulated minute per real second (a node's 15-minute packet every 15 s).
The simulator also sets a matching simulated rain forecast; the app's weather card shows "Simulated forecast" with a button to return to the live Open-Meteo forecast.

## What's inside

| Folder | What |
|---|---|
| `shared/` | AM1 packet parser/encoder, API types, alert texts in English/Telugu/Tamil. Used by server, app and simulator. |
| `server/` | Fastify HTTP API + live event stream (SSE), built-in MQTT broker (aedes), SQLite storage (Node's built-in `node:sqlite`), rules engine, Open-Meteo forecast. |
| `web/` | React + Vite: the landing page at `/` (GSAP scroll reveals, Lenis smooth scroll, to-scale soil-node drawing) and the farmer app at `/app/`, installable on a phone. |
| `sim/` | Field simulator that sends and answers exactly like the firmware (soil-water, pond-oxygen and pump models from our digital twins). |
| `docs/GATEWAY_API.md` | **Contract for the hub gateway**: packet fields, fault codes, MQTT topics, commands and ACKs, SMS outbox. |

### Rules the hub runs (`server/src/rules.ts`)
- **Irrigation:** topsoil (15 cm) below 30 % and no rain in the forecast → pump ON; 30 cm reaches 72 %, rain starts, or waterlogging → pump OFF. Rain chance ≥ 60 % in the next 12 h → irrigation postponed. A farmer's own tap overrides automation for 30 minutes.
- **Crop:** heat stress (≥ 38 °C), cold stress (≤ 10 °C), fungal-disease risk (humidity ≥ 90 % at 18–30 °C, or wet leaves), waterlogging, low nitrogen, salt build-up.
- **Pump:** trip alerts (dry run, phase failure, max runtime). These cut-offs run in the pump switch's firmware, not the cloud.
- **Pond:** DO below 4 mg/L (warning), below 3 (critical + SMS), pH out of range, and the firmware's own fault codes (aerator with no current, DO still falling, probe faults, buoy or bank silent). DO and pH alarms pause while their probe reports a fault.
- **Devices:** not reporting, sensor unplugged (`NA`), battery low, lost packets, duplicate packets from the mesh (dropped), unconfirmed commands.
- **Spray log:** safe-harvest timer from the label's waiting period and a breakdown model driven by live soil temperature and moisture. Never shorter than the label.

Thresholds are editable in the app (More → Settings). SMS go out in the farmer's chosen language.

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | HTTP API + built app |
| `MQTT_PORT` | `1883` | MQTT broker for gateways (topics `bhoomi/<gateway>/up`, `bhoomi/hub/down`, same as the twin backend) |
| `MQTT_DOWN_TOPIC` | `bhoomi/hub/down` | Where commands are published |
| `HUB_ID` | `HUB001` | The server's AM1 ID on commands (`ID=` in `T=CMD`) |
| `DB_PATH` | `server/data/bhoomi.db` | SQLite file |
| `INGEST_TOKEN` | *(none)* | If set, gateways must send it (`X-BHOOMI-Token` header / MQTT password), same as the twin backend |
| `WEATHER` | `on` | `off` disables the Open-Meteo forecast |

## Tests

```bash
npm test
```
```bash
npm run typecheck
```

## Known limits (prototype)
- No farmer login yet: anyone on the network can open the app. Add auth before a real deployment.
- Telugu and Tamil texts were drafted for the prototype and need a native speaker's review.
- Voice alerts use the phone/browser's built-in speech; Telugu/Tamil voices depend on the device.
- Model values in the simulator are illustrative, not field data.
