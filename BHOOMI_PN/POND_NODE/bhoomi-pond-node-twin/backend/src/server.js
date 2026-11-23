// BHOOMI Pond Node digital twin: backend.
// Plays layers 2 and 3 of the AgriMesh framework in one process:
//   - EDGE GATEWAY (shared/farm/gateway.cjs): registry, pond rules, alerts, SMS fallback, offline buffer
//   - CLOUD (shared/farm/cloud.cjs + store.js): history, oxygen forecast, push to the app, packets.jsonl
// plus the REST API, the WebSocket /ws for the twin and the phone app, the static frontend, and the
// packet sources: built-in simulator, HTTP POST, optional MQTT, optional USB serial.
// Plain Node.js 18+, no npm install.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { parseAM1, formatAM1, FIELD_INFO } from './am1.js';
import { Store } from './store.js';
import { WsHub } from './ws.js';
import { GW, CLOUD, I18N } from './farm.js';
import { startSimulator } from './sources/simulator.js';
import { startMqtt } from './sources/mqtt.js';
import { startSerial } from './sources/serial.js';

const VERSION = '2.0.0';
const STARTED = Date.now();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.cjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon', '.gif': 'image/gif', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
// only these parts of the repository are served to the browser
const PUBLIC = /^\/(frontend\/|shared\/|media\/)/;
const HUB_ID = GW.GATEWAY_ID;   // gateway address used in CMD packets (matches the firmware and the twin)

