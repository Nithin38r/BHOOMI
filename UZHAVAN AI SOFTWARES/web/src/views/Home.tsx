import { useState } from "react";
import type { Device, Lang, State } from "../../../shared/api.ts";
import { fieldLabel, type TFn } from "../i18n.ts";
import { api, isOnline } from "../live.ts";
import { AlertItem, Card, CommandStatus, num } from "../ui.tsx";
import { Gauge, Num, Ring, SoilCore, useDark } from "../viz.tsx";

interface P { s: State; t: TFn; lang: Lang; now: number; speak: (s: string) => void; openNode: (id: string) => void; go: (tab: string) => void }

const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function Home({ s, t, lang, now, speak, openNode, go }: P) {
  const order = { crit: 0, warn: 1, info: 2 } as const;
  const alerts = [...s.alerts].sort((a, b) => order[a.severity] - order[b.severity] || b.openedAt - a.openedAt);
  const urgent = alerts.filter(a => a.severity !== "info").length;
  const online = s.devices.filter(d => isOnline(d, now)).length;
  const soil = s.devices.filter(d => d.type === "SOIL");
  const pond = s.devices.find(d => d.type === "POND");
  const pump = s.devices.find(d => d.type === "PUMP");
  const tone = !s.devices.length ? "info" : urgent ? alerts[0].severity : "ok";
  const m1 = avg(soil.filter(d => isOnline(d, now)).map(d => num(d.latest.M1)));
  const dO = pond ? num(pond.latest.DO) : null;
  const running = pump ? num(pump.latest.RUN) === 1 : false;

  return (
    <div className="stack">
      <section className={`now tone-${tone}`} aria-label={t("farm_now")}>
        <div className="now-head">
          <span className="now-eyebrow">{t("farm_now")} · {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <b className="now-title"><StatusIcon tone={tone} />{!s.devices.length ? t("no_devices") : urgent ? t("attention", { n: urgent }) : t("all_normal")}</b>
          <span className="now-sub">{online}/{s.devices.length} · {t("reporting")}</span>
        </div>
        <div className="now-stats">
          <Stat label={t("topsoil")} value={m1} unit="%" onClick={() => go("field")} />
          <Stat label={t("pond_oxygen")} value={dO} decimals={1} unit="mg/L" onClick={() => go("pond")} />
          <div className="stat"><small>{t("pump")}</small><b className={running ? "is-on" : ""}>{pump ? t(num(pump.latest.TRIP) === 1 ? "tripped" : running ? "running" : "stopped") : "–"}</b></div>
          <Stat label={t("rain_short")} value={s.weather.rainProb12h} unit="%" />
        </div>
      </section>

      <div className="home-grid">
        <div className="col">
          {alerts.length > 0 && (
            <Card title={t("alerts")}>
              <ul className="alerts">{alerts.map(a => <AlertItem key={a.id} a={a} lang={lang} now={now} t={t} onSpeak={speak} />)}</ul>
            </Card>
          )}
          {soil.length > 0 && <Cores soil={soil} s={s} t={t} now={now} openNode={openNode} />}
        </div>
        <div className="col">
          <PumpCard s={s} t={t} lang={lang} now={now} />
          {pond && <PondCard d={pond} s={s} t={t} lang={lang} go={go} />}
          <WeatherCard s={s} t={t} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, decimals = 0, onClick }: { label: string; value: number | null; unit: string; decimals?: number; onClick?: () => void }) {
  const body = <><small>{label}</small><b><Num value={value} decimals={decimals} /><i>{value == null ? "" : unit}</i></b></>;
  return onClick ? <button className="stat" onClick={onClick}>{body}</button> : <div className="stat">{body}</div>;
}

export function StatusIcon({ tone }: { tone: string }) {
  const d = tone === "ok" ? "M5 10.5l3.2 3.2L15 7" : tone === "info" ? "M10 6v.5M10 9v5" : "M10 5.5v5.5M10 14v.5";
  return <svg className={`status-icon tone-${tone}`} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" /><path d={d} /></svg>;
}

function Cores({ soil, s, t, now, openNode }: { soil: Device[]; s: State; t: TFn; now: number; openNode: (id: string) => void }) {
  const dark = useDark();
  return (
    <Card title={t("field_cores")} aside={<span className="ramp-key" aria-hidden="true"><span>{t("dry")}</span><i /><span>{t("wet")}</span></span>}>
      <p className="muted small">{t("cores_sub")}</p>
      <div className="cores" role="list">
        <div className="core-scale" aria-hidden="true"><span>0</span><span>15 cm</span><span>30 cm</span></div>
        {soil.map(d => {
          const m1 = num(d.latest.M1), m2 = num(d.latest.M2), on = isOnline(d, now);
          const dry = m1 != null && m1 < s.settings.dryBelow;
          return (
            <button key={d.id} role="listitem" className={`core-item ${dry ? "is-dry" : ""}`} onClick={() => openNode(d.id)}
              aria-label={`${d.name}: ${t("m15")} ${m1 == null ? "NA" : Math.round(m1)}%, ${t("m30")} ${m2 == null ? "NA" : Math.round(m2)}%${on ? "" : `, ${t("not_reporting")}`}`}>
              <SoilCore m1={m1} m2={m2} dark={dark} offline={!on} />
              <b>{d.name}{!on && <i className="dot crit" />}</b>
              <span className="core-vals"><Num value={m1} />·<Num value={m2} /></span>
              {dry && <span className="core-flag">{t("dry")}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export function PumpCard({ s, t, lang, now }: { s: State; t: TFn; lang: Lang; now: number }) {
  const pump = s.devices.find(d => d.type === "PUMP");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!pump) return null;
  const running = num(pump.latest.RUN) === 1, tripped = num(pump.latest.TRIP) === 1;
  const last = s.commands.find(c => c.deviceId === pump.id);
  const waiting = last && (last.status === "pending" || last.status === "sent");
  const send = async (val: string) => {
    setBusy(true); setErr(null);
    try { await api.command(pump.id, "PUMP", val); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const state = tripped ? "tripped" : running ? "running" : "stopped";
  return (
    <Card title={t("pump")} aside={<span className={`pill tone-${tripped ? "crit" : running ? "ok" : "none"}`}>{t(state)}</span>}>
      <div className={`pipe ${running ? "is-running" : ""}`} aria-hidden="true"><span /></div>
      {running && <p className="pipe-note">{t("flowing")} · <Num value={num(pump.latest.Q)} /> L/min</p>}
      <div className="kv">
        <span>{fieldLabel("I", lang)}</span><b><Num value={num(pump.latest.I) ?? 0} decimals={1} /> A</b>
        <span>{fieldLabel("RT", lang)}</span><b><Num value={num(pump.latest.RT) ?? 0} /> min</b>
      </div>
      <div className="btnrow">
        <button className="btn primary" disabled={busy || !!waiting || running} onClick={() => send("ON")}>{t("start_pump")}</button>
        <button className="btn" disabled={busy || !!waiting || !running} onClick={() => send("OFF")}>{t("stop_pump")}</button>
      </div>
      {err && <p className="err">{err}</p>}
      <CommandStatus c={last} t={t} lang={lang} now={now} />
      <label className="switch">
        <input type="checkbox" checked={s.settings.autoIrrigate} onChange={e => void api.settings({ autoIrrigate: e.target.checked })} />
        <span><b>{t("auto_irr")}</b><small>{t("auto_irr_sub")}</small></span>
      </label>
    </Card>
  );
}

export function doTone(v: number | null, low: number) { return v == null ? "none" : v < 3 ? "crit" : v < low ? "warn" : "ok"; }

function PondCard({ d, s, t, lang, go }: { d: Device; s: State; t: TFn; lang: Lang; go: (tab: string) => void }) {
  const flt = num(d.latest.FLT) ?? 0;
  const dO = flt >= 1 && flt <= 3 ? null : num(d.latest.DO);
  const tone = doTone(dO, s.settings.doLow), aer = num(d.latest.AER) === 1;
  return (
    <Card title={t("pond")} aside={<button className="link" onClick={() => go("pond")}>{t("nav_pond")} →</button>}>
      <div className="pond-gauge">
        <Gauge value={dO} low={s.settings.doLow} />
        <div className="gauge-read">
          <span className="hero-num"><Num value={dO} decimals={1} /><i>mg/L</i></span>
          <span className={`status-label tone-${tone}`}><StatusIcon tone={tone} />{t(tone === "crit" ? "oxy_crit" : tone === "warn" ? "oxy_low" : "oxy_ok")}</span>
        </div>
      </div>
      <div className="kv">
        <span>pH</span><b><Num value={num(d.latest.PH)} decimals={1} /></b>
        <span>{fieldLabel("WT", lang)}</span><b><Num value={num(d.latest.WT)} decimals={1} /> °C</b>
        <span>{t("aerator")}</span><b className={aer ? "tone-text-ok" : ""}>{aer ? t("aer_on") : t("aer_off")}</b>
      </div>
    </Card>
  );
}

function WeatherCard({ s, t }: { s: State; t: TFn }) {
  const w = s.weather;
  const src = w.source === "open-meteo" ? t("forecast_live") : w.source === "override" ? t("forecast_sim") : t("forecast_none");
  return (
    <Card title={t("weather")} aside={<span className={`pill tone-${w.source === "override" ? "warn" : w.source === "none" ? "none" : "info"}`}>{src}</span>}>
      <div className="weather">
        <div className="ring-wrap"><Ring value={w.rainProb12h} /><span><Num value={w.rainProb12h} />%</span></div>
        <div className="weather-kv">
          <small>{t("rain_chance")}</small>
          <small>{t("rain_total")}: <b>{w.rainMm24h == null ? "–" : `${w.rainMm24h} mm`}</b></small>
          <small>{t("now_label")}: <b>{w.tempC == null ? "–" : `${w.tempC.toFixed(0)} °C`} · {w.humidity == null ? "–" : `${Math.round(w.humidity)}%`}</b></small>
        </div>
      </div>
      {w.source === "override" && <button className="link" onClick={() => void api.settings({ weatherOverride: null })}>{t("use_live")}</button>}
    </Card>
  );
}
