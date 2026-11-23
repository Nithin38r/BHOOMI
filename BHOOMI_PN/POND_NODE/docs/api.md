# Backend API

Base URL `http://localhost:8080`. JSON everywhere; CORS open, so the app can also use `?backend=http://<ip>:8080`.

The backend plays **layer 2 (edge gateway)** and **layer 3 (cloud)** of the AgriMesh framework in one Node.js process, using the same code as the browser: [`shared/farm/gateway.cjs`](../shared/farm/gateway.cjs) and [`shared/farm/cloud.cjs`](../shared/farm/cloud.cjs).

## Farm: gateway + cloud

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Version, uptime, packets, WebSocket clients, internet online, buffered items, sources |
| GET | `/api/farm` | Everything the app shows: gateway summary (registry, ponds, alerts, SMS log, buffer) + cloud summary (stored, forecast per pond, pushes) + simulator state |
| GET | `/api/registry` | Device registry: ID, role, name, pond, packet types, packets, RSSI, last heard |
| GET | `/api/ponds` | Each pond: last reading, level (`ok` / `warn` / `crit`), fault, aerator, mode, aerator log |
| GET | `/api/ponds/:key/history?hours=24` | Cloud history of one pond (`pond1`, `tank`, or a new device's ID in lower case) |
| GET | `/api/ponds/:key/forecast` | Oxygen trend forecast: `risk` (`low` / `medium` / `high` / `now` / `unknown`), slope, time it crosses 4 mg/L |
| GET | `/api/alerts` | Gateway alerts, SMS log and cloud pushes |
| POST | `/api/link` | `{"online": false}` cuts the gateway's internet; `{"online": true}` restores it and flushes the buffer |
| POST | `/api/lang` | `{"lang": "te"}` farmer's SMS language: `en`, `te` or `ta` |
| POST | `/api/command` | App → gateway → device. `{"dst":"3B41F0","set":{"AER":"ON"}}`. Returns the CMD line, where it went (`mqtt`, `serial`, `simulator`) and the simulated device's ACK. **503** while the internet is down; **202** if no radio link could take it |
| POST | `/api/ingest` | Packets from a gateway: plain text (one AM1 line per line) or JSON `{"raw":"AM1,...","rssi":-84,"snr":6.5,"via":"3B41F0"}` (or an array). Header `X-BHOOMI-Token` if `INGEST_TOKEN` is set |

## Raw data

| GET | Path | |
|---|---|---|
| | `/api/nodes`, `/api/nodes/:id`, `/api/nodes/:id/history?limit=96` | Last packet and history per device (cloud database) |
| | `/api/packets?limit=50` | Recent packets of every type, commands included |
| | `/api/fields` | Meaning and unit of every field |

## Simulator (when `SIM=1`)

`GET /api/sim` returns both devices' state. Every POST takes `"dev": "field"` (default) or `"tank"`.

| POST | Body | Field pond | Prototype tank |
|---|---|---|---|
| `/api/sim/scenario` | `{"key":"crash"}` | `normal`, `crash`, `aerFail`, `aerWeak`, `hubDown`, `bankDown`, `buoyDead`, `doDisc`, `phFoul`, `battLow`, `rain` | `normal`, `lowdo`, `night`, `pumpFail`, `clog`, `doNight`, `doDay`, `phFoul`, `temp`, `supply`, `hub`, `hot` |
| `/api/sim/fault` | `{"fault":"aerMotorFail","on":true}` | `doDisc`, `doStuck`, `phDisc`, `phFoul`, `tempFail`, `aerMotorFail`, `aerWeak`, `hubDown`, `bankDown`, `buoyDead`, `panelDead` | `doDisc`, `doStuck`, `phDisc`, `phFoul`, `tempFail`, `supplyLow`, `pumpFail`, `stoneClog`, `hubDown` |
| `/api/sim/env` | `{"cloud":0.8}` | `cloud`, `algae`, `biomass`, `sal`, `rain`, `soc` | `demand`, `amb`, `sal`, `supply` |
| `/api/sim/hour` | `{"h":21}` | ✓ | ✓ |
| `/api/sim/speed` | `{"x":300}` | 1–3600 | 0.5–600 |
| `/api/sim/run` | `{"on":false}` | ✓ | ✓ |
| `/api/sim/timers` | `{"demo":false}` | – | demo or real timers |
| `/api/sim/button` | `{"press":"short"}` | – | lid button |

## WebSocket `/ws`

| `type` | When | Payload |
|---|---|---|
| `hello` | on connect | `farm`, `nodes`, `recent`, `sim`, `sources` |
| `farm` | ≤ 1 per 0.6 s after changes, and every 3 s | full farm state (as `/api/farm`) |
| `packet` | each packet stored in the cloud | `record` with `t` (farm clock), `pond`, `rx {rssi, snr, via, source}` |
| `notify` | each alert pushed to the app | `alert {n, t, time, pond, id, level, code, text {en, te, ta}, channels}` |
| `link` | internet cut / restored | `online`, `flushed` |
| `cmd` | a command goes out | `record`, `sentTo` |
| `twin` | twice a second per simulated device | `id` (`field` / `tank`), `snap` (model state the 3D view mirrors) |
| `radio` | every simulated LoRa packet (field) | `route` (B2K, K2B, K2H, B2H, H2K), `raw`, `ok` |
| `event`, `lost` | simulated device log lines, packets lost | |
| `sim` | after a simulator control | simulator state |

## Alert codes

| Code | Level | Raised by | When |
|---|---|---|---|
| `AERON` / `AERSTOP` | info | gateway | the AUTO rule started / stopped the aerator (DO at the threshold) |
| `DOLOW` | crit | gateway | DO below 3 mg/L |
| `AEROFF` | warn | gateway | DO below 4 with the aerator off and no fault, two readings in a row |
| `FLT_PUMP` (10), `FLT_WEAK` (11), `FLT_BANK` (21) | crit | gateway | aerator not running, DO still falling with aerator on, bank controller not answering |
| `FLT_SENSOR` (1–6), `FLT_POWER` (7), `FLT_BUOY` (20) | warn | gateway | probe or sensor fault, low battery, buoy silent |
| `SILENT` / `CLEAR` | warn / ok | gateway | no packet for `SILENT_AFTER_S` / fault cleared or device back |
| `NEWDEV` | info | gateway | an unknown ID joined the network |
| `FORECAST` | warn | cloud | DO trend will cross 4 mg/L within 6 h |

SMS: every `crit` alert, and every `warn` while the internet is down, in the farmer's language.
