import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bhoomi-'));

test('REST + WebSocket end to end', async () => {
  const app = createApp({ port: 0, host: '127.0.0.1', sim: false, dataDir: tmp, log: () => {} });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    // health
    let r = await fetch(base + '/api/health'); assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);

    // websocket receives the hello and then a pushed packet
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const msgs = [];
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (e) => msgs.push(JSON.parse(e.data));

    r = await fetch(base + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: 'AM1,ID=7C9E1A,T=SOIL,N=11,M1=41.0,M2=55.2,ST=25.0,AT=30.0,AH=60,LW=0,LX=80,EC=NA,PH=NA,NPK=NA,BV=3.95,HOP=0' });
    assert.equal(r.status, 200);
    // duplicate is accepted but not stored twice
    r = await fetch(base + '/api/ingest', { method: 'POST', body: 'AM1,ID=7C9E1A,T=SOIL,N=11,M1=41.0' });
    assert.equal((await r.json()).results[0].duplicate, true);

    await new Promise((res) => setTimeout(res, 150));
    assert.equal(msgs[0].type, 'hello');
    const pk = msgs.find((m) => m.type === 'packet');
    assert.ok(pk, 'packet pushed over websocket');
    assert.equal(pk.record.fields.M1, 41);

    r = await fetch(base + '/api/nodes'); const nodes = await r.json();
    assert.equal(nodes.length, 1); assert.equal(nodes[0].id, '7C9E1A');
    r = await fetch(base + '/api/nodes/7C9E1A/history'); assert.equal((await r.json()).history.length, 1);

    // static files: frontend allowed, backend source not served
    r = await fetch(base + '/backend/src/server.js'); assert.equal(r.status, 404);
    ws.close();
  } finally { await app.stop(); }
  // JSONL persisted and reloaded
  const lines = fs.readFileSync(path.join(tmp, 'packets.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
});

test('simulator produces valid packets', async () => {
  const { startSimulator } = await import('../src/sources/simulator.js');
  const { parseAM1 } = await import('../src/am1.js');
  const got = [];
  const sim = startSimulator({ stage: 1, intervalS: 3600, ingest: (l, rx) => got.push([parseAM1(l), rx]) });
  for (let i = 0; i < 200; i++) for (const n of sim.fleet) { const p = parseAM1(n.step((i * 0.25) % 24)); assert.ok(p.fields.M1 >= 0 && p.fields.M1 <= 100); }
  sim.stop();
  assert.equal(got.length, 1); assert.equal(got[0][0].type, 'SOIL'); assert.equal(got[0][1].source, 'simulator');
});

test('stage 2: seven-node mesh, routes and simulator controls', async () => {
  const app = createApp({ port: 0, host: '127.0.0.1', sim: true, simStage: 2, simIntervalS: 3600, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bhoomi2-')), log: () => {} });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(base + '/api/nodes'); let nodes = await r.json();
    assert.equal(nodes.length, 7);
    const n3 = nodes.find((n) => n.id === 'B4D7C2');
    assert.ok(n3.rx.hop >= 2, 'far north-east node relays through neighbours');
    assert.equal(n3.rx.path.at(-1), 'HUB');
    // fail N2 and the far corner still reaches the hub on another route
    const before = (await (await fetch(base + '/api/sim')).json()).nodes.find((n) => n.id === 'B4D7C2').route.join('>');
    r = await fetch(base + '/api/sim/nodes/3F21A0', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: false }) });
    const st = await r.json();
    const after = st.nodes.find((n) => n.id === 'B4D7C2').route;
    assert.ok(after && !after.includes('N2'), 'rerouted around the failed node: ' + before + ' -> ' + after.join('>'));
    // mesh off: only nodes in direct range of the hub get through
    r = await fetch(base + '/api/sim/mesh', { method: 'POST', body: JSON.stringify({ on: false }) });
    const direct = (await r.json()).nodes.filter((n) => n.route).map((n) => n.label);
    assert.ok(direct.length <= 3, 'without mesh only near nodes reach the hub: ' + direct);
    r = await fetch(base + '/api/sim/weather', { method: 'POST', body: JSON.stringify({ preset: 'monsoon' }) });
    assert.equal((await r.json()).weather, 'monsoon');
    r = await fetch(base + '/api/sim/weather', { method: 'POST', body: JSON.stringify({ preset: 'snow' }) });
    assert.equal(r.status, 400);
  } finally { await app.stop(); }
});
