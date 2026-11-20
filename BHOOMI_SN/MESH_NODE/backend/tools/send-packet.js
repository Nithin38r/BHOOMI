#!/usr/bin/env node
// Send AM1 packets to a running backend, e.g. to test without hardware:
//   node tools/send-packet.js "AM1,ID=7C9E1A,T=SOIL,N=2001,M1=22.4,M2=40.1,ST=27.0,AT=36.2,AH=31,LW=0,LX=88,EC=NA,PH=NA,NPK=NA,BV=3.91,HOP=0"
//   node tools/send-packet.js --dry          (built-in "dry topsoil" example)
// Env: BACKEND=http://localhost:8080  INGEST_TOKEN=...
const base = process.env.BACKEND || 'http://localhost:8080';
const examples = {
  '--dry': 'AM1,ID=7C9E1A,T=SOIL,N=' + (5000 + Math.floor(Math.random() * 9000)) + ',M1=21.8,M2=38.5,ST=28.1,AT=37.4,AH=29.0,LW=0,LX=91.0,EC=NA,PH=NA,NPK=NA,BV=3.92,HOP=0',
  '--wet': 'AM1,ID=7C9E1A,T=SOIL,N=' + (5000 + Math.floor(Math.random() * 9000)) + ',M1=91.0,M2=86.4,ST=24.0,AT=25.1,AH=96.0,LW=100,LX=12.0,EC=NA,PH=NA,NPK=NA,BV=3.80,HOP=0',
  '--fault': 'AM1,ID=7C9E1A,T=SOIL,N=' + (5000 + Math.floor(Math.random() * 9000)) + ',M1=NA,M2=55.0,ST=NA,AT=30.2,AH=58.0,LW=0,LX=70.0,EC=NA,PH=NA,NPK=NA,BV=3.95,HOP=0',
};
const arg = process.argv[2];
const line = examples[arg] || arg;
if (!line) { console.log('usage: node tools/send-packet.js "<AM1 line>" | --dry | --wet | --fault'); process.exit(1); }
const res = await fetch(base + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-BHOOMI-Token': process.env.INGEST_TOKEN || '' }, body: line });
console.log(res.status, await res.text());
