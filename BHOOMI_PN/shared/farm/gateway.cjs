/*
 * Layer 2 of the AgriMesh framework: the EDGE GATEWAY at the farmhouse.
 * Same code in the backend (Live) and in the browser (Simulation).
 *
 *   - device registry: every packet carries an ID and a type, so a new device joins on its own
 *   - pond rules: fault codes, DO critical, aerator off while DO is low, silent device, aerator log
 *   - alerts in English / Telugu / Tamil; SMS straight from the gateway for critical alerts,
 *     and for every warning when the internet is down (SMS fallback)
 *   - offline buffer: with the internet down, readings and alerts wait in an outbox and are
 *     flushed to the cloud when the link comes back. The aerator never waits: it is decided on the pond.
 *
 * Time "t" is farm-clock seconds: hour of day = (t / 3600) % 24. Simulators pass their own clock;
 * real devices use India time (see farmNow()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n.cjs'));
  else root.BhoomiGateway = factory(root.BhoomiI18n);
})(typeof self !== 'undefined' ? self : this, function (I18N) {
  'use strict';

  const GATEWAY_ID = 'A10D55';
  const KNOWN = {
    '7C9E2A': { role: 'Pond buoy', name: 'Pond 1 · floating buoy', pond: 'pond1', kind: 'buoy' },
    '3B41F0': { role: 'Aerator controller', name: 'Pond 1 · bank controller', pond: 'pond1', kind: 'bank' },
    '5D20C7': { role: 'Prototype pond node', name: 'Test tank · prototype node', pond: 'tank', kind: 'tank' },
    'A10D55': { role: 'Edge gateway', name: 'Farmhouse gateway', pond: null, kind: 'gateway' },
  };
  const FAULT_TEXT = {
    1: 'DO probe: no signal', 2: 'DO reading implausible', 3: 'DO reading stuck', 4: 'pH out of range / probe unplugged',
    5: 'pH not responding (fouled)', 6: 'Temperature sensor failed', 7: 'Battery / supply low',
    10: 'Aerator ON but no motor current', 11: 'Aerator ON but DO still falling', 20: 'Buoy silent > 35 min (bank failsafe)',
    21: 'Bank controller not answering',
  };
  const DO_CRITICAL = 3;

  /** India farm clock for real devices: seconds, with hour-of-day in IST. */
  function farmNow(ms) { return (ms === undefined ? Date.now() : ms) / 1000 + 5.5 * 3600; }
  function hhmm(t) { const h = ((t / 3600) % 24 + 24) % 24; const H = Math.floor(h), M = Math.floor((h - H) * 60); return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0'); }
  function isNight(t) { const h = ((t / 3600) % 24 + 24) % 24; return h >= 18 || h < 7; }

  function faultAlert(flt) {
    if (flt === 10) return ['FLT_PUMP', 'crit'];
    if (flt === 11) return ['FLT_WEAK', 'crit'];
    if (flt === 21) return ['FLT_BANK', 'crit'];
    if (flt === 20) return ['FLT_BUOY', 'warn'];
    if (flt === 7) return ['FLT_POWER', 'warn'];
    return ['FLT_SENSOR', 'warn'];
  }

  function createGateway(opts) {
    const o = Object.assign({ silentAfterS: 35 * 60, lang: 'te' }, opts || {});
    const devices = new Map();      // id -> registry entry
    const ponds = new Map();        // pond key -> state
    const alerts = [];              // newest last
    const smsLog = [];
    const outbox = [];              // waiting for the cloud link
    const seen = new Map();         // dedupe: key -> t
    let online = true, seq = 0, packets = 0, smsCount = 0, lang = o.lang;

    function pondOf(dev) {
      if (!dev.pond) return null;
      let p = ponds.get(dev.pond);
      if (!p) {
        p = { key: dev.pond, name: I18N.pondName(dev.pond, 'en'), last: null, t: null, flt: 0, lowDo: false, offCount: 0,
          manualOff: false, mode: 'AUTO', lo: 4.0, hi: 6.0, aer: null, aerLog: [], devices: [] };
        ponds.set(dev.pond, p);
      }
      if (!p.devices.includes(dev.id)) p.devices.push(dev.id);
      return p;
    }

    function register(id, type, t, rx) {
      let d = devices.get(id), fresh = false;
      if (!d) {
        const k = KNOWN[id] || { role: type === 'POND' ? 'Pond node' : type + ' device', name: 'New device ' + id, pond: type === 'POND' ? id.toLowerCase() : null, kind: 'new' };
        d = { id, role: k.role, name: k.name, pond: k.pond, kind: k.kind, types: [], firstT: t, lastT: t, packets: 0, rssi: null, silent: false };
        devices.set(id, d); fresh = true;
      }
      if (type && !d.types.includes(type)) d.types.push(type);
      d.lastT = t; d.packets += 1;
      if (rx && rx.rssi != null) d.rssi = rx.rssi;
      return { d, fresh };
    }

    function raise(t, pond, id, level, code, vars) {
      const a = { n: ++seq, t, time: hhmm(t), pond, id, level, code, vars: vars || {}, text: I18N.textFor(code, pond, vars), channels: [] };
      // channels: push when the cloud is reachable (else it waits in the outbox), SMS for critical alerts
      // and, as the fallback, for every warning while the internet is down
      a.channels.push(online ? 'push' : 'push-queued');
      if (level === 'crit' || (!online && level === 'warn')) {
        a.channels.push('sms'); smsCount += 1;
        smsLog.push({ n: smsCount, alert: a.n, pond, t, time: a.time, code, level, text: a.text[lang] || a.text.en, lang });
        if (smsLog.length > 50) smsLog.shift();
      }
      alerts.push(a); if (alerts.length > 100) alerts.shift();
      return a;
    }

    function deliverOrQueue(items) {
      if (online) return items;
      for (const it of items) { outbox.push(it); if (outbox.length > 5000) outbox.shift(); }
      return [];
    }

    /**
     * One packet heard by the gateway. rec = parsed AM1 {id,type,n,fields,raw} + optional rx {rssi,via}.
     * Returns { duplicate, alerts, deliver } — deliver = items for the cloud right now ([] when offline).
     */
    function process(rec, t, rx) {
      const key = rec.id + ':' + rec.n + ':' + rec.type + (rec.fields && rec.fields.U ? ':u' : '');
      if (rec.n !== null && seen.has(key) && Math.abs(t - seen.get(key)) < 1800) return { duplicate: true, alerts: [], deliver: [] };
      if (rec.n !== null) { seen.set(key, t); if (seen.size > 3000) for (const k of [...seen.keys()].slice(0, 500)) seen.delete(k); }
      packets += 1;
      const out = [];
      const { d, fresh } = register(rec.id, rec.type, t, rx && rx.via ? null : rx);   // a relayed packet's RSSI is the relay's link
      if (rx && rx.via && rx.via !== rec.id) { const v = register(rx.via, 'RELAY', t, rx); pondOf(v.d); if (v.fresh && v.d.kind === 'new') out.push(raise(t, v.d.pond, v.d.id, 'info', 'NEWDEV', { id: v.d.id, type: 'RELAY' })); }
      if (fresh && d.kind === 'new') out.push(raise(t, d.pond, d.id, 'info', 'NEWDEV', { id: d.id, type: rec.type }));
      if (d.silent) { d.silent = false; out.push(raise(t, d.pond, d.id, 'ok', 'CLEAR', {})); }

      const p = pondOf(d);
      const f = rec.fields || {};
      if (p && rec.type === 'ACK' && f.OK === 1) {
        if (typeof f.LO === 'number') p.lo = f.LO;
        if (typeof f.HI === 'number') p.hi = f.HI;
        if (typeof f.MODE === 'string') {
          p.mode = f.MODE;
          // the node switches first and confirms after, so a start or stop logged just before this ACK was this command
          const e = p.aerLog[p.aerLog.length - 1];
          if (e && t - e.t <= 120 && e.mode === 'AUTO') { e.mode = f.MODE; e.manual = true; }
        }
      }
      if (p && rec.type === 'POND') {
        p.last = f; p.t = t;
        const flt = typeof f.FLT === 'number' ? f.FLT : 0;
        const doValid = typeof f.DO === 'number' && !(flt >= 1 && flt <= 3);
        if (flt && flt !== p.flt) { const [code, level] = faultAlert(flt); out.push(raise(t, p.key, rec.id, level, code, { flt, do: f.DO, night: isNight(t) && f.AER === 1 })); }
        if (!flt && p.flt) out.push(raise(t, p.key, rec.id, 'ok', 'CLEAR', { flt: p.flt }));
        p.flt = flt;
        if (doValid && f.DO < DO_CRITICAL && !p.lowDo) { p.lowDo = true; out.push(raise(t, p.key, rec.id, 'crit', 'DOLOW', { do: f.DO })); }
        if (doValid && f.DO > DO_CRITICAL + 0.5) p.lowDo = false;
        // DO low and aerator off with no fault, twice in a row (a single packet can sit inside a minimum OFF time)
        if (doValid && f.DO < 4 && f.AER === 0 && !flt) p.offCount += 1; else p.offCount = 0;
        if (p.offCount === 2) out.push(raise(t, p.key, rec.id, 'warn', 'AEROFF', { do: f.DO }));
        // aerator log
        if (typeof f.AER === 'number') {
          if (p.aer !== null && f.AER !== p.aer) {
            p.aerLog.push({ t, time: hhmm(t), on: f.AER === 1, do: doValid ? f.DO : null, mode: p.mode, current: f.AERI ?? null });
            if (p.aerLog.length > 50) p.aerLog.shift();
            // an automatic start / stop is one the AUTO rule would make: DO at or past the threshold.
            // (A fault-driven failsafe start is covered by its fault alert; a manual command by its ACK.)
            if (p.mode === 'AUTO' && f.AER === 1 && !flt && doValid && f.DO <= p.lo + 0.05) out.push(raise(t, p.key, rec.id, 'info', 'AERON', { do: f.DO }));
            if (p.mode === 'AUTO' && f.AER === 0 && doValid && f.DO >= p.hi - 0.05) out.push(raise(t, p.key, rec.id, 'info', 'AERSTOP', { do: f.DO }));
          }
          p.aer = f.AER;
        }
      }
      const items = [{ kind: 'packet', rec: Object.assign({}, rec, { pond: p ? p.key : null, t }) }].concat(out.map((a) => ({ kind: 'alert', alert: a })));
      return { duplicate: false, alerts: out, deliver: deliverOrQueue(items) };
    }

    /** Silence check. tFor(id) gives the current farm time for a device (its simulator clock, or farmNow()). */
    function check(tFor) {
      const out = [];
      for (const d of devices.values()) {
        if (!['buoy', 'tank', 'new'].includes(d.kind) || !d.types.includes('POND') || d.silent) continue;
        const t = tFor(d.id);
        if (t - d.lastT > o.silentAfterS) { d.silent = true; out.push(raise(t, d.pond, d.id, 'warn', 'SILENT', { min: Math.round(o.silentAfterS / 60) })); }
      }
      return { alerts: out, deliver: deliverOrQueue(out.map((a) => ({ kind: 'alert', alert: a }))) };
    }

    /** Internet (gateway <-> cloud) up or down. Going up returns the buffered items to flush, oldest first. */
    function setOnline(on) {
      online = !!on;
      if (!online) return [];
      const items = outbox.splice(0, outbox.length);
      for (const it of items) if (it.kind === 'alert') it.alert.channels = it.alert.channels.map((c) => (c === 'push-queued' ? 'push-late' : c));
      return items;
    }

    function pondLevel(p, d) {
      const f = p.last || {}, flt = p.flt;
      const doValid = typeof f.DO === 'number' && !(flt >= 1 && flt <= 3);
      if ([10, 11, 21].includes(flt) || (doValid && f.DO < DO_CRITICAL)) return 'crit';
      if (flt || (d && d.silent) || (doValid && f.DO < 4)) return 'warn';
      return p.last ? 'ok' : 'none';
    }

    function summary() {
      return {
        id: GATEWAY_ID, online, buffered: outbox.length, packets, sms: smsCount, smsLog: smsLog.slice(-15), lang,
        devices: [...devices.values()].map((d) => Object.assign({}, d)),
        ponds: [...ponds.values()].map((p) => {
          const main = p.devices.map((id) => devices.get(id)).find((d) => d && d.types.includes('POND'));
          return { key: p.key, name: p.name, last: p.last, t: p.t, time: p.t != null ? hhmm(p.t) : null, flt: p.flt, faultText: p.flt ? FAULT_TEXT[p.flt] || 'Fault ' + p.flt : null,
            level: pondLevel(p, main), silent: !!(main && main.silent), mode: p.mode, aer: p.aer, aerLog: p.aerLog.slice(-12), devices: p.devices.slice() };
        }),
        alerts: alerts.slice(-30),
      };
    }

    /** A simulator jumped its clock (scenario / time slider): restart the silence timers of these devices. */
    function resync(ids, t) {
      for (const id of ids) { const d = devices.get(id); if (d) { d.lastT = t; d.silent = false; } }
      for (const p of ponds.values()) if (p.devices.some((id) => ids.includes(id))) { p.flt = 0; p.lowDo = false; p.offCount = 0; p.aer = null; }
    }

    return { process, check, setOnline, summary, resync, setLang(l) { if (I18N.LANGS[l]) lang = l; }, get online() { return online; }, devices, ponds, alerts };
  }

  return { createGateway, KNOWN, FAULT_TEXT, GATEWAY_ID, farmNow, hhmm, isNight };
});
