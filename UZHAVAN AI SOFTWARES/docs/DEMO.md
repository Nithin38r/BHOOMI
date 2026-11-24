# BHOOMI software demo (video under 5 minutes)

## Set up (once, before recording)

Needs Node.js 22.18 or newer. From the software folder:

```bash
npm install
npm run demo
```

`npm run demo` builds the app, starts the hub server on a fresh demo database, starts the field simulator in the dry-spell scenario with 24 hours of history, and opens the landing page at **http://localhost:8080/**. The farmer app is at **http://localhost:8080/app/**.

Keep that terminal visible next to the browser: the simulator keys are pressed **in the terminal**, and the hub's log lines (commands, SMS) show up there too.

| Key | What happens |
|---|---|
| 1–8 | Change the weather (2 = monsoon, 8 = night oxygen crash in the pond) |
| d | Borewell runs dry (pump trips) |
| p | Phase failure (pump trips) |
| a | Aerator motor fails |
| k | Node N2 stops reporting |
| n | A new soil node switches on |
| q | Stop everything |

Other options: `npm run demo -- --scenario pondcrash` starts in another scenario, `--speed 120` runs faster, `--no-build` skips the build when nothing has changed. One simulated minute passes every real second at the default speed.

Tips: rehearse once and record the second run, using browser zoom of 110–125 % so text is readable. Add `?still` to the landing page URL if the scroll animation stutters while recording.

## Script (about 4 minutes)

**0:00–0:30 · Landing page** (`http://localhost:8080/`)
- "BHOOMI is one low-cost LoRa radio network for the whole farm: soil, pond and irrigation."
- Scroll slowly through the soil node drawing and "How it works".
- "Nodes report every 15 minutes to a hub at the farmhouse. The hub runs the farm's rules itself, so the farm keeps working without internet."
- Click **Open the farmer app**.

**0:30–1:20 · Dry spell, automatic irrigation** (Home)
- "The simulator is sending packets in exactly the format our firmware sends, over MQTT, like the real gateway."
- Point at the soil cores: every column is one node, top is 15 cm, bottom is 30 cm, darker is wetter.
- "Topsoil fell below 30 % and there's no rain in the forecast, so the hub switched the pump on by itself." Show the pump card: *PUMP ON · automatic · Confirmed by the device*.
- "Every command is acknowledged by the device. If the ACK doesn't come, the farmer is told."
- Tap the speaker icon on an alert to play the voice alert.

**1:20–1:50 · Languages**
- Switch the language to **తెలుగు**, then **தமிழ்**. "Alerts and SMS go out in the farmer's language." Switch back to English.

**1:50–2:20 · Rain forecast** (press **2** in the terminal)
- "Monsoon. Rain is coming, so the hub stops the pump and postpones irrigation instead of wasting water." Show the pump stop and the weather card.
- Open **Field**: pick a node, show the moisture profile and the charts of the last 24 hours.

**2:20–3:20 · Pond at night** (press **8**, open **Pond**)
- "A cloudy day, then oxygen drops at night: this is when fish die."
- When dissolved oxygen drops below 4 mg/L, the pond node switches the aerator on **by itself**, without the cloud. Point at the aerator band on the oxygen chart.
- Press **a**: "Now the aerator motor fails." The node reports the fault and oxygen keeps falling. Below 3 mg/L the hub raises a critical alert and queues an SMS (visible in the terminal as `[sms]`).

**3:20–3:50 · Faults the farmer would otherwise miss**
- Press **d**: borewell dry. The pump switch trips itself to protect the motor; the app shows why.
- Press **k**: node N2 goes silent and shows as not reporting.
- Press **n**: a new node switches on and registers itself, with no setup.

**3:50–4:20 · Spray log**
- Open **Spray**, add a spray: "The safe-harvest timer uses the label's waiting period and a breakdown model driven by live soil temperature and moisture. It is never shorter than the label."

**4:20–4:40 · Close**
- "Everything you saw runs on one small server at the farmhouse. Packets follow the team's firmware, so the same software runs with the real nodes. Next: field trials with the hardware."
- Press **q** in the terminal.

## If something goes wrong
- "Something is already running on port 8080": another BHOOMI server is open. Close its terminal and run `npm run demo` again.
- The app says it is offline: the demo terminal was closed. Run `npm run demo` again.
