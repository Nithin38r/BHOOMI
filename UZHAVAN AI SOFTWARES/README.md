# UZHAVAN AI · the brain of BHOOMI

**UZHAVAN AI** (*uzhavan* means "farmer" in Tamil) is the software that turns BHOOMI's field hardware into decisions a farmer can act on.
The Soil Node, Pond Node and pump switch *measure*; UZHAVAN AI *understands, decides, alerts and acts*: it starts the pump, saves the pond and warns about disease before it spreads.

> ### 🌱 Why BHOOMI + UZHAVAN AI
> **Affordable for every farmer, ready for every farm business.** BHOOMI's nodes are built from low-cost, widely available parts
> (ESP32, LoRa, capacitive sensors), and UZHAVAN AI is open software that needs **no paid cloud and no subscription**.
> It works **without internet**, speaks the farmer's **own language** (English · తెలుగు · தமிழ்) with **voice**, sends **SMS to any basic phone**,
> and every part, hardware or software, can be **repaired, replaced or changed locally**.
> A small farmer can start with one node; a vegetable or aquaculture company can run every plot and pond from one screen.

---

## How the software and hardware work together

```
 BHOOMI HARDWARE (in the field)                    UZHAVAN AI (this folder)                  THE FARMER
 ─────────────────────────────                     ────────────────────────                  ──────────
 Soil Node  ── moisture 15/30 cm, soil & air  ─┐
               temp, humidity, light, leaf     │
               wetness, battery                │                                         ┌─► Farmer app (phone / browser)
 Pond Node  ── DO, pH, water temp, aerator   ──┼─ LoRa ─► ESP32 hub gateway ─ MQTT/HTTP ─►│   live readings · alerts · voice
               state, aerator current, faults  │          (farmhouse)        (Wi-Fi/4G)   │   pump & aerator buttons
 Pump switch ── pump state, trips            ──┘              ▲                           │   spray log · safe-harvest timer
                                                              │                           └─► SMS in the farmer's language
                     commands back (AER, PUMP, STATUS) ───────┘   hub server: storage · rules · alerts ·
                     every command confirmed by an ACK               auto-irrigation · weather forecast
```

| BHOOMI hardware | What it sends | What UZHAVAN AI does with it | What the farmer gets |
|---|---|---|---|
| **Soil Node** (solar ESP32 stake in the root zone) | Moisture at 15 cm and 30 cm, soil and air temperature, humidity, light, leaf/rain wetness, battery, every 15 min | Compares moisture with the crop's needs, checks the rain forecast, watches heat, cold and fungal-disease weather | "Water Field B now" or "rain is coming, wait", plus a disease warning **before** spots appear on the leaves |
| **Pond Node** (DO, pH and temperature probes + aerator relay) | Dissolved oxygen, pH, water temperature, aerator ON/OFF and current, fault codes | Raises low-oxygen warnings and critical alarms, catches aerator and probe faults, pauses false alarms while a probe is faulty | A night-time SMS and voice alarm **while the fish can still be saved**, and proof the aerator is really running |
| **Pump switch** (relay at the motor starter) | Pump state, dry-run, phase-failure and max-runtime trips | **Auto-irrigation:** pump ON when the topsoil is dry and no rain is coming, OFF when the root zone is full or rain starts | Water only when the crop needs it; no walking to the borewell; an alert if the pump trips |
| **ESP32 hub gateway** (farmhouse, LoRa + SIM) | Forwards every packet unchanged and transmits commands; sends the SMS outbox | De-duplicates mesh packets, keeps an offline buffer, queues and re-sends commands until each is confirmed | The farm keeps working through internet cuts; every button press is confirmed ("Confirmed" / "Not confirmed") |

**The hardware stays safe on its own.** Aerator hysteresis, minimum ON/OFF times, the night failsafe and the pump's
dry-run and phase cut-offs run in the node firmware. UZHAVAN AI adds intelligence on top; a server or internet failure
never puts the fish or the motor at risk.

Packets and commands follow the team's firmware (soil node v2.2, pond node v2.0), so the nodes need no changes.
Full contract: [docs/GATEWAY_API.md](docs/GATEWAY_API.md).

