import { useState } from "react";
import { formatDuration } from "../../../shared/alerts-i18n.ts";
import type { Lang, State } from "../../../shared/api.ts";
import type { Key, TFn } from "../i18n.ts";
import { api } from "../live.ts";
import { Card } from "../ui.tsx";

/** Typical label values for the demo. The farmer should copy the real numbers from the product label. */
const PRESETS: { key: Key; kind: "insect" | "fungus" | "other"; phi: number; hl: number }[] = [
  { key: "p_ins", kind: "insect", phi: 7, hl: 3 },
  { key: "p_fun", kind: "fungus", phi: 14, hl: 5 },
  { key: "p_neem", kind: "insect", phi: 1, hl: 1 },
  { key: "p_custom", kind: "other", phi: 7, hl: 3 },
];

export function Spray({ s, t, lang, now }: { s: State; t: TFn; lang: Lang; now: number }) {
  const [preset, setPreset] = useState(0);
  const [name, setName] = useState("");
  const [phi, setPhi] = useState(PRESETS[0].phi);
  const [hl, setHl] = useState(PRESETS[0].hl);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = (i: number) => { setPreset(i); setPhi(PRESETS[i].phi); setHl(PRESETS[i].hl); };
  const save = async () => {
    const p = PRESETS[preset];
    setBusy(true); setErr(null);
    try {
      await api.addSpray({ product: name.trim() || t(p.key), kind: p.kind, phiDays: phi, halfLifeDays: hl });
      setName("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <Card title={t("log_spray")}>
        <div className="chips">
          {PRESETS.map((p, i) => <button key={p.key} className={`chip ${i === preset ? "on" : ""}`} onClick={() => choose(i)}>{t(p.key)}</button>)}
        </div>
        <div className="form">
          <label>{t("name")}<input value={name} maxLength={60} placeholder={t(PRESETS[preset].key)} onChange={e => setName(e.target.value)} /></label>
          <label>{t("phi_days")}<input type="number" min={0} max={120} value={phi} onChange={e => setPhi(Number(e.target.value))} /></label>
          <label>{t("half_life")}<input type="number" min={0.1} max={120} step={0.5} value={hl} onChange={e => setHl(Number(e.target.value))} /></label>
        </div>
        <button className="btn primary" disabled={busy} onClick={save}>{t("save")}</button>
        {err && <p className="err">{err}</p>}
        <p className="muted small">{t("spray_note")}</p>
      </Card>

      <Card title={t("spray")}>
        {!s.sprays.length && <p className="muted">{t("no_sprays")}</p>}
        <ul className="sprays">
          {s.sprays.map(sp => {
            const left = sp.safeAt - now, total = sp.safeAt - sp.sprayedAt;
            const done = left <= 0;
            return (
              <li key={sp.id} className={done ? "done" : ""}>
                <div className="spray-h">
                  <b>{sp.product}</b>
                  <button className="link danger" onClick={() => void api.deleteSpray(sp.id)}>{t("delete")}</button>
                </div>
                <span className={done ? "tone-text-ok" : "tone-text-warn"}>
                  {done ? t("safe_now") : t("safe_in", { t: formatDuration(Math.ceil(left / 60_000), lang) })}
                </span>
                <span className="meter tone-ok"><span style={{ width: `${Math.min(100, ((now - sp.sprayedAt) / total) * 100)}%` }} /></span>
                <small>{t("sprayed")}: {new Date(sp.sprayedAt).toLocaleString()} · {t("label_phi", { d: sp.phiDays })} · {t("model_d", { d: sp.modelDays })}</small>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
