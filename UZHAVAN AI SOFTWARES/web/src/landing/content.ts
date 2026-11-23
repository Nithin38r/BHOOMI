/**
 * All landing-page text in one place. Every number comes from the team's own material:
 * soil-node drawing sheets 1–3, soil firmware v2.2, pond firmware v2.0 (BhoomiPondNode.ino) and its project pack.
 * Change copy here, not in the components.
 */

export const nav = [
  { href: "#how", label: "How it works" },
  { href: "#hardware", label: "Hardware" },
  { href: "#safety", label: "Safety" },
  { href: "#status", label: "Status" },
];

export const hero = {
  eyebrow: "HackWithAditya 2026 · AgriTech & Aquaculture · Andhra Pradesh",
  title: "One radio network for the whole farm",
  lede: "Solar sensor nodes in the field and the pond report over LoRa to a hub at the farmhouse. The hub runs the farm's rules on site, so the pump and the aerator keep working when the internet doesn't.",
  primary: { href: "/app/", label: "Open the farmer app" },
  secondary: { href: "#how", label: "How it works" },
  figureCaption: "Soil node, drawn to scale from our enclosure drawings. Heights in mm from ground level.",
};

/** Numbered callouts on the soil-node drawing, with the HTML legend that explains them. */
export const soilParts = [
  { n: 1, name: "LoRa antenna", detail: "tip 310 mm above ground" },
  { n: 2, name: "Solar panel", detail: "6 V 1 W, tilted 17° south" },
  { n: 3, name: "Air sensor", detail: "SHT31 in a 5-plate radiation shield" },
  { n: 4, name: "Electronics head", detail: "Ø86 × 178 mm, 3D-printed: ESP32, LoRa, 18650 cell" },
  { n: 5, name: "Soil temperature", detail: "DS18B20 at 10 cm" },
  { n: 6, name: "Moisture probe M1", detail: "15 cm: reacts first to rain and drying" },
  { n: 7, name: "Moisture probe M2", detail: "30 cm: the root zone, changes slowly" },
];

export const packet = {
  intro: "Every 15 minutes the node sends one line of text:",
  line: "AM1,ID=7C9E1A,T=SOIL,N=1038,M1=46.2,M2=57.1,ST=25.4,AT=29.1,AH=61.0,LW=0,LX=72,EC=NA,PH=NA,NPK=NA,BV=3.98,HOP=0",
  note: "Example in the soil firmware v2.2 format. NA marks a sensor that isn't fitted.",
};

export const problems = {
  eyebrow: "The problem",
  title: "Three things a small farm can't see",
  items: [
    { q: "Is the root zone dry?", a: "Topsoil at 15 cm dries out in an afternoon; the root zone at 30 cm changes slowly. Farmers irrigate by guesswork and find dry patches or waterlogging too late." },
    { q: "Is the pond losing oxygen?", a: "Plankton make oxygen by day, and everything in the pond uses it up at night. Below 4 mg/L fish are stressed; below 2 they gasp at the surface. Today someone stays awake to switch the aerator." },
    { q: "Will the signal reach?", a: "Wi-Fi stops at the farmhouse and mobile data is patchy in the fields. Commercial sensor systems cost more than a small farm can spend." },
  ],
};

export const steps = {
  eyebrow: "How it works",
  title: "From soil to SMS in four steps",
  items: [
    { k: "Sense", t: "Each node wakes every 15 minutes, powers its sensors for under a second, reads them, and goes back to deep sleep on a solar-charged 18650 cell." },
    { k: "Send", t: "It sends one short packet over LoRa. Nodes pass messages along for each other, so the far corners still reach the hub. No SIM card, no Wi-Fi." },
    { k: "Decide", t: "The hub runs the rules locally: irrigate now or wait for forecast rain, waterlogging, heat and fungal-risk warnings, low pond oxygen. Every command waits for the device to confirm it." },
    { k: "Tell", t: "The farmer sees it in the app and gets an SMS in Telugu or Tamil, with one-tap control of the pump and the aerator." },
  ],
};

