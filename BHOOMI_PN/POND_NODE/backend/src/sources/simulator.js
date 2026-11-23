// Built-in simulator: runs the pond firmware models (the same files the 3D views run) and sends
// their packets through the normal ingest path, exactly like packets from a real gateway.
//
//   field : floating buoy 7C9E2A + bank controller 3B41F0 + paddle-wheel aerator (shared/model/field-model.cjs)
//   tank  : prototype node 5D20C7 in a 20 L tank (shared/model/tank-model.cjs)
//
// Each device keeps its own clock, so a scenario can jump to 21:00 on the pond without moving the tank.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const FM = require('../../../shared/model/field-model.cjs');
export const TM = require('../../../shared/model/tank-model.cjs');

const num = (v) => (typeof v === 'number' ? v : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v);
const noise = () => Math.round((Math.random() - 0.5) * 4);
const FIELD_RSSI = { B2K: -61, K2B: -60, K2H: -84, B2H: -104, H2K: -83 };

/** Field pond: buoy + bank controller. */
class FieldSim {
  constructor({ speed, ingest, emit }) {
    this.key = 'field'; this.ids = [FM.IDS.buoy, FM.IDS.bank]; this.ingest = ingest; this.emit = emit; this.snapN = 0;
    const S = FM.newState(); S.speed = speed;
    S.hooks = {
      tx: (route, text, ok) => {
        this.emit({ type: 'radio', id: 'field', route, raw: text, ok, simT: S.t });
        if (ok && (route === 'K2H' || route === 'B2H')) this.ingest(text, { source: 'simulator', rssi: FIELD_RSSI[route] + noise(), snr: 6, via: route === 'K2H' ? FM.IDS.bank : null, farmT: S.t });
      },
      event: (msg, cls) => this.emit({ type: 'event', id: 'field', msg, cls: cls || 'ev', simT: S.t }),
      sms: () => {}, sample: () => {},          // alerts come from the gateway rules, as with real hardware
    };
    this.S = S; this.scenario = 'normal';
    FM.loadScenario(S, 'normal');
  }
  get t() { return this.S.t; }
  advance(realS) { if (this.S.running) FM.advance(this.S, realS * this.S.speed); }
  snapshot() {
    const S = this.S; this.snapN += 1;
    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
    return {
      t: S.t, speed: S.speed, running: S.running, scenario: this.scenario, env: S.env, faults: S.faults, w: S.w, light: S.light, sun: S.sun, cfg: S.cfg,
      aerRunning: S.aerRunning, hub: S.hub,
      buoy: pick(S.buoy, ['state', 'stateUntil', 'nextWake', 'seq', 'mAh', 'cap', 'hist', 'lastDO', 'codes', 'flt', 'noAck', 'interval', 'why', 'last', 'lastAER', 'lastAERI', 'rssi']),
      bank: pick(S.bank, ['mode', 'relay', 'lastChange', 'current', 'lastRx', 'lastDO', 'doInvalid', 'codes', 'reason', 'hold', 'onAt', 'resp']),
      ...(this.snapN % 20 === 1 ? { hist: S.hist } : { histTail: S.hist.slice(-3) }),
    };
  }
  command(set, n) {
    const S = this.S, K = S.bank, ID = FM.IDS.bank;
    if (S.faults.hubDown) return null;                                    // the gateway itself is down
    if (S.faults.bankDown) { this.emit({ type: 'radio', id: 'field', route: 'H2K', raw: `AM1,ID=A10D55,T=CMD,N=${n},DST=${ID},RTY=3`, ok: false }); return []; }
    if (set.AER !== undefined) {
      const m = String(set.AER).toUpperCase(); if (!['ON', 'OFF', 'AUTO'].includes(m)) return [`AM1,ID=${ID},T=ACK,N=${n},OK=0,ERR=VALUE`];
      K.mode = m; FM.bankDecide(S);
      return [`AM1,ID=${ID},T=ACK,N=${n},OK=1,MODE=${m},AER=${K.relay ? 1 : 0}${K.hold ? ',HOLD=1' : ''}`];
    }
    if (set.LO !== undefined || set.HI !== undefined) {
      const lo = Number(set.LO ?? S.cfg.lo), hi = Number(set.HI ?? S.cfg.hi);
      if (!(lo >= 2 && hi <= 9 && hi - lo >= 0.5)) return [`AM1,ID=${ID},T=ACK,N=${n},OK=0,ERR=RANGE`];
      S.cfg.lo = lo; S.cfg.hi = hi;
      return [`AM1,ID=${ID},T=ACK,N=${n},OK=1,LO=${lo.toFixed(1)},HI=${hi.toFixed(1)}`];
    }
    if (set.CAL !== undefined) { S.buoy.pending = { cmd: 'CAL?', n }; return [`AM1,ID=${ID},T=ACK,N=${n},OK=1,QUEUED=${FM.IDS.buoy}`]; }
    return [`AM1,ID=${ID},T=ACK,N=${n},OK=0,ERR=UNKNOWN`];
  }
  scenarioSet(key) { if (!FM.SCENARIOS[key]) return false; FM.loadScenario(this.S, key); this.scenario = key; return true; }
  fault(key, on) { if (!(key in FM.FAULTS_DEFAULT)) return false; this.S.faults[key] = !!on; if (key === 'buoyDead' && !on) this.S.buoy.nextWake = this.S.t + 5; this.S.hooks.event(`${key}: ${on ? 'injected' : 'cleared'}`, on ? 'bad' : 'ok'); return true; }
  env(v) {
    let ok = false;
    for (const k of ['cloud', 'algae', 'biomass', 'sal', 'rain']) if (typeof v[k] === 'number' && Number.isFinite(v[k])) { this.S.env[k] = v[k]; ok = true; }
    if (typeof v.soc === 'number' && v.soc >= 0 && v.soc <= 1) { this.S.buoy.mAh = v.soc * this.S.buoy.cap; ok = true; }
    return ok;
  }
  hour(h) { if (!(h >= 0 && h < 24)) return false; const S = this.S, d = Math.floor(S.t / 86400); S.t = d * 86400 + h * 3600; S.buoy.nextWake = S.t + 5; S.bank.lastRx = S.t; S.nextHist = S.t; S.hist = []; return true; }
  speedSet(x) { if (!(x >= 1 && x <= 3600)) return false; this.S.speed = x; return true; }
  run(on) { this.S.running = !!on; return true; }
  state() { const S = this.S; return { dev: 'field', ids: this.ids, scenario: this.scenario, clock: FM.fmtClock(S.t).s, t: S.t, speed: S.speed, running: S.running, mode: S.bank.mode, aerator: S.bank.relay, faults: Object.keys(S.faults).filter((k) => S.faults[k]), scenarios: Object.fromEntries(Object.entries(FM.SCENARIOS).map(([k, v]) => [k, v.name])) }; }
}

