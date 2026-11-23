/* BHOOMI Pond Node digital twin · PROTOTYPE TANK view: 3D bench, UI and render loop.
   The firmware model (S, step, control, packets...) is in shared/model/tank-model.cjs.
   In Live mode js/live-adapter.js sets LIVE.on and the backend's model drives S instead of advance(). */
'use strict';
const LIVE={on:false,id:null};
const S=newState();
const $=id=>document.getElementById(id);
const css=getComputedStyle(document.documentElement);
const C={accent:css.getPropertyValue('--accent').trim(),amber:css.getPropertyValue('--amber').trim(),ok:css.getPropertyValue('--ok').trim(),crit:css.getPropertyValue('--crit').trim(),mute:css.getPropertyValue('--mute').trim(),line:css.getPropertyValue('--line').trim()};

// ===================== COMPONENTS =====================
const COMP={
 'esp32':{g:'Controller',n:'ESP32-DevKitC',part:'ESP32-WROOM-32 DevKitC, powered from USB',price:'₹500',
   role:'Runs BhoomiPondNode.ino: samples sensors, decides the pump, drives the OLED/LEDs/buzzer, reads the button and talks LoRa to the hub. Works with no internet.',
   pins:[['GPIO18/19/23','SPI SCK / MISO / MOSI → RFM95W'],['GPIO5 · 14 · 26','RFM95W NSS · RESET · DIO0'],['GPIO21 · 22','I²C SDA · SCL → ADS1115, INA219, DS3231, OLED'],['GPIO4','DS18B20 data (4.7 kΩ to 3V3)'],['GPIO32','Relay IN (active LOW) → pump'],['GPIO33','Push button to GND (internal pull-up)'],['GPIO2 · 25','Green LED · red LED (330 Ω)'],['GPIO13','Active buzzer module']]},
 'lora':{g:'Radio',n:'RFM95W LoRa',part:'HopeRF RFM95W 868 MHz (SX1276) + 3 dBi whip',price:'₹1,350',
   role:'865.0625 MHz, SF9, BW 125 kHz, sync word 0x12. Sends an AM1 POND packet after every sample and on every pump change; listens for hub commands and ACKs them.',
   pins:[['VCC / GND','3V3 / GND (never 5 V)'],['SCK MISO MOSI','GPIO18 19 23'],['NSS / RESET / DIO0','GPIO5 (10 kΩ pull-up) / GPIO14 / GPIO26'],['ANT','868 MHz whip, fitted before power-up']]},
 'ads':{g:'Measurement',n:'ADS1115 ADC',part:'16-bit I²C ADC module, address 0x48',price:'₹300',
   role:'Reads the DO and pH signals through the isolators with 0.125 mV steps. The ESP32’s own ADC is too noisy for the tens of mV a galvanic DO probe gives.',
   pins:[['VDD / GND','3V3 / GND'],['SDA / SCL','GPIO21 / GPIO22'],['ADDR','GND (0x48)'],['A0','DO isolator OUT'],['A1','pH isolator OUT'],['A2, A3','GND (unused)']]},
 'isoDO':{g:'Measurement',n:'DO signal isolator',part:'DFRobot DFR0504 Gravity analog isolator',price:'₹1,900',
   role:'Gives the DO probe its own isolated supply and signal path, so current cannot flow probe → water → pH probe (ground loop).',
   pins:[['Controller side','VCC 5V, GND, OUT → ADS A0'],['Sensor side','Gravity cable to DO signal board']]},
 'isoPH':{g:'Measurement',n:'pH signal isolator',part:'DFRobot DFR0504 Gravity analog isolator',price:'₹1,900',
   role:'Same as the DO isolator, for the pH board. Two probes in one bucket need two isolators.',pins:[['Controller side','VCC 5V, GND, OUT → ADS A1'],['Sensor side','Gravity cable to pH V2 board']]},
 'doBoard':{g:'Measurement',n:'DO signal board',part:'DFRobot SEN0237-A interface board',price:'(with probe kit)',role:'Amplifies the galvanic probe’s mV signal. BNC from the probe; Gravity cable to the DO isolator.'},
 'phBoard':{g:'Measurement',n:'pH V2 board',part:'DFRobot pH meter V2 interface',price:'(with probe)',role:'Buffers the glass electrode’s high-impedance signal. BNC from the electrode; Gravity cable to the pH isolator.'},
 'ina':{g:'Pump',n:'INA219 current sensor',part:'INA219 I²C module (0.1 Ω shunt), address 0x40',price:'₹200',
   role:'Sits in the pump’s + wire. Measures pump current (about 280 mA when running) for FLT 10, and the USB supply voltage for FLT 7.',
   pins:[['VCC / GND','3V3 / GND'],['SDA / SCL','GPIO21 / GPIO22'],['VIN+','5 V rail'],['VIN−','Relay COM']]},
 'relay':{g:'Pump',n:'Relay module',part:'1-channel 5 V relay with PC817 opto, JD-VCC jumper removed',price:'₹150',
   role:'GPIO32 LOW closes the relay and starts the pump. On the real pond the same signal drives the aerator contactor coil.',
   pins:[['IN','GPIO32 (active LOW)'],['VCC (opto side)','3V3, so it fully releases when GPIO32 is HIGH'],['JD-VCC / GND','5 V / GND'],['COM / NO','INA219 VIN− / pump +']]},
 'rtc':{g:'Controller',n:'DS3231 clock',part:'DS3231 RTC module + CR2032',price:'₹150',role:'Keeps time through power cuts so the node knows night (18:00–07:00) without the hub.',pins:[['VCC / GND','3V3 / GND'],['SDA / SCL','GPIO21 / GPIO22 (0x68)']]},
 'oled':{g:'Display',n:'0.96" OLED',part:'SSD1306 128×64 I²C, address 0x3C',price:'₹250',
   role:'Shows DO, % saturation, pH, temperature, pump state and current, mode, fault code and the time to the next sample. The 3D lid shows exactly what the firmware draws.',pins:[['VCC / GND','3V3 / GND'],['SDA / SCL','GPIO21 / GPIO22']]},
 'button':{g:'Display',n:'Push button',part:'12 mm panel push button (momentary)',price:'₹40',role:'Short press cycles AUTO → ON → OFF. Hold 2 s to mute the buzzer (60 s demo / 30 min real). Click it on the 3D lid.',pins:[['Pin 1','GPIO33 (internal pull-up)'],['Pin 2','GND']]},
 'leds':{g:'Display',n:'Status LEDs',part:'5 mm green + red, 330 Ω each',price:'₹10',role:'Green: solid while the pump runs, blinking otherwise. Red: any fault.',pins:[['Green','GPIO2 → 330 Ω → LED → GND'],['Red','GPIO25 → 330 Ω → LED → GND']]},
 'buzzer':{g:'Display',n:'Buzzer',part:'Active buzzer module 3.3–5 V',price:'₹40',role:'Beeps every 2 s when DO < 3 mg/L or on FLT 10 / 11.',pins:[['S','GPIO13'],['VCC / GND','3V3 / GND']]},
 'power':{g:'Power',n:'USB power bank',part:'10,000 mAh power bank, 5 V 2 A, USB cable to the DevKitC',price:'₹800',role:'Powers the whole node and the pump. A 10 Ah bank runs the bucket demo for most of a day.',pins:[['5V','ESP32 5V/VIN pin, 5 V rail'],['GND','common ground']]},
 'box':{g:'Mechanical',n:'Enclosure',part:'Clear ABS/acrylic project box ≈ 200 × 120 × 75 mm, OLED window, cable glands',price:'₹400',role:'Holds all electronics beside the bucket, off the water.'},
 'doProbe':{g:'Probes',n:'DO probe (galvanic)',part:'DFRobot SEN0237-A',price:'₹15,000–19,000',role:'Membrane probe, ±0.2–0.3 mg/L after air calibration. Needs water moving past it: the air stone does that.'},
 'phProbe':{g:'Probes',n:'pH electrode',part:'DFRobot SEN0169-V2 industrial',price:'₹5,500–7,500',role:'±0.1 pH after 2-point calibration (6.86 / 4.01). Rated for continuous immersion.'},
 'temp':{g:'Probes',n:'DS18B20',part:'Waterproof DS18B20, stainless tip',price:'₹150',role:'±0.5 °C. Used for DO temperature compensation and the Nernst correction of pH.',pins:[['Red / black','3V3 / GND'],['Yellow','GPIO4 + 4.7 kΩ to 3V3']]},
 'pump':{g:'Pump',n:'5 V mini air pump',part:'5 V DC aquarium air pump (≈ 300 mA) + 1N5819 diode across it',price:'₹250',role:'Stands in for the 1–2 HP paddle-wheel aerator. Same ON/OFF rule, same failure checks.'},
 'stone':{g:'Pump',n:'Air stone + tube',part:'Cylinder air stone, 4 mm silicone tube, check valve',price:'₹80',role:'Turns the pump’s air into fine bubbles that dissolve oxygen. A clogged stone still draws current but adds little O₂ → FLT 11.'},
 'tank':{g:'Mechanical',n:'Tank (the pond)',part:'15–20 L glass tank or clear bucket, tap water rested 24 h',price:'₹600',role:'Stands in for the 70 × 40 m pond. Probes hang from a bar at about 15 cm depth.'},
 'hub':{g:'Network',n:'AgriMesh hub',part:'Existing farmhouse gateway: ESP32 + LoRa + 4G',price:'existing',role:'Logs packets, sends SMS on new fault codes, sends commands. Not needed for the pump rule.'},
};
const PINS=[['GPIO18','SPI SCK','RFM95W SCK','#5fdc7a'],['GPIO19','SPI MISO','RFM95W MISO','#5fdc7a'],['GPIO23','SPI MOSI','RFM95W MOSI','#5fdc7a'],['GPIO5','SPI NSS','RFM95W NSS + 10 kΩ pull-up','#5fdc7a'],
 ['GPIO14','RESET','RFM95W RESET','#c77dff'],['GPIO26','DIO0 IRQ','RFM95W DIO0','#c77dff'],['GPIO21','I²C SDA','ADS1115, INA219, DS3231, OLED','#4f8dff'],['GPIO22','I²C SCL','ADS1115, INA219, DS3231, OLED','#ffd34f'],
 ['GPIO4','1-Wire','DS18B20 data, 4.7 kΩ to 3V3','#c77dff'],['GPIO32','Relay IN','Relay module IN (LOW = pump ON)','#c77dff'],['GPIO33','Button','Push button to GND','#c77dff'],
 ['GPIO2','LED','Green LED via 330 Ω','#c77dff'],['GPIO25','LED','Red LED via 330 Ω','#c77dff'],['GPIO13','Buzzer','Active buzzer module S','#c77dff'],
 ['3V3','Power','RFM95W, ADS1115, INA219, DS3231, OLED, DS18B20, relay opto VCC, buzzer','#ff5a4f'],['5V (VIN)','Power','USB in; isolators VCC, relay JD-VCC, INA219 VIN+ → pump','#ff5a4f'],['GND','Ground','Common ground for everything on the controller side','#9aa4a8'],
 ['ADS A0 / A1','Analog','DO isolator OUT / pH isolator OUT','#ff9f43']];

