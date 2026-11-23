import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alertText } from "../../shared/alerts-i18n.ts";
import type { Lang } from "../../shared/api.ts";
import { LANG_NAMES, makeT, SPEECH_LANG, type Key } from "./i18n.ts";
import { useLive } from "./live.ts";
import { Field } from "./views/Field.tsx";
import { Home } from "./views/Home.tsx";
import { More } from "./views/More.tsx";
import { Pond } from "./views/Pond.tsx";
import { Spray } from "./views/Spray.tsx";

const TABS: { id: string; key: Key; icon: string }[] = [
  { id: "home", key: "nav_home", icon: "⌂" },
  { id: "field", key: "nav_field", icon: "🌱" },
  { id: "pond", key: "nav_pond", icon: "🐟" },
  { id: "spray", key: "nav_spray", icon: "🧴" },
  { id: "more", key: "nav_more", icon: "⋯" },
];

/** localStorage can throw (private mode, blocked storage); the app must work without it. */
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function App() {
  const { state, connected, now, error } = useLive();
  const [lang, setLangState] = useState<Lang>(() => (store.get("am-lang") as Lang) || "en");
  const [voice, setVoice] = useState(() => store.get("am-voice") === "1");
  const [tab, setTab] = useState(() => (TABS.some(x => `#${x.id}` === location.hash) ? location.hash.slice(1) : "home"));
  const [node, setNode] = useState<string | null>(null);
  const t = useMemo(() => makeT(lang), [lang]);

  const setLang = (l: Lang) => { setLangState(l); store.set("am-lang", l); };
  const go = (id: string) => { setTab(id); history.replaceState(null, "", `#${id}`); window.scrollTo({ top: 0 }); };
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    const onHash = () => { const id = location.hash.slice(1); if (TABS.some(x => x.id === id)) setTab(id); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang];
    const v = speechSynthesis.getVoices().find(x => x.lang.toLowerCase().startsWith(lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }, [lang]);

  // Voice: read out new warnings and critical alerts as they arrive.
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!state) return;
    if (!seen.current) { seen.current = new Set(state.alerts.map(a => a.id)); return; }
    for (const a of state.alerts) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (voice && a.severity !== "info") { const x = alertText(a.code, a.params, lang); speak(`${x.title}. ${x.detail}`); }
    }
  }, [state?.alerts, voice, lang, speak, state]);

  if (!state) {
    return <div className="boot"><div className="brand-mark" />{error ? <p>Hub not reachable: {error}</p> : <p>BHOOMI…</p>}</div>;
  }

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/" title="About BHOOMI">
          <span className="brand-mark" aria-hidden />
          <div><b>BHOOMI</b><small>{state.settings.farmName}</small></div>
        </a>
        <nav className="tabs-top">
          {TABS.map(x => <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => go(x.id)}>{t(x.key)}</button>)}
        </nav>
        <div className="top-ctl">
          <span className={`live ${connected ? "ok" : "bad"}`}><i />{connected ? t("live") : t("reconnecting")}</span>
          <button className={`icon-btn ${voice ? "on" : ""}`} aria-pressed={voice} title={t("voice")} aria-label={t("voice")}
            onClick={() => { const v = !voice; setVoice(v); store.set("am-voice", v ? "1" : "0"); if (v) speak(t("voice")); }}>{voice ? "🔊" : "🔈"}</button>
          <select className="lang" value={lang} aria-label={t("app_lang")} onChange={e => setLang(e.target.value as Lang)}>
            {(Object.keys(LANG_NAMES) as Lang[]).map(l => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </div>
      </header>

      <main className="content">
        <div key={tab} className="view">
          {tab === "home" && <Home s={state} t={t} lang={lang} now={now} speak={speak} go={go} openNode={id => { setNode(id); go("field"); }} />}
          {tab === "field" && <Field s={state} t={t} lang={lang} now={now} selected={node} select={setNode} />}
          {tab === "pond" && <Pond s={state} t={t} lang={lang} now={now} />}
          {tab === "spray" && <Spray s={state} t={t} lang={lang} now={now} />}
          {tab === "more" && <More s={state} t={t} lang={lang} now={now} setLang={setLang} />}
        </div>
      </main>

      <nav className="tabs-bottom">
        {TABS.map(x => (
          <button key={x.id} className={tab === x.id ? "on" : ""} onClick={() => go(x.id)}>
            <span aria-hidden>{x.icon}</span>{t(x.key)}
            {x.id === "home" && state.alerts.some(a => a.severity === "crit") && <i className="badge" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
