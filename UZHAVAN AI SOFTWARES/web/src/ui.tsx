/** Shared UI pieces. */
import type { ReactNode } from "react";
import { FIELD_INFO, type FieldValue } from "../../shared/am1.ts";
import { alertText, formatDuration } from "../../shared/alerts-i18n.ts";
import type { Alert, Command, Lang } from "../../shared/api.ts";
import type { TFn } from "./i18n.ts";

export const num = (v: FieldValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function fmtField(key: string, v: FieldValue | undefined): string {
  if (v === undefined) return "–";
  if (v === null) return "NA";
  const info = FIELD_INFO[key];
  return typeof v === "number" && info ? v.toFixed(info.dec) : String(v);
}

export const ago = (ms: number, lang: Lang, t: TFn) => t("ago", { t: formatDuration(Math.max(1, Math.round(ms / 60_000)), lang) });

/** Colour for topsoil moisture: dry → amber/red, fine → green, saturated → blue. */
export function moistureTone(m: number | null, dryBelow: number): "crit" | "warn" | "ok" | "wet" | "none" {
  if (m == null) return "none";
  if (m < dryBelow * 0.6) return "crit";
  if (m < dryBelow) return "warn";
  if (m >= 90) return "wet";
  return "ok";
}

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && <header className="card-h"><h2>{title}</h2>{aside}</header>}
      {children}
    </section>
  );
}

export function AlertItem({ a, lang, now, t, onSpeak }: { a: Alert; lang: Lang; now: number; t: TFn; onSpeak?: (text: string) => void }) {
  const txt = alertText(a.code, a.params, lang);
  return (
    <li className={`alert sev-${a.severity}`}>
      <div className="alert-body">
        <b>{txt.title}</b>
        <span>{txt.detail}</span>
        <small>{ago(now - a.openedAt, lang, t)}</small>
      </div>
      {onSpeak && <button className="icon-btn" aria-label="Read aloud" title="Read aloud" onClick={() => onSpeak(`${txt.title}. ${txt.detail}`)}>🔊</button>}
    </li>
  );
}

export function CommandStatus({ c, t, lang, now }: { c: Command | undefined; t: TFn; lang: Lang; now: number }) {
  if (!c) return null;
  const label = { pending: t("cmd_pending"), sent: t("cmd_sent"), acked: t("cmd_acked"), failed: t("cmd_failed") }[c.status];
  return (
    <p className={`cmd cmd-${c.status}`}>
      <b>{c.cmd} {c.val}</b> · {c.source === "auto" ? t("by_auto") : t("by_farmer")} · {label} · {ago(now - c.createdAt, lang, t)}
      {c.source === "auto" && <><br /><small>{c.reason}</small></>}
    </p>
  );
}

export function Meter({ value, max = 100, tone }: { value: number | null; max?: number; tone: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return <span className={`meter tone-${tone}`}><span style={{ width: `${pct}%` }} /></span>;
}
