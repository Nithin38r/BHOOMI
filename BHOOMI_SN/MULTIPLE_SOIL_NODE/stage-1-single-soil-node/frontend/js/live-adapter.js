/*
 * BHOOMI · Stage 1 · live adapter
 * In Live mode the twin stops its own simulation and shows real SOIL packets from the backend:
 * the 3D soil colour, readings, hub alerts, packet log and battery all follow the real node.
 * Pick a node with ?node=7C9E1A, otherwise the first SOIL node heard is used.
 */
(function () {
  'use strict';
  const T = window.__twin;
  if (!T || !window.BhoomiLive) return;
  const { S, node, hub } = T;
  const want = (new URLSearchParams(location.search).get('node') || '').toUpperCase();
  let nodeId = want || null, clockTimer = null, usesSimClock = false;
  const playBtn = document.querySelector('#playBtn');

  const nan = (v) => (v === null || v === undefined ? NaN : Number(v));
  // battery voltage -> state of charge, inverse of the twin's 18650 curve
  const CURVE = [[0, 3.0], [0.05, 3.28], [0.1, 3.42], [0.2, 3.6], [0.5, 3.76], [0.8, 3.97], [1, 4.18]];
  function socFromV(v) {
    if (!(v > 0)) return null;
    for (let i = 1; i < CURVE.length; i++) if (v <= CURVE[i][1]) { const a = CURVE[i - 1], b = CURVE[i]; return a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]); }
    return 1;
  }
  // keep the twin clock on the packet's (simulated) time, or on the real clock for real hardware
  function setClock(minuteOfDay) {
    const cur = ((S.t % 1440) + 1440) % 1440;
    let base = Math.floor(S.t / 1440) * 1440;
    if (minuteOfDay < cur - 600) base += 1440;           // passed midnight
    S.t = base + minuteOfDay;
  }
  const realMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };

  function apply(rec, quiet) {
    if (rec.type !== 'SOIL') return;
    if (!nodeId) nodeId = rec.id;
    if (rec.id !== nodeId) return;
    const f = rec.fields || {};
    const r = { m1: nan(f.M1), m2: nan(f.M2), st: nan(f.ST), at: nan(f.AT), ah: nan(f.AH), lw: nan(f.LW), lx: nan(f.LX), bv: nan(f.BV) };
    usesSimClock = typeof rec.rx?.simMinute === 'number';
    setClock(usesSimClock ? rec.rx.simMinute % 1440 : realMinute());

    // node / firmware state
    node.id = rec.id; node.seq = rec.n ?? node.seq; node.off = false; node.critical = false;
    node.lastPkt = rec.raw; node.lastFields = r;
    node.nextWake = S.t + (r.bv < 3.40 ? 60 : 15);
    node.wakes.push({ t: S.t, res: 'ok' }); if (node.wakes.length > 400) node.wakes.shift();
    const hdr = document.querySelector('#hdrId'); if (hdr) hdr.textContent = rec.id;

    // what the hub knows (drives cards, sparklines and alerts)
    const prev = hub.last;
    if (prev) { const dh = Math.max(0, (S.t - prev.t) / 60); hub.lwHours = r.lw > 50 ? hub.lwHours + dh : 0; }
    hub.last = Object.assign({ t: S.t, n: rec.n, rssi: rec.rx?.rssi ?? -96, snr: rec.rx?.snr ?? 7, tries: 1 }, r);
    hub.lastRx = S.t;
    hub.hist.push(Object.assign({ t: S.t }, r)); if (hub.hist.length > 200) hub.hist.shift();

    // physical state, so the 3D soil, sky and battery match the real readings
    if (!isNaN(r.m1)) S.soil.m1 = r.m1;
    if (!isNaN(r.m2)) S.soil.m2 = r.m2;
    if (!isNaN(r.st)) S.soil.st = r.st;
    if (!isNaN(r.lw)) S.soil.lw = r.lw;
    if (!isNaN(r.at)) S.env.air = r.at;
    if (!isNaN(r.ah)) S.env.rh = r.ah;
    if (!isNaN(r.lx)) S.env.irr = r.lx / 100;
    const soc = socFromV(r.bv); if (soc !== null) S.bat.soc = soc * 2600;

    if (!quiet) {
      T.addLog('ok', 'LIVE', '#' + rec.n + ' · ' + (rec.rx?.rssi != null ? 'RSSI ' + rec.rx.rssi + ' dBm · ' : '') + 'via ' + (rec.rx?.source || 'backend'));
      T.anim.start({ kind: 'ok', tries: 1 });
    }
    T.uiDirty.all = true; T.uiDirty.log = true;
  }

  BhoomiLive.start({
    mountBefore: '#demoBtn',
    onModeChange(live) {
      if (live) {
        S.playing = false;
        if (playBtn) { playBtn.textContent = '▶'; playBtn.disabled = true; playBtn.title = 'Paused: showing live data'; }
        hub.hist.length = 0; hub.last = null; node.wakes.length = 0;
        T.addLog('info', 'LIVE ON', 'Showing real packets from the BHOOMI backend');
        clockTimer = setInterval(() => { if (!usesSimClock) { setClock(realMinute()); T.uiDirty.all = true; } }, 10000);
        T.toast('Live data on');
      } else {
        clearInterval(clockTimer);
        S.playing = true;
        if (playBtn) { playBtn.textContent = '❚❚'; playBtn.disabled = false; playBtn.title = ''; }
        T.addLog('info', 'SIMULATION', 'Back to the built-in simulation');
        T.toast('Simulation on');
      }
      T.uiDirty.all = true;
    },
    onHello(msg) {
      // replay recent packets so charts are filled at once, then show the newest
      const soil = (msg.recent || []).filter((r) => r.type === 'SOIL' && (!nodeId || r.id === nodeId));
      if (!nodeId && soil.length) nodeId = (soil.find((r) => r.id === '7C9E1A') || soil[soil.length - 1]).id;   // demo node N1 first
      soil.filter((r) => r.id === nodeId).slice(-48).forEach((r, i, a) => apply(r, i < a.length - 1));
    },
    onPacket(rec) { apply(rec, false); },
  });
})();
