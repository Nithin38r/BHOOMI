/*
 * BHOOMI Pond Node, prototype tank version: firmware model (pure logic, no DOM).
 * Mirrors BhoomiPondNode.ino v2.1: sampling timers, DO / pH conversion, AUTO aerator rule
 * with hysteresis and minimum ON/OFF times, night failsafe, fault codes 1-11, AM1 packets
 * and hub commands. A simple bucket physics model stands in for the water.
 *
 * Loaded two ways, the same file both times:
 *   - in the browser by <script src=".../pond-model.cjs">: functions become page globals
 *   - in the backend by require(): the simulator runs one model per simulated node
 *
 * Numbers in the physics block are illustrative (tuned so effects show in minutes);
 * real values come from the tank test.
 */
const NODE_ID='5D20C7', HUB_ID='A10D55';
const REAL_T={sampleDay:900,sampleNight:300,minOn:1200,minOff:300,currentCheck:30,trendWindow:1800,mute:1800};
const DEMO_T={sampleDay:20,sampleNight:10,minOn:60,minOff:20,currentCheck:5,trendWindow:120,mute:60};
const CFG={DO_FAST_BELOW:5,DO_ALARM_BELOW:3,DO_TREND_DROP:.15,PUMP_MIN_MA:50,SUPPLY_LOW_V:4.6,DO_MAX_VALID:20,DO_MAX_JUMP:3,DO_RAIL_MV:3200,DO_TEMP_COEF:.03,FALLBACK_WATER_C:28};
const FLT={DO_NOSIGNAL:1,DO_IMPLAUSIBLE:2,DO_STUCK:3,PH_RANGE:4,PH_STUCK:5,TEMP:6,SUPPLY_LOW:7,PUMP_NO_CURRENT:10,DO_FALLING:11};
const FAULT_TEXT={1:'DO probe: no signal (cable / board unplugged)',2:'DO reading implausible (jump or out of range)',3:'DO signal frozen (6 samples, same raw value)',
 4:'pH out of range (probe unplugged)',5:'pH not responding while DO swings (fouled electrode); stays until serviced',6:'Temperature sensor failed, 28 °C used',7:'USB supply below 4.60 V',
 10:'Pump switched ON but INA219 reads under 50 mA',11:'Pump running but DO still falling over the trend window'};
const FAULT_SHORT={0:'OK',1:'DO PROBE?',2:'DO ODD',3:'DO STUCK',4:'PH PROBE?',5:'PH FOULED',6:'TEMP SENS',7:'SUPPLY LOW',10:'PUMP FAIL',11:'DO FALLING'};
const PRI=[11,10,1,2,3,4,5,6,7];
const bit=c=>1<<c;
const DO_BAD=bit(1)|bit(2)|bit(3), SENSOR_MASK=bit(1)|bit(2)|bit(3)|bit(4)|bit(5)|bit(6)|bit(7);
const hooks={tx(){},event(){},alert(){}};
// each model instance may carry its own hooks (the backend runs one per node); the page uses the global ones
function H(S){return S.hooks||hooks}
function topFault(m){for(const c of PRI)if(m&bit(c))return c;return 0}
function hourOf(t){return ((t/3600)%24+24)%24}
function isNight(t){const h=hourOf(t);return h>=18||h<7}
function clock(t){const h=hourOf(t),hh=Math.floor(h),mm=Math.floor((h-hh)*60),ss=Math.floor(((h-hh)*60-mm)*60);return [hh,mm,ss].map(v=>String(v).padStart(2,'0'))}
function fmtSec(s){s=Math.max(0,Math.ceil(s));return s<120?s+' s':Math.ceil(s/60)+' min'}
function gauss(){return (Math.random()+Math.random()+Math.random()-1.5)*0.82}
function doSat(T,S){const K=T+273.15;let ln=-139.34411+1.575701e5/K-6.642308e7/(K*K)+1.2438e10/(K**3)-8.621949e11/(K**4);ln-=S*(0.017674-10.754/K+2140.7/(K*K));return Math.exp(ln)}
const CAL={doV0:0,doVsat:1600,doTcal:25,phV7:1500,phPH7:6.86,phSlope:-177.3,phTcal:25};
const ENV0={demand:.05,amb:29,sal:2,supply:5.05};
const FAULTS0={doDisc:false,doStuck:false,phDisc:false,phFoul:false,tempFail:false,pumpFail:false,stoneClog:false,supplyLow:false,hubDown:false};

