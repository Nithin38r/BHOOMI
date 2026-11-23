/* BHOOMI Pond Node digital twin · FIELD POND view: 3D pond, floating buoy, bank controller, paddle-wheel aerator.
   The firmware model (S, advance, buoySample, bankDecide...) is in shared/model/field-model.cjs.
   In Live mode js/live-adapter.js sets LIVE.on and the backend's model drives S instead of advance(). */
'use strict';
const LIVE={on:false};
const S=newState();
const $=id=>document.getElementById(id);
const css=getComputedStyle(document.documentElement);
const C={accent:css.getPropertyValue('--accent').trim(),amber:css.getPropertyValue('--amber').trim(),ok:css.getPropertyValue('--ok').trim(),crit:css.getPropertyValue('--crit').trim(),mute:css.getPropertyValue('--mute').trim(),line:css.getPropertyValue('--line').trim(),ink:css.getPropertyValue('--ink').trim()};

// ===================== COMPONENT DATA =====================
const COMP={
 'buoy.ring':{g:'Buoy',n:'Flotation ring',part:'XPS/EPE foam, 600 OD × 220 ID × 100 mm (2 × 50 mm sheets glued)',price:'₹400',
   role:'Floats the whole buoy. Volume 0.0245 m³ → ~24 kg buoyancy. All-up mass ≈ 7.5 kg, so it sinks only ~31 mm and has 3× reserve.',
   why:'Bright yellow paint + reflective tape so it is visible from the bank at night and not hit by the paddle wheel.'},
 'buoy.deck':{g:'Buoy',n:'Deck plate',part:'3D-printed PETG/ASA plate Ø600, or a cut HDPE chopping board',price:'₹350',
   role:'Clamps the foam, carries the box, panel mast and antenna mast, and holds the probe-guard pipe in its centre hole.',why:'Print in ASA or PETG (UV-stable). PLA softens in Andhra summer sun.'},
 'buoy.box':{g:'Buoy',n:'IP65 enclosure',part:'ABS box 200 × 150 × 100 mm, PG7 cable glands, Gore-type vent plug, silica gel',price:'₹700',
   role:'Holds all electronics. No mains anywhere on the buoy: only a 3.7 V battery.',why:'Probe cables enter from the bottom through glands with drip loops. Vent plug stops condensation pumping in water.'},
 'buoy.esp32':{g:'Buoy',n:'ESP32 controller',part:'FireBeetle 2 ESP32-E (≈10 µA sleep) or ESP32-DevKitC + MCP1700 LDO',price:'₹600–1,300',
   role:'Wakes on RTC timer, powers sensors, reads ADS1115 + DS18B20, computes DO mg/L and % sat, sends LoRa, listens 1 s, sleeps.',
   pins:[['GPIO18/19/23','SPI SCK/MISO/MOSI → RFM95W'],['GPIO5','RFM95W NSS'],['GPIO14','RFM95W RESET'],['GPIO26','RFM95W DIO0 (IRQ)'],['GPIO21/22','I²C SDA/SCL → ADS1115 (4.7 kΩ pull-ups)'],['GPIO4','DS18B20 data (4.7 kΩ pull-up)'],['GPIO25','Sensor rail enable (100 kΩ pull-down)'],['GPIO33','Reed switch → wake into calibration mode']],
   why:'DevKit boards waste 5–10 mA in sleep through the USB chip and LDO; pick a low-power board.'},
 'buoy.lora':{g:'Buoy',n:'LoRa radio',part:'HopeRF RFM95W (SX1276, 868 MHz version)',price:'₹950–1,300',
   role:'865.0625 MHz, SF9, BW 125 kHz, CRC on, sync word 0x12, 14 dBm. One packet ≈ 0.3 s airtime at SF9.',why:'Never power it without the antenna attached.'},
 'buoy.ads':{g:'Buoy',n:'16-bit ADC',part:'ADS1115 module',price:'₹300',
   role:'Reads the DO and pH isolator outputs (A0, A1) and the battery divider (A2). Much cleaner than the ESP32 ADC.',why:'Galvanic DO gives tens of mV: the ESP32 ADC is too noisy and non-linear for it.'},
 'buoy.iso':{g:'Buoy',n:'Analog signal isolators ×2',part:'DFRobot Gravity Analog Signal Isolator DFR0504 (one for DO, one for pH)',price:'₹1,900 each',
   role:'Each probe gets its own isolated supply and signal path. The two probes sit in the same water, so without isolation current flows probe → water → probe and both readings drift (ground loop).',
   why:'Test: put both probes in a bucket, read pH, then dip a wire from GND into the water. If pH jumps, you have a ground loop.'},
 'buoy.doboard':{g:'Buoy',n:'DO signal board',part:'DFRobot SEN0237-A interface board',price:'(with probe kit)',role:'Amplifies the galvanic probe mV signal. Output → isolator → ADS1115 A0.',why:''},
 'buoy.phboard':{g:'Buoy',n:'pH signal board',part:'DFRobot pH meter V2 interface (SEN0161-V2 / SEN0169-V2)',price:'(with probe)',role:'Buffers the high-impedance glass electrode. Output → isolator → ADS1115 A1.',why:''},
 'buoy.batt':{g:'Buoy',n:'Battery pack',part:'2 × 18650 3000 mAh in parallel (Samsung 30Q / LG MJ1 genuine) + BMS',price:'₹700',
   role:'1S2P = 6000 mAh, 22 Wh. Average load ≈ 5.5 mA → ~0.5 Wh/day. Lasts ≈ 6 weeks with no sun; 3 cloudy days use ~7 %.',why:'Buy cells from a known seller; fake “9800 mAh” cells are 800 mAh.'},
 'buoy.charger':{g:'Buoy',n:'Solar charger',part:'CN3791 MPPT 1-cell Li-ion charger module (6 V panel)',price:'₹300',role:'Charges the 18650 pack from the panel with MPPT.',why:'Set to 4.20 V. Add a 2 A fuse at the battery.'},
 'buoy.solar':{g:'Buoy',n:'Solar panel',part:'6 V 5 W polycrystalline panel, ≈ 350 × 250 mm',price:'₹700',role:'Tilted 15° facing south (latitude 16° N). Gives ~15 Wh on a clear day; the buoy needs 0.5 Wh.',why:'Oversized on purpose so a dirty panel and monsoon days still keep the battery full.'},
 'buoy.antenna':{g:'Buoy',n:'Antenna mast',part:'868 MHz 3 dBi whip on 20 mm PVC mast, tip 1.2 m above water',price:'₹350',role:'Height clears the bank and fish nets. Water surface reflection costs ~10–15 dB at low height.',why:'Every extra 0.5 m of mast helps more than a bigger antenna.'},
 'buoy.guard':{g:'Buoy',n:'Probe guard pipe',part:'63 mm PVC pipe, 800 mm, slotted (6 mm slots), mesh end cap',price:'₹250',role:'Holds the three probe tips together at 60 cm depth, protects them from fish, nets and floating weed, lets water flow through.',why:'Pull the whole pipe up through the deck for weekly cleaning.'},
 'buoy.do':{g:'Buoy',n:'DO probe (galvanic)',part:'DFRobot SEN0237-A galvanic DO probe kit',price:'₹15,000–19,000',
   role:'Measures dissolved oxygen through a membrane. Reads ±0.2–0.3 mg/L after calibration. Needs flow past the membrane (pond movement / aerator mixing).',
   why:'Recommended for a student budget over optical (₹28,000–60,000, ±0.1 mg/L, little maintenance). Galvanic: refill electrolyte & change membrane every 1–2 months, recalibrate weekly.'},
 'buoy.ph':{g:'Buoy',n:'pH electrode',part:'DFRobot SEN0169-V2 industrial pH electrode (rated for continuous immersion)',price:'₹5,500–7,500',
   role:'±0.1 pH after 2-point calibration (4.01 / 6.86). Lab-grade SEN0161 probes are not made for 24/7 immersion.',why:'Biofilm makes it slow; clean weekly with soft brush + 0.1 M HCl dip, recalibrate every 2 weeks.'},
 'buoy.temp':{g:'Buoy',n:'Water temperature',part:'DS18B20 waterproof, stainless tip',price:'₹150',role:'±0.5 °C. Used for DO temperature compensation and % saturation.',why:'Returns −127 °C when disconnected → FLT 6, firmware falls back to 28 °C.'},
 'buoy.ballast':{g:'Buoy',n:'Ballast weight',part:'2 kg concrete or steel cylinder on SS rod below the pipe',price:'₹100',role:'Puts the centre of gravity ~0.8 m below the waterline, so wind on the panel cannot tip the buoy.',why:'2 kg × 0.8 m below beats ≈2.3 kg × 0.35 m above → self-righting.'},
 'buoy.mooring':{g:'Buoy',n:'Mooring',part:'2 × 5 kg concrete blocks, 6 mm nylon rope, 1.3× depth slack',price:'₹300',role:'Two-point mooring keeps the buoy in place 15 m+ away from the aerator.',why:'Next to the aerator DO reads falsely high. Measure the pond, not the aerator jet.'},
 'bank.box':{g:'Bank controller',n:'IP65 panel box',part:'Polycarbonate DIN enclosure ≈ 300 × 400 × 170 mm, transparent door',price:'₹1,500',role:'Mounted on a post 1.4 m above ground beside the existing starter. Mains lives only here, on the bank.',why:'Earth the DIN rail and box hardware.'},
 'bank.esp32':{g:'Bank controller',n:'ESP32 controller',part:'ESP32-DevKitC (always powered)',price:'₹500',
   role:'Owns the aerator decision: hysteresis 4/6 mg/L, min ON 20 min, min OFF 5 min, current check, DO-trend check, failsafe, mesh relay to hub.',
   pins:[['GPIO18/19/23/5/14/26','RFM95W (same as buoy)'],['GPIO32','Relay IN (opto, active-LOW)'],['GPIO36 (VP)','SCT-013 via 1.65 V bias (2 × 10 kΩ + 10 µF)'],['GPIO39 (VN)','Contactor aux NO feedback (10 kΩ pull-down)'],['GPIO34','HOA switch in AUTO (10 kΩ pull-down)'],['GPIO2','Status LED']],why:''},
 'bank.lora':{g:'Bank controller',n:'LoRa radio',part:'RFM95W 868 MHz',price:'₹1,000',role:'Listens continuously. Hears the buoy, replies ACK, forwards to the hub (mesh relay).',why:''},
 'bank.psu':{g:'Bank controller',n:'5 V DIN power supply',part:'Mean Well HDR-15-5 (5 V 2.4 A) behind 1 A fuse',price:'₹1,000',role:'Isolated 5 V for ESP32 and relay coil.',why:'Use a certified DIN supply, not a bare open-frame module, in a farm panel.'},
 'bank.relay':{g:'Bank controller',n:'Opto-isolated relay',part:'1-channel 5 V relay module with PC817 opto + JD-VCC jumper',price:'₹150',
   role:'Switches only the contactor coil (230 VAC, < 0.1 A), never the motor current. Wired in series with the HOA switch AUTO contact.',why:'Remove the JD-VCC jumper so the relay coil side is powered separately from the ESP32.'},
 'bank.contactor':{g:'Bank controller',n:'Contactor',part:'L&T MNX 9 or Schneider LC1D09, 230 VAC coil, with overload relay',price:'₹1,800',
   role:'Carries the 1 HP motor current (≈ 6.5 A). Its aux contact tells the ESP32 it really pulled in.',why:'Overload relay stays in circuit; firmware does not replace motor protection.'},
 'bank.mcb':{g:'Bank controller',n:'MCB + control fuse',part:'2-pole 6 A C-curve MCB for control circuit, 1 A fuse on PSU',price:'₹500',role:'Isolates and protects the panel. Motor keeps its existing starter MCB/overload.',why:''},
 'bank.ct':{g:'Bank controller',n:'Current sensor',part:'SCT-013-030 split-core CT (30 A → 1 V)',price:'₹700',
   role:'Clipped on one motor wire. ≈ 6.4 A when the paddle wheel runs. If contactor is ON for 30 s and current < 0.5 A → FLT 10.',why:'No wiring into mains needed: it clips around the insulated wire.'},
 'bank.hoa':{g:'Bank controller',n:'Hand-Off-Auto switch',part:'22 mm 3-position selector',price:'₹250',role:'HAND = farmer runs aerator directly (bypasses ESP32). OFF = locked off for maintenance. AUTO = ESP32 controls.',why:'The farmer must always be able to run the aerator by hand even if all electronics fail.'},
 'bank.antenna':{g:'Bank controller',n:'Antenna mast',part:'868 MHz 5 dBi on 3 m GI pipe',price:'₹800',role:'Higher antenna = reliable link to the farmhouse hub (~300 m) and to other nodes.',why:''},
 'pond.aerator':{g:'Pond',n:'Paddle-wheel aerator',part:'1 HP, 2-impeller, 230 V (existing)',price:'existing',role:'Adds oxygen and mixes water. Switched by the contactor through the existing starter.',why:'Typical 1–2 HP for a 0.28 ha pond.'},
 'pond.water':{g:'Pond',n:'Pond',part:'70 × 40 m earthen, 1.2–1.5 m deep (≈ 3,600 m³)',price:'–',role:'Rohu/catla/tilapia or vannamei in low salinity. Night DO crash is the main killer.',why:'Fish gasping at the surface = DO under ~2 mg/L. Shown in the twin.'},
 'hub':{g:'Network',n:'Farmhouse hub',part:'ESP32 + RFM95W + 4G modem (existing gateway)',price:'existing',role:'Receives packets, logs, sends SMS and app alerts, sends commands. Not needed for the safety loop.',why:'Shown closer than real (~300 m) to fit the scene.'},
};
const WIRE_BUOY=[['ESP32 3V3','—','3.3 V','RFM95W VCC, ADS1115 VDD, DS18B20 VDD','From MCP1700 LDO (1.6 µA Iq)'],
 ['GPIO18','SCK','3.3 V','RFM95W SCK',''],['GPIO19','MISO','3.3 V','RFM95W MISO',''],['GPIO23','MOSI','3.3 V','RFM95W MOSI',''],['GPIO5','NSS','3.3 V','RFM95W NSS','10 kΩ pull-up'],
 ['GPIO14','RESET','3.3 V','RFM95W RESET',''],['GPIO26','DIO0','3.3 V','RFM95W DIO0','TX done / RX done IRQ'],
 ['GPIO21','SDA','3.3 V','ADS1115 SDA','4.7 kΩ pull-up'],['GPIO22','SCL','3.3 V','ADS1115 SCL','4.7 kΩ pull-up'],
 ['ADS1115 A0','analog','0–3 V','DO isolator OUT','Isolator 1 powered from 5 V rail'],['ADS1115 A1','analog','0–3 V','pH isolator OUT','Isolator 2, separate'],
 ['ADS1115 A2','analog','≤ 2.1 V','Battery via 100 k/100 k divider','BV = 2 × reading'],
 ['GPIO4','1-Wire','3.3 V','DS18B20 data','4.7 kΩ to sensor rail'],['GPIO25','EN','3.3 V','5 V boost EN (sensor rail)','100 kΩ pull-down: sensors off in sleep'],
 ['GPIO33','RTC wake','3.3 V','Reed switch to GND','Internal pull-up; magnet = cal mode'],['Battery +','—','3.0–4.2 V','CN3791 BAT, LDO in, 2 A fuse','18650 × 2 parallel']];
