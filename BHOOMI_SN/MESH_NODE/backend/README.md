# BHOOMI backend

Node.js server that turns AM1 packets from the field into a live digital twin.

- Serves the stage frontends and `shared/` files
- REST API: nodes, history, recent packets, ingest
- WebSocket `/ws`: pushes every packet to open twins
- Packet sources: built-in simulator, HTTP POST, MQTT (optional), USB serial (optional)
- Stores everything in `data/packets.jsonl`

**No `npm install` needed** for the core: it uses only Node's built-in modules.

```bash
npm start          # http://localhost:8080
npm test           # unit + end-to-end tests (REST and WebSocket)
npm run dev        # restart on file changes
```

Optional inputs:

```bash
npm install mqtt         # then MQTT_URL=mqtt://localhost:1883 npm start
npm install serialport   # then SERIAL_PORT=COM5 npm start   (Linux: /dev/ttyUSB0)
```

Turn the simulator off when real hardware is connected: `SIM=0 npm start`.

Full reference: [docs/api.md](../docs/api.md) · design: [docs/architecture.md](../docs/architecture.md).
