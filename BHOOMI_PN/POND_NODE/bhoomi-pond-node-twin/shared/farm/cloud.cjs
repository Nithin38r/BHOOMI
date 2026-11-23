/*
 * Layer 3 of the AgriMesh framework: the CLOUD.
 * Same code in the backend (Live) and in the browser (Simulation).
 *
 *   - history of every pond reading (the backend also keeps every packet in data/packets.jsonl)
 *   - oxygen forecast: a straight-line fit to the last 2 hours of DO says when it will cross 4 mg/L
 *     (a measured trend, not a weather model) and pushes a warning once per episode
 *   - push notifications to the farmer's app, in English / Telugu / Tamil
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./i18n.cjs'), require('./gateway.cjs'));
  else root.BhoomiCloud = factory(root.BhoomiI18n, root.BhoomiGateway);
})(typeof self !== 'undefined' ? self : this, function (I18N, GW) {
  'use strict';
  const WINDOW_S = 2 * 3600, HORIZON_H = 6, ON_LEVEL = 4;

  function createCloud(opts) {
    const o = Object.assign({ historyPoints: 4000 }, opts || {});
    const hist = new Map();       // pond -> [{t, DO, PH, WT, AER}]
    const pushes = [];
    const episode = new Map();    // pond -> forecast already pushed
    let stored = 0, seq = 0;

    function receive(item) {
      if (item.kind === 'packet') {
        stored += 1;
        const r = item.rec;
        if (r.type === 'POND' && r.pond) {
          const f = r.fields, flt = f.FLT || 0;
          let h = hist.get(r.pond); if (!h) { h = []; hist.set(r.pond, h); }
          h.push({ t: r.t, DO: typeof f.DO === 'number' && !(flt >= 1 && flt <= 3) ? f.DO : null, PH: f.PH ?? null, WT: f.WT ?? null, AER: f.AER ?? null });
          if (h.length > o.historyPoints) h.shift();
        }
      } else if (item.kind === 'alert') {
        pushes.push(item.alert); if (pushes.length > 100) pushes.shift();
      }
    }

    /** Trend forecast for one pond at farm time t. */
    function forecast(pond, t) {
      const h = (hist.get(pond) || []).filter((x) => x.DO !== null && x.t > t - WINDOW_S && x.t <= t + 1);
      if (h.length < 4 || h[h.length - 1].t - h[0].t < 1800) return { risk: 'unknown', text: 'Not enough recent readings yet' };
      const n = h.length, mx = h.reduce((s, x) => s + x.t, 0) / n, my = h.reduce((s, x) => s + x.DO, 0) / n;
      let sxy = 0, sxx = 0; for (const x of h) { sxy += (x.t - mx) * (x.DO - my); sxx += (x.t - mx) ** 2; }
      const slopeH = sxx ? (sxy / sxx) * 3600 : 0;                 // mg/L per hour
      const last = h[n - 1].DO;
      const base = { slopeH: +slopeH.toFixed(2), last, points: n };
      if (last < ON_LEVEL) return Object.assign(base, { risk: 'now', text: `DO ${last.toFixed(1)} mg/L is already below ${ON_LEVEL}` });
      if (slopeH < -0.1) {
        const hours = (last - ON_LEVEL) / -slopeH;
        if (hours <= HORIZON_H) {
          const at = t + hours * 3600;
          return Object.assign(base, { risk: hours < 1.5 ? 'high' : 'medium', at, time: GW.hhmm(at), hours: +hours.toFixed(1),
            text: `Falling ${(-slopeH).toFixed(2)} mg/L per hour: below ${ON_LEVEL} at about ${GW.hhmm(at)}` });
        }
      }
      return Object.assign(base, { risk: 'low', text: slopeH < 0 ? `Falling slowly (${slopeH.toFixed(2)} mg/L per hour)` : `Steady or rising (${slopeH >= 0 ? '+' : ''}${slopeH.toFixed(2)} mg/L per hour)` });
    }

    /** Push a forecast warning once per falling episode. Returns the alert or null. */
    function checkForecast(pond, t) {
      const fc = forecast(pond, t);
      if (fc.risk === 'high' || fc.risk === 'medium') {
        if (episode.get(pond)) return null;
        episode.set(pond, true);
        const a = { n: 'c' + (++seq), t, time: GW.hhmm(t), pond, id: 'CLOUD', level: 'warn', code: 'FORECAST', vars: { time: fc.time }, text: I18N.textFor('FORECAST', pond, { time: fc.time }), channels: ['push'] };
        pushes.push(a); if (pushes.length > 100) pushes.shift();
        return a;
      }
      if (fc.risk === 'low' && fc.last > 5) episode.set(pond, false);
      return null;
    }

    function history(pond, sinceT) { return (hist.get(pond) || []).filter((x) => sinceT === undefined || x.t >= sinceT); }

    function summary(tFor) {
      const out = {};
      for (const k of hist.keys()) { const h = hist.get(k); const t = tFor ? tFor(k) : (h.length ? h[h.length - 1].t : 0); out[k] = { points: h.length, forecast: forecast(k, t) }; }
      return { stored, ponds: out, pushes: pushes.slice(-30) };
    }

    /** Forget a pond's history (a simulator jumped its clock). */
    function clear(pond) { hist.delete(pond); episode.delete(pond); }

    return { receive, forecast, checkForecast, history, summary, clear, get stored() { return stored; } };
  }
  return { createCloud };
});
