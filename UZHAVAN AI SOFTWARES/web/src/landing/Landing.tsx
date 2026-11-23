import { alertText } from "../../../shared/alerts-i18n.ts";
import { app, footer, hardware, hero, nav, packet, problems, safety, soilParts, status, steps } from "./content.ts";
import { SoilSection } from "./SoilSection.tsx";

/** The pond alert the app would actually send, rendered from the same Telugu text the server uses for SMS. */
const sampleAlert = alertText("DO_CRIT", { do: 2.8 }, "te");
const sampleAlertEn = alertText("DO_CRIT", { do: 2.8 }, "en");

export function Landing() {
  return (
    <>
      <header className="nav">
        <div className="wrap nav-row">
          <a href="#top" className="wordmark" aria-label="BHOOMI, back to top"><Mark />BHOOMI</a>
          <nav aria-label="Sections">
            {nav.map(n => <a key={n.href} href={n.href}>{n.label}</a>)}
          </nav>
          <a className="btn btn-sm" href="/app/">Farmer app</a>
        </div>
      </header>

      <main id="top">
        {/* ------------------------------------------------ hero */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow" data-reveal>{hero.eyebrow}</p>
              <h1 className="display" data-split>{hero.title}</h1>
              <p className="lede" data-reveal data-reveal-delay="0.15">{hero.lede}</p>
              <div className="cta-row" data-reveal data-reveal-delay="0.25">
                <a className="btn" href={hero.primary.href}>{hero.primary.label}</a>
                <a className="btn btn-ghost" href={hero.secondary.href}>{hero.secondary.label}</a>
              </div>
            </div>
            <figure className="hero-figure" data-reveal data-reveal-delay="0.1">
              <SoilSection />
              <figcaption>
                <ol className="parts">
                  {soilParts.map(p => <li key={p.n}><b>{p.n}</b><span><strong>{p.name}</strong> {p.detail}</span></li>)}
                </ol>
                <small>{hero.figureCaption}</small>
              </figcaption>
            </figure>
          </div>
          <div className="wrap packet" data-reveal>
            <span className="packet-intro">{packet.intro}</span>
            <code className="packet-line">{packet.line}</code>
            <small>{packet.note}</small>
          </div>
        </section>

        {/* ------------------------------------------------ problem */}
        <section className="section" id="problem">
          <div className="wrap">
            <p className="eyebrow" data-reveal>{problems.eyebrow}</p>
            <h2 className="h2" data-split>{problems.title}</h2>
            <div className="problems">
              {problems.items.map(p => (
                <article key={p.q} className="problem" data-reveal>
                  <h3>{p.q}</h3>
                  <p>{p.a}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ how it works (a real sequence, so numbered) */}
        <section className="section band" id="how">
          <div className="wrap">
            <p className="eyebrow" data-reveal>{steps.eyebrow}</p>
            <h2 className="h2" data-split>{steps.title}</h2>
            <ol className="steps">
              {steps.items.map((s, i) => (
                <li key={s.k} className="step" data-reveal data-reveal-delay={String(i * 0.06)}>
                  <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{s.k}</h3>
                  <p>{s.t}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------ hardware */}
        <section className="section" id="hardware">
          <div className="wrap">
            <p className="eyebrow" data-reveal>{hardware.eyebrow}</p>
            <h2 className="h2" data-split>{hardware.title}</h2>
            <div className="devices">
              {hardware.devices.map(d => (
                <article key={d.name} className="device" data-reveal>
                  <header><h3>{d.name}</h3><span className="chip">{d.tag}</span></header>
                  <dl>
                    {d.specs.map(([k, v]) => (
                      <div key={k} className={k === "Status" ? "is-status" : ""}><dt>{k}</dt><dd>{v}</dd></div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ app */}
        <section className="section band" id="app">
          <div className="wrap app-grid">
            <div>
              <p className="eyebrow" data-reveal>{app.eyebrow}</p>
              <h2 className="h2" data-split>{app.title}</h2>
              <ul className="ticks">
                {app.points.map(p => <li key={p} data-reveal>{p}</li>)}
              </ul>
              <a className="btn" href={app.cta.href} data-reveal>{app.cta.label}</a>
            </div>
            <div className="phone-wrap" data-reveal data-reveal-delay="0.1">
              <div className="phone" aria-label="Example screen from the farmer app, in Telugu">
                <div className="phone-top"><Mark /><b>BHOOMI</b><span className="phone-live">● లైవ్</span></div>
                <div className="phone-alert" lang="te">
                  <b>{sampleAlert.title}</b>
                  <span>{sampleAlert.detail}</span>
                </div>
                <div className="phone-card">
                  <small lang="te">కరిగిన ఆక్సిజన్</small>
                  <span className="phone-big">2.8 <i>mg/L</i></span>
                  <span className="phone-bar"><span style={{ width: "28%" }} /></span>
                </div>
                <div className="phone-card phone-row">
                  <span lang="te">ఏరేటర్</span><b className="ok" lang="te">ఆన్ · నిర్ధారించబడింది</b>
                </div>
                <div className="phone-nav" aria-hidden="true"><span>⌂</span><span>🌱</span><span className="on">🐟</span><span>🧴</span><span>⋯</span></div>
              </div>
              <p className="phone-gloss"><b>In English:</b> {sampleAlertEn.title}. {sampleAlertEn.detail}</p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ safety */}
        <section className="section" id="safety">
          <div className="wrap">
            <p className="eyebrow" data-reveal>{safety.eyebrow}</p>
            <h2 className="h2" data-split>{safety.title}</h2>
            <p className="section-lede" data-reveal>{safety.lede}</p>
            <div className="rules">
              {safety.rules.map(([k, v]) => (
                <div key={k} className="rule" data-reveal><span className="rule-k">{k}</span><span>{v}</span></div>
              ))}
            </div>
            <p className="aside" data-reveal>{safety.pump}</p>
          </div>
        </section>

        {/* ------------------------------------------------ honest status */}
        <section className="section band" id="status">
          <div className="wrap">
            <p className="eyebrow" data-reveal>{status.eyebrow}</p>
            <h2 className="h2" data-split>{status.title}</h2>
            <div className="status">
              {status.columns.map(c => (
                <div key={c.h} className={`status-col tone-${c.tone}`} data-reveal>
                  <h3>{c.h}</h3>
                  <ul>{c.items.map(i => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className="aside" data-reveal>{status.note}</p>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-row">
          <a href="#top" className="wordmark"><Mark />BHOOMI</a>
          <span>{footer.team}</span>
          <a href="/app/">Farmer app →</a>
        </div>
      </footer>
    </>
  );
}

/** The mark: a soil profile with two probe depths and a radio arc, in the brand colours. */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="0" y="0" width="32" height="32" rx="7" className="mark-bg" />
      <path d="M6 15h20" className="mark-ground" />
      <path d="M16 15v11" className="mark-pipe" />
      <path d="M16 19.5h6M16 23.5h-6" className="mark-probe" />
      <path d="M11.5 10a6 6 0 0 1 9 0M8.5 7a10 10 0 0 1 15 0" className="mark-arc" />
    </svg>
  );
}
