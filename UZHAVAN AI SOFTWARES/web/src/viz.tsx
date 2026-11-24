/** Small data visuals for the farmer app: soil cores, the oxygen gauge, a ring meter and an easing number. */
import { useEffect, useRef, useState } from "react";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True when the app is showing its dark palette (OS setting or explicit data-theme). */
export function useDark() {
  const q = () => document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const [dark, setDark] = useState(q);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(q());
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return dark;
}

/**
 * Soil moisture as a single-hue sequential blue ramp: more water = more contrast with the page.
 * Light mode runs light→dark; dark mode is its own selection, running dark→light so wet still stands out.
 * Both ramps step evenly in lightness (about 10 L* per step), so 8 % and 28 % read as clearly different.
 * The scale covers 0–80 %: wetter than that is waterlogged and raises its own alert.
 */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const RAMP_DARK = ["#1d3a5f", "#1f4f86", "#2566ad", "#2f7fd2", "#5a9be6", "#8dbbf0", "#c2dbf8"];
const RAMP_MAX = 80;
/** The same ramp as a CSS gradient, dry on the left, for the key next to the soil cores. */
export const rampGradient = (dark: boolean) => `linear-gradient(90deg, ${(dark ? RAMP_DARK : RAMP).join(", ")})`;
function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}
export function moistureColor(m: number | null, dark: boolean): string {
  if (m == null) return "var(--sunk)";
  const r = dark ? RAMP_DARK : RAMP, f = Math.max(0, Math.min(1, m / RAMP_MAX)) * (r.length - 1), i = Math.min(r.length - 2, Math.floor(f));
  return mix(r[i], r[i + 1], f - i);
}

/** Animate a number toward its new value (instant for reduced-motion users). */
export function useTween(value: number | null, ms = 650): number | null {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value == null || from.current == null || reduced()) { from.current = value; setShown(value); return; }
    const a = from.current, b = value, start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setShown(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value, ms]);
  return shown;
}

export function Num({ value, decimals = 0, className = "" }: { value: number | null; decimals?: number; className?: string }) {
  const v = useTween(value);
  return <span className={className}>{v == null ? "NA" : v.toFixed(decimals)}</span>;
}

/**
 * One soil node as a soil core: the node head at the surface, then 0–20 cm coloured by the 15 cm probe (M1)
 * and 20–40 cm by the 30 cm probe (M2). Values sit under the core in text colour, never inside the fill.
 */
export function SoilCore({ m1, m2, dark, offline, selected, width = 54 }: {
  m1: number | null; m2: number | null; dark: boolean; offline?: boolean; selected?: boolean; width?: number;
}) {
  const h = width * 2.3;
  const top = width * 0.42, mid = top + (h - top) / 2;
  return (
    <svg className={`core ${offline ? "off" : ""} ${selected ? "sel" : ""}`} width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
      <rect x={width * 0.36} y={2} width={width * 0.28} height={top - 2} rx={3} className="core-head" />
      <line x1={0} x2={width} y1={top} y2={top} className="core-ground" />
      <rect x={4} y={top + 2} width={width - 8} height={mid - top - 3} rx={5} style={{ fill: moistureColor(m1, dark) }} className="core-fill" />
      <rect x={4} y={mid + 1} width={width - 8} height={h - mid - 3} rx={5} style={{ fill: moistureColor(m2, dark) }} className="core-fill" />
    </svg>
  );
}

/** Dissolved-oxygen gauge 0–12 mg/L with the critical (< 3) and low (< doLow) bands marked. */
export function Gauge({ value, low, crit = 3, max = 12 }: { value: number | null; low: number; crit?: number; max?: number }) {
  const v = useTween(value);
  const R = 84, cx = 100, cy = 100, a = (x: number) => Math.PI * (1 - Math.max(0, Math.min(max, x)) / max);
  const pt = (x: number, r = R) => [cx + r * Math.cos(a(x)), cy - r * Math.sin(a(x))] as const;
  const arc = (from: number, to: number) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`; };
  const [nx, ny] = pt(v ?? 0, R - 20);
  return (
    <svg className="gauge" viewBox="0 0 200 116" role="img" aria-label={`Dissolved oxygen ${value == null ? "not available" : `${value.toFixed(1)} mg/L`}`}>
      <path d={arc(0, crit)} className="g-crit" />
      <path d={arc(crit, low)} className="g-warn" />
      <path d={arc(low, max)} className="g-ok" />
      {[0, crit, low, max].map(t => { const [x, y] = pt(t, R + 13); return <text key={t} x={x} y={y + 4} textAnchor="middle" className="g-tick">{t}</text>; })}
      {v != null && <>
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="g-needle" />
        <circle cx={cx} cy={cy} r={6} className="g-hub" />
      </>}
    </svg>
  );
}

/** A ring meter for a single 0–100 value (rain chance). */
export function Ring({ value, size = 64 }: { value: number | null; size?: number }) {
  const v = useTween(value);
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill" strokeDasharray={`${(c * (v ?? 0)) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}