/** Prototype tank: one board. */
class TankSim {
  constructor({ speed, ingest, emit }) {
    this.key = 'tank'; this.ids = [TM.NODE_ID]; this.ingest = ingest; this.emit = emit;
    const S = TM.newState(); S.id = TM.NODE_ID; S.speed = speed; S.demo = true;
    S.hooks = {
      tx: (route, text, ok, why) => {
        if (route !== 'N2H') return;
        if (ok) this.ingest(text, { source: 'simulator', rssi: -78 + noise(), snr: 7.5, why, farmT: S.t });
        else this.emit({ type: 'lost', id: 'tank', raw: text, why, simT: S.t });
      },
      event: (msg, cls) => this.emit({ type: 'event', id: 'tank', msg, cls: cls || 'ev', simT: S.t }),
      alert: () => {},
    };
    this.S = S; this.scenario = 'normal';
    TM.loadScenario(S, 'normal');
  }
  get t() { return this.S.t; }
  advance(realS) { if (this.S.running) TM.advance(this.S, realS * this.S.speed); }
  snapshot() {
    const S = this.S, n = S.n;
    return {
      t: S.t, speed: S.speed, running: S.running, demo: S.demo, scenario: this.scenario, env: S.env, faults: S.faults, w: S.w, pumpRunning: S.pumpRunning, hub: S.hub,
      n: { mode: n.mode, pumpOn: n.pumpOn, lastChange: n.lastChange, onAt: n.onAt, pumpMa: n.pumpMa, supplyV: n.supplyV, R: n.R, faultMask: n.faultMask, haveSample: n.haveSample,
        doInvalid: n.doInvalid, lastGoodDO: n.lastGoodDO, nextSample: n.nextSample, decision: n.decision, holdText: n.holdText, seq: n.seq, muteUntil: n.muteUntil, lo: n.lo, hi: n.hi, cmdN: n.cmdN, resp: n.resp },
    };
  }
  command(set) {
    const S = this.S; if (S.faults.hubDown) return null;
    const fields = {}; for (const [k, v] of Object.entries(set)) fields[k] = num(v);
    S.n.cmdN += 1;
    const lines = [TM.handleCommand(S, fields)];
    if (fields.CAL !== undefined) lines.push(`AM1,ID=${TM.NODE_ID},T=CAL,N=${S.n.seq},DOCAL=3,DOZERO=1,DOVSAT=1600.0,PHCAL=3,PHSLOPE=-177.3,PH7V=1500.0,SAL=${S.env.sal.toFixed(1)},DUE=11,CALOK=1`);
    if (fields.STATUS !== undefined) TM.sendPond(S, 'status');
    return lines;
  }
  scenarioSet(key) { if (!TM.SCENARIOS[key]) return false; TM.loadScenario(this.S, key); this.scenario = key; return true; }
  fault(key, on) {
    if (!(key in TM.FAULTS0)) return false; const S = this.S; S.faults[key] = !!on;
    if (key === 'phFoul' && !on) { S.n.faultMask &= ~TM.bit(5); S.n.hist = []; }
    S.hooks.event(`${key}: ${on ? 'injected' : 'cleared'}`, on ? 'bad' : 'ok'); return true;
  }
  env(v) { let ok = false; for (const k of Object.keys(TM.ENV0)) if (typeof v[k] === 'number' && Number.isFinite(v[k])) { this.S.env[k] = v[k]; ok = true; } return ok; }
  hour(h) {
    if (!(h >= 0 && h < 24)) return false; const S = this.S, d = Math.floor(S.t / 86400); S.t = d * 86400 + h * 3600;
    S.n.nextSample = Math.min(S.n.nextSample, S.t + 2); S.n.lastChange = Math.min(S.n.lastChange, S.t); S.n.onAt = Math.min(S.n.onAt, S.t); return true;
  }
  speedSet(x) { if (!(x >= 0.5 && x <= 600)) return false; this.S.speed = x; return true; }
  run(on) { this.S.running = !!on; return true; }
  timers(demo) { TM.setDemo(this.S, !!demo); return true; }
  button(press) { if (press === 'long') TM.pressLong(this.S); else TM.pressShort(this.S); return true; }
  state() { const S = this.S; return { dev: 'tank', ids: this.ids, scenario: this.scenario, clock: TM.clock(S.t).join(':'), t: S.t, speed: S.speed, running: S.running, demo: S.demo, mode: S.n.mode, aerator: S.n.pumpOn, faults: Object.keys(S.faults).filter((k) => S.faults[k]), scenarios: Object.fromEntries(Object.entries(TM.SCENARIOS).map(([k, v]) => [k, v.name])) }; }
}

