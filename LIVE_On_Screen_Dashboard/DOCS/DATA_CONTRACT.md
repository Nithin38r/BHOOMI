# Data contract: `/api/state`

The dashboard, the alarm service and the SMS service all read the **same snapshot** from the hub backend
(`bhoomi_hub`). Examples: `software/sample/state.sample.json` and `state.alerts.sample.json`
(made by the dashboard's own demo engine).

| Endpoint | Used by | Notes |
|---|---|---|
| `GET /api/state` | dashboard, alarm, SMS | full snapshot (below) |
| `GET /api/events` (SSE, event `state`) | dashboard | pushes a new snapshot on every packet |
| `POST /api/cmd` `{"node","cmd":{"AER":"AUTO"}}` + header `X-Token` | dashboard | aerator control, node replies with ACK |
| `GET :8091/sms/status`, `POST :8091/sms/test` | dashboard | served by sms_service.py |

## Snapshot
```jsonc
{
  "v": 1, "now": 1795517280,                     // epoch seconds
  "hub": {"id": "HB0001", "farm": "…", "mode": "live|sim|demo",
          "radios": [{"name": "lora-865", "freq": 865.0625, "ok": true}], "rx": 115, "dups": 0},
  "nodes": {
    "A1B2C3": {"type": "POND", "name": "BHOOMI_PN-01", "zone": "Pond 1", "online": true, "age_s": 30,
               "data": {"DO": 5.42, "DOS": 68, "PH": 7.74, "WT": 27, "AER": 0, "AERI": 0, "BV": 4.96, "FLT": 0, "MODE": "AUTO"},
               "analysis": {"do_status": "ok|watch|low|critical", "do_trend_ph": 0.28, "dawn_forecast": 4.1,
                            "faults": [{"code": 10}], "aer_runtime_min": 90, "advice": {"code": "AER_ON_NOW", "p": {}}},
               "link": {"rssi": -101, "snr": 6.4, "hop": 0, "via": null}, "hist": {"DO": [[ts, v], …]}},
    "5A0002": {"type": "SOIL", "name": "BHOOMI_SN-02", "crop": "chilli", "zone": "Field B",
               "data": {"M1": 40.4, "M2": 44.4, "ST": 21.9, "AT": 23.8, "RH": 85, "LUX": 0, "LWH": 0, "BV": 4.06},
               "analysis": {"root_moisture": 42.0, "moist_status": "ok|dry|wet", "moist_min": 28, "moist_max": 60,
                            "fungal_risk": "low|medium|high", "vpd": 1.08, "battery_pct": 84,
                            "advice": {"code": "IRRIGATE_PLAN", "p": {"zone": "Field B", "h": 18.9}}}}
  },
  "alerts": [{"node": "A1B2C3", "level": "crit|warn|info", "code": "DO_CRIT", "p": {"v": 2.6}, "ts": 1795517280}],
  "events": […], "score": 47, "packets": [{"ts", "node", "raw": "AM1,ID=…", "rssi", "snr", "dup"}]
}
```

Alert and advice **text is not in the snapshot**: every client builds it from `code` + `p` using the translations in
the dashboard (`A_<code>`, `FLT_<n>`, `V_<code>`). `bhoomi_common.py` does the same in Python.

## AM1 radio packet (node → hub)
`AM1,ID=5A0002,T=SOIL,N=196,M1=40.4,M2=44.4,ST=21.9,AT=23.8,RH=85,…`
`AM1,ID=A1B2C3,T=POND,N=472,DO=5.42,DOS=68,PH=7.74,WT=27,AER=0,AERI=0,BV=4.96,FLT=0`
Relayed packets add `HOP=1,VIA=<id>`. The hub de-duplicates on `ID + N + T`.