// ===================== THREE SCENE =====================
const canvas=$('c'),stage=$('stage');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0b1416);
scene.fog=new THREE.Fog(0x0b1416,6,14);
const camera=new THREE.PerspectiveCamera(42,1,0.005,60);
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.08;controls.maxDistance=8;controls.maxPolarAngle=Math.PI*.95;
scene.add(new THREE.HemisphereLight(0xd8ecff,0x2a2218,.65));
const lamp=new THREE.SpotLight(0xfff0d8,1.25,8,Math.PI/4.2,.5,1.2);lamp.position.set(.2,2.2,.9);lamp.target.position.set(0,0,0);scene.add(lamp,lamp.target);
const fill=new THREE.DirectionalLight(0x9fc7ff,.35);fill.position.set(-2,1.5,-1);scene.add(fill);

const PICK=[],COMPMESH={},XRAY=[],ANCH=[],INT=[];
function M(color,o){return new THREE.MeshStandardMaterial(Object.assign({color,roughness:.65,metalness:.05},o||{}))}
function add(parent,geo,mat,x,y,z,comp){const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);parent.add(m);
  if(comp){m.userData.comp=comp;PICK.push(m);(COMPMESH[comp]=COMPMESH[comp]||[]).push(m)}return m}
function anchor(parent,comp,x,y,z,maxDist,text){const o=new THREE.Object3D();o.position.set(x,y,z);parent.add(o);
  const el=document.createElement('div');el.className='lbl';el.textContent=text||COMP[comp].n;el.addEventListener('click',()=>select(comp,true));
  $('labels').appendChild(el);ANCH.push({o,el,comp,maxDist});return o}
function pcb(parent,w,d,color,x,y,z,comp){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
  add(g,new THREE.BoxGeometry(w,.0016,d),M(color,{roughness:.5}),0,0,0,comp);return g}
function chipOn(g,w,d,color,x,z,h,comp){return add(g,new THREE.BoxGeometry(w,h||.0025,d),M(color||0x1b1b1b,{roughness:.4}),x||0,(h||.0025)/2+.0008,z||0,comp)}
function pinRow(g,n,x0,z,dx,comp){const geo=new THREE.BoxGeometry(.0012,.006,.0012),mat=M(0xc9a54a,{metalness:.7,roughness:.3});
  for(let i=0;i<n;i++)add(g,geo,mat,x0+i*dx,.003,z,comp)}
function internal(obj,ex){obj.userData.base=obj.position.clone();obj.userData.ex=new THREE.Vector3(...ex);INT.push(obj);return obj}

// ---------- bench ----------
add(scene,new THREE.BoxGeometry(2.0,.04,1.0),M(0x5b4632,{roughness:.85}),0,-.02,0);
for(const [x,z] of[[-.95,-.45],[.95,-.45],[-.95,.45],[.95,.45]])add(scene,new THREE.BoxGeometry(.05,.75,.05),M(0x3f3124),x,-.415,z);
add(scene,new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),M(0x111a1c,{roughness:1}),0,-.79,0);
// cutting mat
add(scene,new THREE.BoxGeometry(.62,.002,.42),M(0x1f5a50,{roughness:.9}),.36,.001,.02);

// ---------- tank ----------
const TX=-.42,TZ=0,TW=.40,TD=.28,TH=.30,WH=.24;
const tank=new THREE.Group();tank.position.set(TX,0,TZ);scene.add(tank);
{const glass=new THREE.MeshPhysicalMaterial({color:0xcfe8ea,transparent:true,opacity:.14,roughness:.05,metalness:0,side:THREE.DoubleSide,depthWrite:false});
 add(tank,new THREE.BoxGeometry(TW,.006,TD),M(0x9fb8ba,{transparent:true,opacity:.5}),0,.003,0,'tank');
 for(const [w,h,d,x,z] of[[TW,TH,.004,0,TD/2],[TW,TH,.004,0,-TD/2],[.004,TH,TD,TW/2,0],[.004,TH,TD,-TW/2,0]])add(tank,new THREE.BoxGeometry(w,h,d),glass,x,TH/2,z,'tank');
 const ed=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(TW,TH,TD)),new THREE.LineBasicMaterial({color:0x8fb7bb,transparent:true,opacity:.6}));ed.position.y=TH/2;tank.add(ed);
 add(tank,new THREE.BoxGeometry(TW-.01,.01,TD-.01),M(0xc8b48a,{roughness:1}),0,.011,0);   // sand
 anchor(tank,'tank',-.15,TH+.02,-.1,4,'Tank = the pond');
}
const waterMat=new THREE.MeshPhysicalMaterial({color:0x4fa8a0,transparent:true,opacity:.28,roughness:.1,metalness:0,depthWrite:false,side:THREE.DoubleSide});
const water=add(tank,new THREE.BoxGeometry(TW-.008,WH,TD-.008),waterMat,0,WH/2+.006,0);
const surfGeo=new THREE.PlaneGeometry(TW-.008,TD-.008,24,16).rotateX(-Math.PI/2);const surfBase=surfGeo.attributes.position.array.slice();
const surf=new THREE.Mesh(surfGeo,new THREE.MeshPhysicalMaterial({color:0x7fd0c8,transparent:true,opacity:.35,roughness:.05,depthWrite:false,side:THREE.DoubleSide}));
surf.position.y=WH+.006;tank.add(surf);
// probe bar
add(tank,new THREE.BoxGeometry(TW+.04,.012,.03),M(0xe8e6de),0,TH+.006,-.02);
const PROBES={};
{const bx=[-.07,0,.065];
 // DO probe
 const dg=new THREE.Group();dg.position.set(bx[0],TH+.012,-.02);tank.add(dg);
 add(dg,new THREE.CylinderGeometry(.012,.012,.17,20),M(0x161616),0,-.085,0,'doProbe');
 add(dg,new THREE.CylinderGeometry(.0122,.0122,.012,20),M(0xdfe3e3,{roughness:.2}),0,-.176,0,'doProbe');
 add(dg,new THREE.CylinderGeometry(.006,.006,.02,10),M(0x161616),0,.01,0,'doProbe');
 PROBES.do=dg;anchor(dg,'doProbe',-.03,-.15,0,1.2,'DO probe');
 // pH
 const pg=new THREE.Group();pg.position.set(bx[1],TH+.012,-.02);tank.add(pg);
 add(pg,new THREE.CylinderGeometry(.006,.006,.16,16),M(0x56656e),0,-.08,0,'phProbe');
 add(pg,new THREE.SphereGeometry(.0065,14,10),M(0xd8f4ff,{transparent:true,opacity:.75,roughness:.05}),0,-.163,0,'phProbe');
 add(pg,new THREE.CylinderGeometry(.008,.008,.03,16),M(0x2a2a2a),0,.012,0,'phProbe');
 PROBES.ph=pg;anchor(pg,'phProbe',.0,-.135,.012,1.2,'pH probe');
 // DS18B20
 const tg=new THREE.Group();tg.position.set(bx[2],TH+.012,-.02);tank.add(tg);
 add(tg,new THREE.CylinderGeometry(.003,.003,.15,10),M(0xd0d4d6,{metalness:.9,roughness:.25}),0,-.08,0,'temp');
 PROBES.t=tg;anchor(tg,'temp',.025,-.14,0,1.2,'DS18B20');
 // depth tick
 const dm=new THREE.LineBasicMaterial({color:0x6fd0e6,transparent:true,opacity:.7});
 tank.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-TW/2+.01,WH+.006,TD/2-.01),new THREE.Vector3(-TW/2+.01,.13,TD/2-.01)]),dm));
}
// air stone
const STONE=new THREE.Vector3(TX+.08,.03,TZ+.06);
add(tank,new THREE.CylinderGeometry(.012,.012,.05,16),M(0x8d9497,{roughness:1}),.08,.026,.06,'stone').rotation.z=Math.PI/2;
anchor(tank,'stone',.08,.06,.07,1.4,'Air stone');