const WIRE_BANK=[['HDR-15-5 L/N','—','230 VAC','via 1 A fuse from 6 A MCB','Electrician'],['HDR-15-5 +5V','—','5 V','ESP32 VIN, relay JD-VCC','Remove JD-VCC jumper'],
 ['GPIO18/19/23/5/14/26','SPI+IRQ','3.3 V','RFM95W','Same as buoy'],['GPIO32','relay IN','3.3 V','Relay module IN','Active LOW, opto PC817'],
 ['Relay COM/NO','dry contact','230 VAC coil','Contactor A1 via HOA AUTO contact','Electrician'],['GPIO36 (VP)','analog','0–3.3 V','SCT-013-030 via 1.65 V bias','2 × 10 kΩ + 10 µF'],
 ['GPIO39 (VN)','digital','3.3 V','Contactor aux NO','10 kΩ pull-down'],['GPIO34','digital','3.3 V','HOA in AUTO (aux contact)','10 kΩ pull-down'],['GPIO2','LED','3.3 V','Status LED + 330 Ω','']];

// ===================== THREE.JS SCENE =====================
const canvas=$('c'),stage=$('stage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(48,1,0.01,1200);
camera.position.set(42,30,58);
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=0.08;controls.target.set(0,0,0);controls.maxDistance=400;controls.minDistance=0.15;
scene.fog=new THREE.Fog(0x8fc3dc,140,420);
const hemi=new THREE.HemisphereLight(0xcfe8ff,0x3b3524,0.7);scene.add(hemi);
const sunL=new THREE.DirectionalLight(0xfff1d6,1.0);scene.add(sunL);
const moonL=new THREE.DirectionalLight(0x8aa8ff,0.25);moonL.position.set(-40,60,-30);scene.add(moonL);

const PICK=[],COMPMESH={},XRAY=[],ANCH=[];
function M(color,o){return new THREE.MeshStandardMaterial(Object.assign({color,roughness:.7,metalness:.05},o||{}))}
function add(parent,geo,mat,x,y,z,comp){const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);parent.add(m);
  if(comp){m.userData.comp=comp;PICK.push(m);(COMPMESH[comp]=COMPMESH[comp]||[]).push(m)}return m}
function anchor(parent,comp,x,y,z,maxDist,text){const o=new THREE.Object3D();o.position.set(x,y,z);parent.add(o);
  const el=document.createElement('div');el.className='lbl';el.textContent=text||COMP[comp].n;el.addEventListener('click',()=>select(comp,true));
  $('labels').appendChild(el);ANCH.push({o,el,comp,maxDist});return o}
function board(parent,w,d,color,x,y,z,comp,vertical){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
  add(g,new THREE.BoxGeometry(w,0.0016,d),M(color,{roughness:.5}),0,0,0,comp);
  add(g,new THREE.BoxGeometry(w*.35,0.002,d*.35),M(0x222222),0,0.0018,0,comp);
  add(g,new THREE.BoxGeometry(w*.12,0.003,d*.6),M(0xc9a54a,{metalness:.6}),-w*.38,0.002,0,comp);
  if(vertical)g.rotation.x=Math.PI/2;return g}

// ground with pond hole
const PX=35,PZ=20,BANK=0.45,DEPTH=1.4;
{const sh=new THREE.Shape();sh.moveTo(-260,-260);sh.lineTo(260,-260);sh.lineTo(260,260);sh.lineTo(-260,260);sh.lineTo(-260,-260);
 const hole=new THREE.Path();hole.moveTo(-PX-2,-PZ-2);hole.lineTo(-PX-2,PZ+2);hole.lineTo(PX+2,PZ+2);hole.lineTo(PX+2,-PZ-2);hole.lineTo(-PX-2,-PZ-2);sh.holes.push(hole);
 const g=new THREE.ShapeGeometry(sh);g.rotateX(-Math.PI/2);const m=new THREE.Mesh(g,M(0x5d6b3a,{roughness:1}));m.position.y=BANK;scene.add(m);
 // sloped walls
 const top=[[-PX-2,-PZ-2],[PX+2,-PZ-2],[PX+2,PZ+2],[-PX-2,PZ+2]],bot=[[-PX+2,-PZ+2],[PX-2,-PZ+2],[PX-2,PZ-2],[-PX+2,PZ-2]];
 const pos=[];for(let i=0;i<4;i++){const j=(i+1)%4,a=top[i],b=top[j],c=bot[j],d=bot[i];
   pos.push(a[0],BANK,a[1],b[0],BANK,b[1],c[0],-DEPTH,c[1], a[0],BANK,a[1],c[0],-DEPTH,c[1],d[0],-DEPTH,d[1]);}
 const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));wg.computeVertexNormals();
 scene.add(new THREE.Mesh(wg,M(0x6e5a3e,{side:THREE.DoubleSide,roughness:1})));
 const bg=new THREE.PlaneGeometry(2*PX-4,2*PZ-4);bg.rotateX(-Math.PI/2);const bm=new THREE.Mesh(bg,M(0x4a3d2a,{roughness:1}));bm.position.y=-DEPTH;scene.add(bm);
 // field strips
 for(let i=0;i<14;i++){const f=new THREE.Mesh(new THREE.BoxGeometry(18,0.25,1.2),M(0x4f7a2e));f.position.set(60+((i%2)*22),BANK+0.12,-40+i*6);scene.add(f)}
 for(let i=0;i<16;i++){const tr=new THREE.Group();tr.position.set(-70+Math.sin(i*7.3)*25,BANK,-60+i*9+Math.cos(i)*4);
   add(tr,new THREE.CylinderGeometry(.15,.22,3,6),M(0x5a4228),0,1.5,0);add(tr,new THREE.SphereGeometry(1.6+Math.sin(i)*.4,8,6),M(0x2f5a2a),0,3.6,0);scene.add(tr)}
}
// water surface
const waterGeo=new THREE.PlaneGeometry(2*PX+3,2*PZ+3,72,42);waterGeo.rotateX(-Math.PI/2);
const waterBase=waterGeo.attributes.position.array.slice();
const waterMat=new THREE.MeshStandardMaterial({color:0x2f7f74,transparent:true,opacity:.5,roughness:.15,metalness:.1,side:THREE.DoubleSide,depthWrite:false});
const water=new THREE.Mesh(waterGeo,waterMat);water.userData.comp='pond.water';scene.add(water);
anchor(scene,'pond.water',-10,0.2,-17,140,'Pond 70 × 40 m · 1.4 m deep');

