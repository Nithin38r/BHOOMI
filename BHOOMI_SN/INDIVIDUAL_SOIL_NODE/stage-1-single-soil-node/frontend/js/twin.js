/*
 * BHOOMI · Stage 1 · Single Soil Node digital twin
 * 3D scene (Three.js r128), firmware v2.2 model, hub rules and UI.
 * Exposes window.__twin for js/live-adapter.js, which feeds real packets from the backend.
 */
(function(){
"use strict";
/* ============================================================ helpers */
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const r1=v=>Math.round(v*10)/10;
const isNA=v=>v===null||v===undefined||Number.isNaN(v);
const fmt=(v,d)=>isNA(v)?'NA':v.toFixed(d);
const pad=n=>String(n).padStart(2,'0');
const hhmm=t=>{const m=((t%1440)+1440)%1440;return pad(Math.floor(m/60))+':'+pad(Math.floor(m%60));};
const dayOf=t=>Math.floor(t/1440)+1;
const gauss=()=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
function toast(msg){const el=$('#toast');el.textContent=msg;el.style.display='block';clearTimeout(toast._t);toast._t=setTimeout(()=>el.style.display='none',2600);}

/* ============================================================ simulation state */
const CAP=2600;                       // mAh
const PANEL_W=0.8;                    // Ø90 round panel, peak watts
const RPROG_MA=500;                   // TP4056 programmed charge current
const S={
  t:6*60,                              // sim minutes since day 1 00:00
  speed:5, playing:true,
  scenario:'normal',
  w:{cloud:.2, rain:0, tshift:0, drip:false},          // user/scenario targets
  env:{cloud:.2, rain:0, air:24, rh:70, irr:0, wind:.3},// smoothed actual
  soil:{m1:46, m2:57, st:25.5, lw:0},
  wetSpot:0,
  bat:{soc:.78*CAP, chargeMA:0, loadMA:0},
  sleepMA:0.5,
  faults:{m1:false, ds:false, sht:false, hub:false, ant:false, dust:false},
};
const SC={
  normal:  {name:'Normal day', d:'Clear, 23–35 °C', mean:29, amp:6, rh:62, cloud:.2, rain:0},
  heat:    {name:'Heatwave', d:'Dry sun, up to 44 °C', mean:37, amp:7, rh:30, cloud:0, rain:0},
  monsoon: {name:'Monsoon', d:'Heavy rain bursts', mean:26, amp:2, rh:93, cloud:.95, rain:14},
  drought: {name:'Drought week', d:'Soil already dry', mean:33, amp:8, rh:28, cloud:.05, rain:0, soil:{m1:17,m2:26}},
  cloudy:  {name:'Cloudy week', d:'Little sun for the panel', mean:27, amp:2.5, rh:80, cloud:.97, rain:0},
  night:   {name:'Night dew', d:'Cool, humid, still', mean:24, amp:5, rh:90, cloud:.05, rain:0, jump:22},
};
let climate=SC.normal;

const node={
  id:'7C9E1A', seq:1037, nextWake:6*60+2, off:false, mode:'sleep',
  lastPkt:null, lastFields:null, log:[], wakes:[], awakeMAhLast:0, critical:false,
};
const hub={last:null, lastRx:null, hist:[], lwHours:0, lastLWt:null};

/* ============================================================ physics (1 sim-minute step) */
function sunElev(t){const h=(t%1440)/60;return Math.sin(Math.PI*(h-6)/12);}   // >0 between 06–18
function batV(){
  const s=clamp(S.bat.soc/CAP,0,1);
  const pts=[[0,3.0],[.05,3.28],[.1,3.42],[.2,3.6],[.5,3.76],[.8,3.97],[1,4.18]];
  for(let i=1;i<pts.length;i++){if(s<=pts[i][0]){const a=pts[i-1],b=pts[i];return a[1]+(b[1]-a[1])*(s-a[0])/(b[0]-a[0]);}}
  return 4.18;
}
function stepMinute(){
  const t=S.t, h=(t%1440)/60, e=S.env, w=S.w, so=S.soil;
  // weather targets
  let rainT=w.rain;
  if(S.scenario==='monsoon' && w.rain===climate.rain){rainT = (Math.sin(t/47)+Math.sin(t/19)*.6>.15)? w.rain : 0;}
  e.cloud+= (w.cloud-e.cloud)*0.05;
  e.rain += (rainT-e.rain)*0.12; if(e.rain<0.05)e.rain=0;
  const el=sunElev(t);
  e.irr = Math.max(0,el)**1.15 * (1-0.85*e.cloud);
  const amp=climate.amp*(1-0.55*e.cloud);
  const airT = climate.mean + w.tshift + amp*Math.cos(2*Math.PI*(h-15)/24) - (e.rain>0?2.5:0);
  e.air += (airT-e.air)*0.04;
  const rhT = clamp(climate.rh - 2.2*(e.air-(climate.mean+w.tshift)) + (e.rain>0?25:0),12,100);
  e.rh += (rhT-e.rh)*0.05;
  // soil temperature at ~20 cm: slow, damped follow of air
  const stT = climate.mean + w.tshift - 1.5 + 0.35*(e.air-(climate.mean+w.tshift)) - 0.03*(so.m1-40);
  so.st += (stT-so.st)*(1/220);
  // water: rain + drip into layer 1
  let in1 = e.rain/60*1.15;                         // %/min per mm/h
  if(w.drip) in1 += 0.32;
  so.m1 = Math.min(100, so.m1 + in1*(1-so.m1/104));
  const et = 0.034*e.irr*clamp(e.air/30,.4,1.6)*clamp(so.m1/38,0,1)*(1-e.rh/150);
  so.m1 -= et;
  const d12 = 0.012*Math.max(0,so.m1-44) + 0.0015*Math.max(0,so.m1-so.m2);
  so.m1 -= d12; so.m2 += d12*0.9;
  so.m2 -= 0.004*Math.max(0,so.m2-52) + 0.006*e.irr*clamp(so.m2/40,0,1);
  so.m1=clamp(so.m1,3,100); so.m2=clamp(so.m2,3,100);
  // leaf / rain wetness
  if(e.rain>0.3) so.lw += (100-so.lw)*0.25;
  else if(e.irr<0.02 && e.rh>86) so.lw = Math.min(100, so.lw + 0.9);
  else so.lw = Math.max(0, so.lw - (0.15 + 2.2*e.irr)*(1+ (e.wind||0)));
  S.wetSpot = w.drip ? Math.min(1,S.wetSpot+0.03) : Math.max(0,S.wetSpot-0.004);
  // battery
  const pv = PANEL_W*e.irr*(S.faults.dust?0.15:1)*0.72;            // watts into charger
  let chg = Math.min(RPROG_MA, pv/4.1*1000);
  if(S.bat.soc>=CAP*0.999) chg=0;
  S.bat.chargeMA = chg;
  S.bat.loadMA = node.off?0.02:S.sleepMA;
  S.bat.soc = clamp(S.bat.soc + (chg*0.92 - S.bat.loadMA)/60, 0, CAP);
  // brown-out / recovery
  const V=batV();
  if(!node.off && V<3.02){node.off=true;node.mode='off';addLog('bad','BROWN-OUT','Battery '+V.toFixed(2)+' V — node off until the sun recharges it');}
  else if(node.off && V>3.45){
    node.off=false; node.seq=1000+Math.floor(Math.random()*50000);
    node.nextWake=S.t+1; addLog('info','COLD BOOT','Power restored · counter restarts at '+node.seq+' (v2.2 fix)');
  }
  S.t += 1;
  if(!node.off && S.t>=node.nextWake) wake(false);
  // leaf-wetness hours for disease rule (uses what hub received)
}

/* ============================================================ firmware model */
function linkOK(){
  if(S.faults.hub) return false;
  const p = S.faults.ant?0.25:(S.env.rain>8?0.93:0.98);
  return Math.random()<p;
}
function measure(){
  const so=S.soil,e=S.env,f=S.faults;
  return {
    m1: f.m1?NaN:clamp(r1(so.m1+gauss()*.4),0,100),
    m2: clamp(r1(so.m2+gauss()*.4),0,100),
    st: f.ds?NaN:r1(so.st+gauss()*.06),
    at: f.sht?NaN:r1(e.air+gauss()*.1),
    ah: f.sht?NaN:clamp(r1(e.rh+gauss()*.6),0,100),
    lw: Math.round(clamp(so.lw+gauss()*1.5,0,100)),
    lx: clamp(r1(e.irr*100*(0.96+Math.random()*.06)),0,100),
    bv: Math.round((batV()+gauss()*.006)*100)/100,
  };
}
function packet(r){
  return 'AM1,ID='+node.id+',T=SOIL,N='+node.seq+',M1='+fmt(r.m1,1)+',M2='+fmt(r.m2,1)+',ST='+fmt(r.st,1)+
    ',AT='+fmt(r.at,1)+',AH='+fmt(r.ah,1)+',LW='+fmt(r.lw,0)+',LX='+fmt(r.lx,1)+',EC=NA,PH=NA,NPK=NA,BV='+fmt(r.bv,2)+',HOP=0';
}
function addLog(kind,tag,text){
  node.log.unshift({t:S.t,kind,tag,text}); if(node.log.length>60)node.log.pop();
  uiDirty.log=true;
}
function wake(forced){
  if(node.off){toast('Node is off (brown-out) — battery too low');return;}
  const V=batV();
  if(V<3.30){
    node.nextWake=S.t+360; node.critical=true;
    node.wakes.push({t:S.t,res:'crit'});
    addLog('warn','CRITICAL','Battery '+V.toFixed(2)+' V < 3.30 V — no radio, sleeping 6 h');
    S.bat.soc=Math.max(0,S.bat.soc-0.015);
    anim.start({kind:'crit'}); return;
  }
  node.critical=false;
  node.seq++;
  const r=measure(), pkt=packet(r);
  let tries=0, ok=false;
  for(let a=1;a<=3;a++){tries=a; if(linkOK()){ok=true;break;}}
  const rssi = S.faults.ant? -121+Math.round(Math.random()*4) : -96+Math.round(gauss()*3)-(S.env.rain>8?4:0);
  const snr = S.faults.ant? -14 : r1(7+gauss()*1.5);
  // energy: ~2.6 s awake at 60 mA + per try 0.35 s TX at 35 mA + ACK wait
  const mAs = 2.6*60 + tries*(0.35*35) + (ok?(tries-1)*1.2*12+0.3*12:tries*1.2*12) + (ok?0:tries*0.5*20);
  S.bat.soc=Math.max(0,S.bat.soc - mAs/3600);
  node.awakeMAhLast=mAs/3600;
  node.lastPkt=pkt; node.lastFields=r;
  const intv = (r.bv<3.40)?60:15;
  node.nextWake = S.t + intv;
  node.wakes.push({t:S.t,res:ok?'ok':'fail'}); if(node.wakes.length>400)node.wakes.shift();
  if(ok){
    const prev=hub.last;
    if(prev){const dh=(S.t-prev.t)/60; hub.lwHours = r.lw>50 ? hub.lwHours+dh : 0;}
    hub.last=Object.assign({t:S.t,n:node.seq,rssi,snr,tries},r); hub.lastRx=S.t;
    hub.hist.push(Object.assign({t:S.t},r)); if(hub.hist.length>200)hub.hist.shift();
    addLog('ok','ACK HUB','#'+node.seq+' · try '+tries+' · RSSI '+rssi+' dBm · SNR '+snr+' dB'+(intv===60?' · low-batt 60 min':''));
  } else {
    addLog('bad','NO ACK','#'+node.seq+' · 3 tries, no answer'+(S.faults.hub?' (hub offline)':S.faults.ant?' (antenna loose)':'')+' · sleeping anyway');
  }
  uiDirty.all=true;
  anim.start({kind:ok?'ok':'fail', tries, forced});
}

/* ============================================================ hub rules */
function hubAlerts(){
  const out=[], L=hub.last;
  if(node.off) out.push(['bad','Node is off','Battery ran flat (brown-out). It restarts on its own once the panel brings it back above 3.45 V.']);
  if(!L){out.push(['info','Waiting for the first packet','The node wakes, reads every sensor and sends one LoRa packet every 15 minutes.']);return out;}
  const silent = S.t-hub.lastRx;
  const intv = (L.bv<3.40)?60:15;
  if(silent>intv*2+2) out.push(['bad','Node silent for '+Math.round(silent)+' min','Last packet #'+L.n+' at '+hhmm(hub.lastRx)+'. Check the hub, the antenna or the battery.']);
  const na=[]; if(isNA(L.m1))na.push('Moisture M1'); if(isNA(L.st))na.push('DS18B20'); if(isNA(L.at))na.push('SHT31');
  if(na.length) out.push(['bad','Sensor fault: '+na.join(', '),'Field arrives as NA. The node keeps sending everything else — fix the wiring at the next visit.']);
  if(!isNA(L.m1)&&L.m1<25) out.push(['warn','Topsoil dry — irrigate','M1 (15 cm) is '+L.m1.toFixed(1)+' %. Roots near the surface are short of water.','irrigate']);
  if(!isNA(L.m1)&&L.m1>88&&L.m2>80) out.push(['warn','Waterlogged','Both depths above 80 %. Stop irrigation and check drainage.','stopIrr']);
  if(!isNA(L.at)&&L.at>38) out.push(['warn','Heat stress','Air '+L.at.toFixed(1)+' °C. Irrigate early morning or evening, not at noon.']);
  if(hub.lwHours>=6 && !isNA(L.at)&&L.at>=18&&L.at<=32) out.push(['warn','Fungal disease risk','Leaves wet for '+Math.round(hub.lwHours)+' h at '+L.at.toFixed(0)+' °C. Scout for blight and mildew.']);
  if(L.bv<3.40) out.push(['warn','Low battery — 60 min reports','Battery '+L.bv.toFixed(2)+' V. The node slows down to save energy until the sun recharges it.']);
  if(!isNA(L.m2)&&!isNA(L.m1)&&L.m2-L.m1>18&&S.w.drip===false&&L.m1<35) out.push(['info','Water is deeper than the roots','30 cm is much wetter than 15 cm: short, frequent irrigation keeps the topsoil moist.']);
  if(!out.length) out.push(['ok','All good','Soil moisture, temperature and battery are in range. Next report in '+Math.max(0,Math.round(node.nextWake-S.t))+' min.']);
  return out;
}
function updateLW(){}

/* ============================================================ 3D scene */
let gl=true, renderer, scene, camera, parts={}, mats={}, world={};
const cam={tgt:new (window.THREE?THREE.Vector3:Object)(0,-2,0), r:150, th:.65, ph:1.12, goal:null};
function initGL(){
  if(!window.THREE){gl=false;return;}
  try{
    renderer=new THREE.WebGLRenderer({canvas:$('#view'),antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.outputEncoding=THREE.sRGBEncoding;
  }catch(err){gl=false;return;}
  scene=new THREE.Scene();
  scene.fog=new THREE.Fog(0x9fd3ff,260,620);
  camera=new THREE.PerspectiveCamera(42,1,0.5,2000);
  world.hemi=new THREE.HemisphereLight(0xdff1ff,0x5a4630,.75); scene.add(world.hemi);
  world.sun=new THREE.DirectionalLight(0xfff2d6,1.2); world.sun.position.set(80,140,60); scene.add(world.sun);
  world.moon=new THREE.DirectionalLight(0x8fb0ff,0); world.moon.position.set(-60,120,40); scene.add(world.moon);
  world.fill=new THREE.PointLight(0xffffff,.35,260); world.fill.position.set(0,-20,90); scene.add(world.fill);
  const M=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.75,metalness:0},o||{}));
  const add=(geo,mat,x,y,z,part,parent)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);if(part)m.userData.part=part;(parent||scene).add(m);return m;};
  const pol=(deg,r)=>[r*Math.sin(deg*Math.PI/180), r*Math.cos(deg*Math.PI/180)];

  /* --- soil block (back half, cut face at z=0) */
  mats.l1=M(0x8a6844); mats.l2=M(0x7a5a3a); mats.l3=M(0x5d4632);
  add(new THREE.BoxGeometry(140,20,70),mats.l1,0,-10,-35);
  add(new THREE.BoxGeometry(140,20,70),mats.l2,0,-30,-35);
  add(new THREE.BoxGeometry(140,16,70),mats.l3,0,-48,-35);
  mats.grass=M(0x5f9a3c,{roughness:.95});
  add(new THREE.BoxGeometry(140,1.2,70),mats.grass,0,.6,-35);
  // pebbles on cut face
  const peb=M(0x9c8a72);
  for(let i=0;i<46;i++){const s=.4+Math.random()*.9;add(new THREE.SphereGeometry(s,6,5),peb,-68+Math.random()*136,-3-Math.random()*50,.05);}
  // depth marks
  world.wetFront=add(new THREE.BoxGeometry(140,.5,.3),M(0x4f8fd6,{transparent:true,opacity:0}),0,-1,.2);
  /* drip line + wet spot */
  mats.drip=M(0x1b1b1b);
  const dl=add(new THREE.CylinderGeometry(.45,.45,140,10),mats.drip,0,1.6,-9); dl.rotation.z=Math.PI/2;
  world.wet=add(new THREE.CircleGeometry(1,40),M(0x3a2a1c,{transparent:true,opacity:0,roughness:.4}),0,1.25,-9); world.wet.rotation.x=-Math.PI/2;
  world.drops=[]; const dropM=M(0x7fbfff,{transparent:true,opacity:.9});
  for(let i=0;i<6;i++){const d=add(new THREE.SphereGeometry(.28,8,6),dropM,0,1.3,-9);d.visible=false;d.userData.ph=i/6;world.drops.push(d);}

  /* --- PVC pipe, head, lid, panel */
  mats.pvc=M(0xf1f1ee,{roughness:.55});
  add(new THREE.CylinderGeometry(3.75,3.75,44,40),mats.pvc,0,-16,0,'pipe');
  mats.head=M(0xfafaf7,{roughness:.45,transparent:true,opacity:1});
  parts.head=add(new THREE.CylinderGeometry(4.6,4.6,17.2,48),mats.head,0,14.6,0,'head');
  add(new THREE.CylinderGeometry(4.75,4.75,1.2,48),M(0xe2e2dc),0,6.6,0,'head');
  const lidMat=M(0xf4f4f0,{roughness:.5});
  parts.lid=add(new THREE.CylinderGeometry(5.6,5.6,1.1,48),lidMat,0,23.75,0,'panel');
  // solar panel texture
  const pc=document.createElement('canvas');pc.width=pc.height=256;const g=pc.getContext('2d');
  g.fillStyle='#14284d';g.beginPath();g.arc(128,128,126,0,7);g.fill();
  g.strokeStyle='#5d82c4';g.lineWidth=2;
  for(let i=16;i<256;i+=24){g.beginPath();g.moveTo(i,0);g.lineTo(i,256);g.stroke();g.beginPath();g.moveTo(0,i);g.lineTo(256,i);g.stroke();}
  g.globalCompositeOperation='destination-in';g.beginPath();g.arc(128,128,124,0,7);g.fill();
  const pTex=new THREE.CanvasTexture(pc);
  const panelTop=M(0x223a66,{map:pTex,roughness:.25,metalness:.35});
  parts.panel=add(new THREE.CylinderGeometry(4.5,4.5,.35,48),[M(0x1a2b49),panelTop,M(0x1a2b49)],0,24.45,0,'panel');
  // LDR window
  parts.ldr=add(new THREE.CylinderGeometry(.6,.6,.3,16),M(0xffe066,{emissive:0x332800}),0,24.4,5.05,'ldr');
  // status LED
  const [lx,lz]=pol(25,4.62);
  mats.led=M(0x0c3d1e,{emissive:0x000000}); parts.led=add(new THREE.SphereGeometry(.42,14,10),mats.led,lx,18.5,lz,'led');
  // antenna (SMA at 60°)
  const [ax,az]=pol(60,5.2);
  add(new THREE.CylinderGeometry(.55,.55,1.4,12),M(0xc9b37a,{metalness:.7,roughness:.3}),ax,20.5,az,'antenna');
  parts.ant=add(new THREE.CylinderGeometry(.42,.5,17,12),M(0x1d1f22,{roughness:.6}),ax,29.6,az,'antenna');
  world.antTip=new THREE.Vector3(ax,38.5,az);
  // SHT31 radiation shield (left)
  const [sx,sz]=pol(-75,10.5);
  const arm=add(new THREE.CylinderGeometry(.3,.3,6.5,8),M(0x777777),pol(-75,7.6)[0],18,pol(-75,7.6)[1]); arm.rotation.z=Math.PI/2; arm.rotation.y=-75*Math.PI/180+Math.PI/2;
  parts.sht=new THREE.Group(); parts.sht.position.set(sx,17,sz); scene.add(parts.sht);
  for(let i=0;i<5;i++){const d=add(new THREE.CylinderGeometry(2.3-i*.08,2.5-i*.08,.35,24),M(0xfdfdfb,{roughness:.6}),0,i*.8,0,'sht',parts.sht);}
  add(new THREE.BoxGeometry(1,.6,1),M(0x1f6f3a),0,1.6,0,'sht',parts.sht);
  // wetness sensor (right-back, 30° slant)
  const [wx,wz]=pol(120,10);
  const warm=add(new THREE.CylinderGeometry(.3,.3,5,8),M(0x777777),pol(120,7)[0],12,pol(120,7)[1]); warm.rotation.z=Math.PI/2; warm.rotation.y=120*Math.PI/180-Math.PI/2;
  parts.wet=new THREE.Group(); parts.wet.position.set(wx,12.5,wz); parts.wet.rotation.y=120*Math.PI/180; parts.wet.rotation.x=-0.52; scene.add(parts.wet);
  mats.wetBoard=M(0xb3261e);
  add(new THREE.BoxGeometry(2.3,.18,6.2),mats.wetBoard,0,0,0,'wet',parts.wet);
  const trM=M(0xe9b3a8,{metalness:.5,roughness:.3});
  for(let i=0;i<7;i++) add(new THREE.BoxGeometry(.12,.05,4.8),trM,-1+i*.33,.12,.4,'wet',parts.wet);
  world.wetFilm=add(new THREE.BoxGeometry(2.2,.06,5),M(0x7fc4ff,{transparent:true,opacity:0,roughness:.1}),0,.2,.4,null,parts.wet);

  /* --- inside the head (shown in Inside view) */
  world.inner=new THREE.Group(); scene.add(world.inner); world.inner.visible=false;
  add(new THREE.BoxGeometry(.25,15,6.6),M(0xd9d9d0),0,15,-.3,null,world.inner);
  add(new THREE.BoxGeometry(2.8,5.2,.3),M(0x1e2a36),.1,18.6,.1,'esp32',world.inner);
  add(new THREE.BoxGeometry(1.8,1.6,.25),M(0xb9bec4,{metalness:.7,roughness:.25}),.1,20.1,.32,'esp32',world.inner);
  add(new THREE.BoxGeometry(1.7,1.7,.25),M(0x1f7a3a),.1,13.8,.12,'lora',world.inner);
  const cell=add(new THREE.CylinderGeometry(.9,.9,6.5,20),M(0x1565c0,{roughness:.35}),-.1,11.2,-1.4,'battery',world.inner);
  add(new THREE.BoxGeometry(1.7,2.6,.2),M(0x1a3c8c),.1,10.2,.3,'charger',world.inner);
  add(new THREE.BoxGeometry(.7,.7,.4),M(0x222222),.1,8.4,.3,'charger',world.inner);

  /* --- underground sensors */
  const blade=(x,y,part)=>{const gp=new THREE.Group();gp.position.set(x,y,.8);scene.add(gp);
    add(new THREE.BoxGeometry(2.3,9,.25),M(0x1b1b1b,{roughness:.4}),0,0,0,part,gp);
    add(new THREE.BoxGeometry(2.3,2.4,.5),M(0xeeeeea),0,3.5,0,part,gp);
    for(let k=0;k<3;k++) add(new THREE.BoxGeometry(1.4,.12,.27),M(0xd4af37,{metalness:.6}),0,-1.5+k*1.2,0,part,gp);
    const glow=add(new THREE.SphereGeometry(4.2,18,14),M(0x4fa3ff,{transparent:true,opacity:0,depthWrite:false}),0,-1,0,null,gp);
    gp.userData.glow=glow; return gp;};
  parts.m1=blade(8,-15,'m1'); parts.m2=blade(-8,-30,'m2');
  // cables to pipe
  const cab=M(0x222222);
  const c1=add(new THREE.CylinderGeometry(.18,.18,4.6,6),cab,5.6,-10.8,.5); c1.rotation.z=Math.PI/2;
  const c2=add(new THREE.CylinderGeometry(.18,.18,4.6,6),cab,-5.6,-25.8,.5); c2.rotation.z=Math.PI/2;
  parts.ds=new THREE.Group(); parts.ds.position.set(7.5,-22,.8); scene.add(parts.ds);
  const probe=add(new THREE.CylinderGeometry(.38,.38,5,14),M(0xc9ccd1,{metalness:.8,roughness:.25}),0,0,0,'ds',parts.ds); probe.rotation.z=Math.PI/2;
  const c3=add(new THREE.CylinderGeometry(.16,.16,2.2,6),cab,-3.6,0,0,null,parts.ds); c3.rotation.z=Math.PI/2;
  parts.ds.userData.glow=add(new THREE.SphereGeometry(3,16,12),M(0xffa04f,{transparent:true,opacity:0,depthWrite:false}),0,0,0,null,parts.ds);
  // depth tags (little rulers)
  /* --- spike tip */
  parts.tip=new THREE.Group(); parts.tip.position.y=-38; scene.add(parts.tip);
  const tipM=M(0xd8d8d2,{roughness:.55});
  add(new THREE.CylinderGeometry(3.75,3.75,3,40),tipM,0,-1.5,0,'tip',parts.tip);
  const prof=[];for(let i=0;i<=16;i++){const a=i/16*Math.PI/2;prof.push(new THREE.Vector2(0.25+3.5*Math.cos(a),-3-3.5*Math.sin(a)));}
  prof.push(new THREE.Vector2(0,-6.5));
  add(new THREE.LatheGeometry(prof,40),M(0xd8d8d2,{roughness:.55,side:THREE.DoubleSide}),0,0,0,'tip',parts.tip);
  const toothM=M(0xe0dfd8,{roughness:.5});
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const tt=add(new THREE.ConeGeometry(1.15,3.2,4),toothM,Math.sin(a)*2.75,-6.6,Math.cos(a)*2.75,'tip',parts.tip);tt.rotation.x=Math.PI;tt.rotation.y=a+Math.PI/4;tt.rotation.z=-Math.sin(a)*.25;tt.rotation.x=Math.PI+Math.cos(a)*.25;}
  const ctr=add(new THREE.ConeGeometry(.9,2.6,8),toothM,0,-7.4,0,'tip',parts.tip); ctr.rotation.x=Math.PI;
  for(let i=0;i<6;i++) add(new THREE.TorusGeometry(3.5,.12,6,40),M(0xbdbdb6),0,1.2+i*.65,0,'tip',parts.tip).rotation.x=Math.PI/2;

  /* --- crops */
  world.plants=[];
  const stemM=M(0x3f7a2a), leafM=M(0x4f9a35,{roughness:.6});
  [[-30,-14],[-46,-30],[26,-20],[44,-36],[-14,-46],[14,-52],[-58,-12],[58,-16]].forEach(([x,z])=>{
    const p=new THREE.Group();p.position.set(x,1.2,z);scene.add(p);
    add(new THREE.CylinderGeometry(.35,.5,12,8),stemM,0,6,0,null,p);
    const leaves=[];
    for(let k=0;k<5;k++){const lg=new THREE.Group();lg.position.y=3+k*2;lg.rotation.y=k*2.4;p.add(lg);
      const lf=add(new THREE.SphereGeometry(1,10,6),leafM,3,0,0,null,lg);lf.scale.set(3.4,.25,1.15);leaves.push(lg);}
    p.userData.leaves=leaves; world.plants.push(p);
  });
  /* --- sky objects */
  world.sunBall=new THREE.Mesh(new THREE.SphereGeometry(9,20,14),new THREE.MeshBasicMaterial({color:0xffe08a,fog:false}));scene.add(world.sunBall);
  world.moonBall=new THREE.Mesh(new THREE.SphereGeometry(6,20,14),new THREE.MeshBasicMaterial({color:0xdfe7ff,fog:false}));scene.add(world.moonBall);
  const sg=new THREE.BufferGeometry();const sp=[];for(let i=0;i<500;i++){const a=Math.random()*Math.PI*2,b=Math.random()*1.3+.15;sp.push(Math.cos(a)*Math.cos(b)*480,Math.sin(b)*480,Math.sin(a)*Math.cos(b)*480);}
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  world.stars=new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:2,transparent:true,opacity:0,fog:false,sizeAttenuation:false}));scene.add(world.stars);
  world.clouds=[];const cm=new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:0,roughness:1});
  for(let i=0;i<7;i++){const cg=new THREE.Group();cg.position.set(-180+i*60,70+Math.random()*25,-60-Math.random()*90);
    for(let k=0;k<5;k++){const b=new THREE.Mesh(new THREE.SphereGeometry(8+Math.random()*7,12,10),cm);b.position.set(k*9-18,Math.random()*5,Math.random()*8);cg.add(b);}
    scene.add(cg);world.clouds.push(cg);} world.cloudMat=cm;
  /* --- rain */
  const N=1400; const rp=new Float32Array(N*6);
  for(let i=0;i<N;i++){const x=-80+Math.random()*160,y=Math.random()*110,z=-70+Math.random()*120;rp.set([x,y,z,x-.4,y-3,z],i*6);}
  const rg=new THREE.BufferGeometry(); rg.setAttribute('position',new THREE.BufferAttribute(rp,3));
  world.rain=new THREE.LineSegments(rg,new THREE.LineBasicMaterial({color:0xaed4ff,transparent:true,opacity:0}));scene.add(world.rain); world.rainN=N;
  /* --- radio rings + ack pulse */
  world.rings=[];const ringM=()=>new THREE.MeshBasicMaterial({color:0x6ff0a8,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false});
  for(let i=0;i<4;i++){const rr=new THREE.Mesh(new THREE.TorusGeometry(1,.09,6,48),ringM());rr.rotation.x=Math.PI/2;rr.visible=false;scene.add(rr);world.rings.push(rr);}
  world.ack=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),new THREE.MeshBasicMaterial({color:0x6ff0a8}));world.ack.visible=false;scene.add(world.ack);
  world.hubPos=new THREE.Vector3(-95,46,-40);

  /* picking */
  world.ray=new THREE.Raycaster(); world.pick=[];
  scene.traverse(o=>{if(o.isMesh&&o.userData.part)world.pick.push(o);});
}

