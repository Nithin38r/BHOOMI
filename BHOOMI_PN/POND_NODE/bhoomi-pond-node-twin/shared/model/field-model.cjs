/*
 * BHOOMI Pond Node, field pond version: firmware model (pure logic, no DOM).
 * Two devices on one pond, as in PondBuoy.ino + PondBank.ino:
 *   - the floating solar BUOY (ID 7C9E2A): wakes, samples DO / pH / temperature, sends T=POND to the bank,
 *     adapts its interval (15 min day, 5 min night or DO < 5, 30 min on low battery), flags faults 1-7 and 21;
 *   - the BANK controller (ID 3B41F0): mains-powered, decides the paddle-wheel aerator (AUTO ON < 4.0, OFF > 6.0 mg/L,
 *     min ON 20 min / OFF 5 min, night failsafe), checks motor current (FLT 10), DO still falling (FLT 11),
 *     buoy silent (FLT 20), and relays every reading to the hub.
 * A simple pond physics model (sun, plankton, fish respiration, rain, aerator) stands in for the water.
 *
 * Loaded by the field-pond 3D view with <script> and by the backend simulator with require().
 */
const HOUR=3600, MIN=60;
const IDS={buoy:'7C9E2A',bank:'3B41F0',hub:'A10D55'};
const hooks={tx(){},event(){},sms(){},sample(){}};
// each model instance may carry its own hooks (the backend runs it); the page uses the global ones
function H(S){return S.hooks||hooks}
function hourOf(t){return ((t/3600)%24+24)%24}
function isNight(h){return h>=18||h<7}
function fmtClock(t){const d=Math.floor(t/86400)+1,h=hourOf(t),hh=Math.floor(h),mm=Math.floor((h-hh)*60);return {d,s:String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')}}
function fmtDur(s){s=Math.max(0,Math.round(s));if(s<60)return s+' s';const m=Math.floor(s/60),r=s%60;if(m<60)return m+' min'+(r?' '+r+' s':'');return Math.floor(m/60)+' h '+(m%60)+' min'}
function doSat(T,S){const K=T+273.15;let ln=-139.34411+1.575701e5/K-6.642308e7/(K*K)+1.2438e10/(K**3)-8.621949e11/(K**4);
  ln-=S*(0.017674-10.754/K+2140.7/(K*K));return Math.exp(ln)}
function gauss(){return (Math.random()+Math.random()+Math.random()-1.5)*0.8}
function Ttarget(S,h){return 28.6+2.0*Math.sin(2*Math.PI*(h-9)/24)-2.4*S.env.rain}

const FAULT_TEXT={0:'All OK',1:'DO probe: no signal (cable cut / disconnected)',2:'DO reading implausible (jump or out of range)',3:'DO reading stuck (same value 6 samples)',
 4:'pH out of range / probe disconnected',5:'pH not responding (fouled electrode)',6:'Temperature sensor failed (−127 °C)',7:'Buoy battery low (< 3.40 V)',
 10:'Aerator commanded ON but motor current ≈ 0 A',11:'Aerator ON but DO still falling for 30 min',20:'Buoy silent > 35 min (bank failsafe active)',21:'Bank controller not answering (buoy sends direct to hub)'};
const PRI=[11,10,21,20,1,2,3,4,5,6,7];
function topFault(codes){for(const c of PRI)if(codes.includes(c))return c;return 0}

const ENV_DEFAULT={cloud:.15,algae:.8,biomass:.8,sal:2,rain:0};
const FAULTS_DEFAULT={doDisc:false,doStuck:false,phDisc:false,phFoul:false,tempFail:false,aerMotorFail:false,aerWeak:false,hubDown:false,bankDown:false,buoyDead:false,panelDead:false};

function newState(){return{
  t:16*HOUR+40*MIN, speed:60, running:true,
  env:{...ENV_DEFAULT}, faults:{...FAULTS_DEFAULT},
  w:{DO:8.4,T:30.0,pH:8.1,sat:7.6}, light:0,sun:0,
  cfg:{lo:4.0,hi:6.0,minOn:20*MIN,minOff:5*MIN},
  aerRunning:false,
  buoy:{state:'SLEEP',stateUntil:0,nextWake:16*HOUR+41*MIN,seq:0,mAh:4900,cap:6000,hist:[],lastDO:8.4,codes:[],flt:0,noAck:0,
        phSensor:8.1,stuckDO:null,interval:900,why:'Day · 15 min',last:null,lastAER:0,lastAERI:0,rssi:-61,pending:null},
  bank:{mode:'AUTO',relay:false,lastChange:-1e9,current:0,lastRx:16*HOUR+40*MIN,lastDO:8.4,doInvalid:false,codes:[],reason:'–',hold:'',
        onAt:0,doLog:[],resp:null,pendingDOlow:null},
  hub:{queue:0,sms:0,rx:0},
  hist:[],nextHist:0, cmdN:100, prevAlert:[]
}}

function physicsStep(S,dt){
  const h=hourOf(S.t);
  S.sun=Math.max(0,Math.sin(Math.PI*(h-6)/12));
  S.light=S.sun*(1-0.8*S.env.cloud);
  S.w.T+=(Ttarget(S,h)-S.w.T)*Math.min(1,dt/(1.5*HOUR));
  const sat=doSat(S.w.T,S.env.sal); S.w.sat=sat;
  const P=1.5*S.env.algae*S.light*(1-0.5*S.env.rain);
  const R=(0.25*S.env.biomass+0.25*S.env.algae)*Math.pow(1.07,S.w.T-28);
  const re=(0.06+0.12*S.env.rain)*(sat-S.w.DO);
  let a=0; if(S.aerRunning) a=(S.faults.aerWeak?0.3:3.0)*Math.max(0,sat-S.w.DO)/sat;
  S.w.DO=Math.min(20,Math.max(0.05,S.w.DO+(P-R+re+a)*dt/HOUR));
  const pt=6.6+1.6*Math.min(S.w.DO/sat,1.7)-0.45*S.env.rain;
  // pH follows photosynthesis, respiration and aeration closely (the same CO2 balance as DO), lag about 10 min
  S.w.pH+=(pt-S.w.pH)*Math.min(1,dt/(10*MIN));
  // battery: 0.15 mA sleep, solar charge
  const B=S.buoy;
  if(!S.faults.buoyDead){
    const chg=S.faults.panelDead?0:5*S.light*0.7/4.0*1000; // mA
    B.mAh=Math.min(B.cap,Math.max(0,B.mAh+(chg-0.15)*dt/HOUR));
  }
}
function battV(B){const soc=B.mAh/B.cap;return 3.30+0.90*soc}

function readSensors(S){
  const f=S.faults,B=S.buoy,r={};
  r.WT=f.tempFail?-127:S.w.T+gauss()*0.05;
  const Tc=r.WT<-50?28:r.WT;
  if(f.doDisc){r.DO=0;r.raw=0.2}
  else if(f.doStuck){if(B.stuckDO==null)B.stuckDO=+(B.lastDO??S.w.DO).toFixed(2);r.DO=B.stuckDO;r.raw=r.DO*5.4}
  else{B.stuckDO=null;
    // temp compensation error if temp sensor dead
    const k=f.tempFail?doSat(28,S.env.sal)/doSat(S.w.T,S.env.sal):1;
    r.DO=Math.max(0,S.w.DO*k+gauss()*0.04); r.raw=r.DO*5.4+2}
  r.DOS=r.DO/doSat(Tc,S.env.sal)*100;
  if(f.phDisc){r.PH=1.2+Math.random()*0.3}
  else if(f.phFoul){B.phSensor+=(S.w.pH-0.35-B.phSensor)*0.004;r.PH=B.phSensor+gauss()*0.002}
  else{B.phSensor=S.w.pH+gauss()*0.02;r.PH=B.phSensor}
  r.BV=battV(B);
  return r;
}
function detectBuoyFaults(S,r){
  const c=[],h=S.buoy.hist;
  if(r.WT<-50||r.WT>50)c.push(6);
  const prev=h.length>1?h[h.length-2]:null;
  if(r.raw<1)c.push(1);
  else if(r.DO>20||(prev&&prev.DO>0.5&&Math.abs(r.DO-prev.DO)>3&&S.t-prev.t<=20*MIN))c.push(2);
  if(h.length>=6){const l=h.slice(-6);if(l.every(x=>Math.abs(x.DO-l[0].DO)<0.005)&&r.raw>=1)c.push(3)}
  if(r.PH<2||r.PH>12)c.push(4);
  else if(h.length>=10){const l=h.slice(-10),ph=l.map(x=>x.PH),dd=l.map(x=>x.DO);
    if(Math.max(...ph)-Math.min(...ph)<0.02&&Math.max(...dd)-Math.min(...dd)>0.3)c.push(5)}
  if(r.BV<3.40)c.push(7);
  return c;
}
function buoyInterval(S){
  const B=S.buoy,h=hourOf(S.t);
  if(B.lastDO!=null&&B.lastDO<5)return[300,'DO < 5 mg/L → every 5 min'];
  if(B.codes.includes(7))return[1800,'Battery saver → every 30 min'];
  if(isNight(h))return[300,'Night mode → every 5 min'];
  return[900,'Daytime → every 15 min'];
}
function pondPacket(seq,r,aer,aeri,bv,flt){
  return `AM1,ID=${IDS.buoy},T=POND,N=${seq},DO=${r.DO.toFixed(2)},DOS=${r.DOS.toFixed(0)},PH=${r.PH.toFixed(2)},WT=${r.WT.toFixed(1)},AER=${aer},AERI=${aeri.toFixed(1)},BV=${bv.toFixed(2)},FLT=${flt}`}

function alertCheck(S,codes,ctx){
  const prev=S.prevAlert;
  for(const c of codes){ if(!prev.includes(c)){
    H(S).event(`FLT ${c}: ${FAULT_TEXT[c]}`,'bad');
    smsOut(S,`Pond 1 ALERT FLT=${c}: ${FAULT_TEXT[c]}. DO ${ctx.DO!=null?ctx.DO.toFixed(1):'–'} mg/L.`,ctx.direct);
  }}
  S.prevAlert=codes.slice();
}
function smsOut(S,text,direct){
  if(S.faults.hubDown){S.hub.queue++;H(S).sms(text,'queued');return}
  S.hub.sms++;H(S).sms(text,'sent');
}

function buoySample(S){
  const B=S.buoy;
  if(S.faults.buoyDead){B.state='OFF';B.nextWake=S.t+300;return}
  B.seq++;
  const r=readSensors(S);
  B.hist.push({t:S.t,DO:r.DO,PH:r.PH,WT:r.WT});if(B.hist.length>12)B.hist.shift();
  let codes=detectBuoyFaults(S,r);
  if(!codes.some(c=>c>=1&&c<=3))B.lastDO=r.DO;
  B.last=r; B.state='TX'; B.stateUntil=S.t;
  const bv=r.BV;
  if(!S.faults.bankDown){
    B.noAck=0; codes=codes.filter(c=>c!==21);
    B.codes=codes;
    H(S).tx('B2K',pondPacket(B.seq,r,B.lastAER,B.lastAERI,bv,topFault(codes)),true);
    bankRx(S,r,codes);
    const K=S.bank;
    B.lastAER=K.relay?1:0;B.lastAERI=K.current;
    let ack=`AM1,ID=${IDS.bank},T=ACK,N=${B.seq},AER=${B.lastAER},AERI=${K.current.toFixed(1)}`;
    if(B.pending){ack+=`,CMD=${B.pending.cmd}`}
    H(S).tx('K2B',ack,true);
    const all=[...new Set([...codes,...K.codes])];
    const flt=topFault(all);
    const pkt=pondPacket(B.seq,r,K.relay?1:0,K.current,bv,flt);
    H(S).tx('K2H',pkt,!S.faults.hubDown);
    if(!S.faults.hubDown)S.hub.rx++;
    alertCheck(S,all,{DO:r.DO});
    if(B.pending){const p=B.pending;B.pending=null;
      const cal=`AM1,ID=${IDS.buoy},T=CAL,N=${p.n},DOCAL=2026-10-31,DOZERO=OK,PHCAL=2026-10-31,PHSLOPE=97,PHOFF=-0.04,DUE=11d`;
      H(S).tx('B2K',cal,true);H(S).tx('K2H',cal,!S.faults.hubDown);
      H(S).event('Calibration status returned by buoy in its receive window','ok');}
  }else{
    B.noAck++; if(B.noAck>=2&&!codes.includes(21))codes.push(21);
    B.codes=codes;
    H(S).tx('B2K',pondPacket(B.seq,r,B.lastAER,B.lastAERI,bv,topFault(codes)),false);
    const pkt=pondPacket(B.seq,r,B.lastAER,B.lastAERI,bv,topFault(codes));
    H(S).tx('B2H',pkt,!S.faults.hubDown);
    if(!S.faults.hubDown)S.hub.rx++;
    alertCheck(S,codes,{DO:r.DO,direct:true});
  }
  B.flt=topFault(B.codes);
  const [iv,why]=buoyInterval(S);B.interval=iv;B.why=why;B.nextWake=S.t+iv;
  H(S).sample(r);
}

function bankRx(S,r,codes){
  const K=S.bank;
  K.lastRx=S.t;
  K.doInvalid=codes.some(c=>c>=1&&c<=3);
  if(!K.doInvalid)K.lastDO=r.DO;
  if(!K.doInvalid&&r.DO<S.cfg.lo&&!K.relay&&K.pendingDOlow==null)K.pendingDOlow=S.t;
  if(K.relay&&!K.doInvalid){
    K.doLog.push([S.t,r.DO]);
    const old=K.doLog.find(x=>S.t-x[0]>=30*MIN-1);
    if(old&&S.t-K.onAt>=30*MIN&&r.DO<old[1]-0.15&&!K.codes.includes(11)){K.codes.push(11)}
    while(K.doLog.length&&S.t-K.doLog[0][0]>31*MIN)K.doLog.shift();
  }
  bankDecide(S);
}
function bankDecide(S){
  const K=S.bank,h=hourOf(S.t);
  if(S.faults.bankDown){K.relay=false;K.current=0;S.aerRunning=false;K.reason='Controller unpowered';K.hold='';return}
  const silent=S.t-K.lastRx>35*MIN;
  if(silent&&!K.codes.includes(20))K.codes.push(20);
  if(!silent)K.codes=K.codes.filter(c=>c!==20);
  let want=K.relay;
  if(K.mode==='ON'){want=true;K.reason='Manual ON from hub'}
  else if(K.mode==='OFF'){want=false;K.reason='Manual OFF from hub'}
  else if(silent||K.doInvalid){ if(isNight(h)){want=true;K.reason='Failsafe: no valid DO at night → run aerator'} else K.reason='Failsafe: no valid DO, daytime → hold state'}
  else if(K.lastDO<S.cfg.lo){want=true;K.reason=`DO ${K.lastDO.toFixed(2)} < ${S.cfg.lo.toFixed(1)} → ON`}
  else if(K.lastDO>S.cfg.hi){want=false;K.reason=`DO ${K.lastDO.toFixed(2)} > ${S.cfg.hi.toFixed(1)} → OFF`}
  else K.reason=`DO ${K.lastDO.toFixed(2)} inside ${S.cfg.lo.toFixed(1)}–${S.cfg.hi.toFixed(1)} band → hold`;
  K.hold='';
  if(want!==K.relay){
    const el=S.t-K.lastChange;
    if(K.relay&&el<S.cfg.minOn)K.hold=`min ON time: ${fmtDur(S.cfg.minOn-el)} left`;
    else if(!K.relay&&el<S.cfg.minOff)K.hold=`min OFF time: ${fmtDur(S.cfg.minOff-el)} left`;
    else{
      K.relay=want;K.lastChange=S.t;
      const c=fmtClock(S.t).s;
      if(want){K.onAt=S.t;K.doLog=[[S.t,K.lastDO]];
        H(S).event(`${c} Contactor ON · ${K.reason}`,'ev');
        if(K.mode==='AUTO'){K.resp={doAt:K.pendingDOlow??S.t,onAt:S.t,curAt:null};
          smsOut(S,K.reason.startsWith('Failsafe')?`Pond 1: no valid DO reading. Aerator started as night failsafe at ${c}.`:`Pond 1: DO ${K.lastDO.toFixed(1)} mg/L. Aerator started automatically at ${c}.`)}
      } else {
        K.codes=K.codes.filter(x=>x!==10&&x!==11);
        H(S).event(`${c} Contactor OFF · ${K.reason}`,'ev');
      }
      K.pendingDOlow=null;
    }
  }
}
function bankTick(S){
  const K=S.bank;
  if(S.faults.bankDown){K.relay=false;K.current=0;S.aerRunning=false;return}
  bankDecide(S);
  S.aerRunning=K.relay&&!S.faults.aerMotorFail;
  K.current=S.aerRunning?6.4+gauss()*0.12:(K.relay?0.03:0.0);
  if(K.relay&&S.aerRunning&&K.resp&&K.resp.curAt==null)K.resp.curAt=S.t+2;
  if(K.relay&&S.t-K.lastChange>30&&K.current<0.5){ if(!K.codes.includes(10)){K.codes.push(10);
      H(S).event(`${fmtClock(S.t).s} FLT 10 · contactor ON but CT reads ${K.current.toFixed(2)} A`,'bad');
      const urgent=pondPacket(S.buoy.seq,S.buoy.last||{DO:K.lastDO,DOS:0,PH:0,WT:0},1,K.current,battV(S.buoy),10).replace('T=POND','T=POND,U=1');
      H(S).tx('K2H',urgent,!S.faults.hubDown);
      alertCheck(S,[...new Set([...S.buoy.codes,...K.codes])],{DO:K.lastDO});}}
  else if(!K.relay||K.current>=0.5)K.codes=K.codes.filter(c=>c!==10);
  if(K.codes.includes(20)&&!S.prevAlert.includes(20))alertCheck(S,[...new Set([...S.buoy.codes,...K.codes])],{DO:K.lastDO});
}

function advance(S,secs){
  while(secs>0){
    const dt=Math.min(10,secs);secs-=dt;
    physicsStep(S,dt);S.t+=dt;
    if(S.t>=S.buoy.nextWake)buoySample(S);
    bankTick(S);
    if(S.t>=S.nextHist){S.nextHist=S.t+120;
      S.hist.push({t:S.t,DO:S.w.DO,sat:S.w.sat,pH:S.w.pH,T:S.w.T,aer:S.aerRunning?1:(S.bank.relay?2:0)});
      while(S.hist.length&&S.t-S.hist[0].t>24*HOUR)S.hist.shift();}
  }
}

const SCENARIOS={
  normal:{name:'Normal day → night',desc:'Healthy pond. Day sampling every 15 min, night every 5 min.',h:16.5,DO:8.6,env:{}},
  crash:{name:'Night oxygen crash',desc:'Cloudy day + heavy plankton. DO falls below 4 → aerator starts by itself.',h:21.2,DO:4.35,env:{cloud:.85,algae:1.5,biomass:1.4}},
  aerFail:{name:'Aerator failure (no current)',desc:'Contactor pulls in, motor tripped. CT sees 0 A → FLT 10 + urgent SMS.',h:21.5,DO:4.05,env:{cloud:.85,algae:1.5,biomass:1.4},faults:{aerMotorFail:true}},
  aerWeak:{name:'Aerator running, DO still falling',desc:'Paddle broken / undersized. Current is fine but DO keeps dropping 30 min → FLT 11.',h:21.0,DO:4.1,env:{cloud:.85,algae:1.6,biomass:1.6},faults:{aerWeak:true}},
  hubDown:{name:'Gateway (hub) offline',desc:'The farmhouse gateway is off. Buoy + bank keep the aerator loop running on the pond by themselves.',h:21.3,DO:4.3,env:{cloud:.85,algae:1.5,biomass:1.4},faults:{hubDown:true}},
  bankDown:{name:'Bank controller power cut',desc:'Buoy gets no ACK, flags FLT 21 and sends straight to the hub so the farmer is told.',h:21.0,DO:4.6,env:{cloud:.85,algae:1.5,biomass:1.4},faults:{bankDown:true}},
  buoyDead:{name:'Buoy lost / silent',desc:'No buoy packets for 35 min at night → bank runs aerator as failsafe (FLT 20).',h:22.0,DO:5.2,env:{cloud:.5,algae:1.1,biomass:1.1},faults:{buoyDead:true}},
  doDisc:{name:'DO probe disconnected',desc:'Cable cut. Raw signal < 1 mV → FLT 1. Bank ignores the bad value and fails safe at night.',h:20.0,DO:5.6,env:{},faults:{doDisc:true}},
  phFoul:{name:'pH probe fouled',desc:'Bio-film on the glass: pH stops moving while DO swings → FLT 5 (clean probe).',h:19.0,DO:6.4,env:{cloud:.5,algae:1.2,biomass:1.2},faults:{phFoul:true}},
  battLow:{name:'3 cloudy days, battery low',desc:'Battery under 3.40 V → FLT 7, sampling stretches to 30 min unless DO < 5.',h:13.0,DO:7.0,env:{cloud:.95},soc:.07,faults:{panelDead:true}},
  rain:{name:'Monsoon rain storm',desc:'Rain cools the water and lowers pH; plankton stops producing O₂ → evening DO dip.',h:17.0,DO:6.2,env:{cloud:1,rain:.9,algae:1.3,biomass:1.2}},
};
function loadScenario(S,key){
  const sc=SCENARIOS[key];
  S.env={...ENV_DEFAULT,...sc.env};S.faults={...FAULTS_DEFAULT,...(sc.faults||{})};
  const day=Math.floor(S.t/86400);S.t=day*86400+sc.h*HOUR;
  const h=sc.h;S.w.DO=sc.DO;S.w.T=Ttarget(S,h);S.w.sat=doSat(S.w.T,S.env.sal);S.w.pH=6.6+1.6*Math.min(sc.DO/S.w.sat,1.7)-0.45*S.env.rain;
  const B=S.buoy;B.nextWake=S.t+20;B.mAh=(sc.soc??0.82)*B.cap;B.hist=[];B.phSensor=S.w.pH;B.stuckDO=null;B.codes=[];B.flt=0;B.noAck=0;B.lastDO=sc.DO;B.pending=null;B.state='SLEEP';B.lastAER=0;B.lastAERI=0;
  const K=S.bank;Object.assign(K,{mode:'AUTO',relay:false,lastChange:S.t-HOUR,current:0,lastRx:S.t,lastDO:sc.DO,doInvalid:false,codes:[],onAt:0,doLog:[],resp:null,pendingDOlow:null,reason:'–',hold:''});
  S.aerRunning=false;S.hub.queue=0;S.prevAlert=[];S.hist=[];S.nextHist=S.t;
  H(S).event(`Scenario loaded: ${sc.name}`,'ok');
}

if (typeof module === 'object' && module.exports) {
  module.exports = { HOUR, MIN, IDS, hooks, hourOf, isNight, fmtClock, fmtDur, doSat, Ttarget, FAULT_TEXT, PRI, topFault, ENV_DEFAULT, FAULTS_DEFAULT,
    newState, physicsStep, battV, readSensors, detectBuoyFaults, buoyInterval, pondPacket, alertCheck, smsOut, buoySample, bankRx, bankDecide, bankTick,
    advance, SCENARIOS, loadScenario };
}
