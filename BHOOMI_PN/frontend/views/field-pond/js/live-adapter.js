/*
 * FIELD POND view: Live mode and the link to the app shell.
 *
 * Live, backend simulator: the backend runs shared/model/field-model.cjs and streams its state ("twin"
 *   messages, id "field") plus every radio packet ("radio"), so the 3D pond, buoy, bank and aerator
 *   mirror it exactly. Scenario, fault, slider, speed and command controls act on the backend.
 * Live, real hardware: each T=POND packet from the buoy (relayed by the bank) is written into the twin.
 * In the app shell (?embed=1): packets heard by the gateway are reported to the shell in Simulation,
 *   and one-tap commands from the phone arrive here.
 */
(function () {
  'use strict';
  const BUOY = IDS.buoy, BANK = IDS.bank, DEV = 'field';
  let lastSnapAt = 0, simInfo = null;
  const simOn = () => !!simInfo;
  const istNow = () => Date.now() / 1000 + 5.5 * 3600;
  const post = (path, body) => BhoomiLive.post(path, Object.assign({ dev: DEV }, body || {}))
    .then((r) => { if (r && r.error) hooks.event('Backend: ' + r.error, 'bad'); return r; })
    .catch(() => hooks.event('Backend not reachable', 'bad'));

  // ---------------------------------------------------------------- shell link
  if (BhoomiBridge.embedded) {
    const origToast = toast;
    window.toast = function (text, st) { if (st !== 'sent' && st !== 'queued') origToast(text, st); };   // the phone shows farmer alerts
  }
  const origTx = hooks.tx;
  hooks.tx = (route, text, ok) => {
    origTx(route, text, ok);
    if (!LIVE.on && (route === 'K2H' || route === 'B2H')) BhoomiBridge.post('pkt', { route, raw: text, ok, t: S.t, rssi: RSSI[route], via: route === 'K2H' ? BANK : null });
  };
  setInterval(() => BhoomiBridge.post('clock', { t: S.t, live: LIVE.on }), 1000);
  BhoomiBridge.on('cmd', (m) => {
    const set = m.set || {};
    if (set.AER) { const b = document.querySelector(`[data-cmd="${set.AER}"]`); if (b) b.click(); }
  });
  BhoomiBridge.on('scenario', (m) => runScenario(m.key));
  BhoomiBridge.on('cam', (m) => goCam(m.k));

  // ---------------------------------------------------------------- incoming
  function applySnap(sn) {
    lastSnapAt = Date.now();
    const jumped = sn.t < S.t - 5 || sn.t > S.t + 6 * 3600;
    for (const k of ['t', 'speed', 'running', 'env', 'faults', 'w', 'light', 'sun', 'cfg', 'aerRunning', 'hub']) if (sn[k] !== undefined) S[k] = sn[k];
    Object.assign(S.buoy, sn.buoy); Object.assign(S.bank, sn.bank);
    if (sn.hist) S.hist = sn.hist;
    else if (sn.histTail) { for (const p of sn.histTail) if (!S.hist.length || p.t > S.hist[S.hist.length - 1].t) S.hist.push(p); }
    if (jumped && !sn.hist) S.hist = [];
    if (sn.scenario && sn.scenario !== curScn) { curScn = sn.scenario; markScn(); syncInputs(); }
    else if (!document.activeElement || document.activeElement.type !== 'range') syncInputs();
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.s === S.speed));
    $('play').textContent = S.running ? 'Pause' : 'Play';
    for (const k in S.faults) { const c = $('f_' + k); if (c && document.activeElement !== c) c.checked = !!S.faults[k]; }
  }

  /** Real hardware: only the packet is known. */
  function applyPacket(f) {
    const B = S.buoy, K = S.bank, flt = f.FLT || 0;
    // keep the view's day counter; only the time of day follows India time
    const tod = istNow() % 86400, day = Math.floor(S.t / 86400);
    S.t = day * 86400 + tod + (tod < (S.t % 86400) - 43200 ? 86400 : 0);
    const r = { DO: f.DO ?? 0, DOS: f.DOS ?? 0, PH: f.PH ?? 7, WT: f.WT ?? 28, BV: f.BV ?? 3.8, raw: flt === 1 ? 0 : 5 };
    B.last = r; B.seq += 1; B.flt = flt; B.codes = flt && flt < 20 ? [flt] : [];
    if (typeof f.DO === 'number' && !(flt >= 1 && flt <= 3)) { B.lastDO = f.DO; K.lastDO = f.DO; S.w.DO = f.DO; }
    if (typeof f.PH === 'number') S.w.pH = f.PH;
    if (typeof f.WT === 'number' && f.WT > -50) { S.w.T = f.WT; S.w.sat = doSat(f.WT, S.env.sal); }
    if (typeof f.BV === 'number') B.mAh = Math.max(0, Math.min(1, (f.BV - 3.30) / 0.90)) * B.cap;
    K.relay = f.AER === 1; K.current = f.AERI ?? 0; S.aerRunning = K.relay && K.current > 0.5;
    K.codes = flt >= 10 ? [flt] : []; K.lastRx = S.t; K.doInvalid = flt >= 1 && flt <= 3;
    K.reason = 'Decided on the bank controller (from packet)'; K.hold = '';
    S.hub.rx += 1;
    if (!S.hist.length || S.t - S.hist[S.hist.length - 1].t > 60) S.hist.push({ t: S.t, DO: S.w.DO, sat: S.w.sat, pH: S.w.pH, T: S.w.T, aer: S.aerRunning ? 1 : (K.relay ? 2 : 0) });
  }

  BhoomiLive.start({
    mountBefore: '#demoBtn',
    onModeChange(live) {
      LIVE.on = live;
      hooks.event(live ? 'Live: the pond now mirrors the backend' : 'Back to simulation: the twin runs its own copy of the buoy and bank firmware', 'ok');
    },
    onHello(msg) {
      simInfo = msg.sim || null;
      if (!simInfo) { const n = (msg.nodes || []).find((x) => x.id === BUOY); if (n) applyPacket(n.fields); }
    },
    onPacket(rec) {
      const fromField = rec.id === BUOY || rec.id === BANK;
      if (!fromField) return;
      if (Date.now() - lastSnapAt > 3000) {             // real hardware: no simulator radio messages
        if (rec.type === 'POND') applyPacket(rec.fields);
        origTx(rec.rx && rec.rx.via ? 'K2H' : 'B2H', rec.raw, true);
      }
      if (rec.type === 'ACK' && rec.fields.MODE) { S.bank.mode = rec.fields.MODE; hooks.event(`ACK from bank: mode ${rec.fields.MODE}${rec.fields.HOLD ? ' (waiting for a minimum ON/OFF time)' : ''}`, 'ok'); }
    },
    onSim(state) { simInfo = state; },
    onMessage(msg) {
      if (msg.type === 'twin' && msg.id === DEV) applySnap(msg.snap);
      else if (msg.type === 'radio' && msg.id === DEV) origTx(msg.route, msg.raw, msg.ok);
      else if (msg.type === 'event' && msg.id === DEV) hooks.event(msg.msg, msg.cls);
      else if (msg.type === 'cmd' && msg.record.fields.DST === BANK) origTx('H2K', msg.record.raw, true);
      else if (msg.type === 'notify' && msg.alert && msg.alert.pond === 'pond1') toast(msg.alert.text.en, 'sent');
    },
  });

  // ---------------------------------------------------------------- outgoing: controls act on the backend in Live
  const orig = { runScenario, setSpeed, sendCmd };
  window.runScenario = function (k) {
    if (!LIVE.on) { orig.runScenario(k); BhoomiBridge.post('reset', { t: S.t }); return; }
    if (!simOn()) return hooks.event('Scenarios need the backend simulator (SIM=1)', 'bad');
    curScn = k; markScn(); post('/api/sim/scenario', { key: k });
  };
  window.setSpeed = function (v) { orig.setSpeed(v); if (LIVE.on && simOn()) post('/api/sim/speed', { x: v }); };
  window.sendCmd = function (fields, label, onAck) {
    if (!LIVE.on) return orig.sendCmd(fields, label, onAck);
    const set = {};
    for (const kv of String(fields).split(',')) { const i = kv.indexOf('='); if (i > 0 && kv.slice(0, i) !== 'FWD') set[kv.slice(0, i)] = kv.slice(i + 1); }
    BhoomiLive.post('/api/command', { dst: BANK, set }).then((r) => {
      if (r.error) return hooks.event('Command refused: ' + r.error, 'bad');
      if (!r.sentTo.length) hooks.event(`${label}: no hub link (MQTT / serial) and no simulated controller`, 'bad');
      else if (r.sentTo.includes('simulator') && !r.ack) hooks.event(`${label}: no ACK (hub offline or controller unreachable)`, 'bad');
    }).catch(() => hooks.event('Backend not reachable', 'bad'));
  };

  document.addEventListener('click', (e) => {
    if (!LIVE.on || !simOn()) return;
    if (e.target.closest('#play')) { e.stopPropagation(); post('/api/sim/run', { on: !S.running }); }
  }, true);
  document.addEventListener('change', (e) => {
    if (!LIVE.on) return;
    const c = e.target.closest('#faults input'); if (!c) return;
    e.stopPropagation();
    if (!simOn()) { c.checked = !c.checked; return hooks.event('Fault injection needs the backend simulator', 'bad'); }
    post('/api/sim/fault', { fault: c.dataset.f, on: c.checked });
  }, true);
  const SLIDERS = { sCloud: 'cloud', sAlgae: 'algae', sBio: 'biomass', sSal: 'sal', sRain: 'rain', sSoc: 'soc' };
  let envTimer = null, envBody = {};
  let resetT = null;
  document.addEventListener('input', (e) => {
    if (!LIVE.on && e.target.id === 'sHour') { clearTimeout(resetT); resetT = setTimeout(() => BhoomiBridge.post('reset', { t: S.t }), 300); }
    if (!LIVE.on || !simOn()) return;
    const id = e.target.id;
    if (SLIDERS[id]) { e.stopPropagation(); envBody[SLIDERS[id]] = +e.target.value; clearTimeout(envTimer); envTimer = setTimeout(() => { post('/api/sim/env', envBody); envBody = {}; }, 250); }
    else if (id === 'sHour') { e.stopPropagation(); clearTimeout(envTimer); envTimer = setTimeout(() => post('/api/sim/hour', { h: +e.target.value }), 250); }
  }, true);
})();
