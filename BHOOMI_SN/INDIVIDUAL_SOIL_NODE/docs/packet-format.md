# AM1 packet format

Every BHOOMI node sends one line of plain text per report:

```
AM1,ID=7C9E1A,T=SOIL,N=1038,M1=46.2,M2=57.1,ST=25.4,AT=29.1,AH=61.0,LW=0,LX=72.5,EC=NA,PH=NA,NPK=NA,BV=3.98,HOP=0
```

- Starts with `AM1`, then comma-separated `KEY=VALUE` pairs, no spaces.
- `ID`: 6 hex characters from the ESP32 chip ID. `T`: packet type. `N`: packet counter.
- `NA` means the sensor is missing or failed. The node keeps sending every other field.
- After a power cut the counter restarts at a random number (firmware v2.2), so the hub never mistakes new packets for old ones.

## `T=SOIL` (soil node, firmware v2.2)

| Field | Meaning | Unit | Sensor / pin |
|---|---|---|---|
| `M1` | Soil moisture at 15 cm | % | Capacitive v1.2, GPIO32 |
| `M2` | Soil moisture at 30 cm | % | Capacitive v1.2, GPIO33 |
| `ST` | Soil temperature | °C | DS18B20, GPIO4 |
| `AT` | Air temperature | °C | SHT31, I²C |
| `AH` | Air humidity | % | SHT31, I²C |
| `LW` | Leaf / rain wetness | % | Wetness strip, GPIO39 |
| `LX` | Light level | % | LDR, GPIO34 (0 % at night, not `NA`) |
| `EC`, `PH`, `NPK` | Reserved for an RS485 soil probe | | not fitted: always `NA` |
| `BV` | Battery voltage | V | Divider, GPIO35 |
| `HOP` | Mesh hops to the hub | | 0 = direct |

## Radio settings

LoRa 433.5 MHz, SF9, 10 dBm. Each report waits for an ACK from the hub and retries up to 3 times.

## Reporting rules (firmware v2.2)

| Battery | Behaviour |
|---|---|
| ≥ 3.40 V | Report every 15 min |
| 3.30–3.40 V | Report every 60 min |
| < 3.30 V | Skip the radio, sleep 6 h |

## Hub rules shown in the twin

| Alert | Condition |
|---|---|
| Topsoil dry: irrigate | `M1` < 25 % |
| Waterlogged | `M1` > 88 % and `M2` > 80 % |
| Heat stress | `AT` > 38 °C |
| Fungal disease risk | leaves wet (`LW` > 50) for 6 h or more at 18–32 °C |
| Low battery | `BV` < 3.40 V |
| Sensor fault | any of `M1`, `ST`, `AT` is `NA` |
| Node silent | no packet for more than two report intervals |

Stage 3 adds `T=POND` (pond node) and command/ACK packets.