// ---------- BUOY ----------
const buoy=new THREE.Group();buoy.position.set(8,0,-4);scene.add(buoy);
const BX=buoy.position;
{const prof=[new THREE.Vector2(.11,-.031),new THREE.Vector2(.3,-.031),new THREE.Vector2(.3,.069),new THREE.Vector2(.11,.069),new THREE.Vector2(.11,-.031)];
 add(buoy,new THREE.LatheGeometry(prof,40),M(0xf2c230,{roughness:.9}),0,0,0,'buoy.ring');
 add(buoy,new THREE.CylinderGeometry(.3,.3,.015,40),M(0x2f3b40,{roughness:.6}),0,.077,0,'buoy.deck');
 // reflective stripes
 for(let i=0;i<4;i++){const s=add(buoy,new THREE.BoxGeometry(.004,.03,.06),M(0xffffff,{emissive:0x444444}),Math.cos(i*Math.PI/2)*.302,.02,Math.sin(i*Math.PI/2)*.302);s.rotation.y=-i*Math.PI/2}
 anchor(buoy,'buoy.ring',.32,.08,0,8);
}
const encl=new THREE.Group();encl.position.set(0,.085,.06);buoy.add(encl);
const encMat=M(0xdfe7e6,{transparent:true,opacity:.18,depthWrite:false,roughness:.3});XRAY.push(encMat);
{const b=add(encl,new THREE.BoxGeometry(.2,.1,.15),encMat,0,.05,0,'buoy.box');
 const ed=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.2,.1,.15)),new THREE.LineBasicMaterial({color:0x9fdcea}));ed.position.y=.05;encl.add(ed);
 anchor(encl,'buoy.box',-.1,.11,.07,3);
}
// internals with explode offsets
const INT=[];
function internal(obj,ex){obj.userData.base=obj.position.clone();obj.userData.ex=new THREE.Vector3(...ex);INT.push(obj);return obj}
{const pack=new THREE.Group();pack.position.set(.045,.012,-.045);encl.add(pack);
 for(const z of[-.011,.011]){const c=add(pack,new THREE.CylinderGeometry(.009,.009,.065,16),M(0x2b6fd6,{roughness:.4}),0,.0,z,'buoy.batt');c.rotation.z=Math.PI/2}
 add(pack,new THREE.BoxGeometry(.07,.004,.045),M(0x111111),0,-.011,0,'buoy.batt');internal(pack,[.06,.03,-.04]);
 anchor(pack,'buoy.batt',0,.02,0,1.6);
 internal(board(encl,.042,.026,0x1f4fa8,.055,.008,.025,'buoy.charger'),[.07,.02,.05]);
 const esp=board(encl,.052,.028,0x1d6b44,-.045,.008,.02,'buoy.esp32');add(esp,new THREE.BoxGeometry(.018,.004,.025),M(0xb8bcc0,{metalness:.8,roughness:.3}),.012,.003,0,'buoy.esp32');internal(esp,[-.07,.05,.04]);
 anchor(esp,'buoy.esp32',0,.012,0,1.6);
 const lr=board(encl,.026,.026,0x2a4a2a,.0,.008,.04,'buoy.lora');add(lr,new THREE.BoxGeometry(.016,.003,.016),M(0x9aa0a6,{metalness:.8}),0,.002,0,'buoy.lora');internal(lr,[0,.06,.08]);
 anchor(lr,'buoy.lora',0,.01,0,1.6);
 internal(board(encl,.028,.018,0x4b1f7a,-.05,.008,-.04,'buoy.ads'),[-.08,.04,-.05]);anchor(INT[INT.length-1],'buoy.ads',0,.008,0,1.6,'ADS1115');
 // second layer: signal boards + isolators on standoffs
 const deck2=new THREE.Group();deck2.position.set(-.02,.055,-.03);encl.add(deck2);
 board(deck2,.035,.026,0x1a3f8a,-.03,0,0,'buoy.doboard');board(deck2,.03,.024,0x8a3f1a,-.03,0,.035,'buoy.phboard');
 board(deck2,.034,.022,0x1f6fb8,.015,0,0,'buoy.iso');board(deck2,.034,.022,0x1f6fb8,.015,0,.035,'buoy.iso');
 add(deck2,new THREE.BoxGeometry(.004,.003,.07),M(0xf2675d,{emissive:0x551111}),.037,.004,.017,'buoy.iso');
 internal(deck2,[0,.12,0]);anchor(deck2,'buoy.iso',.015,.012,.017,1.6,'Isolators (DO / pH)');anchor(deck2,'buoy.doboard',-.03,.01,0,1.2,'DO board');anchor(deck2,'buoy.phboard',-.03,.01,.035,1.2,'pH board');
 // wires
 const wm=new THREE.LineBasicMaterial({color:0xf2b55c});
 for(const p of[[[-.045,.01,.02],[0,.01,.04]],[[-.045,.01,.02],[-.05,.01,-.04]],[[-.05,.01,-.04],[-.005,.055,-.03]],[[.045,.012,-.045],[.055,.01,.025]]]){
   const g=new THREE.BufferGeometry().setFromPoints(p.map(v=>new THREE.Vector3(...v)));encl.add(new THREE.Line(g,wm))}
 // status LED
 const led=add(encl,new THREE.SphereGeometry(.004,8,6),M(0x113311,{emissive:0x00ff66,emissiveIntensity:0}),.09,.09,.07);encl.userData.led=led;
}
// panel
{const pg=new THREE.Group();pg.position.set(0,.36,-.05);buoy.add(pg);
 add(buoy,new THREE.CylinderGeometry(.008,.008,.29,8),M(0x9aa4a8,{metalness:.6}),-.15,.22,-.05);
 add(buoy,new THREE.CylinderGeometry(.008,.008,.29,8),M(0x9aa4a8,{metalness:.6}),.15,.22,-.05);
 const p=add(pg,new THREE.BoxGeometry(.35,.012,.25),M(0x1a2b52,{roughness:.25,metalness:.4}),0,0,0,'buoy.solar');
 add(pg,new THREE.BoxGeometry(.36,.008,.26),M(0xb8bcc0,{metalness:.7}),0,-.008,0);
 for(let i=-2;i<=2;i++)add(pg,new THREE.BoxGeometry(.001,.0135,.245),M(0x8899bb),i*.07,0,0);
 pg.rotation.x=15*Math.PI/180;buoy.userData.panel=p;anchor(pg,'buoy.solar',0,.03,-.12,8);
}
// antenna
{add(buoy,new THREE.CylinderGeometry(.011,.011,.95,10),M(0xe8e8e2),.2,.55,.15,'buoy.antenna');
 add(buoy,new THREE.CylinderGeometry(.004,.006,.2,8),M(0x111111),.2,1.12,.15,'buoy.antenna');
 buoy.userData.ant=new THREE.Object3D();buoy.userData.ant.position.set(.2,1.22,.15);buoy.add(buoy.userData.ant);
 anchor(buoy,'buoy.antenna',.2,1.26,.15,14);
}
// probe guard + probes
{const gm=M(0xcfd6d4,{transparent:true,opacity:.35,depthWrite:false});XRAY.push(gm);
 add(buoy,new THREE.CylinderGeometry(.0315,.0315,.8,20,1,true),gm,0,-.33,0,'buoy.guard');
 for(let i=0;i<9;i++)add(buoy,new THREE.TorusGeometry(.0318,.002,6,20),M(0x3a4447),0,-.05-i*.08,0).rotation.x=Math.PI/2;
 add(buoy,new THREE.CylinderGeometry(.032,.032,.01,20),M(0x3a4447),0,-.735,0,'buoy.guard');
 anchor(buoy,'buoy.guard',.04,-.2,0,4);
 add(buoy,new THREE.CylinderGeometry(.012,.012,.25,16),M(0x1b1b1b),-.012,-.475,0,'buoy.do');
 add(buoy,new THREE.CylinderGeometry(.012,.011,.02,16),M(0xe6e6e6,{roughness:.2}),-.012,-.6,0,'buoy.do');
 add(buoy,new THREE.CylinderGeometry(.006,.006,.22,12),M(0x5a6a74),.014,-.48,-.006,'buoy.ph');
 add(buoy,new THREE.SphereGeometry(.0065,12,8),M(0xd8f4ff,{transparent:true,opacity:.7,roughness:.05}),.014,-.595,-.006,'buoy.ph');
 add(buoy,new THREE.CylinderGeometry(.003,.003,.2,8),M(0xd0d4d6,{metalness:.9,roughness:.25}),.006,-.5,.016,'buoy.temp');
 const cm=new THREE.LineBasicMaterial({color:0x111111});
 for(const x of[-.012,.014,.006]){const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,-.35,0),new THREE.Vector3(x,.12,.06)]);buoy.add(new THREE.Line(g,cm))}
 anchor(buoy,'buoy.do',-.05,-.6,0,2.5,'DO probe');anchor(buoy,'buoy.ph',.05,-.6,0,2.5,'pH probe');anchor(buoy,'buoy.temp',.03,-.67,.02,2.5,'DS18B20');
 add(buoy,new THREE.CylinderGeometry(.003,.003,.1,6),M(0xb0b4b6,{metalness:.8}),0,-.79,0);
 add(buoy,new THREE.CylinderGeometry(.06,.06,.08,20),M(0x6b6f70,{roughness:.9}),0,-.86,0,'buoy.ballast');
 anchor(buoy,'buoy.ballast',.07,-.86,0,4);
 // depth marker
 const dm=new THREE.LineBasicMaterial({color:0x6fd0e6,transparent:true,opacity:.7});
 buoy.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.12,0,0),new THREE.Vector3(-.12,-.6,0)]),dm));
 anchor(buoy,'buoy.guard',-.14,-.3,0,2.2,'60 cm depth');
}
// mooring (in world, not bobbing)
{const rm=new THREE.LineBasicMaterial({color:0xd8cfa8});
 for(const s of[-1,1]){const pts=[new THREE.Vector3(BX.x+s*.3,0,BX.z),new THREE.Vector3(BX.x+s*1.3,-.9,BX.z+.2*s),new THREE.Vector3(BX.x+s*2.3,-DEPTH+.12,BX.z)];
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(pts).getPoints(20)),rm));
  const a=add(scene,new THREE.BoxGeometry(.25,.2,.25),M(0x7c7c74,{roughness:1}),BX.x+s*2.3,-DEPTH+.1,BX.z,'buoy.mooring');}
 anchor(scene,'buoy.mooring',BX.x+2.3,-DEPTH+.3,BX.z,5);
}

