// Field pond model (buoy + bank controller), shared by the 3D view and the simulator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FM } from '../src/sources/simulator.js';

function run(scenario, secs) {
  const S = FM.newState(); const tx = [], ev = [];
  S.hooks = { tx: (r, t, ok) => tx.push({ r, t, ok }), event: (m) => ev.push(m), sms() {}, sample() {} };
  S.t = 17 * 3600; FM.loadScenario(S, scenario); FM.advance(S, secs);
  return { S, tx, ev, hub: tx.filter((x) => (x.r === 'K2H' || x.r === 'B2H') && x.t.includes('T=POND')) };
}

test('field: night crash -> bank switches the aerator ON by itself below 4 mg/L', () => {
  const { S, ev } = run('crash', 3600);
  assert.ok(ev.some((e) => /Contactor ON/.test(e)));
  assert.equal(S.bank.relay, true);
});

test('field: motor tripped -> FLT 10 urgent packet', () => {
  const { hub } = run('aerFail', 3600);
  assert.ok(hub.some((x) => /FLT=10/.test(x.t) && /U=1/.test(x.t)));
});

test('field: bank controller dead -> buoy sends straight to the hub with FLT 21', () => {
  const { hub } = run('bankDown', 3600);
  assert.ok(hub.some((x) => x.r === 'B2H' && /FLT=21/.test(x.t)));
});

test('field: buoy silent at night -> bank runs the aerator as failsafe (FLT 20)', () => {
  const { S } = run('buoyDead', 3 * 3600);
  assert.ok(S.bank.codes.includes(20)); assert.equal(S.bank.relay, true);
});

test('field: fouled pH probe is caught; a healthy night does not raise FLT 5', () => {
  const foul = run('phFoul', 3 * 3600);
  assert.ok(foul.hub.some((x) => /FLT=5/.test(x.t)), 'fouled probe flagged');
  for (let i = 0; i < 8; i++) {
    const ok = run('crash', 8 * 3600);
    assert.ok(!ok.hub.some((x) => /FLT=5/.test(x.t)), 'no false pH alarm during a crash night');
  }
});
