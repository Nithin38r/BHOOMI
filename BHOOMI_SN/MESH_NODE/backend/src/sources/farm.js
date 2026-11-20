// Stage 3: the rest of the farm on the same mesh as the soil nodes.
// Mains-powered devices near the farmhouse (they also relay for others):
//   PUMP  P1A2B3  pump switch: relay on the starter, current sensor, phase monitor, flow meter
//   TREAT M5A6B7  treatment tank: pH/EC probes, dosing pumps
//   TANK  T4C5D6  storage tank: level, 3 zone valves, flow and pressure
//   POND  D0A1B2  pond water node: pH, EC, turbidity, temperature, DO, level, aerator
// Packet bodies match the stage-3 twin exactly.
import { formatAM1 } from '../am1.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
const rnd = (a, b) => a + Math.random() * (b - a);

export const DEVICES = [
  { id: 'P1A2B3', type: 'PUMP',  label: 'Pump',           x: -201.3, z: -57 },
  { id: 'M5A6B7', type: 'TREAT', label: 'Treatment tank', x: -182,   z: -48 },
  { id: 'T4C5D6', type: 'TANK',  label: 'Storage tank',   x: -159,   z: -35 },
  { id: 'D0A1B2', type: 'POND',  label: 'Pond node',      x: -196,   z: -122 },
];

// FAO 29 salt tolerance (ECw, dS/m) and irrigation trigger/stop moisture for each crop (same table as the twin)
export const CROPS = {
  rice:   { name: 'Rice',   ec100: 2.0, ec90: 2.6, trig: 50, full: 80 },
  wheat:  { name: 'Wheat',  ec100: 4.0, ec90: 4.9, trig: 30, full: 70 },
  tomato: { name: 'Tomato', ec100: 1.7, ec90: 2.3, trig: 35, full: 72 },
  onion:  { name: 'Onion',  ec100: 0.8, ec90: 1.2, trig: 38, full: 72 },
  orange: { name: 'Orange', ec100: 1.1, ec90: 1.6, trig: 28, full: 68 },
  grape:  { name: 'Grape',  ec100: 1.0, ec90: 1.7, trig: 26, full: 66 },
};

export const POND_EVENTS = {
  acid:   { name: 'Acid runoff',   ph: 5.6 },
  saline: { name: 'Saline inflow', ec: 3.2 },
  algae:  { name: 'Algal bloom',   algae: 0.9 },
  mud:    { name: 'Muddy runoff',  tu: 170 },
  clear:  { name: 'Reset pond',    clear: true },
};

export const ZONES = ['North', 'Middle', 'South'];
export const zoneOfZ = (z) => (z < -33 ? 0 : z > 33 ? 2 : 1);

/** Water-quality check of pond water for a crop (pH 6.5–8.4, EC by FAO 29, turbidity for drip). */
export function verdict(q, cropKey) {
  const c = CROPS[cropKey] || CROPS.rice; const reasons = []; let level = 'ok';
  const up = (l) => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };
  if (!q || q.ph == null) return { level: 'bad', title: 'No water data', reasons: [['bad', 'No pond data reaching the hub']] };
  if (q.ph >= 6.5 && q.ph <= 8.4) reasons.push(['ok', `pH ${q.ph.toFixed(2)} within 6.5–8.4`]);
  else if (q.ph >= 6.0 && q.ph <= 8.8) { reasons.push(['warn', `pH ${q.ph.toFixed(2)} slightly outside 6.5–8.4`]); up('warn'); }
  else { reasons.push(['bad', `pH ${q.ph.toFixed(2)} outside 6.0–8.8`]); up('bad'); }
  if (q.ec <= c.ec100) reasons.push(['ok', `EC ${q.ec.toFixed(2)} ≤ ${c.ec100} dS/m: no yield loss`]);
  else if (q.ec <= c.ec90) { reasons.push(['warn', `EC ${q.ec.toFixed(2)} dS/m: up to 10 % yield loss for ${c.name}`]); up('warn'); }
  else { reasons.push(['bad', `EC ${q.ec.toFixed(2)} > ${c.ec90} dS/m: more than 10 % yield loss`]); up('bad'); }
  if (q.tu <= 50) reasons.push(['ok', `Turbidity ${Math.round(q.tu)} NTU: drip filter OK`]);
  else if (q.tu <= 100) { reasons.push(['warn', `Turbidity ${Math.round(q.tu)} NTU: clean the filter more often`]); up('warn'); }
  else { reasons.push(['bad', `Turbidity ${Math.round(q.tu)} NTU: would clog drippers`]); up('bad'); }
  const title = level === 'ok' ? `Suitable for ${c.name}` : level === 'warn' ? `Use with care for ${c.name}` : `Not suitable for ${c.name}`;
  return { level, title, reasons };
}

