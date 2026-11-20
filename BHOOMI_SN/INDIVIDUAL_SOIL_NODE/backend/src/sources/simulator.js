// Built-in field simulator: produces the same AM1 packets real nodes send, so the backend,
// API and twins can be developed and demoed with no hardware.
// Simulated time runs faster than real time: one packet every SIM_INTERVAL_S real seconds
// stands for one 15-minute report, so a whole day passes in 96 packets.
import { formatAM1, parseAM1 } from '../am1.js';

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// How each soil type behaves: how fast topsoil dries, how much water drains to 30 cm.
export const SOILS = {
  'sandy loam': { dry: 1.35, drain: 1.4, m1: 38, m2: 48 },
  'clay loam':  { dry: 0.8,  drain: 0.6, m1: 52, m2: 60 },
  'loam':       { dry: 1.0,  drain: 1.0, m1: 46, m2: 57 },
};

/** One simulated soil node (firmware v2.2 behaviour: 15-min reports, NA for missing sensors). */
export class SoilNodeSim {
  constructor({ id, soil = 'loam', hop = 0, shade = 0 }) {
    const s = SOILS[soil] || SOILS.loam;
    Object.assign(this, { id, soil, hop, shade, k: s });
    this.seq = 1000 + Math.floor(Math.random() * 50000);
    this.m1 = s.m1; this.m2 = s.m2; this.st = 25.5; this.lw = 0; this.bv = 3.95; this.at = 26; this.ah = 70;
    this.faults = { m1: false, ds: false, sht: false };
  }
  /** Advance 15 simulated minutes at local hour h (0–24) and return an AM1 line. */
  step(h, weather = { cloud: 0.2, rain: 0, mean: 29, amp: 6, rh: 62 }) {
    const sun = Math.max(0, Math.sin(Math.PI * (h - 6) / 12)) * (1 - 0.85 * weather.cloud) * (1 - this.shade);
    const airT = weather.mean + weather.amp * Math.cos(2 * Math.PI * (h - 15) / 24) - (weather.rain > 0 ? 2.5 : 0);
    this.at += (airT - this.at) * 0.6;
    this.ah += (clamp(weather.rh - 2.2 * (this.at - weather.mean) + (weather.rain > 0 ? 25 : 0), 12, 100) - this.ah) * 0.6;
    this.st += (weather.mean - 1.5 + 0.35 * (this.at - weather.mean) - 0.03 * (this.m1 - 40) - this.st) * 0.07;
    // water balance for 15 min
    this.m1 = Math.min(100, this.m1 + weather.rain * 0.29 * (1 - this.m1 / 104));
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

/** Stage presets. Stage 1 = one node next to the hub. Later stages add more nodes. */
export function buildFleet(stage) {
  if (stage <= 1) return [new SoilNodeSim({ id: '7C9E1A', soil: 'loam', hop: 0 })];
  return [new SoilNodeSim({ id: '7C9E1A', soil: 'loam', hop: 0 })];
}

/**
 * Start the simulator. `ingest(line, rx)` receives every generated packet.
 * Returns { stop, fleet, simMinute() }.
 */
export function startSimulator({ stage = 1, intervalS = 15, ingest, startHour = 6 }) {
  const fleet = buildFleet(stage);
  let simMin = startHour * 60;
  const weather = { cloud: 0.2, rain: 0, mean: 29, amp: 6, rh: 62 };
  const tick = () => {
    simMin += 15;
    const h = (simMin % 1440) / 60;
    for (const node of fleet) {
      const line = node.step(h, weather);
      const rssi = -92 - 6 * node.hop + Math.round(gauss() * 3);
      ingest(line, { rssi, snr: r1(7 + gauss() * 1.5), hop: node.hop, source: 'simulator', simMinute: simMin });
    }
  };
  tick();
  const timer = setInterval(tick, Math.max(1, intervalS) * 1000);
  return { stop: () => clearInterval(timer), fleet, weather, simMinute: () => simMin, parse: parseAM1 };
}
