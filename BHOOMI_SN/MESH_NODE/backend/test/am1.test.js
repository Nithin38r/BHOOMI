import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAM1, formatAM1 } from '../src/am1.js';

test('parses a soil packet with NA fields', () => {
  const p = parseAM1('AM1,ID=7C9E1A,T=SOIL,N=1038,M1=46.2,M2=57.1,ST=NA,AT=29.1,AH=61.0,LW=0,LX=72.5,EC=NA,PH=NA,NPK=NA,BV=3.98,HOP=0');
  assert.equal(p.id, '7C9E1A'); assert.equal(p.type, 'SOIL'); assert.equal(p.n, 1038);
  assert.equal(p.fields.M1, 46.2); assert.equal(p.fields.ST, null); assert.equal(p.fields.HOP, 0); assert.equal(p.fields.BV, 3.98);
});
test('finds the packet inside a hub serial line', () => {
  const p = parseAM1('RX [433] AM1,ID=a1b2c3,T=SOIL,N=7,M1=30 RSSI -96 SNR 7.5');
  assert.equal(p.id, 'A1B2C3'); assert.equal(p.fields.M1, 30);
});
test('rejects junk', () => {
  assert.equal(parseAM1('hello'), null);
  assert.equal(parseAM1('AM1,T=SOIL'), null);
  assert.equal(parseAM1('AM1,ID=ZZ!,T=SOIL'), null);
  assert.equal(parseAM1('AM1,ID=P1A2B3,T=PUMP,N=1,RUN=1').id, 'P1A2B3');
});
test('format round-trips', () => {
  const line = formatAM1('7C9E1A', 'SOIL', 5, { M1: 40.5, ST: null, BV: '3.90' });
  assert.equal(line, 'AM1,ID=7C9E1A,T=SOIL,N=5,M1=40.5,ST=NA,BV=3.90');
  assert.deepEqual(parseAM1(line).fields, { M1: 40.5, ST: null, BV: 3.9 });
});
test('numbers vs text fields', () => {
  const p = parseAM1('AM1,ID=T4C5D6,T=TANK,N=3,LV=77,Q=50,P=1.60,VLV=011,LIT=11625');
  assert.equal(p.fields.LV, 77); assert.equal(p.fields.P, 1.6); assert.equal(p.fields.VLV, '011');
  assert.equal(parseAM1('AM1,ID=P1A2B3,T=PUMP,N=1,RUN=1,PHASE=OK').fields.RUN, 1);
});
