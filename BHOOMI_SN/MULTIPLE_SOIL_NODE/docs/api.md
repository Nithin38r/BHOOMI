# Backend API

Base URL: `http://localhost:8080` (change with `PORT`). All responses are JSON. CORS is open so a phone app or another page can call it.

## REST

### `GET /api/health`
Server status and which packet sources are running.
```json
{ "ok": true, "version": "1.0.0", "uptimeS": 42, "nodes": 1, "packets": 17, "wsClients": 1,
  "sources": { "simulator": { "stage": 1, "intervalS": 15, "simMinute": 615 }, "mqtt": null, "serial": null,
               "http": { "path": "/api/ingest", "token": false } } }
```

### `GET /api/nodes`
Latest state of every node.
```json
[{ "id": "7C9E1A", "type": "SOIL", "lastSeen": "2026-11-20T14:31:05.112Z", "ageS": 4, "packets": 17, "n": 10141,
   "fields": { "M1": 42.7, "M2": 53.9, "ST": 26.5, "AT": 30.3, "AH": 60, "LW": 0, "LX": 72, "EC": null, "PH": null, "NPK": null, "BV": 3.98, "HOP": 0 },
   "rx": { "rssi": -94, "snr": 7.2, "hop": 0, "via": null, "source": "simulator" } }]
```

### `GET /api/nodes/:id`
One node, same shape as above. `404` if unknown.

### `GET /api/nodes/:id/history?limit=96`
Last readings of one node (max 500), oldest first. 96 reports = 24 hours.

### `GET /api/packets?limit=50`
Most recent packets of all nodes, with the raw AM1 line.

### `GET /api/fields`
Name and unit of every field, per packet type.

### `POST /api/ingest`
How a hub sends packets over Wi-Fi/4G. Either plain text, one AM1 line per line:
```bash
curl -X POST http://localhost:8080/api/ingest -H "Content-Type: text/plain" \
  --data "AM1,ID=7C9E1A,T=SOIL,N=2001,M1=22.4,M2=40.1,ST=27.0,AT=36.2,AH=31,LW=0,LX=88,EC=NA,PH=NA,NPK=NA,BV=3.91,HOP=0"
```
or JSON with radio details:
```json
[{ "raw": "AM1,ID=7C9E1A,T=SOIL,N=2002,M1=22.1", "rssi": -97, "snr": 6.5, "hop": 1, "via": "3B41F0" }]
```
If `INGEST_TOKEN` is set, send it in the `X-BHOOMI-Token` header. Duplicates (same `ID` and `N` within 30 min) return `"duplicate": true` and are not stored again.

### Simulator controls (stage 2+)
Only when the simulator is on (`SIM=1`). Every call answers with the new simulator state and pushes `{type:"sim"}` to open twins; by default it also sends a report round at once (`"now": false` to wait).

| Route | Body | Effect |
|---|---|---|
| `GET /api/sim` | | Fleet, weather, mesh on/off and every node's current route |
| `POST /api/sim/weather` | `{"preset":"monsoon"}` | `normal`, `monsoon`, `cyclone`, `heatwave`, `drought`, `fog` |
| `POST /api/sim/nodes/:id` | `{"on":false, "faults":{"m1":true,"ds":false,"sht":false}}` | Fail/restore a node, unplug its M1 probe, DS18B20 or SHT31 |
| `POST /api/sim/mesh` | `{"on":false}` | Mesh relaying off: only nodes in direct range reach the hub |
| `POST /api/sim/tick` | | Send one report round now |

```json
{ "stage": 2, "weather": "normal", "mesh": true,
  "nodes": [{ "id": "B4D7C2", "label": "N3", "soil": "shade", "place": "north-east", "x": 110, "z": -70, "on": true,
              "faults": { "m1": false, "ds": false, "sht": false }, "route": ["N3", "N2", "N1", "Hub"] }] }
```

## WebSocket `ws://localhost:8080/ws`

Server → browser messages:

| `type` | When | Body |
|---|---|---|
| `hello` | on connect | `version`, `nodes` (as `/api/nodes`), `recent` (last 30 packets), `sources` |
| `packet` | every new packet | `record`: `{ ts, id, type, n, fields, raw, rx: { rssi, snr, hop, via, source, simMinute? } }` |
| `node` | first packet from a new node | `node` summary |
| `sim` | simulator changed | `state` (as `GET /api/sim`) |
| `pong` | reply to `{"type":"ping"}` | `t` |

`rx.simMinute` is present only for simulator packets: the simulated minute since day 1 00:00, so twins can show the simulated clock. `rx.path` (stage 2+) is the route as node IDs ending in `HUB`, e.g. `["B4D7C2","3F21A0","7C9E1A","HUB"]`; `rx.via` is the first relay.

## MQTT (optional)

`npm install mqtt` in `backend/`, then set `MQTT_URL=mqtt://localhost:1883`.

| Topic | Direction | Payload |
|---|---|---|
| `bhoomi/<hubId>/up` | hub → backend | raw AM1 line, or JSON `{ "raw": "...", "rssi": -96, "snr": 7.5 }` |
| `bhoomi/hub/down` | backend → hub | AM1 command lines (used from stage 3) |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the server listens |
| `SIM` | `1` | Built-in simulator on/off |
| `SIM_STAGE` | `2` | Which fleet to simulate: 1 = one node, 2 = seven-node field |
| `SIM_INTERVAL_S` | `15` | Real seconds per simulated 15-min report |
| `DATA_DIR` | `backend/data` | Where `packets.jsonl` is written |
| `INGEST_TOKEN` | empty | Required token for `/api/ingest` |
| `MQTT_URL`, `MQTT_UP_TOPIC`, `MQTT_DOWN_TOPIC` | empty, `bhoomi/+/up`, `bhoomi/hub/down` | MQTT input |
| `SERIAL_PORT`, `SERIAL_BAUD` | empty, `115200` | USB serial input (e.g. `COM5`, `/dev/ttyUSB0`) |