/* labels */
const LAB=[
  {part:'panel', pos:()=>[0,26.5,0], txt:()=>['Solar panel', (S.env.irr*PANEL_W*(S.faults.dust?.15:1)).toFixed(2)+' W']},
  {part:'antenna', pos:()=>[world.antTip?world.antTip.x:3,40,world.antTip?world.antTip.z:2.5], txt:()=>['LoRa 433 MHz', node.mode==='tx'?'sending…':'']},
  {part:'sht', pos:()=>[parts.sht?parts.sht.position.x:-10,22,parts.sht?parts.sht.position.z:-3], txt:()=>['SHT31 air', fv('at',1,'°C')+' · '+fv('ah',0,'%')]},
  {part:'wet', pos:()=>[parts.wet?parts.wet.position.x:8,16,parts.wet?parts.wet.position.z:-5], txt:()=>['Wetness', fv('lw',0,'%')]},
  {part:'ldr', pos:()=>[0,25.5,5.1], txt:()=>['Light (LDR)', fv('lx',0,'%')], hideFar:true},
  {part:'m1', pos:()=>[8,-9,1.5], txt:()=>['Moisture 15 cm', fv('m1',1,'%')]},
  {part:'m2', pos:()=>[-8,-24,1.5], txt:()=>['Moisture 30 cm', fv('m2',1,'%')]},
  {part:'ds', pos:()=>[10.5,-21,1], txt:()=>['Soil temp', fv('st',1,'°C')]},
  {part:'tip', pos:()=>[0,-46.5,1], txt:()=>['Spiked tip','']},
];
function fv(k,d,u){const L=hub.last;if(!L)return '–';return isNA(L[k])?'NA':L[k].toFixed(d)+' '+u;}
let labelsOn=true; const labEls=[];
function buildLabels(){
  const box=$('#labels');
  LAB.forEach((l,i)=>{const el=document.createElement('div');el.className='lab';el.addEventListener('click',()=>showInfo(l.part));box.appendChild(el);labEls[i]=el;});
}
function updateLabels(){
  if(!gl)return;
  const W=$('#view').clientWidth,H=$('#view').clientHeight, v=new THREE.Vector3();
  LAB.forEach((l,i)=>{
    const el=labEls[i]; if(!labelsOn){el.style.display='none';return;}
    const p=l.pos(); v.set(p[0],p[1],p[2]).project(camera);
    if(v.z>1||v.x<-1.1||v.x>1.1||v.y<-1.1||v.y>1.1||(l.hideFar&&cam.r>120)){el.style.display='none';return;}
    el.style.display='block';
    el.style.left=((v.x+1)/2*W)+'px'; el.style.top=((1-v.y)/2*H)+'px';
    const [a,b]=l.txt(); const html='<b>'+a+'</b>'+(b?' <span class="v">'+b+'</span>':'');
    if(el._h!==html){el.innerHTML=html;el._h=html;el.classList.toggle('na',b==='NA'||/NA/.test(b));}
  });
}