function newState(){return{
  t:11*3600, speed:5, running:true, demo:true,
  env:{...ENV0}, faults:{...FAULTS0},
  w:{DO:7.6,T:29,pH:7.7,sat:7.7}, pumpRunning:false,
  sens:{frozenDo:null,phMv:null},
  n:{mode:'AUTO',pumpOn:false,lastChange:0,onAt:0,pumpMa:0,supplyV:5.05,R:{doMv:0,phMv:0,wt:0,wtOk:true,doMgL:0,doSat:0,ph:0},
     hist:[],faultMask:0,haveSample:false,doInvalid:true,lastGoodDO:8,nextSample:0,decision:'–',holdText:'',dl:[],seq:0,
     muteUntil:-1,lastSentMask:0,lo:4,hi:6,cmdN:100,resp:null,pendingLow:null},
  hub:{rx:0,lost:0,alerts:0},
  chart:[],nextChart:0,prevAlertMask:0
}}
function T_(S){return S.demo?DEMO_T:REAL_T}

// ---------- physics: bucket ----------
function physics(S,dt){
  const m=dt/60, e=S.env, w=S.w;
  w.T+=((e.amb-0.6)-w.T)*Math.min(1,dt/(40*60));
  w.sat=doSat(w.T,e.sal);
  const supply=S.faults.supplyLow?4.45:e.supply;
  S.pumpRunning=S.n.pumpOn&&!S.faults.pumpFail&&supply>4.2;
  const kla=S.pumpRunning?(S.faults.stoneClog?0.1:0.9):0;
  const dDO=(0.05+kla)*(w.sat-w.DO)-e.demand*Math.pow(1.07,w.T-28);
  w.DO=Math.max(0.02,Math.min(18,w.DO+dDO*m));
  const pht=7.25+0.55*Math.min(w.DO/w.sat,1.3)+(S.pumpRunning?0.1:0)-0.15*Math.min(e.demand,1);
  w.pH+=(pht-w.pH)*Math.min(1,dt/600);
}
// ---------- what the hardware would read ----------
function rawSensors(S){
  const f=S.faults,w=S.w,s=S.sens,r={};
  r.wtRaw=f.tempFail?-127:w.T+gauss()*0.03;
  const span=(CAL.doVsat-CAL.doV0)*(1+CFG.DO_TEMP_COEF*(w.T-CAL.doTcal));
  if(f.doDisc){r.doMv=Math.abs(gauss()*0.05)}
  else if(f.doStuck){if(s.frozenDo==null)s.frozenDo=+(CAL.doV0+span*w.DO/w.sat).toFixed(3);r.doMv=s.frozenDo}
  else{s.frozenDo=null;r.doMv=CAL.doV0+span*w.DO/w.sat+gauss()*0.35}
  const phTrue=CAL.phV7+CAL.phSlope*(w.T+273.15)/(CAL.phTcal+273.15)*(w.pH-CAL.phPH7);
  if(f.phDisc){r.phMv=2900+gauss()*3;s.phMv=null}
  else if(f.phFoul){if(s.phMv==null)s.phMv=phTrue;s.phMv+=(phTrue+40-s.phMv)*0.0005;r.phMv=s.phMv+gauss()*0.02}
  else{s.phMv=null;r.phMv=phTrue+gauss()*0.3}
  return r;
}
function readPump(S){
  const supply=S.faults.supplyLow?4.45:S.env.supply;
  S.n.pumpMa=S.pumpRunning?Math.max(0,(S.faults.stoneClog?300:280)*(supply/5)+gauss()*4):0;
  S.n.supplyV=supply-(S.pumpRunning?0.05:0)+gauss()*0.005;
}
function readSensors(S){
  const raw=rawSensors(S),R={};
  const t=raw.wtRaw; R.wtOk=!(t<-5||t>50); R.wt=R.wtOk?t:-127; const tc=R.wtOk?t:CFG.FALLBACK_WATER_C;
  R.doMv=raw.doMv; R.phMv=raw.phMv;
  const span=(CAL.doVsat-CAL.doV0)*(1+CFG.DO_TEMP_COEF*(tc-CAL.doTcal));
  let frac=span>1?(R.doMv-CAL.doV0)/span:0; if(frac<0)frac=0;
  R.doSat=frac*100; R.doMgL=frac*doSat(tc,S.env.sal);
  const slopeT=CAL.phSlope*(tc+273.15)/(CAL.phTcal+273.15);
  R.ph=CAL.phPH7+(R.phMv-CAL.phV7)/slopeT;
  return R;
}
function sensorFaults(S){
  const n=S.n,R=n.R,h=n.hist; let m=0;
  if(!R.wtOk)m|=bit(6);
  const noSig=Math.max(0.5,0.5*CAL.doV0);
  if(R.doMv<noSig)m|=bit(1);
  else{
    let jump=false;
    if(h.length>=2){const a=h[h.length-2],b=h[h.length-1];jump=a.DO>0.5&&Math.abs(R.doMgL-a.DO)>CFG.DO_MAX_JUMP&&(b.t-a.t)<=1200}
    if(R.doMgL>CFG.DO_MAX_VALID||R.doMv>=CFG.DO_RAIL_MV||jump)m|=bit(2);
    if(h.length>=6){const l=h.slice(-6).map(x=>x.doMv);if(Math.max(...l)-Math.min(...l)<0.13)m|=bit(3)}
  }
  if(R.ph<2||R.ph>12)m|=bit(4);
  else if(h.length>=10){const l=h.slice(-10);const p=l.map(x=>x.phMv),d=l.map(x=>x.DO);
    if(Math.max(...p)-Math.min(...p)<0.5&&Math.max(...d)-Math.min(...d)>1.0)m|=bit(5)}
  if(n.supplyV>1&&n.supplyV<CFG.SUPPLY_LOW_V)m|=bit(7);
  return m;
}
function packet(S){const n=S.n,R=n.R;
  return `AM1,ID=${S.id||NODE_ID},T=POND,N=${n.seq},DO=${R.doMgL.toFixed(2)},DOS=${R.doSat.toFixed(0)},PH=${R.ph.toFixed(2)},WT=${R.wt.toFixed(1)},AER=${n.pumpOn?1:0},AERI=${(n.pumpMa/1000).toFixed(2)},BV=${n.supplyV.toFixed(2)},FLT=${topFault(n.faultMask)}`}
