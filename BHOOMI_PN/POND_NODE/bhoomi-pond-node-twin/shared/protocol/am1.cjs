/*
 * AM1 packet format used by every BHOOMI / AgriMesh device: one line of text.
 *   AM1,ID=7C9E2A,T=POND,N=212,DO=5.84,DOS=76,PH=7.62,WT=28.6,AER=0,AERI=0.00,BV=5.04,FLT=0
 * Comma-separated KEY=VALUE pairs after the "AM1" tag, no spaces. "NA" = sensor missing or failed.
 * Loaded by the backend (require) and the browser (window.BhoomiAM1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BhoomiAM1 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Values that look like numbers become numbers, except these text fields.
  // (AER is a number in a POND packet, AER=1, and text in a command, AER=AUTO: both work.)
  const TEXT_KEYS = new Set(['ID', 'T', 'DST', 'MODE', 'ERR', 'CMD', 'QUEUED', 'FWD', 'ROLE', 'HAND']);

  const FIELD_INFO = {
    POND: {
      DO: ['Dissolved oxygen', 'mg/L'], DOS: ['DO saturation', '%'], PH: ['pH', ''], WT: ['Water temperature', '°C'],
      AER: ['Aerator on', '0/1'], AERI: ['Aerator current (field: motor A, tank: air pump A)', 'A'], BV: ['Battery / supply voltage', 'V'],
      FLT: ['Top fault code (0 = OK)', ''], U: ['Urgent packet, sent at once', '1'],
    },
    ACK: { OK: ['Command accepted', '0/1'], MODE: ['Aerator mode', 'AUTO/ON/OFF'], AER: ['Aerator on', '0/1'], AERI: ['Aerator current', 'A'],
      LO: ['Start below', 'mg/L'], HI: ['Stop above', 'mg/L'], HOLD: ['Waiting for a minimum ON/OFF time', '0/1'], QUEUED: ['Queued for the buoy', 'ID'] },
    CAL: { DOCAL: ['Last DO calibration', ''], PHCAL: ['Last pH calibration', ''], DUE: ['Calibration due in', ''], CALOK: ['Calibration valid', '0/1'] },
  };

  /** Parse one AM1 line. Text around it ("RX: ... RSSI -96") is ignored. Returns null if it is not a packet. */
  function parseAM1(line) {
    if (typeof line !== 'string') return null;
    const start = line.indexOf('AM1,');
    if (start < 0) return null;
    let raw = line.slice(start).trim();
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
    if (!id || !/^[0-9A-Z]{4,12}$/.test(id) || !type) return null;
    const n = typeof fields.N === 'number' ? fields.N : null;
    delete fields.ID; delete fields.T; delete fields.N;
    return { raw, type, id, n, fields };
  }

  /** Build an AM1 line. null / undefined / NaN become "NA". */
  function formatAM1(id, type, n, fields) {
    const out = ['AM1', 'ID=' + id, 'T=' + type];
    if (n !== null && n !== undefined) out.push('N=' + n);
    for (const [k, v] of Object.entries(fields || {})) {
      if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) out.push(k + '=NA');
      else out.push(k + '=' + v);
    }
    return out.join(',');
  }

  return { TEXT_KEYS, FIELD_INFO, parseAM1, formatAM1 };
});
