# Stage 2 screenshots · Multi soil node field

| File | What it shows |
|---|---|
| `01-simulation-field.png` | The field in Simulation at dawn: seven nodes, the hub at the farmhouse, mesh links and the moisture map on the ground |
| `02-live-seven-nodes.png` | **Live** mode: every node tag (moisture, hops) and the map come from backend packets |
| `03-live-soil-moisture-map.png` | Top-down Map camera: the hub's 15 cm moisture map built from the seven live nodes; sandy N1 and the bund N6 are driest |
| `04-radio-coverage-layer.png` | Radio coverage layer: range circles at 5 dBm show which nodes reach the hub directly and which must relay |
| `05-node-failure-self-healing.png` | N2 switched off through `POST /api/sim/nodes/3F21A0`: the twin marks it failed, the field shows 6 nodes, and N3 re-routes `N3 → N7 → N1 → Hub` |
| `06-live-monsoon-from-backend.png` | `POST /api/sim/weather {"preset":"monsoon"}`: rain clouds over the field and the soil wetting up in the next reports |
| `07-hub-panel.png` | Hub tab: internet status, readings buffered while offline, nodes heard, radio settings |
| `08-judge-demo.png` | Judge demo, step 1 of 8: "Seven nodes, one mesh" |
| `09-live-mesh-packet-log.png` | Packet log in Live: each AM1 packet with its route, hop count and weakest-link RSSI, beside the 24-hour charts and the node list |
