// Gateway (layer 2) and cloud (layer 3): the shared modules used by the backend and the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GW, CLOUD } from '../src/farm.js';
import { parseAM1 } from '../src/am1.js';

const pond = (n, f) => parseAM1(`AM1,ID=7C9E2A,T=POND,N=${n},` + f);

test('gateway: registry, duplicates, relay and a new device joining on its own', () => {
  const gw = GW.createGateway();
  gw.process(pond(1, 'DO=6.1,PH=7.9,WT=28,AER=0,AERI=0,BV=4.0,FLT=0'), 1000, { via: '3B41F0' });
  assert.equal(gw.process(pond(1, 'DO=6.1'), 1010, {}).duplicate, true);
  const r = gw.process(parseAM1('AM1,ID=99AB01,T=POND,N=1,DO=7,FLT=0'), 1100, {});
  assert.ok(r.alerts.some((a) => a.code === 'NEWDEV'));
  const ids = gw.summary().devices.map((d) => d.id).sort();
  assert.deepEqual(ids, ['3B41F0', '7C9E2A', '99AB01']);
});

test('gateway: alerts in three languages, SMS for critical, aerator log', () => {
  const gw = GW.createGateway({ lang: 'ta' });
  gw.process(pond(1, 'DO=4.2,AER=0,FLT=0'), 75000, {});
  const r = gw.process(pond(2, 'DO=3.9,AER=1,AERI=6.4,FLT=0'), 75300, {});
  assert.equal(r.alerts[0].code, 'AERON');
  assert.match(r.alerts[0].text.te, /ఏరేటర్/); assert.match(r.alerts[0].text.ta, /ஏரேட்டர்/);
  const c = gw.process(pond(3, 'DO=3.8,AER=1,AERI=0.0,FLT=10'), 75600, {});
  assert.ok(c.alerts[0].channels.includes('sms'));
  assert.equal(gw.summary().smsLog[0].lang, 'ta');
  assert.equal(gw.summary().ponds[0].aerLog.length, 1);
});

test('gateway: internet down -> outbox + SMS fallback, flushed when back', () => {
  const gw = GW.createGateway();
  gw.setOnline(false);
  const r = gw.process(pond(1, 'DO=5,AER=0,FLT=7'), 2000, {});
  assert.equal(r.deliver.length, 0);
  assert.ok(r.alerts[0].channels.includes('sms'), 'warning goes by SMS while offline');
  assert.equal(gw.summary().buffered, 2);
  const flushed = gw.setOnline(true);
  assert.equal(flushed.length, 2); assert.equal(gw.summary().buffered, 0);
});

test('gateway: silent device', () => {
  const gw = GW.createGateway({ silentAfterS: 600 });
  gw.process(pond(1, 'DO=6,FLT=0'), 0, {});
  assert.equal(gw.check(() => 300).alerts.length, 0);
  assert.equal(gw.check(() => 700).alerts[0].code, 'SILENT');
});

test('cloud: trend forecast pushes once when DO will cross 4 mg/L', () => {
  const gw = GW.createGateway(), cl = CLOUD.createCloud();
  let a = null;
  for (let i = 0; i < 12; i++) {                      // 18:00 onwards, falling 0.6 mg/L per hour, every 5 min
    const t = 18 * 3600 + i * 300, d = 6.2 - 0.6 * (i * 300 / 3600);
    gw.process(pond(i + 1, `DO=${d.toFixed(2)},AER=0,FLT=0`), t, {}).deliver.forEach(cl.receive);
    a = cl.checkForecast('pond1', t) || a;
  }
  assert.ok(a, 'forecast pushed'); assert.equal(a.code, 'FORECAST');
  const fc = cl.forecast('pond1', 18 * 3600 + 11 * 300);
  assert.ok(fc.slopeH < -0.5 && fc.slopeH > -0.7);
  assert.equal(cl.checkForecast('pond1', 18 * 3600 + 11 * 300), null, 'only once per episode');
});
