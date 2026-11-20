// AM1 packet format used by every BHOOMI / AgriMesh node.
//   AM1,ID=7C9E1A,T=SOIL,N=1038,M1=46.2,M2=57.1,ST=25.4,AT=29.1,AH=61.0,LW=0,LX=72.5,EC=NA,PH=NA,NPK=NA,BV=3.98,HOP=0
// Rules: comma-separated KEY=VALUE pairs after the "AM1" tag. "NA" means a sensor is missing or failed.

// Values that look like numbers become numbers, except these text fields
// (VLV="011" is a valve bit pattern, not the number 11).
export const TEXT_KEYS = new Set(['ID', 'T', 'VLV', 'NPK', 'STAGE', 'PHASE', 'DST', 'MODE', 'ERR', 'CMD', 'QUEUED', 'FWD', 'DOCAL', 'PHCAL', 'DUE']);

/** Field meaning, used by the API and the docs. */
export const FIELD_INFO = {
  SOIL: {
    M1: ['Soil moisture at 15 cm', '%'], M2: ['Soil moisture at 30 cm', '%'], ST: ['Soil temperature', '°C'],
    AT: ['Air temperature', '°C'], AH: ['Air humidity', '%'], LW: ['Leaf / rain wetness', '%'],
    LX: ['Light level', '%'], EC: ['Soil EC (reserved)', 'dS/m'], PH: ['Soil pH (reserved)', ''],
    NPK: ['NPK (reserved)', ''], BV: ['Battery voltage', 'V'], HOP: ['Mesh hops to the hub', ''],
  },
  POND: {
    DO: ['Dissolved oxygen', 'mg/L'], DOS: ['DO saturation', '%'], PH: ['pH', ''], WT: ['Water temperature', '°C'],
    AER: ['Aerator on', '0/1'], AERI: ['Aerator current', 'A'], BV: ['Supply / battery voltage', 'V'], FLT: ['Fault code', ''],
  },
};

/**
 * Parse one AM1 line. Text around the packet (for example "RX: ... RSSI -96") is ignored,
 * so lines printed by a hub's Serial port can be passed in as they are.
 * @returns {null | {raw:string,type:string,id:string,n:number|null,fields:Object}}
 */
export function parseAM1(line) {
  if (typeof line !== 'string') return null;
  const start = line.indexOf('AM1,');
  if (start < 0) return null;
  let raw = line.slice(start).trim();
  // stop at the first whitespace: the packet itself never contains spaces
  const sp = raw.search(/\s/);
  if (sp > 0) raw = raw.slice(0, sp);
  const parts = raw.split(',');
  if (parts.length < 3) return null;
  const fields = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim().toUpperCase();
    const v = p.slice(eq + 1).trim();
    if (!/^[A-Z0-9_]{1,8}$/.test(k)) continue;
    if (v === 'NA' || v === '') fields[k] = null;
    else if (!TEXT_KEYS.has(k) && /^-?\d+(\.\d+)?$/.test(v)) fields[k] = Number(v);
    else fields[k] = v;
  }
  const id = typeof fields.ID === 'string' ? fields.ID.toUpperCase() : null;
  const type = typeof fields.T === 'string' ? fields.T.toUpperCase() : null;
  if (!id || !/^[0-9A-Z]{4,12}$/.test(id) || !type) return null;   // usually 6 hex digits; farm devices use letters too
  const n = typeof fields.N === 'number' ? fields.N : null;
  delete fields.ID; delete fields.T; delete fields.N;
  return { raw, type, id, n, fields };
}

/** Build an AM1 line from parts. null/undefined/NaN values become "NA". */
export function formatAM1(id, type, n, fields = {}) {
  const out = ['AM1', `ID=${id}`, `T=${type}`];
  if (n !== null && n !== undefined) out.push(`N=${n}`);
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) out.push(`${k}=NA`);
    else out.push(`${k}=${v}`);
  }
  return out.join(',');
}