export function createApp(opts = {}) {
  const cfg = { ...config, ...opts };
  const store = new Store({ dataDir: cfg.dataDir, historyPerNode: cfg.historyPerNode });
  const ws = new WsHub();
  const sources = { simulator: null, mqtt: null, serial: null, http: true };
  const log = opts.log || ((...a) => console.log(...a));
  const gateway = GW.createGateway({ silentAfterS: cfg.silentAfterS, lang: cfg.farmerLang });
  const cloud = CLOUD.createCloud();

  /** farm-clock seconds for a device: its simulator clock, else India time */
  const tFor = (id) => sources.simulator?.clockOf(id) ?? GW.farmNow();
  const pondClock = (key) => { const p = gateway.ponds.get(key); return p && p.devices.length ? tFor(p.devices[0]) : GW.farmNow(); };

  /** Gateway -> cloud: store, push to the app, forecast. */
  function toCloud(item) {
    cloud.receive(item);
    if (item.kind === 'packet') {
      const rec = store.add(item.rec, item.rec.rx || {});
      if (rec.type === 'POND' && rec.pond) { const fc = cloud.checkForecast(rec.pond, item.rec.t); if (fc) ws.broadcast({ type: 'notify', alert: fc }); }
    } else if (item.kind === 'alert') ws.broadcast({ type: 'notify', alert: item.alert });
  }

  /** Single entry point for every packet, whatever its source (simulator, HTTP, MQTT, serial). */
  function ingest(line, rx = {}) {
    const pkt = parseAM1(line);
    if (!pkt) return { ok: false, error: 'not an AM1 packet' };
    if (pkt.type === 'CMD') return { ok: true, ignored: 'command echo: commands are created here' };
    const t = typeof rx.farmT === 'number' ? rx.farmT : GW.farmNow();
    pkt.rx = { rssi: rx.rssi ?? null, snr: rx.snr ?? null, via: rx.via ?? null, source: rx.source ?? 'unknown', ...(rx.why ? { why: rx.why } : {}), simT: rx.farmT };
    const res = gateway.process(pkt, t, rx);
    if (res.duplicate) return { ok: true, duplicate: true };
    for (const it of res.deliver) toCloud(it);
    scheduleFarm();
    return { ok: true, record: { id: pkt.id, type: pkt.type, n: pkt.n }, buffered: !gateway.online };
  }

  const silentTimer = setInterval(() => { const r = gateway.check(tFor); r.deliver.forEach(toCloud); if (r.alerts.length) scheduleFarm(); }, 2000);
  silentTimer.unref?.();
  store.on('packet', (rec) => ws.broadcast({ type: 'packet', record: rec }));
  store.on('node', (node) => ws.broadcast({ type: 'node', node: store.summary(node) }));

  function farmState() {
    return { gateway: gateway.summary(), cloud: cloud.summary(pondClock), sim: sources.simulator ? sources.simulator.state() : null, langs: I18N.LANGS };
  }
  let farmTimer = null;
  function scheduleFarm() { if (farmTimer) return; farmTimer = setTimeout(() => { farmTimer = null; ws.broadcast({ type: 'farm', farm: farmState() }); }, 600); }
  const farmTick = setInterval(scheduleFarm, 3000); farmTick.unref?.();

  function setLink(on) {
    const flushed = gateway.setOnline(on);
    flushed.forEach(toCloud);
    ws.broadcast({ type: 'link', online: gateway.online, flushed: flushed.length });
    scheduleFarm();
    return { online: gateway.online, flushed: flushed.length };
  }

  let cmdSeq = 0;
  /** App -> cloud -> gateway -> device command: AM1 CMD out over MQTT / serial, and to a simulated device. */
  function sendCommand(dst, set) {
    if (!gateway.online) return { error: 'internet down: the command cannot reach the farm gateway. Use the switch on the controller.', status: 503 };
    cmdSeq += 1;
    const DST = String(dst).toUpperCase();
    const line = formatAM1(HUB_ID, 'CMD', cmdSeq, { DST, ...set });
    const out = [];
    if (sources.mqtt?.connected) { sources.mqtt.publish(line); out.push('mqtt'); }
    if (sources.serial?.open) { sources.serial.write(line); out.push('serial'); }
    const rec = { ts: new Date().toISOString(), type: 'CMD', id: HUB_ID, n: cmdSeq, raw: line, fields: { DST, ...set }, rx: { source: 'gateway' } };
    store.recent.push(rec); if (store.recent.length > 200) store.recent.shift();
    ws.broadcast({ type: 'cmd', record: rec, sentTo: out });
    let ack = null;
    if (sources.simulator && sources.simulator.owns(DST)) {
      const lines = sources.simulator.command(DST, set, cmdSeq);
      if (lines) {
        out.push('simulator'); ack = lines[0] || null;
        const field = sources.simulator.get('field');
        // the device acted at once, so the gateway learns its new mode at once (before the next reading)
        lines.forEach((l) => ingest(l, { source: 'simulator', rssi: -83, snr: 6, farmT: sources.simulator.clockOf(DST) }));
        if (field && field.ids.includes(DST)) setTimeout(() => lines.forEach((l) => ws.broadcast({ type: 'radio', id: 'field', route: 'K2H', raw: l, ok: true })), 300);
      }
    }
    return { line, sentTo: out, ack };
  }

  ws.onConnect = (client) => client.send({ type: 'hello', version: VERSION, nodes: store.list(), recent: store.recent.slice(-40), sources: sourceInfo(), farm: farmState(), sim: sources.simulator ? sources.simulator.state() : null });
  ws.onMessage = (client, msg) => { if (msg && msg.type === 'ping') client.send({ type: 'pong', t: Date.now() }); };

  function sourceInfo() {
    return {
      simulator: sources.simulator ? { devices: sources.simulator.devices, fieldSpeed: cfg.simFieldSpeed, tankSpeed: cfg.simTankSpeed } : null,
      mqtt: sources.mqtt ? { url: sources.mqtt.url, connected: sources.mqtt.connected, topic: sources.mqtt.upTopic } : null,
      serial: sources.serial ? { port: sources.serial.port, open: sources.serial.open } : null,
      http: { path: '/api/ingest', token: !!cfg.ingestToken },
    };
  }

  // ---------------------------------------------------------------- HTTP
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj, null, 1)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (d) => { b += d; if (b.length > 64 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });

  async function api(req, res, url) {
    const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-BHOOMI-Token', 'Access-Control-Allow-Methods': 'GET, POST' }); return res.end(); }
    if (p === '/api/health') return json(res, 200, { ok: true, version: VERSION, uptimeS: Math.round((Date.now() - STARTED) / 1000), nodes: store.nodes.size, packets: store.total, wsClients: ws.size, online: gateway.online, buffered: gateway.summary().buffered, sources: sourceInfo() });
    if (p === '/api/fields') return json(res, 200, FIELD_INFO);
    if (p === '/api/nodes' && req.method === 'GET') return json(res, 200, store.list());
    let m = /^\/api\/nodes\/([0-9A-Za-z]{4,12})$/.exec(p);
    if (m) { const n = store.get(m[1]); return n ? json(res, 200, store.summary(n)) : json(res, 404, { error: 'unknown node' }); }
    m = /^\/api\/nodes\/([0-9A-Za-z]{4,12})\/history$/.exec(p);
    if (m) {
      const n = store.get(m[1]); if (!n) return json(res, 404, { error: 'unknown node' });
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 96));
      return json(res, 200, { id: n.id, type: n.type, history: n.history.slice(-limit) });
    }
    if (p === '/api/packets') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      return json(res, 200, store.recent.slice(-limit));
    }
    // ---- farm: gateway + cloud (what the app shell shows)
    if (p === '/api/farm' && req.method === 'GET') return json(res, 200, farmState());
    if (p === '/api/registry' && req.method === 'GET') return json(res, 200, gateway.summary().devices);
    if (p === '/api/alerts' && req.method === 'GET') return json(res, 200, { gateway: gateway.summary().alerts, sms: gateway.summary().smsLog, pushes: cloud.summary().pushes });
    if (p === '/api/ponds' && req.method === 'GET') return json(res, 200, gateway.summary().ponds);
    m = /^\/api\/ponds\/([a-z0-9]{2,12})\/(history|forecast)$/.exec(p);
    if (m) {
      const t = pondClock(m[1]);
      if (m[2] === 'forecast') return json(res, 200, Object.assign({ pond: m[1] }, cloud.forecast(m[1], t)));
      const hours = Math.min(48, Math.max(0.5, Number(url.searchParams.get('hours')) || 24));
      return json(res, 200, { pond: m[1], history: cloud.history(m[1], t - hours * 3600) });
    }
    if ((p === '/api/link' || p === '/api/lang') && req.method === 'POST') {
      let body = {}; try { const t = await readBody(req); body = t ? JSON.parse(t) : {}; } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (p === '/api/lang') { if (!I18N.LANGS[body.lang]) return json(res, 400, { error: 'lang must be en, te or ta' }); gateway.setLang(body.lang); scheduleFarm(); return json(res, 200, { lang: body.lang }); }
      return json(res, 200, setLink(body.online !== false));
    }
    if (p === '/api/command' && req.method === 'POST') {
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (!body.dst || !/^[0-9A-Za-z]{4,12}$/.test(body.dst) || !body.set || typeof body.set !== 'object') return json(res, 400, { error: 'send {"dst":"3B41F0","set":{"AER":"ON"}}' });
      const set = {}; for (const [k, v] of Object.entries(body.set)) if (/^[A-Z0-9]{1,8}$/i.test(k) && /^[A-Za-z0-9.?\-]{1,12}$/.test(String(v))) set[k.toUpperCase()] = v;
      if (!Object.keys(set).length) return json(res, 400, { error: 'no valid KEY=VALUE in set' });
      const r = sendCommand(body.dst, set);
      if (r.error) return json(res, r.status, r);
      return json(res, r.sentTo.length ? 200 : 202, r);
    }
    // ---- simulator controls: what the 3D views' scenario, fault and slider controls do in Live
    if (p.startsWith('/api/sim')) {
      const sim = sources.simulator;
      if (!sim) return json(res, 404, { error: 'simulator is off (SIM=0)' });
      if (p === '/api/sim' && req.method === 'GET') return json(res, 200, sim.state());
      if (req.method !== 'POST') return json(res, 405, { error: 'use POST' });
      let body = {}; try { const t = await readBody(req); body = t ? JSON.parse(t) : {}; } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const dev = sim.get(body.dev || 'field');
      if (!dev) return json(res, 404, { error: 'unknown device: use "field" or "tank"', devices: sim.devices });
      const routes = {
        '/api/sim/scenario': () => dev.scenarioSet(body.key),
        '/api/sim/fault': () => dev.fault(body.fault, body.on),
        '/api/sim/env': () => dev.env(body),
        '/api/sim/hour': () => dev.hour(Number(body.h)),
        '/api/sim/speed': () => dev.speedSet(Number(body.x)),
        '/api/sim/run': () => dev.run(body.on),
        '/api/sim/timers': () => (dev.timers ? dev.timers(body.demo) : false),
        '/api/sim/button': () => (dev.button ? dev.button(body.press) : false),
      };
      const fn = routes[p];
      if (!fn) return json(res, 404, { error: 'unknown simulator route', routes: Object.keys(routes) });
      if (!fn()) return json(res, 400, { error: 'bad value for this device', state: dev.state() });
      if (p === '/api/sim/scenario' || p === '/api/sim/hour') {          // the device's clock jumped
        gateway.resync(dev.ids, dev.t);
        for (const pnd of gateway.ponds.values()) if (pnd.devices.some((id) => dev.ids.includes(id))) cloud.clear(pnd.key);
      }
      const st = sim.state(); ws.broadcast({ type: 'sim', state: st }); scheduleFarm();
      return json(res, 200, st);
    }
    if (p === '/api/ingest' && req.method === 'POST') {
      if (cfg.ingestToken && req.headers['x-bhoomi-token'] !== cfg.ingestToken) return json(res, 401, { error: 'bad token' });
      let body; try { body = await readBody(req); } catch (e) { return json(res, 413, { error: e.message }); }
      const items = [];
      const ct = req.headers['content-type'] || '';
      if (ct.includes('json')) {
        let j; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid JSON' }); }
        for (const it of Array.isArray(j) ? j : [j]) items.push([it.raw, { rssi: it.rssi, snr: it.snr, hop: it.hop, via: it.via }]);
      } else for (const l of body.split(/\r?\n/)) if (l.trim()) items.push([l, {}]);
      const results = items.map(([line, rx]) => { const r = ingest(line, { ...rx, source: 'http' }); return r.record ? { ok: true, id: r.record.id, n: r.record.n } : r; });
      return json(res, results.some((r) => r.ok) ? 200 : 400, { results });
    }
    return json(res, 404, { error: 'not found' });
  }

  function serveStatic(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (!PUBLIC.test(p)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.normalize(path.join(cfg.webRoot, p));
    if (!file.startsWith(cfg.webRoot + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => json(res, 500, { error: e.message }));
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    // the app lives in frontend/; folder paths without a slash get one so relative CSS/JS links work
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(302, { Location: '/frontend/' + url.search }); return res.end(); }
    if (/^\/frontend(\/views\/[a-z-]+)?$/.test(url.pathname)) { res.writeHead(302, { Location: url.pathname + '/' + url.search }); return res.end(); }
    serveStatic(req, res, url);
  });
  ws.attach(server, '/ws');

  async function start() {
    await new Promise((r) => server.listen(cfg.port, cfg.host, r));
    if (cfg.sim) sources.simulator = startSimulator({ devices: cfg.simDevices, fieldSpeed: cfg.simFieldSpeed, tankSpeed: cfg.simTankSpeed, ingest, emit: (m) => ws.broadcast(m) });
    sources.mqtt = await startMqtt({ url: cfg.mqttUrl, upTopic: cfg.mqttUpTopic, downTopic: cfg.mqttDownTopic, ingest, log });
    sources.serial = await startSerial({ port: cfg.serialPort, baud: cfg.serialBaud, ingest, log });
    return server.address();
  }
  async function stop() {
    clearInterval(silentTimer); clearInterval(farmTick); clearTimeout(farmTimer); sources.simulator?.stop(); sources.mqtt?.stop?.(); sources.serial?.stop?.();
    for (const c of ws.clients) c.close();
    await new Promise((r) => server.close(r));
  }
  return { server, store, ws, ingest, start, stop, sources, cfg, gateway, cloud, sendCommand, setLink, farmState };
}

// run directly: node src/server.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.js')) {
  const app = createApp();
  app.start().then(() => {
    const { port } = app.cfg;
    console.log(`\n  BHOOMI Pond Node digital twin · backend v${VERSION}`);
    console.log(`  App:       http://localhost:${port}/`);
    console.log(`  API:       http://localhost:${port}/api/health`);
    console.log(`  WebSocket: ws://localhost:${port}/ws`);
    console.log(`  Simulator: ${app.cfg.sim ? `on (${app.cfg.simDevices.join(' + ')}; field ${app.cfg.simFieldSpeed}x, tank ${app.cfg.simTankSpeed}x)` : 'off'}\n`);
  });
  const bye = () => app.stop().then(() => process.exit(0));
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
