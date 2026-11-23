/**
 * Time-series chart (SVG), built to the dataviz method:
 * one unit per chart (never two y-axes), 2px lines, 10% area wash, end dots with a 2px surface ring,
 * hairline solid grid, legend for 2+ series plus end labels, a crosshair tooltip on hover / touch / arrow keys,
 * and a table view so no value is reachable only by hovering. Gaps over 40 min are breaks: packets that never arrived.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export interface Series { label: string; color: string; points: [number, number | null][] }
export interface Zone { from: number; to: number; tone: "crit" | "warn" }
export interface Band { label: string; points: [number, boolean][] }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const GAP = 40 * 60_000;

export function Chart({ series, yMin, yMax, unit, decimals = 0, threshold, zones, band, height = 180, hours = 24, now, area }: {
  series: Series[]; yMin: number; yMax: number; unit: string; decimals?: number; height?: number; hours?: number; now: number;
  threshold?: { value: number; label: string }; zones?: Zone[]; band?: Band; area?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const bandH = band ? 14 : 0;
  const L = 38, R = 54, T = 24, B = 24 + bandH, pw = Math.max(40, w - L - R), ph = height - T - B;
  const t0 = now - hours * 3_600_000;
  const x = (t: number) => L + ((t - t0) / (now - t0)) * pw;
  const y = (v: number) => T + ph * (1 - (Math.min(yMax, Math.max(yMin, v)) - yMin) / (yMax - yMin));
  const ticks = [0, 1, 2, 3, 4].map(i => yMin + ((yMax - yMin) * i) / 4);
  const hourTicks = [0, 6, 12, 18, 24].filter(h => h <= hours).map(h => now - (hours - h) * 3_600_000);
  const fmt = (v: number | null) => (v == null ? "–" : `${v.toFixed(decimals)}${unit}`);

  const visible = useMemo(() => series.map(s => ({ ...s, points: s.points.filter(p => p[0] >= t0) })), [series, t0]);
  const times = visible[0]?.points.map(p => p[0]) ?? [];
  const valueAt = (s: Series, t: number) => {
    let best: [number, number | null] | null = null;
    for (const p of s.points) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    return best && Math.abs(best[0] - t) < GAP ? best[1] : null;
  };

  const paths = visible.map(s => {
    let line = "", fill = "", prevT = -Infinity, runStart: number | null = null, runEnd = 0;
    const closeRun = () => { if (runStart != null) fill += `L${x(runEnd).toFixed(1)},${y(yMin).toFixed(1)}L${x(runStart).toFixed(1)},${y(yMin).toFixed(1)}Z`; runStart = null; };
    for (const [t, v] of s.points) {
      if (v == null) { closeRun(); prevT = -Infinity; continue; }
      const brk = t - prevT > GAP;
      if (brk) closeRun();
      const pt = `${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      line += `${brk ? "M" : "L"}${pt}`;
      fill += `${brk ? "M" : "L"}${pt}`;
      if (brk) runStart = t;
      runEnd = t; prevT = t;
    }
    closeRun();
    const last = [...s.points].reverse().find(p => p[1] != null) ?? null;
    return { s, line, fill, last };
  });

  // End labels only when they don't collide; otherwise the legend and tooltip carry identity.
  const ends = paths.filter(p => p.last).map(p => ({ ...p, ly: y(p.last![1]!) }));
  const endLabels = ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a.ly - b.ly) > 15));

  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !times.length) return;
    const t = t0 + ((clientX - r.left - L) / pw) * (now - t0);
    let bi = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[bi] - t)) bi = i;
    setHover(bi);
  };
  const ht = hover != null ? times[hover] : null;

  return (
    <div className="chart-block">
      {series.length > 1 && (
        <div className="legend" aria-hidden="true">
          {series.map(s => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <div ref={ref} className="chart" tabIndex={0} role="img"
        aria-label={`${series.map(s => s.label).join(" and ")}, last ${hours} hours. Use left and right arrow keys to read values.`}
        onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={e => {
          if (!times.length) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setHover(h => Math.max(0, Math.min(times.length - 1, (h ?? times.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
          } else if (e.key === "Escape") setHover(null);
        }}>
        <svg width={w} height={height} aria-hidden="true">
          {zones?.map(z => (
            <rect key={z.tone + z.from} x={L} width={pw} y={y(z.to)} height={Math.max(0, y(z.from) - y(z.to))} className={`zone zone-${z.tone}`} />
          ))}
          {ticks.map(v => (
            <g key={v}>
              <line x1={L} x2={L + pw} y1={y(v)} y2={y(v)} className="grid" />
              <text x={L - 7} y={y(v) + 3.5} textAnchor="end" className="axis">{Math.round(v)}</text>
            </g>
          ))}
          <text x={L - 7} y={9} textAnchor="end" className="axis unit">{unit.trim()}</text>
          {hourTicks.map((t, i) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === hourTicks.length - 1 ? "end" : "middle"} className="axis">
              {i === hourTicks.length - 1 ? "now" : `−${Math.round((now - t) / 3_600_000)} h`}
            </text>
          ))}
          {threshold && (
            <g>
              <line x1={L} x2={L + pw} y1={y(threshold.value)} y2={y(threshold.value)} className="ref" />
              <text x={L + 4} y={y(threshold.value) - 5} className="axis ref-label">{threshold.label}</text>
            </g>
          )}
          {band && (
            <g>
              <rect x={L} y={T + ph + 6} width={pw} height={6} rx={3} className="band-track" />
              {band.points.map(([t, on], i) => {
                const next = band.points[i + 1]?.[0] ?? now;
                return on && t >= t0 ? <rect key={t} x={x(t)} y={T + ph + 6} width={Math.max(2, x(Math.min(next, t + GAP)) - x(t))} height={6} className="band-on" /> : null;
              })}
            </g>
          )}
          {paths.map(({ s, line, fill }) => (
            <g key={s.label}>
              {area && <path d={fill} fill={s.color} fillOpacity={0.1} stroke="none" />}
              <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {ends.map(({ s, last, ly }) => (
            <g key={s.label}>
              <circle cx={x(last![0])} cy={ly} r={4} fill={s.color} className="end-dot" />
              {endLabels && <text x={x(last![0]) + 9} y={ly + 4} className="end-label">{fmt(last![1])}</text>}
            </g>
          ))}
          {ht != null && (
            <g>
              <line x1={x(ht)} x2={x(ht)} y1={T} y2={T + ph} className="crosshair" />
              {visible.map(s => { const v = valueAt(s, ht); return v == null ? null : <circle key={s.label} cx={x(ht)} cy={y(v)} r={4.5} fill={s.color} className="end-dot" />; })}
            </g>
          )}
        </svg>
        {ht != null && (
          <div className="tip" style={{ left: Math.min(Math.max(x(ht) + 12, 0), w - 150) }}>
            <small>{hhmm(ht)}</small>
            {visible.map(s => (
              <span key={s.label}><i style={{ background: s.color }} /><b>{fmt(valueAt(s, ht))}</b> {s.label}</span>
            ))}
            {band && <span className="tip-band">{band.label}: <b>{band.points.find(p => Math.abs(p[0] - ht) < GAP)?.[1] ? "on" : "off"}</b></span>}
          </div>
        )}
      </div>
      <details className="table-view">
        <summary>Table</summary>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th>{series.map(s => <th key={s.label}>{s.label}</th>)}</tr></thead>
            <tbody>
              {times.filter((_, i) => i % Math.max(1, Math.ceil(times.length / 24)) === 0).map(t => (
                <tr key={t}><td>{hhmm(t)}</td>{visible.map(s => <td key={s.label}>{fmt(valueAt(s, t))}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