// ---------- AERATOR ----------
const aer=new THREE.Group();aer.position.set(-24,0,9);aer.rotation.y=.3;scene.add(aer);
const impellers=[];
{for(const x of[-1.1,0,1.1]){const f=add(aer,new THREE.CylinderGeometry(.17,.17,1.5,16),M(0xe8e4d8,{roughness:.8}),x,.02,0,'pond.aerator');f.rotation.x=Math.PI/2}
 add(aer,new THREE.BoxGeometry(2.6,.06,.08),M(0x6a7478,{metalness:.5}),0,.26,0,'pond.aerator');
 add(aer,new THREE.BoxGeometry(.38,.3,.3),M(0x2c5d8a,{metalness:.3}),0,.42,0,'pond.aerator');
 add(aer,new THREE.CylinderGeometry(.03,.03,2.4,8),M(0x9aa4a8,{metalness:.7}),0,.26,.45,'pond.aerator').rotation.z=Math.PI/2;
 for(const x of[-.65,.65]){const im=new THREE.Group();im.position.set(x,.26,.45);aer.add(im);impellers.push(im);
   add(im,new THREE.CylinderGeometry(.09,.09,.32,12),M(0x3a4447),0,0,0,'pond.aerator').rotation.z=Math.PI/2;
   for(let i=0;i<8;i++){const a=i/8*Math.PI*2;const p=add(im,new THREE.BoxGeometry(.3,.05,.12),M(0xd9d4c4),0,Math.cos(a)*.33,Math.sin(a)*.33,'pond.aerator');p.rotation.x=-a}}
 anchor(aer,'pond.aerator',0,.75,0,90);
}
// splash particles
const SPL=400,splGeo=new THREE.BufferGeometry(),splPos=new Float32Array(SPL*3),splVel=new Float32Array(SPL*3);
splGeo.setAttribute('position',new THREE.BufferAttribute(splPos,3));
const splash=new THREE.Points(splGeo,new THREE.PointsMaterial({color:0xe9f7f6,size:.06,transparent:true,opacity:.85}));aer.add(splash);
function respawn(i){const x=(Math.random()<.5?-.65:.65)+(Math.random()-.5)*.3;splPos[i*3]=x;splPos[i*3+1]=.05;splPos[i*3+2]=.7+Math.random()*.1;
  splVel[i*3]=(Math.random()-.5)*.4;splVel[i*3+1]=.6+Math.random()*1.2;splVel[i*3+2]=.8+Math.random()*1.6}
for(let i=0;i<SPL;i++){respawn(i);splPos[i*3+1]=-5}
// foam patch
const foam=new THREE.Mesh(new THREE.CircleGeometry(2.6,32),new THREE.MeshBasicMaterial({color:0xe9f7f6,transparent:true,opacity:0,depthWrite:false}));
foam.rotation.x=-Math.PI/2;foam.position.set(0,.015,2.0);aer.add(foam);

// ---------- BANK CONTROLLER ----------
const bank=new THREE.Group();bank.position.set(-39.2,BANK,13);scene.add(bank);
add(bank,new THREE.CylinderGeometry(.06,.07,2.2,10),M(0x7a6a52),0,1.1,0);
add(bank,new THREE.BoxGeometry(.5,.08,.5),M(0x8a8a82),0,.04,0);
const panel=new THREE.Group();panel.position.set(.18,1.4,0);panel.rotation.y=Math.PI/2;bank.add(panel);
const bankEnc=M(0xe8eef0,{transparent:true,opacity:.18,depthWrite:false,roughness:.2});XRAY.push(bankEnc);
{add(panel,new THREE.BoxGeometry(.4,.52,.02),M(0x9aa3a6),0,0,-.085);
 add(panel,new THREE.BoxGeometry(.4,.52,.17),bankEnc,0,0,0,'bank.box');
 const ed=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(.4,.52,.17)),new THREE.LineBasicMaterial({color:0x9fdcea}));panel.add(ed);
 anchor(panel,'bank.box',-.18,.3,.09,14);
 for(const y of[.12,-.1])add(panel,new THREE.BoxGeometry(.36,.035,.008),M(0xb8bcc0,{metalness:.8}),0,y,-.07);
 // row1
 add(panel,new THREE.BoxGeometry(.036,.09,.07),M(0xf2f2ee),-.15,.12,-.035,'bank.mcb');add(panel,new THREE.BoxGeometry(.01,.02,.02),M(0x2a4a8a),-.15,.12,.005,'bank.mcb');
 add(panel,new THREE.BoxGeometry(.018,.08,.06),M(0x3b3b3b),-.115,.12,-.04,'bank.mcb');
 add(panel,new THREE.BoxGeometry(.054,.09,.055),M(0x5d6266),-.06,.12,-.04,'bank.psu');
 const ct=add(panel,new THREE.BoxGeometry(.045,.075,.08),M(0xd8dcd6),.03,.12,-.03,'bank.contactor');
 add(panel,new THREE.BoxGeometry(.03,.02,.02),M(0x2a2a2a),.03,.165,.0,'bank.contactor');
 const cind=add(panel,new THREE.BoxGeometry(.012,.012,.01),M(0x333333,{emissive:0x00ff66,emissiveIntensity:0}),.03,.12,.012);panel.userData.cind=cind;
 add(panel,new THREE.BoxGeometry(.045,.04,.07),M(0x8a8f92),.03,.065,-.03,'bank.contactor');
 anchor(panel,'bank.contactor',.03,.2,0,4);anchor(panel,'bank.mcb',-.15,.19,0,2.5,'MCB / fuse');anchor(panel,'bank.psu',-.06,.19,0,2.5,'5 V PSU');
 // row2 boards (vertical)
 const rl=board(panel,.05,.026,0x1a3f8a,-.12,-.1,-.06,'bank.relay',true);add(rl,new THREE.BoxGeometry(.02,.016,.018),M(0x2255cc),.008,.01,0,'bank.relay');
 board(panel,.055,.028,0x1d6b44,-.03,-.1,-.06,'bank.esp32',true);board(panel,.03,.03,0x2a4a2a,.05,-.1,-.06,'bank.lora',true);
 anchor(panel,'bank.relay',-.12,-.06,0,2.2,'Opto relay');anchor(panel,'bank.esp32',-.03,-.06,0,2.2,'ESP32');anchor(panel,'bank.lora',.05,-.06,0,2.2,'RFM95W');
 // motor cable + CT
 const cg=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(.14,-.26,-.02),new THREE.Vector3(.14,.05,-.02),new THREE.Vector3(.04,.08,-.02)]);
 panel.add(new THREE.Line(cg,new THREE.LineBasicMaterial({color:0x111111})));
 const ctm=add(panel,new THREE.TorusGeometry(.018,.009,8,18),M(0x2a2a2a),.14,-.17,-.02,'bank.ct');ctm.rotation.x=Math.PI/2;
 anchor(panel,'bank.ct',.15,-.14,0,2.2,'CT clamp');
 // door devices
 const hoa=add(panel,new THREE.CylinderGeometry(.016,.016,.02,16),M(0x222222),.12,.2,.09,'bank.hoa');hoa.rotation.x=Math.PI/2;
 add(panel,new THREE.BoxGeometry(.006,.026,.01),M(0xeeeeee),.12,.2,.102,'bank.hoa');anchor(panel,'bank.hoa',.12,.235,.09,2.2,'Hand-Off-Auto');
 const l1=add(panel,new THREE.SphereGeometry(.007,8,6),M(0x113311,{emissive:0x00ff66,emissiveIntensity:0}),.08,.2,.09);
 const l2=add(panel,new THREE.SphereGeometry(.007,8,6),M(0x331111,{emissive:0xff3322,emissiveIntensity:0}),.05,.2,.09);
 panel.userData.leds=[l1,l2];
 // antenna mast
 add(bank,new THREE.CylinderGeometry(.02,.02,2.0,8),M(0x9aa4a8,{metalness:.6}),0,3.1,0,'bank.antenna');
 add(bank,new THREE.CylinderGeometry(.006,.009,.5,8),M(0x111111),0,4.35,0,'bank.antenna');
 bank.userData.ant=new THREE.Object3D();bank.userData.ant.position.set(0,4.6,0);bank.add(bank.userData.ant);
 anchor(bank,'bank.antenna',0,4.7,0,40,'Bank controller');
}
// motor cable to aerator
{const pts=[new THREE.Vector3(-39,BANK+1.15,13),new THREE.Vector3(-38.8,BANK+.02,13),new THREE.Vector3(-37,BANK+.02,12.4),new THREE.Vector3(-35.5,.05,11.6),new THREE.Vector3(-30,.06,10.4),new THREE.Vector3(-25.3,.25,9.4)];
 scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),60,.025,6),M(0x151515)));
 // existing starter
 const st=new THREE.Group();st.position.set(-41,BANK,15);scene.add(st);add(st,new THREE.BoxGeometry(.4,.5,.25),M(0x6a6f6a),0,1.3,0);add(st,new THREE.CylinderGeometry(.05,.05,1.6,8),M(0x7a6a52),0,.7,0);
}

