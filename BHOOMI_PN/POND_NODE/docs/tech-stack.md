# Technology stack

| Layer | Technology | Why |
|---|---|---|
| **3D views** | Three.js r128 (WebGL), OrbitControls, procedural geometry, raycast picking, HTML labels projected from 3D, eased camera presets, x-ray and explode views | Every part is built in code: small, fast, and it changes with the hardware |
| **3D content: field pond** | 70 × 40 m earthen pond with a rippling water surface, day/night sky with sun, moon, stars and fog, rain that roughens the surface, fish that gasp at the surface when DO is low; floating buoy (foam ring, IP65 box, solar panel, antenna, slotted probe guard, ballast, mooring) with see-through electronics; bank controller (DIN box, PSU, opto relay, contactor, MCB, CT, Hand-Off-Auto); 1 HP paddle-wheel aerator with spinning impellers, spray particles and foam; farmhouse gateway; LoRa packets flying between them | Shows judges the pond, the hardware inside it and every radio message |
| **3D content: prototype tank** | Bench with a glass tank, probes 15 cm deep, air stone and bubbles, fish, 5 V air pump, power bank, see-through box with every module and colour-coded wiring, a live OLED drawn as a canvas texture | The hackathon build, explained part by part |
| **App shell** | HTML5, CSS custom properties, vanilla JavaScript (ES2020), Canvas 2D chart, iframe + postMessage for the views | No build step: serve the folder or open it from disk |
| **Mobile app (layer 4)** | Phone UI in the shell: CSS conic-gradient oxygen gauge, one-tap aerator control, Noto Sans Telugu / Tamil, Web Speech API for voice alerts | Shows exactly what the farmer gets |
| **Shared logic** | Plain JavaScript files loaded by `<script>` and by Node `require()`: firmware models, AM1 parser, gateway, cloud, EN/TE/TA texts | One copy of every rule for Simulation and Live |
| **Backend** | Node.js 18+ with built-in modules only: `http`, own RFC 6455 WebSocket server, ES modules | Runs on a laptop or Raspberry Pi with no `npm install` |
| **API** | REST / JSON + WebSocket `/ws` | Farm state, registry, ponds, history, forecast, alerts, commands, internet link, simulator |
| **Gateway (layer 2)** | Rule engine on each packet: fault codes, DO critical, aerator off, silent device, aerator log, SMS fallback, offline outbox | The farm keeps its brain when the internet drops |
| **Cloud (layer 3)** | Append-only JSONL + in-memory history; least-squares DO trend forecast; push notifications | Warns before the aerator has to start |
| **Inputs** | Simulator · HTTP POST · MQTT (mqtt.js + Mosquitto) · USB serial (serialport) | Same ingest path for every source |
| **Firmware** | Arduino C++ on ESP32: RFM95W LoRa 865 MHz, ADS1115, DFRobot DO + pH with isolators, DS18B20, SCT-013 CT, INA219, DS3231, SSD1306; deep sleep, NVS, watchdog; gateway with Wi-Fi, PubSubClient, HTTPClient | Buoy, bank controller, prototype tank and gateway |
| **Testing / CI** | `node:test` (23 tests: parser, both firmware models, gateway, cloud, REST + WebSocket end to end), GitHub Actions on Node 18 / 20 / 22, Playwright screenshots, `arduino-cli` compile check | |
| **Deployment** | Docker + docker-compose (backend + Mosquitto) | |
