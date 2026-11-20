# Stage 3 screenshots · Mesh hub and farm

| File | What it shows |
|---|---|
| `01-simulation-farm.png` | The farm in Simulation: seven soil nodes, the pond node, pump, treatment tank and storage tank around the farmhouse hub, with zone irrigation and hub alerts below |
| `02-live-whole-farm-on-one-mesh.png` | **Live** mode: 11 radios heard by the hub; every tag, the soil map and the packet log come from the backend |
| `03-live-irrigation-pump-command.png` | Irrigation tab after pressing **Start pump** in Live: the pump reports RUNNING, 6.4 A, 120 L/min; zone valves and alerts follow the storage tank's packets |
| `04-live-crop-water-check-acid-pond.png` | `POST /api/sim/pond {"event":"acid"}`: pond pH falls to 5.86 and the hub's crop water check says "Not suitable for Rice" |
| `05-live-treatment-tank-dosing.png` | The hub sends that water through the treatment tank first: the tank fills and doses towards pH 7.2 before the pump moves it to storage |
| `06-live-pond-aerator-command.png` | Pond tab after **Aerator on**: the pond node confirms and reports the aerator running, with DO, pH, EC, turbidity and level |
| `07-live-hub-log-commands-and-acks.png` | Hub log filtered to events: each command the farmer sent (valves, pump, aerator) and the device's `T=ACK` confirmation over LoRa |
| `08-live-node-failure-mesh-reroute.png` | Night, N2 switched off in the backend: the twin marks it failed and the far corner re-routes; "6 nodes" in the perimeter box |
| `09-judge-demo.png` | Judge demo, step 1: "One field, one water system" |
