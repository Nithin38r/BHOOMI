// The firmware model shared by the twin and the backend simulator (shared/model/pond-model.cjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TM as M } from '../src/sources/simulator.js';

function run(scenario, secs, setup) {
  const S = M.newState(); S.id = 'TEST01'; const tx = [], ev = [];
  S.hooks = { tx: (r, t, ok) => tx.push({ t, ok }), event: (m) => ev.push(m), alert() {} };
  M.loadScenario(S, scenario); if (setup) setup(S); M.advance(S, secs);
  return { S, tx, ev };
}
const last = (tx) => M.packet ? tx.filter((x) => x.t.includes('T=POND')).at(-1).t : '';

test('tank: AUTO: low DO switches the aerator on, then off above 6 after the minimum ON time', () => {
  const { S, ev } = run('lowdo', 600);
  assert.ok(ev.some((e) => /PUMP ON/.test(e)), 'pump came on');
  assert.ok(ev.some((e) => /PUMP OFF/.test(e)), 'pump went off again');
  assert.equal(S.n.mode, 'AUTO');
});

test('tank: FLT 10: relay on but no current', () => {
  const { S, tx } = run('pumpFail', 120);
  assert.ok(S.n.faultMask & M.bit(10));
  assert.match(last(tx), /FLT=10/);
});

test('tank: night failsafe: DO probe unplugged at night runs the aerator', () => {
  const { S } = run('doNight', 60);
  assert.ok(S.n.faultMask & M.bit(1)); assert.equal(S.n.pumpOn, true);
});

test('tank: daytime: DO probe unplugged holds the aerator state', () => {
  const { S } = run('doDay', 60);
  assert.ok(S.n.faultMask & M.bit(1)); assert.equal(S.n.pumpOn, false);
});

test('tank: hub offline: packets are lost but the rule still runs on the node', () => {
  const { S, tx } = run('hub', 600);
  assert.ok(tx.length > 0 && tx.every((x) => !x.ok));
  assert.ok(S.hub.lost > 0 && S.hub.rx === 0);
});

test('tank: commands: AER=ON gives an ACK, bad thresholds are refused', () => {
  const { S } = run('normal', 30);
  assert.match(M.handleCommand(S, { AER: 'ON' }), /T=ACK,.*OK=1,MODE=ON/);
  assert.match(M.handleCommand(S, { LO: 5, HI: 5.2 }), /OK=0.*ERR=RANGE/);
  assert.match(M.handleCommand(S, { LO: 3.5, HI: 6.5 }), /OK=1.*LO=3.5,HI=6.5/);
});