export function startSimulator({ devices = ['field', 'tank'], fieldSpeed = 60, tankSpeed = 5, ingest, emit = () => {}, tickMs = 250, snapshotMs = 500 }) {
  const sims = {};
  if (devices.includes('field')) sims.field = new FieldSim({ speed: fieldSpeed, ingest, emit });
  if (devices.includes('tank')) sims.tank = new TankSim({ speed: tankSpeed, ingest, emit });
  const list = Object.values(sims);
  const owner = new Map(); for (const s of list) for (const id of s.ids) owner.set(id, s);

  let last = Date.now();
  const tick = setInterval(() => { const now = Date.now(); const dt = Math.min(1, (now - last) / 1000); last = now; for (const s of list) s.advance(dt); }, tickMs);
  const snap = setInterval(() => { for (const s of list) emit({ type: 'twin', id: s.key, snap: s.snapshot() }); }, snapshotMs);
  tick.unref?.(); snap.unref?.();

  return {
    sims, devices: Object.keys(sims),
    /** farm-clock seconds of the device that owns this ID, or null */
    clockOf(id) { const s = owner.get(String(id).toUpperCase()); return s ? s.t : null; },
    owns(id) { return owner.has(String(id).toUpperCase()); },
    get(dev) { return sims[dev] || null; },
    state() { return { devices: Object.fromEntries(list.map((s) => [s.key, s.state()])) }; },
    /** hub -> device command; returns ACK lines ([] = sent but no answer), or null if the gateway is down / ID unknown */
    command(dst, set, n) { const s = owner.get(String(dst).toUpperCase()); return s ? s.command(set, n) : null; },
    stop() { clearInterval(tick); clearInterval(snap); },
  };
}
