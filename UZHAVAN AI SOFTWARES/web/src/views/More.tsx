import { useEffect, useState } from "react";
import type { Lang, Settings, State } from "../../../shared/api.ts";
import { LANG_NAMES, type TFn } from "../i18n.ts";
import { api, isOnline } from "../live.ts";
import { ago, Card } from "../ui.tsx";

export function More({ s, t, lang, now, setLang }: { s: State; t: TFn; lang: Lang; now: number; setLang: (l: Lang) => void }) {
  return (
    <div className="stack">
      <SettingsCard s={s} t={t} lang={lang} setLang={setLang} />
      <Devices s={s} t={t} lang={lang} now={now} />
      <Card title={t("sms_out")}>
        {!s.messages.length && <p className="muted">{t("no_sms")}</p>}
        <ul className="sms">{s.messages.map(m => <li key={m.id}><small>{new Date(m.createdAt).toLocaleString()}</small>{m.text}</li>)}</ul>
      </Card>
      <RawLog t={t} />
      <Card title={t("gateway_help")}>
        <pre className="code">{`HTTP  POST /api/ingest          (text: one AM1 packet per line)
MQTT  bhoomi/<gateway>/up         → server
MQTT  bhoomi/hub/down             ← commands
HTTP  GET  /api/gateway/commands  (commands, for gateways without MQTT)
HTTP  GET  /api/gateway/outbox?since=<id>   (SMS to send)

up:    AM1,ID=7C9E1A,T=SOIL,N=42,M1=41.5,M2=60.2,ST=28.1,AT=31.0,AH=62,BV=3.98
down:  AM1,ID=HUB001,T=CMD,N=17,DST=7C9E2A,AER=ON,TS=1795190000
reply: AM1,ID=7C9E2A,T=ACK,N=17,OK=1,MODE=ON,AER=1`}</pre>
      </Card>
    </div>
  );
}

function SettingsCard({ s, t, lang, setLang }: { s: State; t: TFn; lang: Lang; setLang: (l: Lang) => void }) {
  const [draft, setDraft] = useState<Settings>(s.settings);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setDraft(s.settings); }, [s.settings]);
  const save = async () => {
    setMsg(null);
    try {
      await api.settings({ farmName: draft.farmName, language: draft.language, dryBelow: draft.dryBelow, fullAt: draft.fullAt, rainSkipProb: draft.rainSkipProb, doLow: draft.doLow });
      setMsg("✓");
    } catch (e) { setMsg((e as Error).message); }
  };
  const numField = (k: "dryBelow" | "fullAt" | "rainSkipProb" | "doLow", label: string, step = 1) => (
    <label>{label}<input type="number" step={step} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })} /></label>
  );
  return (
    <Card title={t("settings")}>
      <div className="form">
        <label>{t("app_lang")}
          <select value={lang} onChange={e => setLang(e.target.value as Lang)}>{(Object.keys(LANG_NAMES) as Lang[]).map(l => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</select>
        </label>
        <label>{t("sms_lang")}
          <select value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value as Lang })}>{(Object.keys(LANG_NAMES) as Lang[]).map(l => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</select>
        </label>
        <label>{t("farm_name")}<input value={draft.farmName} maxLength={60} onChange={e => setDraft({ ...draft, farmName: e.target.value })} /></label>
        {numField("dryBelow", t("dry_below"))}
        {numField("fullAt", t("full_at"))}
        {numField("rainSkipProb", t("rain_skip"))}
        {numField("doLow", t("do_low"), 0.1)}
      </div>
      <button className="btn primary" onClick={save}>{t("save")}</button> {msg && <span className={msg === "✓" ? "tone-text-ok" : "err"}>{msg}</span>}
    </Card>
  );
}

function Devices({ s, t, lang, now }: { s: State; t: TFn; lang: Lang; now: number }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [name, setName] = useState("");
  const save = async (id: string) => { try { await api.rename(id, name); setEdit(null); } catch { /* keep editing */ } };
  return (
    <Card title={`${t("devices")} (${s.devices.length})`}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{t("name")}</th><th>{t("type")}</th><th>ID</th><th>{t("last_packet")}</th><th>{t("signal")}</th><th>{t("battery")}</th><th>{t("packets")}</th></tr></thead>
          <tbody>
            {s.devices.map(d => (
              <tr key={d.id}>
                <td>
                  {edit === d.id ? (
                    <span className="inline-edit"><input value={name} maxLength={40} autoFocus onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && save(d.id)} /><button className="link" onClick={() => save(d.id)}>{t("save")}</button></span>
                  ) : (
                    <><i className={`dot ${isOnline(d, now) ? "ok" : "crit"}`} /> {d.name} <button className="link" onClick={() => { setEdit(d.id); setName(d.name); }}>{t("rename")}</button></>
                  )}
                </td>
                <td>{d.type}</td>
                <td className="mono">{d.id}</td>
                <td>{ago(now - d.lastSeen, lang, t)}</td>
                <td>{d.rssi ?? "–"} dBm</td>
                <td>{typeof d.latest.BV === "number" ? `${d.latest.BV.toFixed(2)} V` : "–"}</td>
                <td>{d.packets}{d.lost ? ` (−${d.lost})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RawLog({ t }: { t: TFn }) {
  const [rows, setRows] = useState<{ ts: number; deviceId: string; raw: string }[]>([]);
  const load = () => { api.log().then(setRows).catch(() => setRows([])); };
  useEffect(load, []);
  return (
    <Card title={t("raw")} aside={<button className="link" onClick={load}>↻</button>}>
      <pre className="code log">{rows.map(r => `${new Date(r.ts).toLocaleTimeString()}  ${r.raw}`).join("\n")}</pre>
    </Card>
  );
}
