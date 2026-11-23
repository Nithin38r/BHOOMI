# AM1 packet format

Every BHOOMI / AgriMesh device speaks one line of plain text over LoRa: comma-separated `KEY=VALUE` pairs after the `AM1` tag, no spaces. `NA` means a sensor is missing. The parser is shared by the browser and the backend: [`shared/protocol/am1.cjs`](../shared/protocol/am1.cjs).

**Radio:** 865.0625 MHz · SF9 · BW 125 kHz · CR 4/5 · CRC on · sync word 0x12 · 14 dBm (buoy 17 dBm when the bank is not answering).

## Devices

| ID (simulator) | Device | Sends |
|---|---|---|
| `7C9E2A` | Field pond floating buoy | `T=POND` to the bank (and straight to the gateway if the bank is silent) |
| `3B41F0` | Field pond bank controller | `T=ACK` to the buoy; relays the buoy's `T=POND` to the gateway; `T=ACK` to commands |
| `5D20C7` | Prototype tank node | `T=POND`, `T=ACK`, `T=CAL` |
| `A10D55` | Edge gateway | `T=CMD` |

Real boards use the last 3 bytes of their MAC as ID; the gateway registers any new ID by itself.

## `T=POND` (reading)

```
AM1,ID=7C9E2A,T=POND,N=212,DO=5.84,DOS=76,PH=7.62,WT=28.6,AER=0,AERI=0.0,BV=4.04,FLT=0
```

| Key | Meaning | Unit |
|---|---|---|
| `N` | sequence number (duplicates are dropped by the gateway) | |
| `DO` | dissolved oxygen, temperature-compensated | mg/L |
| `DOS` | DO saturation | % |
| `PH` | pH, temperature-corrected | |
| `WT` | water temperature (−127 = sensor failed) | °C |
| `AER` | aerator on | 0/1 |
| `AERI` | aerator current: motor amps (field CT) or air-pump amps (tank INA219) | A |
| `BV` | battery (buoy) or supply (tank) voltage | V |
| `FLT` | highest-priority fault code, 0 = OK | |
| `U` | `1` = urgent, sent at once (e.g. FLT 10), may repeat `N` | |

## Fault codes

| FLT | Meaning | Device action |
|---|---|---|
| 1 | DO probe: no signal | DO invalid → aerator ON at night, hold by day |
| 2 | DO implausible (jump or out of range) | same as 1 |
| 3 | DO stuck (6 samples, same value) | same as 1 |
| 4 | pH out of range / probe unplugged | alert |
| 5 | pH not responding while DO swings (fouled electrode) | alert; latched on the tank until serviced |
| 6 | temperature sensor failed | uses 28 °C for compensation |
| 7 | battery (buoy < 3.40 V) or supply (tank < 4.60 V) low | buoy stretches sampling to 30 min |
| 10 | aerator ON but motor / pump current ≈ 0 | urgent packet, buzzer (tank) |
| 11 | aerator ON but DO still falling (30 min field) | alert |
| 20 | buoy silent > 35 min | bank runs the aerator at night |
| 21 | bank controller not answering (2 missed ACKs) | buoy sends direct to the gateway at 17 dBm |

## `T=CMD` (gateway → device) and `T=ACK`

```
AM1,ID=A10D55,T=CMD,N=4,DST=3B41F0,AER=AUTO
AM1,ID=3B41F0,T=ACK,N=4,OK=1,MODE=AUTO,AER=0
AM1,ID=3B41F0,T=ACK,N=5,OK=0,ERR=RANGE
```

| Key | Values | Effect |
|---|---|---|
| `DST` | device ID | only that device acts |
| `AER` | `ON` / `OFF` / `AUTO` | aerator mode |
| `LO`, `HI` | mg/L | thresholds (2 ≤ LO, HI ≤ 9, HI − LO ≥ 0.5), saved in NVS |
| `CAL` | `?` | calibration status (field: queued for the buoy's next wake, `QUEUED=7C9E2A`) |
| `STATUS` | `?` | tank sends `T=POND` now |
| `DEMO` | 0 / 1 | tank: real or demo timers |
| `TS` | Unix time | clock sync |

`HOLD=1` in an ACK means the change waits for a minimum ON / OFF time. A device switches first and confirms after, so the gateway treats an aerator change just before an ACK as that command's (not an automatic start).
