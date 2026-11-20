/*
 * BHOOMI · Stage 3 · live adapter (mesh hub)
 * In Live mode the farm twin stops its own models and shows what the hub receives:
 *   SOIL packets  -> soil nodes, soil map, routes (same as stage 2)
 *   PUMP / TANK / TREAT / POND packets -> pump, storage tank and valves, treatment tank, pond water
 *   T=ACK packets -> confirmation of a command the farmer sent
 * and every control that would act on the farm sends a real command through the backend:
 *   pump START/STOP  -> POST /api/command {dst:"P1A2B3", set:{RUN:1|0}}
 *   zone valves      -> POST /api/command {dst:"T4C5D6", set:{VLV:"101"}}
 *   aerator          -> POST /api/command {dst:"D0A1B2", set:{AER:"ON"|"OFF"|"AUTO"}}
 *   crop, automatic irrigation, pond events, pump faults, weather, node failure, mesh -> /api/sim/... (simulator)
 */
(function () {
  'use strict';
  const T = window.__twin;
  if (!T || !window.BhoomiLive) return;
  const { S, HUB, DEV, W, TT, PD } = T;
  const $ = (s) => document.querySelector(s);
  const seen = new Set();
  let silentTimer = null, clockTimer = null, usesSimClock = false;
  const BACKEND_WEATHER = { normal: 'normal', monsoon: 'monsoon', cyclone: 'cyclone', heatwave: 'heatwave', drought: 'drought', fog: 'fog' };
  const STAGE = { IDLE: 'idle', FILLING: 'fill', DOSING: 'dose', READY: 'ready' };
  const devById = () => Object.fromEntries(Object.values(DEV).map((d) => [d.id, d]));

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
  function routeOf(rec) {
    const path = rec.rx?.path; if (!Array.isArray(path)) return null;
    const byId = devById();
    const r = path.map((id) => (id === 'HUB' ? HUB : T.nodes.find((x) => x.id === id) || byId[id])).filter(Boolean);
    return r.length === path.length ? r : null;
  }
  function logPacket(src, rec, label) {
    const hops = rec.rx?.hop ?? 0;
    if (src.route) T.launchPacket(src, -1);
    T.addLog({ kind: 'ok', head: src.route ? src.route.map((p) => p.label).join(' → ') : label + ' → Hub', str: rec.raw,
      note: `live · ${hops + 1} hop${hops ? 's' : ''}${rec.rx?.rssi != null ? ' · ' + rec.rx.rssi + ' dBm' : ''}` });
  }

  // ---------------------------------------------------------------- soil nodes (as stage 2)
  function nodeFor(id) {
    let n = T.nodes.find((x) => x.id === id);
    if (n) return n;
    while (T.nodes.length < T.SLOTS.length) {
      T.addNode(false); n = T.nodes[T.nodes.length - 1];
      if (n.id === id) return n;
      if (!T.IDS.includes(id)) { n.id = id; T.buildNodeList(); return n; }
    }
    return null;
  }
  function applySoil(rec, quiet) {
    const n = nodeFor(rec.id); if (!n) return;
    seen.add(n.id);
    const f = rec.fields || {};
    if (!n.on) T.setNodeOn(n, true);
    const v = { m1: num(f.M1), m2: num(f.M2), st: num(f.ST), at: num(f.AT), ah: num(f.AH), bv: num(f.BV), lw: num(f.LW), lx: num(f.LX), ec: n.ec, ph: n.ph, ni: n.ni, pi: n.pi, ki: n.ki };
    if (v.m1 !== null) n.m1 = v.m1; if (v.m2 !== null) n.m2 = v.m2; if (v.st !== null) n.st = v.st; if (v.lw !== null) n.lw = v.lw;
    if (v.bv !== null) n.mAh = clamp((v.bv - 3.30) / 0.90 * 2600, 0, 2600);
    n.MODE.m1 = v.m1 === null ? 'off' : 'auto'; n.MODE.st = v.st === null ? 'off' : 'auto';
    n.MODE.at = v.at === null ? 'off' : 'auto'; n.MODE.ah = v.ah === null ? 'off' : 'auto';
    if (v.at !== null) S.live.airT = S.live.airT * 0.7 + v.at * 0.3;
    if (v.ah !== null) S.live.airH = S.live.airH * 0.7 + v.ah * 0.3;
    n.seq = rec.n ?? n.seq; n.last = v; n.lastT = S.min; n.rssi = rec.rx?.rssi ?? n.rssi;
    n.hist.push({ t: S.min, m1: v.m1, m2: v.m2, b: n.mAh / 26 });
    while (n.hist.length && n.hist[0].t < S.min - 1440) n.hist.shift();
    const r = routeOf(rec); if (r) n.route = r;
    if (!quiet) logPacket(n, rec, n.label);
  }

  // ---------------------------------------------------------------- farm devices
  function applyDevice(rec, quiet) {
    const d = devById()[rec.id]; if (!d) return false;
    const f = rec.fields || {};
    if (rec.type === 'PUMP') {
      W.pumpOn = Number(f.RUN) === 1; W.current = num(f.I) ?? 0; W.phaseFault = f.PHASE === 'FAIL'; W.runMin = num(f.RT) ?? 0; W.flowIn = num(f.Q) ?? 0;
      W.tripReason = Number(f.TRIP) === 1 ? (W.phaseFault ? 'phase missing' : 'dry run') : '';
    } else if (rec.type === 'TANK') {
      if (f.LV != null) W.tankL = f.LV / 100 * W.cap;
      W.flowOut = num(f.Q) ?? 0; W.pressure = num(f.P) ?? 0; if (f.LIT != null) W.litres = f.LIT;
      if (typeof f.VLV === 'string' || typeof f.VLV === 'number') {
        const bits = String(f.VLV).padStart(3, '0').split('').map((c) => c === '1');
        const open = bits.filter(Boolean).length;
        bits.forEach((on, z) => {
          if (on && !W.valves[z]) { W.sess[z] = { start: S.min, litres: 0, m1: Object.fromEntries(T.nodes.map((n) => [n.i, n.m1])) }; }
          if (!on) W.sess[z] = null;
          W.valves[z] = on; W.zoneFlow[z] = on && open ? W.flowOut / open : 0; W.deliver[z] = on && W.flowOut > 0 ? 1 : 0;
          if (on && W.sess[z]) W.sess[z].litres += W.zoneFlow[z] * 15;
        });
      }
    } else if (rec.type === 'TREAT') {
      if (f.LV != null) TT.vol = f.LV / 100 * TT.cap;
      if (f.PH != null) TT.ph = f.PH; if (f.EC != null) TT.ec = f.EC;
      if (f.STAGE) TT.stage = STAGE[f.STAGE] || String(f.STAGE).toLowerCase();
      if (f.DOSE != null) TT.doseTotal = f.DOSE;
    } else if (rec.type === 'POND') {
      const q = { ph: num(f.PH), ec: num(f.EC), tu: num(f.TU), t: num(f.WT), do: num(f.DO), lvl: num(f.LV) };
      if (q.ph !== null) PD.ph = q.ph; if (q.ec !== null) PD.ec = q.ec; if (q.tu !== null) PD.tu = q.tu;
      if (q.t !== null) PD.t = q.t; if (q.do !== null) PD.do = q.do; if (q.lvl !== null) PD.lvl = q.lvl;
      PD.aer = Number(f.AER) === 1; PD.drift = false;
      d.lastQ = q;
    } else return false;
    d.seq = rec.n ?? d.seq; d.last = true; d.lastT = S.min; d.rssi = rec.rx?.rssi ?? d.rssi;
    const r = routeOf(rec); if (r) d.route = r;
    if (!quiet) logPacket(d, rec, d.label);
    return true;
  }

  function apply(rec, quiet) {
    usesSimClock = typeof rec.rx?.simMinute === 'number';
    if (rec.type === 'ACK') {
      const d = devById()[rec.id];
      if (!quiet) T.addLog({ kind: 'gw', str: `${d ? d.label : rec.id} confirmed the command over LoRa: ${rec.raw}` });
      return;
    }
    setClock(usesSimClock ? rec.rx.simMinute % 1440 : realMinute());
    if (rec.type === 'SOIL') applySoil(rec, quiet);
    else applyDevice(rec, quiet);
    T.dirty();
  }

  function checkSilent() {
    for (const n of T.nodes) if (seen.has(n.id) && n.on && S.min - n.lastT > 2 * T.txInterval(n) + 5) T.setNodeOn(n, false);
  }
  function applySim(st) {
    if (!st) return;
    for (const s of st.nodes || []) { const n = T.nodes.find((x) => x.id === s.id); if (n && n.on !== s.on) T.setNodeOn(n, s.on); }
    if (typeof st.mesh === 'boolean' && st.mesh !== S.mesh) { S.mesh = st.mesh; const m = $('#mesh'); if (m) m.checked = st.mesh; T.computeRoutes(); }
    const w = st.weatherInfo;
    if (w) {
      S.env = Object.assign({}, S.env, { rain: w.rain, cloud: Math.round(w.cloud * 100), hum: w.rh, temp: w.mean, swing: w.amp });
      document.querySelectorAll('#scen button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === st.weather)));
    }
    if (st.farm) {
      if (st.farm.crop && st.farm.crop !== S.crop && T.CROPS[st.farm.crop]) T.setCrop(st.farm.crop);
      S.autoPump = !!st.farm.auto; const a = $('#eAuto'); if (a) a.checked = S.autoPump;
      PD.auto = st.farm.pond?.aerMode === 'AUTO'; const aa = $('#aerAuto'); if (aa) aa.checked = PD.auto;
      W.phaseFault = !!st.farm.pump?.phaseFail; W.dryWell = !!st.farm.pump?.dryWell; T.syncFaultUI();
    }
    T.dirty();
  }

  // ---------------------------------------------------------------- in Live, the twin's controls act on the farm
  const cmd = (dst, set, devKey) => {
    BhoomiLive.post('/api/command', { dst, set }).then((r) => {
      T.addLog({ kind: 'gw', str: `Farmer → ${dst}: ${Object.entries(set).map(([k, v]) => k + '=' + v).join(',')} · sent via ${(r.sentTo || []).join(' + ') || 'nobody (no hub connected)'}${r.ack ? (r.ack.OK ? '' : ' · refused: ' + r.ack.ERR) : ''}` });
      if (devKey && DEV[devKey]) T.launchCmd(DEV[devKey]);
    }).catch(() => T.addLog({ kind: 'gw', str: 'Command failed: backend not reachable' }));
  };
  const sim = (path, body) => BhoomiLive.post(path, body).then(applySim).catch(() => T.addLog({ kind: 'event', str: 'Backend simulator not available (real hardware mode)' }));

  document.addEventListener('click', (e) => {
    if (!BhoomiLive.live) return;
    const t = e.target;
    const stop = () => { e.stopImmediatePropagation(); e.preventDefault(); };
    if (t.closest('#pumpOn')) { stop(); cmd(DEV.pump.id, { RUN: 1 }, 'pump'); return; }
    if (t.closest('#pumpOff')) { stop(); cmd(DEV.pump.id, { RUN: 0 }, 'pump'); return; }
    const vb = t.closest('#valveBtns button');
    if (vb) { stop(); const z = Number(vb.id.slice(2)); const bits = W.valves.map((v, i) => (i === z ? !v : v)); cmd(DEV.tank.id, { VLV: bits.map((b) => (b ? 1 : 0)).join('') }, 'tank'); return; }
    if (t.closest('#aerOn')) { stop(); cmd(DEV.pond.id, { AER: 'ON' }, 'pond'); return; }
    if (t.closest('#aerOff')) { stop(); cmd(DEV.pond.id, { AER: 'OFF' }, 'pond'); return; }
    const ev = t.closest('#pondEvt button'); if (ev) { sim('/api/sim/pond', { event: ev.dataset.ev }); return; }   // local highlight still runs
    const cb = t.closest('#cropBtns button'); if (cb) { sim('/api/sim/crop', { crop: cb.dataset.crop }); return; }
    const sb = t.closest('#scen button');
    if (sb) {
      stop();
      const preset = BACKEND_WEATHER[sb.dataset.id];
      if (!preset) { T.addLog({ kind: 'event', str: `"${sb.textContent.trim()}" runs only in Simulation. Backend presets: ${Object.keys(BACKEND_WEATHER).join(', ')}.` }); return; }
      sim('/api/sim/weather', { preset });
    }
  }, true);
  document.addEventListener('change', (e) => {
    if (!BhoomiLive.live) return;
    const id = e.target.id;
    if (id === 'ncOn') { e.stopImmediatePropagation(); const n = T.nodes[S.sel]; if (n) sim('/api/sim/nodes/' + n.id, { on: e.target.checked }); }
    if (id === 'mesh') sim('/api/sim/mesh', { on: e.target.checked });
    if (id === 'eAuto') sim('/api/sim/auto', { on: e.target.checked });
    if (id === 'aerAuto' && e.target.checked) { e.stopImmediatePropagation(); cmd(DEV.pond.id, { AER: 'AUTO' }, 'pond'); }
    if (id === 'fPhase' || id === 'fDry') { e.stopImmediatePropagation(); const ph = $('#fPhase').checked, dr = $('#fDry').checked; sim('/api/sim/pump', { fault: ph ? 'phase' : dr ? 'dryrun' : 'none' }); }
  }, true);

  BhoomiLive.start({
    mountBefore: '#tourBtn',
    onModeChange(live) {
      const segBtns = document.querySelectorAll('.seg button');
      if (live) {
        T.setSpeed(0); segBtns.forEach((b) => { b.disabled = true; b.title = 'Paused: showing live data'; });
        seen.clear();
        T.addLog({ kind: 'event', str: 'LIVE: the farm now shows real packets from the BHOOMI hub, and controls send real commands' });
        silentTimer = setInterval(checkSilent, 3000);
        clockTimer = setInterval(() => { if (!usesSimClock) { setClock(realMinute()); T.dirty(); } }, 10000);
        BhoomiLive.api('/api/sim').then((st) => { if (st && st.nodes) applySim(st); }).catch(() => {});
      } else {
        clearInterval(silentTimer); clearInterval(clockTimer);
        segBtns.forEach((b) => { b.disabled = false; b.title = ''; });
        T.setSpeed(1);
        T.addLog({ kind: 'event', str: 'SIMULATION: back to the built-in farm model' });
      }
      T.dirty();
    },
    onHello(msg) { (msg.recent || []).forEach((r) => apply(r, true)); },
    onPacket(rec) { apply(rec, false); },
    onSim: applySim,
  });
})();
