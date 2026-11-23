import { useEffect, useState } from "react";
import { FIELD_INFO, RESERVED_FIELDS } from "../../../shared/am1.ts";
import type { Device, HistoryPoint, Lang, State } from "../../../shared/api.ts";
import { Chart } from "../Chart.tsx";
import { fieldLabel, type TFn } from "../i18n.ts";
import { api, isOnline } from "../live.ts";
import { ago, Card, fmtField, num } from "../ui.tsx";
import { moistureColor, Num, SoilCore, useDark } from "../viz.tsx";

const TILE_KEYS = ["ST", "AT", "AH", "LW", "LX", "EC", "PH", "NI", "PI", "KI", "BV", "RSSI", "HOP"];

export function useHistory(id: string | undefined, lastSeen: number | undefined) {
  const [h, setH] = useState<HistoryPoint[] | null>(null);
  useEffect(() => { setH(null); }, [id]);
  useEffect(() => {
    if (!id) return;
    let live = true;
    api.history(id).then(x => { if (live) setH(x); }).catch(() => { if (live) setH([]); });
    return () => { live = false; };
  }, [id, lastSeen]);
  return h;
}

export const pts = (h: HistoryPoint[], k: string): [number, number | null][] => h.map(p => [p.t, num(p.v[k])]);

export function Field({ s, t, lang, now, selected, select }: { s: State; t: TFn; lang: Lang; now: number; selected: string | null; select: (id: string) => void }) {
  const dark = useDark();
  const soil = s.devices.filter(d => d.type === "SOIL");
  const d = soil.find(x => x.id === selected) ?? soil[0];
  const hist = useHistory(d?.id, d?.lastSeen);
  if (!d) return <Card><p className="muted">{t("no_devices")}</p></Card>;
  const on = isOnline(d, now);
  const total = d.packets + d.lost;

  return (
    <div className="stack">
      <div className="core-picker" role="tablist" aria-label={t("soil_nodes")}>
        {soil.map(x => (
          <button key={x.id} role="tab" aria-selected={x.id === d.id} className={`core-tab ${x.id === d.id ? "on" : ""}`} onClick={() => select(x.id)}>
            <SoilCore m1={num(x.latest.M1)} m2={num(x.latest.M2)} dark={dark} offline={!isOnline(x, now)} width={30} />
            <span>{x.name}</span>
          </button>
        ))}
      </div>

      <Card title={<>{d.name} <small className="mono">{d.id}</small></>} aside={<span className={`pill tone-${on ? "ok" : "crit"}`}>{on ? t("reporting") : t("not_reporting")}</span>}>
        <div className="node-detail">
          <Profile d={d} t={t} lang={lang} dark={dark} />
          <div className="tiles">
            {TILE_KEYS.filter(k => k in d.latest && !(RESERVED_FIELDS.has(k) && d.latest[k] === null)).map(k => (
              <div key={k} className={`tile ${d.latest[k] === null ? "na" : ""}`}>
                <small>{fieldLabel(k, lang)}</small>
                <b>{typeof d.latest[k] === "number" ? <Num value={d.latest[k] as number} decimals={FIELD_INFO[k]?.dec ?? 0} /> : fmtField(k, d.latest[k])}<span className="unit">{FIELD_INFO[k]?.unit}</span></b>
              </div>
            ))}
          </div>
        </div>
        <p className="meta">
          {t("last_packet")}: {ago(now - d.lastSeen, lang, t)} · {t("packets")}: {d.packets} · {t("lost")}: {total ? Math.round((d.lost / total) * 100) : 0}% · #{d.lastSeq ?? "–"}
        </p>
      </Card>

      <Card title={`${t("moisture")} · ${t("last24")}`}>
        {hist == null ? <p className="muted">{t("no_history")}</p> : (
          <Chart now={now} yMin={0} yMax={100} unit="%" threshold={{ value: s.settings.dryBelow, label: `${t("dry")} < ${s.settings.dryBelow}%` }}
            series={[{ label: t("m15"), color: "var(--c1)", points: pts(hist, "M1") }, { label: t("m30"), color: "var(--c2)", points: pts(hist, "M2") }]} />
        )}
      </Card>

      <div className="grid2">
        <Card title={`${t("temperature")} · ${t("last24")}`}>
          {hist == null ? <p className="muted">{t("no_history")}</p> : (
            <Chart now={now} yMin={0} yMax={50} unit="°C" decimals={1}
              series={[{ label: fieldLabel("AT", lang), color: "var(--c2)", points: pts(hist, "AT") }, { label: fieldLabel("ST", lang), color: "var(--c1)", points: pts(hist, "ST") }]} />
          )}
        </Card>
        <Card title={`${fieldLabel("AH", lang)} · ${t("last24")}`}>
          {hist == null ? <p className="muted">{t("no_history")}</p> : (
            <Chart now={now} yMin={0} yMax={100} unit="%" area series={[{ label: fieldLabel("AH", lang), color: "var(--c1)", points: pts(hist, "AH") }]} />
          )}
        </Card>
      </div>
    </div>
  );
}

/** The selected node as a labelled soil profile: air readings above ground, probes at their real depths below. */
function Profile({ d, t, lang, dark }: { d: Device; t: TFn; lang: Lang; dark: boolean }) {
  const m1 = num(d.latest.M1), m2 = num(d.latest.M2), st = num(d.latest.ST), at = num(d.latest.AT), ah = num(d.latest.AH);
  return (
    <div className="profile" aria-label={`${d.name} soil profile`}>
      <div className="profile-air">
        <small>{fieldLabel("AT", lang)}</small><b><Num value={at} decimals={1} />°C</b>
        <small>{fieldLabel("AH", lang)}</small><b><Num value={ah} />%</b>
      </div>
      <div className="profile-col">
        <div className="profile-ground" />
        <div className="profile-layer" style={{ background: moistureColor(m1, dark) }} />
        <div className="profile-layer" style={{ background: moistureColor(m2, dark) }} />
      </div>
      <ul className="profile-labels">
        <li><span>10 cm</span><small>{fieldLabel("ST", lang)}</small><b><Num value={st} decimals={1} />°C</b></li>
        <li><span>15 cm</span><small>{t("m15")}</small><b className="big-val"><Num value={m1} />%</b></li>
        <li><span>30 cm</span><small>{t("m30")}</small><b className="big-val"><Num value={m2} />%</b></li>
      </ul>
    </div>
  );
}
