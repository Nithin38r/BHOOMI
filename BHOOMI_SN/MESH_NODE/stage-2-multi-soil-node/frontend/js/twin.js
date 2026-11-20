/*
 * BHOOMI · Stage 2 · Multi Soil Node digital twin
 * 280 x 200 m field, seven soil nodes on six soil types, LoRa mesh routing (Dijkstra on link strength),
 * hub-built soil map, weather scenarios, per-node faults and a judge demo. Three.js r128.
 * Exposes window.__twin for js/live-adapter.js.
 */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const rnd = (a,b) => a + Math.random()*(b-a);
const fmt = (v,d) => v==null || Number.isNaN(v) ? "NA" : v.toFixed(d);
let mapDirty = true, linksDirty = true, alertsDirty = true, chartsDirty = true;

/* ================================================================ data */
const SCEN = {
  normal:   {name:"Clear Kharif day",  sub:"Sunny · 30 °C",     env:{temp:30,swing:9, hum:65,rain:0, cloud:15, irr:false,wind:.2}, start:{m1:56,m2:63,hour:6},  fc:{p:10,mm:0}},
  monsoon:  {name:"Monsoon downpour",  sub:"15 mm/h rain",      env:{temp:26,swing:3, hum:92,rain:15,cloud:95, irr:false,wind:.5}, start:{m1:58,m2:64,hour:9},  fc:{p:90,mm:40}},
  cyclone:  {name:"Cyclone landfall",  sub:"35 mm/h · no sun",  env:{temp:25,swing:2, hum:97,rain:35,cloud:100,irr:false,wind:1.6},start:{m1:74,m2:78,hour:8},  fc:{p:97,mm:140}},
  heatwave: {name:"Heatwave",          sub:"39 °C · dry air",   env:{temp:39,swing:12,hum:22,rain:0, cloud:0,  irr:false,wind:.3}, start:{m1:42,m2:48,hour:8},  fc:{p:0,mm:0}},
  drought:  {name:"Dry spell",         sub:"No rain for weeks", env:{temp:33,swing:10,hum:35,rain:0, cloud:10, irr:false,wind:.3}, start:{m1:31,m2:38,hour:9},  fc:{p:0,mm:0}},
  winter:   {name:"Rabi winter night", sub:"Cold · 15 °C mean", env:{temp:15,swing:13,hum:78,rain:0, cloud:5,  irr:false,wind:.1}, start:{m1:50,m2:58,hour:19}, fc:{p:5,mm:0}},
  fog:      {name:"Humid foggy night", sub:"97 % humidity",     env:{temp:24,swing:4, hum:97,rain:0, cloud:70, irr:false,wind:.1}, start:{m1:62,m2:66,hour:18}, fc:{p:30,mm:2}},
  irrigate: {name:"Dry field morning", sub:"All zones dry",     env:{temp:31,swing:9, hum:55,rain:0, cloud:10, irr:false,wind:.2}, start:{m1:27,m2:36,hour:7},  fc:{p:5,mm:0}},
};
const SOILS = {
  clay:  {name:"Clay loam",   note:"holds water well",          et:.9,  drain:.7, inflow:0,  seep:0,   solar:1,   temp:0,    off:[4,4],   ec:.8,  ph:7.2},
  sandy: {name:"Sandy loam",  note:"drains and dries fast",     et:1.25,drain:1.8,inflow:0,  seep:0,   solar:1,   temp:.5,   off:[-9,-8], ec:.35, ph:6.6},
  low:   {name:"Low corner",  note:"rain runs in and pools",    et:.9,  drain:.5, inflow:.7, seep:0,   solar:1,   temp:-.3,  off:[9,10],  ec:1.1, ph:7.4},
  canal: {name:"Near canal",  note:"seepage keeps it moist",    et:.95, drain:.8, inflow:0,  seep:1.1, solar:1,   temp:-.5,  off:[6,10],  ec:.9,  ph:7.3},
  shade: {name:"Tree shade",  note:"less sun, cooler",          et:.65, drain:.9, inflow:0,  seep:0,   solar:.45, temp:-1.6, off:[3,3],   ec:.6,  ph:6.9},
  bund:  {name:"Raised bund", note:"higher ground, dries fast", et:1.15,drain:1.4,inflow:0,  seep:0,   solar:1,   temp:.6,   off:[-6,-6], ec:.5,  ph:7.0},
};
const SLOTS = [
  {x:-110, z:-70, soil:"sandy", place:"north-west"}, {x:0, z:-80, soil:"clay", place:"north"}, {x:110, z:-70, soil:"shade", place:"north-east"},
  {x:110, z:70, soil:"low", place:"south-east"}, {x:0, z:80, soil:"canal", place:"south"}, {x:-110, z:70, soil:"bund", place:"south-west"},
  {x:0, z:0, soil:"clay", place:"centre"}, {x:-55, z:-5, soil:"clay", place:"west-centre"}, {x:58, z:5, soil:"bund", place:"east-centre"},
];
const IDS = ["7C9E1A","3F21A0","B4D7C2","91E04F","C2A8B3","5D3F77","0AE6D9","E7B214","68C0F5"];
const HUB = {label:"Hub", x:-178, z:0, tip:17, isHub:true};
const ZONES = ["North","Middle","South"], ZONE_Z = [-66, 0, 66];
const zoneOf = n => n.z < -33 ? 0 : n.z > 33 ? 2 : 1;
const zoneOfZ = z => z < -33 ? 0 : z > 33 ? 2 : 1;
const SENS = {
  m1:{long:"Moisture 15 cm",  unit:"%",  min:0,  max:100, step:1,  dec:1, noise:.6},
  m2:{long:"Moisture 30 cm",  unit:"%",  min:0,  max:100, step:1,  dec:1, noise:.6},
  st:{long:"Soil temperature",unit:"°C", min:5,  max:50,  step:.5, dec:1, noise:.1},
  at:{long:"Air temperature", unit:"°C", min:0,  max:50,  step:.5, dec:1, noise:.2},
  ah:{long:"Air humidity",    unit:"%",  min:0,  max:100, step:1,  dec:1, noise:.8},
  bv:{long:"Battery",         unit:"V",  min:3.0,max:4.2, step:.01,dec:2, noise:.01},
};
const KEYS = Object.keys(SENS);
const THRESH = -123, NODE_TIP = 9.3;
const SPRAYS = [
  {k:"ins",  name:"Insecticide · label waiting period 7 days",  short:"Insecticide", kind:"insect", phi:7,  hl:3},
  {k:"fun",  name:"Fungicide · label waiting period 14 days",   short:"Fungicide",   kind:"fungus", phi:14, hl:5},
  {k:"neem", name:"Neem-based bio spray · label waiting period 1 day", short:"Neem spray", kind:"insect", phi:1, hl:1},
];

const INFO = {
  node:{t:"BHOOMI soil node", part:"ESP32 38-pin + SX1278 (433 MHz) · 2 capacitive moisture probes (15/30 cm) · DS18B20 · SHT31 · LDR light · water-level wetness strip", pin:"Solar + 18650 + TP4056 + HT7833 · deep sleep between readings · firmware v2.2",
        why:"Wakes every 15 minutes and sends one LoRa packet. With mesh on, it also passes on packets from nodes further out."},
  hub:{t:"Hub · the farm's edge brain", part:"ESP32 + LoRa + 4G modem with SIM, on a 15 m mast at the farmhouse", pin:"Mains powered, battery backup",
       why:"Collects every packet, builds the soil map, raises alerts and sends SMS. All of this keeps working without the internet."},
  pump:{t:"Pump switch", part:"ESP32 + LoRa + relay on the starter coil · clip-on current sensor · phase monitor", pin:"Mains powered, so it can also relay packets",
        why:"Runs the motor only when told to, and stops it by itself on dry run, phase failure or too long a run, even if the hub and app are offline."},
  tank:{t:"Tank and valve node", part:"Ultrasonic level sensor · 3 solenoid zone valves · flow meter · pressure sensor · fertiliser injector", pin:"Mains powered",
        why:"Proves water was delivered: litres per zone, line pressure, and whether each zone's soil actually got wetter."},
  trap:{t:"Leaf and trap camera", part:"ESP32-CAM · yellow sticky card · small solar panel", pin:"Photo every 2 hours, counts sent over LoRa",
        why:"Counts whiteflies and aphids every day. Leaf photos go to the cloud AI for a disease check when the hub has internet."},
  pond:{t:"Pond node", part:"Floating probe: dissolved oxygen, pH, water temperature · aerator relay", pin:"Solar buoy, reaches the hub through the mesh",
        why:"Oxygen falls every night as fish and algae breathe. The node starts the aerator below 4 mg/L by itself and sends an SMS if oxygen keeps falling."},
  cold:{t:"Cold-room logger (future node)", part:"Temperature and humidity sensor · door switch · power monitor", pin:"Mains powered",
        why:"Protects harvested produce: alerts when the door stays open or the power goes off."},
};

/* ================================================================ state */
const S = {
  min:6*60, scenStart:6*60, env:{...SCEN.normal.env}, climate:0, speed:1, txp:5, mesh:true, autoPump:false,
  live:{airT:25,airH:70,solar:0,hour:6,raining:false}, scen:"normal", layer:"m1", sel:0, selDev:null, started:false,
  net:true, forecast:{p:10,mm:0}, buffered:0, smsKeys:new Set(), notes:new Map(), tab:"field", logFilter:"all", devHist:[],
};
let nodes = [];
const SPEED_MIN_PER_S = [0, 15, 60, 240];
const W = {pumpOn:false, current:0, runMin:0, maxRun:120, lockUntil:-1, tripReason:"", trips:[], dryRunMin:0, flowIn:0, flowOut:0, pressure:0,
  tankL:7000, cap:10000, valves:[false,false,false], blocked:[false,false,false], burst:false, dryWell:false, phaseFault:false, autoRefill:true,
  fert:false, litres:0, kWh:0, deliver:[0,0,0], zoneFlow:[0,0,0], sess:[null,null,null], checked:[false,false,false], notReached:[[],[],[]], day:0, report:null};
const P = {wf:14, ap:9, wetH:4, dis:10, sprays:[], aiQueue:0, aiResult:"", outbreak:1};
const PD = {do:6.8, ph:7.4, t:28, aer:false, fail:false, auto:true, manual:false};
const CR = {t:4.2, h:90, door:false, power:true};

const battV = n => 3.30 + 0.90*n.mAh/2600;
const alive = n => n.on && n.mAh > 0.5;
const txInterval = n => battV(n) < 3.40 ? 60 : 15;
const nodeColor = n => `--n${n.i+1}`;

/* devices (each has its own radio and joins the mesh) */
const DEV_UNUSED = {
  pump: {key:"pump", label:"Pump", id:"P1A2B3", type:"PUMP", x:-201.3, z:-57, tip:7,  every:15,  color:"--dv-water", power:() => true},
  tank: {key:"tank", label:"Tank", id:"T4C5D6", type:"TANK", x:-159,   z:-35, tip:12, every:15,  color:"--dv-water", power:() => true},
  trap: {key:"trap", label:"Trap cam", id:"C7E8F9", type:"TRAP", x:45.3, z:-35, tip:6, every:120, color:"--dv-crop", power:() => true},
  pond: {key:"pond", label:"Pond", id:"D0A1B2", type:"POND", x:82, z:172, tip:4, every:15, color:"--dv-pond", power:() => true},
  cold: {key:"cold", label:"Cold room", id:"E3C4D5", type:"COLD", x:-213.9, z:48, tip:7, every:15, color:"--dv-cold", power:() => CR.power, future:true},
};
const DEV = {};
const devs = () => Object.values(DEV);
devs().forEach((d,i) => Object.assign(d, {seq:0, nextTx:S.min + 2 + i*2.3, route:null, routeStr:"", relays:0, last:null, lastT:-1e9, rssi:null, isDev:true}));
const radioUp = r => r.isDev ? r.power() : alive(r);

function makeNode(i){
  const s = SLOTS[i];
  const n = {i, id:IDS[i], label:"N"+(i+1), x:s.x, z:s.z, soil:s.soil, place:s.place,
    m1:50, m2:58, st:26, pond:0, mAh:2600*rnd(.72,.95), seq:0, nextTx:S.min + 1 + i*1.6, on:true,
    lw:20, ec:.8, ph:7, ni:55, pi:50, ki:60,
    MODE:{m1:"auto",m2:"auto",st:"auto",at:"auto",ah:"auto",bv:"auto"}, MAN:{m1:40,m2:50,st:25,at:30,ah:60,bv:3.9},
    last:null, lastT:-1e9, route:null, routeStr:"", rssi:null, hist:[], relays:0};
  seedNode(n, SCEN[S.scen] || SCEN.normal);
  n.ec = SOILS[n.soil].ec; n.ph = SOILS[n.soil].ph; n.ni = rnd(42,62); n.pi = rnd(40,65); n.ki = rnd(50,72);
  return n;
}
function seedNode(n, sc){
  const so = SOILS[n.soil];
  n.m1 = clamp(sc.start.m1 + so.off[0] + rnd(-2,2), 5, 98);
  n.m2 = clamp(sc.start.m2 + so.off[1] + rnd(-2,2), 5, 99);
  n.pond = S.scen==="cyclone" && n.soil==="low" ? 14 : 0;
  n.st = sc.env.temp + S.climate + 1.5 + so.temp;
}
function modelVal(n,k){
  const so = SOILS[n.soil];
  switch(k){
    case "m1": return n.m1; case "m2": return n.m2; case "st": return n.st;
    case "at": return S.live.airT + so.temp*.5;
    case "ah": return clamp(S.live.airH + (n.soil==="shade"?3:0) + (n.soil==="canal"?2:0), 0, 100);
    case "bv": return battV(n);
  }
}
function reported(n,k){ if (n.MODE[k]==="off") return null; if (n.MODE[k]==="manual") return n.MAN[k]; return modelVal(n,k); }
const visual = (n,k) => n.MODE[k]==="manual" ? n.MAN[k] : modelVal(n,k);
const luxOf = n => clamp(S.live.solar*SOILS[n.soil].solar/10, 0, 100);   // relative light % (LDR)

/* ================================================================ models */
function step(dtH){
  const e = S.env, T0 = e.temp + S.climate, hour = (S.min/60) % 24, raining = e.rain > .2;
  const airT = T0 + e.swing/2*Math.sin(2*Math.PI*(hour-9)/24) - (raining?1.5:0);
  const solar0 = Math.max(0, Math.sin(Math.PI*(hour-6)/12)) * 1000 * (1 - .8*e.cloud/100);
  const airH = clamp(e.hum - 2.2*(airT-T0) + (raining?6:0), 5, 100);
  const night = solar0 < 5;
  S.live = {airT, airH, solar:solar0, hour, raining, night};
  stepWater(dtH);
  nodes.forEach(n => {
    const so = SOILS[n.soil], solar = solar0*so.solar, nT = airT + so.temp*.5, z = zoneOf(n), deliver = W.deliver[z];
    const water = e.rain*(1+so.inflow) + 12*deliver;
    const et = Math.max(0, .0016*solar*(1+(nT-25)/25)*(1-airH/130)) * so.et;
    let m1 = n.m1, m2 = n.m2;
    const infil = water*2.2*(1 - m1/102), drain = Math.max(0, m1-68)*.30*so.drain, cap = 6*so.drain;
    if (m1 > 94 && water > cap) n.pond += (water-cap)*.8*dtH;
    if (n.pond > 0){ const pin = Math.min(n.pond, (Math.max(0,100-m1)*.08 + .4*so.drain)*dtH); n.pond -= pin; m1 += pin*1.5; n.pond = Math.max(0, n.pond - et*dtH); }
    m1 += (infil - et*2.0 - drain)*dtH + so.seep*.25*(1-m1/85)*dtH;
    m2 += (drain*.9 - et*.5 - Math.max(0,m2-72)*.06*so.drain + so.seep*(1-m2/88))*dtH;
    if (m2 > 97) m1 += drain*.2*dtH;
    n.m1 = clamp(m1,2,100); n.m2 = clamp(m2,2,100); n.pond = clamp(n.pond,0,80);
    const target = T0 + 1.5 + so.temp + .35*(airT-T0) + solar*.004 - (n.m1>85?1:0);
    n.st += (target - n.st)*Math.min(1, dtH/2.5);
    // extra soil-node sensors
    n.lw = clamp((raining || airH >= 92) ? 100 : (night && airH > 85 ? 70 : clamp((airH-60)*1.5,0,40)) + (n.soil==="shade"?10:0), 0, 100);
    const fertOn = W.fert && deliver > 0, leach = e.rain > 8 && n.m1 > 85;
    n.ec += ((fertOn ? so.ec+1.3 : so.ec*(leach?.75:1)) - n.ec)*Math.min(1, dtH/(fertOn?3:20));
    n.ni = clamp(n.ni + ((fertOn?6:0) - (solar>50?.12:0) - (leach?.6:0))*dtH, 0, 100);
    n.ph += ((fertOn ? so.ph-.3 : so.ph) - n.ph)*Math.min(1, dtH/30);
    const charge = solar/1000*160, load = .15 + (60/txInterval(n))*(2*80/3600) + (n.relays > 0 ? .6 : 0);
    n.mAh = clamp(n.mAh + (charge-load)*dtH, 0, 2600);
  });
  stepCrop(dtH); stepPond(dtH); stepCold(dtH);
  waterAutomation();
}

