import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAM1, formatAM1 } from '../src/am1.js';

test('parses a POND packet', () => {
  const p = parseAM1('AM1,ID=7C9E2A,T=POND,N=212,DO=5.84,DOS=76,PH=7.62,WT=28.6,AER=0,AERI=0.00,BV=5.04,FLT=0');
  assert.equal(p.type, 'POND'); assert.equal(p.id, '7C9E2A'); assert.equal(p.n, 212);
  assert.equal(p.fields.DO, 5.84); assert.equal(p.fields.AER, 0); assert.equal(p.fields.FLT, 0);
});

test('AER is a number in POND and text in CMD; NA becomes null', () => {
  const c = parseAM1('AM1,ID=A10D55,T=CMD,N=4,DST=7C9E2A,AER=AUTO,LO=4.0');
  assert.equal(c.fields.AER, 'AUTO'); assert.equal(c.fields.DST, '7C9E2A'); assert.equal(c.fields.LO, 4);
  const p = parseAM1('AM1,ID=7C9E2A,T=POND,N=1,DO=NA,PH=7.1');
  assert.equal(p.fields.DO, null);
});

test('ignores text around the packet (hub serial output)', () => {
  const p = parseAM1('RX: AM1,ID=7C9E2A,T=ACK,N=101,OK=1,MODE=ON,AER=1 RSSI -78');
  assert.equal(p.type, 'ACK'); assert.equal(p.fields.MODE, 'ON'); assert.equal(p.fields.OK, 1);
});

test('rejects junk', () => {
  for (const l of ['', 'hello', 'AM1,ID=7C9E2A', 'AM1,ID=x!,T=POND,N=1', null]) assert.equal(parseAM1(l), null);
});

test('formatAM1 round-trips', () => {
  const l = formatAM1('A10D55', 'CMD', 7, { DST: '7C9E2A', AER: 'ON', X: null });
  assert.equal(l, 'AM1,ID=A10D55,T=CMD,N=7,DST=7C9E2A,AER=ON,X=NA');
  assert.equal(parseAM1(l).fields.AER, 'ON');
});
