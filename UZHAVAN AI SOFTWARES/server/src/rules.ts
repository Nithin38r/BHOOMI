/**
 * Farm rules: turn the latest readings into alerts and automatic actions.
 * Pure functions (no database, no clock) so they are easy to test and to port to the gateway firmware.
 *
 * Safety cut-offs (dry run, phase failure, max runtime, aerator failsafe) do NOT live here:
 * they run inside the pump switch / pond controller firmware and work even with no internet.
 */
import { FIELD_INFO } from "../../shared/am1.ts";
import type { AlertCode, Command, Device, Params, Settings, Severity, Spray, Weather } from "../../shared/api.ts";

export interface Candidate {
  key: string;
  code: AlertCode;
  severity: Severity;
  deviceId: string | null;
  params: Params;
  /** Send an SMS when this alert first opens. */
  sms?: boolean;
}

export interface Action { deviceId: string; cmd: string; val: string; reason: string }

export interface RuleInput {
  now: number;
  devices: Device[];
  weather: Weather;
  settings: Settings;
  sprays: Spray[];
  commands: Command[];
}

/** Fault codes sent as FLT= by the pond firmware (BhoomiPondNode v2.0, PondBuoy / PondBank). */
export const POND_FAULT_TEXT: Record<number, string> = {
  1: "DO probe: no signal (cable cut or unplugged)", 2: "DO reading implausible", 3: "DO reading frozen",
  4: "pH out of range or probe unplugged", 5: "pH not responding (clean the electrode)", 6: "Water temperature sensor failed (28 °C assumed)",
  7: "Supply voltage low", 10: "Aerator ON but it draws no current", 11: "Aerator ON but oxygen is still falling",
  20: "Buoy silent for 35 min (bank runs the night failsafe)", 21: "Buoy gets no reply from the bank controller",
};
/** Pond faults serious enough to text the farmer. */
const POND_FAULT_SMS = new Set([11, 20, 21]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r1 = (v: number) => Math.round(v * 10) / 10;
const names = (ds: Device[], key: string) => ds.map(d => `${d.name} ${Math.round(num(d.latest[key]) ?? 0)} %`).join(", ");

export function evaluate(inp: RuleInput): { alerts: Candidate[]; actions: Action[] } {
  const { now, devices, weather, settings: s } = inp;
  const out: Candidate[] = [];
  const add = (c: Candidate) => out.push(c);
  const fresh = devices.filter(d => d.online);

  /* --- devices that went quiet */
  for (const d of devices.filter(d => !d.online)) {
    add({ key: `off:${d.id}`, code: "NODE_OFFLINE", severity: d.type === "POND" ? "crit" : "warn", deviceId: d.id,
      params: { name: d.name, min: Math.round((now - d.lastSeen) / 60_000) }, sms: d.type === "POND" || d.type === "PUMP" });
  }

  /* --- soil nodes */
  const soil = fresh.filter(d => d.type === "SOIL");
  const waterlogged: Device[] = [];
  for (const d of soil) {
    const L = d.latest;
    for (const k of ["M1", "M2", "ST", "AT", "AH"]) {
      if (k in L && L[k] === null) add({ key: `na:${d.id}:${k}`, code: "SENSOR_NA", severity: "warn", deviceId: d.id, params: { name: d.name, sensor: FIELD_INFO[k].label } });
    }
    const bv = num(L.BV);
    if (bv != null && bv < 3.4) add({ key: `bat:${d.id}`, code: "BATTERY_LOW", severity: "warn", deviceId: d.id, params: { name: d.name, v: bv.toFixed(2) } });
    const m1 = num(L.M1), m2 = num(L.M2);
    if (m1 != null && m2 != null && m1 >= 95 && m2 >= 90) {
      waterlogged.push(d);
      add({ key: `wl:${d.id}`, code: "WATERLOGGING", severity: "crit", deviceId: d.id, params: { name: d.name }, sms: true });
    }
  }
  const lowN = soil.filter(d => (num(d.latest.NI) ?? 100) < 30);
  if (lowN.length) add({ key: "lowN", code: "NITROGEN_LOW", severity: "warn", deviceId: null, params: { names: lowN.map(d => `${d.name} ${Math.round(num(d.latest.NI)!)}`).join(", ") } });
  const salty = soil.filter(d => (num(d.latest.EC) ?? 0) > 2.3);
  if (salty.length) add({ key: "salt", code: "SALT_HIGH", severity: "warn", deviceId: null, params: { names: salty.map(d => d.name).join(", ") } });

  /* --- irrigation */
  const pump = fresh.find(d => d.type === "PUMP") ?? null;
  const pumpRunning = pump ? num(pump.latest.RUN) === 1 : false;
  const raining = (weather.rainNowMm ?? 0) > 0.2;
  const rainSoon = (weather.rainProb12h ?? 0) >= s.rainSkipProb;
  const dry = soil.filter(d => { const m1 = num(d.latest.M1); return m1 != null && m1 < s.dryBelow && !waterlogged.includes(d); });
  const m2s = soil.map(d => num(d.latest.M2)).filter((x): x is number => x != null);
  const meanM2 = m2s.length ? m2s.reduce((a, b) => a + b, 0) / m2s.length : 0;

  if (pumpRunning) add({ key: "irrigating", code: "IRRIGATING", severity: "info", deviceId: pump!.id, params: { full: s.fullAt } });
  else if (dry.length) {
    if (raining || rainSoon) add({ key: "skipRain", code: "IRRIGATION_SKIPPED_RAIN", severity: "info", deviceId: null, params: { names: names(dry, "M1"), prob: Math.round(weather.rainProb12h ?? 100) } });
    else add({ key: "dry", code: "IRRIGATE_NOW", severity: "warn", deviceId: null, params: { names: names(dry, "M1") } });
  }

  const actions: Action[] = [];
  const tripped = pump ? num(pump.latest.TRIP) === 1 : false;
  if (s.autoIrrigate && pump && !tripped) {
    if (!pumpRunning && dry.length && !raining && !rainSoon && !waterlogged.length) {
      actions.push({ deviceId: pump.id, cmd: "PUMP", val: "ON", reason: `topsoil dry: ${names(dry, "M1")}` });
    } else if (pumpRunning) {
      const why = waterlogged.length ? "waterlogging" : raining ? "rain on the farm" : meanM2 >= s.fullAt ? `root zone full (30 cm average ${Math.round(meanM2)} %)` : "";
      if (why) actions.push({ deviceId: pump.id, cmd: "PUMP", val: "OFF", reason: why });
    }
  }

  /* --- air: heat, cold, fungal disease */
  const ats = soil.map(d => num(d.latest.AT)).filter((x): x is number => x != null);
  if (ats.length) {
    const at = ats.reduce((a, b) => a + b, 0) / ats.length;
    if (at >= 38) add({ key: "heat", code: "HEAT_STRESS", severity: "crit", deviceId: null, params: { t: r1(at) } });
    if (at <= 10) add({ key: "cold", code: "COLD_STRESS", severity: "warn", deviceId: null, params: { t: r1(at) } });
  }
  const humid = soil.filter(d => {
    const ah = num(d.latest.AH), at = num(d.latest.AT), lw = num(d.latest.LW);
    return at != null && at >= 18 && at <= 30 && ((ah != null && ah >= 90) || (lw != null && lw >= 80));
  });
  if (humid.length) {
    const worst = humid.reduce((a, b) => (num(b.latest.AH) ?? 0) > (num(a.latest.AH) ?? 0) ? b : a);
    add({ key: "fungal", code: "FUNGAL_RISK", severity: "warn", deviceId: null, params: { h: Math.round(num(worst.latest.AH) ?? 0), t: r1(num(worst.latest.AT) ?? 0) } });
  }

  /* --- pump switch and tank */
  if (pump && tripped) add({ key: `trip:${pump.id}`, code: "PUMP_TRIP", severity: "crit", deviceId: pump.id, params: { reason: String(pump.latest.TR ?? "") }, sms: true });
  if (pump && pumpRunning) add({ key: `run:${pump.id}`, code: "PUMP_RUNNING", severity: "info", deviceId: pump.id, params: { i: r1(num(pump.latest.I) ?? 0), rt: Math.round(num(pump.latest.RT) ?? 0) } });
  for (const t of fresh.filter(d => d.type === "TANK")) {
    const lv = num(t.latest.LV);
    if (lv != null && lv < 15) add({ key: `tank:${t.id}`, code: "TANK_LOW", severity: "warn", deviceId: t.id, params: { lv: Math.round(lv) } });
  }

  /* --- pond */
  for (const p of fresh.filter(d => d.type === "POND")) {
    // FLT 1-3: the DO value is not trustworthy (e.g. DO=0 when unplugged); FLT 4-5: same for pH.
    const L = p.latest, flt = num(L.FLT) ?? 0;
    const dO = flt >= 1 && flt <= 3 ? null : num(L.DO), ph = flt === 4 || flt === 5 ? null : num(L.PH);
    if (dO != null && dO < 3) add({ key: `do:${p.id}`, code: "DO_CRIT", severity: "crit", deviceId: p.id, params: { do: r1(dO) }, sms: true });
    else if (dO != null && dO < s.doLow) add({ key: `do:${p.id}`, code: "DO_LOW", severity: "warn", deviceId: p.id, params: { do: r1(dO), lim: s.doLow } });
    // The firmware decides "no current" itself (FLT 10: < 50 mA on the tank's 5 V air pump, < 0.5 A on the mains aerator).
    // A cloud-side current threshold would be wrong for one of the two, so the hub trusts the code.
    const aeri = num(L.AERI);
    if (flt === 10) add({ key: `aer:${p.id}`, code: "AERATOR_FAULT", severity: "crit", deviceId: p.id, params: { a: Math.round((aeri ?? 0) * 100) / 100 }, sms: true });
    if (ph != null && (ph < 6.5 || ph > 8.5)) add({ key: `ph:${p.id}`, code: "PH_OUT", severity: "warn", deviceId: p.id, params: { ph: r1(ph) } });
    if (flt && flt !== 10) add({ key: `flt:${p.id}`, code: "POND_FAULT", severity: POND_FAULT_SMS.has(flt) ? "crit" : "warn", deviceId: p.id,
      params: { flt, text: POND_FAULT_TEXT[flt] ?? "Unknown fault" }, sms: POND_FAULT_SMS.has(flt) });
  }

  /* --- trap camera and cold room */
  for (const t of fresh.filter(d => d.type === "TRAP")) {
    const wf = num(t.latest.WF) ?? 0, ap = num(t.latest.AP) ?? 0;
    if (wf > 60 || ap > 60) add({ key: `pest:${t.id}`, code: "PEST_HIGH", severity: "warn", deviceId: t.id, params: { wf: Math.round(wf), ap: Math.round(ap) } });
  }
  for (const c of fresh.filter(d => d.type === "COLD")) {
    const tc = num(c.latest.TC);
    if (tc != null && tc > 8) add({ key: `cold:${c.id}`, code: "COLD_ROOM_WARM", severity: tc > 12 ? "crit" : "warn", deviceId: c.id, params: { t: r1(tc) }, sms: tc > 12 });
  }

  /* --- spray log: safe-harvest timer */
  for (const sp of inp.sprays) {
    if (sp.safeAt > now) add({ key: `spray:${sp.id}`, code: "DO_NOT_HARVEST", severity: "warn", deviceId: null, params: { product: sp.product, leftMin: Math.ceil((sp.safeAt - now) / 60_000) } });
  }

  /* --- commands the device never confirmed */
  for (const c of inp.commands.filter(c => c.status === "failed" && now - c.updatedAt < 30 * 60_000)) {
    const d = devices.find(x => x.id === c.deviceId);
    add({ key: `cmd:${c.id}`, code: "COMMAND_FAILED", severity: "warn", deviceId: c.deviceId, params: { cmd: c.cmd, val: c.val, name: d?.name ?? c.deviceId } });
  }

  return { alerts: out, actions };
}

/**
 * Safe-harvest model. We do not measure pesticide in the soil: we estimate its breakdown from the label's
 * half-life, corrected for live soil temperature (Q10 = 2 around 25 °C) and slower breakdown in dry soil.
 * 3.32 half-lives ≈ 90 % broken down. The timer is never shorter than the label's pre-harvest interval (PHI).
 */
export function safeHarvest(sprayedAt: number, phiDays: number, halfLifeDays: number, soilTempC: number, topsoilMoisture: number) {
  const hl = halfLifeDays * Math.pow(2, (25 - soilTempC) / 10) * (topsoilMoisture < 25 ? 1.3 : 1);
  const modelDays = hl * 3.32;
  const days = Math.max(phiDays, modelDays);
  return { modelDays: Math.round(modelDays * 10) / 10, safeAt: sprayedAt + days * 86_400_000 };
}

export function soilMeans(devices: Device[]): { t: number; m: number } {
  const soil = devices.filter(d => d.type === "SOIL" && d.online);
  const st = soil.map(d => num(d.latest.ST)).filter((x): x is number => x != null);
  const m1 = soil.map(d => num(d.latest.M1)).filter((x): x is number => x != null);
  const avg = (a: number[], def: number) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : def);
  return { t: avg(st, 25), m: avg(m1, 50) };
}
