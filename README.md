# BHOOMI 🌱
**One low-cost radio network for the whole farm — soil, pond and irrigation, managed by UZHAVAN AI.**

HackWithAditya 2026 · AgriTech & Aquaculture track · Andhra Pradesh, India

---

## The problem
Small farmers irrigate by guesswork, find out about dry patches or waterlogging too late, and stay awake at night to switch pond aerators by hand. Wi-Fi does not reach across fields, and commercial sensor systems cost too much for a small farm.

## What BHOOMI does
BHOOMI puts small solar-powered nodes in the field and at the pond. They talk over **LoRa**, a long-range, low-power radio. Nodes pass messages for each other, so the far corners still reach the hub at the farmhouse. The hub runs the farm's rules locally, so the farm keeps working even when the internet is down.

| Part | What it does |
|---|---|
| **Soil Node** | Reads soil moisture at 15 cm and 30 cm, soil temperature, air temperature and humidity, light and leaf wetness. Wakes every 15 min, sends one packet, then deep-sleeps on solar and battery. |
| **Pond Node** | Measures dissolved oxygen, pH and water temperature in fish or shrimp ponds. Switches the aerator on by itself when oxygen falls, and alerts the farmer if a probe, the pump or the power fails. |
| **Smart irrigation** | Checks the pond water against the selected crop's limits, treats it in a separate tank if needed, and opens zone valves only where the soil is dry. |
| **Hub** | ESP32 + LoRa gateway at the farmhouse: collects packets, runs the rules, sends SMS, and uploads over 4G when available. |
| **UZHAVAN AI** | The software layer: hub decision rules, crop-based water checks, irrigation decisions, alerts, the farmer dashboard and the digital twins. |

## How it works
```
Soil nodes ─┐
Pond node  ─┼── LoRa mesh ──► Hub (UZHAVAN AI rules) ──► Farmer app · SMS · Cloud
Pump/valves ┘                    │
                                 └── commands back to pump, valves, aerator (every command ACKed)
```

## Repository
```
UZHAVAN AI SOFTWARES/   The software: hub server, farmer app, landing page and field simulator
BHOOMI_PN/              Pond Node: firmware (tank prototype, buoy, bank controller, pond gateway),
                        docs, digital twins of the tank and the full pond
BHOOMI_SN/              Soil Node: power and battery-life study, sensor wiring and power plan,
                        digital twins (single node, multiple nodes, mesh + hub bridge firmware)
3D_FUSION_FILES/        Enclosure CAD (STEP) and renders, print-ready parts in FINAL_PRINT/
DIGITAL_TWIN/, OVERALL_ELECTRONICS/, GENERAL/
                        Placeholders, still empty (the twins live in BHOOMI_PN/ and BHOOMI_SN/)
```

## Run the software
Needs Node.js 22.18 or newer. In `UZHAVAN AI SOFTWARES/`:
```bash
npm install
npm run demo
```
This starts the hub server and a field simulator that sends packets in the same format as our firmware, then opens the landing page at http://localhost:8080 (farmer app at http://localhost:8080/app/). Details and the demo walkthrough: [`UZHAVAN AI SOFTWARES/README.md`](UZHAVAN%20AI%20SOFTWARES/README.md) and [`docs/DEMO.md`](UZHAVAN%20AI%20SOFTWARES/docs/DEMO.md).

## Digital twins
Interactive 3D models with live readings, fault injection and a guided judge demo (open the `index.html` files in Chrome or Edge):
- Soil: `BHOOMI_SN/INDIVIDUAL_SOIL_NODE/`, `BHOOMI_SN/MULTIPLE_SOIL_NODE/`, `BHOOMI_SN/MESH_NODE/`
- Pond: `BHOOMI_PN/frontend/` (tank prototype and full pond, 70 × 40 m)

## Status (honest)
- Pond node and gateway firmware compile and pass a syntax check; hardware testing is in progress.
- Soil node firmware (v2.2) is still to be added to `BHOOMI_SN/`.
- The software runs end to end with the simulator; it has not yet been run against the real nodes.
- The twins and the simulator use illustrative models; real numbers will come from bench and field trials.
- Crop water limits follow FAO Irrigation & Drainage Paper 29.
- Mains wiring on the pond and pump side must be done by a licensed electrician.

## Use of AI tools
As the hackathon rules require, we disclose that the team used AI coding assistants while writing parts of the software and documentation. Every part was reviewed by the team, and we can explain and modify all of it.

## Team
Team BHOOMI · HackWithAditya 2026