// bubbles
const NB=360,bGeo=new THREE.BufferGeometry(),bPos=new Float32Array(NB*3),bVel=new Float32Array(NB);
bGeo.setAttribute('position',new THREE.BufferAttribute(bPos,3));
const bubbles=new THREE.Points(bGeo,new THREE.PointsMaterial({color:0xeaffff,size:.006,transparent:true,opacity:.85,depthWrite:false}));tank.add(bubbles);
for(let i=0;i<NB;i++){bPos[i*3+1]=-1}
function bubbleSpawn(i){bPos[i*3]=.08+(Math.random()-.5)*.045;bPos[i*3+1]=.035;bPos[i*3+2]=.06+(Math.random()-.5)*.018;bVel[i]=.07+Math.random()*.08}

// fish (3 small)
const fish=[];
for(let i=0;i<3;i++){const f=new THREE.Group();const b=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),M(0xd38b3a,{roughness:.4}));b.scale.set(.024,.01,.007);f.add(b);
  const t=new THREE.Mesh(new THREE.ConeGeometry(.008,.014,4),M(0xd38b3a));t.rotation.z=Math.PI/2;t.position.x=-.03;f.add(t);
  f.userData={a:Math.random()*6,ph:Math.random()*6,y:.08+i*.05,tail:t};tank.add(f);fish.push(f)}

// ---------- air pump ----------
const pumpG=new THREE.Group();pumpG.position.set(-.06,0,.3);scene.add(pumpG);
{add(pumpG,new THREE.BoxGeometry(.1,.05,.065),M(0x2c6fb0,{roughness:.5}),0,.025,0,'pump');
 add(pumpG,new THREE.BoxGeometry(.1,.006,.065),M(0x1d1d1d),0,.002,0,'pump');
 add(pumpG,new THREE.CylinderGeometry(.004,.004,.02,8),M(0xdddddd),.055,.03,0,'pump').rotation.z=Math.PI/2;
 anchor(pumpG,'pump',0,.065,0,2,'5 V air pump');}
// air tube
{const pts=[new THREE.Vector3(-.0,.03,.3),new THREE.Vector3(-.12,.02,.29),new THREE.Vector3(-.2,.1,.16),new THREE.Vector3(-.26,.33,.07),new THREE.Vector3(-.32,.31,.06),new THREE.Vector3(-.34,.12,.06),new THREE.Vector3(STONE.x+.025,STONE.y+.005,STONE.z)];
 scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),80,.0028,6),M(0xe8f2f0,{transparent:true,opacity:.75,roughness:.2})));}

// ---------- enclosure + electronics ----------
const BX=.36,BZ=.02;
const box=new THREE.Group();box.position.set(BX,.003,BZ);scene.add(box);
const encMat=M(0xe6eef0,{transparent:true,opacity:.16,depthWrite:false,roughness:.2});XRAY.push(encMat);
const BW=.24,BD=.16,BH=.075;
{add(box,new THREE.BoxGeometry(BW,.004,BD),M(0x2a3134),0,.002,0,'box');
 for(const [w,h,d,x,z] of[[BW,BH,.003,0,BD/2],[BW,BH,.003,0,-BD/2],[.003,BH,BD,BW/2,0],[.003,BH,BD,-BW/2,0]])add(box,new THREE.BoxGeometry(w,h,d),encMat,x,BH/2,z,'box');
 const ed=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BW,BH,BD)),new THREE.LineBasicMaterial({color:0x9fdcea,transparent:true,opacity:.7}));ed.position.y=BH/2;box.add(ed);
 anchor(box,'box',-BW/2+.02,BH+.012,-BD/2,2.2,'Enclosure');
}
// perfboard
add(box,new THREE.BoxGeometry(BW-.016,.0016,BD-.016),M(0xb8915a,{roughness:.8}),0,.005,0);
const BASE=.0066;
// module layout (x,z) inside box
const MOD={};
function module(key,w,d,color,x,z,deco){const g=pcb(box,w,d,color,x,BASE,z,key);deco&&deco(g,w,d);MOD[key]=g;return g}
module('esp32',.055,.028,0x1d1d1d,-.065,.035,(g,w,d)=>{chipOn(g,.018,.025,0xb8bcc0,.012,0,.003,'esp32');chipOn(g,.006,.004,0xcccccc,-.026,0,.003,'esp32');pinRow(g,19,-.025,-.012,.0027,'esp32');pinRow(g,19,-.025,.012,.0027,'esp32')});
module('lora',.026,.026,0x2a4a2a,.01,.045,(g)=>{chipOn(g,.016,.016,0x9aa0a6,0,0,.002,'lora')});
module('ads',.028,.018,0x4b1f7a,-.07,-.01,(g)=>{chipOn(g,.006,.006,0x1b1b1b,0,0,.0015,'ads');pinRow(g,10,-.012,-.0075,.0026,'ads')});
module('ina',.022,.022,0x5b2b8a,.07,-.008,(g)=>{chipOn(g,.005,.004,0x1b1b1b,0,0,.0015,'ina');chipOn(g,.008,.004,0xd8d0b0,0,.006,.0015,'ina')});
module('rtc',.034,.022,0x1f4fa8,-.02,-.01,(g)=>{add(g,new THREE.CylinderGeometry(.01,.01,.003,20),M(0xc0c4c8,{metalness:.8,roughness:.3}),.006,.0025,0,'rtc')});
module('relay',.04,.026,0x1a3f8a,.08,.045,(g)=>{chipOn(g,.019,.015,0x2255cc,-.004,0,.015,'relay');chipOn(g,.008,.012,0x2a8a3a,.014,0,.008,'relay')});
module('isoDO',.034,.022,0x1f6fb8,-.07,-.05,(g)=>{chipOn(g,.008,.008,0x1b1b1b,0,0,.003,'isoDO');add(g,new THREE.BoxGeometry(.03,.002,.0035),M(0xf2675d,{emissive:0x441111}),0,.002,0,'isoDO')});
module('isoPH',.034,.022,0x1f6fb8,-.025,-.05,(g)=>{chipOn(g,.008,.008,0x1b1b1b,0,0,.003,'isoPH');add(g,new THREE.BoxGeometry(.03,.002,.0035),M(0xf2675d,{emissive:0x441111}),0,.002,0,'isoPH')});
module('doBoard',.032,.024,0x1a3f8a,.025,-.05,(g)=>{add(g,new THREE.CylinderGeometry(.0045,.0045,.012,12),M(0xc0c4c8,{metalness:.8}),.01,.006,0,'doBoard')});
module('phBoard',.032,.024,0x8a3f1a,.07,-.05,(g)=>{add(g,new THREE.CylinderGeometry(.0045,.0045,.012,12),M(0xc0c4c8,{metalness:.8}),.01,.006,0,'phBoard')});
internal(MOD.esp32,[-.03,.07,.05]);internal(MOD.lora,[0,.1,.07]);internal(MOD.ads,[-.06,.08,-.01]);internal(MOD.ina,[.05,.09,.07]);internal(MOD.rtc,[-.01,.11,0]);
internal(MOD.relay,[.08,.08,0]);internal(MOD.isoDO,[-.05,.06,-.07]);internal(MOD.isoPH,[-.01,.09,-.08]);internal(MOD.doBoard,[.03,.07,-.08]);internal(MOD.phBoard,[.08,.1,-.08]);
anchor(MOD.esp32,'esp32',0,.012,0,1.1,'ESP32');anchor(MOD.lora,'lora',0,.01,0,1.1,'RFM95W');anchor(MOD.ads,'ads',0,.008,0,1.1,'ADS1115');
anchor(MOD.ina,'ina',0,.008,0,1.1,'INA219');anchor(MOD.rtc,'rtc',0,.008,0,1.1,'DS3231');anchor(MOD.relay,'relay',0,.024,0,1.1,'Relay');
anchor(MOD.isoDO,'isoDO',0,.008,0,1.1,'DO isolator');anchor(MOD.isoPH,'isoPH',0,.008,0,1.1,'pH isolator');anchor(MOD.doBoard,'doBoard',0,.016,0,1.1,'DO board');anchor(MOD.phBoard,'phBoard',0,.016,0,1.1,'pH board');
// antenna (on box wall)
const ant=new THREE.Group();ant.position.set(.105,BH,-BD/2+.012);box.add(ant);
add(ant,new THREE.CylinderGeometry(.0045,.0045,.012,10),M(0xc8a64a,{metalness:.8}),0,.006,0,'lora');
add(ant,new THREE.CylinderGeometry(.004,.0055,.17,10),M(0x151515),0,.097,0,'lora');
const antTip=new THREE.Object3D();antTip.position.set(0,.19,0);ant.add(antTip);
anchor(ant,'lora',0,.2,0,3,'LoRa antenna');
// lid with OLED, button, LEDs, buzzer
const lid=new THREE.Group();lid.position.set(0,BH,0);box.add(lid);internal(lid,[0,.12,0]);
const lidMat=M(0xe6eef0,{transparent:true,opacity:.16,depthWrite:false,roughness:.2});XRAY.push(lidMat);
add(lid,new THREE.BoxGeometry(BW,.003,BD),lidMat,0,.0015,0,'box');
const oledCanvas=document.createElement('canvas');oledCanvas.width=256;oledCanvas.height=128;
const oc=oledCanvas.getContext('2d');const oledTex=new THREE.CanvasTexture(oledCanvas);oledTex.magFilter=THREE.NearestFilter;oledTex.minFilter=THREE.LinearFilter;
const oledG=new THREE.Group();oledG.position.set(-.04,.003,.02);lid.add(oledG);MOD.oled=oledG;
add(oledG,new THREE.BoxGeometry(.03,.002,.028),M(0x1a3f8a),0,.001,0,'oled');
const oledScreen=add(oledG,new THREE.PlaneGeometry(.026,.013).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:oledTex}),0,.0023,-.002,'oled');
// make OLED bigger for readability (scale group visually ~2x real)
oledG.scale.set(2.1,1,2.1);
anchor(oledG,'oled',0,.01,-.015,1.4,'OLED');
const btn=add(lid,new THREE.CylinderGeometry(.008,.008,.008,20),M(0xd8322a,{roughness:.4}),.06,.007,.03,'button');
add(lid,new THREE.CylinderGeometry(.011,.011,.003,20),M(0x222222),.06,.003,.03,'button');
anchor(lid,'button',.06,.02,.03,1.2,'Button');
const ledG=add(lid,new THREE.SphereGeometry(.004,12,8),M(0x103010,{emissive:0x22ff66,emissiveIntensity:0}),.06,.005,-.02,'leds');
const ledR=add(lid,new THREE.SphereGeometry(.004,12,8),M(0x301010,{emissive:0xff3322,emissiveIntensity:0}),.075,.005,-.02,'leds');
anchor(lid,'leds',.0675,.016,-.02,1.2,'LEDs');
const buzz=add(lid,new THREE.CylinderGeometry(.006,.006,.009,18),M(0x151515),.095,.0055,.03,'buzzer');
anchor(lid,'buzzer',.095,.02,.03,1.2,'Buzzer');
const buzzRing=new THREE.Mesh(new THREE.RingGeometry(.9,1,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xf2675d,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));
buzzRing.position.set(.095,.012,.03);lid.add(buzzRing);