/* ---- water: pump switch, tank, valves */
function stepWater(dtH){
  const dtM = dtH*60, day = Math.floor(S.min/1440);
  if (day !== W.day){ W.day = day; W.litres = 0; W.kWh = 0; }
  if (W.pumpOn){
    if (W.phaseFault) trip("Phase failure: one phase missing", 0);
    else if (W.dryWell){ W.current = 4.1; W.flowIn = 0; W.dryRunMin += dtM; if (W.dryRunMin >= 2) trip("Dry run: motor running with no water", 30); }
    else { W.current = 7.2 + .15*Math.sin(S.min*1.3); W.flowIn = 300; W.dryRunMin = 0; }
    if (W.pumpOn){ W.runMin += dtM; W.kWh += 3.7*dtH; if (W.runMin >= W.maxRun) trip(`Max runtime ${W.maxRun} min reached`, 0); }
  }
  if (!W.pumpOn){ W.current = 0; W.flowIn = 0; }
  const haveWater = W.tankL > 80; let out = 0;
  W.zoneFlow = [0,0,0];
  W.valves.forEach((o,z) => {
    if (!o || !haveWater){ W.deliver[z] = 0; return; }
    const f = W.blocked[z] ? 15 : 100;
    W.deliver[z] = (W.blocked[z] ? .12 : 1) * (W.burst ? .4 : 1);
    W.zoneFlow[z] = f*(W.burst ? .4 : 1); out += f;
  });
  const nOpen = W.valves.filter(Boolean).length;
  if (W.burst && nOpen && haveWater) out += 150;
  W.flowOut = out;
  W.pressure = !nOpen || !haveWater ? 0 : W.burst ? .35 : (W.valves.every((o,z) => !o || W.blocked[z]) ? 2.7 : 1.4);
  W.tankL = clamp(W.tankL + (W.flowIn - W.flowOut)*dtM, 0, W.cap);
  W.litres += W.flowOut*dtM;
  W.valves.forEach((o,z) => { if (o && W.sess[z]) W.sess[z].litres += W.zoneFlow[z]*dtM; });
}
function trip(reason, lockMin){
  W.pumpOn = false; W.tripReason = reason; W.lockUntil = S.min + lockMin; W.runMin = 0; W.dryRunMin = 0;
  W.trips.unshift({t:S.min, reason}); W.trips.length = Math.min(W.trips.length, 8);
  addLog({kind:"gw", str:`Pump switch stopped the motor by itself: ${reason}. This runs in the switch's own firmware${S.net ? "" : ", with the hub offline from the internet"}.`});
  alertsDirty = true;
}
function pumpCmd(on, why, who="Hub"){
  if (on){
    if (W.pumpOn) return;
    if (S.min < W.lockUntil){ if (who !== "Hub") addLog({kind:"gw", str:`Pump switch refused to start: locked for ${Math.ceil(W.lockUntil-S.min)} more min after a dry run`}); return; }
    if (W.phaseFault){ addLog({kind:"gw", str:"Pump switch refused to start: phase missing"}); return; }
    W.pumpOn = true; W.runMin = 0; W.tripReason = "";
  } else { if (!W.pumpOn) return; W.pumpOn = false; W.runMin = 0; }
  addLog({kind:"gw", str:`${who} → pump switch: ${on?"START":"STOP"} · ${why} · confirmed over LoRa`});
}
function setValve(z, on, why, who="Hub"){
  if (W.valves[z] === on) return;
  W.valves[z] = on;
  if (on){ W.sess[z] = {start:S.min, litres:0, m1:Object.fromEntries(nodes.filter(n => zoneOf(n)===z).map(n => [n.i, n.m1]))}; W.checked[z] = false; W.notReached[z] = []; }
  else { irrigationReport(z); W.sess[z] = null; W.notReached[z] = []; }
  addLog({kind:"gw", str:`${who} → ${ZONES[z]} zone valve: ${on?"OPEN":"CLOSED"} · ${why} · confirmed by the tank node`});
  alertsDirty = true;
}
function irrigationReport(z){
  const s = W.sess[z]; if (!s) return;
  const dur = S.min - s.start; if (dur < 5) return;
  const zn = nodes.filter(n => zoneOf(n)===z && s.m1[n.i] != null);
  const res = zn.map(n => ({n, rise:n.m1 - s.m1[n.i]}));
  const wet = res.filter(r => r.rise >= 6 || r.n.m1 >= 80), miss = res.filter(r => r.rise < 3 && r.n.m1 < 80 && dur >= 45);
  const text = `${ZONES[z]} zone · ${clockStr(s.start).split(" · ")[1]}–${clockStr(S.min).split(" · ")[1]} · ${Math.round(s.litres).toLocaleString("en-IN")} L delivered` +
    (wet.length ? ` · wetted: ${wet.map(r => `${r.n.label} (+${Math.max(0,r.rise).toFixed(0)} %)`).join(", ")}` : "") +
    (miss.length ? ` · NOT reached: ${miss.map(r => r.n.label).join(", ")}` : "");
  W.report = {text, ok:!miss.length};
  addLog({kind:"report", str:text});
  if (miss.length) addLog({kind:"sms", str:`SMS to farmer: Irrigation ${ZONES[z]} zone finished but water did not reach ${miss.map(r=>r.n.label).join(", ")}. Check the drip line.`});
}
function noteOnce(key, text, gapMin=360){
  const last = S.notes.get(key);
  if (last != null && S.min - last < gapMin) return;
  S.notes.set(key, S.min); addLog({kind:"gw", str:text});
}
function waterAutomation(){
  const pct = W.tankL/W.cap;
  if (W.pumpOn && pct >= .95) pumpCmd(false, "tank full (95 %)");
  else if (!W.pumpOn && W.autoRefill && pct < .35 && S.min >= W.lockUntil && !W.phaseFault) pumpCmd(true, `tank at ${Math.round(pct*100)} %`);
  if (W.tankL < 80) W.valves.forEach((o,z) => { if (o) setValve(z, false, "tank empty"); });
  W.valves.forEach((o,z) => {
    const s = W.sess[z];
    if (o && s && !W.checked[z] && S.min - s.start >= 60){
      W.checked[z] = true;
      const bad = nodes.filter(n => zoneOf(n)===z && alive(n) && s.m1[n.i] != null && n.m1 - s.m1[n.i] < 3 && n.m1 < 80).map(n => n.label);
      W.notReached[z] = bad;
      if (bad.length) addLog({kind:"gw", str:`Hub: ${ZONES[z]} valve open for 60 min but ${bad.join(", ")} is not getting wetter`});
      alertsDirty = true;
    }
  });
}
function irrigationControl(){
  return;
  const rainSoon = S.net && S.forecast.p >= 60;
  ZONES.forEach((zn, z) => {
    const f = nodes.filter(n => fresh(n) && zoneOf(n)===z);
    if (!f.length) return;
    const dry = f.filter(n => n.last.m1 != null && n.last.m1 < 30);
    const m2s = f.map(n => n.last.m2).filter(x => x != null), meanM2 = m2s.length ? m2s.reduce((a,b)=>a+b,0)/m2s.length : 0;
    const wet = f.some(n => n.pond > 3);
    if (W.valves[z]){
      if (S.live.raining) setValve(z, false, "rain on the farm");
      else if (meanM2 >= 72) setValve(z, false, `root zone full (average M2 ${meanM2.toFixed(0)} %)`);
      else if (wet) setValve(z, false, "waterlogging in this zone");
      else if (W.sess[z] && S.min - W.sess[z].start > 240) setValve(z, false, "4-hour limit reached");
    } else if (dry.length && !S.live.raining && !wet){
      const who = dry.map(n => `${n.label} ${n.last.m1.toFixed(0)} %`).join(", ");
      if (rainSoon) noteOnce(`skip${z}`, `Hub kept the ${zn} valve closed: ${who} is dry, but the cloud forecast says ${S.forecast.p} % chance of rain`);
      else if (W.tankL < 300) noteOnce(`tank${z}`, `Hub cannot water the ${zn} zone: tank empty`);
      else setValve(z, true, `${who} dry${S.net ? "" : " (no internet, so no forecast check)"}`);
    }
  });
}

/* ---- crop: trap camera, leaf disease, sprays */
function stepCrop(dtH){
  const T = S.live.airT, H = S.live.airH, rain = S.env.rain;
  const gW = Math.exp(-(((T-28)/6)**2)), gA = Math.exp(-(((T-22)/6)**2));
  const insectSpray = P.sprays.some(s => s.kind==="insect" && S.min - s.t < 5*1440);
  const rW = .45*gW*(H>55?1:.75)*P.outbreak - (rain>10?.6:0) - (insectSpray?1.6:0) - .08;
  const rA = .40*gA*P.outbreak - (rain>10?.6:0) - (insectSpray?1.6:0) - .08;
  P.wf = clamp(P.wf*Math.exp(rW*dtH/24), 1, 600); P.ap = clamp(P.ap*Math.exp(rA*dtH/24), 1, 600);
  const wet = rain > .2 || H >= 90 || (S.live.night && H > 85);
  P.wetH = clamp(P.wetH + ((wet?1:0) - P.wetH/24)*dtH, 0, 24);
  const fung = P.sprays.some(s => s.kind==="fungus" && S.min - s.t < 10*1440);
  const target = clamp((P.wetH-6)*7*(T>=18 && T<=32 ? 1 : .35), 0, 100)*(fung?.3:1);
  P.dis += (target - P.dis)*Math.min(1, dtH/8);
}
function meanSoil(){ const a = nodes.filter(alive); if (!a.length) return {t:25, m:50}; return {t:a.reduce((s,n)=>s+n.st,0)/a.length, m:a.reduce((s,n)=>s+n.m1,0)/a.length}; }
function safeInfo(s){
  const ms = meanSoil();
  const hl = s.hl*Math.pow(2, (25 - ms.t)/10)*(ms.m < 25 ? 1.3 : 1);
  const modelD = hl*3.32, days = Math.max(s.phi, modelD);
  return {modelD, days, left:s.t + days*1440 - S.min};
}
function fmtDur(min){ if (min <= 0) return "now"; const d = Math.floor(min/1440), h = Math.floor((min%1440)/60); return d ? `${d} d ${h} h` : `${h} h ${Math.floor(min%60)} min`; }
function logSpray(k){
  const p = SPRAYS.find(x => x.k===k); if (!p) return;
  P.sprays.unshift({...p, t:S.min}); if (P.sprays.length > 6) P.sprays.pop();
  if (p.kind==="insect") P.outbreak = 1;
  addLog({kind:"gw", str:`Spray logged in the app: ${p.short}. Safe-harvest timer started (never less than the label's ${p.phi} days).`});
  renderSprays(); alertsDirty = true;
}

/* ---- pond and cold room */
const doSat = T => 14.62 - .3898*T + .006969*T*T - .00005897*T*T*T;
function stepPond(dtH){
  PD.t += (S.live.airT + 1 - PD.t)*Math.min(1, dtH/10);
  const sat = doSat(PD.t), prod = 1.9*S.live.solar/1000, resp = .62*Math.pow(1.07, PD.t-20);
  const nat = .06*(sat-PD.do) + (S.env.wind > 1 ? .1*(sat-PD.do) : 0);
  if (PD.auto && !PD.manual){
    if (PD.do < 4 && !PD.aer){ PD.aer = true; addLog({kind:"gw", str:`Pond node started the aerator by itself: oxygen ${PD.do.toFixed(1)} mg/L`}); }
    else if (PD.do > 6.2 && PD.aer){ PD.aer = false; addLog({kind:"gw", str:`Pond node stopped the aerator: oxygen back to ${PD.do.toFixed(1)} mg/L`}); }
  }
  const aer = PD.aer && !PD.fail ? .45*(sat - PD.do) + .4 : 0;
  PD.do = clamp(PD.do + (prod - resp + nat + aer)*dtH, 0, 16);
  PD.ph += ((7.1 + .9*prod/1.9 - (S.live.night ? .25 : 0)) - PD.ph)*Math.min(1, dtH/3);
}
function stepCold(dtH){
  const tgt = !CR.power ? S.live.airT : CR.door ? 15 : 4;
  CR.t += (tgt - CR.t)*Math.min(1, dtH/(CR.door ? .7 : 2.5));
  CR.h += ((CR.door ? 70 : 90) - CR.h)*Math.min(1, dtH);
}