---

## The impact

### For the small farmer
- **Water, electricity and diesel saved.** Irrigation starts only when the soil at the roots is actually dry, waits when rain is forecast, and stops when the 30 cm layer is full. No more running the borewell "to be safe".
- **Crops protected earlier.** Long leaf wetness with humid, warm weather triggers a fungal-risk alert days before the disease shows. That means fewer emergency sprays and less crop loss.
- **Fish and shrimp kept alive.** Oxygen crashes happen before dawn, when nobody is watching. The Pond Node starts the aerator itself, and UZHAVAN AI wakes the farmer if oxygen keeps falling or the aerator fails.
- **Sleep and time back.** No more walking the fields to check moisture or staying up to switch the aerator. One look at the phone, or one SMS, shows the whole farm.
- **Safer food.** The spray log's safe-harvest timer never allows harvest before the pesticide label's waiting period, and it adjusts to live soil temperature and moisture.

### For every farmer, whatever their phone or language
- **Their own language with voice:** alerts are spoken and written in Telugu, Tamil or English.
- **Any phone:** critical alerts arrive by SMS on a basic phone, with no smartphone, app or data plan needed.
- **Simple signals:** green, amber and red, and every alert says *what to do*, not just what is wrong.

### For farm businesses, FPOs and officers
- **One screen for many plots and ponds,** each judged by its own crop and limits.
- **Records:** every reading, alert, command and spray is stored for planning, audits and officers.
- **Scales without redesign:** a new node registers itself from its first packet.

### For the region
- **Less groundwater pumped** and **fewer chemicals sprayed** across many farms.
- Later, anonymous data from many farms can show dry districts, disease-friendly weather and pond oxygen crashes at a regional level.

> Savings depend on the crop, soil, season and farm. Field trials will measure them; this README makes no numeric claims we haven't tested.

---

## What's inside

| Folder | What it does | Linked hardware |
|---|---|---|
| `shared/` | AM1 packet parser/encoder (the same frames the firmware sends), API types, alert texts in English/Telugu/Tamil. Used by the server, the app and the simulator. | All nodes |
| `server/` | Fastify HTTP API + live event stream (SSE), built-in MQTT broker (aedes) for the gateway, SQLite storage (`node:sqlite`), rules engine, Open-Meteo rain forecast | Hub gateway |
| `web/` | React + Vite: the landing page at `/` (for judges, with a to-scale Soil Node drawing) and the farmer app at `/app/`, installable on a phone | — |
| `sim/` | Field simulator that sends and answers exactly like the firmware (soil-water, pond-oxygen and pump models from our digital twins). It stands in for the hardware until it's in the field. | Soil Node, Pond Node, pump |
| `docs/GATEWAY_API.md` | **Hardware ↔ software contract:** packet fields, pond fault codes, MQTT topics, commands and ACKs, SMS outbox | Hub gateway firmware |
| `docs/DEMO.md` | Demo video walkthrough (under 5 minutes) with the simulator keys to press | — |
| `scripts/demo.ts` | `npm run demo`: one-command demo launcher | — |

### Rules the hub runs (`server/src/rules.ts`)

| Area | Rule | Driven by |
|---|---|---|
| **Irrigation** | Topsoil (15 cm) below 30 % and no rain forecast → pump ON. 30 cm reaches 72 %, rain starts, or waterlogging → pump OFF. Rain chance ≥ 60 % in the next 12 h → irrigation postponed. A farmer's own tap overrides automation for 30 min. | Soil Node M1/M2 + forecast → pump switch |
| **Crop health** | Heat stress (≥ 38 °C), cold stress (≤ 10 °C), fungal-disease risk (humidity ≥ 90 % at 18–30 °C, or wet leaves), waterlogging, low nitrogen, salt build-up | Soil Node AT/AH/LW (NPK/EC once the RS485 probe is fitted) |
| **Pump** | Trip alerts: dry run, phase failure, max runtime. The cut-offs themselves run in the pump switch firmware, not the cloud. | Pump switch |
| **Pond** | DO below 4 mg/L (warning), below 3 (critical + SMS), pH out of range, firmware fault codes (aerator with no current, DO still falling, probe faults, buoy or bank silent). DO and pH alarms pause while their probe reports a fault. | Pond Node DO/PH/WT/AERI/FLT |
| **Devices** | Not reporting, sensor unplugged (`NA`), battery low, lost packets, duplicate mesh packets (dropped), unconfirmed commands | Every node + gateway |
| **Spray log** | Safe-harvest timer from the label's waiting period plus a breakdown model driven by live soil temperature and moisture. Never shorter than the label. | Soil Node ST/M1 |

