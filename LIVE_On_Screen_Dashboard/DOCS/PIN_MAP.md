# Raspberry Pi 4 hub: pin map

BCM = GPIO number used in code. Pin = physical pin on the 40-pin header. GPIO pins are **3.3 V only**.

| Pin | BCM / name | Goes to | Notes |
|---|---|---|---|
| 1 | 3V3 | OLED VCC, RTC VCC | |
| 2 | 5V | Buzzer + | buzzer − goes to Q1 collector |
| 3 | GPIO2 SDA | OLED SDA, RTC SDA (and UPS HAT) | I2C: OLED 0x3C, RTC 0x68, UPS 0x42 |
| 4 | 5V | Relay module VCC | |
| 5 | GPIO3 SCL | OLED SCL, RTC SCL (and UPS HAT) | |
| 6 | GND | OLED GND, RTC GND | |
| 9 | GND | Q1 emitter | |
| 11 | GPIO17 | 1 kΩ → Q1 (2N2222) base | HIGH = buzzer on |
| 13 | GPIO27 | Relay IN | relay switches the 12 V siren; set `siren_active_high` |
| 14 | GND | Relay GND | |
| 29 | GPIO5 | 330 Ω → green LED → GND | all normal |
| 31 | GPIO6 | 330 Ω → yellow LED → GND | warning / hub software not answering |
| 33 | GPIO13 | 330 Ω → red LED → GND | critical (blinks) |
| 34 | GND | LED cathodes | |
| 37 | GPIO26 | MUTE button → GND | internal pull-up |
| 39 | GND | buttons | |
| 40 | GPIO21 | SHUTDOWN button → GND | hold 3 s; `gpio-shutdown` overlay |

**Not on GPIO**

| Port | Goes to |
|---|---|
| micro-HDMI 0 | 10.1" HDMI display (1280×800) |
| USB 2.0 | display touch/power · ESP32 gateway (`/dev/bhoomi-gateway`) |
| USB 3.0 | 4G LTE modem SIM7600/A7670 (`/dev/bhoomi-modem`) · optional USB stick for logs |
| 3.5 mm audio | PAM8403 amp → 4 Ω 3 W speaker (amp powered from a Pi USB port) |
| USB-C | 5 V 3 A from the UPS HAT / official supply |

**Siren side (separate supply):** 12 V adapter + → relay COM · relay NO → siren + · siren − → 12 V adapter −.

**Free for later:** GPIO4, 12, 16, 18 (PWM), 19, 20, 22–25, SPI (GPIO8–11), UART (GPIO14/15).