// power bank
const pb=new THREE.Group();pb.position.set(.2,0,.3);pb.rotation.y=Math.PI/2;scene.add(pb);
add(pb,new THREE.BoxGeometry(.07,.022,.14),M(0x2b2f33,{roughness:.4,metalness:.2}),0,.011,0,'power');
const pbLeds=[];for(let i=0;i<4;i++)pbLeds.push(add(pb,new THREE.BoxGeometry(.004,.002,.004),M(0x103010,{emissive:0x44ccff,emissiveIntensity:1}),-.02+i*.008,.023,.06));
anchor(pb,'power',0,.04,0,2,'Power bank');
scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(.27,.012,.3),new THREE.Vector3(BX-.09,.012,BZ+BD/2+.06),new THREE.Vector3(BX-.092,.014,BZ+BD/2+.005),new THREE.Vector3(BX-.092,.012,BZ+.035)]),60,.0022,6),M(0x111111)));

// probe cables & pump cable (box → tank / pump)
function cable(pts,color,r){return scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),80,r||.0022,6),M(color,{roughness:.6})))}
cable([[BX+.025,.012,BZ-.05],[BX+.025,.016,BZ-BD/2-.02],[.1,.05,-.2],[-.2,.36,-.1],[TX-.07,.36,-.03],[TX-.07,TH+.03,-.02]],0x1a1a1a);
cable([[BX+.07,.012,BZ-.05],[BX+.07,.016,BZ-BD/2-.025],[.12,.06,-.22],[-.2,.38,-.08],[TX,.37,-.03],[TX,TH+.03,-.02]],0x3a3a3a);
cable([[BX-.065,.012,BZ+.035],[BX-BW/2-.005,.02,BZ+.02],[0,.04,-.05],[-.18,.35,-.06],[TX+.065,.35,-.03],[TX+.065,TH+.03,-.02]],0x222222,.0016);
cable([[BX+.09,.012,BZ+.045],[BX+.09,.014,BZ+BD/2+.02],[.15,.01,.27],[.0,.02,.3]],0xb02020,.0018);

// ---------- hub ----------
const hub=new THREE.Group();hub.position.set(1.45,0,-.95);scene.add(hub);
add(hub,new THREE.BoxGeometry(.14,.09,.1),M(0xd8cdb8),0,.045,0,'hub');
add(hub,new THREE.CylinderGeometry(.005,.007,.3,8),M(0x111111),.05,.24,0,'hub');
const hubTip=new THREE.Object3D();hubTip.position.set(.05,.4,0);hub.add(hubTip);
const hubLed=add(hub,new THREE.BoxGeometry(.01,.006,.002),M(0x103010,{emissive:0x22ff66,emissiveIntensity:1}),-.04,.07,.051);
add(hub,new THREE.BoxGeometry(.3,.6,.3),M(0x3a2f26),0,-.3-.001,0);
anchor(hub,'hub',0,.45,0,8,'AgriMesh hub (farmhouse)');

// ---------- wiring overlay ----------
const WIRES=new THREE.Group();box.add(WIRES);
const WCOL={pwr:0xff5a4f,gnd:0x9aa4a8,sda:0x4f8dff,scl:0xffd34f,spi:0x5fdc7a,ana:0xff9f43,gpio:0xc77dff};
const wireDefs=[];
function wpos(key,dx,dz,dy){return ()=>{const g=MOD[key]||key;const v=new THREE.Vector3(dx||0,dy||.003,dz||0);g.localToWorld(v);box.worldToLocal(v);return v}}
function wire(a,b,col,lift){wireDefs.push({a,b,col,lift:lift||.02})}
wire(wpos('esp32',-.02,-.012),wpos('lora',-.01,-.01),'spi',.018);wire(wpos('esp32',-.017,-.012),wpos('lora',-.005,-.012),'spi',.022);wire(wpos('esp32',-.014,-.012),wpos('lora',0,-.012),'spi',.026);
wire(wpos('esp32',-.011,-.012),wpos('lora',.005,-.012),'spi',.03);wire(wpos('esp32',-.008,.012),wpos('lora',.01,.01),'gpio',.02);
for(const [k,dx,dz] of[['ads',-.008,-.0075],['rtc',-.012,-.008],['ina',-.006,-.008]]){wire(wpos('esp32',.01,-.012),wpos(k,dx,dz),'sda',.03);wire(wpos('esp32',.013,-.012),wpos(k,dx+.003,dz),'scl',.036)}
wire(wpos('esp32',.01,-.012),wpos('oled',-.004,-.01,.004),'sda',.05);wire(wpos('esp32',.013,-.012),wpos('oled',-.001,-.01,.004),'scl',.056);
wire(wpos('isoDO',.01,.008),wpos('ads',.008,-.0075),'ana',.02);wire(wpos('isoPH',.01,.008),wpos('ads',.011,-.0075),'ana',.024);
wire(wpos('doBoard',-.014,0),wpos('isoDO',.015,0),'ana',.016);wire(wpos('phBoard',-.014,.004),wpos('isoPH',.015,.004),'ana',.03);
wire(wpos('esp32',.022,.012),wpos('relay',-.018,.0),'gpio',.03);wire(wpos('ina',0,-.01),wpos('relay',.0,.012),'pwr',.02);
wire(wpos('esp32',.019,.012),wpos(btn,0,0,0),'gpio',.04);wire(wpos('esp32',.016,.012),wpos(ledG,0,0,0),'gpio',.045);wire(wpos('esp32',.004,.012),wpos(ledR,0,0,0),'gpio',.05);
wire(wpos('esp32',.007,.012),wpos(buzz,0,0,0),'gpio',.055);
wire(wpos('esp32',-.025,.012),wpos('isoDO',-.015,-.008),'pwr',.04);wire(wpos('esp32',-.025,.012),wpos('isoPH',-.015,-.008),'pwr',.045);
wire(wpos('esp32',-.022,-.012),wpos('ads',-.012,-.0075),'pwr',.02);wire(wpos('esp32',-.019,-.012),wpos('ads',-.01,-.0075),'gnd',.016);
wire(wpos('esp32',-.022,-.012),wpos('rtc',-.015,-.008),'pwr',.025);wire(wpos('esp32',-.019,-.012),wpos('rtc',-.014,-.009),'gnd',.02);
const wireMats={};for(const k in WCOL)wireMats[k]=new THREE.LineBasicMaterial({color:WCOL[k],transparent:true,opacity:.95,depthTest:false});
function buildWires(){WIRES.children.slice().forEach(c=>{WIRES.remove(c);c.geometry.dispose()});
  for(const w of wireDefs){const a=w.a(),b=w.b();const m1=a.clone().lerp(b,.3),m2=a.clone().lerp(b,.7);const top=Math.max(a.y,b.y)+w.lift;m1.y=top;m2.y=top;
    const g=new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3([a,m1,m2,b]).getPoints(24));const l=new THREE.Line(g,wireMats[w.col]);l.renderOrder=5;WIRES.add(l)}}
