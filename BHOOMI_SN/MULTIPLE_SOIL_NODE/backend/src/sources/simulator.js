// Built-in field simulator: produces the same AM1 packets real nodes send, so the backend,
// API and twins can be developed and demoed with no hardware.
// Simulated time runs faster than real time: one packet every SIM_INTERVAL_S real seconds
// stands for one 15-minute report, so a whole day passes in 96 packets.
import { formatAM1, parseAM1 } from '../am1.js';

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// How each soil type behaves (same six soils as the stage-2 field twin):
//   dry   = how fast topsoil loses water, drain = how fast water moves 15 cm -> 30 cm,
//   inflow= rain that runs in from higher ground, seep = canal seepage, solar = sun reaching the panel/leaves
export const SOILS = {
  loam:  { name: 'Loam',        dry: 1.0,  drain: 1.0, inflow: 0,   seep: 0,   solar: 1,    dt: 0,    m1: 46, m2: 57 },
  clay:  { name: 'Clay loam',   dry: 0.9,  drain: 0.7, inflow: 0,   seep: 0,   solar: 1,    dt: 0,    m1: 52, m2: 60 },
  sandy: { name: 'Sandy loam',  dry: 1.25, drain: 1.8, inflow: 0,   seep: 0,   solar: 1,    dt: 0.5,  m1: 38, m2: 48 },
  low:   { name: 'Low corner',  dry: 0.9,  drain: 0.5, inflow: 0.7, seep: 0,   solar: 1,    dt: -0.3, m1: 57, m2: 65 },
  canal: { name: 'Near canal',  dry: 0.95, drain: 0.8, inflow: 0,   seep: 1.1, solar: 1,    dt: -0.5, m1: 54, m2: 65 },
  shade: { name: 'Tree shade',  dry: 0.65, drain: 0.9, inflow: 0,   seep: 0,   solar: 0.45, dt: -1.6, m1: 51, m2: 58 },
  bund:  { name: 'Raised bund', dry: 1.15, drain: 1.4, inflow: 0,   seep: 0,   solar: 1,    dt: 0.6,  m1: 40, m2: 49 },
};

// Weather presets the demo can switch to (POST /api/sim/weather)
export const WEATHER = {
  normal:   { name: 'Clear Kharif day', cloud: 0.15, rain: 0,  mean: 30, amp: 9,  rh: 65 },
  monsoon:  { name: 'Monsoon downpour', cloud: 0.95, rain: 15, mean: 26, amp: 3,  rh: 92 },
  cyclone:  { name: 'Cyclone landfall', cloud: 1.0,  rain: 35, mean: 25, amp: 2,  rh: 97 },
  heatwave: { name: 'Heatwave',         cloud: 0,    rain: 0,  mean: 39, amp: 12, rh: 22 },
  drought:  { name: 'Dry spell',        cloud: 0.1,  rain: 0,  mean: 33, amp: 10, rh: 35 },
  fog:      { name: 'Humid foggy night',cloud: 0.7,  rain: 0,  mean: 24, amp: 4,  rh: 97 },
};