// ---------- HUB ----------
const hub=new THREE.Group();hub.position.set(-92,BANK,52);scene.add(hub);
{add(hub,new THREE.BoxGeometry(8,3.2,6),M(0xd8cdb8),0,1.6,0,'hub');
 const r=add(hub,new THREE.ConeGeometry(6.2,2.4,4),M(0x9a4a32),0,4.4,0,'hub');r.rotation.y=Math.PI/4;
 add(hub,new THREE.CylinderGeometry(.06,.06,6,8),M(0x9aa4a8,{metalness:.6}),3,6,2,'hub');
 hub.userData.ant=new THREE.Object3D();hub.userData.ant.position.set(3,9.1,2);hub.add(hub.userData.ant);
 const win=add(hub,new THREE.BoxGeometry(1.2,1,.05),M(0x222a30,{emissive:0xffc070,emissiveIntensity:0}),-1.5,1.7,3.03);hub.userData.win=win;
 anchor(hub,'hub',3,9.6,2,400,'Farmhouse hub (~300 m)');
}

// ---------- FISH ----------
const fish=[];
{const bodyG=new THREE.SphereGeometry(1,10,8);const tailG=new THREE.ConeGeometry(.07,.12,4);
 for(let i=0;i<46;i++){const f=new THREE.Group();const c=i%3===0?0x8a9aa6:0xa9b4b8;
  const b=new THREE.Mesh(bodyG,M(c,{metalness:.4,roughness:.4}));b.scale.set(.2,.065,.05);f.add(b);
  const t=new THREE.Mesh(tailG,M(c));t.rotation.z=Math.PI/2;t.position.x=-.24;f.add(t);
  const nearB=i<14;f.userData={x:nearB?BX.x+(Math.random()-.5)*6:(Math.random()-.5)*60,z:nearB?BX.z+(Math.random()-.5)*6:(Math.random()-.5)*32,
    a:Math.random()*6.28,sp:.4+Math.random()*.5,d:-.35-Math.random()*.8,ph:Math.random()*6,tail:t};
  scene.add(f);fish.push(f)}}

// sun / moon discs
const sunMesh=new THREE.Mesh(new THREE.SphereGeometry(8,16,12),new THREE.MeshBasicMaterial({color:0xfff2c0,fog:false}));scene.add(sunMesh);
const moonMesh=new THREE.Mesh(new THREE.SphereGeometry(5,16,12),new THREE.MeshBasicMaterial({color:0xdfe6ff,fog:false}));scene.add(moonMesh);
const stars=new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(Array.from({length:900},(_,i)=>{const a=Math.random()*6.28,e=Math.random()*1.3+.1,r=500;return i%3===0?r*Math.cos(e)*Math.cos(a):i%3===1?r*Math.sin(e):r*Math.cos(e)*Math.sin(a)}),3)),
  new THREE.PointsMaterial({color:0xffffff,size:1.4,sizeAttenuation:false,transparent:true,opacity:0,fog:false}));scene.add(stars);

// ---------- LoRa packets ----------
const PK=[];const pkGeo=new THREE.SphereGeometry(1,12,10);
function nodePos(k){const v=new THREE.Vector3();({B:buoy.userData.ant,K:bank.userData.ant,H:hub.userData.ant})[k].getWorldPosition(v);return v}
function launch(route,ok,color){if(PK.length>14)return;
  const from=route[0],to=route[2];const a=nodePos(from),b=nodePos(to);
  const mat=new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:1,fog:false});
  const m=new THREE.Mesh(pkGeo,mat);scene.add(m);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.9,1,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false,fog:false}));
  ring.rotation.x=-Math.PI/2;ring.position.copy(a);scene.add(ring);
  const d=a.distanceTo(b);const mid=a.clone().lerp(b,.5);mid.y+=Math.max(2,d*.18);
  PK.push({m,ring,a,b,mid,t:0,dur:Math.min(2.2,.9+d/120),ok,d})}
function updPackets(dt){for(let i=PK.length-1;i>=0;i--){const p=PK[i];p.t+=dt;const u=Math.min(1,p.t/p.dur);
  const lim=p.ok?1:.55;const uu=Math.min(u,lim);
  const q=new THREE.Vector3().copy(p.a).multiplyScalar((1-uu)*(1-uu)).add(p.mid.clone().multiplyScalar(2*uu*(1-uu))).add(p.b.clone().multiplyScalar(uu*uu));
  p.m.position.copy(q);const cd=camera.position.distanceTo(q);p.m.scale.setScalar(Math.max(.02,cd*.011));
  if(!p.ok&&u>=lim){p.m.material.color.set(C.crit);p.m.material.opacity=Math.max(0,1-(u-lim)/(.45));p.m.scale.multiplyScalar(1+(u-lim)*3)}
  const rs=.3+p.t*Math.max(3,p.d*.2);p.ring.scale.setScalar(rs);p.ring.material.opacity=Math.max(0,.8-p.t*.9);
  if(u>=1){scene.remove(p.m);scene.remove(p.ring);p.m.material.dispose();p.ring.geometry.dispose();PK.splice(i,1)}}}

// ===================== HOOKS (sim → UI) =====================
const logEl=$('log');
function logLine(html){const d=document.createElement('div');d.innerHTML=html;logEl.prepend(d);while(logEl.children.length>80)logEl.lastChild.remove()}
const RNAME={B2K:'buoy→bank',K2B:'bank→buoy',K2H:'bank→hub',B2H:'buoy→hub',H2K:'hub→bank'};
const RSSI={B2K:-61,K2B:-60,K2H:-84,B2H:-104,H2K:-83};
let pkThrottle=0;
hooks.tx=(route,text,ok)=>{
  const r=RSSI[route]+Math.round(gauss()*2);
  logLine(`<span class="tm">${fmtClock(S.t).s}</span> <span class="rt">${RNAME[route]}</span> ${ok?`<span class="tm">${r} dBm</span>`:'<span class="bad">no delivery</span>'}\n${esc(text)}`);
  const now=performance.now();
  if(route==='K2B'||route==='H2K'||text.includes('FLT=1')||!ok||now-pkThrottle>250||route==='B2H'){
    const col=route==='K2B'||route==='H2K'?C.accent:C.amber;
    const delay=route==='K2B'?500:route==='K2H'?1000:route==='B2H'?600:0;
    setTimeout(()=>launch(route,ok,col),delay/Math.max(1,Math.min(3,S.speed/300)));pkThrottle=now}
  if(route==='B2K'||route==='B2H')flashLED();
};
hooks.event=(msg,cls)=>logLine(`<span class="${cls==='bad'?'bad':cls==='ok'?'ok':'ev'}">● ${esc(msg)}</span>`);
hooks.sms=(text,st)=>toast(text,st);
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
let ledT=0;function flashLED(){ledT=performance.now()}
function toast(text,st){const t=document.createElement('div');t.className='toast'+(st==='queued'?' local':'');
  t.innerHTML=`<b>${st==='queued'?'Alert buffered (hub offline)':'SMS → Farmer +91 ••••• 4821'}</b>${esc(text)}`;$('toasts').prepend(t);
  while($('toasts').children.length>3)$('toasts').lastChild.remove();setTimeout(()=>t.remove(),7000)}

// ===================== UI: controls =====================
$('play').onclick=()=>{S.running=!S.running;$('play').textContent=S.running?'Pause':'Play'};
function setSpeed(v){S.speed=v;document.querySelectorAll('#speeds button').forEach(b=>b.classList.toggle('on',+b.dataset.s===v))}
document.querySelectorAll('#speeds button').forEach(b=>b.onclick=()=>setSpeed(+b.dataset.s));
let curScn='normal';
function buildScn(){const box=$('scn');box.innerHTML='';for(const k in SCENARIOS){const s=SCENARIOS[k];const b=document.createElement('button');b.dataset.k=k;
  b.innerHTML=`<b>${s.name}</b><span>${s.desc}</span>`;b.onclick=()=>runScenario(k);box.appendChild(b)}markScn()}
function markScn(){document.querySelectorAll('#scn button').forEach(b=>b.classList.toggle('on',b.dataset.k===curScn))}
function runScenario(k){curScn=k;loadScenario(S,k);syncInputs();markScn()}
const SL=[['sCloud','oCloud',v=>S.env.cloud=v,()=>S.env.cloud,v=>Math.round(v*100)+'%'],['sAlgae','oAlgae',v=>S.env.algae=v,()=>S.env.algae,v=>v.toFixed(2)+'×'],
 ['sBio','oBio',v=>S.env.biomass=v,()=>S.env.biomass,v=>v.toFixed(2)+'×'],['sSal','oSal',v=>S.env.sal=v,()=>S.env.sal,v=>v.toFixed(1)],
 ['sRain','oRain',v=>S.env.rain=v,()=>S.env.rain,v=>Math.round(v*100)+'%'],['sSoc','oSoc',v=>S.buoy.mAh=v*S.buoy.cap,()=>S.buoy.mAh/S.buoy.cap,v=>Math.round(v*100)+'%']];
SL.forEach(([i,o,set,get,f])=>{$(i).addEventListener('input',e=>{const v=+e.target.value;set(v);$(o).textContent=f(v)})});
$('sHour').addEventListener('input',e=>{const v=+e.target.value;const d=Math.floor(S.t/86400);S.t=d*86400+v*HOUR;S.buoy.nextWake=S.t+5;S.bank.lastRx=S.t;S.nextHist=S.t;S.hist=[];$('oHour').textContent=fmtClock(S.t).s});
function syncInputs(){SL.forEach(([i,o,set,get,f])=>{const v=get();$(i).value=v;$(o).textContent=f(v)});
  $('sHour').value=hourOf(S.t);$('oHour').textContent=fmtClock(S.t).s;
  document.querySelectorAll('#faults input').forEach(c=>c.checked=!!S.faults[c.dataset.f]);$('cLo').value=S.cfg.lo.toFixed(1);$('cHi').value=S.cfg.hi.toFixed(1)}
const FT=[['doDisc','DO probe disconnected','FLT 1'],['doStuck','DO reading stuck','FLT 3'],['phDisc','pH probe disconnected','FLT 4'],['phFoul','pH probe fouled','FLT 5'],
 ['tempFail','DS18B20 failed','FLT 6'],['panelDead','Solar panel dead / covered','leads to FLT 7'],['aerMotorFail','Aerator motor tripped','FLT 10'],['aerWeak','Aerator weak / paddle broken','FLT 11'],
 ['buoyDead','Buoy silent (sunk / dead)','FLT 20'],['bankDown','Bank controller power cut','FLT 21'],['hubDown','Gateway (hub) offline','radio link to the farmhouse lost']];
{const box=$('faults');FT.forEach(([k,n,c])=>{const l=document.createElement('label');l.innerHTML=`<input type="checkbox" id="f_${k}" data-f="${k}"><span>${n}<small>${c}</small></span>`;
  l.querySelector('input').onchange=e=>{S.faults[k]=e.target.checked;hooks.event(`${n}: ${e.target.checked?'injected':'cleared'}`,e.target.checked?'bad':'ok');
    if(k==='buoyDead'&&!e.target.checked){S.buoy.nextWake=S.t+5}};box.appendChild(l)})}

