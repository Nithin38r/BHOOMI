/*
 * Bridge between a 3D view (iframe) and the BHOOMI app shell (frontend/index.html).
 *   view -> shell : ready, height, pkt (a packet the gateway would hear, in Simulation), clock, mode
 *   shell -> view : setLive, cmd (one-tap command from the phone), scenario, cam
 * Opened on its own (no ?embed=1), the view works as a standalone twin and this file does nothing.
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  const embedded = window.parent !== window && qs.has('embed');
  const view = /prototype-tank/.test(location.pathname) ? 'tank' : 'field';
  if (embedded) document.documentElement.classList.add('embed');
  const handlers = {};
  function post(type, data) { if (embedded) window.parent.postMessage(Object.assign({ bhoomi: type, view }, data || {}), '*'); }
  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data; if (!m || typeof m.bhoomi !== 'string') return;
    (handlers[m.bhoomi] || []).forEach((fn) => { try { fn(m); } catch (err) { console.error(err); } });
  });
  window.BhoomiBridge = { embedded, view, post, on };
  if (!embedded) return;

  // the shell decides Simulation / Live for every layer at once
  let wantLive = false;
  on('setLive', (m) => { wantLive = !!m.on; if (!wantLive && window.BhoomiLive) BhoomiLive.setLive(false); });
  let lastLive = null;
  setInterval(() => {
    if (!window.BhoomiLive) return;
    if (wantLive && !BhoomiLive.live && BhoomiLive.connected) BhoomiLive.setLive(true);
    if (BhoomiLive.live !== lastLive) { lastLive = BhoomiLive.live; post('mode', { live: lastLive }); }
  }, 300);

  // the iframe grows to the page height, so the shell has one scroll bar
  let lastH = 0;
  const report = () => { const h = document.documentElement.scrollHeight; if (Math.abs(h - lastH) > 4) { lastH = h; post('height', { h }); } };
  window.addEventListener('load', report);
  if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
  setInterval(report, 1500);
  post('ready', {});
})();