// relay → pump label wires outside handled by red cable

// ---------- LoRa packets ----------
const PK=[];const pkGeo=new THREE.SphereGeometry(1,12,10);
function wp(o){const v=new THREE.Vector3();o.getWorldPosition(v);return v}
function launch(fromNode,ok,color){if(PK.length>10)return;
  const a=wp(fromNode?antTip:hubTip),b=wp(fromNode?hubTip:antTip);
  const m=new THREE.Mesh(pkGeo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:1,fog:false}));scene.add(m);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.9,1,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false,fog:false}));
  ring.rotation.x=-Math.PI/2;ring.position.copy(a);scene.add(ring);
  const mid=a.clone().lerp(b,.5);mid.y+=.35;PK.push({m,ring,a,b,mid,t:0,dur:1.1,ok})}
function updPackets(dt){for(let i=PK.length-1;i>=0;i--){const p=PK[i];p.t+=dt;const u=Math.min(1,p.t/p.dur);const lim=p.ok?1:.5,uu=Math.min(u,lim);
  const q=p.a.clone().multiplyScalar((1-uu)*(1-uu)).add(p.mid.clone().multiplyScalar(2*uu*(1-uu))).add(p.b.clone().multiplyScalar(uu*uu));
  p.m.position.copy(q);p.m.scale.setScalar(Math.max(.004,camera.position.distanceTo(q)*.012));
  if(!p.ok&&u>=lim){p.m.material.color.set(C.crit);p.m.material.opacity=Math.max(0,1-(u-lim)/.5)}
  p.ring.scale.setScalar(.01+p.t*.12);p.ring.material.opacity=Math.max(0,.7-p.t*1.2);
  if(u>=1){scene.remove(p.m);scene.remove(p.ring);p.m.material.dispose();p.ring.material.dispose();p.ring.geometry.dispose();PK.splice(i,1)}}}

// ===================== HOOKS =====================
const logEl=$('log');
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function logLine(html){const d=document.createElement('div');d.innerHTML=html;logEl.prepend(d);while(logEl.children.length>90)logEl.lastChild.remove()}
const tm=()=>clock(S.t).join(':');
let pkThrottle=0;
hooks.tx=(route,text,ok,why)=>{
  const fromNode=route==='N2H';const r=(fromNode?-78:-76)+Math.round(gauss()*2);
  logLine(`<span class="tm">${tm()}</span> <span class="rt">${fromNode?'node→hub':'hub→node'}</span> ${ok?`<span class="tm">${r} dBm${why?' · '+esc(why):''}</span>`:'<span class="bad">lost (hub offline)</span>'}\n${esc(text)}`);
  const now=performance.now();if(!fromNode||!ok||now-pkThrottle>350||why!=='sample'){launch(fromNode,ok,fromNode?C.amber:C.accent);pkThrottle=now}
  if(fromNode)txFlash=performance.now();
};
hooks.event=(msg,cls)=>logLine(`<span class="${cls==='bad'?'bad':cls==='ok'?'ok':'ev'}">● ${esc(msg)}</span>`);
hooks.alert=(text)=>toast(text,'sent');
let txFlash=0;
function toast(text,st){const t=document.createElement('div');t.className='toast'+(st==='local'?' local':'');
  t.innerHTML=`<b>${st==='local'?'On the node':'Hub → SMS to farmer'}</b>${esc(text)}`;$('toasts').prepend(t);
  while($('toasts').children.length>3)$('toasts').lastChild.remove();setTimeout(()=>t.remove(),6500)}

// ===================== OLED (mirrors drawOled) =====================
function drawOled(){
  const n=S.n,R=n.R;const g=oc;g.fillStyle='#000';g.fillRect(0,0,256,128);g.fillStyle='#7fe8ff';
  const F=(sz)=>{g.font=`${sz===2?22:11}px "IBM Plex Mono", monospace`;g.textBaseline='top'};
  F(1);g.fillText('BHOOMI '+NODE_ID,0,0);g.fillText(clock(S.t).slice(0,2).join(':'),196,0);
  g.fillText('DO',0,28);F(2);g.fillText(!n.haveSample?'--.--':n.doInvalid?'ERR':R.doMgL.toFixed(2),36,22);
  F(1);g.fillText('mg/L',168,28);if(n.haveSample&&!n.doInvalid)g.fillText(R.doSat.toFixed(0)+'%',168,44);
  g.fillText(`pH ${R.ph.toFixed(2)}  ${R.wtOk?R.wt.toFixed(1):'--.-'}C`,0,64);
  g.fillText(`PUMP ${n.pumpOn?'ON ':'OFF'} ${(n.pumpMa/1000).toFixed(2)}A ${n.mode}`,0,84);
  const f=topFault(n.faultMask);
  g.fillText(f?`FLT${f} ${FAULT_SHORT[f]}`:n.holdText?n.holdText:`OK next ${fmtSec(n.nextSample-S.t)}`,0,108);
  if(S.demo)g.fillText('D',232,108);
  if(performance.now()-txFlash<600){g.beginPath();g.arc(248,72,6,0,7);g.fill()}
  oledTex.needsUpdate=true;
}

// ===================== UI =====================
$('play').onclick=()=>{S.running=!S.running;$('play').textContent=S.running?'Pause':'Play'};
function setSpeed(v){S.speed=v;document.querySelectorAll('#speeds button').forEach(b=>b.classList.toggle('on',+b.dataset.s===v))}
document.querySelectorAll('#speeds button').forEach(b=>b.onclick=()=>setSpeed(+b.dataset.s));
let curScn='normal';
function buildScn(){const box=$('scn');box.innerHTML='';for(const k in SCENARIOS){const s=SCENARIOS[k];const b=document.createElement('button');b.dataset.k=k;
  b.innerHTML=`<b>${s.name}</b><span>${s.desc}</span>`;b.onclick=()=>runScenario(k);box.appendChild(b)}markScn()}
function markScn(){document.querySelectorAll('#scn button').forEach(b=>b.classList.toggle('on',b.dataset.k===curScn))}
function runScenario(k){curScn=k;loadScenario(S,k);syncInputs();markScn()}
const SL=[['sDem','oDem',v=>S.env.demand=v,()=>S.env.demand,v=>v.toFixed(2)],['sAmb','oAmb',v=>S.env.amb=v,()=>S.env.amb,v=>v.toFixed(1)],
 ['sSal','oSal',v=>S.env.sal=v,()=>S.env.sal,v=>v.toFixed(1)],['sSup','oSup',v=>S.env.supply=v,()=>S.env.supply,v=>v.toFixed(2)+' V']];
SL.forEach(([i,o,set,get,f])=>$(i).addEventListener('input',e=>{const v=+e.target.value;set(v);$(o).textContent=f(v)}));
$('sHour').addEventListener('input',e=>{const v=+e.target.value;const d=Math.floor(S.t/86400);S.t=d*86400+v*3600;S.n.nextSample=Math.min(S.n.nextSample,S.t+2);S.n.lastChange=Math.min(S.n.lastChange,S.t);S.n.onAt=Math.min(S.n.onAt,S.t);S.chart=[];S.nextChart=S.t;$('oHour').textContent=clock(S.t).slice(0,2).join(':')});
function syncInputs(){SL.forEach(([i,o,set,get,f])=>{$(i).value=get();$(o).textContent=f(get())});
  $('sHour').value=hourOf(S.t);$('oHour').textContent=clock(S.t).slice(0,2).join(':');
  document.querySelectorAll('#faults input').forEach(c=>c.checked=!!S.faults[c.dataset.f]);$('cLo').value=S.n.lo.toFixed(1);$('cHi').value=S.n.hi.toFixed(1)}
