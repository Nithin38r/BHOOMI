# BHOOMI Pond Node prototype · parts, pins and wiring

Firmware: [`BhoomiPondNode/BhoomiPondNode.ino`](BhoomiPondNode/BhoomiPondNode.ino) v2.1 · board **ESP32 Dev Module** · Arduino-ESP32 core 3.0.x (2.0.x also works).

Libraries (Library Manager): LoRa (Sandeep Mistry), Adafruit ADS1X15, Adafruit INA219, Adafruit SSD1306, Adafruit GFX, OneWire, DallasTemperature, RTClib. Adafruit BusIO installs automatically.

## Parts

The electronics cost about ₹31,000–37,000, almost all of it the two probes. Prices are indicative Indian listings.

| # | Component | Part to buy | Qty | ≈ ₹ |
|---|---|---|---|---|
| 1 | Controller | ESP32-DevKitC (ESP32-WROOM-32) | 1 | 500 |
| 2 | LoRa radio | HopeRF RFM95W 868 MHz + 3 dBi whip + u.FL pigtail | 1 | 1,350 |
| 3 | ADC | ADS1115 16-bit I²C module | 1 | 300 |
| 4 | DO probe | DFRobot SEN0237-A galvanic DO probe + signal board | 1 | 15,000–19,000 |
| 5 | pH probe | DFRobot SEN0169-V2 industrial pH electrode + V2 board | 1 | 5,500–7,500 |
| 6 | Isolators | DFRobot DFR0504 analog signal isolator (DO + pH) | 2 | 3,800 |
| 7 | Water temperature | DS18B20 waterproof, stainless tip + 4.7 kΩ | 1 | 150 |
| 8 | Pump current | INA219 I²C module (0.1 Ω shunt) | 1 | 200 |
| 9 | Relay | 1-channel 5 V relay, PC817 opto, JD-VCC jumper | 1 | 150 |
| 10 | Aerator stand-in | 5 V DC air pump (≈ 300 mA) + 1N5819 diode | 1 | 250 |
| 11 | Aeration | Air stone, 1 m silicone tube, check valve | 1 set | 80 |
| 12 | Clock | DS3231 RTC + CR2032 | 1 | 150 |
| 13 | Display | 0.96" SSD1306 OLED 128 × 64, I²C | 1 | 250 |
| 14 | Button | 12 mm momentary push button | 1 | 40 |
| 15 | Buzzer | Active buzzer module 3.3–5 V | 1 | 40 |
| 16 | LEDs | 5 mm green + red, 330 Ω × 2 | 1 set | 10 |
| 17 | Resistor | 10 kΩ pull-up for RFM95W NSS | 1 | 2 |
| 18 | Power | 10,000 mAh power bank, 5 V 2 A + USB cable | 1 | 800 |
| 19 | Board + box | Perfboard 9 × 15 cm, headers, clear box ≈ 200 × 120 × 75 mm | 1 set | 500 |
| 20 | Tank | 15–20 L clear tank, strip to hang the probes 15 cm deep | 1 | 600 |

## ESP32 pin map

| ESP32 pin | Signal | Connects to |
|---|---|---|
| GPIO18 / 19 / 23 | SPI SCK / MISO / MOSI | RFM95W |
| GPIO5 | SPI NSS | RFM95W NSS, 10 kΩ pull-up to 3V3 |
| GPIO14 / GPIO26 | RESET / DIO0 | RFM95W |
| GPIO21 / GPIO22 | I²C SDA / SCL | ADS1115 (0x48), INA219 (0x40), DS3231 (0x68), OLED (0x3C) |
| GPIO4 | 1-Wire | DS18B20 data, 4.7 kΩ to 3V3 |
| GPIO32 | Relay IN (active LOW) | Relay module → pump |
| GPIO33 | Button | Push button to GND (internal pull-up) |
| GPIO2 / GPIO25 | LEDs | Green / red LED via 330 Ω to GND |
| GPIO13 | Buzzer | Active buzzer module S |
| 3V3 | Power | RFM95W, ADS1115, INA219, DS3231, OLED, DS18B20, relay opto VCC, buzzer |
| 5V (VIN) | Power | USB in → both isolators VCC, relay JD-VCC, INA219 VIN+ |
| GND | Ground | Common ground |
| ADS1115 A0 / A1 | Analog | DO isolator OUT / pH isolator OUT (A2, A3 to GND) |

Avoid GPIO0, 12 and 15 (boot strapping) and 34–39 (input only).

## Module wiring

| From | To | Notes |
|---|---|---|
| DO probe BNC → DO board | DO board Gravity cable → DO isolator (sensor side) | Isolator VCC 5 V, OUT → ADS A0 |
| pH electrode BNC → pH V2 board | pH board Gravity cable → pH isolator (sensor side) | Isolator VCC 5 V, OUT → ADS A1 |
| 5 V rail | INA219 VIN+ | The pump supply passes through the current sensor |
| INA219 VIN− | Relay COM | |
| Relay NO | Pump + | 1N5819 across the pump, stripe to + |
| Pump − | GND | |
| Relay IN / VCC | GPIO32 / 3V3 | JD-VCC jumper removed so the relay releases fully |
| Relay JD-VCC / GND | 5 V / GND | Relay coil supply |
| Power bank USB | ESP32 USB port | The ESP32 5 V pin then feeds the isolators, relay and pump |

**Why two isolators.** Both probes sit in the same water. Without isolation, current flows from one probe through the water into the other, and both readings drift (a ground loop). To test, read the pH, then dip a wire from GND into the tank. If pH moves by more than 0.05, check the isolators. Before connecting A0 and A1, confirm that both isolator outputs stay below 3.3 V.

## Radio

865.0625 MHz · SF9 · BW 125 kHz · CR 4/5 · CRC on · sync word 0x12 · 14 dBm. Packet format: [`docs/packet-format.md`](../../docs/packet-format.md).

## Serial commands (115200 baud, line ending "Newline")

| Command | What it does |
|---|---|
| `help` · `status` · `show` | Command list · live values and decision · calibration values |
| `sample` · `live` · `mute` | Sample now · print every reading · mute the alarm |
| `aer on` · `aer off` · `aer auto` | Aerator mode |
| `set lo 4.0` · `set hi 6.0` | Aerator thresholds (2 ≤ LO, HI ≤ 9, HI − LO ≥ 0.5) |
| `demo on` · `demo off` | Short demo timers or real pond timers |
| `time 2026-11-25 18:30` | Set the DS3231 clock (IST) |
| `service on` / `service off` | Pause sampling and the pump rule while you calibrate |
| `cal ph 6.86` → `cal ph 4.01` | Two-point pH calibration (service mode) |
| `cal do zero` → `cal do air` | DO zero and air calibration (service mode) |
| `set sal 2.0` · `reset cal` | Salinity in ppt · restore default calibration |
| `AM1,ID=A10D55,T=CMD,N=..,DST=<node>,AER=ON` | **v2.1:** a hub command over USB, handled exactly like one over LoRa. The backend sends these when `SERIAL_PORT` is set |

## Accuracy and safety

- Galvanic DO: about ±0.2–0.3 mg/L after a weekly air calibration. pH: about ±0.1 after a 2-point calibration; clean the electrode weekly.
- The firmware compiles with no warnings for ESP32 Dev Module (core 3.0.7). It has not yet been tested on the full hardware: treat the numbers as prototype numbers until the tank test is done.
- The pond version switches a mains aerator: that wiring must be done by a licensed electrician (Stage 2).