function sendPond(S,why){
  const n=S.n;n.seq++;
  const ok=!S.faults.hubDown; if(ok)S.hub.rx++;else S.hub.lost++;
  H(S).tx('N2H',packet(S),ok,why);
  n.lastSentMask=n.faultMask;
  // hub rules: alert on new fault codes or low DO
  const newCodes=PRI.filter(c=>(n.faultMask&bit(c))&&!(S.prevAlertMask&bit(c)));
  if(ok){newCodes.forEach(c=>{S.hub.alerts++;H(S).alert(`BHOOMI Pond Node ALERT FLT=${c}: ${FAULT_TEXT[c]}`)})}
  if(ok)S.prevAlertMask=n.faultMask;
}
function setPump(S,on){
  const n=S.n;n.pumpOn=on;n.lastChange=S.t;
  if(on){n.onAt=S.t;n.dl=[];if(n.haveSample&&!n.doInvalid)n.dl.push([S.t,n.R.doMgL]);
    if(n.mode==='AUTO'&&n.pendingLow!=null){n.resp={low:n.pendingLow,on:S.t,cur:null}}}
  else n.faultMask&=~(bit(10)|bit(11));
  n.pendingLow=null;
  H(S).event(`${clock(S.t).slice(0,2).join(':')} PUMP ${on?'ON':'OFF'} · ${n.decision}`,'ev');
  sendPond(S,'pump change');
}
function checkTrend(S){
  const n=S.n,T=T_(S);
  if(!n.pumpOn||S.t-n.onAt<T.trendWindow||n.dl.length<2)return;
  if(n.pumpMa<CFG.PUMP_MIN_MA)return;
  let ref=null;for(let i=n.dl.length-1;i>=0;i--)if(S.t-n.dl[i][0]>=T.trendWindow){ref=n.dl[i];break}
  if(ref&&n.R.doMgL<ref[1]-CFG.DO_TREND_DROP)n.faultMask|=bit(11);
}
function control(S){
  const n=S.n,T=T_(S),R=n.R;let want=n.pumpOn;
  if(n.mode==='ON'){want=true;n.decision='Manual ON'}
  else if(n.mode==='OFF'){want=false;n.decision='Manual OFF'}
  else if(!n.haveSample)n.decision='Waiting for first sample';
  else if(n.doInvalid){if(isNight(S.t)){want=true;n.decision='Failsafe: no valid DO at night → pump ON'}else n.decision='Failsafe: no valid DO, daytime → hold'}
  else if(R.doMgL<n.lo){want=true;n.decision=`DO ${R.doMgL.toFixed(2)} < ${n.lo.toFixed(1)} → ON`}
  else if(R.doMgL>n.hi){want=false;n.decision=`DO ${R.doMgL.toFixed(2)} > ${n.hi.toFixed(1)} → OFF`}
  else n.decision=`DO ${R.doMgL.toFixed(2)} in band → hold`;
  n.holdText='';
  if(want!==n.pumpOn){const el=S.t-n.lastChange;
    if(n.pumpOn&&el<T.minOn)n.holdText='min ON '+fmtSec(T.minOn-el);
    else if(!n.pumpOn&&el<T.minOff)n.holdText='min OFF '+fmtSec(T.minOff-el);
    else setPump(S,want)}
  if(n.pumpOn&&S.t-n.onAt>T.currentCheck){if(n.pumpMa<CFG.PUMP_MIN_MA)n.faultMask|=bit(10);else n.faultMask&=~bit(10)}
  if(n.resp&&n.resp.cur==null&&n.pumpMa>CFG.PUMP_MIN_MA)n.resp.cur=S.t;
  checkTrend(S);
}
function nextInterval(S){const T=T_(S);if(S.n.lastGoodDO<CFG.DO_FAST_BELOW)return T.sampleNight;if(isNight(S.t))return T.sampleNight;return T.sampleDay}
function takeSample(S){
  const n=S.n;
  n.R=readSensors(S);readPump(S);
  n.hist.push({t:S.t,DO:n.R.doMgL,doMv:n.R.doMv,phMv:n.R.phMv});if(n.hist.length>10)n.hist.shift();
  const keep=n.faultMask&(bit(10)|bit(11)|bit(5));   // FLT 5 latches until the probe is serviced
  n.faultMask=sensorFaults(S)|keep;
  n.doInvalid=(n.faultMask&DO_BAD)!==0;
  if(!n.doInvalid){n.lastGoodDO=n.R.doMgL;if(n.pumpOn)n.dl.push([S.t,n.R.doMgL]);if(n.dl.length>24)n.dl.shift();
    if(n.R.doMgL<n.lo&&!n.pumpOn&&n.pendingLow==null&&n.mode==='AUTO')n.pendingLow=S.t}
  n.haveSample=true;
  control(S);
  sendPond(S,'sample');
  n.nextSample=S.t+nextInterval(S);
}
function step(S,dt){
  physics(S,dt);S.t+=dt;
  if(S.t>=S.n.nextSample)takeSample(S);
  readPump(S);
  const before=S.n.faultMask;
  control(S);
  if((S.n.faultMask&~before)&~SENSOR_MASK)sendPond(S,'new pump fault');
}
function advance(S,secs){while(secs>0){const dt=Math.min(1,secs);secs-=dt;step(S,dt);
  if(S.t>=S.nextChart){S.nextChart=S.t+(S.demo?2:60);
    S.chart.push({t:S.t,DO:S.w.DO,sat:S.w.sat,pH:S.w.pH,pump:S.n.pumpOn?(S.pumpRunning?1:2):0});
    const win=S.demo?600:86400;while(S.chart.length&&S.t-S.chart[0].t>win)S.chart.shift()}}}
