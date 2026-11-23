# Field pond · parts, pins and wiring (buoy + bank controller)

The product version of the BHOOMI Pond Node: a **floating solar buoy** measures the water and a **bank-side controller** switches the paddle-wheel aerator. Firmware: [`pond-buoy/PondBuoy/PondBuoy.ino`](pond-buoy/PondBuoy/PondBuoy.ino) and [`pond-bank-controller/PondBank/PondBank.ino`](pond-bank-controller/PondBank/PondBank.ino). Both are modelled exactly in the twin's field-pond view.

> **Safety.** The bank controller only switches the contactor **coil** through an opto-isolated relay. The aerator keeps its own starter, MCB and overload, and a Hand-Off-Auto switch lets the farmer run it without electronics. All 230 V work (MCB, fuse, contactor, overload, earthing, RCD) must be done and signed off by a licensed electrician. Students wire only the 5 V / 3.3 V side.

## Part A · floating buoy

Battery and solar only, no mains in the water. It sleeps at about 0.15 mA and uses about 0.5 Wh a day.

| Part | Buy | ≈ ₹ |
|---|---|---|
| Controller | FireBeetle 2 ESP32-E (≈10 µA sleep), or ESP32-DevKitC + MCP1700 LDO | 600–1,300 |
| LoRa radio | HopeRF RFM95W (SX1276, 868 MHz version) | 950–1,300 |
| ADC | ADS1115 16-bit module | 300 |
| Isolators ×2 | DFRobot DFR0504 analog signal isolator (one for DO, one for pH) | 1,900 each |
| DO probe | DFRobot SEN0237-A galvanic DO probe kit (with signal board) | 15,000–19,000 |
| pH electrode | DFRobot SEN0169-V2 industrial electrode (with V2 board) | 5,500–7,500 |
| Water temperature | DS18B20 waterproof, stainless tip + 4.7 kΩ | 150 |
| Battery | 2 × 18650 3000 mAh in parallel (genuine Samsung 30Q / LG MJ1) + BMS | 700 |
| Solar charger | CN3791 MPPT 1-cell Li-ion charger (6 V panel) | 300 |
| Solar panel | 6 V 5 W polycrystalline, ≈ 350 × 250 mm | 700 |
| Enclosure | ABS IP65 200 × 150 × 100 mm, PG7 glands, vent plug, silica gel | 700 |
| Flotation | XPS/EPE foam ring 600 OD × 220 ID × 100 mm + deck plate (PETG/ASA or HDPE) | 750 |
| Antenna | 868 MHz 3 dBi whip on a 20 mm PVC mast, tip 1.2 m above water | 350 |
| Probe guard | 63 mm PVC pipe 800 mm, 6 mm slots, mesh end cap; probes at 60 cm | 250 |
| Ballast + mooring | 2 kg ballast below the pipe; 2 × 5 kg blocks, 6 mm nylon rope, 1.3× depth slack | 400 |

### Buoy pins

| ESP32 pin | Signal | Goes to | Notes |
|---|---|---|---|
| 3V3 | 3.3 V | RFM95W VCC, ADS1115 VDD, DS18B20 VDD | from the MCP1700 LDO (1.6 µA quiescent) |
| GPIO18 / 19 / 23 | SPI SCK / MISO / MOSI | RFM95W | |
| GPIO5 | SPI NSS | RFM95W NSS | 10 kΩ pull-up |
| GPIO14 / GPIO26 | RESET / DIO0 | RFM95W | DIO0 = TX done / RX done interrupt |
| GPIO21 / GPIO22 | I²C SDA / SCL | ADS1115 | 4.7 kΩ pull-ups |
| ADS1115 A0 | analog 0–3 V | DO isolator OUT | isolator 1 from the 5 V rail |
| ADS1115 A1 | analog 0–3 V | pH isolator OUT | isolator 2, separate |
| ADS1115 A2 | analog ≤ 2.1 V | battery via 100 k / 100 k divider | BV = 2 × reading |
| GPIO4 | 1-Wire | DS18B20 data | 4.7 kΩ to the sensor rail |
| GPIO25 | EN | 5 V boost enable (sensor rail) | 100 kΩ pull-down: sensors off in sleep |
| GPIO33 | RTC wake | reed switch to GND | magnet held at wake = calibration mode |
| Battery + | 3.0–4.2 V | CN3791 BAT, LDO in | 2 A fuse |

## Part B · bank-side aerator controller

Mains-powered, always listening. It decides the aerator, ACKs the buoy within 1.5 s and relays every reading to the gateway.

| Part | Buy | ≈ ₹ |
|---|---|---|
| Controller | ESP32-DevKitC | 500 |
| LoRa radio | RFM95W 868 MHz | 1,000 |
| Clock | DS3231 RTC + CR2032 | 150 |
| Power | Mean Well HDR-15-5 (5 V 2.4 A DIN) behind a 1 A fuse | 1,000 |
| Relay | 1-channel 5 V relay module, PC817 opto, JD-VCC jumper removed | 150 |
| Contactor | L&T MNX 9 or Schneider LC1D09, 230 VAC coil, with overload relay | 1,800 |
| Protection | 2-pole 6 A C-curve MCB for the control circuit, 1 A fuse on the PSU | 500 |
| Motor current | SCT-013-030 split-core CT (30 A → 1 V) on the motor phase wire | 700 |
| Hand-Off-Auto | 22 mm 3-position selector | 250 |
| Enclosure | Polycarbonate IP65 DIN box ≈ 300 × 400 × 170 mm | 1,500 |
| Antenna | 868 MHz 5 dBi on a 3 m GI pipe | 800 |

### Bank controller pins and terminals

| Pin / terminal | Signal | Goes to | Notes |
|---|---|---|---|
| HDR-15-5 L / N | 230 VAC | via 1 A fuse from the 6 A MCB | electrician |
| HDR-15-5 +5 V | 5 V | ESP32 VIN, relay JD-VCC | |
| GPIO18 / 19 / 23 / 5 / 14 / 26 | SPI + IRQ | RFM95W | same as the buoy |
| GPIO21 / GPIO22 | I²C | DS3231 | |
| GPIO32 | relay IN | relay module IN | active LOW |
| Relay COM / NO | dry contact | contactor A1 via the HOA AUTO contact | electrician |
| GPIO36 (VP) | analog | SCT-013-030 on a 1.65 V bias (2 × 10 kΩ + 10 µF) | 0.5 s RMS window |
| GPIO39 (VN) | digital | contactor auxiliary NO contact | 10 kΩ pull-down; HIGH = pulled in |
| GPIO34 | digital | HOA switch in AUTO | 10 kΩ pull-down; HIGH = AUTO |
| GPIO2 / GPIO27 | LEDs | green heartbeat / red fault, 330 Ω | |

## How the two talk

865.0625 MHz · SF9 · BW 125 kHz · CR 4/5 · sync word 0x12 · CRC on. The buoy sends at 14 dBm, or 17 dBm when the bank stops answering.

1. The buoy wakes and sends `T=POND` to the bank.
2. The bank ACKs at once with the aerator state, motor current, time and any queued command, then decides the aerator and relays the reading to the gateway.
3. If the bank misses two ACKs, the buoy flags **FLT 21** and sends straight to the gateway.
4. If the buoy is silent for 35 min, the bank flags **FLT 20** and runs the aerator at night.

Packet format: [`docs/packet-format.md`](../docs/packet-format.md).
