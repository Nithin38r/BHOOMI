# AM1 packet format

Every BHOOMI node sends one line of plain text per report:

```
AM1,ID=7C9E1A,T=SOIL,N=1038,M1=46.2,M2=57.1,ST=25.4,AT=29.1,AH=61.0,LW=0,LX=72.5,EC=NA,PH=NA,NPK=NA,BV=3.98,HOP=0
```

- Starts with `AM1`, then comma-separated `KEY=VALUE` pairs, no spaces.
- `ID`: 6 characters, normally hex from the ESP32 chip ID (farm devices in the twin use IDs like `P1A2B3`). `T`: packet type. `N`: packet counter.
- Numbers are sent as plain decimals. Text fields (`VLV`, `STAGE`, `PHASE`, `NPK`, …) stay text, so `VLV=011` keeps its leading zero.
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

LoRa 433.5 MHz, SF9, BW 125 kHz, CR 4/5, sync word 0x12, CRC on, 10 dBm. Each report waits for an ACK from the hub and retries up to 3 times. The soil ACK is a short line, not AM1: `ACK,<ID>,<N>,<who>` where `who` is `HUB` or the relaying node's ID.

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

## Farm devices (stage 3)

| `T` | Example | Fields |
|---|---|---|
| `POND` | `AM1,ID=D0A1B2,T=POND,N=40066,PH=7.39,EC=0.90,TU=12,WT=28.4,DO=5.8,LV=68,AER=0` | pH, EC dS/m, turbidity NTU, water °C, dissolved O₂ mg/L, level %, aerator |
| `PUMP` | `AM1,ID=P1A2B3,T=PUMP,N=16895,RUN=1,I=6.4,PHASE=OK,RT=30,Q=120` | running, motor A, phase, run min, L/min, `TRIP=1` after a trip |
| `TANK` | `AM1,ID=T4C5D6,T=TANK,N=39887,LV=77,Q=50,P=1.60,VLV=011,LIT=11625` | level %, outflow L/min, pressure bar, valves N/M/S, litres delivered |
| `TREAT` | `AM1,ID=M5A6B7,T=TREAT,N=34663,LV=0,PH=7.40,EC=0.90,STAGE=IDLE,DOSE=0` | level %, pH, EC, stage, dosing steps |

The BHOOMI tank-prototype pond node (`BhoomiPondNode.ino`) sends its own `T=POND` fields (`DO,DOS,PH,WT,AER,AERI,BV,FLT`) on 865.0625 MHz; the backend stores both shapes.

## Commands

| Line | Direction |
|---|---|
| `AM1,ID=HUB000,T=CMD,N=4,DST=P1A2B3,RUN=1` | hub → device |
| `AM1,ID=P1A2B3,T=ACK,N=4,OK=1,RUN=1` | device → hub (`OK=0,ERR=…` when refused) |

`CMD` and `ACK` lines are kept in the packet log but never change a node's state.
