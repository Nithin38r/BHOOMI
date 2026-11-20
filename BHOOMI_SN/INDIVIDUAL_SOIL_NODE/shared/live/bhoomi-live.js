/*
 * BHOOMI live client (shared by every stage).
 * Connects a twin page to the backend WebSocket (/ws) and adds a "Simulation / Live" switch
 * to the page header. Each stage has its own js/live-adapter.js that decides what a packet
 * changes in that twin.
 *
 *   BhoomiLive.start({
 *     mountBefore: '#demoBtn',                 // header element the switch goes in front of
 *     onHello(msg)  { ... },                    // first message: known nodes + recent packets
 *     onPacket(rec) { ... },                    // every new packet while Live is on
 *     onModeChange(live) { ... },               // user switched Simulation <-> Live
 *   });
 *
 * Opened from disk (file://) the twin simply stays in Simulation; nothing breaks.
 */
(function () {
  'use strict';
  const state = { ws: null, connected: false, live: false, lastRx: null, lastId: null, retry: 1000, opts: null, hello: null, els: {} };

  function wsUrl() {
    const qs = new URLSearchParams(location.search);
    if (qs.get('backend')) return qs.get('backend').replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  function ago(ms) { const s = Math.round(ms / 1000); return s < 60 ? s + ' s ago' : Math.round(s / 60) + ' min ago'; }

  function render() {
    const { dot, txt, btn, chip } = state.els; if (!dot) return;
    dot.className = 'dot ' + (state.live ? (state.connected ? 'ok' : 'bad') : state.connected ? 'blue' : '');
    if (state.live) txt.textContent = state.connected ? 'Live' + (state.lastId ? ' · ' + state.lastId : '') + (state.lastRx ? ' · ' + ago(Date.now() - state.lastRx) : ' · waiting') : 'Live · backend lost';
    else txt.textContent = 'Simulation';
    btn.textContent = state.live ? 'Back to simulation' : 'Go live';
    btn.disabled = !state.live && !state.connected;
    chip.title = state.connected ? 'Connected to the BHOOMI backend at ' + wsUrl().replace(/^ws/, 'http').replace('/ws', '')
      : (wsUrl() ? 'Backend not reachable. Start it with: cd backend && npm start' : 'Open this page through the backend (http://localhost:8080) to use live data');
    btn.title = btn.disabled ? chip.title : '';
  }

  function mount(sel) {
    const anchor = document.querySelector(sel);
    if (!anchor || !anchor.parentNode) return;
    const wrap = document.createElement('div'); wrap.className = 'bl-live';
    wrap.innerHTML = '<span class="chip bl-chip"><span class="dot"></span>Data <b class="bl-txt">Simulation</b></span><button class="btn sm bl-btn" type="button">Go live</button>';
    anchor.parentNode.insertBefore(wrap, anchor);
    state.els = { chip: wrap.querySelector('.bl-chip'), dot: wrap.querySelector('.dot'), txt: wrap.querySelector('.bl-txt'), btn: wrap.querySelector('.bl-btn') };
    state.els.btn.addEventListener('click', () => setLive(!state.live));
    render();
  }

  function setLive(on) {
    if (on && !state.connected) return;
    state.live = !!on;
    try { state.opts.onModeChange && state.opts.onModeChange(state.live); } catch (e) { console.error(e); }
    if (state.live && state.hello) { try { state.opts.onHello && state.opts.onHello(state.hello); } catch (e) { console.error(e); } }
    render();
  }

  function connect() {
    const url = wsUrl(); if (!url) { render(); return; }
    let ws;
    try { ws = new WebSocket(url); } catch { schedule(); return; }
    state.ws = ws;
    ws.onopen = () => { state.connected = true; state.retry = 1000; render(); };
    ws.onclose = () => { state.connected = false; render(); schedule(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'hello') { state.hello = msg; if (state.live) state.opts.onHello && state.opts.onHello(msg); }
      if (msg.type === 'packet') {
        if (state.hello) { state.hello.recent.push(msg.record); if (state.hello.recent.length > 200) state.hello.recent.shift(); }
        if (state.live) { state.lastRx = Date.now(); state.lastId = msg.record.id; try { state.opts.onPacket && state.opts.onPacket(msg.record); } catch (err) { console.error(err); } }
      }
      render();
    };
  }
  function schedule() { setTimeout(connect, state.retry); state.retry = Math.min(15000, state.retry * 1.6); }

  window.BhoomiLive = {
    start(opts) {
      state.opts = opts || {};
      mount(state.opts.mountBefore || 'header .btn');
      connect();
      setInterval(render, 5000);
      // ?live=1 switches to live as soon as the backend answers
      if (new URLSearchParams(location.search).get('live') === '1') {
        const t = setInterval(() => { if (state.connected) { clearInterval(t); setLive(true); } }, 300);
      }
    },
    get live() { return state.live; },
    get connected() { return state.connected; },
    setLive,
    /** REST helper: BhoomiLive.api('/api/nodes') */
    api(path) { const base = (wsUrl() || '').replace(/^ws/, 'http').replace(/\/ws$/, ''); return fetch(base + path).then((r) => r.json()); },
  };
})();