/** Farm water system: pond -> (treatment) -> storage tank -> three zone valves -> soil nodes. */
export class FarmSim {
  constructor(soilFleet) {
    this.soil = soilFleet;
    for (const n of soilFleet) n.autoIrrigate = false;          // the hub decides irrigation now
    this.devices = DEVICES.map((d) => ({ ...d, on: true, seq: 1000 + Math.floor(Math.random() * 40000) }));
    this.crop = 'rice';
    this.auto = true;                                            // hub automation (UZHAVAN AI rules)
    this.pump = { run: false, current: 0, runMin: 0, flowIn: 0, phaseFail: false, trip: false, dryWell: false, lockUntil: -1 };
    this.tank = { lvl: 70, cap: 10000, valves: [false, false, false], valveMin: [0, 0, 0], flowOut: 0, pressure: 0, litres: 0 };
    this.treat = { lvl: 0, ph: 7.4, ec: 0.9, stage: 'IDLE', dose: 0 };
    this.pond = { ph: 7.4, ec: 0.9, tu: 12, wt: 28, do: 6.8, lvl: 70, aer: false, aerMode: 'AUTO', algae: 0.15, target: { ph: 7.4, ec: 0.9, tu: 12 } };
    this.events = [];                                            // what the hub did, for the log
  }

  zoneMeans() {
    return ZONES.map((_, z) => {
      const ns = this.soil.filter((n) => n.on && zoneOfZ(n.z) === z && !n.faults.m1);
      return ns.length ? ns.reduce((s, n) => s + n.m1, 0) / ns.length : null;
    });
  }

  /** Command from the hub/API. Returns the ACK fields, or null if this device is unknown. */
  command(id, set, simMin) {
    const d = this.devices.find((x) => x.id === id); if (!d) return null;
    const ok = (extra = {}) => ({ OK: 1, ...extra });
    if (d.type === 'PUMP' && set.RUN !== undefined) {
      const on = String(set.RUN) === '1' || String(set.RUN).toUpperCase() === 'ON';
      if (on && this.pump.phaseFail) return { OK: 0, ERR: 'PHASE' };
      if (on && simMin < this.pump.lockUntil) return { OK: 0, ERR: 'LOCKED' };
      this.pump.run = on; this.pump.trip = false; if (!on) this.pump.runMin = 0;
      this.log(`Pump ${on ? 'START' : 'STOP'} by command`);
      return ok({ RUN: on ? 1 : 0 });
    }
    if (d.type === 'TANK' && set.VLV !== undefined) {
      const v = String(set.VLV).padEnd(3, '0').slice(0, 3).split('').map((c) => c === '1');
      this.tank.valves = v; this.log(`Valves set to ${set.VLV} by command`);
      return ok({ VLV: v.map((x) => (x ? 1 : 0)).join('') });
    }
    if (d.type === 'POND' && set.AER !== undefined) {
      const m = String(set.AER).toUpperCase();
      if (!['ON', 'OFF', 'AUTO'].includes(m)) return { OK: 0, ERR: 'AER' };
      this.pond.aerMode = m; if (m !== 'AUTO') this.pond.aer = m === 'ON';
      this.log(`Aerator ${m} by command`);
      return ok({ AER: m });
    }
    return { OK: 0, ERR: 'UNKNOWN' };
  }

