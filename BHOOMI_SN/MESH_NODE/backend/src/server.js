// BHOOMI digital-twin backend.
//   - serves the stage frontends (static files)
//   - REST API for nodes, history and ingest
//   - WebSocket /ws pushes every packet to open twins in real time
//   - packet sources: built-in simulator, HTTP POST, optional MQTT, optional USB serial
// Runs with plain Node.js 18+ and no npm install.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { parseAM1, FIELD_INFO } from './am1.js';
import { Store } from './store.js';
import { WsHub } from './ws.js';
import { startSimulator, WEATHER } from './sources/simulator.js';
import { hubSummary } from './hub/rules.js';
import { formatAM1 } from './am1.js';
import { startMqtt } from './sources/mqtt.js';
import { startSerial } from './sources/serial.js';

const VERSION = '1.2.0';
const STARTED = Date.now();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon', '.gif': 'image/gif', '.webp': 'image/webp' };
// only these parts of the repository are served to the browser
const PUBLIC = /^\/(index\.html|shared\/|media\/|stage-[0-9]-[a-z0-9-]+\/frontend\/)/;

export function createApp(opts = {}) {
  const cfg = { ...config, ...opts };
  const store = new Store({ dataDir: cfg.dataDir, historyPerNode: cfg.historyPerNode });
  const ws = new WsHub();
  const sources = { simulator: null, mqtt: null, serial: null, http: true };
  const log = opts.log || ((...a) => console.log(...a));

  /** Single entry point for every packet, whatever its source. */
  function ingest(line, rx = {}) {
    const pkt = parseAM1(line);
    if (!pkt) return { ok: false, error: 'not an AM1 packet' };
    const rec = store.add(pkt, rx);
    if (!rec) return { ok: true, duplicate: true };
    return { ok: true, record: rec };
  }
  store.on('packet', (rec) => { ws.broadcast({ type: 'packet', record: rec }); scheduleHub(); });
  // hub summary (zones, water check, alerts) pushed at most once a second
  let hubTimer = null, cmdSeq = 0;
  const hubState = () => hubSummary(store, { crop: sources.simulator?.farm?.crop || cfg.crop || 'rice', simMinute: sources.simulator?.simMinute() ?? null });
  function scheduleHub() { if (hubTimer) return; hubTimer = setTimeout(() => { hubTimer = null; ws.broadcast({ type: 'hub', hub: hubState() }); }, 1000); }

  /** Hub -> device command: AM1 CMD line out over MQTT / serial, and to the simulated device if it is one. */
  function sendCommand(dst, set) {
    cmdSeq += 1;
    const line = formatAM1('HUB000', 'CMD', cmdSeq, { DST: String(dst).toUpperCase(), ...set });
    const out = [];
    if (sources.mqtt?.connected) { sources.mqtt.publish(line); out.push('mqtt'); }
    if (sources.serial?.open) { sources.serial.write(line); out.push('serial'); }
    let ack = null;
    if (sources.simulator) { ack = sources.simulator.command(dst, set); if (ack) out.push('simulator'); }
    const rec = { ts: new Date().toISOString(), type: 'CMD', id: 'HUB000', n: cmdSeq, raw: line, fields: { DST: String(dst).toUpperCase(), ...set }, rx: { source: 'hub' } };
    ws.broadcast({ type: 'cmd', record: rec, sentTo: out, ack });
    return { line, sentTo: out, ack };
  }
  store.on('node', (node) => ws.broadcast({ type: 'node', node: store.summary(node) }));

  ws.onConnect = (client) => client.send({ type: 'hello', version: VERSION, nodes: store.list(), recent: store.recent.slice(-40), sources: sourceInfo(), hub: hubState() });
  ws.onMessage = (client, msg) => {
    if (msg && msg.type === 'ping') client.send({ type: 'pong', t: Date.now() });
  };

  function sourceInfo() {
    return {
      simulator: sources.simulator ? { stage: cfg.simStage, intervalS: cfg.simIntervalS, simMinute: sources.simulator.simMinute(), weather: sources.simulator.weatherKey, mesh: sources.simulator.mesh } : null,
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
    if (p === '/api/health') return json(res, 200, { ok: true, version: VERSION, uptimeS: Math.round((Date.now() - STARTED) / 1000), nodes: store.nodes.size, packets: store.total, wsClients: ws.size, sources: sourceInfo() });
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
    if (p === '/api/hub' && req.method === 'GET') return json(res, 200, hubState());
    if (p === '/api/command' && req.method === 'POST') {
      let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (!body.dst || !/^[0-9A-Za-z]{4,12}$/.test(body.dst) || typeof body.set !== 'object') return json(res, 400, { error: 'send {"dst":"P1A2B3","set":{"RUN":1}}' });
      const set = {}; for (const [k, v] of Object.entries(body.set)) if (/^[A-Z0-9]{1,8}$/i.test(k) && /^[A-Za-z0-9.\-]{1,12}$/.test(String(v))) set[k.toUpperCase()] = v;
      const r = sendCommand(body.dst, set);
      return json(res, r.sentTo.length ? 200 : 202, r);
    }
    // ---- simulator controls (demo: change weather, fail a node, turn the mesh off)
    if (p.startsWith('/api/sim')) {
      const sim = sources.simulator;
      if (!sim) return json(res, 404, { error: 'simulator is off (SIM=0)' });
      if (p === '/api/sim' && req.method === 'GET') return json(res, 200, sim.state());
      if (req.method !== 'POST') return json(res, 405, { error: 'use POST' });
      let body = {}; try { const t = await readBody(req); body = t ? JSON.parse(t) : {}; } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (p === '/api/sim/weather') { if (!sim.setWeather(body.preset)) return json(res, 400, { error: 'unknown preset', presets: Object.keys(WEATHER) }); }
      else if (p === '/api/sim/mesh') sim.mesh = !!body.on;
      else if (p === '/api/sim/tick') { /* report round now */ }
      else if (p === '/api/sim/crop') { if (!sim.setCrop(body.crop)) return json(res, 400, { error: 'unknown crop or stage < 3' }); }
      else if (p === '/api/sim/auto') { if (!sim.setAuto(body.on)) return json(res, 400, { error: 'stage 3 only' }); }
      else if (p === '/api/sim/pond') { if (!sim.pondEvent(body.event)) return json(res, 400, { error: 'unknown pond event or stage < 3' }); }
      else if (p === '/api/sim/pump') { if (!sim.pumpFault(body.fault)) return json(res, 400, { error: 'stage 3 only' }); }
      else {
        const mm = /^\/api\/sim\/nodes\/([0-9A-Za-z]{4,12})$/.exec(p);
        if (!mm || !sim.setNode(mm[1], body)) return json(res, 404, { error: 'unknown simulator route or node' });
      }
      if (body.now !== false) sim.tick();
      const st = sim.state(); ws.broadcast({ type: 'sim', state: st });
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
    if (p === '/') p = '/index.html';
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
    // a folder path without slash -> redirect so relative CSS/JS links work
    if (/^\/stage-[0-9]-[a-z0-9-]+(\/frontend)?$/.test(url.pathname)) {
      const to = url.pathname.endsWith('/frontend') ? url.pathname + '/' : url.pathname + '/frontend/';
      res.writeHead(302, { Location: to }); return res.end();
    }
    serveStatic(req, res, url);
  });
  ws.attach(server, '/ws');

  async function start() {
    await new Promise((r) => server.listen(cfg.port, cfg.host, r));
    if (cfg.sim) sources.simulator = startSimulator({ stage: cfg.simStage, intervalS: cfg.simIntervalS, ingest });
    sources.mqtt = await startMqtt({ url: cfg.mqttUrl, upTopic: cfg.mqttUpTopic, downTopic: cfg.mqttDownTopic, ingest, log });
    sources.serial = await startSerial({ port: cfg.serialPort, baud: cfg.serialBaud, ingest, log });
    return server.address();
  }
  async function stop() {
    sources.simulator?.stop(); sources.mqtt?.stop?.(); sources.serial?.stop?.();
    for (const c of ws.clients) c.close();
    await new Promise((r) => server.close(r));
  }
  return { server, store, ws, ingest, start, stop, sources, cfg };
}

// run directly: node src/server.js
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.js')) {
  const app = createApp();
  app.start().then(() => {
    const { port } = app.cfg;
    console.log(`\n  BHOOMI digital-twin backend v${VERSION}`);
    console.log(`  Twins:     http://localhost:${port}/`);
    console.log(`  API:       http://localhost:${port}/api/health`);
    console.log(`  WebSocket: ws://localhost:${port}/ws`);
    console.log(`  Simulator: ${app.cfg.sim ? `on (stage ${app.cfg.simStage}, one report every ${app.cfg.simIntervalS} s)` : 'off'}\n`);
  });
  const bye = () => app.stop().then(() => process.exit(0));
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
