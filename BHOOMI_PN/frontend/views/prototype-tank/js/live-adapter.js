/*
 * PROTOTYPE TANK view: Live mode and the link to the app shell.
 *
 * Live mode, backend simulator: the backend runs the same firmware model (shared/model/pond-model.cjs)
 *   and pushes a state snapshot twice a second ("twin" messages). The 3D bench, OLED, panels and chart
 *   mirror that state. Scenario, fault, slider, timer, speed and lid-button controls are sent to the
 *   backend, and hub commands go out as real AM1 CMD packets through POST /api/command.
 * Live mode, real hardware: no snapshots arrive, so each POND packet's values are written into the
 *   twin (DO, pH, temperature, aerator, current, supply, fault code) and the clock follows India time.
 */
(function () {
  'use strict';
  if (!window.BhoomiLive) return;
  const qs = new URLSearchParams(location.search);
  const want = (qs.get('node') || '').toUpperCase();          // ?node=XXXXXX picks a board; otherwise the first pond node that is not the field buoy
  const FIELD = ['7C9E2A', '3B41F0'];
  let lastSnapAt = 0, simInfo = null;

  const pickId = (id) => { if (!LIVE.id && (want ? id === want : !FIELD.includes(id))) LIVE.id = id; return LIVE.id === id; };
  const post = (path, body) => BhoomiLive.post(path, Object.assign({ dev: 'tank' }, body || {}))
    .then((r) => { if (r && r.error) hooks.event('Backend: ' + r.error, 'bad'); return r; })
    .catch(() => hooks.event('Backend not reachable', 'bad'));
  const simOn = () => !!simInfo;
  const istNow = () => { const d = new Date(Date.now() + 5.5 * 3600e3); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + Math.floor(Date.now() / 86400e3) * 86400; };

  // ---------------------------------------------------------------- shell link (?embed=1)
  if (BhoomiBridge.embedded) {
    const origToast = toast;
    window.toast = function (text, st) { if (st !== 'sent') origToast(text, st); };   // the phone shows farmer alerts
  }
  const origTx = hooks.tx;
  hooks.tx = (route, text, ok, why) => {
    origTx(route, text, ok, why);
    if (!LIVE.on && route === 'N2H') BhoomiBridge.post('pkt', { route, raw: text, ok, t: S.t, rssi: -78 });
  };
  setInterval(() => BhoomiBridge.post('clock', { t: S.t, live: LIVE.on }), 1000);
  BhoomiBridge.on('cmd', (m) => hubCmd(m.set || {}, Object.entries(m.set || {}).map(([k, v]) => k + '=' + v).join(',')));
  BhoomiBridge.on('scenario', (m) => runScenario(m.key));
  BhoomiBridge.on('cam', (m) => goCam(m.k));

  // ---------------------------------------------------------------- incoming
  function chartPoint() {
    if (S.t < S.nextChart) return;
    S.nextChart = S.t + (S.demo ? 2 : 60);
    S.chart.push({ t: S.t, DO: S.w.DO, sat: S.w.sat, pH: S.w.pH, pump: S.n.pumpOn ? (S.pumpRunning ? 1 : 2) : 0 });
    const win = S.demo ? 600 : 86400; while (S.chart.length && S.t - S.chart[0].t > win) S.chart.shift();
  }

  function applySnap(sn) {
    lastSnapAt = Date.now();
    const jumped = sn.t < S.t - 5 || sn.t > S.t + 4000 || sn.demo !== S.demo;
    S.t = sn.t; S.running = sn.running; S.demo = sn.demo;
    S.env = sn.env; S.faults = sn.faults; S.w = sn.w; S.pumpRunning = sn.pumpRunning; S.hub = sn.hub;
    Object.assign(S.n, sn.n);
    if (jumped) { S.chart = []; S.nextChart = S.t; markTimers(); }
    chartPoint();
    if (sn.speed !== S.speed) markSpeed(sn.speed);
    if (sn.scenario && sn.scenario !== curScn) { curScn = sn.scenario; markScn(); syncInputs(); }
    else if (!document.activeElement || document.activeElement.type !== 'range') syncInputs();
    $('play').textContent = S.running ? 'Pause' : 'Play';
  }

  /** Real hardware: only the packet is known. */
  function applyPacket(f) {
    const n = S.n, flt = f.FLT || 0;
    S.t = istNow();
    if (typeof f.DO === 'number') { n.R.doMgL = f.DO; S.w.DO = f.DO; }
    if (typeof f.DOS === 'number') n.R.doSat = f.DOS;
    if (typeof f.PH === 'number') { n.R.ph = f.PH; S.w.pH = f.PH; }
    if (typeof f.WT === 'number') { n.R.wtOk = f.WT > -5; n.R.wt = f.WT; if (n.R.wtOk) { S.w.T = f.WT; S.w.sat = doSat(f.WT, S.env.sal); } }
    if (typeof f.AER === 'number') n.pumpOn = f.AER === 1;
    if (typeof f.AERI === 'number') n.pumpMa = f.AERI * 1000;
    if (typeof f.BV === 'number') n.supplyV = f.BV;
    S.pumpRunning = n.pumpOn && n.pumpMa > 50;
    n.faultMask = flt ? bit(flt) : 0; n.doInvalid = flt >= 1 && flt <= 3; n.haveSample = true;
    n.decision = 'Decided on the node (packet ' + (n.seq + 1) + ')'; n.holdText = ''; n.seq += 1; n.nextSample = S.t + T_(S).sampleDay;
    S.hub.rx += 1;
    chartPoint();
  }

  function logPacket(rec, kind) {
    const fromNode = kind !== 'cmd';
    const r = rec.rx && rec.rx.rssi != null ? rec.rx.rssi + ' dBm' : '';
    const why = rec.rx && rec.rx.why ? ' · ' + rec.rx.why : '';
    logLine(`<span class="tm">${tm()}</span> <span class="rt">${fromNode ? 'node→hub' : 'hub→node'}</span> <span class="tm">${esc(r + why)} · backend</span>\n${esc(rec.raw)}`);
    launch(fromNode, true, fromNode ? C.amber : C.accent);
    if (fromNode) txFlash = performance.now();
  }

  BhoomiLive.start({
    mountBefore: '#demoBtn',
    onModeChange(live) {
      LIVE.on = live;
      if (live) {
        S.chart = []; S.nextChart = 0;
        hooks.event('Live: the twin now mirrors the backend' + (LIVE.id ? ' (node ' + LIVE.id + ')' : ''), 'ok');
      } else {
        hooks.event('Back to simulation: the twin runs its own copy of the firmware model', 'ok');
      }
    },
    onHello(msg) {
      simInfo = msg.sim || null;
      const pond = (msg.nodes || []).filter((n) => n.type === 'POND');
      pond.forEach((n) => pickId(n.id));
      (msg.recent || []).filter((r) => r.id === LIVE.id || (r.fields && r.fields.DST === LIVE.id)).slice(-8)
        .forEach((r) => logLine(`<span class="tm">earlier</span> <span class="rt">${r.type === 'CMD' ? 'hub→node' : 'node→hub'}</span>\n${esc(r.raw)}`));
      if (!simInfo) { const last = pond.find((n) => n.id === LIVE.id); if (last) applyPacket(last.fields); }
    },
    onPacket(rec) {
      if (rec.type === 'POND') { if (!pickId(rec.id)) return; if (Date.now() - lastSnapAt > 3000) applyPacket(rec.fields); logPacket(rec, 'up'); return; }
      if ((rec.type === 'ACK' || rec.type === 'CAL') && rec.id === LIVE.id) {
        logPacket(rec, 'up');
        if (rec.type === 'ACK') hooks.event(`ACK from ${rec.id}: OK=${rec.fields.OK} MODE=${rec.fields.MODE} AER=${rec.fields.AER}${rec.fields.HOLD ? ' (waiting for minimum ON/OFF time)' : ''}`, rec.fields.OK ? 'ok' : 'bad');
        if (rec.type === 'ACK' && Date.now() - lastSnapAt > 3000 && rec.fields.MODE) S.n.mode = rec.fields.MODE;
      }
    },
    onSim(state) { simInfo = state; },
    onMessage(msg) {
      if (msg.type === 'twin' && msg.id === 'tank') applySnap(msg.snap);
      else if (msg.type === 'cmd' && msg.record.fields.DST === LIVE.id) logPacket(msg.record, 'cmd');
      else if (msg.type === 'event' && msg.id === 'tank') hooks.event(msg.msg, msg.cls);
      else if (msg.type === 'lost' && msg.id === 'tank') { logLine(`<span class="tm">${tm()}</span> <span class="rt">node→hub</span> <span class="bad">lost (hub offline)</span>\n${esc(msg.raw)}`); launch(true, false, C.amber); }
      else if (msg.type === 'notify' && msg.alert && msg.alert.pond === 'tank') toast(msg.alert.text.en, 'sent');
    },
  });

  // real hardware: the clock follows India time between packets
  setInterval(() => { if (LIVE.on && Date.now() - lastSnapAt > 3000) S.t = istNow(); }, 1000);

  // ---------------------------------------------------------------- outgoing: controls go to the backend in Live
  const orig = { runScenario, setSpeed, setDemo, pressShort, pressLong, hubCmd };
  function markSpeed(v) { orig.setSpeed(v); }

  window.runScenario = function (k) {
    if (!LIVE.on) { orig.runScenario(k); BhoomiBridge.post('reset', { t: S.t }); return; }
    if (!simOn()) return hooks.event('Scenarios need the backend simulator (SIM=1). Real node: change the water instead.', 'bad');
    curScn = k; markScn(); post('/api/sim/scenario', { key: k });
  };
  window.setSpeed = function (v) { orig.setSpeed(v); if (LIVE.on && simOn()) post('/api/sim/speed', { x: v }); };
  window.setDemo = function (St, on) { if (!LIVE.on) return orig.setDemo(St, on); if (simOn()) { St.demo = on; post('/api/sim/timers', { demo: on }); } else hubCmd({ DEMO: on ? 1 : 0 }, 'DEMO=' + (on ? 1 : 0)); };
  window.pressShort = function (St) { if (!LIVE.on) return orig.pressShort(St); if (simOn()) post('/api/sim/button', { press: 'short' }); else hooks.event('The lid button is on the real node: press it there', 'bad'); };
  window.pressLong = function (St) { if (!LIVE.on) return orig.pressLong(St); if (simOn()) post('/api/sim/button', { press: 'long' }); else hooks.event('The lid button is on the real node: press it there', 'bad'); };
  window.hubCmd = function (fields, label) {
    if (!LIVE.on) return orig.hubCmd(fields, label);
    if (!LIVE.id) return hooks.event('No pond node heard yet', 'bad');
    const set = {}; for (const k in fields) set[k] = typeof fields[k] === 'number' ? fields[k].toFixed(1).replace(/\.0$/, k === 'LO' || k === 'HI' ? '.0' : '') : fields[k];
    BhoomiLive.post('/api/command', { dst: LIVE.id, set }).then((r) => {
      if (r.error) return hooks.event('Command refused: ' + r.error, 'bad');
      if (!r.sentTo.length) hooks.event(`Command ${label} queued: no hub link (MQTT / serial) and no simulated node`, 'bad');
      else if (r.sentTo.includes('simulator') && !r.ack) hooks.event('Hub offline: command not delivered. Use the button on the lid.', 'bad');
    }).catch(() => hooks.event('Backend not reachable', 'bad'));
  };

  // inline handlers in twin.js (play, faults, sliders, hour): catch them first while Live
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
  const SLIDERS = { sDem: 'demand', sAmb: 'amb', sSal: 'sal', sSup: 'supply' };
  let envTimer = null, envBody = {};
  let resetT = null;
  document.addEventListener('input', (e) => {
    if (!LIVE.on && e.target.id === 'sHour') { clearTimeout(resetT); resetT = setTimeout(() => BhoomiBridge.post('reset', { t: S.t }), 300); }
    if (!LIVE.on || !simOn()) return;
    const id = e.target.id;
    if (SLIDERS[id]) { envBody[SLIDERS[id]] = +e.target.value; clearTimeout(envTimer); envTimer = setTimeout(() => { post('/api/sim/env', envBody); envBody = {}; }, 250); }
    else if (id === 'sHour') { e.stopPropagation(); $('oHour').textContent = clock(Math.floor(S.t / 86400) * 86400 + +e.target.value * 3600).slice(0, 2).join(':'); clearTimeout(envTimer); envTimer = setTimeout(() => post('/api/sim/hour', { h: +e.target.value }), 250); }
  }, true);
})();
