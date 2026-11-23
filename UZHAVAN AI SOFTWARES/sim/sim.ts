/**
 * BHOOMI field simulator: pretends to be the hub gateway until the real hardware is ready.
 * Packets and command replies follow the firmware: soil node v2.2 (T=SOIL) and pond node v2.0
 * (T=POND; commands AM1,ID=<hub>,T=CMD,N=<n>,DST=<node>,AER=ON answered by T=ACK,N=<n>,OK=1).
 * The soil, pond and pump models are ported from our own digital twins.
 *
 *   npm run sim                         (MQTT to localhost, 1 sim-minute = 1 real second)
 *   npm run sim -- --scenario drought   (start in a dry spell)
 *   npm run sim -- --http               (use HTTP instead of MQTT)
 *   npm run sim -- --reset --backfill 24 (wipe the hub, then upload 24 h of history first)
 *
 * Keys while running: 1-8 change the weather, d = borewell dry, p = phase failure, a = aerator fault,
 * k = kill/revive node N2, n = add a new node, q = quit.
 */
import mqtt from "mqtt";
import { encodeAm1, parseAm1 } from "../shared/am1.ts";

/* ------------------------------------------------------------------ options */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const argv = process.argv.slice(2);
const opt = (name: string, def: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
const flag = (name: string) => argv.includes(`--${name}`);
const HTTP = opt("server", "http://localhost:8080");
const MQTT_URL = opt("mqtt", "mqtt://localhost:1883");
const USE_HTTP = flag("http");
/** Simulated seconds per real second. 60 → a node's 15-minute packet interval passes every 15 real seconds. */
const SPEED = Math.max(0.1, Number(opt("speed", "60")));
const KEY = process.env.INGEST_TOKEN ?? "";
const GW = "SIMGW";
const BACKFILL_H = clamp(Number(opt("backfill", flag("reset") ? "24" : "0")) || 0, 0, 72);
const REAL_WEATHER = flag("real-weather");

/* ------------------------------------------------------------------ scenarios (same as the twins) */
type Env = { temp: number; swing: number; hum: number; rain: number; cloud: number; wind: number };
const SCEN: Record<string, { name: string; env: Env; m1: number; m2: number; hour: number; fc: { p: number; mm: number } }> = {
  normal:   { name: "Clear Kharif day", env: { temp: 30, swing: 9, hum: 65, rain: 0, cloud: 15, wind: .2 }, m1: 56, m2: 63, hour: 6, fc: { p: 10, mm: 0 } },
  monsoon:  { name: "Monsoon downpour", env: { temp: 26, swing: 3, hum: 92, rain: 15, cloud: 95, wind: .5 }, m1: 58, m2: 64, hour: 9, fc: { p: 90, mm: 40 } },
  cyclone:  { name: "Cyclone landfall", env: { temp: 25, swing: 2, hum: 97, rain: 35, cloud: 100, wind: 1.6 }, m1: 78, m2: 82, hour: 8, fc: { p: 97, mm: 140 } },
  heatwave: { name: "Heatwave", env: { temp: 39, swing: 12, hum: 22, rain: 0, cloud: 0, wind: .3 }, m1: 42, m2: 48, hour: 8, fc: { p: 0, mm: 0 } },
  drought:  { name: "Dry spell", env: { temp: 33, swing: 10, hum: 35, rain: 0, cloud: 10, wind: .3 }, m1: 31, m2: 38, hour: 9, fc: { p: 0, mm: 0 } },
  winter:   { name: "Rabi winter night", env: { temp: 15, swing: 13, hum: 78, rain: 0, cloud: 5, wind: .1 }, m1: 50, m2: 58, hour: 19, fc: { p: 5, mm: 0 } },
  fog:      { name: "Humid foggy night", env: { temp: 24, swing: 4, hum: 97, rain: 0, cloud: 70, wind: .1 }, m1: 62, m2: 66, hour: 18, fc: { p: 30, mm: 2 } },
  pondcrash:{ name: "Cloudy day, night oxygen crash", env: { temp: 29, swing: 4, hum: 80, rain: 0, cloud: 85, wind: .1 }, m1: 55, m2: 62, hour: 19, fc: { p: 20, mm: 0 } },
};
const SCEN_KEYS = Object.keys(SCEN);

const SOILS: Record<string, { et: number; drain: number; seep: number; solar: number; temp: number; off: [number, number]; ec: number; ph: number }> = {
  clay:  { et: .9,  drain: .7,  seep: 0,   solar: 1,   temp: 0,    off: [4, 4],   ec: .8,  ph: 7.2 },
  sandy: { et: 1.25, drain: 1.8, seep: 0,  solar: 1,   temp: .5,   off: [-9, -8], ec: .35, ph: 6.6 },
  low:   { et: .9,  drain: .5,  seep: 0,   solar: 1,   temp: -.3,  off: [9, 10],  ec: 1.1, ph: 7.4 },
  canal: { et: .95, drain: .8,  seep: 1.1, solar: 1,   temp: -.5,  off: [6, 10],  ec: .9,  ph: 7.3 },
  shade: { et: .65, drain: .9,  seep: 0,   solar: .45, temp: -1.6, off: [3, 3],   ec: .6,  ph: 6.9 },
  bund:  { et: 1.15, drain: 1.4, seep: 0,  solar: 1,   temp: .6,   off: [-6, -6], ec: .5,  ph: 7.0 },
};
const SLOTS = [
  { id: "7C9E1A", soil: "sandy", dist: 420 }, { id: "3F21A0", soil: "clay", dist: 380 }, { id: "B4D7C2", soil: "shade", dist: 610 },
  { id: "91E04F", soil: "low", dist: 650 }, { id: "C2A8B3", soil: "canal", dist: 400 }, { id: "5D3F77", soil: "bund", dist: 450 },
  { id: "0AE6D9", soil: "clay", dist: 300 }, { id: "E7B214", soil: "clay", dist: 260 }, { id: "68C0F5", soil: "bund", dist: 340 },
];

/* ------------------------------------------------------------------ state */
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const START_SCEN = SCEN[opt("scenario", "normal")] ? opt("scenario", "normal") : "normal";

interface Node { id: string; soil: string; dist: number; m1: number; m2: number; st: number; pond: number; mAh: number; seq: number; next: number; on: boolean; ni: number; pi: number; ki: number; ec: number; lw: number }
const S = { min: 0, scen: START_SCEN, env: { ...SCEN[START_SCEN].env }, airT: 25, airH: 70, solar: 0, raining: false };
let nodes: Node[] = [];
const pump = { id: "P1A2B3", seq: 0, next: 0, on: false, runMin: 0, dryMin: 0, trip: "", lockUntil: -1, dryWell: false, phase: false, maxRun: 120 };
const pond = { id: "D0A1B2", seq: 0, next: 0, do: 6.8, ph: 7.4, t: 28, aer: false, mode: "AUTO" as "AUTO" | "ON" | "OFF", fail: false };
const trap = { id: "C7E8F9", seq: 0, next: 0, wf: 14, ap: 9 };

function makeNode(i: number): Node {
  const s = SLOTS[i], so = SOILS[s.soil], sc = SCEN[S.scen];
  return { id: s.id, soil: s.soil, dist: s.dist, m1: clamp(sc.m1 + so.off[0] + rnd(-2, 2), 5, 98), m2: clamp(sc.m2 + so.off[1] + rnd(-2, 2), 5, 99),
    st: sc.env.temp + 1.5 + so.temp, pond: 0, mAh: 2600 * rnd(.72, .95), seq: 0, next: S.min + 1 + i * 1.6, on: true,
    ni: rnd(42, 62), pi: rnd(40, 65), ki: rnd(50, 72), ec: so.ec, lw: 20 };
}

function applyScenario(id: string, announce = true) {
  const sc = SCEN[id]; S.scen = id; S.env = { ...sc.env };
  S.min = Math.floor(S.min / 1440) * 1440 + sc.hour * 60 + (S.min % 1440 > sc.hour * 60 ? 1440 : 0);
  for (const n of nodes) { const so = SOILS[n.soil]; n.m1 = clamp(sc.m1 + so.off[0] + rnd(-2, 2), 5, 98); n.m2 = clamp(sc.m2 + so.off[1] + rnd(-2, 2), 5, 99); n.pond = id === "cyclone" && n.soil === "low" ? 14 : 0; n.st = sc.env.temp + 1.5 + so.temp; }
  if (id === "pondcrash") { pond.do = 4.6; }
  else pond.do = sc.hour >= 17 ? 6.4 : 7;
  step(0.001);
  if (announce) log(`weather → ${sc.name}`);
  if (!REAL_WEATHER) setForecast(sc.fc.p, sc.fc.mm, sc.env.rain);
}

/* ------------------------------------------------------------------ models */
function step(dtH: number) {
  const e = S.env, hour = (S.min / 60) % 24, raining = e.rain > .2;
  const airT = e.temp + e.swing / 2 * Math.sin(2 * Math.PI * (hour - 9) / 24) - (raining ? 1.5 : 0);
  const solar = Math.max(0, Math.sin(Math.PI * (hour - 6) / 12)) * 1000 * (1 - .8 * e.cloud / 100);
  const airH = clamp(e.hum - 2.2 * (airT - e.temp) + (raining ? 6 : 0), 5, 100);
  Object.assign(S, { airT, airH, solar, raining });
  const irrigating = pump.on && !pump.dryWell;

  for (const n of nodes) {
    const so = SOILS[n.soil], sol = solar * so.solar, nT = airT + so.temp * .5;
    const water = e.rain * (n.soil === "low" ? 1.7 : 1) + (irrigating ? 12 : 0);
    const et = Math.max(0, .0016 * sol * (1 + (nT - 25) / 25) * (1 - airH / 130)) * so.et;
    let m1 = n.m1, m2 = n.m2;
    const infil = water * 2.2 * (1 - m1 / 102), drain = Math.max(0, m1 - 68) * .30 * so.drain, cap = 6 * so.drain;
    if (m1 > 94 && water > cap) n.pond += (water - cap) * .8 * dtH;
    if (n.pond > 0) { const pin = Math.min(n.pond, (Math.max(0, 100 - m1) * .08 + .4 * so.drain) * dtH); n.pond -= pin; m1 += pin * 1.5; n.pond = Math.max(0, n.pond - et * dtH); }
    m1 += (infil - et * 2.0 - drain) * dtH + so.seep * .25 * (1 - m1 / 85) * dtH;
    m2 += (drain * .9 - et * .5 - Math.max(0, m2 - 72) * .06 * so.drain + so.seep * (1 - m2 / 88)) * dtH;
    if (m2 > 97) m1 += drain * .2 * dtH;
    n.m1 = clamp(m1, 2, 100); n.m2 = clamp(m2, 2, 100);
    n.st += (e.temp + 1.5 + so.temp + .35 * (airT - e.temp) + sol * .004 - (n.m1 > 85 ? 1 : 0) - n.st) * Math.min(1, dtH / 2.5);
    n.lw = clamp((raining || airH >= 92) ? 100 : (solar < 5 && airH > 85 ? 70 : clamp((airH - 60) * 1.5, 0, 40)), 0, 100);
    n.ni = clamp(n.ni - (sol > 50 ? .12 : 0) * dtH - (e.rain > 8 && n.m1 > 85 ? .6 * dtH : 0), 0, 100);
    const load = .15 + (60 / interval(n)) * (2 * 80 / 3600);
    n.mAh = clamp(n.mAh + (sol / 1000 * 160 - load) * dtH, 0, 2600);
  }

  // pump switch firmware: protections run here, not in the cloud
  if (pump.on) {
    pump.runMin += dtH * 60;
    if (pump.phase) tripPump("PHASE", 0);
    else if (pump.dryWell) { pump.dryMin += dtH * 60; if (pump.dryMin >= 2) tripPump("DRY", 30); }
    else if (pump.runMin >= pump.maxRun) tripPump("MAXRT", 0);
  }

  // pond: photosynthesis − respiration + surface exchange + aerator (bank controller hysteresis 4 / 6 mg/L)
  pond.t += (airT + 1 - pond.t) * Math.min(1, dtH / 10);
  const sat = 14.62 - .3898 * pond.t + .006969 * pond.t ** 2 - .00005897 * pond.t ** 3;
  const crash = S.scen === "pondcrash" ? 1.6 : 1;
  const prod = 1.9 * solar / 1000, resp = .62 * crash * Math.pow(1.07, pond.t - 20);
  if (pond.mode === "AUTO") { if (pond.do < 4 && !pond.aer) { pond.aer = true; log("pond controller: DO below 4 → aerator ON (local, no cloud needed)"); } else if (pond.do > 6 && pond.aer) { pond.aer = false; log("pond controller: DO above 6 → aerator OFF"); } }
  else pond.aer = pond.mode === "ON";
  const aer = pond.aer && !pond.fail ? .45 * (sat - pond.do) + .4 : 0;
  pond.do = clamp(pond.do + (prod - resp + .06 * (sat - pond.do) + aer) * dtH, 0, 16);
  pond.ph += ((7.1 + .9 * prod / 1.9 - (solar < 5 ? .25 : 0)) - pond.ph) * Math.min(1, dtH / 3);

  // sticky trap insects
  const gW = Math.exp(-(((airT - 28) / 6) ** 2)), gA = Math.exp(-(((airT - 22) / 6) ** 2));
  const humidBoost = S.scen === "fog" ? 2.6 : 1;
  trap.wf = clamp(trap.wf * Math.exp((.45 * gW * humidBoost - (e.rain > 10 ? .6 : 0) - .08) * dtH / 24), 1, 600);
  trap.ap = clamp(trap.ap * Math.exp((.40 * gA * humidBoost - (e.rain > 10 ? .6 : 0) - .08) * dtH / 24), 1, 600);
}

const battV = (n: Node) => 3.30 + 0.90 * n.mAh / 2600;
const interval = (n: Node) => (battV(n) < 3.40 ? 60 : 15);
const rssi = (dist: number) => Math.round(-45 - 25 * Math.log10(dist) + rnd(-3, 3) - (S.env.rain > 20 ? 2 : 0));
const f1 = (v: number) => Math.round(v * 10) / 10;

function tripPump(reason: string, lockMin: number) {
  pump.on = false; pump.trip = reason; pump.lockUntil = S.min + lockMin; pump.runMin = 0; pump.dryMin = 0;
  log(`pump switch firmware tripped the motor: ${reason}`);
  sendPump();
}

/* ------------------------------------------------------------------ packets */
function soilPacket(n: Node): string {
  const noise = (v: number, a: number) => v + rnd(-a, a);
  // Same fields and order as soil firmware v2.2. EC, PH and NPK stay NA until the RS485 probe is fitted.
  return encodeAm1(n.id, "SOIL", ++n.seq, {
    M1: f1(clamp(noise(n.m1, .6), 0, 100)), M2: f1(clamp(noise(n.m2, .6), 0, 100)), ST: f1(noise(n.st, .1)),
    AT: f1(noise(S.airT + SOILS[n.soil].temp * .5, .2)), AH: f1(clamp(noise(S.airH, .8), 0, 100)), LW: Math.round(n.lw),
    LX: Math.round(clamp(S.solar * SOILS[n.soil].solar / 10, 0, 100)), EC: null, PH: null, NPK: null,
    BV: battV(n).toFixed(2), HOP: n.dist > 500 ? 1 : 0, RSSI: rssi(n.dist),
  });
}
function sendPump() {
  const current = pump.on ? (pump.dryWell ? 4.1 : 7.2 + rnd(-.15, .15)) : 0;
  queue(encodeAm1(pump.id, "PUMP", ++pump.seq, { RUN: pump.on ? 1 : 0, I: current.toFixed(1), PHASE: pump.phase ? "FAIL" : "OK", RT: Math.round(pump.runMin),
    Q: pump.on && !pump.dryWell ? 300 : 0, TRIP: pump.trip ? 1 : 0, TR: pump.trip || undefined, RSSI: rssi(120) }));
}
function sendPond() {
  const aeri = pond.aer ? (pond.fail ? 0.0 : 6.4 + rnd(-.12, .12)) : 0;
  const sat = 14.62 - .3898 * pond.t + .006969 * pond.t ** 2 - .00005897 * pond.t ** 3;
  queue(encodeAm1(pond.id, "POND", ++pond.seq, { DO: pond.do.toFixed(2), DOS: Math.round(pond.do / sat * 100), PH: pond.ph.toFixed(2), WT: pond.t.toFixed(1),
    AER: pond.aer ? 1 : 0, AERI: aeri.toFixed(1), BV: "3.95", FLT: pond.aer && pond.fail ? 10 : 0, RSSI: rssi(300) }));
}
function sendTrap() {
  queue(encodeAm1(trap.id, "TRAP", ++trap.seq, { WF: Math.round(trap.wf), AP: Math.round(trap.ap), LWH: 0, IMG: 1, RSSI: rssi(500) }));
}

/* ------------------------------------------------------------------ transport */
let outbox: { raw: string; ts?: number }[] = [];
const queue = (raw: string, ts?: number) => outbox.push({ raw, ts });
let client: mqtt.MqttClient | null = null;
const headers = (type: string) => ({ "Content-Type": type, ...(KEY ? { "X-BHOOMI-Token": KEY } : {}) });

async function flush() {
  if (!outbox.length) return;
  const batch = outbox; outbox = [];
  if (!USE_HTTP && client?.connected && batch.every(b => b.ts == null)) {
    client.publish(`bhoomi/${GW}/up`, batch.map(b => b.raw).join("\n"), { qos: 1 });
    return;
  }
  try {
    const res = await fetch(`${HTTP}/api/ingest?gw=${GW}`, { method: "POST", headers: headers("application/json"), body: JSON.stringify({ gw: GW, packets: batch }) });
    const r = await res.json() as { accepted: number; rejected: { error: string; raw: string }[] };
    for (const x of r.rejected ?? []) log(`hub rejected: ${x.error} :: ${x.raw}`);
  } catch (e) { log(`hub unreachable (${(e as Error).message}); will retry`); outbox = batch.concat(outbox); }
}

async function setForecast(p: number, mm: number, rainNow: number) {
  try { await fetch(`${HTTP}/api/settings`, { method: "PUT", headers: headers("application/json"), body: JSON.stringify({ weatherOverride: { rainProb12h: p, rainMm24h: mm, rainNowMm: rainNow } }) }); }
  catch { /* hub not up yet */ }
}

/** Firmware command handling: AM1,ID=<hub>,T=CMD,N=<n>,DST=<node>,<KEY>=<VALUE>...,TS=<unix s> → T=ACK,N=<n>,OK=1|0. */
function handleCommand(line: string) {
  let p; try { p = parseAm1(line); } catch { return; }
  if (p.type !== "CMD" || p.seq == null) return;
  const dst = String(p.fields.DST ?? ""), f = p.fields;
  if (dst === pump.id) {
    let ok = true;
    if (f.PUMP === "ON") {
      if (S.min < pump.lockUntil) { ok = false; log(`pump switch refused ON: locked after dry run`); }
      else if (pump.phase) { ok = false; log("pump switch refused ON: phase missing"); }
      else { pump.on = true; pump.trip = ""; pump.runMin = 0; }
    } else if (f.PUMP === "OFF") pump.on = false;
    log(`command #${p.seq}: pump ${f.PUMP ?? "STATUS"} → ${ok ? "done" : "refused"}`);
    queue(encodeAm1(pump.id, "ACK", p.seq, { OK: ok ? 1 : 0, RUN: pump.on ? 1 : 0, ERR: ok ? undefined : (pump.phase ? "PHASE" : "LOCKED") }));
    sendPump();
  } else if (dst === pond.id) {
    let ok = true;
    if ("AER" in f) {
      if (f.AER === "ON" || f.AER === "OFF" || f.AER === "AUTO") { pond.mode = f.AER; if (f.AER !== "AUTO") pond.aer = f.AER === "ON"; }
      else ok = false;
    }
    log(`command #${p.seq}: ${"AER" in f ? `aerator ${f.AER}` : "status request"}`);
    queue(encodeAm1(pond.id, "ACK", p.seq, { OK: ok ? 1 : 0, MODE: pond.mode, AER: pond.aer && !pond.fail ? 1 : 0, ERR: ok ? undefined : "AER" }));
    sendPond();
  } else return;
  void flush();
}

/* ------------------------------------------------------------------ console */
const clock = () => { const d = Math.floor(S.min / 1440) + 1, h = Math.floor((S.min % 1440) / 60), m = Math.floor(S.min % 60); return `Day ${d} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
function log(msg: string) { console.log(`[sim ${clock()}] ${msg}`); }
function summary() {
  const live = nodes.filter(n => n.on);
  const avg = (k: "m1" | "m2") => Math.round(live.reduce((s, n) => s + n[k], 0) / Math.max(1, live.length));
  log(`${SCEN[S.scen].name} · air ${f1(S.airT)}°C ${Math.round(S.airH)}% · M1 ${avg("m1")}% M2 ${avg("m2")}% · pump ${pump.on ? "ON" : pump.trip ? `TRIP(${pump.trip})` : "off"} · pond DO ${pond.do.toFixed(1)} aer ${pond.aer ? "ON" : "off"}${pond.fail ? "(FAULT)" : ""}`);
}

function setupKeys() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  process.stdin.on("data", (k: string) => {
    if (k === "q" || k === "\u0003") process.exit(0);
    const i = Number(k);
    if (i >= 1 && i <= SCEN_KEYS.length) applyScenario(SCEN_KEYS[i - 1]);
    if (k === "d") { pump.dryWell = !pump.dryWell; log(`fault: borewell dry ${pump.dryWell ? "ON" : "cleared"}`); if (!pump.dryWell && pump.trip === "DRY") { pump.trip = ""; pump.lockUntil = -1; sendPump(); } }
    if (k === "p") { pump.phase = !pump.phase; log(`fault: phase failure ${pump.phase ? "ON" : "cleared"}`); if (!pump.phase && pump.trip === "PHASE") { pump.trip = ""; sendPump(); } }
    if (k === "a") { pond.fail = !pond.fail; log(`fault: aerator motor ${pond.fail ? "FAILED" : "repaired"}`); }
    if (k === "k" && nodes[1]) { nodes[1].on = !nodes[1].on; log(`node N2 (${nodes[1].id}) ${nodes[1].on ? "revived" : "killed"}`); }
    if (k === "n" && nodes.length < SLOTS.length) { nodes.push(makeNode(nodes.length)); log(`new node ${nodes.at(-1)!.id} switched on: watch it register itself`); }
    void flush();
  });
}

/* ------------------------------------------------------------------ main */
async function tickSim(dMin: number, ts?: number) {
  const steps = Math.max(1, Math.ceil(dMin / 2));
  for (let i = 0; i < steps; i++) {
    S.min += dMin / steps; step(dMin / steps / 60);
    for (const n of nodes) while (S.min >= n.next) { if (n.on && n.mAh > .5) queue(soilPacket(n), ts); n.next += interval(n); }
    while (S.min >= pump.next) { sendPumpAt(ts); pump.next += 15; }
    while (S.min >= pond.next) { sendPondAt(ts); pond.next += pond.do < 5 ? 5 : 15; }
    while (S.min >= trap.next) { sendTrapAt(ts); trap.next += 120; }
  }
}
function sendPumpAt(ts?: number) { sendPump(); if (ts != null) outbox.at(-1)!.ts = ts; }
function sendPondAt(ts?: number) { sendPond(); if (ts != null) outbox.at(-1)!.ts = ts; }
function sendTrapAt(ts?: number) { sendTrap(); if (ts != null) outbox.at(-1)!.ts = ts; }

async function main() {
  if (flag("reset")) {
    const r = await fetch(`${HTTP}/api/admin/reset`, { method: "POST", headers: headers("application/json"), body: "{}" }).catch(() => null);
    console.log(r?.ok ? "hub data wiped" : "could not reset the hub (is the server running?)");
  }
  const count = clamp(Number(opt("nodes", "7")), 1, SLOTS.length);
  S.min = SCEN[S.scen].hour * 60;
  nodes = Array.from({ length: count }, (_, i) => makeNode(i));
  applyScenario(S.scen, false);
  const schedule = () => { nodes.forEach((n, i) => { n.next = S.min + 1 + i * 1.6; }); pump.next = S.min + 2; pond.next = S.min + 3; trap.next = S.min + 4; };

  if (BACKFILL_H > 0) {
    // Upload past readings with their original timestamps, the way a gateway empties its offline buffer.
    // The model runs BACKFILL_H hours ahead from the scenario's start; each packet is stamped that long ago.
    console.log(`uploading ${BACKFILL_H} h of history…`);
    const now = Date.now();
    schedule();
    for (let m = 0; m < BACKFILL_H * 60; m += 5) {
      await tickSim(5, now - (BACKFILL_H * 60 - m) * 60_000);
      if (outbox.length > 200) await flush();
    }
    await flush();
    console.log("history uploaded");
  }
  schedule();

  if (USE_HTTP) {
    setInterval(async () => {
      try {
        const r = await fetch(`${HTTP}/api/gateway/commands?gw=${GW}`, { headers: headers("text/plain") });
        for (const line of (await r.text()).split("\n")) if (line.trim()) handleCommand(line);
      } catch { /* retry next time */ }
    }, 2000);
  } else {
    client = mqtt.connect(MQTT_URL, { clientId: `sim-${GW}`, password: KEY || undefined, username: KEY ? GW : undefined, reconnectPeriod: 2000 });
    client.on("connect", () => { log(`connected to MQTT ${MQTT_URL} as gateway ${GW}`); client!.subscribe("bhoomi/hub/down", { qos: 1 }); });
    client.on("message", (_t, payload) => { for (const line of payload.toString().split("\n")) handleCommand(line); });
    client.on("error", e => log(`MQTT error: ${e.message}`));
  }

  log(`simulating ${nodes.length} soil nodes, pump switch, pond node and trap camera · ${SPEED}× real time · ${USE_HTTP ? "HTTP" : "MQTT"}`);
  log("keys: 1-8 weather · d borewell dry · p phase failure · a aerator fault · k kill N2 · n new node · q quit");
  SCEN_KEYS.forEach((k, i) => console.log(`   ${i + 1} = ${SCEN[k].name}`));
  setupKeys();

  let last = Date.now(), lastSummary = 0;
  setInterval(async () => {
    const t = Date.now(), dMin = (t - last) / 1000 * SPEED / 60; last = t;
    await tickSim(dMin);
    await flush();
    if (S.min - lastSummary >= 60) { lastSummary = S.min; summary(); }
  }, 250);
}

main().catch(e => { console.error(e); process.exit(1); });
