# Stage 1 screenshots · Single soil node

| File | What it shows |
|---|---|
| `00-landing.png` | Start page served by the backend: stage list and backend status |
| `01-simulation-overview.png` | The twin in Simulation at dawn: node in the field, live readings and hub advice on the right, day timeline at the bottom |
| `02-live-from-backend.png` | **Live** mode: the header says `Live · 7C9E1A`, and every card and sparkline comes from packets pushed by the backend over WebSocket |
| `03-underground-probes.png` | Underground camera: moisture probes at 15 cm and 30 cm and the DS18B20 soil thermometer in the soil cutaway |
| `04-inside-view-electronics.png` | Inside view: the see-through head with the ESP32, LoRa module, 18650 battery and charger |
| `05-power-budget.png` | Power tab: battery state, solar input, sleep current options and how many days the node lasts without sun |
| `06-judge-demo.png` | Judge demo, step 1 of 10, with its caption |
| `07-live-alert-dry-topsoil.png` | A test packet with M1 = 21.8 % sent to the backend: the twin turns the soil dry and the hub says "Topsoil dry: irrigate" |
| `08-live-packet-log.png` | Packets tab in Live: the raw AM1 line decoded field by field, and the radio log with RSSI and source of each packet |
