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
soil-node/     ESP32 firmware, wiring guide, 3D-printable enclosure (STEP/STL)
pond-node/     Tank prototype + full-pond buoy/bank firmware, wiring, project pack
irrigation/    Water-quality crop rules, treatment-tank logic, pump/valve control
hub/           LoRa gateway receiver
twins/         Interactive 3D digital twins (open in Chrome/Edge)
docs/          Project packs, pin maps, images
```

## Digital twins
Interactive 3D models with live readings, fault injection and a guided judge demo:
- Single Soil Node · Multi Soil Node mesh · Field + Irrigation
- Pond Node (tank prototype) · Full Pond (70 × 40 m)

## Status (honest)
- Firmware compiles and passes a syntax check; hardware testing is in progress.
- The twins use illustrative models; real numbers will come from bench and field trials.
- Crop water limits follow FAO Irrigation & Drainage Paper 29.
- Mains wiring on the pond and pump side must be done by a licensed electrician.

## Team
Team BHOOMI · HackWithAditya 2026