const FT=[['doDisc','DO probe unplugged','FLT 1'],['doStuck','DO signal frozen','FLT 3'],['phDisc','pH probe unplugged','FLT 4'],['phFoul','pH probe fouled','FLT 5'],
 ['tempFail','DS18B20 failed','FLT 6'],['supplyLow','Power bank sagging','FLT 7'],['pumpFail','Pump unplugged / dead','FLT 10'],['stoneClog','Air stone clogged','FLT 11'],['hubDown','Gateway (hub) offline','packets lost']];
{const box=$('faults');FT.forEach(([k,n,c])=>{const l=document.createElement('label');l.innerHTML=`<input type="checkbox" id="f_${k}" data-f="${k}"><span>${n}<small>${c}</small></span>`;
  l.querySelector('input').onchange=e=>{S.faults[k]=e.target.checked;if(k==='phFoul'&&!e.target.checked){S.n.faultMask&=~bit(5);S.n.hist=[]}hooks.event(`${n}: ${e.target.checked?'injected':'cleared'}`,e.target.checked?'bad':'ok')};box.appendChild(l)})}
$('pressShort').onclick=()=>{pressShort(S);btnPress=performance.now()};
$('pressLong').onclick=()=>{pressLong(S);btnPress=performance.now()};
function markTimers(){$('tmDemo').classList.toggle('on',S.demo);$('tmReal').classList.toggle('on',!S.demo);$('timersPill').textContent=S.demo?'Demo timers':'Real timers';
  $('chartTitle').textContent=S.demo?'Last 10 minutes':'Last 24 hours'}
$('tmDemo').onclick=()=>{setDemo(S,true);markTimers();if(S.speed>30)setSpeed(5)};
$('tmReal').onclick=()=>{setDemo(S,false);markTimers();if(S.speed<30)setSpeed(300)};
function hubCmd(fields,label){
  if(S.faults.hubDown){hooks.event('Gateway offline: command not sent. Use the button on the lid.','bad');return}
  S.n.cmdN++;const parts=Object.entries(fields).map(([k,v])=>`${k}=${typeof v==='number'?v.toFixed(1):v}`).join(',');
  hooks.tx('H2N',`AM1,ID=${HUB_ID},T=CMD,N=${S.n.cmdN},DST=${NODE_ID},${parts}`,true);
  setTimeout(()=>{const ack=handleCommand(S,fields);hooks.tx('N2H',ack,true,'ACK');
    if(fields.CAL)hooks.tx('N2H',`AM1,ID=${NODE_ID},T=CAL,N=${S.n.seq},DOCAL=3,DOZERO=1,DOVSAT=1600.0,PHCAL=3,PHSLOPE=-177.3,PH7V=1500.0,SAL=${S.env.sal.toFixed(1)},DUE=11,CALOK=1`,true,'CAL');
    if(fields.STATUS)sendPond(S,'status');
    hooks.event(`ACK ${label}${S.n.holdText?' ('+S.n.holdText+')':''}`,'ok')},700);
}
document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>hubCmd({AER:b.dataset.cmd},'AER='+b.dataset.cmd));
$('cSet').onclick=()=>hubCmd({LO:+$('cLo').value,HI:+$('cHi').value},'thresholds');
$('cCal').onclick=()=>hubCmd({CAL:'?'},'CAL=?');$('cStat').onclick=()=>hubCmd({STATUS:'?'},'STATUS=?');

// inspector
let SEL=null;
function buildPlist(){const box=$('plist');for(const k in COMP){const b=document.createElement('button');b.textContent=COMP[k].n;b.dataset.k=k;b.onclick=()=>select(k,true);box.appendChild(b)}}
function liveVal(k){const n=S.n,R=n.R;switch(k){
  case 'doProbe':case 'doBoard':case 'isoDO':return `Now: ${R.doMv.toFixed(1)} mV → ${n.doInvalid?'invalid':R.doMgL.toFixed(2)+' mg/L'} · true bucket ${S.w.DO.toFixed(2)} mg/L`;
  case 'phProbe':case 'phBoard':case 'isoPH':return `Now: ${R.phMv.toFixed(1)} mV → pH ${R.ph.toFixed(2)} · true ${S.w.pH.toFixed(2)}`;
  case 'temp':return `Now: ${R.wtOk?R.wt.toFixed(2)+' °C':'−127 (failed)'}`;
  case 'ina':case 'pump':return `Now: ${n.pumpMa.toFixed(0)} mA · supply ${n.supplyV.toFixed(2)} V`;
  case 'relay':return `Relay ${n.pumpOn?'closed (GPIO32 LOW)':'open (GPIO32 HIGH)'}`;
  case 'esp32':return `${n.decision}${n.holdText?' · '+n.holdText:''}`;
  case 'stone':return S.faults.stoneClog?'Clogged: weak bubbles':S.pumpRunning?'Bubbling':'Idle';
  case 'button':return `Mode ${n.mode}`;
  case 'hub':return S.faults.hubDown?'Offline':`Online · ${S.hub.rx} packets · ${S.hub.alerts} alerts`;
  case 'lora':return `${n.seq} packets sent`;
 }return ''}
function select(k,fromUser){
  if(SEL&&COMPMESH[SEL])COMPMESH[SEL].forEach(m=>{if(m.material.emissive&&m.userData.em0!==undefined)m.material.emissive.setHex(m.userData.em0)});
  SEL=k;const c=COMP[k];if(!c)return;
  (COMPMESH[k]||[]).forEach(m=>{if(m.material.emissive&&m.userData.em0===undefined)m.userData.em0=m.material.emissive.getHex()});
  ANCH.forEach(a=>a.el.classList.toggle('sel',a.comp===k));
  document.querySelectorAll('#plist button').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  const pins=c.pins?`<div class="tbl"><table><thead><tr><th>Pin</th><th>Connects to</th></tr></thead><tbody>${c.pins.map(p=>`<tr><td class="m">${p[0]}</td><td>${p[1]}</td></tr>`).join('')}</tbody></table></div>`:'';
  $('card').innerHTML=`<h3>${c.n}</h3><div class="meta"><span class="pill info">${c.g}</span><span class="pill">${c.price}</span></div><p><b>Part:</b> ${c.part}</p><p>${c.role}</p>${pins}<p class="note" id="liveV" style="color:var(--accent)"></p>`;
  if(fromUser&&window.innerWidth<680)$('insp').scrollIntoView({behavior:'smooth',block:'start'});
}
const ray=new THREE.Raycaster(),mp=new THREE.Vector2();let downAt=null,btnPress=0;
canvas.addEventListener('pointerdown',e=>{downAt=[e.clientX,e.clientY]});
canvas.addEventListener('pointerup',e=>{if(!downAt)return;if(Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>5)return;
  const r=canvas.getBoundingClientRect();mp.x=(e.clientX-r.left)/r.width*2-1;mp.y=-(e.clientY-r.top)/r.height*2+1;ray.setFromCamera(mp,camera);
  const hit=ray.intersectObjects(PICK,false).find(h=>h.object.visible);if(!hit)return;const k=hit.object.userData.comp;
  if(k==='button'){pressShort(S);btnPress=performance.now()}select(k,false)});

// cameras
const CAMS={
 overview:{p:[.55,.75,1.25],t:[-.05,.1,0]},
 box:{p:[BX+.17,.29,BZ+.24],t:[BX,.04,BZ]},
 oled:{p:[BX-.04,.27,BZ+.13],t:[BX-.04,.08,BZ+.02]},
 probes:{p:[TX+.12,.15,TZ+.38],t:[TX,.12,TZ-.02]},
 pump:{p:[-.05,.3,.62],t:[-.25,.08,.15]},
 lora:{p:[1.0,1.0,1.4],t:[.75,.15,-.4]},
};
let camAnim=null;
function goCam(k){const c=CAMS[k];camAnim={p0:camera.position.clone(),t0:controls.target.clone(),p1:new THREE.Vector3(...c.p),t1:new THREE.Vector3(...c.t),u:0}}
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>goCam(b.dataset.cam));
let showLabels=true,showWires=true,explode=false,explodeU=0,sound=false;
$('tLabels').onclick=e=>{showLabels=!showLabels;e.currentTarget.classList.toggle('on',showLabels)};
$('tWires').onclick=e=>{showWires=!showWires;e.currentTarget.classList.toggle('on',showWires);WIRES.visible=showWires;$('wlegend').hidden=!showWires};
$('tExplode').onclick=e=>{explode=!explode;e.currentTarget.classList.toggle('on',explode)};
let actx=null;
$('tSound').onclick=e=>{sound=!sound;e.currentTarget.textContent=sound?'Sound on':'Sound off';e.currentTarget.classList.toggle('on',sound);
  if(sound&&!actx){try{actx=new (window.AudioContext||window.webkitAudioContext)()}catch(err){sound=false}}};
function beep(){if(!sound||!actx)return;try{const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=2600;g.gain.value=.05;o.connect(g).connect(actx.destination);o.start();o.stop(actx.currentTime+.18)}catch(e){}}
function setX(v){$('xray').value=v;XRAY.forEach(m=>m.opacity=v)}
$('xray').oninput=e=>XRAY.forEach(m=>m.opacity=+e.target.value);

