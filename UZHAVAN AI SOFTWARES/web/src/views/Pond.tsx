import { useState } from "react";
import type { Lang, State } from "../../../shared/api.ts";
import { Chart } from "../Chart.tsx";
import { fieldLabel, type TFn } from "../i18n.ts";
import { api, isOnline } from "../live.ts";
import { ago, Card, CommandStatus, num } from "../ui.tsx";
import { Gauge, Num } from "../viz.tsx";
import { pts, useHistory } from "./Field.tsx";
import { doTone, StatusIcon } from "./Home.tsx";

const MODES = [["AUTO", "aer_auto"], ["ON", "aer_on"], ["OFF", "aer_off"]] as const;

export function Pond({ s, t, lang, now }: { s: State; t: TFn; lang: Lang; now: number }) {
  const d = s.devices.find(x => x.type === "POND");
  const hist = useHistory(d?.id, d?.lastSeen);
  const [err, setErr] = useState<string | null>(null);
  if (!d) return <Card><p className="muted">{t("no_pond")}</p></Card>;
  const last = s.commands.find(c => c.deviceId === d.id);
  const lastMode = s.commands.find(c => c.deviceId === d.id && c.cmd === "AER" && c.status === "acked")?.val ?? "AUTO";
  const waiting = last && (last.status === "pending" || last.status === "sent");
  const flt = num(d.latest.FLT) ?? 0;
  const dO = flt >= 1 && flt <= 3 ? null : num(d.latest.DO);
  const tone = doTone(dO, s.settings.doLow);
  const send = async (cmd: string, val: string) => { setErr(null); try { await api.command(d.id, cmd, val); } catch (e) { setErr((e as Error).message); } };
  const on = isOnline(d, now);
  const low = s.settings.doLow;

  return (
    <div className="stack">
      <Card title={t("pond")} aside={<span className={`pill tone-${on ? "ok" : "crit"}`}>{on ? t("reporting") : t("not_reporting")}</span>}>
        <div className="pond-top">
          <div className="pond-gauge big">
            <Gauge value={dO} low={low} />
            <div className="gauge-read">
              <span className="hero-num"><Num value={dO} decimals={1} /><i>mg/L</i></span>
              <span className={`status-label tone-${tone}`}><StatusIcon tone={tone} />{t(tone === "crit" ? "oxy_crit" : tone === "warn" ? "oxy_low" : "oxy_ok")}</span>
            </div>
          </div>
          <div className="tiles">
            <div className="tile"><small>{fieldLabel("DOS", lang)}</small><b><Num value={num(d.latest.DOS)} /><span className="unit">%</span></b></div>
            <div className="tile"><small>pH</small><b><Num value={num(d.latest.PH)} decimals={2} /></b></div>
            <div className="tile"><small>{fieldLabel("WT", lang)}</small><b><Num value={num(d.latest.WT)} decimals={1} /><span className="unit">°C</span></b></div>
            <div className="tile"><small>{fieldLabel("AERI", lang)}</small><b><Num value={num(d.latest.AERI)} decimals={2} /><span className="unit">A</span></b></div>
            <div className={`tile ${flt ? "na" : ""}`}><small>{t("fault")}</small><b>{flt || "–"}</b></div>
            <div className="tile"><small>{t("last_packet")}</small><b className="small-val">{ago(now - d.lastSeen, lang, t)}</b></div>
          </div>
        </div>
      </Card>

      <Card title={t("aer_mode")}>
        <p className="muted">{t("aer_mode_sub")}</p>
        <div className="segmented" role="radiogroup" aria-label={t("aer_mode")}>
          {MODES.map(([v, k]) => (
            <button key={v} role="radio" aria-checked={lastMode === v} className={lastMode === v ? "on" : ""} disabled={!!waiting} onClick={() => send("AER", v)}>{t(k)}</button>
          ))}
        </div>
        <button className="link" disabled={!!waiting} onClick={() => send("STATUS", "?")}>{t("ask_reading")}</button>
        {err && <p className="err">{err}</p>}
        <CommandStatus c={last} t={t} lang={lang} now={now} />
      </Card>

      <Card title={`${t("do_label")} · ${t("last24")}`}>
        {hist == null ? <p className="muted">{t("no_history")}</p> : (
          <Chart now={now} yMin={0} yMax={12} unit=" mg/L" decimals={1} height={210}
            zones={[{ from: 0, to: 3, tone: "crit" }, { from: 3, to: low, tone: "warn" }]}
            band={{ label: t("aerator"), points: hist.map(p => [p.t, num(p.v.AER) === 1]) }}
            series={[{ label: t("do_label"), color: "var(--c1)", points: pts(hist, "DO") }]} />
        )}
        <p className="chart-note"><span className="key key-crit" />{t("oxy_crit")} &lt; 3 · <span className="key key-warn" />{t("oxy_low")} &lt; {low} · <span className="key key-band" />{t("aerator")} {t("aer_on").toLowerCase()}</p>
      </Card>

      <Card title={`pH · ${t("last24")}`}>
        {hist == null ? <p className="muted">{t("no_history")}</p> : (
          <Chart now={now} yMin={5} yMax={10} unit="" decimals={2} height={150} series={[{ label: "pH", color: "var(--c2)", points: pts(hist, "PH") }]} />
        )}
      </Card>
    </div>
  );
}