export const hardware = {
  eyebrow: "Hardware",
  title: "Three devices, one radio",
  devices: [
    {
      name: "Soil node",
      tag: "Field",
      specs: [
        ["Measures", "Soil moisture at 15 and 30 cm, soil temperature, air temperature and humidity, light, leaf wetness"],
        ["Body", "3D-printed head Ø86 × 178 mm (PETG or ASA) on a Ø75 × 400 mm PVC pipe"],
        ["Power", "6 V 1 W solar panel, TP4056 charger, 18650 cell. Sensors are switched off between readings"],
        ["Reports", "Every 15 min. Hourly below 3.40 V. Below 3.30 V it sleeps 6 h to protect the cell"],
      ],
    },
    {
      name: "Pond node",
      tag: "Pond",
      specs: [
        ["Measures", "Dissolved oxygen (galvanic probe), pH and water temperature"],
        ["Clean signals", "16-bit ADC with a separate isolator for each probe, so two probes in the same water don't disturb each other"],
        ["Acts", "Switches the aerator through a relay and checks that it really draws current"],
        ["Prototype", "Built in a 15–20 L tank with an air pump standing in for the aerator. Scales to a solar buoy and a bank-side controller for a 70 × 40 m pond"],
      ],
    },
    {
      name: "Hub",
      tag: "Farmhouse",
      specs: [
        ["Hardware", "ESP32 with a LoRa radio and a 4G modem"],
        ["Job", "Collects every packet, runs the rules, sends commands and SMS"],
        ["Offline", "Keeps the farm running without internet and uploads readings when the signal returns"],
        ["Status", "Firmware in progress"],
      ],
    },
  ],
};

export const app = {
  eyebrow: "The farmer app",
  title: "Plain words, in the farmer's language",
  points: [
    "Alerts that say what to do, in English, Telugu or Tamil, and can be read aloud",
    "Soil moisture at both depths, pond oxygen and the pump at a glance",
    "One-tap pump and aerator control, confirmed by the device",
    "A spray log with a safe-harvest timer that never beats the label",
  ],
  cta: { href: "/app/", label: "Open the farmer app" },
};

export const safety = {
  eyebrow: "Safety",
  title: "Safety never waits for the internet",
  lede: "These rules run inside the pond node's own firmware. They keep working with the hub, the app and the internet all switched off.",
  rules: [
    ["4.0 → 6.0 mg/L", "Aerator on below 4.0 mg/L of oxygen, off again above 6.0"],
    ["20 / 5 min", "At least 20 minutes on and 5 minutes off between switches, to spare the motor"],
    ["18:00–07:00", "No trustworthy oxygen reading at night? The aerator runs anyway"],
    ["Fault 10", "Aerator switched on but drawing no current: buzzer and alert"],
    ["Fault 11", "Aerator running but oxygen still falling for 30 minutes: alert"],
    ["Faults 1–6", "A probe unplugged, frozen or fouled gets its own code, and the hub stops trusting that reading"],
  ],
  pump: "The pump switch gets the same treatment: dry-run, phase-failure and maximum-runtime cut-offs in its own firmware.",
};

export const status = {
  eyebrow: "Status",
  title: "Where we are, honestly",
  columns: [
    { h: "Working now", tone: "ok", items: [
      "Soil-node enclosure designed: 3 drawing sheets, STEP and STL files",
      "Pond node firmware v2.0 compiles without warnings",
      "Hub server and farmer app, tested end to end with a simulator that speaks the firmware's packets",
      "Interactive 3D digital twins of the soil node, the field and the pond",
    ] },
    { h: "Being built", tone: "warn", items: [
      "Bench tests of the soil and pond nodes",
      "Hub gateway firmware",
    ] },
    { h: "Next", tone: "next", items: [
      "Irrigation from pond water, checked against crop limits from FAO Irrigation & Drainage Paper 29",
      "Zone valves that water only the dry parts of the field",
      "Leaf and trap camera",
    ] },
  ],
  note: "Numbers in the twins and the simulator are illustrative. Real numbers come from bench tests and a 48-hour pond trial.",
};

export const footer = {
  team: "Team BHOOMI · HackWithAditya 2026 · Aditya University",
};
