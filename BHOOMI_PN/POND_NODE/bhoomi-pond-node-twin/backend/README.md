# BHOOMI Pond Node backend

Node.js server for the digital twin. It plays **layer 2 (edge gateway)** and **layer 3 (cloud)** of the AgriMesh framework, using the same code as the browser (`shared/farm/`), and serves the app.

- Gateway: device registry, pond rules, alerts in English / Telugu / Tamil, SMS fallback, offline buffer
- Cloud: every packet in `data/packets.jsonl`, pond history, oxygen trend forecast, push notifications
- REST API + WebSocket `/ws` for the app and the 3D views
- Simulator: runs the field-pond and prototype-tank firmware models (`shared/model/`)
- Packet sources: simulator, HTTP POST, MQTT (optional), USB serial (optional)

**No `npm install` needed** for the core: it uses only Node's built-in modules.

```bash
npm start          # http://localhost:8080  (redirects to /frontend/)
npm test           # 23 tests: parser, firmware models, gateway, cloud, REST + WebSocket end to end
npm run dev        # restart on file changes
```

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP + WebSocket port |
| `SIM` | 1 | Built-in simulator on (1) or off (0) |
| `SIM_DEVICES` | `field,tank` | Which devices to simulate |
| `SIM_FIELD_SPEED` | 60 | Field pond: simulated seconds per real second |
| `SIM_TANK_SPEED` | 5 | Prototype tank (demo timers) |
| `SILENT_AFTER_S` | 2100 | "Device silent" after this many farm seconds without a packet |
| `FARMER_LANG` | `te` | SMS language: `en`, `te`, `ta` (the app can change it) |
| `INGEST_TOKEN` | – | If set, `POST /api/ingest` needs header `X-BHOOMI-Token` |
| `MQTT_URL` | – | e.g. `mqtt://localhost:1883` (needs `npm install mqtt`) |
| `SERIAL_PORT` | – | e.g. `COM5` or `/dev/ttyUSB0` (needs `npm install serialport`) |
| `DATA_DIR` | `backend/data` | Where `packets.jsonl` is written |

Test packets as if from real hardware (`SIM=0 npm start`, then): `node tools/send-packet.js --ok | --low | --pumpfail | --probe | --tank | --new`.

Reference: [docs/api.md](../docs/api.md) · [docs/architecture.md](../docs/architecture.md).