// commands
function cmdAvail(){return !S.faults.hubDown}
function sendCmd(fields,label,onAck){
  if(!cmdAvail()){hooks.event('Gateway offline: command cannot be sent. Use the Hand-Off-Auto switch at the panel.','bad');return}
  const n=++S.cmdN;const txt=`AM1,ID=${IDS.hub},T=CMD,N=${n},DST=${IDS.bank},${fields}`;
  hooks.tx('H2K',txt,!S.faults.bankDown);
  let tries=1;
  const attempt=()=>{
    if(S.faults.bankDown){if(tries<3){tries++;setTimeout(()=>{hooks.tx('H2K',txt+`,RTY=${tries}`,false);attempt()},1800)}
      else hooks.event(`${label}: no ACK after 3 tries – bank controller unreachable`,'bad');return}
    setTimeout(()=>{onAck(n)},900)};
  setTimeout(attempt,600);
}
document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{const m=b.dataset.cmd;
  sendCmd('AER='+m,'AER='+m,n=>{S.bank.mode=m;bankDecide(S);
    hooks.tx('K2H',`AM1,ID=${IDS.bank},T=ACK,N=${n},OK=1,MODE=${m},AER=${S.bank.relay?1:0}${S.bank.hold?',HOLD=1':''}`,true);
    hooks.event(`ACK: mode ${m}${S.bank.hold?' ('+S.bank.hold+')':''}`,'ok')})});
$('cSet').onclick=()=>{const lo=+$('cLo').value,hi=+$('cHi').value;
  if(!(lo>=2&&hi<=9&&hi-lo>=0.5)){hooks.event('Thresholds rejected: need 2 ≤ ON < OFF ≤ 9 and at least 0.5 mg/L apart','bad');return}
  sendCmd(`LO=${lo.toFixed(1)},HI=${hi.toFixed(1)}`,'Thresholds',n=>{S.cfg.lo=lo;S.cfg.hi=hi;
    hooks.tx('K2H',`AM1,ID=${IDS.bank},T=ACK,N=${n},OK=1,LO=${lo.toFixed(1)},HI=${hi.toFixed(1)}`,true);hooks.event(`ACK: thresholds ON<${lo} OFF>${hi} saved to NVS`,'ok')})};
$('cCal').onclick=()=>sendCmd(`FWD=${IDS.buoy},CAL=?`,'Calibration request',n=>{S.buoy.pending={cmd:'CAL?',n};
  hooks.tx('K2H',`AM1,ID=${IDS.bank},T=ACK,N=${n},OK=1,QUEUED=${IDS.buoy}`,true);hooks.event(`Queued for buoy: delivered at its next wake (in ${fmtDur(S.buoy.nextWake-S.t)} sim)`,'ok')});

// ===================== Inspector =====================
let SEL=null;
function buildPlist(){const box=$('plist');let g='';for(const k in COMP){const c=COMP[k];if(c.g!==g){g=c.g;const h=document.createElement('div');h.className='grp';h.textContent=g;box.appendChild(h)}
  const b=document.createElement('button');b.textContent=c.n;b.dataset.k=k;b.onclick=()=>select(k,true);box.appendChild(b)}}
function liveVal(k){const B=S.buoy,K=S.bank,r=B.last;
  switch(k){case 'buoy.do':return r?`Now: ${r.DO.toFixed(2)} mg/L · ${r.DOS.toFixed(0)} % sat · true pond ${S.w.DO.toFixed(2)}`:'';
   case 'buoy.ph':return r?`Now: pH ${r.PH.toFixed(2)} (true ${S.w.pH.toFixed(2)})`:'';
   case 'buoy.temp':return r?`Now: ${r.WT.toFixed(1)} °C`:'';
   case 'buoy.batt':case 'buoy.charger':return `Now: ${battV(B).toFixed(2)} V · ${Math.round(B.mAh/B.cap*100)} % · ${(5*S.light*0.7/4*1000*(S.faults.panelDead?0:1)).toFixed(0)} mA solar in`;
   case 'buoy.solar':return `Now: ${(5*S.light*(S.faults.panelDead?0:1)).toFixed(1)} W (sun ${Math.round(S.sun*100)} %, cloud ${Math.round(S.env.cloud*100)} %)`;
   case 'buoy.esp32':case 'buoy.lora':return `State ${B.state} · next wake in ${fmtDur(B.nextWake-S.t)} · ${B.why}`;
   case 'bank.contactor':case 'bank.relay':return `Contactor ${K.relay?'ON':'OFF'} · mode ${K.mode}`;
   case 'bank.ct':return `Motor current ${K.current.toFixed(2)} A`;
   case 'bank.esp32':return `${K.reason}${K.hold?' · '+K.hold:''}`;
   case 'pond.aerator':return S.aerRunning?'Running · paddles turning':K.relay?'Contactor ON but motor not turning':'Stopped';
   case 'hub':return S.faults.hubDown?'Offline':`Online · ${S.hub.rx} packets · ${S.hub.sms} SMS sent`;
  }return ''}
function select(k,fromUser){
  if(SEL&&COMPMESH[SEL])COMPMESH[SEL].forEach(m=>{m.material.emissive&&m.material.emissive.set(m.userData.em0||0)});
  SEL=k;const c=COMP[k];if(!c)return;
  (COMPMESH[k]||[]).forEach(m=>{if(m.material.emissive){if(m.userData.em0===undefined)m.userData.em0=m.material.emissive.getHex()}});
  ANCH.forEach(a=>a.el.classList.toggle('sel',a.comp===k));
  document.querySelectorAll('#plist button').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  const pins=c.pins?`<div class="tbl"><table><thead><tr><th>Pin</th><th>Connects to</th></tr></thead><tbody>${c.pins.map(p=>`<tr><td class="m">${p[0]}</td><td>${p[1]}</td></tr>`).join('')}</tbody></table></div>`:'';
  $('card').innerHTML=`<h3>${c.n}</h3><div class="meta"><span class="pill info">${c.g}</span><span class="pill">${c.price}</span></div>
   <p><b>Part:</b> ${c.part}</p><p>${c.role}</p>${c.why?`<p class="note">${c.why}</p>`:''}${pins}<p class="note" id="liveV" style="color:var(--accent)"></p>`;
  if(fromUser&&window.innerWidth<680)$('insp').scrollIntoView({behavior:'smooth',block:'start'});
}
const ray=new THREE.Raycaster(),mp=new THREE.Vector2();let downAt=null;
canvas.addEventListener('pointerdown',e=>{downAt=[e.clientX,e.clientY]});
canvas.addEventListener('pointerup',e=>{if(!downAt)return;if(Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>5)return;
  const r=canvas.getBoundingClientRect();mp.x=(e.clientX-r.left)/r.width*2-1;mp.y=-(e.clientY-r.top)/r.height*2+1;ray.setFromCamera(mp,camera);
  const hit=ray.intersectObjects(PICK,false)[0];if(hit)select(hit.object.userData.comp,false)});

// ===================== Camera presets =====================
const CAMS={
 overview:{p:[38,30,52],t:[-8,0,4]},
 buoy:{p:[BX.x+1.6,1.1,BX.z+2.0],t:[BX.x,.2,BX.z]},
 inside:{p:[BX.x+.32,.42,BX.z+.42],t:[BX.x,.14,BX.z+.06]},
 probes:{p:[BX.x+.75,-.45,BX.z+.75],t:[BX.x,-.5,BX.z]},
 bank:{p:[-37.6,BANK+1.75,13.4],t:[-39,BANK+1.4,13]},
 aerator:{p:[-19,3.2,16],t:[-24,.2,9]},
 network:{p:[10,70,95],t:[-40,0,25]},
};
let camAnim=null;
function goCam(k){const c=CAMS[k];camAnim={p0:camera.position.clone(),t0:controls.target.clone(),p1:new THREE.Vector3(...c.p),t1:new THREE.Vector3(...c.t),u:0}}
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>goCam(b.dataset.cam));

// view toggles
let showLabels=true,explode=false,explodeU=0,autoRot=false;
$('tLabels').onclick=e=>{showLabels=!showLabels;e.target.classList.toggle('on',showLabels)};
$('tExplode').onclick=e=>{explode=!explode;e.target.classList.toggle('on',explode)};
$('tAuto').onclick=e=>{autoRot=!autoRot;controls.autoRotate=autoRot;controls.autoRotateSpeed=.6;e.target.textContent=autoRot?'Auto-rotate on':'Auto-rotate off'};
$('xray').oninput=e=>XRAY.forEach(m=>m.opacity=+e.target.value);
$('clar').oninput=e=>{};

