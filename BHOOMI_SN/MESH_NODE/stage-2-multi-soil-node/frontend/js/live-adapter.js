/*
 * BHOOMI · Stage 2 · live adapter
 * In Live mode the field twin stops its own simulation and is driven by SOIL packets from the backend:
 *   - each packet updates its node (moisture, soil temp, wetness, battery) and repaints the soil map
 *   - the packet flies along the mesh route the backend reports (rx.path), e.g. N3 → N2 → N1 → Hub
 *   - a node that stops reporting is marked failed, so the twin's mesh re-routes around it
 *   - weather buttons, "Node working" and "Mesh relaying" control the backend simulator (POST /api/sim/...)
 * Unknown node IDs (real hardware) take the next free slot on the field.
 */
(function () {
  'use strict';
  const T = window.__twin;
  if (!T || !window.BhoomiLive) return;
  const { S, HUB } = T;
  const $ = (s) => document.querySelector(s);
  const seen = new Set();                       // node ids heard while Live
  let silentTimer = null, clockTimer = null, usesSimClock = false;
  const BACKEND_WEATHER = { normal: 'normal', monsoon: 'monsoon', cyclone: 'cyclone', heatwave: 'heatwave', drought: 'drought', fog: 'fog' };

  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const realMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };

  function setClock(minuteOfDay) {
    const cur = ((S.min % 1440) + 1440) % 1440;
    let base = Math.floor(S.min / 1440) * 1440;
    if (minuteOfDay < cur - 600) base += 1440;
    S.min = base + minuteOfDay;
    const hour = (S.min / 60) % 24;
    const solar = Math.max(0, Math.sin(Math.PI * (hour - 6) / 12)) * 1000 * (1 - 0.8 * (S.env.cloud || 0) / 100);
    S.live = Object.assign({}, S.live, { hour, solar, night: solar < 5, raining: (S.env.rain || 0) > 0.2 });
  }

  function nodeFor(id) {
    let n = T.nodes.find((x) => x.id === id);
    if (n) return n;
    if (T.nodes.length >= T.SLOTS.length) return null;
    // add slots in order until the backend's ID appears, or give the new slot this ID (real hardware)
    while (T.nodes.length < T.SLOTS.length) {
      T.addNode(false);
      n = T.nodes[T.nodes.length - 1];
      if (n.id === id) return n;
      if (!T.IDS.includes(id)) { n.id = id; T.buildNodeList(); return n; }
    }
    return T.nodes.find((x) => x.id === id) || null;
  }

  function apply(rec, quiet) {
    if (rec.type !== 'SOIL') return;
    const n = nodeFor(rec.id); if (!n) return;
    seen.add(n.id);
    const f = rec.fields || {};
    usesSimClock = typeof rec.rx?.simMinute === 'number';
    setClock(usesSimClock ? rec.rx.simMinute % 1440 : realMinute());
    if (!n.on) T.setNodeOn(n, true);

    const v = { m1: num(f.M1), m2: num(f.M2), st: num(f.ST), at: num(f.AT), ah: num(f.AH), bv: num(f.BV), lw: num(f.LW), lx: num(f.LX), ec: n.ec, ph: n.ph, ni: n.ni, pi: n.pi, ki: n.ki };
    if (v.m1 !== null) n.m1 = v.m1;
    if (v.m2 !== null) n.m2 = v.m2;
    if (v.st !== null) n.st = v.st;
    if (v.lw !== null) n.lw = v.lw;
    if (v.bv !== null) n.mAh = clamp((v.bv - 3.30) / 0.90 * 2600, 0, 2600);
    // sensors the backend reports as NA show as NA in the twin too
    n.MODE.m1 = v.m1 === null ? 'off' : 'auto'; n.MODE.st = v.st === null ? 'off' : 'auto';
    n.MODE.at = v.at === null ? 'off' : 'auto'; n.MODE.ah = v.ah === null ? 'off' : 'auto';
    if (v.at !== null) S.live.airT = S.live.airT * 0.7 + v.at * 0.3;
    if (v.ah !== null) S.live.airH = S.live.airH * 0.7 + v.ah * 0.3;
    n.seq = rec.n ?? n.seq;
    n.last = v; n.lastT = S.min; n.rssi = rec.rx?.rssi ?? n.rssi;
    n.hist.push({ t: S.min, m1: v.m1, m2: v.m2, b: n.mAh / 26 });
    while (n.hist.length && n.hist[0].t < S.min - 1440) n.hist.shift();

    // route reported by the backend (ids), mapped onto the twin's node objects
    const path = rec.rx?.path;
    if (Array.isArray(path)) {
      const route = path.map((id) => (id === 'HUB' ? HUB : T.nodes.find((x) => x.id === id))).filter(Boolean);
      if (route.length === path.length) n.route = route;
    }
    const hops = rec.rx?.hop ?? f.HOP ?? 0;
    if (!quiet) {
      if (n.route) T.launchPacket(n, -1);
      T.addLog({ kind: 'ok', head: n.route ? n.route.map((p) => p.label).join(' → ') : n.label + ' → Hub', str: rec.raw,
        note: `live · ${hops + 1} hop${hops ? 's' : ''}${rec.rx?.rssi != null ? ' · ' + rec.rx.rssi + ' dBm' : ''}` });
    }
    T.dirty();
  }

  // a node that has stopped reporting is shown as failed, so the mesh re-routes around it
  function checkSilent() {
    for (const n of T.nodes) {
      if (!seen.has(n.id) || !n.on) continue;
      if (S.min - n.lastT > 2 * T.txInterval(n) + 5) T.setNodeOn(n, false);
    }
  }

  function applySim(st) {
    if (!st) return;
    for (const s of st.nodes || []) {
      const n = T.nodes.find((x) => x.id === s.id);
      if (n && n.on !== s.on) T.setNodeOn(n, s.on);
    }
    if (typeof st.mesh === 'boolean' && st.mesh !== S.mesh) { S.mesh = st.mesh; const m = $('#mesh'); if (m) m.checked = st.mesh; T.computeRoutes(); }
    const w = st.weatherInfo;
    if (w) {
      S.env = Object.assign({}, S.env, { rain: w.rain, cloud: Math.round(w.cloud * 100), hum: w.rh, temp: w.mean, swing: w.amp });
      document.querySelectorAll('#scen button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === st.weather)));
    }
    T.dirty();
  }

  // ---- in Live, the twin's own controls drive the backend simulator instead of the local model
  document.addEventListener('click', (e) => {
    if (!BhoomiLive.live) return;
    const b = e.target.closest('#scen button'); if (!b) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const preset = BACKEND_WEATHER[b.dataset.id];
    if (!preset) { T.addLog({ kind: 'event', str: `"${b.textContent.trim()}" runs only in Simulation. Backend presets: ${Object.keys(BACKEND_WEATHER).join(', ')}.` }); return; }
    BhoomiLive.post('/api/sim/weather', { preset }).then(applySim).catch(() => T.addLog({ kind: 'event', str: 'Backend simulator not available (real hardware mode)' }));
  }, true);
  document.addEventListener('change', (e) => {
    if (!BhoomiLive.live) return;
    if (e.target.id === 'ncOn') {
      e.stopImmediatePropagation();
      const n = T.nodes[S.sel]; if (!n) return;
      BhoomiLive.post('/api/sim/nodes/' + n.id, { on: e.target.checked }).then(applySim).catch(() => {});
    }
    if (e.target.id === 'mesh') BhoomiLive.post('/api/sim/mesh', { on: e.target.checked }).then(applySim).catch(() => {});
  }, true);

  BhoomiLive.start({
    mountBefore: '#tourBtn',
    onModeChange(live) {
      const segBtns = document.querySelectorAll('.seg button');
      if (live) {
        T.setSpeed(0); segBtns.forEach((b) => { b.disabled = true; b.title = 'Paused: showing live data'; });
        seen.clear();
        T.addLog({ kind: 'event', str: 'LIVE: the field now shows real packets from the BHOOMI backend' });
        silentTimer = setInterval(checkSilent, 3000);
        clockTimer = setInterval(() => { if (!usesSimClock) { setClock(realMinute()); T.dirty(); } }, 10000);
        BhoomiLive.api('/api/sim').then((st) => { if (st && st.nodes) applySim(st); }).catch(() => {});
      } else {
        clearInterval(silentTimer); clearInterval(clockTimer);
        segBtns.forEach((b) => { b.disabled = false; b.title = ''; });
        T.setSpeed(1);
        T.addLog({ kind: 'event', str: 'SIMULATION: back to the built-in field model' });
      }
      T.dirty();
    },
    onHello(msg) { (msg.recent || []).forEach((r) => apply(r, true)); },
    onPacket(rec) { apply(rec, false); },
    onSim: applySim,
  });
})();
