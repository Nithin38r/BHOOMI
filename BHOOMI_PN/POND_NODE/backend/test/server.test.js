import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bhoomi-pond-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const postJ = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('real-hardware path: ingest -> gateway -> cloud -> WebSocket, internet cut and restore', async () => {
  const dir = tmp();
  const app = createApp({ port: 0, host: '127.0.0.1', sim: false, dataDir: dir, log: () => {} });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(base + '/api/health'); assert.equal((await r.json()).ok, true);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const msgs = [];
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (e) => msgs.push(JSON.parse(e.data));

    r = await postJ(base, '/api/ingest', { raw: 'AM1,ID=7C9E2A,T=POND,N=11,DO=2.61,DOS=34,PH=7.2,WT=29.4,AER=1,AERI=0.0,BV=4.03,FLT=10', rssi: -84, via: '3B41F0' });
    assert.equal(r.status, 200);
    r = await fetch(base + '/api/ingest', { method: 'POST', body: 'AM1,ID=7C9E2A,T=POND,N=11,DO=2.61,AER=1,FLT=10' });
    assert.equal((await r.json()).results[0].duplicate, true);
    await wait(900);
    assert.equal(msgs[0].type, 'hello');
    assert.equal(msgs.find((m) => m.type === 'packet').record.pond, 'pond1');
    assert.deepEqual(msgs.filter((m) => m.type === 'notify').map((m) => m.alert.code).sort(), ['DOLOW', 'FLT_PUMP']);
    assert.ok(msgs.some((m) => m.type === 'farm'));

    r = await fetch(base + '/api/farm'); const farm = await r.json();
    assert.equal(farm.gateway.ponds[0].level, 'crit');
    assert.deepEqual(farm.gateway.devices.map((d) => d.id).sort(), ['3B41F0', '7C9E2A']);
    assert.equal(farm.gateway.smsLog.length, 2);

    // internet down: readings wait at the gateway, commands from the app cannot reach the farm
    r = await postJ(base, '/api/link', { online: false }); assert.equal((await r.json()).online, false);
    await fetch(base + '/api/ingest', { method: 'POST', body: 'AM1,ID=7C9E2A,T=POND,N=12,DO=2.9,AER=1,AERI=0.0,FLT=10' });
    r = await fetch(base + '/api/health'); assert.equal((await r.json()).buffered, 1);
    r = await postJ(base, '/api/command', { dst: '3B41F0', set: { AER: 'ON' } }); assert.equal(r.status, 503);
    r = await postJ(base, '/api/link', { online: true }); assert.equal((await r.json()).flushed, 1);

    // command with no gateway radio link: accepted (202) but not delivered anywhere
    r = await postJ(base, '/api/command', { dst: '3B41F0', set: { AER: 'ON' } });
    assert.equal(r.status, 202); assert.equal((await r.json()).line, 'AM1,ID=A10D55,T=CMD,N=1,DST=3B41F0,AER=ON');
    r = await postJ(base, '/api/command', { dst: '3B41F0', set: { 'A;B': 'x,y' } }); assert.equal(r.status, 400);

    r = await fetch(base + '/api/ponds/pond1/history'); assert.equal((await r.json()).history.length, 2);
    // static: app, shared modules; backend source is not served
    r = await fetch(base + '/', { redirect: 'manual' }); assert.equal(r.status, 302);
    r = await fetch(base + '/shared/farm/gateway.cjs'); assert.equal(r.status, 200);
    r = await fetch(base + '/backend/src/server.js'); assert.equal(r.status, 404);
    ws.close();
  } finally { await app.stop(); }
  assert.equal(fs.readFileSync(path.join(dir, 'packets.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('simulator: field + tank on the same models, scenarios, commands with ACK, snapshots', async () => {
  const app = createApp({ port: 0, host: '127.0.0.1', sim: true, simFieldSpeed: 300, dataDir: tmp(), log: () => {} });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const msgs = [];
    ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
    await new Promise((res) => { ws.onopen = res; });
    let r = await postJ(base, '/api/sim/scenario', { dev: 'field', key: 'aerFail' }); assert.equal(r.status, 200);
    r = await postJ(base, '/api/sim/scenario', { dev: 'field', key: 'nope' }); assert.equal(r.status, 400);
    r = await postJ(base, '/api/sim/scenario', { dev: 'moon', key: 'normal' }); assert.equal(r.status, 404);
    await wait(4000);                                       // ~20 simulated minutes on the pond
    assert.ok(msgs.some((m) => m.type === 'twin' && m.id === 'field' && m.snap.bank), 'field snapshots');
    assert.ok(msgs.some((m) => m.type === 'twin' && m.id === 'tank' && m.snap.n), 'tank snapshots');
    assert.ok(msgs.some((m) => m.type === 'radio' && m.route === 'B2K'), 'buoy -> bank radio');
    assert.ok(msgs.some((m) => m.type === 'notify' && m.alert.code === 'FLT_PUMP'), 'aerator failure reaches the app');

    r = await postJ(base, '/api/command', { dst: '3B41F0', set: { AER: 'OFF' } });
    const c = await r.json(); assert.deepEqual(c.sentTo, ['simulator']); assert.match(c.ack, /ID=3B41F0,T=ACK,.*MODE=OFF/);
    r = await postJ(base, '/api/command', { dst: '5D20C7', set: { AER: 'ON' } });
    assert.match((await r.json()).ack, /ID=5D20C7,T=ACK,.*MODE=ON/);
    await wait(600);
    assert.ok(msgs.some((m) => m.type === 'packet' && m.record.type === 'ACK' && m.record.id === '3B41F0'));

    r = await fetch(base + '/api/farm'); const farm = await r.json();
    assert.deepEqual(farm.gateway.ponds.map((p) => p.key).sort(), ['pond1', 'tank']);
    assert.equal(farm.gateway.ponds.find((p) => p.key === 'pond1').mode, 'OFF');
    ws.close();
  } finally { await app.stop(); }
});