function alarmActive(S){const n=S.n;if(n.faultMask&(bit(10)|bit(11)))return true;return n.haveSample&&!n.doInvalid&&n.R.doMgL<CFG.DO_ALARM_BELOW}
function pressShort(S){const n=S.n;n.mode=n.mode==='AUTO'?'ON':n.mode==='ON'?'OFF':'AUTO';H(S).event(`Button: mode ${n.mode}`,'ok');control(S)}
function pressLong(S){S.n.muteUntil=S.t+T_(S).mute;H(S).event('Button held 2 s: alarm muted','ok')}
function setDemo(S,on){S.demo=on;S.n.nextSample=S.t+2;S.chart=[];H(S).event(`Timers: ${on?'DEMO (short)':'REAL pond'}`,'ok')}
function handleCommand(S,fields){
  const n=S.n;let ok=true,extra='';
  if(fields.AER){if(['ON','OFF','AUTO'].includes(fields.AER))n.mode=fields.AER;else{ok=false;extra+=',ERR=AER'}control(S)}
  if(fields.LO!=null||fields.HI!=null){const lo=fields.LO??n.lo,hi=fields.HI??n.hi;
    if(lo>=2&&hi<=9&&hi-lo>=.5){n.lo=lo;n.hi=hi;extra+=`,LO=${lo.toFixed(1)},HI=${hi.toFixed(1)}`}else{ok=false;extra+=',ERR=RANGE'}}
  return `AM1,ID=${S.id||NODE_ID},T=ACK,N=${S.n.cmdN},OK=${ok?1:0},MODE=${n.mode},AER=${n.pumpOn?1:0}${extra}${n.holdText?',HOLD=1':''}`;
}

