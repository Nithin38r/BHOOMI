# What the live dashboard shows

The screen is `software/dashboard/index.html`. It needs **1280 px width or more** for the full 3-column view
(a 10.1-inch 1280×800 HDMI screen or any 1080p monitor). Narrower screens and phones get a scrolling single column.

## Header (always visible)
- BHOOMI name, farm name and village
- Clock and date (IST)
- **LIVE / DEMO / OFFLINE** pill: is live data arriving from the hub?
- **4G / SMS pill** (new): modem signal bars, daily SMS time and ✓ when today's report was sent. Tap it for details (last request, numbers, SMS sent today)
- Language buttons: English, తెలుగు, हिन्दी, தமிழ், ಕನ್ನಡ, and ⟳ to rotate languages every 20 s
- **Farm health score** (0–100): drops with every warning and critical alert

## Left: Pond
- Aerator state ON/OFF, mode AUTO/ON/OFF, current (A), and AUTO / ON / OFF buttons (the node confirms each command with an ACK)
- Gauges: dissolved oxygen (mg/L), water pH, water temperature, oxygen saturation (%)
- Oxygen chart for the last 6 hours, with the 4 and 3 mg/L lines and a dawn forecast
- Trend (mg/L per hour), forecast oxygen at 6 AM, aerator run time today
- Signal strength and "last seen"

## Middle: Soil fields
- One tab per Soil Node (auto-cycles every 12 s)
- Gauges: moisture 15 cm and 30 cm (with the crop's target band), soil temperature, air temperature, humidity, sunlight, leaf wet hours, soil pH or air dryness (VPD)
- Moisture chart for the last 6 hours
- Crop and zone, root-zone moisture, fungal risk, battery, signal, last seen
- Table of all soil nodes, including relayed nodes (↪ via)

## Right: Alerts (full side)
- All active alerts, critical first (red), then warnings (orange), then info (blue), with times; up to 14 shown
- "All normal – no alerts" when there is nothing
- **What to do** at the bottom: the top actions (irrigate a zone, switch the aerator on, check leaves…)

## Footer
- Scrolling ticker of alerts (or a summary when all is normal)
- Hub ID, radio frequencies, duplicate packets
- Demo scenario buttons (demo mode only)

Removed from the team's earlier version, as requested: the LoRa mesh network map and packet log.