// ===================== Judge demo =====================
const DEMO=[
 {cam:'overview',sel:'pond.water',t:'The problem: oxygen crashes at night',x:'In a 70 × 40 m pond, plankton makes oxygen in daylight and everything consumes it at night. Below 4 mg/L fish are stressed, below 2 they gasp at the surface and die. Today a farmer stays awake to switch the aerator.',do(){runScenario('normal');setSpeed(300)}},
 {cam:'buoy',sel:'buoy.box',t:'Part A: floating sensor buoy',x:'A foam ring carries a sealed IP65 box, a 5 W solar panel and a 1.2 m antenna. It runs on two 18650 cells only. There is no mains wiring anywhere on the water.',do(){setX(.15)}},
 {cam:'inside',sel:'buoy.iso',t:'Inside the box',x:'ESP32 + RFM95W LoRa, a 16-bit ADS1115, and two analog isolators. DO and pH probes sit in the same water, so each gets its own isolated supply. Without that, current flows probe to probe and both readings drift.',do(){explode=true;$('tExplode').classList.add('on')}},
 {cam:'probes',sel:'buoy.guard',t:'Probes at 60 cm, inside a slotted guard',x:'DO, pH and DS18B20 tips sit together at 60 cm in a 63 mm slotted PVC pipe. A 2 kg ballast keeps the buoy upright. Two anchors hold it 15 m away from the aerator so it measures the pond, not the aerator jet.',do(){explode=false;$('tExplode').classList.remove('on')}},
 {cam:'network',sel:'buoy.lora',t:'Wake → measure → send → sleep',x:'The buoy sleeps at ≈0.15 mA, wakes every 15 min by day and every 5 min at night (or when DO < 5), sends one AM1 packet, listens 1 s for the bank’s reply, and sleeps. Average ≈ 0.5 Wh/day, so 3 cloudy days are no problem.',do(){S.buoy.nextWake=S.t+1}},
 {cam:'bank',sel:'bank.contactor',t:'Part B: bank-side controller',x:'Mains stays on the bank. An opto-isolated relay switches only the contactor coil, an MCB and fuse protect it, a clip-on CT measures motor current, and a Hand-Off-Auto switch lets the farmer always run the aerator by hand.',do(){setX(.12)}},
 {cam:'overview',sel:'bank.esp32',t:'Night crash: aerator starts by itself',x:'Cloudy day, heavy plankton, 21:15. DO drops through 4.0 mg/L. The bank controller switches ON at once, then holds at least 20 min, and switches OFF only above 6.0 mg/L. Watch the packets and the SMS.',do(){runScenario('crash');setSpeed(300)}},
 {cam:'bank',sel:'bank.ct',t:'Aerator failure is detected',x:'Same night, but the motor has tripped. The contactor is ON, yet the CT reads 0 A. After 30 s the controller raises FLT 10 and sends an urgent packet; the farmer gets an SMS.',do(){runScenario('aerFail');setSpeed(60)}},
 {cam:'overview',sel:'hub',t:'Internet down? Still safe.',x:'The hub is offline. The buoy and bank still run the full aerator loop locally. Alerts are buffered and delivered when the hub returns.',do(){runScenario('hubDown');setSpeed(300)}},
 {cam:'network',sel:'buoy.lora',t:'Bank controller dead? Farmer still warned.',x:'No ACK from the bank for 2 packets → the buoy raises FLT 21 and transmits straight to the hub at SF9. If instead the buoy goes silent for 35 min, the bank runs the aerator as a night-time failsafe (FLT 20).',do(){runScenario('bankDown');setSpeed(300)}},
 {cam:'overview',sel:'buoy.do',t:'What we claim, honestly',x:'Galvanic DO ±0.2–0.3 mg/L after weekly calibration; pH ±0.1 with 2-point calibration and weekly cleaning. The twin model is illustrative: our real proof is a 48-hour pond trial against a reference meter.',do(){runScenario('normal');setSpeed(60)}},
];
let demo=null;const DSTEP=11000;
function setX(v){$('xray').value=v;XRAY.forEach(m=>m.opacity=v)}
function demoGo(i){if(i<0||i>=DEMO.length){demoExit();return}demo.i=i;demo.t=0;const s=DEMO[i];
  $('capStep').textContent=`Step ${i+1} / ${DEMO.length}`;$('capTitle').textContent=s.t;$('capText').textContent=s.x;
  s.do&&s.do();goCam(s.cam);select(s.sel,false)}
function demoStart(){demo={i:0,t:0,paused:false};$('caption').hidden=false;$('demoBtn').textContent='■ Stop demo';demoGo(0);$('stage').scrollIntoView({behavior:'smooth',block:'start'})}
function demoExit(){demo=null;$('caption').hidden=true;$('demoBtn').textContent='▶ Play judge demo'}
$('demoBtn').onclick=()=>demo?demoExit():demoStart();
$('capNext').onclick=()=>demoGo(demo.i+1);$('capPrev').onclick=()=>demoGo(Math.max(0,demo.i-1));$('capExit').onclick=demoExit;
$('capPause').onclick=()=>{demo.paused=!demo.paused;$('capPause').textContent=demo.paused?'Resume':'Pause'};