/* camera */
const CAMS={overview:{t:[0,-4,0],r:150,th:.62,ph:1.13},head:{t:[0,19,0],r:52,th:.55,ph:1.2},under:{t:[0,-24,0],r:82,th:.18,ph:1.5},tip:{t:[0,-43,0],r:34,th:.35,ph:1.42}};
function setCam(name){const c=CAMS[name];if(!c)return;cam.goal={t:c.t,r:c.r,th:c.th,ph:c.ph};$$('.vb[data-cam]').forEach(b=>b.classList.toggle('on',b.dataset.cam===name));}
function applyCam(){
  if(cam.goal){const g=cam.goal,k=.08;
    cam.tgt.x=lerp(cam.tgt.x,g.t[0],k);cam.tgt.y=lerp(cam.tgt.y,g.t[1],k);cam.tgt.z=lerp(cam.tgt.z,g.t[2],k);
    cam.r=lerp(cam.r,g.r,k);cam.th=lerp(cam.th,g.th,k);cam.ph=lerp(cam.ph,g.ph,k);
    if(Math.abs(cam.r-g.r)<.2&&Math.abs(cam.th-g.th)<.003&&Math.abs(cam.ph-g.ph)<.003)cam.goal=null;}
  camera.position.set(cam.tgt.x+cam.r*Math.sin(cam.ph)*Math.sin(cam.th),cam.tgt.y+cam.r*Math.cos(cam.ph),cam.tgt.z+cam.r*Math.sin(cam.ph)*Math.cos(cam.th));
  camera.lookAt(cam.tgt);
}
function initControls(){
  const el=$('#view'); let drag=null, pts=new Map(), pinch=0;
  el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);drag={x:e.clientX,y:e.clientY,moved:0};cam.goal=null;});
  el.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId))return; const prev=pts.get(e.pointerId); pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2){const [a,b]=[...pts.values()];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pinch)cam.r=clamp(cam.r*pinch/d,22,320);pinch=d;if(drag)drag.moved=99;return;}
    const dx=e.clientX-prev[0],dy=e.clientY-prev[1];
    if(drag)drag.moved+=Math.abs(dx)+Math.abs(dy);
    cam.th-=dx*.006; cam.ph=clamp(cam.ph-dy*.005,.25,2.05);
  });
  const end=e=>{
    if(drag&&drag.moved<6&&pts.size===1)pick(e);
    pts.delete(e.pointerId); if(pts.size<2)pinch=0; if(!pts.size)drag=null;
  };
  el.addEventListener('pointerup',end); el.addEventListener('pointercancel',e=>{pts.delete(e.pointerId);pinch=0;drag=null;});
  el.addEventListener('wheel',e=>{e.preventDefault();cam.goal=null;cam.r=clamp(cam.r*(1+Math.sign(e.deltaY)*.08),22,320);},{passive:false});
}
function pick(e){
  if(!gl)return; const r=$('#view').getBoundingClientRect();
  const m=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
  world.ray.setFromCamera(m,camera);
  const hits=world.ray.intersectObjects(world.pick.filter(o=>{let p=o;while(p){if(p.visible===false)return false;p=p.parent;}return true;}),false);
  if(hits.length) showInfo(hits[0].object.userData.part);
}

