# SMS guide (sms_service.py)

Both features are on: **ask any time** and **automatic daily report**. Critical alerts are also sent by SMS.

## 1. Ask any time
A **registered** number texts the hub's SIM number:

| Text | Reply |
|---|---|
| `HI` (or HELLO, STATUS, DATA, anything else) | Full report: pond, every soil plot, alerts, what to do |
| `POND` | Pond oxygen, pH, temperature, aerator |
| `SOIL` | Every plot's root-zone moisture and status |
| `ALERTS` | Active warnings and critical alerts |
| `REPORT OFF` / `REPORT ON` | Stop / restart the daily report for this number |
| `HELP` | List of commands |

Messages from unknown numbers get **no reply** (no cost, no data leak).

## 2. Daily report
Sent once a day at `sms.daily_report_time` (default **07:00**) to every number in `sms.daily_report_numbers`.
If the hub restarts, it doesn't send twice. If the hub can't read data, it sends a short "please check the hub" message.

## 3. Critical alerts
Any new alert at a level in `sms.alert_sms_levels` (default `["crit"]`) goes to all registered numbers in one message.
The same alert isn't repeated while it stays active.

## Example (real output on demo data)
```
BHOOMI 07:00 24-Nov
PN-01 Pond: DO 8.0 pH 7.8 29C Aerator OFF/AUTO Good
SN-01 Groundnut: 37% Good
SN-02 Chilli: 42% Good
...
All normal - no alerts
> Plan irrigation for Field A within 19.6 h
```

## Language and cost
- `sms.language: "en"` gives plain SMS of 160 characters each (a full report is 2–3 SMS).
- `te`, `hi`, `ta`, `kn` give Unicode SMS of 70 characters each, so the same report needs 3–4 times more SMS.
  Use them where the farmer reads only that language.
- `max_sms_per_day` (default 60) caps the cost.

## Safety
SMS is read-only. Pumps and aerators cannot be switched by SMS.

## Hardware
A 4G LTE modem (SIM7600 or A7670) on a Pi USB port. It gives both SMS and internet. A 2G-only module (SIM800L)
does not work on 4G-only SIMs such as Jio.
The dashboard reads the SMS status from `http://<pi>:8091/sms/status`.