/** One simulated soil node (firmware v2.2 behaviour: 15-min reports, NA for missing sensors). */
export class SoilNodeSim {
  constructor({ id, soil = 'loam', hop = 0, label = null, x = 0, z = 0, place = '' }) {
    const s = SOILS[soil] || SOILS.loam;
    Object.assign(this, { id, soil, hop, label: label || id, x, z, place, k: s, on: true });
    this.seq = 1000 + Math.floor(Math.random() * 50000);
    this.m1 = s.m1; this.m2 = s.m2; this.st = 25.5; this.lw = 0; this.bv = 3.95; this.at = 26; this.ah = 70;
    this.faults = { m1: false, ds: false, sht: false };
  }
  /** Advance 15 simulated minutes at local hour h (0–24) and return an AM1 line. */
  step(h, weather = { cloud: 0.2, rain: 0, mean: 29, amp: 6, rh: 62 }) {
    const sun = Math.max(0, Math.sin(Math.PI * (h - 6) / 12)) * (1 - 0.85 * weather.cloud) * this.k.solar;
    const airT = weather.mean + weather.amp * Math.cos(2 * Math.PI * (h - 15) / 24) - (weather.rain > 0 ? 2.5 : 0);
    this.at += (airT + this.k.dt * 0.5 - this.at) * 0.6;
    this.ah += (clamp(weather.rh - 2.2 * (this.at - weather.mean) + (weather.rain > 0 ? 25 : 0), 12, 100) - this.ah) * 0.6;
    this.st += (weather.mean - 1.5 + this.k.dt + 0.35 * (this.at - weather.mean) - 0.03 * (this.m1 - 40) - this.st) * 0.07;
    // water balance for 15 min
    this.m1 = Math.min(100, this.m1 + weather.rain * 0.29 * (1 + this.k.inflow) * (1 - this.m1 / 104));
    this.m2 = Math.min(100, this.m2 + 0.12 * this.k.seep * Math.max(0, 70 - this.m2) / 70);
    if (this.irrigating) this.m1 = Math.min(100, this.m1 + 4.8 * (1 - this.m1 / 104));
    const et = 0.5 * sun * clamp(this.at / 30, 0.4, 1.6) * clamp(this.m1 / 38, 0, 1) * (1 - this.ah / 150) * this.k.dry;
    this.m1 -= et;
    const d12 = (0.18 * Math.max(0, this.m1 - 44) + 0.02 * Math.max(0, this.m1 - this.m2)) * this.k.drain;
    this.m1 -= d12; this.m2 += d12 * 0.9;
    this.m2 -= 0.06 * Math.max(0, this.m2 - 52) + 0.09 * sun * clamp(this.m2 / 40, 0, 1);
    this.m1 = clamp(this.m1, 3, 100); this.m2 = clamp(this.m2, 3, 100);
    // farmer irrigates when the topsoil gets dry, stops when it is wet again
    if (!this.irrigating && this.m1 < 26 && h > 6 && h < 10) this.irrigating = true;
    if (this.irrigating && this.m1 > 48) this.irrigating = false;
    // wetness: rain, or dew on calm humid nights
    if (weather.rain > 0.3) this.lw += (100 - this.lw) * 0.9;
    else if (sun < 0.02 && this.ah > 86) this.lw = Math.min(100, this.lw + 14);
    else this.lw = Math.max(0, this.lw - (2 + 30 * sun));
    // battery: 0.8 W panel charges by day, ~0.5 mA sleep + a short wake every 15 min
    this.bv = clamp(this.bv + 0.012 * sun - 0.0025, 3.05, 4.18);

    this.seq += 1;
    const f = this.faults;
    const fields = {
      M1: f.m1 ? null : r1(this.m1 + gauss() * 0.4), M2: r1(this.m2 + gauss() * 0.4),
      ST: f.ds ? null : r1(this.st + gauss() * 0.06),
      AT: f.sht ? null : r1(this.at + gauss() * 0.1), AH: f.sht ? null : r1(clamp(this.ah + gauss() * 0.6, 0, 100)),
      LW: Math.round(clamp(this.lw + gauss() * 1.5, 0, 100)), LX: r1(clamp(sun * 100, 0, 100)),
      EC: null, PH: null, NPK: null, BV: (this.bv + gauss() * 0.006).toFixed(2), HOP: this.hop,
    };
    return formatAM1(this.id, 'SOIL', this.seq, fields);
  }
}

// Field layout shared with the stage-2/3 twins: 280 x 200 m field, hub at the farmhouse (x=-178, z=0).
export const HUB_POS = { x: -178, z: 0 };
export const SLOTS = [
  { id: '7C9E1A', label: 'N1', x: -110, z: -70, soil: 'sandy', place: 'north-west' },
  { id: '3F21A0', label: 'N2', x: 0,    z: -80, soil: 'clay',  place: 'north' },
  { id: 'B4D7C2', label: 'N3', x: 110,  z: -70, soil: 'shade', place: 'north-east' },
  { id: '91E04F', label: 'N4', x: 110,  z: 70,  soil: 'low',   place: 'south-east' },
  { id: 'C2A8B3', label: 'N5', x: 0,    z: 80,  soil: 'canal', place: 'south' },
  { id: '5D3F77', label: 'N6', x: -110, z: 70,  soil: 'bund',  place: 'south-west' },
  { id: '0AE6D9', label: 'N7', x: 0,    z: 0,   soil: 'clay',  place: 'centre' },
];

/** Stage presets. Stage 1 = one node next to the hub. Stage 2+ = the 7-node field. */
export function buildFleet(stage) {
  if (stage <= 1) return [new SoilNodeSim({ id: '7C9E1A', soil: 'loam', hop: 0, label: 'N1' })];
  return SLOTS.map((s) => new SoilNodeSim(s));
}

// LoRa link model used by the twins: 5 dBm TX, log-distance path loss, -123 dBm sensitivity
// (about 158 m range in clear weather, less in heavy rain).
export const radio = {
  txp: 5, thresh: -123,
  rssiAt(d, rain = 0) { return this.txp - 40 - 40 * Math.log10(Math.max(d, 5)) - (rain > 20 ? 4 : rain > 5 ? 2 : 0); },
};
/**
 * Shortest-path mesh routes from every working node to the hub (Dijkstra, cost grows as links get weak).
 * Returns Map(node -> [node, relay..., 'HUB']) ; nodes with no route are missing from the map.
 */
