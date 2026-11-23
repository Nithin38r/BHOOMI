/*
 * BHOOMI Pond Node digital twin · app shell.
 *
 * One page, the four layers of the AgriMesh framework:
 *   Layer 1  field hardware  -> the 3D view (iframe: field pond or prototype tank), running the firmware models
 *   Layer 2  edge gateway    -> registry, rules, alerts, SMS fallback, offline buffer   (shared/farm/gateway.cjs)
 *   Layer 3  cloud           -> history, oxygen forecast, push notifications           (shared/farm/cloud.cjs)
 *   Layer 4  mobile app      -> the phone: readings, alerts in EN / TE / TA, one-tap aerator control
 *
 * Simulation: the gateway and cloud run here in the browser, fed by packets the 3D view's firmware model sends.
 * Live:       the backend runs the same gateway and cloud code; this page shows what it sends over the WebSocket.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AM1 = window.BhoomiAM1, GWM = window.BhoomiGateway, CLM = window.BhoomiCloud, I18N = window.BhoomiI18n;

  const VIEWS = {
    field: { src: 'views/field-pond/index.html', pond: 'pond1', ids: ['7C9E2A', '3B41F0'], dst: '3B41F0', name: 'Field pond' },
    tank: { src: 'views/prototype-tank/index.html', pond: 'tank', ids: ['5D20C7'], dst: '5D20C7', name: 'Prototype tank' },
  };
  const viewOfPond = (key) => Object.keys(VIEWS).find((v) => VIEWS[v].pond === key) || null;

  // phone words (alert sentences themselves come from shared/farm/i18n.cjs)
  const UI = {
    en: { ok: 'Safe', warn: 'Watch', crit: 'Danger', none: 'Waiting', oxygen: 'Oxygen', ph: 'pH', water: 'Water', aerator: 'Aerator', on: 'ON', off: 'OFF',
      forecast: 'Oxygen forecast', alerts: 'Alerts', log: 'Aerator log', noNet: 'No internet. Readings wait at the farm gateway; alerts come by SMS. The aerator still runs by itself.',
      tap: 'One tap: app → cloud → gateway → controller', sent: 'Sent. Waiting for the controller to confirm…', offTap: 'No internet: use the switch on the controller.',
      other: 'Open this pond in the 3D view to reach it in Simulation.', steady: 'Steady', collecting: 'Collecting readings…', nowLow: 'Below 4 mg/L now. Aerator should be running.',
      noAlerts: 'No alerts yet', noLog: 'No starts or stops yet', listen: 'Listen', sms: 'SMS', noVoice: 'No voice for this language on this device' },
    te: { ok: 'సురక్షితం', warn: 'గమనించండి', crit: 'ప్రమాదం', none: 'వేచి ఉంది', oxygen: 'ఆక్సిజన్', ph: 'pH', water: 'నీరు', aerator: 'ఏరేటర్', on: 'ఆన్', off: 'ఆఫ్',
      forecast: 'ఆక్సిజన్ అంచనా', alerts: 'హెచ్చరికలు', log: 'ఏరేటర్ లాగ్', noNet: 'ఇంటర్నెట్ లేదు. రీడింగ్స్ గేట్‌వే వద్ద ఉన్నాయి; హెచ్చరికలు SMS ద్వారా వస్తాయి. ఏరేటర్ దానంతట అదే నడుస్తుంది.',
      tap: 'ఒక్క టచ్: యాప్ → క్లౌడ్ → గేట్‌వే → కంట్రోలర్', sent: 'పంపాం. కంట్రోలర్ నిర్ధారణ కోసం వేచి ఉంది…', offTap: 'ఇంటర్నెట్ లేదు: కంట్రోలర్ దగ్గర స్విచ్ వాడండి.',
      other: 'సిమ్యులేషన్‌లో ఈ చెరువును 3D వ్యూలో తెరవండి.', steady: 'స్థిరంగా ఉంది', collecting: 'రీడింగ్స్ సేకరిస్తోంది…', nowLow: 'ఇప్పుడు 4 mg/L కంటే తక్కువ. ఏరేటర్ నడవాలి.',
      noAlerts: 'ఇంకా హెచ్చరికలు లేవు', noLog: 'ఇంకా ఏమీ లేదు', listen: 'వినండి', sms: 'SMS', noVoice: 'ఈ పరికరంలో ఈ భాష వాయిస్ లేదు' },
    ta: { ok: 'பாதுகாப்பு', warn: 'கவனி', crit: 'ஆபத்து', none: 'காத்திருக்கிறது', oxygen: 'ஆக்சிஜன்', ph: 'pH', water: 'நீர்', aerator: 'ஏரேட்டர்', on: 'ஆன்', off: 'ஆஃப்',
      forecast: 'ஆக்சிஜன் முன்னறிவிப்பு', alerts: 'எச்சரிக்கைகள்', log: 'ஏரேட்டர் பதிவு', noNet: 'இணையம் இல்லை. அளவீடுகள் கேட்வேயில் காத்திருக்கின்றன; எச்சரிக்கைகள் SMS மூலம் வரும். ஏரேட்டர் தானாக இயங்கும்.',
      tap: 'ஒரு தொடுதல்: ஆப் → கிளவுட் → கேட்வே → கட்டுப்பாட்டுப் பெட்டி', sent: 'அனுப்பப்பட்டது. உறுதிப்படுத்தலுக்காகக் காத்திருக்கிறது…', offTap: 'இணையம் இல்லை: கட்டுப்பாட்டுப் பெட்டியின் சுவிட்சைப் பயன்படுத்துங்கள்.',
      other: 'சிமுலேஷனில் இந்தக் குளத்தை 3D காட்சியில் திறக்கவும்.', steady: 'நிலையாக உள்ளது', collecting: 'அளவீடுகள் சேகரிக்கப்படுகின்றன…', nowLow: 'இப்போது 4 mg/L-க்குக் கீழ். ஏரேட்டர் இயங்க வேண்டும்.',
      noAlerts: 'இன்னும் எச்சரிக்கைகள் இல்லை', noLog: 'இன்னும் எதுவும் இல்லை', listen: 'கேளுங்கள்', sms: 'SMS', noVoice: 'இந்தச் சாதனத்தில் இந்த மொழிக் குரல் இல்லை' },
  };

  const st = { devView: {}, view: 'field', live: false, lang: 'en', pond: 'pond1', farm: null, clocks: { field: null, tank: null }, liveHist: {}, note: '', noteUntil: 0, seenPush: 0 };
  const qs = new URLSearchParams(location.search);
  if (qs.get('view') === 'tank') st.view = 'tank';
  if (['en', 'te', 'ta'].includes(qs.get('lang'))) st.lang = qs.get('lang');

  // ------------------------------------------------------------------ Simulation: gateway + cloud in the browser
  let gw = GWM.createGateway({ lang: 'te' }), cloud = CLM.createCloud();
  // farm clock of a device: its simulator's clock (3D view in Simulation, backend snapshot in Live), else India time
  const tFor = (id) => {
    const v = Object.keys(VIEWS).find((k) => VIEWS[k].ids.includes(id));
    if (v) return st.clocks[v] != null ? st.clocks[v] : null;
    if (st.live) return GWM.farmNow();
    const dv = st.devView[id]; return dv && st.clocks[dv] != null ? st.clocks[dv] : null;   // a demo device added in Simulation
  };
  const pondClock = (key) => { const v = viewOfPond(key); return v ? (st.clocks[v] ?? st.clocks[st.view] ?? GWM.farmNow()) : (st.live ? GWM.farmNow() : (st.clocks[st.view] ?? GWM.farmNow())); };

  function simDeliver(items) {
    for (const it of items) {
      cloud.receive(it);
      if (it.kind === 'packet') {
        fly('K23');
        if (it.rec.type === 'POND' && it.rec.pond) { const fc = cloud.checkForecast(it.rec.pond, it.rec.t); if (fc) notified(fc); }
      } else notified(it.alert);
    }
  }
  function simPacket(m) {
    fly('K12', m.ok ? '' : 'lost');
    if (!m.ok) return;                                   // the gateway never heard it
    const pkt = AM1.parseAM1(m.raw); if (!pkt) return;
    const res = gw.process(pkt, m.t, { rssi: m.rssi, via: m.via || null });
    if (!res.duplicate) simDeliver(res.deliver);
    scheduleRender();
  }
  function simReset(view, t) {
    gw.resync(VIEWS[view].ids, t); cloud.clear(VIEWS[view].pond);
  }
  setInterval(() => { if (st.live) return; const r = gw.check((id) => tFor(id) ?? -Infinity); simDeliver(r.deliver); if (r.alerts.length) scheduleRender(); }, 2000);

  // ------------------------------------------------------------------ the 3D view (iframe)
  const iframe = $('view');
  function loadView(v) {
    st.view = v;
    document.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    iframe.src = VIEWS[v].src + '?embed=1' + (st.live ? '&live=1' : '') + (qs.get('backend') ? '&backend=' + encodeURIComponent(qs.get('backend')) : '');
    st.pond = VIEWS[v].pond;
    scheduleRender();
  }
  const toView = (msg) => { try { iframe.contentWindow.postMessage(msg, '*'); } catch (e) { /* not loaded yet */ } };
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { if (b.dataset.view !== st.view) loadView(b.dataset.view); }));

  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow) return;
    const m = e.data; if (!m || typeof m.bhoomi !== 'string') return;
    switch (m.bhoomi) {
      case 'height': iframe.style.height = Math.max(900, Math.ceil(m.h)) + 'px'; break;
      case 'ready': if (st.live) toView({ bhoomi: 'setLive', on: true }); break;
      case 'clock': {
        const prev = st.clocks[m.view];
        if (!st.live && prev != null && (m.t < prev - 5 || m.t > prev + 7200)) simReset(m.view, m.t);
        st.clocks[m.view] = m.t; break;
      }
      case 'reset': if (!st.live) { st.clocks[m.view] = m.t; simReset(m.view, m.t); scheduleRender(); } break;
      case 'pkt': if (!st.live) simPacket(m); break;
      default: break;
    }
  });

  // ------------------------------------------------------------------ Live: the backend's gateway + cloud
  function fetchHist(pond) {
    if (!st.live || !pond) return;
    BhoomiLive.api('/api/ponds/' + pond + '/history?hours=12').then((r) => { st.liveHist[pond] = r.history || []; scheduleRender(); }).catch(() => {});
  }
  if (window.BhoomiLive) {
    BhoomiLive.start({
      mountBefore: '#netBtn',
      onModeChange(live) {
        st.live = live; st.liveHist = {}; st.clocks = { field: null, tank: null };
        toView({ bhoomi: 'setLive', on: live });
        if (live) fetchHist(st.pond);
        $('srcNote').textContent = live ? 'Live: gateway and cloud run in the backend.' : 'Simulation: gateway and cloud run in this browser.';
        scheduleRender();
      },
      onHello(msg) { st.farm = msg.farm; fetchHist(st.pond); scheduleRender(); },
      onPacket(rec) {
        fly('K23');
        if (rec.type === 'POND' && rec.pond && rec.t != null) {
          const h = st.liveHist[rec.pond] || (st.liveHist[rec.pond] = []);
          const f = rec.fields, flt = f.FLT || 0;
          h.push({ t: rec.t, DO: typeof f.DO === 'number' && !(flt >= 1 && flt <= 3) ? f.DO : null, PH: f.PH, WT: f.WT, AER: f.AER });
          if (h.length > 4000) h.shift();
        }
        if (!rec.rx || rec.rx.source !== 'simulator') fly('K12');
      },
      onSim() { st.liveHist = {}; setTimeout(() => fetchHist(st.pond), 400); },
      onMessage(msg) {
        if (msg.type === 'twin') st.clocks[msg.id] = msg.snap.t;
        else if (msg.type === 'farm') { st.farm = msg.farm; scheduleRender(); }
        else if (msg.type === 'notify') notified(msg.alert);
        else if (msg.type === 'radio' && msg.ok && (msg.route === 'K2H' || msg.route === 'B2H')) fly('K12');
        else if (msg.type === 'link') { if (msg.flushed) for (let i = 0; i < Math.min(6, msg.flushed); i++) setTimeout(() => fly('K23'), i * 120); }
      },
    });
  }

  // ------------------------------------------------------------------ layer data, whatever the mode
  function farm() {
    if (st.live) return st.farm || { gateway: { online: true, devices: [], ponds: [], alerts: [], smsLog: [], buffered: 0, sms: 0, packets: 0, lang: 'te' }, cloud: { stored: 0, ponds: {}, pushes: [] } };
    return { gateway: gw.summary(), cloud: cloud.summary(pondClock) };
  }
  function history(pond) { return st.live ? (st.liveHist[pond] || []) : cloud.history(pond); }
  function forecast(f, pond) { return st.live ? ((f.cloud.ponds[pond] || {}).forecast || { risk: 'unknown' }) : cloud.forecast(pond, pondClock(pond)); }

  function notified(alert) { fly('K34', 'alert'); scheduleRender(); if (alert && alert.pond && alert.level !== 'info') flashLayer('L4'); }

  // ------------------------------------------------------------------ actions
  function setOnline(on) {
    if (st.live) { BhoomiLive.post('/api/link', { online: on }).then(scheduleRender).catch(() => {}); return; }
    const flushed = gw.setOnline(on);
    flushed.forEach((it, i) => setTimeout(() => simDeliver([it]), Math.min(i, 20) * 40));
    scheduleRender();
  }
  $('netBtn').addEventListener('click', () => setOnline(!farm().gateway.online));

  function note(text, ms) { st.note = text; st.noteUntil = Date.now() + (ms || 5000); scheduleRender(); }
  function sendAer(mode) {
    const f = farm(), L = UI[st.lang];
    if (!f.gateway.online) return note(L.offTap);
    fly('K34', 'down'); setTimeout(() => fly('K23', 'down'), 250); setTimeout(() => fly('K12', 'down'), 500);
    if (!st.live) {
      if (viewOfPond(st.pond) !== st.view) return note(L.other);
      toView({ bhoomi: 'cmd', set: { AER: mode } }); note(L.sent, 3000); return;
    }
    const p = f.gateway.ponds.find((x) => x.key === st.pond);
    const v = viewOfPond(st.pond);
    const dst = v ? VIEWS[v].dst : (p && p.devices[0]);
    if (!dst) return;
    BhoomiLive.post('/api/command', { dst, set: { AER: mode } }).then((r) => note(r.error ? r.error : L.sent, 4000)).catch(() => note('Backend not reachable'));
  }
  document.querySelectorAll('#pCtl button').forEach((b) => b.addEventListener('click', () => sendAer(b.dataset.aer)));

  let devN = 0;
  function addDevice() {
    const id = (0x900000 + Math.floor(Math.random() * 0x6fffff)).toString(16).toUpperCase().slice(0, 6);
    const line = `AM1,ID=${id},T=POND,N=${++devN},DO=6.84,DOS=89,PH=7.92,WT=28.3,AER=0,AERI=0.0,BV=4.08,FLT=0`;
    if (st.live) { fetch((qs.get('backend') || '') + '/api/ingest', { method: 'POST', body: line }).catch(() => {}); fly('K12'); return id; }
    st.devView[id] = st.view;
    simPacket({ raw: line, ok: true, t: st.clocks[st.view] ?? GWM.farmNow(), rssi: -95 });
    return id;
  }
  $('addDev').addEventListener('click', addDevice);

  // phone language
  $('pLangs').innerHTML = Object.entries(I18N.LANGS).map(([k, n]) => `<button data-l="${k}">${n}</button>`).join('');
  function setLang(l) {
    st.lang = l;
    document.querySelectorAll('#pLangs button').forEach((b) => b.classList.toggle('on', b.dataset.l === l));
    if (st.live) BhoomiLive.post('/api/lang', { lang: l }).catch(() => {}); else gw.setLang(l);
    scheduleRender();
  }
  document.querySelectorAll('#pLangs button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.l)));

  function speak(text) {
    const L = UI[st.lang];
    if (!('speechSynthesis' in window)) return note(L.noVoice);
    const u = new SpeechSynthesisUtterance(text); u.lang = I18N.VOICE[st.lang];
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang && x.lang.toLowerCase().startsWith(st.lang));
    if (v) u.voice = v; else if (st.lang !== 'en' && voices.length) note(L.noVoice, 3000);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  // ------------------------------------------------------------------ animation helpers
  function fly(linkId, kind) {
    const el = $(linkId); if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.querySelectorAll('.pk').length > 4) return;
    const d = document.createElement('i'); d.className = 'pk' + (kind === 'down' ? ' down' : '') + (kind === 'alert' ? ' alert' : '');
    if (kind === 'lost') d.style.opacity = '.35';
    el.appendChild(d); setTimeout(() => d.remove(), 850);
  }
  function flashLayer(id) { const el = $(id); el.classList.add('hl'); setTimeout(() => { if (!tour) el.classList.remove('hl'); }, 1600); }

  // ------------------------------------------------------------------ render
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (x, d) => (typeof x === 'number' ? x.toFixed(d) : '–');
  const age = (s) => { s = Math.max(0, Math.round(s)); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h'; };
  let renderTimer = null;
  function scheduleRender() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = null; render(); }, 120); }

  function render() {
    const f = farm(), G = f.gateway, Cd = f.cloud, L = UI[st.lang];
    const ponds = G.ponds.slice().sort((a, b) => (a.key === 'pond1' ? -1 : b.key === 'pond1' ? 1 : a.key === 'tank' ? -1 : b.key === 'tank' ? 1 : 0));
    if (!ponds.find((p) => p.key === st.pond) && ponds.length && !viewOfPond(st.pond)) st.pond = ponds[0].key;
    const P = ponds.find((p) => p.key === st.pond) || null;
    const fc = forecast(f, st.pond);

    // header: internet
    const nb = $('netBtn'); nb.classList.toggle('on', G.online); nb.classList.toggle('off', !G.online);
    nb.querySelector('b').textContent = G.online ? 'online' : 'down';
    $('K23').classList.toggle('down', !G.online);

    // layer 1
    const devs = G.devices.filter((d) => d.kind !== 'gateway');
    const lvl = (d) => { const p = G.ponds.find((x) => x.devices.includes(d.id)); return d.silent ? 'warn' : p ? p.level : 'none'; };
    $('L1body').innerHTML = `<div class="chips">${devs.length ? devs.map((d) => `<span class="chip" title="${esc(d.name)}"><i class="dot ${lvl(d)}"></i>${esc(d.id)} ${esc(d.role.replace('Prototype pond node', 'Tank node').replace('Aerator controller', 'Bank ctrl').replace('Pond buoy', 'Buoy'))}</span>`).join('') : '<span class="chip"><i class="dot none"></i>waiting for the first packet</span>'}</div>`
      + kv('Packets heard', G.packets) + kv('Last reading', P && P.last ? `${P.time} · DO ${fmt(P.last.DO, 2)}` : '–') + kv('Aerator', P ? (P.aer === 1 ? 'running' : P.aer === 0 ? 'off' : '–') + ' · ' + P.mode : '–');
    // layer 2
    $('L2body').innerHTML = kv('Gateway A10D55', G.online ? 'online' : 'internet down') + kv('Devices in registry', devs.length) + kv('Alerts raised', G.alerts.length) + kv('SMS sent', G.sms) + kv('Waiting in buffer', G.buffered);
    // layer 3
    $('L3body').innerHTML = kv('Readings stored', Cd.stored) + kv('Forecast', fc.risk === 'high' || fc.risk === 'medium' ? `below 4 at ${fc.time}` : fc.risk === 'now' ? 'below 4 now' : fc.risk === 'low' ? 'steady' : '…') + kv('Pushes sent', Cd.pushes.length);
    // layer 4
    const lastPush = Cd.pushes[Cd.pushes.length - 1];
    $('L4body').innerHTML = kv('Language', I18N.LANGS[st.lang]) + kv('Alerts on the phone', Cd.pushes.length + G.smsLog.length) + `<div class="kv"><span>Last</span><b title="${esc(lastPush ? lastPush.text[st.lang] : '')}">${esc(lastPush ? lastPush.text[st.lang] : '–')}</b></div>`;

    renderPhone(G, Cd, P, fc, L, ponds);
    renderGateway(G);
    renderCloud(Cd, fc, P);
    if (Cd.pushes.length > st.seenPush) { st.seenPush = Cd.pushes.length; }
  }
  const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;

  function renderPhone(G, Cd, P, fc, L, ponds) {
    const clock = pondClock(st.pond);
    $('pClock').textContent = GWM.hhmm(clock);
    const net = $('pNet'); net.textContent = G.online ? '4G ▮▮▮' : 'No internet'; net.classList.toggle('off', !G.online);
    const off = $('pOffline'); off.hidden = G.online; off.textContent = L.noNet;
    // pond tabs: known ponds + the active view's pond
    const keys = ponds.map((p) => p.key); if (!keys.includes(VIEWS[st.view].pond)) keys.unshift(VIEWS[st.view].pond);
    $('pPonds').innerHTML = keys.map((k) => { const p = ponds.find((x) => x.key === k); return `<button data-p="${k}" class="${k === st.pond ? 'on' : ''}"><i class="dot ${p ? p.level : 'none'}"></i>${esc(I18N.pondName(k, st.lang))}</button>`; }).join('');
    document.querySelectorAll('#pPonds button').forEach((b) => b.onclick = () => { st.pond = b.dataset.p; fetchHist(st.pond); scheduleRender(); });

    const f = (P && P.last) || {}, flt = (P && P.flt) || 0;
    const doBad = flt >= 1 && flt <= 3;
    const level = P ? P.level : 'none';
    $('pDO').textContent = doBad ? 'ERR' : fmt(f.DO, 1);
    const ring = $('pRing');
    ring.style.setProperty('--p', doBad || typeof f.DO !== 'number' ? 0 : Math.min(100, f.DO / 10 * 100));
    ring.style.setProperty('--c', level === 'crit' ? 'var(--crit)' : level === 'warn' ? 'var(--warn)' : 'var(--accent)');
    $('pOxy').textContent = L.oxygen;
    const sEl = $('pStatus'); sEl.className = 'status ' + level; sEl.textContent = L[level] || L.none;
    $('pPhL').textContent = L.ph; $('pWtL').textContent = L.water; $('pAerL').textContent = L.aerator;
    $('pPH').textContent = fmt(f.PH, 2); $('pWT').textContent = typeof f.WT === 'number' && f.WT > -50 ? f.WT.toFixed(1) + '°' : '–';
    $('pAER').textContent = P ? (P.aer === 1 ? L.on : P.aer === 0 ? L.off : '–') + ' · ' + P.mode : '–';
    document.querySelectorAll('#pCtl button').forEach((b) => { b.classList.toggle('on', !!P && P.mode === b.dataset.aer); b.textContent = b.dataset.aer === 'AUTO' ? 'AUTO' : L[b.dataset.aer.toLowerCase()]; b.disabled = !G.online; });
    $('pCtlNote').textContent = Date.now() < st.noteUntil ? st.note : G.online ? L.tap : L.offTap;

    $('pFcL').textContent = L.forecast;
    const fcEl = $('pFc'); fcEl.className = 'fc ' + (fc.risk || '');
    $('pFcT').textContent = fc.risk === 'high' || fc.risk === 'medium' ? I18N.textFor('FORECAST', st.pond, { time: fc.time })[st.lang].split(': ').slice(1).join(': ')
      : fc.risk === 'now' ? L.nowLow : fc.risk === 'low' ? `${L.steady} (${fc.slopeH >= 0 ? '+' : ''}${fmt(fc.slopeH, 2)} mg/L/h)` : L.collecting;

    $('pAlL').textContent = L.alerts; $('pLogL').textContent = L.log;
    const items = Cd.pushes.filter((a) => !a.pond || a.pond === st.pond).map((a) => ({ t: a.t, time: a.time, level: a.level, text: a.text[st.lang] || a.text.en, kind: 'push', late: a.channels.includes('push-late') }))
      .concat(G.smsLog.filter((s) => !s.pond || s.pond === st.pond).map((s) => ({ t: s.t, time: s.time, level: s.level, text: s.text, kind: 'sms' })))
      .sort((a, b) => b.t - a.t).slice(0, 10);
    $('pAlerts').innerHTML = items.length ? items.map((a, i) => `<li class="${a.level}${a.kind === 'sms' ? ' smsmsg' : ''}"><span>${esc(a.text)}</span><button class="say" data-i="${i}" title="${esc(L.listen)}" aria-label="${esc(L.listen)}">🔊</button><small>${a.time}${a.kind === 'sms' ? ' · ' + L.sms : a.late ? ' · late (after outage)' : ''}</small></li>`).join('') : `<li class="empty">${esc(L.noAlerts)}</li>`;
    document.querySelectorAll('#pAlerts .say').forEach((b) => b.onclick = () => speak(items[+b.dataset.i].text));
    const log = P ? P.aerLog.slice().reverse() : [];
    $('pLog').innerHTML = log.length ? log.map((e) => `<li><span>${e.time}</span><b class="${e.on ? 'on' : 'off'}">${e.on ? L.on : L.off}</b><span>DO ${fmt(e.do, 1)} · ${e.mode}</span></li>`).join('') : `<li class="empty">${esc(L.noLog)}</li>`;
  }

  function renderGateway(G) {
    $('gwState').textContent = G.online ? 'internet online' : 'internet down';
    $('gwState').className = 'badge ' + (G.online ? 'on' : 'off');
    const rows = G.devices.slice().sort((a, b) => (a.kind === 'new') - (b.kind === 'new') || a.id.localeCompare(b.id));
    $('regBody').innerHTML = rows.length ? rows.map((d) => `<tr class="${d.kind === 'new' ? 'new' : ''}"><td>${esc(d.id)}</td><td>${esc(d.name)}</td><td>${esc(d.role)}</td><td>${d.packets}</td><td>${d.rssi != null ? d.rssi + ' dBm' : '–'}</td><td>${d.silent ? '<span style="color:var(--warn)">silent</span>' : tFor(d.id) == null ? '–' : age(tFor(d.id) - d.lastT) + ' ago'}</td></tr>`).join('')
      : '<tr><td colspan="6" style="color:var(--mute)">No device heard yet</td></tr>';
    $('smsN').textContent = G.sms;
    $('smsLog').innerHTML = G.smsLog.length ? G.smsLog.slice().reverse().slice(0, 6).map((s) => `<li>${esc(s.text)}<small>${s.time} · to farmer · ${I18N.LANGS[s.lang]}</small></li>`).join('') : '<li class="empty">None yet. Critical alerts, and warnings while the internet is down, go out by SMS.</li>';
    $('bufN').textContent = G.buffered;
    $('bufHint').textContent = G.buffered ? `${G.buffered} readings and alerts are waiting at the gateway. They reach the cloud as soon as the internet is back.` : G.online ? 'Empty: everything reached the cloud.' : 'Internet down: new readings will wait here.';
  }

  const cx = $('chart').getContext('2d');
  function renderCloud(Cd, fc, P) {
    $('clStored').textContent = Cd.stored + ' stored';
    $('chTitle').textContent = 'Dissolved oxygen · ' + I18N.pondName(st.pond, 'en');
    $('fcText').innerHTML = fc.risk === 'high' || fc.risk === 'medium' ? `<b>${fc.risk === 'high' ? 'High' : 'Medium'} risk.</b> ${esc(fc.text)}.` : esc(fc.text || 'Collecting readings…');
    $('pushLog').innerHTML = Cd.pushes.length ? Cd.pushes.slice().reverse().slice(0, 6).map((a) => `<li class="${a.level}">${esc(a.text.en)}<small>${a.time} · ${a.code}${a.channels.includes('push-late') ? ' · delivered after the outage' : ''}</small></li>`).join('') : '<li class="empty">No notifications yet.</li>';
    drawChart(history(st.pond), fc, pondClock(st.pond));
  }

  function drawChart(h, fc, now) {
    const c = $('chart'), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = 220;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = H * dpr; }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), col = (v) => css.getPropertyValue(v).trim();
    const pts = h.filter((p) => p.t <= now + 1);
    const t1 = Math.max(now, pts.length ? pts[pts.length - 1].t : now) + (fc.at ? Math.min(3 * 3600, Math.max(0, fc.at - now) + 600) : 600);
    let t0 = pts.length ? Math.max(pts[0].t - 300, t1 - 6 * 3600) : t1 - 3 * 3600;     // show what we have, up to 6 h
    if (t1 - t0 < 3600) t0 = t1 - 3600;
    const x = (t) => 36 + (t - t0) / (t1 - t0) * (W - 46), y = (v) => 10 + (1 - v / 12) * (H - 34);
    cx.font = '11px IBM Plex Mono, monospace'; cx.fillStyle = col('--mute'); cx.strokeStyle = '#1d3134'; cx.lineWidth = 1;
    for (const v of [0, 2, 4, 6, 8, 10, 12]) { cx.beginPath(); cx.moveTo(36, y(v)); cx.lineTo(W - 10, y(v)); cx.stroke(); cx.fillText(String(v), 8, y(v) + 4); }
    for (let k = 0; k <= 4; k++) { const t = t0 + (t1 - t0) * k / 4; cx.fillText(GWM.hhmm(t), Math.min(W - 44, Math.max(30, x(t) - 16)), H - 6); }
    // aerator ON bands
    cx.fillStyle = 'rgba(98, 208, 147, .16)';
    for (let i = 0; i < pts.length - 1; i++) if (pts[i].AER === 1) cx.fillRect(x(pts[i].t), 10, Math.max(1, x(pts[i + 1].t) - x(pts[i].t)), H - 34);
    // ON / OFF thresholds
    cx.setLineDash([4, 4]); cx.strokeStyle = 'rgba(242, 103, 93, .7)'; cx.beginPath(); cx.moveTo(36, y(4)); cx.lineTo(W - 10, y(4)); cx.stroke();
    cx.strokeStyle = 'rgba(98, 208, 147, .6)'; cx.beginPath(); cx.moveTo(36, y(6)); cx.lineTo(W - 10, y(6)); cx.stroke(); cx.setLineDash([]);
    cx.fillStyle = col('--crit'); cx.fillText('ON < 4', W - 60, y(4) - 4); cx.fillStyle = col('--ok'); cx.fillText('OFF > 6', W - 64, y(6) - 4);
    // DO line
    cx.strokeStyle = col('--accent'); cx.lineWidth = 2; cx.beginPath(); let pen = false;
    for (const p of pts) { if (p.DO == null) { pen = false; continue; } if (!pen) { cx.moveTo(x(p.t), y(p.DO)); pen = true; } else cx.lineTo(x(p.t), y(p.DO)); }
    cx.stroke();
    // forecast
    if ((fc.risk === 'high' || fc.risk === 'medium') && fc.at && fc.last != null) {
      cx.setLineDash([6, 5]); cx.strokeStyle = col('--warn'); cx.lineWidth = 2; cx.beginPath(); cx.moveTo(x(now), y(fc.last)); cx.lineTo(x(fc.at), y(4)); cx.stroke(); cx.setLineDash([]);
      cx.fillStyle = col('--warn'); cx.beginPath(); cx.arc(x(fc.at), y(4), 4, 0, 7); cx.fill(); cx.fillText(fc.time, x(fc.at) - 16, y(4) + 16);
    }
    if (!pts.length) { cx.fillStyle = col('--mute'); cx.font = '13px IBM Plex Sans, sans-serif'; cx.fillText('Waiting for readings from the pond…', W / 2 - 110, H / 2); }
  }
  window.addEventListener('resize', scheduleRender);
  setInterval(scheduleRender, 1000);

  // layer cards scroll to their part of the page
  document.querySelectorAll('.layer').forEach((el) => el.addEventListener('click', () => $(el.dataset.go).scrollIntoView({ behavior: 'smooth', block: 'start' })));

  // ------------------------------------------------------------------ framework tour (judge demo across all four layers)
  const TOUR = [
    { hl: ['L1', 'L2', 'L3', 'L4'], t: 'One pond node, four layers', x: 'This page is the AgriMesh framework, live: the pond hardware in 3D (layer 1), the edge gateway at the farmhouse (2), the cloud (3) and the farmer\'s phone (4). Every packet, alert and command you see flows through all four.', go: () => { if (st.view !== 'field') loadView('field'); } },
    { hl: ['L1'], s: 'viewCard', t: 'Layer 1 · the pond decides by itself', x: 'Cloudy evening, heavy plankton: oxygen will crash tonight. The floating buoy measures DO, pH and temperature; the bank controller switches the paddle-wheel aerator ON below 4 mg/L. No internet needed for that.', go: () => { toView({ bhoomi: 'scenario', key: 'crash' }); toView({ bhoomi: 'cam', k: 'overview' }); } },
    { hl: ['L2'], s: 'gwPanel', t: 'Layer 2 · the gateway hears everything', x: 'The farmhouse gateway gets every packet over LoRa. Its registry knows each device by ID and type; its rules turn readings into alerts and keep an aerator log.' },
    { hl: ['L3'], s: 'cloudPanel', t: 'Layer 3 · the cloud sees it coming', x: 'The cloud keeps the history and fits a line to the last 2 hours of oxygen. When DO will cross 4 mg/L within the next hours, it warns the farmer before it happens.' },
    { hl: ['L4'], s: 'phone', t: 'Layer 4 · the farmer is told in Telugu', x: 'Alerts reach the phone in the farmer\'s own language: English, Telugu or Tamil, with 🔊 to hear them. Status, oxygen gauge, forecast and the aerator log are one glance away.', go: () => setLang('te') },
    { hl: ['L4', 'L1'], s: 'phone', t: 'One tap, from another village', x: 'Tap ON: the command goes app → cloud → gateway → bank controller over LoRa, and the controller answers with an ACK. Then back to AUTO.', go: () => { sendAer('ON'); setTimeout(() => sendAer('AUTO'), 5000); } },
    { hl: ['L2', 'L1'], s: 'gwPanel', t: 'Internet down? The fish are still safe', x: 'The gateway\'s internet is cut and the aerator motor trips. The pond loop keeps running, the gateway sends the alert by SMS, and readings wait in its buffer.', go: () => { setOnline(false); toView({ bhoomi: 'scenario', key: 'aerFail' }); } },
    { hl: ['L3'], s: 'cloudPanel', t: 'Back online: nothing is lost', x: 'The link returns and the buffer is flushed: every reading and alert reaches the cloud and the phone, marked as delivered after the outage.', go: () => setOnline(true) },
    { hl: ['L2'], s: 'gwPanel', t: 'Add a device, not a redesign', x: 'A new pond node powers up. Its first packet carries its ID and type, so it joins the registry and appears on the phone by itself. No code change.', go: () => addDevice() },
    { hl: ['L1'], s: 'viewCard', t: 'Two builds, one twin', x: 'The field pond is the product; the prototype tank is the hackathon build: one ESP32, the same rules, the same packets. Both run in this twin, in Simulation or Live.', go: () => { loadView('tank'); } },
  ];
  let tour = null; const TSTEP = 11000;
  function tourGo(i) {
    if (i < 0 || i >= TOUR.length) return tourExit();
    tour.i = i; tour.t = 0;
    const s = TOUR[i];
    document.querySelectorAll('.layer').forEach((el) => el.classList.toggle('hl', s.hl.includes(el.id)));
    $('capStep').textContent = `STEP ${i + 1} / ${TOUR.length}`; $('capTitle').textContent = s.t; $('capText').textContent = s.x;
    if (s.go) s.go();
    if (s.s) $(s.s).scrollIntoView({ behavior: 'smooth', block: s.s === 'viewCard' ? 'start' : 'center' });
  }
  function tourStart() { tour = { i: 0, t: 0 }; $('caption').hidden = false; $('tourBtn').textContent = '■ Stop tour'; window.scrollTo({ top: 0, behavior: 'smooth' }); tourGo(0); }
  function tourExit() { tour = null; $('caption').hidden = true; $('tourBtn').textContent = '▶ Framework tour'; document.querySelectorAll('.layer').forEach((el) => el.classList.remove('hl')); }
  $('tourBtn').addEventListener('click', () => (tour ? tourExit() : tourStart()));
  $('capPrev').addEventListener('click', () => tour && tourGo(tour.i - 1));
  $('capNext').addEventListener('click', () => tour && tourGo(tour.i + 1));
  $('capExit').addEventListener('click', tourExit);
  setInterval(() => { if (!tour) return; tour.t += 200; $('capBar').style.width = Math.min(100, tour.t / TSTEP * 100) + '%'; if (tour.t >= TSTEP) tourGo(tour.i + 1); }, 200);

  // ------------------------------------------------------------------ start
  setLang(st.lang);
  $('srcNote').textContent = 'Simulation: gateway and cloud run in this browser.';
  loadView(st.view);
  window.__app = { st, farm, get gw() { return gw; }, get cloud() { return cloud; }, sendAer, setOnline, addDevice, loadView, setLang };   // tests and console
})();