  pondEvent(key) {
    const e = POND_EVENTS[key]; if (!e) return false;
    const t = this.pond.target;
    if (e.clear) { Object.assign(t, { ph: 7.4, ec: 0.9, tu: 12 }); this.pond.algae = 0.15; }
    if (e.ph) t.ph = e.ph; if (e.ec) t.ec = e.ec; if (e.tu) t.tu = e.tu; if (e.algae) this.pond.algae = e.algae;
    this.log(`Pond event: ${e.name}`);
    return true;
  }

  log(text) { this.events.push(text); if (this.events.length > 50) this.events.shift(); }

  /** Advance 15 simulated minutes. */
  step(simMin, weather) {
    const h = (simMin % 1440) / 60, dtMin = 15;
    const sun = Math.max(0, Math.sin(Math.PI * (h - 6) / 12)) * (1 - 0.85 * weather.cloud);
    const P = this.pond, T = this.tank, U = this.pump, R = this.treat, c = CROPS[this.crop] || CROPS.rice;

    // ---- pond water: follows its target slowly; algae push pH and DO up by day, DO falls at night
    P.ph += (P.target.ph + (P.algae > 0.5 ? 1.4 * sun : 0) - P.ph) * 0.25;
    P.ec += (P.target.ec - P.ec) * 0.25; P.tu += (P.target.tu - P.tu) * 0.3;
    P.wt += (weather.mean - 1 + 2 * Math.cos(2 * Math.PI * (h - 16) / 24) - P.wt) * 0.15;
    const sat = 14.62 - 0.3898 * P.wt + 0.006969 * P.wt ** 2 - 0.00005897 * P.wt ** 3;
    const photo = 2.2 * sun * (0.5 + P.algae), resp = 0.9 + 1.4 * P.algae;
    P.do = clamp(P.do + (photo - resp + (P.aer ? 2.6 : 0) + 0.12 * (sat - P.do)) * dtMin / 60, 0.5, sat * 1.6);
    if (P.aerMode === 'AUTO') { if (P.do < 4) P.aer = true; else if (P.do > 6) P.aer = false; }
    P.lvl = clamp(P.lvl + weather.rain * 0.02 - (U.run ? 0.25 : 0) - 0.01, 5, 100);

    // ---- hub automation: irrigate dry zones, refill the tank, treat bad water first
    const means = this.zoneMeans();
    const q = { ph: P.ph, ec: P.ec, tu: P.tu };
    const v = verdict(q, this.crop);
    if (this.auto) {
      // each watering session lasts at most 90 min, then the hub waits for the soil to dry below the trigger again
      means.forEach((m, z) => {
        if (m === null) return;
        if (!T.valves[z] && m < c.trig && T.lvl > 10 && weather.rain < 2) { T.valves[z] = true; T.valveMin[z] = 0; this.log(`${ZONES[z]} zone dry (${m.toFixed(1)} % < ${c.trig} %): valve OPEN`); }
        else if (T.valves[z]) {
          T.valveMin[z] += dtMin;
          const why = m >= c.full ? 'soil wet' : T.lvl <= 5 ? 'tank empty' : weather.rain >= 5 ? 'raining' : T.valveMin[z] >= 90 ? `90 min session done, now ${m.toFixed(1)} %` : '';
          if (why) { T.valves[z] = false; this.log(`${ZONES[z]} zone: valve CLOSED (${why})`); }
        }
      });
      const needRefill = T.lvl < 40 && !U.run && !U.phaseFail && simMin >= U.lockUntil;
      if (needRefill) {
        if (v.level === 'bad' && R.stage === 'IDLE') { R.stage = 'FILLING'; this.log(`Pond water: ${v.title}. Treating a batch before use`); }
        else if (v.level !== 'bad' || R.stage === 'READY') { U.run = true; U.runMin = 0; this.log('Tank low: pump START to refill'); }
      }
      if (U.run && T.lvl >= 95) { U.run = false; U.runMin = 0; this.log('Tank full: pump STOP'); }
      if (U.run && v.level === 'bad' && R.stage !== 'READY') { U.run = false; U.runMin = 0; this.log('Treated batch used up: pump STOP until the next batch is ready'); }
    }
    // treatment tank: fill, dose towards pH 7.2 / dilute EC, then hand over to the pump
    if (R.stage === 'FILLING') { R.lvl = clamp(R.lvl + 35, 0, 100); R.ph = P.ph; R.ec = P.ec; if (R.lvl >= 100) R.stage = 'DOSING'; }
    else if (R.stage === 'DOSING') { R.ph += (7.2 - R.ph) * 0.5; R.ec += (Math.min(R.ec, c.ec100) - R.ec) * 0.5; R.dose += 1; if (Math.abs(R.ph - 7.2) < 0.15) R.stage = 'READY'; }
    else if (R.stage === 'READY' && U.run) { R.lvl = clamp(R.lvl - 25, 0, 100); if (R.lvl <= 0) R.stage = 'IDLE'; }

    // ---- pump physics and its own protections (work even with the hub offline)
    if (U.phaseFail && U.run) { U.run = false; U.trip = true; this.log('Pump tripped: phase missing'); }
    const dry = U.dryWell || P.lvl < 8;
    if (U.run) {
      U.runMin += dtMin;
      U.current = dry ? r1(rnd(1.2, 1.8)) : r1(rnd(6.0, 6.6));
      U.flowIn = dry ? 0 : 120;                               // L/min, 1–2 HP pump
      if (dry) { U.run = false; U.trip = true; U.lockUntil = simMin + 60; U.flowIn = 0; this.log('Pump tripped: dry run (low current), locked 60 min'); }
      if (U.runMin >= 120) { U.run = false; this.log('Pump stopped: maximum run time 120 min'); }
    } else { U.current = 0; U.flowIn = 0; }

    // ---- tank and zone delivery
    const open = T.valves.filter(Boolean).length;
    T.flowOut = open && T.lvl > 1 ? 25 * open : 0;
    T.pressure = open ? r1(1.4 + 0.2 * Math.random()) / 1 : 0;
    T.lvl = clamp(T.lvl + (U.flowIn - T.flowOut) * dtMin / T.cap * 100, 0, 100);
    T.litres += T.flowOut * dtMin;
    for (const n of this.soil) n.irrigating = T.valves[zoneOfZ(n.z)] && T.flowOut > 0;
  }