export function computeRoutes(fleet, { mesh = true, rain = 0 } = {}) {
  const HUB = { id: 'HUB', label: 'Hub', ...HUB_POS, isHub: true };
  const V = [HUB, ...fleet.filter((n) => n.on)];
  const D = new Map(V.map((v) => [v, Infinity])); D.set(HUB, 0);
  const prev = new Map(); const done = new Set();
  while (done.size < V.length) {
    let u = null, best = Infinity;
    for (const v of V) if (!done.has(v) && D.get(v) < best) { best = D.get(v); u = v; }
    if (!u) break; done.add(u);
    for (const v of V) {
      if (done.has(v) || v === u || (!mesh && !u.isHub)) continue;
      const r = radio.rssiAt(Math.hypot(u.x - v.x, u.z - v.z), rain);
      if (r < radio.thresh) continue;
      const c = 1 + Math.max(0, -108 - r) / 5;
      if (D.get(u) + c < D.get(v)) { D.set(v, D.get(u) + c); prev.set(v, u); }
    }
  }
  const routes = new Map();
  for (const n of fleet) {
    if (!n.on || !prev.has(n)) continue;
    const path = [n]; let c = n; while (prev.has(c)) { c = prev.get(c); path.push(c); }
    routes.set(n, path);
  }
  return routes;
}

/**
 * Start the simulator. `ingest(line, rx)` receives every packet the hub would hear.
 * Returns a controller used by the /api/sim routes.
 */
export function startSimulator({ stage = 1, intervalS = 15, ingest, startHour = 6 }) {
  const fleet = buildFleet(stage);
  let simMin = startHour * 60;
  const ctl = { stage, mesh: true, weatherKey: 'normal', weather: { ...WEATHER.normal }, routes: new Map() };
  const routeIds = (path) => path.map((p) => p.id);
  const tick = () => {
    simMin += 15;
    const h = (simMin % 1440) / 60;
    ctl.routes = computeRoutes(fleet, { mesh: ctl.mesh, rain: ctl.weather.rain });
    for (const node of fleet) {
      if (!node.on) continue;                                   // a failed node sends nothing
      const path = stage <= 1 ? null : ctl.routes.get(node);
      node.hop = path ? path.length - 2 : 0;                    // relays passed (0 = straight to the hub)
      const line = node.step(h, ctl.weather);
      if (stage > 1 && !path) continue;                         // no route: packet never reaches the hub
      // weakest link on the way decides the signal the hub reports
      let rssi = -92 + Math.round(gauss() * 3);
      if (path) {
        rssi = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const r = Math.round(radio.rssiAt(Math.hypot(path[i].x - path[i + 1].x, path[i].z - path[i + 1].z), ctl.weather.rain) + gauss() * 2);
          rssi = i === 0 ? r : Math.min(rssi, r);
        }
      }
      ingest(line, { rssi, snr: r1(7 + gauss() * 1.5 - node.hop), hop: node.hop, via: path && path.length > 2 ? path[1].id : null,
        path: path ? routeIds(path) : null, source: 'simulator', simMinute: simMin });
    }
  };
  tick();
  const timer = setInterval(tick, Math.max(1, intervalS) * 1000);
  return Object.assign(ctl, {
    fleet, stop: () => clearInterval(timer), simMinute: () => simMin, parse: parseAM1, tick,
    setWeather(key) { if (!WEATHER[key]) return false; ctl.weatherKey = key; ctl.weather = { ...WEATHER[key] }; return true; },
    setNode(id, { on, faults } = {}) {
      const n = fleet.find((x) => x.id === String(id).toUpperCase()); if (!n) return null;
      if (typeof on === 'boolean') n.on = on;
      if (faults) for (const k of ['m1', 'ds', 'sht']) if (typeof faults[k] === 'boolean') n.faults[k] = faults[k];
      return n;
    },
    state() {
      ctl.routes = computeRoutes(fleet, { mesh: ctl.mesh, rain: ctl.weather.rain });
      return { stage, simMinute: simMin, weather: ctl.weatherKey, weatherInfo: ctl.weather, mesh: ctl.mesh, intervalS,
        nodes: fleet.map((n) => ({ id: n.id, label: n.label, soil: n.soil, place: n.place, x: n.x, z: n.z, on: n.on, faults: n.faults,
          route: ctl.routes.get(n) ? ctl.routes.get(n).map((p) => p.label) : null })) };
    },
  });
}