/* ================================================================ radio + mesh */
const dist = (a,b) => Math.hypot(a.x-b.x, a.z-b.z);
const atten = () => S.env.rain > 20 ? 4 : (S.env.rain > 5 ? 2 : 0);
const rssiAt = d => S.txp - 40 - 40*Math.log10(Math.max(d,5)) - atten();
const rangeM = () => Math.pow(10, (S.txp - 40 - atten() - THRESH)/40);
const radios = () => [...nodes.filter(alive), ...devs().filter(d => d.power())];
function computeRoutes(){
  const V = [HUB, ...radios()], D = new Map(), Pm = new Map(), done = new Set();
  V.forEach(v => D.set(v, Infinity)); D.set(HUB, 0);
  while (done.size < V.length){
    let u = null, best = Infinity;
    V.forEach(v => { if (!done.has(v) && D.get(v) < best){ best = D.get(v); u = v; } });
    if (!u) break; done.add(u);
    V.forEach(v => {
      if (done.has(v) || v === u) return;
      if (!S.mesh && !u.isHub) return;
      const r = rssiAt(dist(u,v)); if (r < THRESH) return;
      const c = 1 + Math.max(0, (-108 - r))/5;
      if (D.get(u) + c < D.get(v)){ D.set(v, D.get(u)+c); Pm.set(v, u); }
    });
  }
  const all = [...nodes, ...devs()];
  all.forEach(r => { r.relays = 0; });
  all.forEach(r => {
    if (!radioUp(r) || !Pm.has(r)) r.route = null;
    else { const path = [r]; let c = r; while (Pm.has(c)){ c = Pm.get(c); path.push(c); } r.route = path; }
  });
  all.forEach(r => { if (r.route) r.route.slice(1,-1).forEach(x => x.relays++); });
  all.forEach(r => {
    const up = radioUp(r), str = !up ? "off" : (r.route ? r.route.map(p => p.label).join(" → ") : "none");
    if (S.started && up && str !== r.routeStr){
      if (str === "none") addLog({kind:"mesh", str:`${r.label} lost its route to the hub. Its packets cannot get through.`});
      else if (r.routeStr) addLog({kind:"mesh", str:`${r.label} re-routed: ${str}`});
    }
    r.routeStr = str;
  });
  linksDirty = true;
}
const hopLoss = r => { const m = r - THRESH; return m < 3 ? .3 : m < 6 ? .08 : .01; };
function transmit(src, str){
  if (!src.route){ src.rssi = null; addLog({kind:"lost", head:`${src.label} → no route`, str, note:"dropped"}); return false; }
  const hops = src.route.length - 1;
  let worst = 0, lostAt = -1;
  for (let h=0; h<hops; h++){
    const r = Math.round(rssiAt(dist(src.route[h], src.route[h+1])) + rnd(-3,3));
    worst = h===0 ? r : Math.min(worst, r);
    if (r < THRESH || Math.random() < hopLoss(r)){ lostAt = h; break; }
  }
  src.rssi = worst;
  launchPacket(src, lostAt);
  const pathTxt = src.route.map(p => p.label).join(" → ");
  if (lostAt >= 0){ addLog({kind:"lost", head:pathTxt, str, note:`lost on hop ${lostAt+1} · ${worst} dBm`}); return false; }
  addLog({kind:"ok", head:pathTxt, str, note:`${hops} hop${hops>1?"s":""} · weakest ${worst} dBm`});
  if (!S.net) S.buffered++;
  return true;
}
function sendPacket(n){
  if (!alive(n)) return;
  n.seq++;
  const v = {};
  KEYS.forEach(k => {
    let x = reported(n,k);
    if (x != null && n.MODE[k]==="auto") x += (Math.random()*2-1)*SENS[k].noise;
    if (x != null && (k==="m1"||k==="m2"||k==="ah")) x = clamp(x,0,100);
    v[k] = x;
  });
  v.lw = n.lw; v.lx = luxOf(n); v.ec = n.ec; v.ph = n.ph; v.ni = n.ni; v.pi = n.pi; v.ki = n.ki;
  const hops = n.route ? n.route.length-1 : 0;
  const str = `AM1,ID=${n.id},T=SOIL,N=${n.seq},M1=${fmt(v.m1,1)},M2=${fmt(v.m2,1)},ST=${fmt(v.st,1)},AT=${fmt(v.at,1)},AH=${fmt(v.ah,1)},LW=${fmt(v.lw,0)},LX=${fmt(v.lx,1)},EC=NA,PH=NA,NPK=NA,BV=${fmt(v.bv,2)},HOP=${Math.max(0,hops-1)}`;
  if (transmit(n, str)){
    n.last = v; n.lastT = S.min; n.hist.push({t:S.min, m1:v.m1, m2:v.m2, b:n.mAh/26});
  } else n.hist.push({t:S.min, lost:true});
  trimHist(n.hist);
  mapDirty = alertsDirty = chartsDirty = true;
}
function sendDev(d){
  if (!d.power()) return;
  d.seq++;
  let body = "";
  if (d.key==="pump") body = `RUN=${W.pumpOn?1:0},I=${W.current.toFixed(1)},PHASE=${W.phaseFault?"FAIL":"OK"},RT=${Math.round(W.runMin)},Q=${W.flowIn}${W.tripReason?",TRIP=1":""}`;
  if (d.key==="tank") body = `LV=${Math.round(W.tankL/W.cap*100)},Q=${W.flowOut},P=${W.pressure.toFixed(2)},VLV=${W.valves.map(v=>v?1:0).join("")},LIT=${Math.round(W.litres)}`;
  if (d.key==="trap"){
    body = `WF=${Math.round(P.wf)},AP=${Math.round(P.ap)},LWH=${P.wetH.toFixed(0)},IMG=1`;
    if (P.dis >= 45){ if (S.net) P.aiResult = `AI on leaf photo: blast-like spots, ${Math.round(55 + P.dis*.4)} % match. Confirm in the field.`; else { P.aiQueue++; P.aiResult = ""; } }
    else if (S.net) P.aiResult = "AI on leaf photo: leaves look healthy.";
    drawCard(); devObjs.trap && (devObjs.trap.flashT = 1);
  }
  if (d.key==="pond") body = `DO=${PD.do.toFixed(1)},PH=${PD.ph.toFixed(1)},WT=${PD.t.toFixed(1)},AER=${PD.aer&&!PD.fail?1:0}`;
  if (d.key==="cold") body = `TC=${CR.t.toFixed(1)},H=${CR.h.toFixed(0)},DOOR=${CR.door?1:0}`;
  const str = `AM1,ID=${d.id},T=${d.type},N=${d.seq},${body}`;
  if (transmit(d, str)){ d.last = true; d.lastT = S.min; }
  alertsDirty = true;
}
function trimHist(h){ while (h.length && h[0].t < S.min - 1440) h.shift(); }
const fresh = n => n.last && (S.min - n.lastT) <= 2*txInterval(n) + 5;
const devFresh = d => d.last && (S.min - d.lastT) <= 2*d.every + 5;

/* ================================================================ rules */
function rules(){
  const out = [], add = (s,t,d,sms) => out.push({s,t,d,sms});
  const f = nodes.filter(fresh);
  nodes.filter(n => !fresh(n) && (!n.on || S.min - S.scenStart > 45)).forEach(n => add("crit", `${n.label} not reporting`,
    !n.on ? `Node failed. Its ${SOILS[n.soil].name.toLowerCase()} zone is unmonitored.` : (!n.route ? "No radio path to the hub. Turn on mesh relaying or raise transmit power." : (n.mAh <= .5 ? "Battery empty." : "Recent packets were lost on the way."))));
  devs().filter(d => !devFresh(d) && S.min - S.scenStart > 2*d.every + 10).forEach(d => add("warn", `${d.label} not reporting`, d.power() ? "No radio path to the hub." : "Device has no power."));
  ZONES.forEach((zn, z) => {
    const zf = f.filter(n => zoneOf(n)===z), dry = zf.filter(n => n.last.m1 != null && n.last.m1 < 30);
    if (W.valves[z]){
      add("info", `${zn} zone irrigating`, `${Math.round(W.sess[z]?.litres || 0).toLocaleString("en-IN")} L so far at ${W.zoneFlow[z].toFixed(0)} L/min. Closes when 30 cm moisture reaches 72 %.`);
      if (W.notReached[z].length) add("crit", `Water not reaching ${W.notReached[z].join(", ")}`, `The ${zn} valve has been open over an hour but the soil there is not getting wetter. Check that zone's drip line.`, `nr${z}`);
    } else if (dry.length && !S.live.raining){
      add("warn", `${zn} zone dry`, `${dry.map(n => `${n.label} ${n.last.m1.toFixed(0)} %`).join(", ")}. ${S.net && S.forecast.p >= 60 ? `Forecast: ${S.forecast.p} % chance of rain — wait before irrigating.` : "Irrigate this zone (see the Field + Irrigation twin)."}`);
    }
  });
  f.forEach(n => {
    const l = n.last;
    if (n.pond > 3 || (l.m1 != null && l.m2 != null && l.m1 >= 95 && l.m2 >= 90)) add("crit", `Waterlogging at ${n.label}`, `${SOILS[n.soil].name}: open the field drain there. Its zone valve stays shut.`, `wl${n.i}`);
    KEYS.forEach(k => { if (l[k] == null) add("warn", `${n.label}: ${SENS[k].long} not responding`, "Its packet says NA. Check the cable."); });
    if (l.bv != null && l.bv < 3.40) add("warn", `${n.label} battery low`, `${l.bv.toFixed(2)} V. Reporting hourly to save power.`);
  });
  if (!S.net) add("info", "Hub offline from the internet", `Rules, pump safety, SMS and the local app keep working. ${S.buffered} readings buffered for the cloud.`);
  const heat = S.live.airT >= 38, cold = S.live.airT <= 10;
  if (heat) add("crit", "Heat stress", `Air at ${S.live.airT.toFixed(1)} °C. Irrigate in the evening, not at noon.`);
  if (cold) add("warn", "Cold stress", `Air at ${S.live.airT.toFixed(1)} °C. Protect nursery seedlings tonight.`);
  if (P.wetH >= 10 && S.live.airT >= 18 && S.live.airT <= 32) add("warn", "Leaves wet for long", `Wetness strips wet ${P.wetH.toFixed(0)} of the last 24 h at ${S.live.airT.toFixed(0)} °C — fungal disease risk. Scout the crop.`);
  if (!out.length) add("ok", "Whole field normal", `${f.length} of ${nodes.length} soil nodes reporting. No action needed.`);
  const keys = new Set(out.filter(a => a.sms).map(a => a.sms));
  out.filter(a => a.sms).forEach(a => { if (!S.smsKeys.has(a.sms)){ S.smsKeys.add(a.sms); addLog({kind:"sms", str:`SMS to farmer: ${a.t}. ${a.d}`}); } });
  [...S.smsKeys].forEach(k => { if (!keys.has(k)) S.smsKeys.delete(k); });
  const rank = {crit:0, warn:1, info:2, ok:3};
  return out.sort((a,b) => rank[a.s]-rank[b.s]).slice(0, 14);
}