// ===================== Readouts / panels =====================
function chip(id,val,cls){const e=$(id);e.querySelector('b').textContent=val;e.classList.remove('crit','warn','ok');if(cls)e.classList.add(cls)}
function kv(id,rows){$(id).innerHTML=rows.map(r=>`<dt>${r[0]}</dt><dd${r[2]?` style="color:var(--${r[2]})"`:''}>${r[1]}</dd>`).join('')}
$('fltTbl').innerHTML=Object.entries(FAULT_TEXT).filter(([k])=>k!=='0').map(([k,v])=>`<tr><td class="m">${k}</td><td>${v}</td></tr>`).join('');
$('wBuoy').innerHTML='<thead><tr><th>ESP32 / pin</th><th>Signal</th><th>Level</th><th>Goes to</th><th>Notes</th></tr></thead><tbody>'+WIRE_BUOY.map(r=>`<tr><td class="m">${r[0]}</td><td>${r[1]}</td><td class="m">${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')+'</tbody>';
$('wBank').innerHTML='<thead><tr><th>Pin / terminal</th><th>Signal</th><th>Level</th><th>Goes to</th><th>Notes</th></tr></thead><tbody>'+WIRE_BANK.map(r=>`<tr><td class="m">${r[0]}</td><td>${r[1]}</td><td class="m">${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')+
 '<tr><td colspan="5" class="note">Electrician must: wire contactor coil + HOA into the existing starter circuit, fit MCB/fuses, earth the panel and DIN rail, test RCD, and sign off before AUTO mode is used. Students wire only the 5 V / 3.3 V side.</td></tr></tbody>';

function updPanels(){
  const B=S.buoy,K=S.bank,r=B.last,ck=fmtClock(S.t);const night=isNight(hourOf(S.t));
  $('clk').textContent=`Day ${ck.d} · ${ck.s}`;const dn=$('dn');dn.textContent=night?'Night mode':'Day';dn.className='pill '+(night?'info':'warn');
  if(r){const dc=B.codes.some(c=>c>=1&&c<=3)?'crit':r.DO<4?'crit':r.DO<5?'warn':'ok';
    chip('hDO',B.codes.includes(1)?'0.00 ✕':r.DO.toFixed(2),dc);chip('hDOS',r.DOS.toFixed(0)+' %');chip('hPH',r.PH.toFixed(2),B.codes.some(c=>c===4||c===5)?'warn':'');chip('hWT',r.WT.toFixed(1),r.WT<-50?'crit':'')}
  chip('hAER',K.relay?(S.aerRunning?'ON':'ON ✕'):'OFF',K.relay?(S.aerRunning?'ok':'crit'):'');chip('hAERI',K.current.toFixed(1));
  const bv=battV(B);chip('hBV',bv.toFixed(2),bv<3.4?'crit':bv<3.6?'warn':'');
  const all=[...new Set([...B.codes,...K.codes])];const f=topFault(all);chip('hFLT',f?String(f):'0',f?'crit':'ok');$('hFLT').title=FAULT_TEXT[f];
  kv('fwBuoy',[['State',S.faults.buoyDead?'OFF / lost':B.state==='TX'&&performance.now()-ledT<700?'TX':'Deep sleep'],['Sampling',B.why],['Next wake',fmtDur(B.nextWake-S.t)],['Packet N',B.seq],
    ['Battery',`${bv.toFixed(2)} V · ${Math.round(B.mAh/B.cap*100)} %`],['Faults',B.codes.length?B.codes.join(', '):'none',B.codes.length?'crit':'ok']]);
  kv('fwBank',[['Power',S.faults.bankDown?'OFF':'on (mains)',S.faults.bankDown?'crit':'ok'],['Mode',K.mode],['Contactor',K.relay?'ON':'OFF',K.relay?'ok':''],['Motor current',K.current.toFixed(2)+' A'],
    ['Decision',K.reason],['Timer',K.hold||'free'],['Last buoy pkt',fmtDur(S.t-K.lastRx)+' ago'],['Faults',K.codes.length?K.codes.join(', '):'none',K.codes.length?'crit':'ok']]);
  const rp=K.resp;
  kv('judge',[['Aerator response',rp?`DO<${S.cfg.lo} seen → contactor ${fmtDur(rp.onAt-rp.doAt)} → current ${rp.curAt?fmtDur(rp.curAt-rp.onAt):'—'}`:'—'],
    ['RSSI buoy→bank','≈ −61 dBm (47 m)'],['RSSI bank→hub','≈ −84 dBm (300 m)'],['RSSI buoy→hub direct','≈ −104 dBm (SF9 limit −129)'],
    ['Buoy energy','≈ 0.5 Wh/day vs 22 Wh battery'],['Packets at hub',S.hub.rx],['SMS sent / buffered',`${S.hub.sms} / ${S.hub.queue}`]]);
  const hp=$('hubPill');hp.textContent=S.faults.hubDown?'Gateway offline':'Gateway online';hp.className='pill '+(S.faults.hubDown?'crit':'ok');
  document.querySelectorAll('[data-cmd],#cSet,#cCal').forEach(b=>b.disabled=S.faults.hubDown);
  kv('cmdState',[['Mode at bank',K.mode],['ON below',S.cfg.lo.toFixed(1)+' mg/L'],['OFF above',S.cfg.hi.toFixed(1)+' mg/L'],['Min ON / OFF','20 min / 5 min'],['Queued for buoy',B.pending?B.pending.cmd:'—']]);
  if(SEL){const lv=$('liveV');if(lv)lv.textContent=liveVal(SEL)}
  if(!demo||true){$('sHour').value=hourOf(S.t);$('oHour').textContent=ck.s;$('sSoc').value=B.mAh/B.cap;$('oSoc').textContent=Math.round(B.mAh/B.cap*100)+'%'}
}

// chart
const chart=$('chart'),cx=chart.getContext('2d');
function drawChart(){
  const dpr=Math.min(devicePixelRatio||1,2),w=chart.clientWidth,h=chart.clientHeight;if(!w)return;
  if(chart.width!==Math.round(w*dpr)){chart.width=Math.round(w*dpr);chart.height=Math.round(h*dpr)}
  cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,w,h);
  const L=34,R=34,T=8,Bm=20,pw=w-L-R,ph=h-T-Bm;const t1=S.t,t0=t1-24*HOUR;
  const X=t=>L+(t-t0)/(t1-t0)*pw,Y=v=>T+ph-(v/12)*ph,Yp=v=>T+ph-((v-6)/4)*ph;
  cx.font='10px "IBM Plex Mono", monospace';cx.fillStyle=C.mute;cx.strokeStyle=C.line;cx.lineWidth=1;
  for(let v=0;v<=12;v+=2){cx.beginPath();cx.moveTo(L,Y(v)+.5);cx.lineTo(L+pw,Y(v)+.5);cx.stroke();cx.fillText(v,6,Y(v)+3)}
  for(let v=6;v<=10;v+=1){cx.fillText(v.toFixed(0),L+pw+6,Yp(v)+3)}
  const H=S.hist;
  // aerator shading
  cx.fillStyle='rgba(98,208,147,.18)';for(let i=1;i<H.length;i++)if(H[i].aer===1)cx.fillRect(X(H[i-1].t),T,Math.max(1,X(H[i].t)-X(H[i-1].t)),ph);
  cx.fillStyle='rgba(242,103,93,.22)';for(let i=1;i<H.length;i++)if(H[i].aer===2)cx.fillRect(X(H[i-1].t),T,Math.max(1,X(H[i].t)-X(H[i-1].t)),ph);
  // thresholds
  cx.setLineDash([5,4]);for(const [v,c] of[[S.cfg.lo,C.crit],[S.cfg.hi,C.ok]]){cx.strokeStyle=c;cx.beginPath();cx.moveTo(L,Y(v));cx.lineTo(L+pw,Y(v));cx.stroke();cx.fillStyle=c;cx.fillText((v===S.cfg.lo?'ON < ':'OFF > ')+v.toFixed(1),L+4,Y(v)-4)}
  cx.setLineDash([2,3]);line(H,p=>p.sat,Y,C.mute,1);cx.setLineDash([]);
  line(H,p=>p.pH,Yp,C.amber,1.4);line(H,p=>p.DO,Y,C.accent,2.2);
  if(H.length){const p=H[H.length-1];cx.fillStyle=C.accent;cx.beginPath();cx.arc(X(p.t),Y(p.DO),3.5,0,7);cx.fill()}
  cx.fillStyle=C.mute;for(let k=0;k<=24;k+=6){const tt=t1-(24-k)*HOUR;cx.fillText(k===24?'now':fmtClock(tt).s,Math.min(X(tt)-14,w-30),h-5)}
  cx.save();cx.translate(10,T+ph/2+40);cx.rotate(-Math.PI/2);cx.restore();
  function line(H,f,Yf,col,lw){if(H.length<2)return;cx.strokeStyle=col;cx.lineWidth=lw;cx.beginPath();H.forEach((p,i)=>{const x=X(p.t),y=Yf(f(p));i?cx.lineTo(x,y):cx.moveTo(x,y)});cx.stroke()}
}

// ===================== resize + loop =====================
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
new ResizeObserver(resize).observe(stage);resize();

const skyDay=new THREE.Color(0x8fc3dc),skyDusk=new THREE.Color(0xe39a6e),skyNight=new THREE.Color(0x0a1430),waterUnder=new THREE.Color(0x1c4a44);
const tmpC=new THREE.Color(),wHigh=new THREE.Color(0x2f8a74),wLow=new THREE.Color(0x4a5a3a),wCrash=new THREE.Color(0x5a4f34);
let last=performance.now(),panelT=0,elapsed=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function loop(now){
  const dt=Math.min(.1,(now-last)/1000);last=now;elapsed+=dt;
  if(!LIVE.on&&S.running&&!(demo&&demo.paused))advance(S,dt*S.speed);
  if(demo&&!demo.paused){demo.t+=dt*1000;$('capBar').style.width=Math.min(100,demo.t/DSTEP*100)+'%';if(demo.t>DSTEP)demoGo(demo.i+1)}
  // sky
  const h=hourOf(S.t),sun=S.sun;const dusk=Math.max(0,1-Math.abs(h-18.2)/1.2)+Math.max(0,1-Math.abs(h-6.2)/1.2);
  tmpC.copy(skyNight).lerp(skyDay,Math.min(1,sun*1.6*(1-.4*S.env.cloud)+.0));if(dusk>0)tmpC.lerp(skyDusk,Math.min(.6,dusk*.6));
  const under=camera.position.y<-0.02&&Math.abs(camera.position.x)<PX&&Math.abs(camera.position.z)<PZ;
  const clar=+$('clar').value;
  if(under){scene.background=waterUnder.clone().lerp(tmpC,.1);scene.fog.color.copy(waterUnder);scene.fog.near=.1;scene.fog.far=1.2+clar*6}
  else{scene.background=tmpC.clone();scene.fog.color.copy(tmpC);scene.fog.near=140;scene.fog.far=420}
  const sa=(h-6)/12*Math.PI;sunL.position.set(Math.cos(sa)*100,Math.sin(sa)*100,40);sunL.intensity=Math.max(0,Math.sin(sa))*1.1*(1-.5*S.env.cloud);
  hemi.intensity=.42+.5*sun;moonL.intensity=sun>.05?0:.45;
  sunMesh.position.set(Math.cos(sa)*380,Math.sin(sa)*380-20,-150);sunMesh.visible=sun>0.01;
  moonMesh.position.set(-Math.cos(sa)*380,-Math.sin(sa)*380,-150);moonMesh.visible=sun<0.05;
  stars.material.opacity=Math.max(0,.9-sun*4);
  // water
  const DO=S.w.DO;tmpC.copy(wLow).lerp(wHigh,Math.min(1,Math.max(0,(DO-2)/6)));if(DO<3)tmpC.lerp(wCrash,(3-DO)/3);
  waterMat.color.copy(tmpC);waterMat.opacity=.82-clar*.5;
  const pa=waterGeo.attributes.position.array;const amp=reduced?0:.025+.04*S.env.rain;
  for(let i=0;i<pa.length;i+=3){const x=waterBase[i],z=waterBase[i+2];pa[i+1]=Math.sin(x*.5+elapsed*1.3)*amp+Math.cos(z*.7+elapsed*1.1)*amp*.7}
  waterGeo.attributes.position.needsUpdate=true;
  // buoy bob
  buoy.position.y=reduced?0:Math.sin(elapsed*1.6)*.012;buoy.rotation.z=reduced?0:Math.sin(elapsed*1.1)*.025;buoy.rotation.x=reduced?0:Math.cos(elapsed*1.3)*.02;
  explodeU+=((explode?1:0)-explodeU)*Math.min(1,dt*4);
  INT.forEach(o=>{o.position.copy(o.userData.base).addScaledVector(o.userData.ex,explodeU);o.scale.setScalar(1+explodeU*.35)});
  encl.userData.led.material.emissiveIntensity=now-ledT<500?2:0;
  buoy.userData.panel.material.emissive.setHex(0x0a1d55);buoy.userData.panel.material.emissiveIntensity=S.light*.6*(S.faults.panelDead?0:1);
  // aerator
  const run=S.aerRunning;impellers.forEach(im=>{im.userData.w=(im.userData.w||0)+((run?(S.faults.aerWeak?3:7):0)-(im.userData.w||0))*Math.min(1,dt*1.5);im.rotation.x-=im.userData.w*dt});
  const wv=impellers[0].userData.w||0;foam.material.opacity=Math.min(.55,wv/7*.55);
  for(let i=0;i<SPL;i++){if(splPos[i*3+1]<-.05){if(wv>1&&Math.random()<.3)respawn(i);else{splPos[i*3+1]=-5;continue}}
    splVel[i*3+1]-=9.8*dt;splPos[i*3]+=splVel[i*3]*dt;splPos[i*3+1]+=splVel[i*3+1]*dt;splPos[i*3+2]+=splVel[i*3+2]*dt}
  splGeo.attributes.position.needsUpdate=true;
  panel.userData.cind.material.emissiveIntensity=S.bank.relay?2:0;
  panel.userData.leds[0].material.emissiveIntensity=S.faults.bankDown?0:(Math.sin(now/300)>0?1.5:.3);
  const anyF=[...S.buoy.codes,...S.bank.codes].length>0;panel.userData.leds[1].material.emissiveIntensity=anyF&&!S.faults.bankDown?(Math.sin(now/150)>0?2:0):0;
  hub.userData.win.material.emissiveIntensity=sun<.15&&!S.faults.hubDown?1.2:0;
  // fish
  const gasp=DO<2.6;
  fish.forEach(f=>{const u=f.userData;u.ph+=dt;u.a+=Math.sin(u.ph*.7)*dt*.6;const sp=u.sp*(gasp?.3:1);
    u.x+=Math.cos(u.a)*sp*dt;u.z+=Math.sin(u.a)*sp*dt;
    if(Math.abs(u.x)>PX-3){u.a=Math.PI-u.a;u.x=Math.sign(u.x)*(PX-3)}if(Math.abs(u.z)>PZ-3){u.a=-u.a;u.z=Math.sign(u.z)*(PZ-3)}
    const ty=gasp?-.06:u.d;f.position.y+=(ty-f.position.y)*Math.min(1,dt*.8);f.position.x=u.x;f.position.z=u.z;
    f.rotation.y=-u.a;f.rotation.z=gasp?.5+Math.sin(u.ph*3)*.2:0;u.tail.rotation.y=Math.sin(u.ph*(gasp?4:10))*.4});
  updPackets(dt);
  if(camAnim){camAnim.u=Math.min(1,camAnim.u+dt/1.4);const e=camAnim.u<.5?2*camAnim.u*camAnim.u:1-Math.pow(-2*camAnim.u+2,2)/2;
    camera.position.lerpVectors(camAnim.p0,camAnim.p1,e);controls.target.lerpVectors(camAnim.t0,camAnim.t1,e);if(camAnim.u>=1)camAnim=null}
  controls.update();
  // highlight pulse
  if(SEL&&COMPMESH[SEL]){const k=(Math.sin(now/220)+1)/2;COMPMESH[SEL].forEach(m=>{if(m.material.emissive){m.material.emissive.setRGB(.1+.25*k,.45+.4*k,.55+.45*k)}})}
  renderer.render(scene,camera);
  // labels
  const w=stage.clientWidth,hh=stage.clientHeight,v=new THREE.Vector3();
  ANCH.forEach(a=>{a.o.getWorldPosition(v);const d=camera.position.distanceTo(v);v.project(camera);
    const vis=showLabels&&v.z<1&&d<a.maxDist&&Math.abs(v.x)<1.05&&Math.abs(v.y)<1.05;a.el.hidden=!vis;
    if(vis){a.el.style.left=((v.x+1)/2*w)+'px';a.el.style.top=((1-v.y)/2*hh-8)+'px'}});
  panelT+=dt;if(panelT>.2){panelT=0;updPanels();drawChart()}
  requestAnimationFrame(loop);
}
buildScn();buildPlist();loadScenario(S,'normal');S.t=16*HOUR+40*MIN;S.buoy.nextWake=S.t+10;S.bank.lastRx=S.t;S.bank.lastChange=S.t-HOUR;
syncInputs();select('buoy.do',false);setX(.18);goCam('overview');
requestAnimationFrame(loop);
window.__twin={S,LIVE,get scenario(){return curScn}};   // for tests and the browser console