// judge demo
const DEMO=[
 {cam:'overview',sel:'tank',t:'One board, one tank: the whole BHOOMI Pond Node',x:'The tank stands in for the pond and the 5 V air pump for the paddle-wheel aerator. One ESP32 measures, decides and reports. Nothing here needs the internet to keep fish alive.',do(){runScenario('normal');setSpeed(5)}},
 {cam:'box',sel:'esp32',t:'Inside the box',x:'ESP32, RFM95W LoRa radio, ADS1115 16-bit ADC, two signal isolators, DO and pH boards, INA219 current sensor, DS3231 clock and an opto relay. Everything runs from one USB power bank.',do(){setX(.1);explode=true;$('tExplode').classList.add('on')}},
 {cam:'box',sel:'ads',t:'The wiring, colour-coded',x:'Four I²C devices share two wires (blue SDA, yellow SCL). LoRa sits on SPI (green). The probe signals (orange) pass through isolators into the ADS1115, so the DO and pH probes cannot disturb each other through the water.',do(){explode=false;$('tExplode').classList.remove('on');if(!showWires)$('tWires').click()}},
 {cam:'probes',sel:'doProbe',t:'Three probes at the same depth',x:'Galvanic DO probe, industrial pH electrode and DS18B20 hang 15 cm deep. Temperature corrects both: DO saturation and the pH electrode slope change with temperature.',do(){}},
 {cam:'oled',sel:'oled',t:'What the farmer sees on the node',x:'DO in mg/L and % saturation, pH, temperature, pump state and current, mode, fault code and the time to the next sample. The 3D screen draws exactly what the firmware draws.',do(){}},
 {cam:'overview',sel:'pump',t:'Low DO: the pump starts by itself',x:'Heavy oxygen demand (yeast and sugar in the real test). DO drops through 4.0 mg/L → relay ON → bubbles. Above 6.0 it switches OFF, but only after its minimum ON time. Watch the chart and the packets.',do(){runScenario('lowdo');setSpeed(5)}},
 {cam:'pump',sel:'ina',t:'Pump failure is detected',x:'The relay is ON but the INA219 reads 0 mA. After 5 s (30 s on real timers) the node raises FLT 10, beeps and tells the hub, which sends an SMS.',do(){runScenario('pumpFail');setSpeed(5)}},
 {cam:'probes',sel:'stone',t:'Clogged air stone: pump runs, oxygen does not',x:'Current looks normal, so FLT 10 stays quiet. But DO keeps falling for the trend window (2 min demo, 30 min real) → FLT 11: check the air stone or aerator paddles.',do(){runScenario('clog');setSpeed(5)}},
 {cam:'overview',sel:'doProbe',t:'Probe unplugged at night: fail safe',x:'FLT 1. Without a valid DO reading at night the node runs the pump anyway, because a night without aeration is the main way ponds lose fish.',do(){runScenario('doNight');setSpeed(5)}},
 {cam:'lora',sel:'hub',t:'Internet down? Still safe.',x:'With the hub offline, packets are lost (red), but the pump rule runs on the node itself. When the hub returns, the next packet carries the current fault code.',do(){runScenario('hub');setSpeed(5)}},
 {cam:'overview',sel:'esp32',t:'From bench to pond',x:'Same firmware rules on real timers: 15 min samples by day, 5 min at night or below 5 mg/L, 20 min minimum ON. On the pond the relay drives the aerator contactor and the probes hang from a buoy. Accuracy claims come from our trial against a reference meter.',do(){runScenario('normal');setDemo(S,false);markTimers();setSpeed(300)}},
];
let demo=null;const DSTEP=13000;
function demoGo(i){if(i<0||i>=DEMO.length){demoExit();return}demo.i=i;demo.t=0;const s=DEMO[i];
  $('capStep').textContent=`Step ${i+1} / ${DEMO.length}`;$('capTitle').textContent=s.t;$('capText').textContent=s.x;
  if(i<DEMO.length-1&&!S.demo){setDemo(S,true);markTimers()}
  s.do&&s.do();goCam(s.cam);select(s.sel,false)}
function demoStart(){demo={i:0,t:0,paused:false};$('caption').hidden=false;$('demoBtn').textContent='■ Stop demo';demoGo(0);$('stage').scrollIntoView({behavior:'smooth',block:'start'})}
function demoExit(){demo=null;$('caption').hidden=true;$('demoBtn').textContent='▶ Play judge demo'}
$('demoBtn').onclick=()=>demo?demoExit():demoStart();
$('capNext').onclick=()=>demoGo(demo.i+1);$('capPrev').onclick=()=>demoGo(Math.max(0,demo.i-1));$('capExit').onclick=demoExit;
$('capPause').onclick=()=>{demo.paused=!demo.paused;$('capPause').textContent=demo.paused?'Resume':'Pause'};

// panels
function chip(id,val,cls){const e=$(id);e.querySelector('b').textContent=val;e.classList.remove('crit','warn','ok');if(cls)e.classList.add(cls)}
function kv(id,rows){$(id).innerHTML=rows.map(r=>`<dt>${r[0]}</dt><dd${r[2]?` style="color:var(--${r[2]})"`:''}>${r[1]}</dd>`).join('')}
$('fltTbl').innerHTML=Object.entries(FAULT_TEXT).map(([k,v])=>`<tr><td class="m">${k}</td><td>${v}</td></tr>`).join('');
$('pinTbl').innerHTML='<thead><tr><th>ESP32 pin</th><th>Signal</th><th>Connects to</th></tr></thead><tbody>'+PINS.map(p=>`<tr><td class="m"><span class="sw" style="background:${p[3]}"></span>${p[0]}</td><td>${p[1]}</td><td>${p[2]}</td></tr>`).join('')+'</tbody>';
function updPanels(){
  const n=S.n,R=n.R,night=isNight(S.t);
  $('clk').textContent=clock(S.t).join(':');const dn=$('dn');dn.textContent=night?'Night':'Day';dn.className='pill '+(night?'info':'warn');
  if(n.haveSample){chip('hDO',n.doInvalid?'ERR':R.doMgL.toFixed(2),n.doInvalid?'crit':R.doMgL<4?'crit':R.doMgL<5?'warn':'ok');chip('hDOS',n.doInvalid?'–':R.doSat.toFixed(0)+' %');
    chip('hPH',R.ph.toFixed(2),n.faultMask&(bit(4)|bit(5))?'warn':'');chip('hWT',R.wtOk?R.wt.toFixed(1):'−127',R.wtOk?'':'crit')}
  chip('hPUMP',n.pumpOn?(S.pumpRunning?'ON':'ON ✕'):'OFF',n.pumpOn?(S.pumpRunning?'ok':'crit'):'');chip('hMA',n.pumpMa.toFixed(0));chip('hMODE',n.mode,n.mode==='AUTO'?'':'warn');
  const f=topFault(n.faultMask);chip('hFLT',String(f),f?'crit':'ok');
  const T=T_(S);
  kv('fw',[['Timers',S.demo?'DEMO':'REAL'],['Mode',n.mode],['Pump',n.pumpOn?'ON':'OFF',n.pumpOn?'ok':''],['Pump current',n.pumpMa.toFixed(0)+' mA'],['Supply',n.supplyV.toFixed(2)+' V'],
    ['Decision',n.decision],['Timer',n.holdText||'free'],['Next sample',fmtSec(n.nextSample-S.t)],['Sample every',fmtSec(nextInterval(S))],
    ['ON < / OFF >',`${n.lo.toFixed(1)} / ${n.hi.toFixed(1)} mg/L`],['Min ON / OFF',`${fmtSec(T.minOn)} / ${fmtSec(T.minOff)}`],
    ['Fault mask','0x'+n.faultMask.toString(16).toUpperCase(),n.faultMask?'crit':'ok'],['Alarm',alarmActive(S)?(S.t<n.muteUntil?'muted':'BEEPING'):'quiet',alarmActive(S)&&S.t>=n.muteUntil?'crit':'']]);
  const rp=n.resp;
  kv('judge',[['DO < ON seen → relay',rp?fmtSec(rp.on-rp.low):'—'],['Relay → current seen',rp&&rp.cur?fmtSec(rp.cur-rp.on):'—'],['Packets to hub',`${S.hub.rx} delivered · ${S.hub.lost} lost`],
    ['Alerts (SMS)',S.hub.alerts],['LoRa RSSI at hub','≈ −78 dBm (bench, 2 m)'],['True bucket DO',S.w.DO.toFixed(2)+' mg/L'],['100 % saturation',S.w.sat.toFixed(2)+' mg/L']]);
  const hp=$('hubPill');hp.textContent=S.faults.hubDown?'Gateway offline':'Gateway online';hp.className='pill '+(S.faults.hubDown?'crit':'ok');
  document.querySelectorAll('[data-cmd],#cSet,#cCal,#cStat').forEach(b=>b.disabled=S.faults.hubDown);
  if(SEL){const lv=$('liveV');if(lv)lv.textContent=liveVal(SEL)}
  $('sHour').value=hourOf(S.t);$('oHour').textContent=clock(S.t).slice(0,2).join(':');
}
const chart=$('chart'),cx=chart.getContext('2d');
function drawChart(){
  const dpr=Math.min(devicePixelRatio||1,2),w=chart.clientWidth,h=chart.clientHeight;if(!w)return;
  if(chart.width!==Math.round(w*dpr)||chart.height!==Math.round(h*dpr)){chart.width=Math.round(w*dpr);chart.height=Math.round(h*dpr)}
  cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,w,h);
  const L=30,Rr=30,T=8,B=20,pw=w-L-Rr,ph=h-T-B;const win=S.demo?600:86400,t1=S.t,t0=t1-win;
  const X=t=>L+(t-t0)/win*pw,Y=v=>T+ph-(v/10)*ph,Yp=v=>T+ph-((v-6)/3)*ph;
  cx.font='10px "IBM Plex Mono", monospace';cx.strokeStyle=C.line;cx.fillStyle=C.mute;cx.lineWidth=1;
  for(let v=0;v<=10;v+=2){cx.beginPath();cx.moveTo(L,Math.round(Y(v))+.5);cx.lineTo(L+pw,Math.round(Y(v))+.5);cx.stroke();cx.fillText(v,8,Y(v)+3)}
  for(let v=6;v<=9;v++)cx.fillText(v,L+pw+8,Yp(v)+3);
  const H=S.chart;
  for(let i=1;i<H.length;i++){if(!H[i].pump)continue;cx.fillStyle=H[i].pump===1?'rgba(98,208,147,.18)':'rgba(242,103,93,.25)';cx.fillRect(X(H[i-1].t),T,Math.max(1,X(H[i].t)-X(H[i-1].t)),ph)}
  cx.setLineDash([5,4]);for(const [v,c,lab] of[[S.n.lo,C.crit,'ON <'],[S.n.hi,C.ok,'OFF >']]){cx.strokeStyle=c;cx.beginPath();cx.moveTo(L,Y(v));cx.lineTo(L+pw,Y(v));cx.stroke();cx.fillStyle=c;cx.fillText(`${lab} ${v.toFixed(1)}`,L+4,Y(v)-4)}
  cx.setLineDash([2,3]);line(p=>p.sat,Y,C.mute,1);cx.setLineDash([]);line(p=>p.pH,Yp,C.amber,1.4);line(p=>p.DO,Y,C.accent,2.2);
  if(H.length){const p=H[H.length-1];cx.fillStyle=C.accent;cx.beginPath();cx.arc(X(p.t),Y(p.DO),3.5,0,7);cx.fill()}
  cx.fillStyle=C.mute;const ticks=S.demo?[0,2,4,6,8,10]:[0,6,12,18,24];
  ticks.forEach((k,i)=>{const tt=t0+(S.demo?k*60:k*3600);const lab=i===ticks.length-1?'now':(S.demo?`−${10-k} min`:clock(tt).slice(0,2).join(':'));cx.fillText(lab,Math.min(Math.max(L,X(tt)-14),w-34),h-5)});
  function line(f,Yf,col,lw){if(H.length<2)return;cx.strokeStyle=col;cx.lineWidth=lw;cx.beginPath();H.forEach((p,i)=>{const x=X(p.t),y=Yf(f(p));i?cx.lineTo(x,y):cx.moveTo(x,y)});cx.stroke()}
}