/* ============================================================ wake animation */
const anim={on:false,t0:0,ev:null,
  start(ev){this.on=true;this.t0=performance.now();this.ev=ev;},
  phase(){ if(!this.on)return null; const s=(performance.now()-this.t0)/1000, ev=this.ev;
    if(ev.kind==='crit'){ if(s<1.6)return{name:'crit',s}; this.on=false; return null;}
    const txEnd = 1.9 + (ev.tries||1)*0.9;
    if(s<0.35)return{name:'boot',s};
    if(s<1.0)return{name:'rail',s};
    if(s<1.6)return{name:'read',s};
    if(s<1.9)return{name:'build',s};
    if(s<txEnd)return{name:'tx',s,k:Math.floor((s-1.9)/0.9),f:((s-1.9)%0.9)/0.9};
    if(s<txEnd+0.9)return{name:ev.kind==='ok'?'ack':'noack',s:s-txEnd};
    this.on=false; return null;}
};
const PH_TXT={boot:['Waking up','Timer wake from deep sleep'],rail:['Sensors ON','GPIO25 powers the sensor rail'],read:['Reading sensors','2 × moisture · DS18B20 · SHT31 · LDR · wetness · battery'],
  build:['Building packet','AM1 text packet, ~140 bytes'],tx:['Transmitting','LoRa 433.5 MHz · SF9 · 10 dBm'],ack:['ACK from hub ✓','Packet confirmed'],noack:['No ACK ✗','Gave up after 3 tries'],crit:['Battery critical','Skipping radio · sleep 6 h']};