Thresholds are editable in the app (More → Settings). SMS go out in the farmer's chosen language.

---

## Run it (Node.js 22.18 or newer, no other installs)

From this folder:

```bash
npm install
```

**Quickest: one command.** It builds the app, starts the hub and the simulator, and opens the landing page at http://localhost:8080 (farmer app at http://localhost:8080/app/). Press the simulator keys in the same window; `q` stops everything. The walkthrough for the demo video is in [docs/DEMO.md](docs/DEMO.md).

```bash
npm run demo
```

**For development**, use three terminals (the app reloads as you edit):

```bash
npm run server
```
```bash
npm run sim -- --reset --scenario drought
```
```bash
npm run web
```

Open **http://localhost:5173** for the landing page and **http://localhost:5173/app/** for the farmer app. Within a few seconds the nodes register, the dry soil triggers an alert, and the hub starts the pump by itself.

Add `?still` to the landing page URL to turn off its motion for screenshots and slides. Landing text lives in `web/src/landing/content.ts`.

For a single-process demo (no Vite): run `npm run build`, then `npm run server`, then open **http://localhost:8080**.

### From simulator to real hardware
1. Flash the hub gateway (ESP32 + LoRa + SIM at the farmhouse) so it forwards every AM1 line to `bhoomi/<gatewayId>/up` (MQTT) or `POST /api/ingest` (HTTP), and transmits whatever arrives on `bhoomi/hub/down`.
2. Point the gateway at the server's address and, if set, `INGEST_TOKEN`.
3. Stop the simulator. The real nodes register themselves from their first packet.
4. Test without a gateway: `curl -X POST "http://localhost:8080/api/ingest?gw=TEST" -H "Content-Type: text/plain" --data "AM1,ID=7C9E2A,T=POND,N=1,DO=3.6,DOS=47,PH=7.2,WT=29.1,AER=1,AERI=0.31,BV=5.01,FLT=0"`

### Simulator controls
`npm run sim -- [--scenario normal|monsoon|cyclone|heatwave|drought|winter|fog|pondcrash] [--speed 60] [--nodes 7] [--reset] [--backfill 24] [--http] [--real-weather]`

While it runs, press **1–8** to change the weather, **d** borewell dry, **p** phase failure, **a** aerator fault, **k** kill node N2, **n** add a new node, or **q** to quit.
`--speed 60` means one simulated minute per real second (a node's 15-minute packet every 15 s).
The simulator also sets a matching simulated rain forecast; the app's weather card shows "Simulated forecast" with a button to return to the live Open-Meteo forecast.

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
- **No login yet:** there's no farmer login, so anyone on the network can open the app. Add authentication before a real deployment.
- **Translations:** the Telugu and Tamil texts were drafted for the prototype and need a native speaker's review.
- **Voice:** voice alerts use the phone's or browser's built-in speech, so Telugu and Tamil voices depend on the device.
- **Simulator values:** model values in the simulator are illustrative, not field data. The real impact will be measured in field trials with the BHOOMI hardware.

---

Part of **BHOOMI** · Team BHOOMI, Chennai Institute of Technology · HackWithAditya 2026 · AgriTech & Aquaculture track
Hardware: [`../BHOOMI_SN`](../BHOOMI_SN) (Soil Node) · [`../BHOOMI_PN`](../BHOOMI_PN) (Pond Node) · [`../LIVE_On_Screen_Dashboard`](../LIVE_On_Screen_Dashboard) (farmhouse screen) · [`../3D_FUSION_FILES`](../3D_FUSION_FILES) (enclosure)
