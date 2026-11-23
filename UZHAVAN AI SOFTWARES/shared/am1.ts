/**
 * AM1 packet format: the single wire format shared by every BHOOMI device and its firmware.
 *
 *   AM1,ID=7C9E1A,T=SOIL,N=42,M1=41.5,M2=60.2,ST=28.1,AT=31.0,AH=62.0,BV=3.98
 *
 * - Starts with the literal "AM1" (format version 1).
 * - ID  : device ID, 4-12 letters/digits, e.g. the last 6 hex digits of the ESP32 MAC.
 * - T   : device / packet type (SOIL, POND, PUMP, TANK, TRAP, COLD, plus CMD, ACK and CAL).
 * - N   : sequence number (lets the hub spot lost packets).
 * - Every other field is KEY=VALUE. "NA" means the sensor is unplugged or broken.
 *
 * Because each packet names its own ID and type, a new device joins the
 * registry from its first packet: "add a device, not a redesign".
 */

export type FieldValue = number | string | null;

export interface Am1Packet {
  id: string;
  type: string;
  seq: number | null;
  fields: Record<string, FieldValue>;
  raw: string;
}

export class Am1Error extends Error {}

/** Keys whose values must stay as text even when they look numeric (e.g. VLV=010). */
const STRING_KEYS = new Set(["VLV", "PHASE", "TR", "CMD", "MODE", "ERR", "DST", "FWD", "VIA", "QUEUED", "GW"]);
const NUMERIC = /^-?\d+(\.\d+)?$/;
const ID_RE = /^[0-9A-Z]{4,12}$/;
const KEY_RE = /^[A-Z][A-Z0-9_]{0,15}$/;

export function parseAm1(input: string): Am1Packet {
  const raw = input.trim();
  if (!raw) throw new Am1Error("empty packet");
  if (raw.length > 512) throw new Am1Error("packet longer than 512 characters");
  const parts = raw.split(",");
  if (parts[0] !== "AM1") throw new Am1Error(`packet must start with AM1, got "${parts[0].slice(0, 12)}"`);

  const fields: Record<string, FieldValue> = {};
  let id = "";
  let type = "";
  let seq: number | null = null;

  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) throw new Am1Error(`field "${part.slice(0, 20)}" is not KEY=VALUE`);
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim();
    if (!KEY_RE.test(key)) throw new Am1Error(`bad field name "${key}"`);

    if (key === "ID") { id = value.toUpperCase(); continue; }
    if (key === "T") { type = value.toUpperCase(); continue; }
    if (key === "N") {
      if (!/^\d+$/.test(value)) throw new Am1Error(`N must be a whole number, got "${value}"`);
      seq = Number(value);
      continue;
    }
    if (key === "NPK") {
      // NPK=55-48-61 → three indicative index values; NPK=NA while the RS485 probe is not fitted
      const m = /^(\d+)-(\d+)-(\d+)$/.exec(value);
      if (m) { fields.NPK = value; fields.NI = Number(m[1]); fields.PI = Number(m[2]); fields.KI = Number(m[3]); }
      else fields.NPK = null;
      continue;
    }
    fields[key] = parseValue(key, value);
  }

  if (!ID_RE.test(id)) throw new Am1Error(`ID must be 4-12 letters/digits, got "${id}"`);
  if (!type) throw new Am1Error("missing T (device type)");
  return { id, type, seq, fields, raw };
}

function parseValue(key: string, value: string): FieldValue {
  if (value === "" || value.toUpperCase() === "NA") return null;
  if (!STRING_KEYS.has(key) && NUMERIC.test(value)) return Number(value);
  return value;
}

export function encodeAm1(id: string, type: string, seq: number | null, fields: Record<string, FieldValue | boolean | undefined>): string {
  const out = ["AM1", `ID=${id}`, `T=${type}`];
  if (seq != null) out.push(`N=${seq}`);
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const s = v === null ? "NA" : typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    if (s.includes(",") || s.includes("=")) throw new Am1Error(`value for ${k} may not contain "," or "="`);
    out.push(`${k}=${s}`);
  }
  return out.join(",");
}

/** Human labels and units for every known field, used by the dashboard. */
export const FIELD_INFO: Record<string, { label: string; unit: string; dec: number }> = {
  M1: { label: "Moisture 15 cm", unit: "%", dec: 0 },
  M2: { label: "Moisture 30 cm", unit: "%", dec: 0 },
  ST: { label: "Soil temperature", unit: "°C", dec: 1 },
  AT: { label: "Air temperature", unit: "°C", dec: 1 },
  AH: { label: "Air humidity", unit: "%", dec: 0 },
  LW: { label: "Leaf / rain wetness", unit: "%", dec: 0 },
  LX: { label: "Light level", unit: "%", dec: 0 },
  EC: { label: "Soil EC", unit: "dS/m", dec: 2 },
  PH: { label: "pH", unit: "", dec: 1 },
  NI: { label: "Nitrogen index", unit: "", dec: 0 },
  PI: { label: "Phosphorus index", unit: "", dec: 0 },
  KI: { label: "Potassium index", unit: "", dec: 0 },
  BV: { label: "Battery", unit: "V", dec: 2 },
  DO: { label: "Dissolved oxygen", unit: "mg/L", dec: 1 },
  DOS: { label: "DO saturation", unit: "%", dec: 0 },
  WT: { label: "Water temperature", unit: "°C", dec: 1 },
  AER: { label: "Aerator", unit: "", dec: 0 },
  AERI: { label: "Aerator current", unit: "A", dec: 1 },
  FLT: { label: "Fault code", unit: "", dec: 0 },
  RUN: { label: "Pump running", unit: "", dec: 0 },
  I: { label: "Motor current", unit: "A", dec: 1 },
  RT: { label: "Run time", unit: "min", dec: 0 },
  Q: { label: "Flow", unit: "L/min", dec: 0 },
  LV: { label: "Tank level", unit: "%", dec: 0 },
  P: { label: "Line pressure", unit: "bar", dec: 2 },
  LIT: { label: "Litres today", unit: "L", dec: 0 },
  WF: { label: "Whiteflies / day", unit: "", dec: 0 },
  AP: { label: "Aphids / day", unit: "", dec: 0 },
  TC: { label: "Cold-room temp", unit: "°C", dec: 1 },
  H: { label: "Cold-room humidity", unit: "%", dec: 0 },
  RSSI: { label: "Signal", unit: "dBm", dec: 0 },
  HOP: { label: "Mesh hops", unit: "", dec: 0 },
};

/** Soil-probe fields reserved for the RS485 probe. Always NA until it is fitted, so the app hides them instead of flagging a fault. */
export const RESERVED_FIELDS = new Set(["EC", "PH", "NPK", "NI", "PI", "KI"]);

/** How often each device type is expected to report, in minutes. Used for "not reporting" alerts. */
export const REPORT_EVERY_MIN: Record<string, number> = {
  SOIL: 15, POND: 15, PUMP: 15, TANK: 15, TRAP: 120, COLD: 15,
};