// loop
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
new ResizeObserver(resize).observe(stage);resize();
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const wHigh=new THREE.Color(0x4fb0a6),wLow=new THREE.Color(0x6d7a52),tmpC=new THREE.Color();
let last=performance.now(),panelT=0,elapsed=0,lastBeep=0;
function loop(now){
  const dt=Math.min(.1,(now-last)/1000);last=now;elapsed+=dt;
  if(!LIVE.on&&S.running&&!(demo&&demo.paused))advance(S,dt*S.speed);
  if(demo&&!demo.paused){demo.t+=dt*1000;$('capBar').style.width=Math.min(100,demo.t/DSTEP*100)+'%';if(demo.t>DSTEP)demoGo(demo.i+1)}
  const n=S.n;
  // lighting: night dims the room
  const night=isNight(S.t);lamp.intensity=night?1.0:1.3;scene.background.setHex(night?0x070c10:0x0e1a1d);scene.fog.color.copy(scene.background);
  // water
  tmpC.copy(wLow).lerp(wHigh,Math.min(1,Math.max(0,(S.w.DO-2)/6)));waterMat.color.copy(tmpC);
  const pa=surfGeo.attributes.position.array,amp=reduced?0:(S.pumpRunning?.0025:.0006);
  for(let i=0;i<pa.length;i+=3){const x=surfBase[i],z=surfBase[i+2];const d=Math.hypot(x-.08,z-.06);pa[i+1]=Math.sin(d*90-elapsed*9)*amp*Math.max(0,1-d*5)+Math.sin(x*40+elapsed*2)*.0004}
  surfGeo.attributes.position.needsUpdate=true;
  // bubbles
  const rate=S.pumpRunning?(S.faults.stoneClog?.04:.5):0;
  for(let i=0;i<NB;i++){if(bPos[i*3+1]<0){if(Math.random()<rate*dt*12)bubbleSpawn(i);continue}
    bPos[i*3+1]+=bVel[i]*dt*(S.faults.stoneClog?1.6:1);bPos[i*3]+=Math.sin(elapsed*6+i)*.0004;if(bPos[i*3+1]>WH+.004)bPos[i*3+1]=-1}
  bGeo.attributes.position.needsUpdate=true;bubbles.material.size=S.faults.stoneClog?.011:.006;
  // pump vibration
  pumpG.position.y=S.pumpRunning&&!reduced?Math.sin(elapsed*90)*.0007:0;
  // fish
  const gasp=S.w.DO<2.5;
  fish.forEach((f,i)=>{const u=f.userData;u.ph+=dt;u.a+=dt*(gasp?.3:.5);const rx=.13,rz=.08;
    f.position.set(Math.cos(u.a+i*2)*rx*.9,(gasp?WH-.01:u.y)+Math.sin(u.ph)*.006,Math.sin(u.a+i*2)*rz*.8);f.rotation.y=-(u.a+i*2)-Math.PI/2;f.rotation.z=gasp?.4:0;
    u.tail.rotation.y=Math.sin(u.ph*(gasp?4:12))*.5});
  // box internals explode
  explodeU+=((explode?1:0)-explodeU)*Math.min(1,dt*4);
  INT.forEach(o=>o.position.copy(o.userData.base).addScaledVector(o.userData.ex,explodeU));
  if(showWires)buildWires();
  // indicators (mirror updateIndicators)
  const ms=S.t*1000;
  ledG.material.emissiveIntensity=n.pumpOn?2:(Math.floor(elapsed*2)%2?1.6:.1);
  ledR.material.emissiveIntensity=n.faultMask?2:0;
  const alarm=alarmActive(S)&&S.t>=n.muteUntil;const ph=(elapsed%1.2);
  buzzRing.material.opacity=alarm&&ph<.6?(.8-ph):0;buzzRing.scale.setScalar(alarm?.006+ph*.05:.001);
  if(alarm&&elapsed-lastBeep>1.2){lastBeep=elapsed;beep()}
  btn.position.y=performance.now()-btnPress<200?.004:.007;
  hubLed.material.emissiveIntensity=S.faults.hubDown?0:1.2;hubLed.material.emissive.setHex(S.faults.hubDown?0xff3322:0x22ff66);
  pbLeds.forEach((l,i)=>l.material.emissiveIntensity=(S.faults.supplyLow?i<1:i<4)?1.4:0);
  updPackets(dt);
  if(camAnim){camAnim.u=Math.min(1,camAnim.u+dt/1.3);const e=camAnim.u<.5?2*camAnim.u*camAnim.u:1-Math.pow(-2*camAnim.u+2,2)/2;
    camera.position.lerpVectors(camAnim.p0,camAnim.p1,e);controls.target.lerpVectors(camAnim.t0,camAnim.t1,e);if(camAnim.u>=1)camAnim=null}
  controls.update();
  if(SEL&&COMPMESH[SEL]){const k=(Math.sin(now/220)+1)/2;COMPMESH[SEL].forEach(m=>{if(m.material.emissive&&!['leds'].includes(SEL))m.material.emissive.setRGB(.08+.2*k,.35+.35*k,.45+.4*k)})}
  renderer.render(scene,camera);
  const w=stage.clientWidth,hh=stage.clientHeight,v=new THREE.Vector3();
  ANCH.forEach(a=>{a.o.getWorldPosition(v);const d=camera.position.distanceTo(v);v.project(camera);
    const vis=showLabels&&v.z<1&&d<a.maxDist&&Math.abs(v.x)<1.05&&Math.abs(v.y)<1.05;a.el.hidden=!vis;
    if(vis){a.el.style.left=((v.x+1)/2*w)+'px';a.el.style.top=((1-v.y)/2*hh-8)+'px'}});
  panelT+=dt;if(panelT>.2){panelT=0;updPanels();drawChart();drawOled()}
  requestAnimationFrame(loop);
}
buildScn();buildPlist();runScenario('normal');markTimers();select('esp32',false);setX(.16);
camera.position.set(...CAMS.overview.p);controls.target.set(...CAMS.overview.t);
requestAnimationFrame(loop);

window.__twin={S,LIVE,get scenario(){return curScn}};   // for tests and the browser console
