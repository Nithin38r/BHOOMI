// Hub rules (UZHAVAN AI, rule layer): turn the latest packets into a farm summary and alerts.
// Works only from what reached the hub, exactly like the hub ESP32 would.
import { CROPS, ZONES, zoneOfZ, verdict } from '../sources/farm.js';
import { SLOTS } from '../sources/simulator.js';

const SLOT_Z = Object.fromEntries(SLOTS.map((s) => [s.id, s.z]));
const LABEL = Object.fromEntries(SLOTS.map((s) => [s.id, s.label]));

/** minutes since a packet, in simulated time when the simulator made it, otherwise real time */
function ageMin(node, nowSim) {
  const sm = node.last?.rx?.simMinute;
  if (typeof sm === 'number' && typeof nowSim === 'number') return nowSim - sm;
  return (Date.now() - Date.parse(node.lastSeen)) / 60000;
}

export function hubSummary(store, { crop = 'rice', simMinute = null } = {}) {
  const c = CROPS[crop] || CROPS.rice;
  const nodes = [...store.nodes.values()];
  const soil = nodes.filter((n) => n.type === 'SOIL');
  const dev = (t) => nodes.find((n) => n.type === t);
  const alerts = [];
  const add = (level, title, detail) => alerts.push({ level, title, detail });

  // soil nodes and zones
  const zones = ZONES.map((name) => ({ name, nodes: [], meanM1: null }));
  for (const n of soil) {
    const f = n.last.fields, age = ageMin(n, simMinute);
    const interval = f.BV != null && f.BV < 3.40 ? 60 : 15;
    const label = LABEL[n.id] || n.id;
    if (age > 2 * interval + 5) { add('crit', `${label} not reporting`, `No packet for ${Math.round(age)} min. Check the node, its battery or its route.`); continue; }
    const z = zoneOfZ(SLOT_Z[n.id] ?? 0);
    zones[z].nodes.push(label);
    if (f.M1 != null) zones[z].meanM1 = zones[z].meanM1 == null ? [f.M1] : [...zones[z].meanM1, f.M1];
    const na = ['M1', 'ST', 'AT'].filter((k) => f[k] === null);
    if (na.length) add('warn', `${label}: sensor fault`, `${na.join(', ')} arrive as NA. The node keeps sending its other readings.`);
    if (f.BV != null && f.BV < 3.40) add('warn', `${label}: low battery`, `${f.BV.toFixed(2)} V. Reports slow to every 60 min.`);
    if (f.M1 != null && f.M1 > 88 && f.M2 != null && f.M2 > 80) add('warn', `${label}: waterlogged`, 'Both depths above 80 %. Stop irrigation and check drainage.');
    if (f.AT != null && f.AT > 38) add('warn', `${label}: heat stress`, `Air ${f.AT.toFixed(1)} °C. Irrigate early morning or evening.`);
  }
  for (const z of zones) {
    if (Array.isArray(z.meanM1)) z.meanM1 = Math.round(z.meanM1.reduce((a, b) => a + b, 0) / z.meanM1.length * 10) / 10;
    z.state = z.meanM1 == null ? 'unknown' : z.meanM1 < c.trig ? 'dry' : z.meanM1 >= c.full ? 'wet' : 'ok';
    if (z.state === 'dry') add('warn', `${z.name} zone dry`, `Mean moisture ${z.meanM1} % is below the ${c.name} trigger of ${c.trig} %. Irrigate.`);
  }

  // farm devices
  const pump = dev('PUMP'), tank = dev('TANK'), treat = dev('TREAT'), pond = dev('POND');
  if (pump) {
    const f = pump.last.fields;
    if (f.TRIP) add('crit', 'Pump tripped', f.PHASE === 'FAIL' ? 'Phase missing: check the supply.' : 'Dry run or overload: the pump switch locked itself.');
    else if (f.PHASE === 'FAIL') add('crit', 'Pump: phase missing', 'The pump switch will refuse to start.');
  }
  if (tank) { const f = tank.last.fields; if (f.LV != null && f.LV < 15) add('warn', 'Storage tank low', `${f.LV} % left.`); }
  let water = null;
  if (pond) {
    const f = pond.last.fields;
    water = verdict({ ph: f.PH, ec: f.EC, tu: f.TU }, crop);
    if (water.level !== 'ok') add(water.level === 'bad' ? 'crit' : 'warn', `Pond water: ${water.title}`, water.reasons.filter((r) => r[0] !== 'ok').map((r) => r[1]).join(' · '));
    if (f.DO != null && f.DO < 4) add('crit', 'Pond oxygen low', `DO ${f.DO} mg/L${f.AER ? ', aerator running' : ': start the aerator'}.`);
    else if (f.DO != null && f.DO < 5) add('warn', 'Pond oxygen falling', `DO ${f.DO} mg/L.`);
  }
  if (!alerts.length) add('ok', 'Whole farm normal', `${soil.length} soil node(s) reporting. No action needed.`);
  const order = { crit: 0, warn: 1, ok: 2 };
  alerts.sort((a, b) => order[a.level] - order[b.level]);

  return {
    crop, cropInfo: c, zones,
    devices: Object.fromEntries([pump, tank, treat, pond].filter(Boolean).map((n) => [n.type.toLowerCase(), { id: n.id, ...n.last.fields, lastSeen: n.lastSeen }])),
    water, alerts,
    heard: { soil: soil.length, devices: nodes.length - soil.length },
  };
}