/* ================================================================ UI */
const scenBox = $("#scen");
Object.entries(SCEN).forEach(([id,s]) => {
  const b = document.createElement("button"); b.type = "button"; b.dataset.id = id; b.setAttribute("aria-pressed","false");
  b.innerHTML = `<b>${s.name}</b><span>${s.sub}</span>`;
  b.addEventListener("click", () => { stopTour(); applyScenario(id); });
  scenBox.appendChild(b);
});
const envCtl = { eTemp:{key:"temp", o:v=>`${v} °C`}, eHum:{key:"hum", o:v=>`${v} %`}, eRain:{key:"rain", o:v=>v==0?"none":`${v} mm/h`}, eCloud:{key:"cloud", o:v=>`${v} %`} };
Object.entries(envCtl).forEach(([id,c]) => $("#"+id).addEventListener("input", e => { S.env[c.key] = +e.target.value; $("#"+id+"O").textContent = c.o(+e.target.value); markCustom(); }));
$("#climate").addEventListener("input", e => { S.climate = +e.target.value; $("#climateO").textContent = `+${S.climate.toFixed(1)} °C`; });
$("#txp").addEventListener("input", e => { S.txp = +e.target.value; updTxp(); computeRoutes(); mapDirty = true; });
$("#mesh").addEventListener("change", e => { S.mesh = e.target.checked; computeRoutes(); mapDirty = true; addLog({kind:"mesh", str: S.mesh ? "Mesh relaying ON: far devices forward through neighbours" : "Mesh relaying OFF: each device must reach the hub directly"}); });
$("#addNode").addEventListener("click", () => addNode());
$("#resetNodes").addEventListener("click", () => { stopTour(); resetNodes(); });
function updTxp(){ $("#txpO").textContent = `${S.txp} dBm · range ≈ ${Math.round(rangeM())} m`; }
$$(".seg button").forEach(b => b.addEventListener("click", () => setSpeed(+b.dataset.s)));
function setSpeed(i){ S.speed = i; $$(".seg button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.s===i))); }
$$("[data-layer]").forEach(b => b.addEventListener("click", () => setLayer(b.dataset.layer)));
function setLayer(l){ S.layer = l; $$("[data-layer]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layer===l))); mapDirty = true; drawLegend(); }
$$("[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
function setTab(t){ S.tab = t; $$("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab===t))); $$("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== t); renderDevicePanels(); }
$$("[data-f]").forEach(b => b.addEventListener("click", () => { S.logFilter = b.dataset.f; $$("[data-f]").forEach(x => x.setAttribute("aria-pressed", String(x===b))); applyLogFilter(); }));

/* pond / cold / hub controls */
function renderSprays(){}
function syncFaultUI(){ $("#net").checked = S.net; }
$("#net").addEventListener("change", e => setNet(e.target.checked));
function setNet(on){
  S.net = on; $("#net").checked = on;
  if (on){
    addLog({kind:"gw", str:`Hub back online: uploaded ${S.buffered} buffered readings. Forecast updated.`});
    S.buffered = 0;
  } else addLog({kind:"gw", str:"Hub lost its internet link. Everything keeps running on the farm; data is buffered."});
  alertsDirty = true;
}

function kv(el, pairs){ el.innerHTML = pairs.map(([k,v,c]) => `<div><span>${k}</span><b class="${c||""}">${v}</b></div>`).join(""); }
function renderDevicePanels(){
  const t = S.tab;
  if (t === "water"){
    kv($("#pumpKv"), [
      ["Motor", W.pumpOn ? "RUNNING" : (W.tripReason ? "TRIPPED" : "stopped"), W.pumpOn ? "good" : (W.tripReason ? "bad" : "")],
      ["Current", `${W.current.toFixed(1)} A`, W.pumpOn && W.current < 5 ? "bad" : ""],
      ["Phases", W.phaseFault ? "1 missing" : "3 OK", W.phaseFault ? "bad" : "good"],
      ["Runtime", `${Math.round(W.runMin)} / ${W.maxRun} min`],
      ["Flow into tank", `${W.flowIn} L/min`],
      ["Energy today", `${W.kWh.toFixed(1)} kWh`],
    ]);
    kv($("#tankKv"), [
      ["Tank level", `${Math.round(W.tankL/W.cap*100)} %`, W.tankL/W.cap < .15 ? "bad" : ""],
      ["Volume", `${Math.round(W.tankL).toLocaleString("en-IN")} L`],
      ["Flow to field", `${W.flowOut} L/min`],
      ["Line pressure", `${W.pressure.toFixed(2)} bar`, W.burst && W.flowOut ? "bad" : (W.pressure > 2.4 ? "warn" : "")],
      ["Delivered today", `${Math.round(W.litres).toLocaleString("en-IN")} L`],
      ["Fertigation", W.fert ? "ON" : "off", W.fert ? "warn" : ""],
    ]);
    ZONES.forEach((zn,z) => { const b = $(`#vb${z}`); b.setAttribute("aria-pressed", String(W.valves[z]));
      b.querySelector("span").textContent = W.valves[z] ? `open · ${W.zoneFlow[z].toFixed(0)} L/min` : "closed"; });
    const r = W.report;
    $("#report").style.setProperty("--c", r ? (r.ok ? "var(--ok)" : "var(--crit)") : "var(--line)");
    $("#report").innerHTML = `<b>Last irrigation report</b>${r ? r.text : "No irrigation has finished yet."}`;
  }
  if (t === "crop"){
    kv($("#trapKv"), [
      ["Whiteflies / day", Math.round(P.wf), P.wf > 60 ? "bad" : ""],
      ["Aphids / day", Math.round(P.ap), P.ap > 60 ? "bad" : ""],
      ["Leaves wet (24 h)", `${P.wetH.toFixed(0)} h`, P.wetH > 12 ? "warn" : ""],
      ["Disease risk", `${Math.round(P.dis)} %`, P.dis >= 75 ? "bad" : P.dis >= 50 ? "warn" : "good"],
      ["AI leaf check", S.net ? (P.aiResult ? (P.dis >= 45 ? "spots found" : "healthy") : "next photo") : `${P.aiQueue} waiting`, P.dis >= 45 && P.aiResult ? "bad" : ""],
      ["Last photo", devFresh(DEV.trap) ? clockStr(DEV.trap.lastT).split(" · ")[1] : "–"],
    ]);
    renderSprays();
  }
  if (t === "pond"){
    kv($("#pondKv"), [
      ["Dissolved oxygen", `${PD.do.toFixed(1)} mg/L`, PD.do < 3 ? "bad" : PD.do < 4 ? "warn" : "good"],
      ["Saturation at this temp", `${doSat(PD.t).toFixed(1)} mg/L`],
      ["pH", PD.ph.toFixed(1)],
      ["Water temperature", `${PD.t.toFixed(1)} °C`],
      ["Aerator", PD.aer ? (PD.fail ? "ON · FAULT" : "running") : "off", PD.fail && PD.aer ? "bad" : (PD.aer ? "good" : "")],
      ["Control", PD.manual ? "manual" : (PD.auto ? "automatic" : "off")],
    ]);
    kv($("#coldKv"), [
      ["Temperature", `${CR.t.toFixed(1)} °C`, CR.t > 12 ? "bad" : CR.t > 8 ? "warn" : "good"],
      ["Humidity", `${CR.h.toFixed(0)} %`],
      ["Door", CR.door ? "OPEN" : "shut", CR.door ? "bad" : ""],
      ["Power", CR.power ? "on" : "CUT", CR.power ? "" : "bad"],
    ]);
  }
  if (t === "hub"){
    kv($("#hubKv"), [
      ["Internet (4G)", S.net ? "online" : "OFFLINE", S.net ? "good" : "bad"],
      ["Rain forecast 24 h", S.net ? `${S.forecast.p} % · ${S.forecast.mm} mm` : "not available"],
      ["Buffered readings", S.buffered],
      ["Soil nodes heard", `${nodes.filter(fresh).length} of ${nodes.length}`],
      ["Radio", "433.5 MHz · SF9"],
    ]);
  }
}

/* node list + node card */
const soilSel = $("#ncSoil");
Object.entries(SOILS).forEach(([k,s]) => { const o = document.createElement("option"); o.value = k; o.textContent = `${s.name} · ${s.note}`; soilSel.appendChild(o); });
soilSel.addEventListener("change", () => { const n = nodes[S.sel]; if (!n) return; n.soil = soilSel.value; addLog({kind:"gw", str:`${n.label} soil set to ${SOILS[n.soil].name}`}); renderNodeCard(); });
$("#ncOn").addEventListener("change", e => { const n = nodes[S.sel]; if (n) setNodeOn(n, e.target.checked); });
$("#ncBat").addEventListener("input", e => { const n = nodes[S.sel]; if (n) n.mAh = 2600*(+e.target.value)/100; });
function setNodeOn(n, on){
  n.on = on; if (!on) n.rssi = null; if (S.sel === n.i) $("#ncOn").checked = on;
  addLog({kind:"mesh", str: on ? `${n.label} (${n.id}) back online and re-joined the mesh` : `${n.label} (${n.id}) failed: no more packets from the ${n.place}`});
  computeRoutes(); buildNodeList(); alertsDirty = mapDirty = true;
}
function statusOf(r){
  if (r.isDev && !r.power()) return {t:"no power", c:"var(--crit)"};
  if (!r.isDev && !r.on) return {t:"failed", c:"var(--crit)"};
  if (!r.isDev && r.mAh <= .5) return {t:"battery empty", c:"var(--crit)"};
  if (!r.route) return {t:"no route", c:"var(--crit)"};
  const h = r.route.length-1; return {t: h===1 ? "direct" : `${h} hops`, c: h===1 ? "var(--ok)" : "var(--info)"};
}
function buildNodeList(){
  const box = $("#nodeList"); box.innerHTML = "";
  nodes.forEach(n => {
    const st = statusOf(n), b = document.createElement("button");
    b.type = "button"; b.className = "nrow"; b.style.setProperty("--k", `var(${nodeColor(n)})`); b.setAttribute("aria-pressed", String(n.i===S.sel && !S.selDev));
    b.innerHTML = `<i></i><b>${n.label}</b><span class="s">${SOILS[n.soil].name} · ${n.place}</span><span class="chip" style="--c:${st.c}">${st.t}</span><span class="v">${fmt(visual(n,"m1"),0)} %</span>`;
    b.addEventListener("click", () => selectNode(n.i));
    box.appendChild(b);
  });
  $("#addNode").disabled = nodes.length >= SLOTS.length;
}
function updateNodeListValues(){
  const rows = $("#nodeList").children;
  nodes.forEach((n,i) => { const r = rows[i]; if (!r) return; const st = statusOf(n);
    const chip = r.querySelector(".chip"); chip.textContent = st.t; chip.style.setProperty("--c", st.c);
    r.querySelector(".v").textContent = `${fmt(visual(n,"m1"),0)} %`; });
}
function selectNode(i){ S.sel = i; S.selDev = null; buildNodeList(); renderNodeCard(); tileSig = ""; renderTiles(); markTags(); renderInfo("node"); if (S.tab !== "field") setTab("field"); }
function selectDev(k){ S.selDev = k; tileSig = ""; renderTiles(); markTags(); renderInfo(k); buildNodeList();
  const tab = {pump:"water", tank:"water", trap:"crop", pond:"pond", cold:"pond"}[k]; if (tab) setTab(tab); }
function markTags(){ tagEls.forEach(t => t.el.classList.toggle("sel", t.dev ? t.dev === S.selDev : (!t.hub && !S.selDev && t.n.i === S.sel))); }

const ovBox = $("#ovs");
KEYS.forEach(k => {
  const s = SENS[k], o = document.createElement("div"); o.className = "ov";
  o.innerHTML = `<div class="ovh"><label for="mode-${k}">${s.long}</label><select id="mode-${k}"><option value="auto">Auto</option><option value="manual">Manual value</option><option value="off">Unplugged</option></select></div>
    <div class="mr"><input type="range" id="man-${k}" min="${s.min}" max="${s.max}" step="${s.step}" disabled aria-label="${s.long} manual value"><output id="mo-${k}"></output></div>`;
  ovBox.appendChild(o);
  const sel = o.querySelector("select"), rng = o.querySelector("input");
  sel.addEventListener("change", () => { const n = nodes[S.sel]; n.MODE[k] = sel.value;
    if (sel.value === "manual"){ n.MAN[k] = +clamp(modelVal(n,k), s.min, s.max).toFixed(s.dec); rng.value = n.MAN[k]; }
    rng.disabled = sel.value !== "manual"; updMan(k); });
  rng.addEventListener("input", () => { nodes[S.sel].MAN[k] = +rng.value; updMan(k); });
});
function updMan(k){ const n = nodes[S.sel], s = SENS[k]; if (!n) return; $(`#mo-${k}`).textContent = n.MODE[k]==="off" ? "NA" : `${fmt(reported(n,k), s.dec)} ${s.unit}`; }
function renderNodeCard(){
  const n = nodes[S.sel]; if (!n) return;
  $("#ncTitle").innerHTML = `<span style="color:var(${nodeColor(n)})">●</span> ${n.label} · ${n.id}`;
  $("#ncSub").textContent = `${n.place} of the field · ${ZONES[zoneOf(n)]} irrigation zone · ${SOILS[n.soil].note}`;
  soilSel.value = n.soil; $("#ncOn").checked = n.on;
  KEYS.forEach(k => { $(`#mode-${k}`).value = n.MODE[k]; const r = $(`#man-${k}`); r.disabled = n.MODE[k] !== "manual"; r.value = n.MAN[k]; updMan(k); });
}
function soilHex(m){ const a = [207,168,119], b = [74,51,34], t = clamp(m/100,0,1); return `rgb(${a.map((x,i)=>Math.round(lerp(x,b[i],t))).join(",")})`; }
function renderColumn(){
  const n = nodes[S.sel]; if (!n) return;
  const m1 = visual(n,"m1"), m2 = visual(n,"m2"), r1 = reported(n,"m1"), r2 = reported(n,"m2"), st = reported(n,"st");
  $("#colSvg").innerHTML = `
    <rect x="0" y="0" width="150" height="36" style="fill:var(--sunk)"/>
    <rect x="0" y="36" width="150" height="62" fill="${soilHex(m1)}"/><rect x="0" y="98" width="150" height="72" fill="${soilHex(m2)}"/>
    ${n.pond>1 ? `<rect x="0" y="${36-Math.min(8,n.pond/2)}" width="150" height="${Math.min(8,n.pond/2)}" fill="#4d86b9" opacity=".8"/>` : ""}
    ${W.deliver[zoneOf(n)] > 0 ? `<circle cx="120" cy="33" r="3" fill="#7fd0ff"/><circle cx="132" cy="30" r="2.4" fill="#7fd0ff"/>` : ""}
    <line x1="0" y1="36" x2="150" y2="36" style="stroke:var(--ink)" stroke-width="1.2"/>
    <rect x="18" y="6" width="14" height="150" rx="2" fill="#e8e9e3" style="stroke:var(--ink)"/>
    <rect x="32" y="64" width="44" height="9" fill="#2f8a4d"/><rect x="32" y="128" width="44" height="9" fill="#2f8a4d"/>
    <rect x="4" y="54" width="14" height="4" fill="#c7cdd2" style="stroke:var(--ink)" stroke-width=".6"/>
    <text x="80" y="72" style="font-family:var(--mono)" font-size="11" fill="#fff">15 cm ${fmt(r1,0)}%</text>
    <text x="80" y="136" style="font-family:var(--mono)" font-size="11" fill="#fff">30 cm ${fmt(r2,0)}%</text>
    <text x="36" y="56" style="font-family:var(--mono)" font-size="10" fill="#fff">${fmt(st,1)} °C</text>
    <text x="36" y="24" font-size="10" style="fill:var(--muted);font-family:var(--mono)">ground</text>`;
  $("#colTxt").innerHTML = `Soil column under ${n.label}. Darker soil = wetter.<br>Route: <b>${n.route ? n.route.map(p=>p.label).join(" → ") : "none"}</b><br>Relays for ${n.relays} device${n.relays===1?"":"s"} · ${statusOf(n).t}`;
  $("#ncBatO").textContent = `${Math.round(n.mAh/26)} % · ${battV(n).toFixed(2)} V`; $("#ncBat").value = Math.round(n.mAh/26);
}

/* tiles for whatever is selected */
const tilesBox = $("#readings"); let tileSig = "";
function routeTile(r){ const st = statusOf(r); return {l:"Route to hub", v: r.route ? `${r.route.length-1} hop${r.route.length>2?"s":""}` : "–", m: r.rssi != null && r.route ? `${r.rssi} dBm weakest` : st.t, c: r.route ? "" : "bad"}; }
function tileSpec(){
  if (S.selDev){
    const d = DEV[S.selDev], col = `var(${d.color})`, head = t => `<span style="color:${col}">●</span> ${t}`;
    if (d.key === "pump") return {title:head("Pump switch"), sub:`ID ${d.id} · ${W.trips.length} trips logged`, tiles:[
      {l:"Motor", v:W.pumpOn ? "ON" : "OFF", m:W.tripReason ? "tripped" : "ok", c:W.tripReason ? "bad" : "good"},
      {l:"Current", v:W.current.toFixed(1), u:"A", m:W.pumpOn && W.current < 5 ? "no load" : "normal 7.2 A", c:W.pumpOn && W.current < 5 ? "bad" : ""},
      {l:"Phases", v:W.phaseFault ? "1 lost" : "3 OK", c:W.phaseFault ? "bad" : "good", m:"monitor"},
      {l:"Runtime", v:Math.round(W.runMin), u:"min", m:`limit ${W.maxRun}`},
      {l:"Flow into tank", v:W.flowIn, u:"L/min", m:"flow meter"},
      {l:"Energy today", v:W.kWh.toFixed(1), u:"kWh", m:"3.7 kW motor"},
      {l:"Last trip", v:W.trips[0] ? clockStr(W.trips[0].t).split(" · ")[1] : "none", m:W.trips[0] ? W.trips[0].reason.split(":")[0] : "", c:W.trips[0] ? "bad" : ""},
      routeTile(d)]};
    if (d.key === "tank") return {title:head("Tank and zone valves"), sub:`ID ${d.id} · 10,000 L tank`, tiles:[
      {l:"Tank level", v:Math.round(W.tankL/W.cap*100), u:"%", m:"ultrasonic"},
      {l:"Flow to field", v:W.flowOut, u:"L/min", m:"flow meter"},
      {l:"Line pressure", v:W.pressure.toFixed(2), u:"bar", m:W.burst && W.flowOut ? "too low" : W.pressure > 2.4 ? "blockage?" : "normal", c:W.burst && W.flowOut ? "bad" : W.pressure > 2.4 ? "bad" : ""},
      ...ZONES.map((zn,z) => ({l:`${zn} valve`, v:W.valves[z] ? "OPEN" : "closed", m:W.valves[z] ? `${W.zoneFlow[z].toFixed(0)} L/min` : "", c:W.valves[z] ? "good" : ""})),
      {l:"Delivered today", v:Math.round(W.litres/1000*10)/10, u:"kL", m:W.fert ? "with fertiliser" : "plain water"},
      routeTile(d)]};
    if (d.key === "trap") return {title:head("Leaf and trap camera"), sub:`ID ${d.id} · photo every 2 h`, tiles:[
      {l:"Whiteflies", v:Math.round(P.wf), u:"/day", c:P.wf > 60 ? "bad" : "", m:"limit 60"},
      {l:"Aphids", v:Math.round(P.ap), u:"/day", c:P.ap > 60 ? "bad" : "", m:"limit 60"},
      {l:"Leaves wet", v:P.wetH.toFixed(0), u:"h / 24 h", m:"from soil nodes"},
      {l:"Disease risk", v:Math.round(P.dis), u:"%", c:P.dis >= 50 ? "bad" : "good", m:"wetness × temp"},
      {l:"AI leaf check", v:S.net ? (P.aiResult ? (P.dis >= 45 ? "spots" : "healthy") : "–") : "offline", m:S.net ? "cloud model" : `${P.aiQueue} queued`},
      {l:"Safe harvest", v:(() => { const a = P.sprays.map(safeInfo).filter(r => r.left > 0); return a.length ? fmtDur(Math.max(...a.map(r => r.left))) : "now"; })(), m:"spray log"},
      routeTile(d)]};
    if (d.key === "pond") return {title:head("Pond node"), sub:`ID ${d.id} · floating probe`, tiles:[
      {l:"Dissolved oxygen", v:PD.do.toFixed(1), u:"mg/L", c:PD.do < 3 ? "bad" : PD.do < 4 ? "manual" : "good", m:"fish need > 4"},
      {l:"pH", v:PD.ph.toFixed(1), m:"rises by day"},
      {l:"Water temp", v:PD.t.toFixed(1), u:"°C"},
      {l:"Aerator", v:PD.aer ? (PD.fail ? "FAULT" : "ON") : "off", c:PD.fail && PD.aer ? "bad" : PD.aer ? "good" : "", m:PD.manual ? "manual" : "auto < 4 mg/L"},
      {l:"O₂ saturation", v:doSat(PD.t).toFixed(1), u:"mg/L", m:"at this temp"},
      routeTile(d)]};
    if (d.key === "cold") return {title:head("Cold-room logger · future node"), sub:`ID ${d.id}`, tiles:[
      {l:"Temperature", v:CR.t.toFixed(1), u:"°C", c:CR.t > 8 ? "bad" : "good", m:"target 4 °C"},
      {l:"Humidity", v:CR.h.toFixed(0), u:"%"},
      {l:"Door", v:CR.door ? "OPEN" : "shut", c:CR.door ? "bad" : ""},
      {l:"Power", v:CR.power ? "on" : "CUT", c:CR.power ? "" : "bad"},
      routeTile(d)]};
  }
  const n = nodes[S.sel]; if (!n) return null;
  const on = alive(n), mt = k => ({m: n.MODE[k]==="auto" ? "Auto" : n.MODE[k]==="manual" ? "Manual" : "Unplugged", c:n.MODE[k]});
  return {title:`<span style="color:var(${nodeColor(n)})">●</span> ${n.label} · ${SOILS[n.soil].name}`, sub:`ID ${n.id} · ${n.place} · ${ZONES[zoneOf(n)]} zone · packet #${n.seq}`, tiles:[
    ...KEYS.map(k => ({l:SENS[k].long, v:fmt(on ? reported(n,k) : null, SENS[k].dec), u:SENS[k].unit, ...mt(k)})),
    {l:"Leaf/rain wetness", v:fmt(on ? n.lw : null, 0), u:"%", m:"water-level strip"},
    {l:"Light", v:fmt(on ? luxOf(n) : null, 0), u:"%", m:"LDR · relative"},
    {l:"EC · pH · NPK", v:"NA", m:"no RS485 probe yet"},
    routeTile(n)]};
}
function renderTiles(){
  const spec = tileSpec(); if (!spec) return;
  $("#selTitle").innerHTML = spec.title; $("#selSub").textContent = spec.sub;
  const sig = spec.tiles.map(t => t.l).join("|");
  if (sig !== tileSig){ tileSig = sig; tilesBox.innerHTML = spec.tiles.map((t,i) => `<div class="tile"><div class="tl">${t.l}</div><div class="tv"><span id="tv${i}"></span><span class="u" id="tu${i}"></span></div><div class="tm" id="tm${i}"></div></div>`).join(""); }
  spec.tiles.forEach((t,i) => { $("#tv"+i).textContent = t.v; $("#tu"+i).textContent = t.u || ""; const m = $("#tm"+i); m.textContent = t.m || ""; m.className = "tm " + (t.c || ""); });
}

/* log, alerts, info */
const logEl = $("#log");
function clockStr(min){ const d = Math.floor(min/1440)+1, h = Math.floor((min%1440)/60), m = Math.floor(min%60); return `Day ${d} · ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
function addLog(e){
  const li = document.createElement("li"), time = clockStr(S.min);
  li.className = e.kind; li.dataset.kind = e.kind;
  const tag = e.kind==="ok" ? `delivered · ${e.note}` : e.kind==="lost" ? e.note : e.kind==="mesh" ? "mesh" : e.kind==="sms" ? "sms" : e.kind==="report" ? "irrigation report" : "event";
  li.innerHTML = `<div class="meta"><span>${time}</span><b>${tag}</b></div>${e.head ? `<div class="path"></div>` : ""}<span></span>`;
  if (e.head) li.querySelector(".path").textContent = e.head;
  li.lastChild.textContent = e.str;
  filterOne(li);
  logEl.prepend(li);
  while (logEl.children.length > 400){ const old = [...logEl.children].reverse().find(x => x.dataset.kind === "ok" || x.dataset.kind === "lost") || logEl.lastChild; old.remove(); }
}
function filterOne(li){ const k = li.dataset.kind, f = S.logFilter; li.hidden = f==="all" ? false : f==="sms" ? k !== "sms" : (k==="ok" || k==="lost"); }
function applyLogFilter(){ [...logEl.children].forEach(filterOne); }
function renderAlerts(){ $("#alerts").innerHTML = rules().map(a => `<div class="alert sev-${a.s}"><b>${a.t}</b><span>${a.d}</span></div>`).join(""); }
function renderInfo(k){
  const i = INFO[k];
  if (!i){ $("#info").innerHTML = `<h2>How to read the farm</h2><p>Click any device, label or the hub mast. Lines are radio links; bright ones carry packets now. The ground colour is the soil map the hub builds. Blue dots in pipes are water flowing.</p>`; return; }
  $("#info").innerHTML = `<h2>${i.t}</h2><dl><dt>Hardware</dt><dd>${i.part}</dd><dt>Detail</dt><dd>${i.pin}</dd></dl><p>${i.why}</p>`;
}

/* charts */
function setupCanvas(cv){
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio||1);
  cv.width = Math.max(1, Math.round(r.width*dpr)); cv.height = Math.max(1, Math.round(r.height*dpr));
  const c = cv.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0); return {c, w:r.width, h:r.height};
}
function drawSeries(cv, series, refLine){
  const {c,w,h} = setupCanvas(cv), L = 32, R = 8, T = 6, B = 16, pw = w-L-R, ph = h-T-B;
  c.clearRect(0,0,w,h); c.font = `10px ${tok("--mono")}`; c.fillStyle = tok("--muted"); c.strokeStyle = tok("--line"); c.lineWidth = 1;
  for (let i=0;i<=4;i++){ const y = T + ph*i/4; c.beginPath(); c.moveTo(L,y+.5); c.lineTo(L+pw,y+.5); c.stroke(); c.textAlign = "right"; c.fillText(`${100-25*i}`, L-5, y+3); }
  c.textAlign = "left"; c.fillText("−24 h", L, h-3); c.textAlign = "right"; c.fillText("now", L+pw, h-3);
  const t0 = S.min - 1440, x = t => L + pw*clamp((t-t0)/1440,0,1), y = v => T + ph*(1-clamp(v,0,100)/100);
  if (refLine != null){ c.strokeStyle = tok("--crit"); c.setLineDash([4,3]); c.beginPath(); c.moveTo(L, y(refLine)); c.lineTo(L+pw, y(refLine)); c.stroke(); c.setLineDash([]); }
  series.forEach(s => {
    c.strokeStyle = tok(s.k); c.lineWidth = s.w || 1.6; c.globalAlpha = s.a || 1; c.beginPath();
    let pen = false, lp = null;
    s.pts.forEach(p => { if (p.v == null){ pen = false; return; } const px = x(p.t), py = y(p.v); pen ? c.lineTo(px,py) : c.moveTo(px,py); pen = true; lp = [px,py]; });
    c.stroke(); c.globalAlpha = 1;
    if (lp){ c.fillStyle = tok(s.k); c.beginPath(); c.arc(lp[0], lp[1], 2.8, 0, Math.PI*2); c.fill(); }
  });
}
function drawCharts(){
  const sel = S.selDev ? -1 : S.sel;
  const ser = key => nodes.map(n => ({k:nodeColor(n), w:n.i===sel ? 2.6 : 1.5, a:n.i===sel ? 1 : .8, pts:n.hist.map(p => ({t:p.t, v:p.lost ? null : p[key]}))}));
  drawSeries($("#ch1"), ser("m1")); drawSeries($("#ch2"), ser("m2"));
  drawSeries($("#ch3"), nodes.map(n => ({k:nodeColor(n), w:n.i===sel ? 2.6 : 1.5, a:n.i===sel ? 1 : .8, pts:n.hist.map(p => ({t:p.t, v:p.lost ? null : p.b}))})), 15);
  $("#chLegend").innerHTML = nodes.map(n => `<span style="--k:var(${nodeColor(n)})"><i></i>${n.label}</span>`).join("");
}

/* ================================================================ 3D scene */
const canvas = $("#c"), vp = $("#viewport");
let renderer;
try { renderer = new THREE.WebGLRenderer({canvas, antialias:true}); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1)); }
catch(err){ vp.insertAdjacentHTML("beforeend", `<div class="caption"><strong>3D view unavailable</strong>This browser has WebGL turned off. The readings, packets and decisions still work.</div>`); }
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);
scene.fog = new THREE.Fog(0x9cc9ea, 400, 1400);
const hemi = new THREE.HemisphereLight(0xe6f2ff, 0x5a4630, .75); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun);
const mat = (c,o={}) => new THREE.MeshStandardMaterial({color:c, roughness:.85, metalness:0, ...o});
const V3 = (x,y,z) => new THREE.Vector3(x,y,z);
const pickables = [];
const pickTag = (obj, key) => obj.traverse(o => { if (o.isMesh){ o.userData.pick = key; pickables.push(o); } });

/* ground, field, canal, trees */
const outer0 = 0;
const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1000), mat(0x7f9a5a)); outer.rotation.x = -Math.PI/2; outer.position.y = -.4; scene.add(outer);
const FW = 280, FD = 200;
const mapCv = document.createElement("canvas"); mapCv.width = FW; mapCv.height = FD;
const mapCtx = mapCv.getContext("2d"), mapImg = mapCtx.createImageData(FW, FD);
const mapTex = new THREE.CanvasTexture(mapCv);
const field = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({map:mapTex, roughness:.95}));
field.rotation.x = -Math.PI/2; scene.add(field);
const bundMat = mat(0x8f7650);
[[0,-FD/2,FW+4,3],[0,FD/2,FW+4,3],[-FW/2,0,3,FD],[FW/2,0,3,FD]].forEach(([x,z,w,d]) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w,1.2,d), bundMat); b.position.set(x,.6,z); scene.add(b); });
const canal = new THREE.Mesh(new THREE.BoxGeometry(FW+160, .6, 9), new THREE.MeshStandardMaterial({color:0x3f78a8, roughness:.2, metalness:.1})); canal.position.set(0,.05,FD/2+9); scene.add(canal);
for (let i=0;i<9;i++){
  const g = new THREE.Group(), x = 125 + rnd(-10,25), z = -95 + rnd(-25,10) - (i%3)*8;
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(.8,1.1,8,8), mat(0x6b4a2e)); tr.position.y = 4; g.add(tr);
  const cr = new THREE.Mesh(new THREE.SphereGeometry(rnd(6,9),12,10), mat(0x2f6b34)); cr.position.y = 12; cr.scale.y = .85; g.add(cr);
  g.position.set(x + (i%3)*14, 0, z); scene.add(g);
}
/* farmhouse + hub */
const house = new THREE.Group(); house.position.set(HUB.x - 14, 0, HUB.z + 14); scene.add(house);
const wallM = new THREE.Mesh(new THREE.BoxGeometry(18,7,12), mat(0xe8dcc4)); wallM.position.y = 3.5; house.add(wallM);
const roofM = new THREE.Mesh(new THREE.ConeGeometry(13,5,4), mat(0xa4472e)); roofM.position.y = 9.5; roofM.rotation.y = Math.PI/4; roofM.scale.z = .7; house.add(roofM);
const hubG = new THREE.Group(); hubG.position.set(HUB.x, 0, HUB.z); scene.add(hubG);
const mast = new THREE.Mesh(new THREE.CylinderGeometry(.35,.5,14,10), mat(0x8f9399,{metalness:.6,roughness:.4})); mast.position.y = 7; hubG.add(mast);
const hubBox = new THREE.Mesh(new THREE.BoxGeometry(2.4,2,1.6), mat(0xf2f2ee)); hubBox.position.set(0,9,.9); hubG.add(hubBox);
const hubAnt = new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,3,8), mat(0x1d1d1d)); hubAnt.position.y = 15.5; hubG.add(hubAnt);
const hubTipMat = new THREE.MeshStandardMaterial({color:0x553322, emissive:0xf0b44a, emissiveIntensity:0});
const hubTip = new THREE.Mesh(new THREE.SphereGeometry(.5,12,12), hubTipMat); hubTip.position.y = 17; hubG.add(hubTip);
pickTag(hubG, "hub");
/* cloud uplink beam */
const BN = 26, beamPos = new Float32Array(BN*3), beamGeo = new THREE.BufferGeometry(); beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPos,3));
const beam = new THREE.Points(beamGeo, new THREE.PointsMaterial({color:0x7bd389, size:1.6, transparent:true, opacity:.9})); beam.frustumCulled = false; scene.add(beam);
let beamOff = 0;

/* crop */
const clumps = [];
for (let x=-FW/2+5; x<=FW/2-5; x+=10) for (let z=-FD/2+5; z<=FD/2-5; z+=10) clumps.push({x:x+rnd(-1.5,1.5), z:z+rnd(-1.5,1.5), nearest:0});
const blades = [];
clumps.forEach((c,ci) => { for (let j=0;j<2;j++) blades.push({c:ci, yaw:j*2.1+rnd(0,.6), tilt:rnd(.15,.32), h:rnd(2.2,3.2), ph:rnd(0,6)}); });
const bladeGeo = new THREE.ConeGeometry(.22, 1, 4); bladeGeo.translate(0,.5,0);
const crop = new THREE.InstancedMesh(bladeGeo, mat(0xffffff,{roughness:.7}), blades.length);
const dummy = new THREE.Object3D(); dummy.rotation.order = "YXZ";
const cTmp = new THREE.Color(), GREEN = new THREE.Color(0x4f9a3a), STRAW = new THREE.Color(0xc4ab55), PALE = new THREE.Color(0x9bb35a);
blades.forEach((b,i) => crop.setColorAt(i, GREEN));
scene.add(crop);
function assignNearest(){ clumps.forEach(c => { let best = 1e9; nodes.forEach(n => { const d = Math.hypot(c.x-n.x, c.z-n.z); if (d < best){ best = d; c.nearest = n.i; } }); }); }

/* soil node models */
const nodeObjs = [];
function cellTexture(){
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 96; const c = cv.getContext("2d");
  c.fillStyle = "#16233d"; c.fillRect(0,0,128,96); c.strokeStyle = "#7f93b8"; c.lineWidth = 2;
  for (let i=0;i<=8;i++){ c.beginPath(); c.moveTo(i*16,0); c.lineTo(i*16,96); c.stroke(); }
  for (let j=0;j<=6;j++){ c.beginPath(); c.moveTo(0,j*16); c.lineTo(128,j*16); c.stroke(); }
  return new THREE.CanvasTexture(cv);
}
const CELL = cellTexture();
function buildNode(n){
  const g = new THREE.Group(); g.position.set(n.x, 0, n.z); g.scale.setScalar(30);
  const col = new THREE.Color(tok(nodeColor(n)) || "#ffffff");
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.043,.043,.178,24), mat(0xeeeeea,{roughness:.55})); head.position.y = .099; g.add(head);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.0435,.0435,.03,24), mat(col)); band.position.y = .13; g.add(band);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(.047,.047,.015,24), mat(0xd9dbd5)); lid.position.y = .185; g.add(lid);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(.117,.006,.067), [mat(0xaaaaaa),mat(0xaaaaaa),new THREE.MeshStandardMaterial({map:CELL,roughness:.3,metalness:.3}),mat(0x555555),mat(0xaaaaaa),mat(0xaaaaaa)]);
  panel.position.set(0,.215,.02); panel.rotation.x = .3; g.add(panel);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,.12,6), mat(0x1d1d1d)); ant.position.set(0,.25,-.03); g.add(ant);
  const tipM = new THREE.MeshStandardMaterial({color:0x552222, emissive:0xff5a2a, emissiveIntensity:0});
  const tip = new THREE.Mesh(new THREE.SphereGeometry(.009,10,10), tipM); tip.position.set(0,.31,-.03); g.add(tip);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.06,.008,.016), mat(0xdedede)); arm.position.set(-.073,.15,0); g.add(arm);
  for (let k=0;k<5;k++){ const p = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.002,16), mat(0xfafaf7)); p.position.set(-.13,.152-k*.01,0); g.add(p); }
  const ringM = new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:.9, side:THREE.DoubleSide});
  const ring = new THREE.Mesh(new THREE.RingGeometry(.25,.30,40), ringM); ring.rotation.x = -Math.PI/2; ring.position.y = .01; g.add(ring);
  g.traverse(o => { if (o.isMesh){ o.userData.pick = n.i; pickables.push(o); } });
  scene.add(g);
  nodeObjs[n.i] = {g, tipM, ringM, ring, col, headM:head.material};
}

/* ---- device models */
const devObjs = {};
const pvcMat = mat(0xd9d9d2,{roughness:.6}), dripMat = mat(0x2a2a2a,{roughness:.5}), steel = mat(0x8a8f94,{metalness:.5,roughness:.4});
function pipe(a, b, r, m, g){ const d = new THREE.Vector3().subVectors(b,a), len = d.length(); const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,8), m);
  mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(V3(0,1,0), d.normalize()); (g || scene).add(mesh); return mesh; }
function polyPipe(pts, r, m, g){ for (let i=0;i<pts.length-1;i++) pipe(pts[i], pts[i+1], r, m, g); }
function antenna(g, x, y0, y1, z){
  const a = new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,y1-y0,6), mat(0x1d1d1d)); a.position.set(x,(y0+y1)/2,z); g.add(a);
  const tm = new THREE.MeshStandardMaterial({color:0x552222, emissive:0xff5a2a, emissiveIntensity:0});
  const t = new THREE.Mesh(new THREE.SphereGeometry(.25,10,10), tm); t.position.set(x,y1,z); g.add(t); return tm;
}
function boxAt(g, w,h,d, m, x,y,z){ const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m); b.position.set(x,y,z); g.add(b); return b; }
function buildPump(){
  const g = new THREE.Group();
  boxAt(g, 9,5,7, mat(0xb5734f), -206,2.5,-60);
  const roof = boxAt(g, 10.4,.35,8, mat(0x6f7a80,{metalness:.4}), -206,5.25,-60); roof.rotation.z = .07;
  const casing = new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,1.2,12), steel); casing.position.set(-198.5,.6,-63); g.add(casing);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,1.8,16), mat(0x2f6f9f,{metalness:.3})); motor.rotation.z = Math.PI/2; motor.position.set(-198.8,1,-60); g.add(motor);
  const pb = new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.7,14), mat(0x3a3f44,{metalness:.5})); pb.rotation.z = Math.PI/2; pb.position.set(-197.5,1,-60); g.add(pb);
  pipe(V3(-198.5,1.2,-63), V3(-198.5,1.2,-61), .25, steel, g);
  boxAt(g, .45,1.4,1.1, mat(0x2d6a4c), -201.3,2.4,-57);
  const ledM = new THREE.MeshStandardMaterial({color:0x222222, emissive:0x22ff66, emissiveIntensity:0});
  const led = new THREE.Mesh(new THREE.SphereGeometry(.13,8,8), ledM); led.position.set(-201.05,2.9,-57); g.add(led);
  const tipM = antenna(g, -201.3, 3.1, 7, -57);
  scene.add(g); pickTag(g, "d:pump");
  devObjs.pump = {g, motor, ledM, tipM};
}
function buildTank(){
  const g = new THREE.Group(), cx = -160, cz = -35;
  [[-2.3,-2.3],[2.3,-2.3],[-2.3,2.3],[2.3,2.3]].forEach(([dx,dz]) => boxAt(g, .35,4,.35, steel, cx+dx,2,cz+dz));
  boxAt(g, 6,.35,6, mat(0x9aa0a6), cx,4.15,cz);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(2.7,2.7,4.6,28,1,true), new THREE.MeshStandardMaterial({color:0x1f2326, transparent:true, opacity:.4, side:THREE.DoubleSide, depthWrite:false}));
  shell.position.set(cx,6.6,cz); g.add(shell);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.75,2.75,.25,28), mat(0x24282b)); top.position.set(cx,9,cz); g.add(top);
  const wGeo = new THREE.CylinderGeometry(2.55,2.55,1,28); wGeo.translate(0,.5,0);
  const water = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({color:0x3a86c8, transparent:true, opacity:.85})); water.position.set(cx,4.35,cz); g.add(water);
  boxAt(g, .6,.4,.6, mat(0x2d6a4c), cx+1,9.3,cz);
  const tipM = antenna(g, cx+1, 9.5, 12, cz);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.8,.8,1.6,16), mat(0x2b62b8)); drum.position.set(cx+5,.8,cz+3.5); g.add(drum);
  pipe(V3(cx+5,1.4,cz+3.5), V3(cx+2,1,cz+2), .1, dripMat, g);
  scene.add(g); pickTag(g, "d:tank");
  devObjs.tank = {g, water, tipM, drum};
  polyPipe([V3(-197,1,-60), V3(-195.5,1,-60), V3(-195.5,1,-38), V3(-164,1,-38), V3(-164,9.3,-38), V3(-161.5,9.3,-36)], .3, pvcMat);
  polyPipe([V3(-158,4.3,-33), V3(-158,.9,-33), V3(-146,.9,-33)], .3, pvcMat);
  pipe(V3(-146,.9,-70), V3(-146,.9,70), .35, pvcMat);
  devObjs.valves = ZONE_Z.map((zz, z) => {
    pipe(V3(-146,.6,zz), V3(138,.6,zz), .2, dripMat);
    const vg = new THREE.Group();
    boxAt(vg, .9,.9,.9, mat(0x6d7378,{metalness:.4}), -143,1.1,zz);
    const sol = new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.7,12), mat(0x222222)); sol.position.set(-143,1.9,zz); vg.add(sol);
    const lm = new THREE.MeshStandardMaterial({color:0x222222, emissive:0xff4433, emissiveIntensity:.8});
    const l = new THREE.Mesh(new THREE.SphereGeometry(.22,8,8), lm); l.position.set(-143,2.4,zz); vg.add(l);
    scene.add(vg); pickTag(vg, "d:tank");
    return {lm};
  });
}
const cardCv = document.createElement("canvas"); cardCv.width = 180; cardCv.height = 120;
const cardTex = new THREE.CanvasTexture(cardCv);
function drawCard(){
  const c = cardCv.getContext("2d"); c.fillStyle = "#f2d531"; c.fillRect(0,0,180,120);
  c.strokeStyle = "rgba(0,0,0,.18)"; c.lineWidth = 1;
  for (let x=20;x<180;x+=20){ c.beginPath(); c.moveTo(x,0); c.lineTo(x,120); c.stroke(); }
  for (let y=20;y<120;y+=20){ c.beginPath(); c.moveTo(0,y); c.lineTo(180,y); c.stroke(); }
  const n = Math.min(300, Math.round((P.wf + P.ap)*.9)); let s = 7;
  const r = () => (s = (s*9301 + 49297) % 233280) / 233280;
  for (let i=0;i<n;i++){ const x = r()*172+4, y = r()*112+4; c.fillStyle = i%3 ? "#1d1d1d" : "#4c5e2b"; c.beginPath(); c.arc(x,y, i%3 ? 1.6 : 2.2, 0, Math.PI*2); c.fill(); }
  cardTex.needsUpdate = true;
}
function buildTrap(){
  const g = new THREE.Group(), x = 45, z = -35;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.1,.12,4.2,8), steel); pole.position.set(x,2.1,z); g.add(pole);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(2,1.35), new THREE.MeshStandardMaterial({map:cardTex, side:THREE.DoubleSide, roughness:.6})); card.position.set(x,2.7,z+.15); g.add(card);
  boxAt(g, .1,.1,2.1, steel, x,3.55,z+1.1);
  boxAt(g, .5,.42,.6, mat(0x222222), x,3.2,z+2.1);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.15,12), mat(0x111111,{metalness:.8})); lens.rotation.x = Math.PI/2; lens.position.set(x,3.2,z+1.75); g.add(lens);
  const flashM = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0, depthWrite:false});
  const flash = new THREE.Mesh(new THREE.SphereGeometry(.6,10,10), flashM); flash.position.set(x,3.2,z+1.6); g.add(flash);
  const pnl = boxAt(g, 1,.05,.7, new THREE.MeshStandardMaterial({map:CELL, roughness:.3}), x,4.3,z); pnl.rotation.x = .3;
  const tipM = antenna(g, x+.3, 4.2, 6, z);
  scene.add(g); pickTag(g, "d:trap");
  devObjs.trap = {g, flashM, tipM, flashT:0};
  drawCard();
}
function buildPond(){
  const g = new THREE.Group(), cx = 70, cz = 168, PW = 70, PDp = 40;
  boxAt(g, PW+2, 1, PDp+2, mat(0x6b5a3e), cx,-.9,cz);
  const waterM = new THREE.MeshStandardMaterial({color:0x2f7f86, roughness:.15, metalness:.1, transparent:true, opacity:.93});
  const water = new THREE.Mesh(new THREE.PlaneGeometry(PW,PDp), waterM); water.rotation.x = -Math.PI/2; water.position.set(cx,-.35,cz); g.add(water);
  [[0,-PDp/2-2,PW+8,3],[0,PDp/2+2,PW+8,3],[-PW/2-2.5,0,3,PDp+2],[PW/2+2.5,0,3,PDp+2]].forEach(([dx,dz,w,d]) => boxAt(g, w,1.3,d, bundMat, cx+dx,.25,cz+dz));
  const ax = cx-10, az = cz-4;
  [-1.4, 1.4].forEach(o => { const fl = new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,3.2,10), mat(0xe8e8e2)); fl.rotation.x = Math.PI/2; fl.position.set(ax+o,-.1,az); g.add(fl); });
  boxAt(g, 1.6,.9,1.1, mat(0x2f6f9f,{metalness:.3}), ax,.6,az-1.8);
  const wheel = new THREE.Group(); wheel.position.set(ax,.35,az);
  for (let k=0;k<6;k++){ const a = k/6*Math.PI*2; const p = new THREE.Mesh(new THREE.BoxGeometry(2.2,.08,.7), mat(0xd9dcd5)); p.position.set(0, Math.sin(a)*.65, Math.cos(a)*.65); p.rotation.x = -a; wheel.add(p); }
  g.add(wheel);
  const SN = 140, spPos = new Float32Array(SN*3), spGeo = new THREE.BufferGeometry(); spGeo.setAttribute("position", new THREE.BufferAttribute(spPos,3));
  const splash = new THREE.Points(spGeo, new THREE.PointsMaterial({color:0xe8f6ff, size:.45, transparent:true, opacity:.9})); splash.frustumCulled = false; g.add(splash);
  const sp = Array.from({length:SN}, () => ({p:Math.random(), dx:rnd(-1.2,1.2), dz:rnd(.5,3.5)}));
  const buoy = new THREE.Group(); buoy.position.set(82,-.2,172);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.75,14,12), mat(0xe8742e)); buoy.add(ball);
  const tipM = antenna(buoy, 0, .5, 4.2, 0);
  g.add(buoy);
  const fish = Array.from({length:10}, () => { const f = new THREE.Mesh(new THREE.BoxGeometry(.9,.25,.35), mat(0xe58a3a)); f.position.set(cx+rnd(-30,30), -.3, cz+rnd(-16,16)); f.rotation.y = rnd(0,6); f.visible = false; g.add(f); return f; });
  scene.add(g); pickTag(g, "d:pond");
  devObjs.pond = {waterM, wheel, buoy, tipM, fish, splash, spPos, spGeo, sp, ax, az};
}
function buildCold(){
  const g = new THREE.Group(), x = -218, z = 46;
  boxAt(g, 8,5,6, mat(0xf3f5f6,{roughness:.4}), x,2.5,z);
  const pivot = new THREE.Group(); pivot.position.set(x+4.05,0,z-1.6);
  const door = new THREE.Mesh(new THREE.BoxGeometry(.12,4,3), mat(0xc9d4dc)); door.position.set(0,2,1.5); pivot.add(door); g.add(pivot);
  boxAt(g, 2.4,1.1,1.8, mat(0x9aa3aa,{metalness:.4}), x-1,5.55,z);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.08,16), mat(0x333333)); fan.rotation.z = Math.PI/2; fan.position.set(x+.24,5.55,z); g.add(fan);
  const fb = boxAt(g, .9,.08,.15, mat(0x777777), x+.29,5.55,z);
  boxAt(g, .4,.5,.3, mat(0x2d6a4c), x+4.15,3.5,z+2);
  const tipM = antenna(g, x+4.15, 3.8, 7, z+2);
  scene.add(g); pickTag(g, "d:cold");
  devObjs.cold = {pivot, fb, tipM};
}

/* water flow particles along pipes */
function flowLine(points, count, color, size){
  const curve = new THREE.CurvePath(); for (let i=0;i<points.length-1;i++) curve.add(new THREE.LineCurve3(points[i], points[i+1]));
  const pos = new Float32Array(count*3), geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos,3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({color, size, transparent:true, opacity:.95})); pts.frustumCulled = false; pts.visible = false; scene.add(pts);
  return {curve, pos, geo, pts, count, off:Math.random(), len:curve.getLength()};
}
const tmpP = new THREE.Vector3();
function runFlow(f, active, speed, dt){
  f.pts.visible = active; if (!active) return;
  f.off = (f.off + dt*speed/f.len) % 1;
  for (let i=0;i<f.count;i++){ const t = (i/f.count + f.off) % 1; f.curve.getPointAt(t, tmpP); f.pos[i*3] = tmpP.x; f.pos[i*3+1] = tmpP.y + .35; f.pos[i*3+2] = tmpP.z; }
  f.geo.attributes.position.needsUpdate = true;
}
let flowIn, flowZones, burstPts, burstPos, burstD;
function buildFlows(){
  flowIn = flowLine([V3(-197,1,-60), V3(-195.5,1,-60), V3(-195.5,1,-38), V3(-164,1,-38), V3(-164,9.3,-38), V3(-161.5,9.3,-36)], 40, 0x7fd0ff, 1.1);
  flowZones = ZONE_Z.map(zz => flowLine([V3(-158,4.3,-33), V3(-158,.9,-33), V3(-146,.9,-33), V3(-146,.9,zz), V3(138,.9,zz)], 80, 0x7fd0ff, 1.2));
  burstPos = new Float32Array(160*3); const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(burstPos,3));
  burstPts = new THREE.Points(bg, new THREE.PointsMaterial({color:0xbfe8ff, size:.7, transparent:true, opacity:.9})); burstPts.frustumCulled = false; burstPts.visible = false; scene.add(burstPts);
  burstD = Array.from({length:160}, () => ({p:Math.random(), a:rnd(0,6.28), r:rnd(.5,3)}));
}

/* radio links + perimeter */
const linkGroup = new THREE.Group(); scene.add(linkGroup);
const tipOf = p => V3(p.x, p.tip != null ? p.tip : NODE_TIP, p.z);
const qualColor = r => { const m = r - THRESH; return m < 4 ? 0xe0583f : m < 10 ? 0xf0b44a : 0x5cc08a; };
function rebuildLinks(){
  linksDirty = false;
  while (linkGroup.children.length){ const c = linkGroup.children.pop(); c.geometry.dispose(); }
  const V = [HUB, ...radios()], routeEdges = new Set();
  [...nodes, ...devs()].forEach(r => { if (r.route) for (let h=0; h<r.route.length-1; h++) routeEdges.add(r.route[h].label + ">" + r.route[h+1].label); });
  for (let a=0; a<V.length; a++) for (let b=a+1; b<V.length; b++){
    const A = V[a], B = V[b], r = rssiAt(dist(A,B));
    if (r < THRESH) continue;
    if (!S.mesh && !(A.isHub || B.isHub)) continue;
    const used = routeEdges.has(A.label+">"+B.label) || routeEdges.has(B.label+">"+A.label);
    if (used){
      const curve = new THREE.QuadraticBezierCurve3(tipOf(A), tipOf(A).lerp(tipOf(B), .5).add(V3(0, 6, 0)), tipOf(B));
      linkGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .45, 6, false), new THREE.MeshBasicMaterial({color:qualColor(r), transparent:true, opacity:.9})));
    } else {
      linkGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tipOf(A), tipOf(B)]), new THREE.LineBasicMaterial({color:0xffffff, transparent:true, opacity:.22})));
    }
  }
  const live = nodes.filter(alive), hull = convexHull(live.map(n => [n.x, n.z]));
  if (hull.length >= 3){
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...hull, hull[0]].map(p => V3(p[0], 1.5, p[1]))), new THREE.LineDashedMaterial({color:0xf0b44a, dashSize:6, gapSize:4}));
    line.computeLineDistances(); linkGroup.add(line);
    let a = 0; for (let i=0;i<hull.length;i++){ const p = hull[i], q = hull[(i+1)%hull.length]; a += p[0]*q[1] - q[0]*p[1]; }
    $("#areaV").textContent = `${(Math.abs(a)/2/10000).toFixed(2)} ha · ${live.length} nodes`;
  } else $("#areaV").textContent = `– · ${live.length} nodes`;
  if (S.layer === "cov") live.forEach(n => {
    const R = rangeM(), pts = []; for (let k=0;k<=64;k++){ const a = k/64*Math.PI*2; pts.push(V3(n.x + Math.cos(a)*R, 1, n.z + Math.sin(a)*R)); }
    linkGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:new THREE.Color(tok(nodeColor(n))), transparent:true, opacity:.7})));
  });
}
function convexHull(p){
  if (p.length < 3) return p.slice();
  const s = p.slice().sort((a,b) => a[0]-b[0] || a[1]-b[1]), cr = (o,a,b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lo = [], up = [];
  s.forEach(q => { while (lo.length >= 2 && cr(lo[lo.length-2], lo[lo.length-1], q) <= 0) lo.pop(); lo.push(q); });
  s.slice().reverse().forEach(q => { while (up.length >= 2 && cr(up[up.length-2], up[up.length-1], q) <= 0) up.pop(); up.push(q); });
  return lo.slice(0,-1).concat(up.slice(0,-1));
}

/* soil map */
const RAMPS = {
  m:[[0,[181,121,58]],[30,[217,178,90]],[55,[111,174,79]],[75,[63,143,122]],[100,[42,95,168]]],
  t:[[10,[58,120,196]],[22,[124,192,106]],[32,[228,192,74]],[42,[210,80,47]]],
  n:[[0,[196,92,58]],[30,[226,176,82]],[60,[120,180,86]],[100,[40,120,70]]],
};
function ramp(r, v){ for (let i=1;i<r.length;i++){ if (v <= r[i][0]){ const a = r[i-1], b = r[i], t = clamp((v-a[0])/(b[0]-a[0]),0,1); return a[1].map((x,j)=>lerp(x,b[1][j],t)); } } return v < r[0][0] ? r[0][1] : r[r.length-1][1]; }
function paintMap(){
  mapDirty = false;
  const d = mapImg.data, layer = S.layer;
  const known = layer === "cov" ? nodes.filter(alive) : nodes.filter(n => fresh(n) && n.last[layer] != null);
  const rr = layer === "st" ? RAMPS.t : layer === "ni" ? RAMPS.n : RAMPS.m;
  for (let py=0; py<FD; py++) for (let px=0; px<FW; px++){
    const x = -FW/2 + px + .5, z = -FD/2 + py + .5, o = (py*FW + px)*4;
    let rgb;
    if (layer === "cov"){ let best = -999; known.forEach(n => { best = Math.max(best, rssiAt(Math.hypot(x-n.x, z-n.z))); }); const m = best - THRESH; rgb = m < 0 ? [92,74,58] : m < 8 ? [216,163,58] : [79,163,106]; }
    else if (!known.length) rgb = [120,112,98];
    else {
      let ws = 0, vs = 0, near = 1e9;
      known.forEach(n => { const dd = Math.hypot(x-n.x, z-n.z) + 4; near = Math.min(near, dd); const w = 1/(dd*dd); ws += w; vs += w*n.last[layer]; });
      rgb = ramp(rr, vs/ws).map(c => lerp(c, 128, clamp((near - 90)/120, 0, .55)));
    }
    d[o] = rgb[0]; d[o+1] = rgb[1]; d[o+2] = rgb[2]; d[o+3] = 255;
  }
  mapCtx.putImageData(mapImg, 0, 0);
  mapCtx.strokeStyle = "rgba(255,255,255,.18)"; mapCtx.lineWidth = 1;
  for (let x=20; x<FW; x+=20){ mapCtx.beginPath(); mapCtx.moveTo(x,0); mapCtx.lineTo(x,FD); mapCtx.stroke(); }
  for (let z=20; z<FD; z+=20){ mapCtx.beginPath(); mapCtx.moveTo(0,z); mapCtx.lineTo(FW,z); mapCtx.stroke(); }
  mapCtx.strokeStyle = "rgba(255,255,255,.45)"; mapCtx.setLineDash([4,4]);
  [-33, 33].forEach(zz => { mapCtx.beginPath(); mapCtx.moveTo(0, zz + FD/2); mapCtx.lineTo(FW, zz + FD/2); mapCtx.stroke(); });
  mapCtx.setLineDash([]);
  mapTex.needsUpdate = true;
}
function drawLegend(){
  const L = S.layer;
  linksDirty = true;
  if (L === "cov"){
    $("#lgT").textContent = `Radio coverage at ${S.txp} dBm`; $("#lgR").style.background = "linear-gradient(90deg,rgb(92,74,58) 0 33%,rgb(216,163,58) 33% 66%,rgb(79,163,106) 66%)";
    $("#lgA").textContent = "no signal"; $("#lgB").textContent = "strong"; return;
  }
  const rr = L === "st" ? RAMPS.t : L === "ni" ? RAMPS.n : RAMPS.m, lo = rr[0][0], hi = rr[rr.length-1][0];
  $("#lgR").style.background = `linear-gradient(90deg,${rr.map(s => `rgb(${s[1].join(",")}) ${((s[0]-lo)/(hi-lo)*100).toFixed(0)}%`).join(",")})`;
  $("#lgT").textContent = L === "st" ? "Soil temperature · as seen by the hub" : L === "ni" ? "Nitrogen index (indicative) · as seen by the hub" : `Soil moisture ${L==="m1"?"15":"30"} cm · as seen by the hub`;
  $("#lgA").textContent = L === "st" ? "10 °C" : L === "ni" ? "low 0" : "dry 0 %"; $("#lgB").textContent = L === "st" ? "42 °C" : L === "ni" ? "high 100" : "wet 100 %";
}

/* sky + weather */
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(18,20,20), new THREE.MeshBasicMaterial({color:0xffe08a, fog:false})); scene.add(sunBall);
const moon = new THREE.Mesh(new THREE.SphereGeometry(11,20,20), new THREE.MeshBasicMaterial({color:0xdfe6f2, fog:false})); scene.add(moon);
const cloudMat = new THREE.MeshStandardMaterial({color:0xffffff, transparent:true, opacity:.8, roughness:1, depthWrite:false});
const clouds = [];
for (let i=0;i<10;i++){
  const g = new THREE.Group();
  for (let j=0;j<5;j++){ const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(14,24),14,12), cloudMat); s.position.set(j*18-36, rnd(0,6), rnd(0,14)); s.scale.y = .5; g.add(s); }
  g.position.set(-400 + i*90, rnd(110,140), rnd(-260,160)); g.userData.v = rnd(3,6); scene.add(g); clouds.push(g);
}
const RN = 3200, rainPos = new Float32Array(RN*6), drops = [];
for (let i=0;i<RN;i++) drops.push({x:rnd(-240,200), y:rnd(0,90), z:rnd(-150,200), v:rnd(55,75)});
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos,3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({color:0xbcd4ea, transparent:true, opacity:.55})); rain.frustumCulled = false; scene.add(rain);
const IN = 900, irrPos = new Float32Array(IN*3), irrD = [];
for (let i=0;i<IN;i++){ const z = -FD/2 + 10 + Math.floor(rnd(0,13))*15; irrD.push({x:rnd(-FW/2+4,FW/2-4), z, zone:zoneOfZ(z), p:Math.random()}); }
const irrGeo = new THREE.BufferGeometry(); irrGeo.setAttribute("position", new THREE.BufferAttribute(irrPos,3));
const irr = new THREE.Points(irrGeo, new THREE.PointsMaterial({color:0x7fd0ff, size:1.4, transparent:true, opacity:.85})); irr.frustumCulled = false; scene.add(irr);
const pondMat = new THREE.MeshStandardMaterial({color:0x4d86b9, transparent:true, opacity:0, roughness:.15, depthWrite:false});
const pondMeshes = [];

/* packets in flight */
const flights = [];
const pktGeo = new THREE.SphereGeometry(2.2, 12, 12);
function tipMatOf(src){ if (src.isDev) return devObjs[src.key] && devObjs[src.key].tipM; return nodeObjs[src.i] && nodeObjs[src.i].tipM; }
function launchPacket(src, lostAt){
  const tm = tipMatOf(src); if (tm) tm.emissiveIntensity = 2.5;
  if (flights.length > 16 || S.speed >= 3) return;
  const col = src.isDev ? tok(src.color) : tok(nodeColor(src));
  const m = new THREE.Mesh(pktGeo, new THREE.MeshBasicMaterial({color:new THREE.Color(col || "#ffffff"), transparent:true}));
  scene.add(m);
  flights.push({m, route:src.route.map(tipOf), hop:0, t:0, lostAt});
}
function updateFlights(dt){
  for (let i=flights.length-1; i>=0; i--){
    const f = flights[i]; f.t += dt/.55;
    if (f.t >= 1){
      if (f.lostAt === f.hop){ f.m.material.opacity -= dt*3; if (f.m.material.opacity <= 0){ scene.remove(f.m); flights.splice(i,1); } continue; }
      f.hop++; f.t = 0;
      if (f.hop >= f.route.length-1){ hubTipMat.emissiveIntensity = 2.5; scene.remove(f.m); flights.splice(i,1); continue; }
    }
    const a = f.route[f.hop], b = f.route[f.hop+1], k = f.lostAt === f.hop ? Math.min(f.t, .55) : f.t;
    const mid = a.clone().lerp(b,.5); mid.y += 6;
    const u = 1-k; f.m.position.set(u*u*a.x+2*u*k*mid.x+k*k*b.x, u*u*a.y+2*u*k*mid.y+k*k*b.y, u*u*a.z+2*u*k*mid.z+k*k*b.z);
    if (f.lostAt === f.hop && f.t > .55) f.m.material.color.set(0xff5a46);
  }
}

/* labels */
const labelsEl = $("#labels"); let tagEls = [];
function buildTags(){
  labelsEl.innerHTML = ""; tagEls = [];
  const mk = (cls, color, click) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.style.setProperty("--k", `var(${color})`);
    b.innerHTML = `<i></i><b></b><span></span>`; b.addEventListener("click", click); labelsEl.appendChild(b); return b; };
  nodes.forEach(n => { const el = mk("tag", nodeColor(n), () => selectNode(n.i)); tagEls.push({el, b:el.querySelector("b"), s:el.querySelector("span"), p:V3(n.x, NODE_TIP+2, n.z), n}); });
  devs().forEach(d => { const el = mk("tag dev", d.color, () => selectDev(d.key)); tagEls.push({el, b:el.querySelector("b"), s:el.querySelector("span"), p:V3(d.x, d.tip+2.5, d.z), dev:d.key}); });
  const h = mk("tag dev", "--dv-hub", () => { renderInfo("hub"); setTab("hub"); });
  h.querySelector("b").textContent = "Hub · farmhouse";
  tagEls.push({el:h, b:null, s:h.querySelector("span"), p:V3(HUB.x, HUB.tip+3, HUB.z), hub:true});
  markTags();
}
function updateTagText(){
  tagEls.forEach(t => {
    if (t.hub){ t.s.textContent = `${nodes.filter(fresh).length + devs().filter(devFresh).length} heard · ${S.net ? "4G online" : `offline · ${S.buffered} buffered`}`; return; }
    if (t.dev){
      const d = DEV[t.dev]; let txt = "", bad = !d.route;
      if (t.dev === "pump"){ txt = W.tripReason && !W.pumpOn ? "TRIPPED" : `${W.pumpOn ? "ON" : "off"} · ${W.current.toFixed(1)} A · ${W.flowIn} L/min`; bad = bad || (!!W.tripReason && !W.pumpOn); }
      if (t.dev === "tank") txt = `${Math.round(W.tankL/W.cap*100)} % · valves ${W.valves.map(v => v ? "●" : "○").join("")} · ${W.pressure.toFixed(1)} bar`;
      if (t.dev === "trap"){ txt = `WF ${Math.round(P.wf)} · AP ${Math.round(P.ap)} · risk ${Math.round(P.dis)} %`; bad = bad || P.dis >= 75; }
      if (t.dev === "pond"){ txt = `O₂ ${PD.do.toFixed(1)} mg/L · aerator ${PD.aer ? (PD.fail ? "FAULT" : "on") : "off"}`; bad = bad || PD.do < 3; }
      if (t.dev === "cold"){ txt = `${CR.t.toFixed(1)} °C · door ${CR.door ? "OPEN" : "shut"}${CR.power ? "" : " · no power"}`; bad = bad || CR.t > 8; }
      t.b.textContent = d.label + (d.future ? " · future" : ""); t.s.textContent = txt; t.el.classList.toggle("bad", bad); return;
    }
    const n = t.n, st = statusOf(n);
    t.b.textContent = `${n.label} · ${SOILS[n.soil].name}`;
    t.s.textContent = alive(n) ? `${fmt(visual(n,"m1"),0)} % · ${st.t}` : st.t;
    t.el.classList.toggle("bad", !n.route);
  });
}
const tmpV = new THREE.Vector3();
function placeTags(w,h){
  tagEls.forEach(t => {
    tmpV.copy(t.p).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05){ t.el.style.opacity = "0"; t.el.style.pointerEvents = "none"; return; }
    t.el.style.opacity = "1"; t.el.style.pointerEvents = "auto";
    const x = (tmpV.x*.5+.5)*w - t.el.offsetWidth/2, y = (-tmpV.y*.5+.5)*h - t.el.offsetHeight - 6;
    t.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
}

/* camera */
const cam = {r:430, th:.45, ph:.95, tg:V3(-40,0,30)};
let camGoal = null;
function goCam(name){
  if (name === "overview") camGoal = {r:430, th:.45, ph:.95, tg:V3(-40,0,30)};
  if (name === "map") camGoal = {r:520, th:0, ph:.06, tg:V3(-40,0,40)};
  if (name === "water") camGoal = {r:95, th:.9, ph:1.0, tg:V3(-175,3,-40)};
  if (name === "pond") camGoal = {r:80, th:.3, ph:.95, tg:V3(68,0,166)};
  if (name === "cold") camGoal = {r:45, th:1.2, ph:1.05, tg:V3(-215,2,46)};
  if (name === "trap") camGoal = {r:22, th:.6, ph:1.15, tg:V3(45,3,-34)};
  if (name === "sel"){
    const n = nodes[S.sel]; if (n) camGoal = {r:70, th:.55, ph:1.05, tg:V3(n.x, 4, n.z)};
  }
}
$$("[data-cam]").forEach(b => b.addEventListener("click", () => goCam(b.dataset.cam)));
function applyCam(){ camera.position.set(cam.tg.x + cam.r*Math.sin(cam.ph)*Math.sin(cam.th), cam.tg.y + cam.r*Math.cos(cam.ph), cam.tg.z + cam.r*Math.sin(cam.ph)*Math.cos(cam.th)); camera.lookAt(cam.tg); }
const ptrs = new Map(); let dragDist = 0, pinch0 = 0;
canvas.addEventListener("pointerdown", e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); dragDist = 0; camGoal = null;
  if (ptrs.size === 2){ const [a,b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x-b.x,a.y-b.y); } });
canvas.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId)) return;
  const p = ptrs.get(e.pointerId), dx = e.clientX-p.x, dy = e.clientY-p.y; p.x = e.clientX; p.y = e.clientY; dragDist += Math.abs(dx)+Math.abs(dy);
  if (ptrs.size === 1){ cam.th -= dx*.005; cam.ph = clamp(cam.ph - dy*.005, .04, 1.45); }
  else if (ptrs.size === 2){ const [a,b] = [...ptrs.values()]; const d = Math.hypot(a.x-b.x,a.y-b.y); if (pinch0) cam.r = clamp(cam.r*pinch0/d, 12, 900); pinch0 = d; }
});
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
canvas.addEventListener("pointerup", e => {
  ptrs.delete(e.pointerId); pinch0 = 0;
  if (dragDist < 6){
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(ndc, camera); const hit = ray.intersectObjects(pickables, false)[0];
    if (hit){ const k = hit.object.userData.pick;
      if (k === "hub"){ renderInfo("hub"); setTab("hub"); } else if (typeof k === "string" && k.startsWith("d:")) selectDev(k.slice(2)); else selectNode(k); }
  }
});
canvas.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); pinch0 = 0; });
canvas.addEventListener("wheel", e => { e.preventDefault(); camGoal = null; cam.r = clamp(cam.r*(1+e.deltaY*.0012), 12, 900); }, {passive:false});

let VW = 1, VH = 1;
function resize(){ const r = vp.getBoundingClientRect(); VW = Math.max(1,r.width); VH = Math.max(1,r.height); if (renderer) renderer.setSize(VW, VH, false); camera.aspect = VW/VH; camera.updateProjectionMatrix(); drawCharts(); }
new ResizeObserver(resize).observe(vp);
window.addEventListener("resize", drawCharts);

/* per-frame scene update */
const skyNight = new THREE.Color(0x0b1424), skyDay = new THREE.Color(0x9cc9ea), skyGrey = new THREE.Color(0x8b949b), skyDusk = new THREE.Color(0xe9a56a);
const skyC = new THREE.Color(), bgC = new THREE.Color(), pondOK = new THREE.Color(0x2f7f86), pondBad = new THREE.Color(0x56702f);
let cropT = 0;
function updateScene(dt, time){
  const L = S.live, hour = L.hour ?? 6, cloud = S.env.cloud/100;
  const dayF = clamp(Math.sin(Math.PI*(hour-6)/12)*1.6, 0, 1), duskF = clamp(1 - Math.abs(dayF-.25)/.25, 0, 1)*(1-cloud)*.5;
  skyC.copy(skyDay).lerp(skyGrey, cloud*.85).lerp(skyDusk, duskF); bgC.copy(skyNight).lerp(skyC, dayF);
  scene.background = bgC; scene.fog.color.copy(bgC);
  const fogged = L.airH > 93 && !L.raining;
  scene.fog.near = lerp(scene.fog.near, fogged ? 60 : (L.raining ? 200 : 450), .05);
  scene.fog.far  = lerp(scene.fog.far,  fogged ? 420 : (L.raining ? 900 : 1500), .05);
  const a = Math.PI*(hour-6)/12;
  sunBall.position.set(-Math.cos(a)*700, Math.sin(a)*500, -500); sunBall.visible = dayF > 0 && cloud < .9;
  sunBall.material.color.set(L.airT > 36 ? 0xffb35a : 0xffe08a);
  moon.position.set(Math.cos(a)*650, -Math.sin(a)*420 + 60, -500); moon.visible = dayF <= .02 && cloud < .8;
  sun.position.copy(dayF > 0 ? sunBall.position : moon.position);
  sun.intensity = dayF > 0 ? (.25 + .9*dayF)*(1-.7*cloud) : .14; hemi.intensity = .25 + .6*dayF;
  cloudMat.opacity = clamp(cloud*1.05, 0, .95); cloudMat.color.set(L.raining ? 0x7d858c : (dayF>0 ? 0xffffff : 0x55606e));
  clouds.forEach(g => { g.visible = cloud > .05; g.position.x += g.userData.v*dt*(1+S.env.wind*2); if (g.position.x > 500) g.position.x = -500; });

  cropT += dt;
  if (cropT > .05){
    const wind = S.env.wind, atv = L.airT;
    const stress = nodes.map(n => { const m1 = visual(n,"m1") ?? n.m1, dry = clamp((35-m1)/25,0,1), heat = clamp((atv-36)/6,0,1), soak = n.pond > 3 ? .4 : 0, cold = clamp((10-atv)/6,0,1)*.3, dis = P.dis > 60 ? (P.dis-60)/100 : 0;
      return {s:clamp(Math.max(dry, heat*.6, soak, cold, dis),0,1), soak:soak>0 && dry<.2}; });
    blades.forEach((b,i) => {
      const c = clumps[b.c], st = stress[c.nearest] || {s:0};
      const sway = Math.sin(time*(1.4+wind) + b.ph + c.x*.05)*(.05 + wind*.1);
      dummy.position.set(c.x, 0, c.z); dummy.rotation.set(b.tilt + st.s*.8 + sway, b.yaw, 0); dummy.scale.set(1, b.h*(1-st.s*.25), 1);
      dummy.updateMatrix(); crop.setMatrixAt(i, dummy.matrix);
      cTmp.copy(GREEN).lerp(st.soak ? PALE : STRAW, st.s); crop.setColorAt(i, cTmp);
    });
    crop.instanceMatrix.needsUpdate = true; if (crop.instanceColor) crop.instanceColor.needsUpdate = true; cropT = 0;
  }
  nodes.forEach(n => {
    if (!pondMeshes[n.i]){ const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40), pondMat.clone()); m.rotation.x = -Math.PI/2; m.position.set(n.x, .3, n.z); scene.add(m); pondMeshes[n.i] = m; }
    const m = pondMeshes[n.i], R = clamp(n.pond*2.5, .01, 45); m.scale.set(R,R,R); m.material.opacity = clamp(n.pond/12, 0, .7);
  });
  const cnt = Math.round(RN*clamp(S.env.rain/35,0,1)), wind = S.env.wind;
  for (let i=0;i<cnt;i++){
    const d = drops[i]; d.y -= d.v*dt; d.x += wind*14*dt;
    if (d.y < 0){ d.y = 85 + Math.random()*5; d.x = rnd(-240,200); } if (d.x > 200) d.x -= 440;
    const o = i*6; rainPos[o]=d.x; rainPos[o+1]=d.y; rainPos[o+2]=d.z; rainPos[o+3]=d.x+wind*1.5; rainPos[o+4]=d.y-3.2; rainPos[o+5]=d.z;
  }
  rainGeo.setDrawRange(0, cnt*2); rainGeo.attributes.position.needsUpdate = true;
  const anyDeliver = W.deliver.some(x => x > 0);
  irr.visible = anyDeliver;
  if (anyDeliver){ irrD.forEach((d,i) => { const o = i*3, k = W.deliver[d.zone]; if (k <= 0 || (k < 1 && (i % 10) >= k*10)){ irrPos[o+1] = -50; return; }
    d.p = (d.p + dt*1.2) % 1; irrPos[o] = d.x; irrPos[o+1] = .6 + Math.sin(d.p*Math.PI)*1.8; irrPos[o+2] = d.z + (d.p-.5)*2; }); irrGeo.attributes.position.needsUpdate = true; }
  nodes.forEach(n => {
    const o = nodeObjs[n.i]; if (!o) return;
    o.tipM.emissiveIntensity = Math.max(0, o.tipM.emissiveIntensity - dt*2.5);
    const sel = n.i === S.sel && !S.selDev, pulse = sel ? 1 + .12*Math.sin(time*4) : 1;
    o.ring.scale.set(pulse, pulse, pulse);
    o.ringM.color.set(!alive(n) || !n.route ? 0xe0583f : o.col);
    o.ringM.opacity = alive(n) ? .9 : .5 + .4*Math.sin(time*6);
    o.headM.color.set(alive(n) ? 0xeeeeea : 0x9a9a96);
  });
  hubTipMat.emissiveIntensity = Math.max(0, hubTipMat.emissiveIntensity - dt*2.5);
  updateDevices3D(dt, time);
  updateFlights(dt);
}
function updateDevices3D(dt, time){
  ["pump","tank","trap","pond","cold"].forEach(k => { const o = devObjs[k]; if (o && o.tipM) o.tipM.emissiveIntensity = Math.max(0, o.tipM.emissiveIntensity - dt*2.5); });
  const pu = devObjs.pump;
  if (pu){ pu.motor.position.y = 1 + (W.pumpOn ? Math.sin(time*60)*.025 : 0);
    pu.ledM.emissive.set(W.tripReason && !W.pumpOn ? 0xff3322 : 0x22ff66); pu.ledM.emissiveIntensity = W.pumpOn ? 1.6 : (W.tripReason ? .8 + .8*Math.sin(time*8) : .15); }
  const tk = devObjs.tank;
  if (tk) tk.water.scale.y = Math.max(.02, 4.3*W.tankL/W.cap);
  if (devObjs.valves) devObjs.valves.forEach((v,z) => { v.lm.emissive.set(W.valves[z] ? (W.blocked[z] ? 0xf0b44a : 0x33ff77) : 0xff4433); v.lm.emissiveIntensity = W.valves[z] ? 1.4 : .5; });
  if (flowIn){
    runFlow(flowIn, W.pumpOn && W.flowIn > 0, 14, dt);
    flowZones.forEach((f,z) => runFlow(f, W.valves[z] && W.zoneFlow[z] > 0, W.blocked[z] ? 2.5 : 16, dt));
    const bOn = W.burst && W.flowOut > 0; burstPts.visible = bOn;
    if (bOn){ burstD.forEach((d,i) => { d.p = (d.p + dt*1.4) % 1; const h = Math.sin(d.p*Math.PI)*5; burstPos[i*3] = -146 + Math.cos(d.a)*d.r*d.p; burstPos[i*3+1] = .9 + h; burstPos[i*3+2] = -12 + Math.sin(d.a)*d.r*d.p; }); burstPts.geometry.attributes.position.needsUpdate = true; }
  }
  const tr = devObjs.trap;
  if (tr){ tr.flashT = Math.max(0, tr.flashT - dt*2.5); tr.flashM.opacity = tr.flashT*.9; }
  const po = devObjs.pond;
  if (po){
    const aerOn = PD.aer && !PD.fail;
    if (aerOn) po.wheel.rotation.x += dt*6;
    po.splash.visible = aerOn;
    if (aerOn){ po.sp.forEach((s,i) => { s.p = (s.p + dt*1.6) % 1; po.spPos[i*3] = po.ax + s.dx; po.spPos[i*3+1] = -.2 + Math.sin(s.p*Math.PI)*1.4; po.spPos[i*3+2] = po.az + s.dz*s.p; }); po.spGeo.attributes.position.needsUpdate = true; }
    po.buoy.position.y = -.2 + Math.sin(time*1.6)*.12;
    po.waterM.color.copy(pondOK).lerp(pondBad, clamp((4.5 - PD.do)/4, 0, 1));
    const gasp = PD.do < 2.5;
    po.fish.forEach((f,i) => { f.visible = gasp; if (gasp){ f.position.y = -.3 + Math.abs(Math.sin(time*3 + i))*.25; f.rotation.y += dt*(i%2 ? .6 : -.6); } });
  }
  const co = devObjs.cold;
  if (co){ co.pivot.rotation.y = lerp(co.pivot.rotation.y, CR.door ? 1.3 : 0, .08); if (CR.power) co.fb.rotation.x += dt*12; }
  beam.visible = S.net;
  if (S.net){ beamOff = (beamOff + dt*.6) % 1; for (let i=0;i<BN;i++){ const t = (i/BN + beamOff) % 1; beamPos[i*3] = HUB.x; beamPos[i*3+1] = 18 + t*110; beamPos[i*3+2] = HUB.z; } beamGeo.attributes.position.needsUpdate = true; }
}

/* ================================================================ scenario, nodes add/reset */
function syncEnvUI(){
  Object.entries(envCtl).forEach(([id,c]) => { $("#"+id).value = S.env[c.key]; $("#"+id+"O").textContent = c.o(S.env[c.key]); });
  $("#climateO").textContent = `+${S.climate.toFixed(1)} °C`; $("#mesh").checked = S.mesh; $("#txp").value = S.txp; updTxp();
}
function markCustom(){
  S.scen = "custom"; scenBox.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed","false"));
  S.forecast = S.env.rain > 0 ? {p:85, mm:Math.round(S.env.rain*6)} : S.env.cloud > 70 ? {p:40, mm:3} : {p:8, mm:0};
}
function applyScenario(id){
  const s = SCEN[id]; S.scen = id; S.env = {...s.env}; S.forecast = {...s.fc};
  S.min = Math.floor(S.min/1440)*1440 + s.start.hour*60; S.scenStart = S.min;
  nodes.forEach((n,i) => { seedNode(n, s); n.nextTx = S.min + 1 + i*1.6; n.last = null; n.lastT = -1e9; n.hist = []; });
  devs().forEach((d,i) => { d.nextTx = S.min + 2 + i*2.3; d.last = null; d.lastT = -1e9; });
  W.valves.forEach((o,z) => { if (o){ W.valves[z] = false; W.sess[z] = null; W.notReached[z] = []; } });
  W.tankL = 7000; W.pumpOn = false; W.runMin = 0;
  PD.do = s.start.hour >= 17 ? 6.4 : 7; PD.t = s.env.temp + 1; PD.aer = false; PD.manual = false;
  P.wetH = s.env.hum > 90 ? 12 : 4; P.dis = s.env.hum > 90 ? 35 : 10;
  CR.t = 4.2; S.devHist = [];
  scenBox.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id===id)));
  syncEnvUI(); step(.001); computeRoutes();
  addLog({kind:"gw", str:`Condition changed: ${s.name}`});
  mapDirty = alertsDirty = chartsDirty = true;
}
function addNode(silent){
  if (nodes.length >= SLOTS.length) return;
  const n = makeNode(nodes.length); nodes.push(n); buildNode(n); assignNearest(); computeRoutes(); buildTags(); buildNodeList(); drawCharts();
  if (!silent) addLog({kind:"mesh", str:`New node ${n.label} (${n.id}) joined at the ${n.place}. The hub registered it from its first packet (T=SOIL).`});
  mapDirty = alertsDirty = true;
}
function resetNodes(){
  nodes.forEach(n => { const o = nodeObjs[n.i]; if (o) scene.remove(o.g); if (pondMeshes[n.i]){ scene.remove(pondMeshes[n.i]); pondMeshes[n.i] = null; } });
  for (let i = pickables.length-1; i >= 0; i--) if (typeof pickables[i].userData.pick === "number") pickables.splice(i,1);
  nodes = []; nodeObjs.length = 0;
  for (let i=0;i<7;i++) addNode(true);
  S.sel = 0; S.selDev = null; S.mesh = true; S.txp = 5; syncEnvUI(); computeRoutes(); buildNodeList(); renderNodeCard(); tileSig = ""; renderTiles(); buildTags();
}
function resetFaults(){
  W.dryWell = W.phaseFault = W.burst = false; W.blocked = [false,false,false]; W.lockUntil = -1; W.tripReason = ""; W.fert = false; W.autoRefill = true;
  PD.fail = false; PD.auto = true; PD.manual = false; CR.door = false; CR.power = true; P.outbreak = 1; P.sprays = []; P.aiQueue = 0; P.aiResult = "";
  S.autoPump = true; if (!S.net) setNet(true);
  syncFaultUI(); renderSprays(); computeRoutes();
}

/* ================================================================ judge demo */
const TOUR = [
  {t:"1 · Seven nodes, one mesh", b:"Seven BHOOMI soil nodes cover the field. Each one wakes every 15 minutes, reads its sensors and sends one LoRa packet. Far corners hop through closer nodes to the hub at the farmhouse.",
   go:() => { resetFaults(); resetNodes(); applyScenario("normal"); setLayer("m1"); goCam("overview"); }},
  {t:"2 · Every node sees its own soil", b:"Sandy loam dries fastest, the low corner and the canal side stay wet, tree shade stays cool. The ground colour is the moisture map the hub builds from the packets.",
   go:() => { setLayer("m1"); goCam("map"); }},
  {t:"3 · Why the mesh matters", b:"Mesh relaying is switched off: at 433 MHz low power the far nodes cannot reach the hub directly and drop out. Switch it back on and they hop through their neighbours.",
   go:() => { S.mesh = false; computeRoutes(); syncEnvUI(); setLayer("cov"); goCam("overview"); }},
  {t:"4 · A node fails, the mesh heals", b:"Mesh is back on. N2 stops working — nodes that relayed through it find another path by themselves. The hub flags N2 as not reporting.",
   go:() => { S.mesh = true; computeRoutes(); syncEnvUI(); setNodeOn(nodes[1], false); }},
  {t:"5 · Heatwave: which zone is drying?", b:"Hot dry air pulls water out of the topsoil first. The hub names the dry zones and nodes so the farmer irrigates only where it is needed.",
   go:() => { setNodeOn(nodes[1], true); applyScenario("heatwave"); setLayer("m1"); }},
  {t:"6 · Cyclone: waterlogging at the low corner", b:"Heavy rain pools at the south-east low corner. Only that node raises a waterlogging alert and SMS; the 30 cm layer shows how deep the water went.",
   go:() => { applyScenario("cyclone"); setLayer("m2"); }},
  {t:"7 · Humid night: leaves stay wet", b:"The wetness strips stay wet for hours at warm temperature — a fungal disease warning before any spots appear.",
   go:() => { applyScenario("fog"); P.wetH = 12; setLayer("st"); }},
  {t:"8 · Battery saving", b:"At night, with no sun, the shaded node's battery is low: below 3.40 V it reports every hour instead of every 15 minutes and the hub warns the farmer.",
   go:() => { applyScenario("winter"); nodes[2].mAh = 2600*.045; selectNode(2); goCam("sel"); }},
  {t:"9 · Hub loses the internet", b:"The farm keeps working: packets, alerts and SMS run on the hub. Readings are buffered and uploaded when 4G returns.",
   go:() => { setNet(false); goCam("overview"); }},
  {t:"10 · Add a node, not a redesign", b:"An eighth node goes in the west-centre. It joins the mesh and appears on the hub map from its first packet.",
   go:() => { setNet(true); addNode(); setLayer("m1"); }},
];
const STEP_S = 15; let tour = null;
function startTour(){ tour = {i:-1, t:STEP_S, mid:false}; $("#tourBtn").textContent = "■ Stop demo"; $("#caption").hidden = false; setSpeed(2); }
function stopTour(){ if (!tour) return; tour = null; $("#tourBtn").textContent = "▶ Play judge demo"; $("#caption").hidden = true; }
$("#tourBtn").addEventListener("click", () => tour ? stopTour() : startTour());
function tickTour(dt){
  if (!tour) return; tour.t += dt;
  if (tour.t >= STEP_S){ tour.i++; tour.t = 0; tour.mid = false; if (tour.i >= TOUR.length){ stopTour(); return; } const s = TOUR[tour.i]; s.go(); $("#capT").textContent = s.t; $("#capB").textContent = s.b; }
  const s = TOUR[tour.i]; if (s && s.mid && !tour.mid && tour.t >= 7){ tour.mid = true; s.mid(); }
  $("#capP").style.width = `${(tour.t/STEP_S)*100}%`;
}

/* ================================================================ main loop */
let lastT = performance.now(), uiT = 0, mapT = 0, alT = 0, tTotal = 0, histT = 0;
function frame(now){
  const dt = Math.min(.1, (now-lastT)/1000); lastT = now; tTotal += dt;
  const adv = dt*SPEED_MIN_PER_S[S.speed];
  if (adv > 0){
    const steps = Math.max(1, Math.ceil(adv/2));
    for (let i=0;i<steps;i++){
      S.min += adv/steps; step(adv/steps/60);
      nodes.forEach(n => { while (S.min >= n.nextTx){ if (n.on) sendPacket(n); n.nextTx += txInterval(n); } });
      devs().forEach(d => { while (S.min >= d.nextTx){ sendDev(d); d.nextTx += d.every; } });
      if (S.min >= histT){ histT = Math.floor(S.min/15)*15 + 15; S.devHist.push({t:S.min, tank:W.tankL/W.cap*100, do:PD.do}); trimHist(S.devHist); chartsDirty = true; }
    }
  }
  tickTour(dt);
  if (camGoal){ const k = 1 - Math.pow(.02, dt); cam.r = lerp(cam.r,camGoal.r,k); cam.th = lerp(cam.th,camGoal.th,k); cam.ph = lerp(cam.ph,camGoal.ph,k); cam.tg.lerp(camGoal.tg,k); if (Math.abs(cam.r-camGoal.r) < .1) camGoal = null; }
  applyCam(); updateScene(dt, tTotal);
  if (linksDirty) rebuildLinks();
  mapT += dt; if (mapDirty && mapT > .5){ paintMap(); mapT = 0; }
  uiT += dt; alT += dt;
  if (uiT > .25){
    uiT = 0;
    $("#clock").textContent = clockStr(S.min);
    renderTiles(); updateTagText(); updateNodeListValues(); renderColumn(); renderDevicePanels();
    $("#netInfo").textContent = `${nodes.filter(fresh).length + devs().filter(devFresh).length}/${nodes.length + devs().length} heard · range ${Math.round(rangeM())} m`;
    if (chartsDirty){ drawCharts(); chartsDirty = false; }
    if (Math.floor(S.min) % 60 === 0) computeRoutes();
  }
  if (alT > 1 || (alertsDirty && alT > .3)){ renderAlerts(); alertsDirty = false; alT = 0; }
  if (renderer) renderer.render(scene, camera);
  placeTags(VW, VH);
  requestAnimationFrame(frame);
}

/* hooks for js/live-adapter.js (backend live data) */
window.__twin = {
  S, get nodes(){ return nodes; }, HUB, IDS, SLOTS, SOILS,
  setSpeed, setNodeOn, addNode, addLog, launchPacket, computeRoutes, battV, fresh, txInterval, clockStr, buildNodeList,
  dirty(){ mapDirty = alertsDirty = chartsDirty = true; },
};

/* boot */
renderInfo(null);

syncEnvUI(); syncFaultUI(); renderSprays();
for (let i=0;i<7;i++) addNode(true);
applyScenario("normal");
logEl.innerHTML = "";
addLog({kind:"mesh", str:"Mesh formed: 7 BHOOMI soil nodes registered at the hub"});
S.started = true;
selectNode(0); setLayer("m1"); buildTags();
resize();
requestAnimationFrame(frame);
})();