const SCENARIOS={
  normal:{name:'Normal: clean water, daytime',desc:'Low O₂ demand. DO stays high, pump off, samples every 20 s (15 min on real timers).',h:11,DO:7.6,env:{}},
  lowdo:{name:'Low DO: pump starts by itself',desc:'High O₂ demand (yeast + sugar). DO falls below 4 → pump ON, above 6 → OFF after its 60 s minimum.',h:11,DO:5.4,env:{demand:.9}},
  night:{name:'Night with fish load',desc:'After 18:00 the node samples every 10 s (5 min real) and keeps cycling the pump.',h:19.5,DO:5.2,env:{demand:.6,amb:27}},
  pumpFail:{name:'Pump failure (unplugged)',desc:'Relay clicks ON but INA219 sees 0 mA → FLT 10, buzzer, alert to the hub.',h:11,DO:4.3,env:{demand:.9},faults:{pumpFail:true}},
  clog:{name:'Air stone clogged',desc:'Pump draws normal current but bubbles are weak. DO keeps falling for the trend window → FLT 11.',h:11,DO:4.2,env:{demand:.9},faults:{stoneClog:true}},
  doNight:{name:'DO probe unplugged at night',desc:'FLT 1. With no valid DO at night the node runs the pump as a failsafe.',h:21,DO:6.2,env:{demand:.4,amb:27},faults:{doDisc:true}},
  doDay:{name:'DO probe unplugged in daytime',desc:'FLT 1. In daylight the node holds the pump state and alerts the farmer.',h:12,DO:6.4,env:{demand:.2},faults:{doDisc:true}},
  phFoul:{name:'pH probe fouled',desc:'pH stops moving while DO swings by more than 1 mg/L → FLT 5 (clean the electrode).',h:11,DO:5.2,env:{demand:.9},faults:{phFoul:true}},
  temp:{name:'Temperature sensor failed',desc:'DS18B20 reads −127 °C → FLT 6. DO compensation falls back to 28 °C.',h:11,DO:7.2,env:{amb:33},faults:{tempFail:true}},
  supply:{name:'Power bank running flat',desc:'USB supply sags under 4.60 V → FLT 7.',h:11,DO:7.4,env:{},faults:{supplyLow:true}},
  hub:{name:'Gateway (hub) offline',desc:'Packets are lost, but the pump rule keeps running on the node itself.',h:11,DO:5.0,env:{demand:.9},faults:{hubDown:true}},
  hot:{name:'Hot afternoon (34 °C)',desc:'Warm water holds less oxygen: 100 % saturation is only about 7.1 mg/L.',h:15,DO:6.6,env:{amb:34.5,demand:.45}},
};
function loadScenario(S,key){
  const sc=SCENARIOS[key];
  S.env={...ENV0,...sc.env};S.faults={...FAULTS0,...(sc.faults||{})};
  const day=Math.floor(S.t/86400);S.t=day*86400+sc.h*3600;
  S.w.T=S.env.amb-0.6;S.w.sat=doSat(S.w.T,S.env.sal);S.w.DO=sc.DO;S.w.pH=7.25+0.55*Math.min(sc.DO/S.w.sat,1.3)-0.15*Math.min(S.env.demand,1);
  S.sens={frozenDo:null,phMv:null};
  const n=S.n;Object.assign(n,{mode:'AUTO',pumpOn:false,lastChange:S.t-600,onAt:0,hist:[],faultMask:0,haveSample:false,doInvalid:true,lastGoodDO:sc.DO,
    nextSample:S.t+3,decision:'Waiting for first sample',holdText:'',dl:[],muteUntil:-1,resp:null,pendingLow:null});
  S.pumpRunning=false;S.chart=[];S.nextChart=S.t;S.prevAlertMask=0;
  H(S).event(`Scenario: ${sc.name}`,'ok');
}

if (typeof module === 'object' && module.exports) {
  module.exports = { NODE_ID, HUB_ID, REAL_T, DEMO_T, CFG, FLT, FAULT_TEXT, FAULT_SHORT, PRI, bit, CAL, ENV0, FAULTS0, SCENARIOS,
    topFault, hourOf, isNight, clock, doSat, newState, T_, physics, readSensors, sendPond, setPump, control, takeSample,
    step, advance, alarmActive, pressShort, pressLong, setDemo, handleCommand, loadScenario, packet, hooks };
}
