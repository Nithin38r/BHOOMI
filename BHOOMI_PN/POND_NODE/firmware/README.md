# Firmware

Four Arduino sketches for ESP32, one per device in the twin. All four share one radio setting (865.0625 MHz, SF9, BW 125 kHz, CR 4/5, sync word 0x12, CRC on) and the AM1 packet format, so they talk to each other and to the backend.

| Folder | Device | Twin view | Notes |
|---|---|---|---|
| [`pond-buoy/PondBuoy`](pond-buoy/PondBuoy/PondBuoy.ino) | Floating solar buoy, ID from the MAC (7C9E2A in the simulator) | Field pond | Deep sleep; 15 / 5 / 30 min intervals; faults 1–7, 21 |
| [`pond-bank-controller/PondBank`](pond-bank-controller/PondBank/PondBank.ino) | Bank-side aerator controller (3B41F0) | Field pond | AUTO ON < 4.0 / OFF > 6.0 mg/L, min ON 20 / OFF 5 min, night failsafe; faults 10, 11, 20; Hand-Off-Auto |
| [`prototype-tank/BhoomiPondNode`](prototype-tank/BhoomiPondNode/BhoomiPondNode.ino) | Hackathon prototype, one ESP32 in a 20 L tank (5D20C7) | Prototype tank | v2.1: also takes hub commands over USB, so it can run two-way with a laptop and no gateway |
| [`gateway/BhoomiPondGateway`](gateway/BhoomiPondGateway/BhoomiPondGateway.ino) | Edge gateway at the farmhouse (A10D55 in packets) | Layer 2 | LoRa ⇄ backend over MQTT, HTTP or USB serial; buffers 64 packets offline |

Wiring and parts: [field pond (buoy + bank)](field-pond-WIRING.md) · [prototype tank](prototype-tank/WIRING.md).

## Build

Arduino IDE 2 or `arduino-cli`, board **ESP32 Dev Module** (FireBeetle 2 ESP32-E for the buoy also works), Arduino-ESP32 core 3.0.x or 2.0.x.

Libraries (Library Manager): LoRa (Sandeep Mistry), Adafruit ADS1X15, Adafruit INA219, Adafruit SSD1306 + GFX, OneWire, DallasTemperature, RTClib, PubSubClient.

```bash
arduino-cli compile -b esp32:esp32:esp32 firmware/pond-buoy/PondBuoy
arduino-cli compile -b esp32:esp32:esp32 firmware/pond-bank-controller/PondBank
arduino-cli compile -b esp32:esp32:esp32 firmware/prototype-tank/BhoomiPondNode
arduino-cli compile -b esp32:esp32:esp32 firmware/gateway/BhoomiPondGateway
```

All four compile for ESP32 Dev Module (core 3.0.7). They have not yet been tested together on real hardware.

## Device IDs

Each board uses the last 3 bytes of its MAC as its ID, so real IDs differ from the simulator's (7C9E2A, 3B41F0, 5D20C7). The gateway registry adds any new ID on its own. To give real boards the field-pond names, add their IDs to `KNOWN` in [`shared/farm/gateway.cjs`](../shared/farm/gateway.cjs); in the prototype-tank view, open `?node=<ID>` to follow a specific board.
