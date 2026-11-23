#!/usr/bin/env node
// Send AM1 packets to a running backend, as if a real gateway heard them (start the backend with SIM=0):
//   node tools/send-packet.js --ok          field buoy, healthy water, aerator off
//   node tools/send-packet.js --low         DO 3.6 mg/L, aerator running (6.4 A)
//   node tools/send-packet.js --pumpfail    aerator ON but 0 A: FLT 10
//   node tools/send-packet.js --probe       DO probe cut at night: FLT 1, aerator ON as failsafe
//   node tools/send-packet.js --tank        prototype tank node 5D20C7
//   node tools/send-packet.js --new         a device the gateway has never seen joins on its own
//   node tools/send-packet.js "AM1,ID=...,T=POND,..."
// Env: BACKEND=http://localhost:8080  INGEST_TOKEN=...
const base = process.env.BACKEND || 'http://localhost:8080';
const n = () => 5000 + Math.floor(Math.random() * 9000);
const buoy = (f) => ({ raw: `AM1,ID=7C9E2A,T=POND,N=${n()},` + f, rssi: -84, via: '3B41F0' });   // relayed by the bank controller
const examples = {
  '--ok': buoy('DO=6.84,DOS=89,PH=8.02,WT=28.4,AER=0,AERI=0.0,BV=4.05,FLT=0'),
  '--low': buoy('DO=3.62,DOS=47,PH=7.38,WT=28.9,AER=1,AERI=6.4,BV=4.01,FLT=0'),
  '--pumpfail': buoy('DO=3.71,DOS=48,PH=7.40,WT=28.9,AER=1,AERI=0.0,BV=4.01,FLT=10,U=1'),
  '--probe': buoy('DO=0.00,DOS=0,PH=7.55,WT=27.6,AER=1,AERI=6.3,BV=3.98,FLT=1'),
  '--tank': { raw: `AM1,ID=5D20C7,T=POND,N=${n()},DO=5.12,DOS=66,PH=7.71,WT=27.9,AER=0,AERI=0.00,BV=5.03,FLT=0`, rssi: -78 },
  '--new': { raw: `AM1,ID=${(0x900000 + Math.floor(Math.random() * 0x6fffff)).toString(16).toUpperCase().slice(0, 6)},T=POND,N=1,DO=7.10,DOS=92,PH=7.95,WT=28.0,AER=0,AERI=0.0,BV=4.10,FLT=0`, rssi: -97 },
};
const arg = process.argv[2];
const item = examples[arg] || (arg && { raw: arg });
if (!item) { console.log('usage: node tools/send-packet.js "<AM1 line>" | ' + Object.keys(examples).join(' | ')); process.exit(1); }
const res = await fetch(base + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BHOOMI-Token': process.env.INGEST_TOKEN || '' }, body: JSON.stringify(item) });
console.log(res.status, await res.text());
