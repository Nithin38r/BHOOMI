# BHOOMI hub gateway ↔ server contract

How the **hub gateway** (the ESP32 at the farmhouse that hears every node over LoRa) talks to the **BHOOMI server** (rules, alerts, commands, SMS, farmer app).

It follows the firmware the team has already written:
- **Soil node firmware v2.2**: `T=SOIL` packets (see the twin backend's `docs/packet-format.md`).
- **Pond node firmware v2.0** (`BhoomiPondNode.ino`, `PondBuoy.ino`, `PondBank.ino`): `T=POND`, `T=CAL`, commands with `DST=`, replies `T=ACK`.

So **the nodes need no changes**. The only new piece is the gateway, which passes lines both ways.

The simulator (`npm run sim`) is a working reference for everything on this page.

---

## 1. What the gateway does

```
node ──LoRa──► gateway ──── MQTT or HTTP (Wi-Fi/4G) ──► BHOOMI server
node ◄─LoRa─── gateway ◄─────────── commands ────────── BHOOMI server
```

1. Every AM1 line heard over LoRa: forward it unchanged. Optionally append `RSSI=<dBm>`.
2. Every command line from the server: transmit it over LoRa unchanged.
3. Every SMS in the server's outbox: send it with the SIM (section 5).

The gateway does not need to understand the packets. The server parses, de-duplicates and decides.

---

## 2. AM1 packets (from the firmware)

```
AM1,ID=7C9E1A,T=SOIL,N=1038,M1=46.2,M2=57.1,ST=25.4,AT=29.1,AH=61.0,LW=0,LX=72,EC=NA,PH=NA,NPK=NA,BV=3.98,HOP=0
AM1,ID=7C9E2A,T=POND,N=212,DO=5.84,DOS=76,PH=7.31,WT=28.6,AER=0,AERI=0.00,BV=5.02,FLT=0
```

- `ID` = 6 hex digits of the ESP32 chip ID, `T` = type, `N` = packet counter. `NA` = sensor missing.
- The server registers a new `ID` from its first packet.
- **Duplicates:** the same `ID`, `T` and `N` within 30 minutes (one packet heard over two mesh routes) is stored once.
- After a power cut the soil node restarts `N` at a random number; the server copes with that.

| Type | Fields the server uses |
|---|---|
| `SOIL` | `M1` `M2` (moisture %, 15 / 30 cm), `ST` soil °C, `AT` `AH` air °C / %, `LW` leaf or rain wetness %, `LX` light %, `BV` battery V, `HOP` mesh hops. `EC` `PH` `NPK` are always `NA` until the RS485 probe is fitted; the app hides them. |
| `POND` | `DO` mg/L, `DOS` %, `PH`, `WT` °C, `AER` 0/1, `AERI` A, `BV` V, `FLT` fault code. |
| `CAL` | Calibration status (stored, shown later). |
| `ACK` | Reply to a command (section 4). |

### Pond fault codes (`FLT`)
| Code | Meaning | App shows |
|---|---|---|
| 1, 2, 3 | DO probe: no signal / implausible / frozen | Probe fault. **DO alarms are paused**, since the DO value can't be trusted. |
| 4, 5 | pH out of range / not responding | Probe fault. pH alarm paused. |
| 6 | DS18B20 failed (28 °C used) | Probe fault |
| 7 | Supply voltage low | Warning |
| 10 | Aerator ON but no current | **Aerator not working** + SMS |
| 11 | Aerator ON but DO still falling | Critical + SMS |
| 20, 21 | Buoy silent 35 min / buoy gets no bank ACK | Critical + SMS |

The server never judges motor current itself: the tank's 5 V air pump and the 1 HP pond aerator draw very different currents, and the firmware already knows which it drives.

---

## 3. Gateway → server

### MQTT (port 1883 on the server)
- Publish to **`bhoomi/<gatewayId>/up`**: one or more AM1 lines separated by `\n`, or JSON `{"raw": "...", "rssi": -96}`.
- These are the same topics as the twin backend, so both can share one broker.
- If the server runs with `INGEST_TOKEN`, use it as the MQTT password.

### HTTP
```
POST /api/ingest?gw=<gatewayId>
Content-Type: text/plain
X-BHOOMI-Token: <token>          (only if INGEST_TOKEN is set)

AM1,ID=7C9E1A,T=SOIL,N=1038,...
```
Reply: `{"accepted": 1, "duplicates": 0, "rejected": []}`.

**Offline buffer:** readings saved while the internet was down go up later with their original time, `{"gw": "FARM1", "packets": [{"raw": "AM1,...", "ts": 1795180000000}]}`, with `ts` in epoch milliseconds, at most 7 days old. They fill the charts but don't fire alerts.

---

## 4. Server → node commands (pond firmware v2.0 format)

```
AM1,ID=HUB001,T=CMD,N=17,DST=7C9E2A,AER=ON,TS=1795190000
```
- `ID` = the server's hub ID (`HUB_ID`, default `HUB001`), `N` = command number, `DST` = the node it is for.
- `TS` = Unix time in seconds, on **every** command. The pond node sets its clock from it, which its night-time aerator failsafe needs.

The node replies, and the server matches the reply by `N`:
```
AM1,ID=7C9E2A,T=ACK,N=17,OK=1,MODE=ON,AER=1
```
`OK=1` shows "Confirmed" in the app; `OK=0` shows "Not confirmed". No reply within 2 minutes is also "Not confirmed", with an alert. ACKs without `OK` (the pond bank's ACKs to its buoy) are ignored.

| Command field | Values | Node |
|---|---|---|
| `AER` | `ON`, `OFF`, `AUTO` | Pond node / pond bank |
| `STATUS` | `?` (send a reading now) | Pond node (pump/tank when they exist) |
| `CAL` | `?` (send calibration status) | Pond node |
| `PUMP` | `ON`, `OFF` | Pump switch (no firmware yet; please use the same shape) |
| `VALVE1`–`VALVE3` | `OPEN`, `CLOSE` | Tank node (future) |

**Getting commands to the gateway:**
- **MQTT:** subscribe to **`bhoomi/hub/down`**. Commands still waiting for an ACK are re-sent whenever you subscribe.
- **HTTP:** poll `GET /api/gateway/commands` every few seconds; the reply is zero or more lines.

Safety stays on the nodes: aerator hysteresis, minimum ON/OFF times and the night failsafe run in the pond firmware even with no gateway or internet.

---

## 5. SMS through the gateway's SIM

```
GET /api/gateway/outbox?since=<last id sent>
→ [{"id": 12, "text": "BHOOMI: చెరువులో ఆక్సిజన్ తగ్గుతోంది. ...", "createdAt": 1795190000000}]
```
Send each `text` to the farmer (UCS2 mode for Telugu/Tamil) and remember the last `id`.

---

## 6. Quick test from a laptop

```bash
curl -X POST "http://localhost:8080/api/ingest?gw=TEST" -H "Content-Type: text/plain" --data "AM1,ID=7C9E2A,T=POND,N=1,DO=3.6,DOS=47,PH=7.2,WT=29.1,AER=1,AERI=0.31,BV=5.01,FLT=0"
```
The pond node appears in the app within a second, with a "pond oxygen falling" alert.