/* ============================================================ frame update (visuals) */
let lastFrame=performance.now(), simAcc=0, uiTimer=0;
const uiDirty={all:true,log:true};
function frame(now){
  const dt=Math.min(.1,(now-lastFrame)/1000); lastFrame=now;
  if(S.playing){simAcc+=dt*S.speed; let n=0; while(simAcc>=1&&n<400){stepMinute();simAcc-=1;n++;} if(n>=400)simAcc=0; updateLW();}
  const ph=anim.phase();
  node.mode = node.off?'off':ph?(ph.name==='tx'?'tx':'awake'):'sleep';
  if(gl) drawScene(dt,ph,now);
  uiTimer+=dt; if(uiTimer>.25||uiDirty.all){uiTimer=0;renderUI(ph);uiDirty.all=false;}
  renderBadge(ph); drawTimeline();
  requestAnimationFrame(frame);
}
function soilColor(m){const dry=[0.78,0.64,0.45],wet=[0.24,0.16,0.10];const k=clamp((m-10)/80,0,1);return [lerp(dry[0],wet[0],k),lerp(dry[1],wet[1],k),lerp(dry[2],wet[2],k)];}
function drawScene(dt,ph,now){
  const c=$('#view'),W=c.clientWidth,H=c.clientHeight;
  if(c.width!==Math.floor(W*renderer.getPixelRatio())||c.height!==Math.floor(H*renderer.getPixelRatio())){renderer.setSize(W,H,false);camera.aspect=W/Math.max(1,H);camera.updateProjectionMatrix();}
  const e=S.env, h=(S.t%1440)/60, el=sunElev(S.t);
  // sky
  const day=clamp(el*1.6+.15,0,1), dusk=clamp(1-Math.abs(el)*5,0,1)*(el>-.25?1:0);
  const sky=[lerp(.04,.56,day),lerp(.07,.76,day),lerp(.13,.95,day)];
  const grey=e.cloud*.55; for(let i=0;i<3;i++)sky[i]=lerp(sky[i],.55*day+.08,grey);
  sky[0]=lerp(sky[0],.95,dusk*.35);sky[1]=lerp(sky[1],.6,dusk*.25);
  scene.background=new THREE.Color(sky[0],sky[1],sky[2]); scene.fog.color.setRGB(sky[0],sky[1],sky[2]);
  const a=Math.PI*(h-6)/12;
  world.sunBall.position.set(Math.cos(a)*300,Math.sin(a)*300,-160); world.sunBall.visible=el>-.05&&e.cloud<.9;
  world.sun.position.copy(world.sunBall.position); world.sun.intensity=Math.max(0,el)*1.35*(1-.7*e.cloud)+.02;
  const am=a+Math.PI; world.moonBall.position.set(Math.cos(am)*300,Math.sin(am)*300,-180); world.moonBall.visible=el<0;
  world.moon.intensity=el<0?.25:0; world.hemi.intensity=.22+.6*day; world.stars.material.opacity=clamp(-el*2.5,0,1)*(1-e.cloud);
  world.fill.intensity=.18+.25*day;
  // clouds & rain
  world.cloudMat.opacity=clamp(e.cloud*1.05-.05,0,.92); world.cloudMat.color.setScalar(lerp(1,.55,clamp(e.rain/12,0,1))*(.35+.65*day));
  world.clouds.forEach((g,i)=>{g.position.x+=dt*(2+i*.3)*(S.playing?1:0); if(g.position.x>220)g.position.x=-220;});
  const rOn=e.rain>0.3; world.rain.material.opacity=rOn?clamp(.25+e.rain/25,0,.8):0;
  if(rOn){const arr=world.rain.geometry.attributes.position.array, sp=dt*(70+e.rain*2)*(S.playing?1:.15);
    for(let i=0;i<world.rainN;i++){const o=i*6;arr[o+1]-=sp;arr[o+4]-=sp;if(arr[o+4]<0){const y=110+Math.random()*10;arr[o+1]=y;arr[o+4]=y-3;}}
    world.rain.geometry.attributes.position.needsUpdate=true;}
  // soil colours
  const so=S.soil;
  [['l1',so.m1],['l2',so.m2],['l3',Math.min(so.m2+6,80)]].forEach(([k,m])=>{const cc=soilColor(m);mats[k].color.setRGB(cc[0],cc[1],cc[2]);});
  const gk=clamp((so.m1-15)/30,0,1); mats.grass.color.setRGB(lerp(.62,.33,gk),lerp(.55,.6,gk),lerp(.28,.2,gk));
  world.wet.material.opacity=S.wetSpot*.75; world.wet.scale.setScalar(2+S.wetSpot*9);
  world.drops.forEach(d=>{d.visible=S.w.drip; if(d.visible){d.userData.ph=(d.userData.ph+dt*1.4)%1; d.position.y=1.1-d.userData.ph*1.1; d.position.x=(d.userData.ph*0)+0;}});
  world.wetFilm.material.opacity=clamp(so.lw/100,0,1)*.7;
  // plants wilt when topsoil dry
  const wilt=clamp((30-so.m1)/18,0,1);
  world.plants.forEach((p,i)=>{p.userData.leaves.forEach((lg,k)=>{lg.rotation.z=-.15-wilt*.9+Math.sin(now/900+i+k)*.03*(1+e.rain*.05);});});
  // inside view
  mats.head.opacity=xray?.22:1; mats.head.depthWrite=!xray; world.inner.visible=xray;
  // wake visuals
  let led=0x000000, ledC=0x0c3d1e;
  const g1=parts.m1.userData.glow, g2=parts.m2.userData.glow, g3=parts.ds.userData.glow;
  let glow=0;
  if(ph){
    if(ph.name==='boot'||ph.name==='rail'||ph.name==='build'||ph.name==='read'){led=0x22dd66;ledC=0x22dd66;}
    if(ph.name==='read') glow=Math.sin((ph.s-1)/.6*Math.PI);
    if(ph.name==='rail') glow=.25;
    if(ph.name==='tx'){led=0x3a8bff;ledC=0x3a8bff;}
    if(ph.name==='noack'||ph.name==='crit'){led=(Math.floor(now/180)%2)?0xff3b30:0;ledC=0xff3b30;}
    if(ph.name==='ack'){led=0x22dd66;ledC=0x22dd66;}
  }
  mats.led.emissive.setHex(led); mats.led.color.setHex(ledC);
  g1.material.opacity=(S.faults.m1?0:.22)*glow; g2.material.opacity=.22*glow; g3.material.opacity=(S.faults.ds?0:.25)*glow;
  // radio rings
  world.rings.forEach((r,i)=>{
    if(ph&&ph.name==='tx'){const f=(ph.f+i*.25)%1; r.visible=true; r.position.copy(world.antTip); r.scale.setScalar(1+f*26*(S.faults.ant?.35:1)); r.material.opacity=(1-f)*.7;}
    else r.visible=false;});
  world.ack.visible=false;
  if(ph&&ph.name==='ack'){const f=clamp(ph.s/.8,0,1); world.ack.visible=true; world.ack.position.lerpVectors(world.hubPos,world.antTip,f);}
  applyCam(); renderer.render(scene,camera); updateLabels();
}