  /** AM1 lines the four devices send this round (or just one device: a device reports at once after a command). */
  packets(onlyId = null) {
    const U = this.pump, T = this.tank, R = this.treat, P = this.pond;
    const body = {
      PUMP: { RUN: U.run ? 1 : 0, I: U.current.toFixed(1), PHASE: U.phaseFail ? 'FAIL' : 'OK', RT: Math.round(U.runMin), Q: U.flowIn, ...(U.trip ? { TRIP: 1 } : {}) },
      TANK: { LV: Math.round(T.lvl), Q: T.flowOut, P: T.pressure.toFixed(2), VLV: T.valves.map((v) => (v ? 1 : 0)).join(''), LIT: Math.round(T.litres) },
      TREAT: { LV: Math.round(R.lvl), PH: R.ph.toFixed(2), EC: R.ec.toFixed(2), STAGE: R.stage, DOSE: R.dose },
      POND: { PH: (P.ph + rnd(-0.02, 0.02)).toFixed(2), EC: P.ec.toFixed(2), TU: Math.round(P.tu), WT: P.wt.toFixed(1), DO: P.do.toFixed(1), LV: Math.round(P.lvl), AER: P.aer ? 1 : 0 },
    };
    return this.devices.filter((d) => d.on && (!onlyId || d.id === onlyId)).map((d) => { d.seq += 1; return { dev: d, line: formatAM1(d.id, d.type, d.seq, body[d.type]) }; });
  }

  state() {
    return { crop: this.crop, auto: this.auto, pump: { ...this.pump }, tank: { ...this.tank }, treat: { ...this.treat },
      pond: { ...this.pond, target: undefined }, zoneMoisture: this.zoneMeans().map((m) => (m === null ? null : r1(m))), events: this.events.slice(-12) };
  }
}