/* ============================================================ UI */
const CARD=[
  {k:'m1',n:'Moisture · 15 cm',u:'%',d:1,src:'m1',truth:()=>S.soil.m1,pin:'GPIO32'},
  {k:'m2',n:'Moisture · 30 cm',u:'%',d:1,src:'m2',truth:()=>S.soil.m2,pin:'GPIO33'},
  {k:'st',n:'Soil temp',u:'°C',d:1,src:'ds',truth:()=>S.soil.st,pin:'GPIO4'},
  {k:'at',n:'Air temp',u:'°C',d:1,src:'sht',truth:()=>S.env.air,pin:'I²C'},
  {k:'ah',n:'Humidity',u:'%',d:0,src:'sht',truth:()=>S.env.rh,pin:'I²C'},
  {k:'lw',n:'Leaf/rain wetness',u:'%',d:0,src:'wet',truth:()=>S.soil.lw,pin:'GPIO39'},
  {k:'lx',n:'Light',u:'%',d:0,src:'ldr',truth:()=>S.env.irr*100,pin:'GPIO34'},
  {k:'bv',n:'Battery',u:'V',d:2,src:'battery',truth:()=>batV(),pin:'GPIO35'},
];
function buildCards(){
  $('#cards').innerHTML=CARD.map(c=>'<div class="card" data-part="'+c.src+'" id="c-'+c.k+'"><div class="k"><span>'+c.n+'</span><span>'+c.pin+'</span></div><div class="val">–</div><div class="truth">&nbsp;</div><canvas width="160" height="26"></canvas></div>').join('');
  $$('#cards .card').forEach(el=>el.addEventListener('click',()=>showInfo(el.dataset.part)));
}
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
function spark(cv,key){
  const g=cv.getContext('2d'),W=cv.width,H=cv.height; g.clearRect(0,0,W,H);
  const pts=hub.hist.slice(-96).map(p=>p[key]).filter(v=>!isNA(v)); if(pts.length<2)return;
  let mn=Math.min(...pts),mx=Math.max(...pts); if(mx-mn<1){mx+=.5;mn-=.5;}
  g.strokeStyle=cssVar('--accent');g.lineWidth=1.6;g.beginPath();
  pts.forEach((v,i)=>{const x=i/(pts.length-1)*(W-2)+1,y=H-2-(v-mn)/(mx-mn)*(H-4);i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();
}
function renderUI(ph){
  const L=hub.last;
  CARD.forEach(c=>{
    const el=$('#c-'+c.k); const v=L?L[c.k]:undefined;
    el.classList.toggle('na',!!L&&isNA(v));
    el.querySelector('.val').innerHTML=!L?'–':isNA(v)?'NA':v.toFixed(c.d)+'<small>'+c.u+'</small>';
    el.querySelector('.truth').textContent='field now: '+c.truth().toFixed(c.d)+' '+c.u;
    spark(el.querySelector('canvas'),c.k);
  });
  // alerts
  const al=hubAlerts(); const ah=al.map(a=>'<div class="alert '+a[0]+'"><div class="ic">'+({ok:'✓',warn:'!',bad:'×',info:'i'}[a[0]])+'</div><div><b>'+a[1]+'</b><span>'+a[2]+'</span>'+
    (a[3]==='irrigate'?'<div class="act"><button class="btn sm" data-act="irrigate">Start drip irrigation</button></div>':a[3]==='stopIrr'?'<div class="act"><button class="btn sm" data-act="stopIrr">Stop irrigation</button></div>':'')+'</div></div>').join('');
  if($('#alerts')._h!==ah){$('#alerts').innerHTML=ah;$('#alerts')._h=ah;}
  // header chips
  const V=batV(); $('#chipBat').textContent=V.toFixed(2)+' V';
  $('#chipBatDot').className='dot '+(V<3.3?'bad':V<3.4?'warn':'ok');
  $('#chipInt').textContent=node.off?'off':node.critical?'6 h':(L&&L.bv<3.4?'60 min':'15 min');
  const silent=L?S.t-hub.lastRx:null;
  $('#chipHub').textContent=!L?'waiting':silent<1?'just now':Math.round(silent)+' min ago';
  $('#chipHubDot').className='dot '+(!L?'':silent>32?'bad':'ok');
  $('#chipLinkDot').className='dot '+(S.faults.hub||S.faults.ant?'bad':'ok');
  // packets
  if(node.lastPkt){
    const html=node.lastPkt.split(',').map((f,i)=>{if(i===0)return '<span class="h">'+f+'</span>';const [k,v]=f.split('=');return '<span class="f">'+k+'</span>='+(v==='NA'?'<span class="na">NA</span>':v);}).join(',');
    if($('#pktRaw')._h!==html){$('#pktRaw').innerHTML=html;$('#pktRaw')._h=html;
      const r=node.lastFields, rows=[['ID','Node ID',node.id],['N','Packet number',node.seq],['M1','Moisture 15 cm',fmt(r.m1,1)+' %'],['M2','Moisture 30 cm',fmt(r.m2,1)+' %'],['ST','Soil temp (DS18B20)',fmt(r.st,1)+' °C'],['AT','Air temp (SHT31)',fmt(r.at,1)+' °C'],['AH','Air humidity (SHT31)',fmt(r.ah,1)+' %'],['LW','Leaf/rain wetness',fmt(r.lw,0)+' %'],['LX','Light (LDR)',fmt(r.lx,1)+' %'],['EC·PH·NPK','RS485 probe (not fitted)','NA'],['BV','Battery',fmt(r.bv,2)+' V'],['HOP','Relays passed','0 (direct)']];
      $('#pktTable').innerHTML='<tr><th>Field</th><th>Meaning</th><th>Value</th></tr>'+rows.map(x=>'<tr><td class="m">'+x[0]+'</td><td>'+x[1]+'</td><td class="m">'+x[2]+'</td></tr>').join('');}
  }
  if(uiDirty.log){uiDirty.log=false;
    $('#radioLog').innerHTML=node.log.slice(0,40).map(l=>'<div><span class="t">D'+dayOf(l.t)+' '+hhmm(l.t)+'</span><span><span class="tag '+l.kind+'">'+l.tag+'</span> '+l.text+'</span></div>').join('')||'<div class="note">Nothing yet.</div>';}
  // power
  const soc=S.bat.soc/CAP; $('#batFill').style.width=(soc*100).toFixed(0)+'%';
  $('#batFill').style.background=soc<.12?cssVar('--bad'):soc<.25?cssVar('--warn'):cssVar('--ok');
  $('#batV').textContent=V.toFixed(2)+' V · '+(soc*100).toFixed(0)+' %';
  $('#batState').textContent=node.off?'Node off (brown-out)':S.bat.chargeMA>1?'Charging from the panel':soc>.995?'Full':'Running on battery';
  const wakesDay=(L&&L.bv<3.4)?24:96, perWake=node.awakeMAhLast||0.05;
  const daily=S.sleepMA*24+wakesDay*perWake;
  kv('#powerKV',[['Solar input',(S.env.irr*PANEL_W*(S.faults.dust?.15:1)).toFixed(2)+' W'],['Charge current',S.bat.chargeMA.toFixed(0)+' mA'],['Sleep current',S.sleepMA+' mA'],['Last wake cost',(perWake*1000).toFixed(0)+' µAh'],['Node state',node.mode.toUpperCase()]]);
  kv('#lifeKV',[['Energy per day',daily.toFixed(1)+' mAh'],['Days on battery, no sun',(S.bat.soc/daily).toFixed(daily>10?0:0)+' days'],['Full battery, no sun',(CAP*.8/daily).toFixed(0)+' days']]);
  // clock
  $('#clock').innerHTML='Day '+dayOf(S.t)+' '+hhmm(S.t)+'<small>'+(node.off?'node off':'next wake in '+Math.max(0,Math.round(node.nextWake-S.t))+' min')+'</small>';
  // weather labels
  $('#cloudV').textContent=Math.round(S.w.cloud*100)+' %'; $('#rainV').textContent=S.w.rain+' mm/h'; $('#tshiftV').textContent=(S.w.tshift>0?'+':'')+S.w.tshift+' °C';
  if(infoPart) renderInfo();
}
function kv(sel,rows){$(sel).innerHTML=rows.map(r=>'<span>'+r[0]+'</span><b>'+r[1]+'</b>').join('');}
function renderBadge(ph){
  let t,s,d;
  if(node.off){t='OFF · brown-out';s='Waiting for the sun to recharge';d='bad';}
  else if(ph){[t,s]=PH_TXT[ph.name];if(ph.name==='tx')t='Transmitting · try '+(ph.k+1);d=ph.name==='noack'||ph.name==='crit'?'bad':ph.name==='tx'?'blue':'ok';}
  else{t='Deep sleep';s=S.sleepMA+' mA · wakes in '+Math.max(0,Math.round(node.nextWake-S.t))+' min';d='';}
  if(renderBadge._k!==t+s){renderBadge._k=t+s;$('#stText').textContent=t;$('#stSub').textContent=s;$('#stDot').className='dot '+d;}
}
function drawTimeline(){
  const cv=$('#tl'),W=cv.clientWidth,H=cv.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);
  if(cv.width!==Math.floor(W*dpr)){cv.width=Math.floor(W*dpr);cv.height=Math.floor(H*dpr);}
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  const d0=Math.floor(S.t/1440)*1440;
  for(let x=0;x<W;x+=2){const t=d0+x/W*1440, el=sunElev(t);const k=clamp(el*1.4+.2,0,1);
    g.fillStyle='rgb('+Math.round(lerp(22,250,k))+','+Math.round(lerp(34,214,k))+','+Math.round(lerp(58,120,k))+')';g.fillRect(x,0,2,H-12);}
  g.fillStyle=cssVar('--ink3');g.font='10px IBM Plex Sans, sans-serif';
  for(let hh=0;hh<=24;hh+=3){const x=hh/24*W;g.fillRect(x,H-12,1,4);if(hh<24)g.fillText(pad(hh)+':00',Math.min(x+2,W-30),H-1);}
  node.wakes.forEach(w=>{if(w.t<d0||w.t>=d0+1440)return;const x=(w.t-d0)/1440*W;
    g.fillStyle=w.res==='ok'?'#2fbf71':w.res==='fail'?'#ff5a4e':'#f0b24a';g.fillRect(x-1,H-26,2,12);});
  const x=(S.t-d0)/1440*W; g.fillStyle='#fff';g.fillRect(x-1,0,3,H-12);g.strokeStyle='#000';g.lineWidth=.5;g.strokeRect(x-1,0,3,H-12);
}

/* info card */
let infoPart=null;
const INFO={
  m1:['Capacitive moisture sensor v1.2 — 15 cm','GPIO32 (ADC1) · VCC from GPIO25','Measures how wet the root zone is near the surface. Capacitive (no bare metal), so it does not corrode. Calibrated dry 3200 / wet 1350 raw.'],
  m2:['Capacitive moisture sensor v1.2 — 30 cm','GPIO33 (ADC1) · VCC from GPIO25','The deeper probe shows whether water actually reached the lower roots — the gap between 15 cm and 30 cm tells you how irrigation is soaking in.'],
  ds:['DS18B20 waterproof probe','GPIO4 · 1-Wire · 4.7 kΩ pull-up','Soil temperature at ~20 cm. Unplugged → reads −127 °C, which the firmware turns into NA.'],
  sht:['SHT31 air temperature & humidity','I²C SDA 21 · SCL 22 · addr 0x44','Sits in a white, stacked radiation shield so the sun does not heat it. Every reading is CRC-checked — a bad wire gives NA, not a wrong number.'],
  wet:['Water-level sensor used as leaf/rain wetness','GPIO39 (VN) · ADC1','Mounted at 30° outside the head. Rain or dew bridges its traces; long wet hours at warm temperature mean fungal disease risk.'],
  ldr:['LM393 LDR light module','AO → GPIO34 · DO unused','Relative light 0–100 %. v2.2 fix: total darkness now reads 0 % (v2.1 wrongly sent NA at night).'],
  battery:['18650 Li-ion · 2600 mAh','Divider 2×100 kΩ → GPIO35','Voltage is sent in every packet (BV). Below 3.40 V the node reports hourly, below 3.30 V it stops using the radio.'],
  panel:['Round solar panel Ø90 mm','5–6 V · ~0.8 W → TP4056 IN','Sits in the lid pocket. Even a cloudy week gives some charge; the twin shows charge current live in the Power tab.'],
  charger:['TP4056 + DW01A charger/BMS · HT7833 LDO','OUT+ → switch → HT7833 → 3V3','R_PROG raised to ~2.4 kΩ (≈500 mA) so a small panel is not overloaded. HT7833 idles at 4 µA.'],
  antenna:['LoRa antenna · 433 MHz','SMA bulkhead on the head','SX1278 at 10 dBm, the 433 MHz licence-free limit in India. Always attach before power-on.'],
  lora:['SX1278 (Ra-02) LoRa module','NSS5 SCK18 MISO19 MOSI23 RST14 DIO0 26','Sends one packet per wake and waits 1.2 s for the hub’s ACK; up to 3 tries.'],
  esp32:['ESP32 38-pin DevKit','3V3 from the HT7833','Deep-sleeps between reports. Removing the board’s power LED cuts sleep current ~10×.'],
  led:['Status LED','GPIO2','Green = awake, blue = transmitting, red blinks = no ACK / battery critical.'],
  head:['Above-ground head','3D-printed PETG/ASA · Ø92 mm','Holds the sled, panel, antenna, vent and glands. Print it white to stay cool in the sun.'],
  pipe:['PVC pipe Ø75','Cables run inside','Carries the head and guides the sensor cables down to 15 cm and 30 cm.'],
  tip:['Spiked tip (your m3 part)','70.00 mm thread · 75 mm capsule · 8 teeth','Grooved end slides into the pipe with Teflon tape; the teeth help push the node into firm soil.'],
};
function showInfo(p){
  if(!INFO[p])return; infoPart=p;
  { $$('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab==='live')); $$('.pane').forEach(x=>x.hidden=x.id!=='pane-live'); }
  renderInfo();
  const map={m1:'under',m2:'under',ds:'under',tip:'tip',sht:'head',wet:'head',ldr:'head',panel:'head',antenna:'head',led:'head',head:'head',battery:'head',charger:'head',lora:'head',esp32:'head',pipe:'under'};
  if(['battery','charger','lora','esp32'].includes(p)&&!xray)toggleX(true);
  if(gl&&map[p])setCam(map[p]);
}
function renderInfo(){
  const p=infoPart, I=INFO[p]; if(!I)return;
  const L=hub.last, key={m1:'m1',m2:'m2',ds:'st',sht:'at',wet:'lw',ldr:'lx',battery:'bv'}[p];
  let val='';
  if(key&&L){const v=L[key];val='<p><b>Last reported:</b> <span class="mono">'+(isNA(v)?'NA':v.toFixed(key==='bv'?2:1))+'</span>'+(p==='sht'&&L?' · <span class="mono">'+fmt(L.ah,0)+' % RH</span>':'')+'</p>';}
  const html='<div class="sec">Selected part</div><div class="alert info info-card"><div class="ic">i</div><div class="info"><h4>'+I[0]+'</h4><span class="pill">'+I[1]+'</span><p>'+I[2]+'</p>'+val+'<button class="btn sm" data-act="closeInfo">Close</button></div></div>';
  if($('#infoBox')._h!==html){$('#infoBox').innerHTML=html;$('#infoBox')._h=html;}
}

/* ============================================================ controls */
let xray=false;
function toggleX(v){xray=v===undefined?!xray:v;$('#xrayBtn').classList.toggle('on',xray);}
function setScenario(k){
  climate=SC[k]; S.scenario=k;
  S.w.cloud=climate.cloud; S.w.rain=climate.rain; S.w.tshift=0;
  if(climate.soil){S.soil.m1=climate.soil.m1;S.soil.m2=climate.soil.m2;}
  if(climate.jump!==undefined) jumpTo(climate.jump);
  syncControls(); uiDirty.all=true;
}
function syncControls(){
  $('#cloud').value=Math.round(S.w.cloud*100); $('#rain').value=S.w.rain; $('#tshift').value=S.w.tshift; $('#drip').checked=S.w.drip;
  $$('.scn').forEach(b=>b.classList.toggle('on',b.dataset.sc===S.scenario));
}
function advance(min){const n=Math.max(0,Math.round(min));for(let i=0;i<n;i++)stepMinute();updateLW();uiDirty.all=true;uiDirty.log=true;}
function jumpTo(hour){const d0=Math.floor(S.t/1440)*1440;let tgt=d0+hour*60;if(tgt<=S.t)tgt+=1440;advance(tgt-S.t);}
function initUI(){
  buildCards(); buildLabels();
  $('#scenarios').innerHTML=Object.entries(SC).map(([k,v])=>'<button class="scn" data-sc="'+k+'"><b>'+v.name+'</b><span>'+v.d+'</span></button>').join('');
  $$('.scn').forEach(b=>b.addEventListener('click',()=>{setScenario(b.dataset.sc);toast(SC[b.dataset.sc].name);}));
  $('#cloud').addEventListener('input',e=>{S.w.cloud=e.target.value/100;S.scenario='custom';syncControls();});
  $('#rain').addEventListener('input',e=>{S.w.rain=+e.target.value;S.scenario='custom';syncControls();});
  $('#tshift').addEventListener('input',e=>{S.w.tshift=+e.target.value;S.scenario='custom';syncControls();});
  $('#drip').addEventListener('change',e=>{S.w.drip=e.target.checked;});
  $$('[data-jump]').forEach(b=>b.addEventListener('click',()=>{jumpTo(+b.dataset.jump);toast('Jumped to '+b.dataset.jump.padStart(2,'0')+':00');}));
  $('#skipDay').addEventListener('click',()=>{advance(1440);toast('+1 day simulated');});
  $$('.tab').forEach(t=>t.addEventListener('click',()=>{$$('.tab').forEach(x=>x.classList.toggle('on',x===t));$$('.pane').forEach(p=>p.hidden=p.id!=='pane-'+t.dataset.tab);try{localStorage.setItem('bhtab',t.dataset.tab);}catch(e){}}));
  $$('.vb[data-cam]').forEach(b=>b.addEventListener('click',()=>setCam(b.dataset.cam)));
  $('#xrayBtn').addEventListener('click',()=>toggleX());
  $('#labBtn').addEventListener('click',()=>{labelsOn=!labelsOn;$('#labBtn').classList.toggle('on',labelsOn);});
  $('#playBtn').addEventListener('click',()=>{S.playing=!S.playing;$('#playBtn').textContent=S.playing?'❚❚':'▶';});
  $('#speed').addEventListener('change',e=>S.speed=+e.target.value);
  $('#wakeBtn').addEventListener('click',()=>wake(true));
  $('#sleepSel').addEventListener('change',e=>{S.sleepMA=+e.target.value;});
  $('#drainBtn').addEventListener('click',()=>{S.bat.soc=CAP*.12;toast('Battery set to 12 %');uiDirty.all=true;});
  $('#fullBtn').addEventListener('click',()=>{S.bat.soc=CAP;if(node.off){node.off=false;node.nextWake=S.t+1;}toast('Battery full');uiDirty.all=true;});
  $('#copyPkt').addEventListener('click',()=>{if(!node.lastPkt)return;try{navigator.clipboard.writeText(node.lastPkt).then(()=>toast('Packet copied'),()=>toast('Copy blocked — select the text instead'));}catch(e){toast('Copy blocked — select the text instead');}});
  document.addEventListener('click',e=>{const a=e.target.closest('[data-act]');if(!a)return;const k=a.dataset.act;
    if(k==='irrigate'){S.w.drip=true;syncControls();toast('Drip irrigation started');}
    if(k==='stopIrr'){S.w.drip=false;syncControls();toast('Irrigation stopped');}
    if(k==='closeInfo'){infoPart=null;$('#infoBox').innerHTML='';$('#infoBox')._h='';}
    uiDirty.all=true;});
  const FL=[['m1','Moisture M1 unplugged','15 cm probe cable cut'],['ds','DS18B20 unplugged','Soil temperature probe off'],['sht','SHT31 wire loose','I²C CRC fails'],['hub','Hub offline','No ACK comes back'],['ant','Antenna loose','Weak link, most packets lost'],['dust','Panel covered in dust','Solar output down to 15 %']];
  $('#faultList').innerHTML=FL.map(f=>'<label class="sw"><div><b>'+f[1]+'</b><span>'+f[2]+'</span></div><input type="checkbox" class="toggle" data-fault="'+f[0]+'"></label>').join('');
  $$('[data-fault]').forEach(cb=>cb.addEventListener('change',()=>{S.faults[cb.dataset.fault]=cb.checked;toast((cb.checked?'Fault on: ':'Fault cleared: ')+cb.parentElement.querySelector('b').textContent+' — wait for the next wake or press Wake now');uiDirty.all=true;}));
  const HW=[['esp32','ESP32 38-pin DevKit','—'],['lora','SX1278 LoRa 433 MHz','SPI 18/19/23 · NSS5 · RST14 · DIO0 26'],['m1','Moisture v1.2 (15 cm)','GPIO32'],['m2','Moisture v1.2 (30 cm)','GPIO33'],['ds','DS18B20','GPIO4'],['sht','SHT31','I²C 21/22'],['ldr','LM393 LDR','GPIO34'],['wet','Water-level (wetness)','GPIO39'],['battery','18650 + divider','GPIO35'],['panel','Solar panel','TP4056 IN'],['charger','TP4056 + HT7833','3V3'],['led','Status LED','GPIO2'],['tip','Spiked tip','—']];
  $('#hwTable').innerHTML='<tr><th>Part</th><th>Pin</th></tr>'+HW.map(h=>'<tr data-part="'+h[0]+'" style="cursor:pointer"><td>'+h[1]+'</td><td class="m">'+h[2]+'</td></tr>').join('');
  $$('#hwTable tr[data-part]').forEach(tr=>tr.addEventListener('click',()=>showInfo(tr.dataset.part)));
  $('#demoBtn').addEventListener('click',()=>demo.start());
  $('#capNext').addEventListener('click',()=>demo.go(demo.i+1));
  $('#capPrev').addEventListener('click',()=>demo.go(demo.i-1));
  $('#capExit').addEventListener('click',()=>demo.stop());
  $('#tl').addEventListener('click',e=>{const r=$('#tl').getBoundingClientRect();const hour=(e.clientX-r.left)/r.width*24;jumpTo(hour);});
  try{const t=localStorage.getItem('bhtab');if(t){const b=document.querySelector('.tab[data-tab="'+t+'"]');if(b)b.click();}}catch(e){}
  syncControls();
}

/* ============================================================ judge demo */
function resetFaults(){Object.keys(S.faults).forEach(k=>S.faults[k]=false);$$('[data-fault]').forEach(cb=>cb.checked=false);}
const demo={i:-1,steps:[
  {t:'Meet the soil node',x:'One node, pushed into the field. Above ground: solar panel, LoRa antenna and air sensors. Below ground: two moisture probes and a soil thermometer. It wakes every 15 minutes, sends one packet, then sleeps.',
   run(){resetFaults();setScenario('normal');S.w.drip=false;syncControls();S.bat.soc=CAP*.78;S.sleepMA=0.5;$('#sleepSel').value='0.5';Object.assign(S.soil,{m1:46,m2:57,st:25.5,lw:0});hub.lwHours=0;jumpTo(8);setCam('overview');toggleX(false);}},
  {t:'The head',x:'Round solar panel on the lid, 433 MHz antenna, SHT31 inside a white sun shield, LDR light window and a slanted wetness strip for rain and dew. Inside: ESP32, SX1278 radio, 18650 cell and charger.',
   run(){setCam('head');toggleX(true);}},
  {t:'Below ground',x:'Moisture at 15 cm and 30 cm tells us how deep water reaches the roots. The DS18B20 reads soil temperature. The spiked tip helps push the node into hard soil.',
   run(){toggleX(false);setCam('under');}},
  {t:'One wake cycle',x:'Sensors power on from GPIO25 → every sensor is read → a text packet is built → LoRa sends it → the hub answers ACK → deep sleep. Watch the badge top-right.',
   run(){setCam('overview');setTimeout(()=>wake(true),500);}},
  {t:'Heatwave afternoon',x:'Hot, dry air pulls water out of the topsoil first. The hub spots M1 falling below 25 % and recommends irrigation — the plants are already starting to wilt.',
   run(){setScenario('heat');S.soil.m1=31;S.soil.m2=44;jumpTo(10);advance(330);setCam('overview');}},
  {t:'Drip irrigation',x:'Irrigation starts. The 15 cm probe responds within minutes; the 30 cm probe follows later as water soaks down. Proof that water actually reached the roots.',
   run(){S.w.drip=true;syncControls();advance(70);setCam('under');setTimeout(()=>{S.w.drip=false;syncControls();},6000);}},
  {t:'Monsoon rain',x:'Rain bursts wet the soil and the wetness strip. Long wet hours at warm temperature raise a fungal-disease warning on the hub.',
   run(){S.w.drip=false;syncControls();setScenario('monsoon');advance(560);setCam('overview');}},
  {t:'A sensor fails',x:'We unplug the DS18B20. The node does not crash: it sends ST=NA and every other value as usual, and the hub flags exactly which sensor to fix.',
   run(){setScenario('normal');hub.lwHours=0;S.soil.lw=0;S.faults.ds=true;$$('[data-fault="ds"]').forEach(c=>c.checked=true);setTimeout(()=>wake(true),400);document.querySelector('.tab[data-tab="packets"]').click();}},
  {t:'Hub offline',x:'If the hub does not answer, the node tries 3 times with a random pause, then goes back to sleep to save the battery. The hub shows the node as silent.',
   run(){S.faults.ds=false;S.faults.hub=true;syncFaultUI();setTimeout(()=>wake(true),400);setTimeout(()=>{if(demo.i===8){advance(40);}},5000);}},
  {t:'Power safety',x:'In a cloudy week the battery drops. First wake: below 3.40 V the node switches to hourly reports. A few seconds later the cell falls under 3.30 V — the node skips the radio and sleeps 6 h until the sun recharges it (v2.2 fix).',
   run(){resetFaults();setScenario('cloudy');S.bat.soc=CAP*.075;document.querySelector('.tab[data-tab="power"]').click();setTimeout(()=>wake(true),400);setTimeout(()=>{if(demo.i===9){S.bat.soc=CAP*.04;wake(true);}},5200);}},
],
  start(){this.go(0);},
  go(i){if(i<0)i=0;if(i>=this.steps.length){this.stop();return;}this.i=i;const s=this.steps[i];
    $('#caption').style.display='block';$('#capStep').textContent='Step '+(i+1)+' of '+this.steps.length;$('#capTitle').textContent=s.t;$('#capText').textContent=s.x;
    $('#capNext').textContent=i===this.steps.length-1?'Finish':'Next ▶';
    if(i<3||i>7) document.querySelector('.tab[data-tab="live"]').click();
    s.run(); uiDirty.all=true;},
  stop(){this.i=-1;$('#caption').style.display='none';resetFaults();toast('Demo finished — everything is live, play with it');}
};
function syncFaultUI(){$$('[data-fault]').forEach(cb=>cb.checked=!!S.faults[cb.dataset.fault]);}

/* ============================================================ boot */
window.__twin={S,node,hub,advance,wake,setScenario,demo,batV,addLog,anim,uiDirty,toast,hhmm,isNA};   // used by js/live-adapter.js
initUI();
initGL();
if(gl){initControls();setCam('overview');cam.tgt.set(0,-4,0);}
else{$('#noGL').style.display='grid';$('.viewbar').style.display='none';}
requestAnimationFrame(t=>{lastFrame=t;requestAnimationFrame(frame);});
})();
