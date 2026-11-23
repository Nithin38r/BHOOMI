/**
 * Landing-page motion: smooth scroll (Lenis), fade-up reveals and line-by-line headings (GSAP ScrollTrigger + SplitText).
 * Nothing is hidden by CSS alone: elements start hidden only after this script runs, so the page reads fine
 * without JavaScript, and reduced-motion users get a still page.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText);

/** Reduced-motion users, and ?still in the URL (for screenshots and slides), get the page without motion. */
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("still");

export function initMotion() {
  if (reduced) return;
  (window as unknown as { __bhoomiMotion: boolean }).__bhoomiMotion = true;
  document.documentElement.classList.add("motion");

  // Smooth scroll with a little weight, like turning soil.
  const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, touchMultiplier: 1.3 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // In-page links glide through Lenis, offset for the sticky header.
  document.addEventListener("click", e => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    const id = a?.getAttribute("href");
    if (!a || !id) return;
    e.preventDefault();
    if (id === "#top") lenis.scrollTo(0, { duration: 1.2 });
    else { const t = document.querySelector<HTMLElement>(id); if (t) lenis.scrollTo(t, { offset: -72, duration: 1.3 }); }
    history.replaceState(null, "", id === "#top" ? location.pathname : id);
  });

  // Fade-up reveals, batched so a row of cards comes in as a stagger.
  gsap.set("[data-reveal]", { opacity: 0, y: 28 });
  ScrollTrigger.batch("[data-reveal]", {
    start: "top 90%",
    once: true,
    onEnter: els => gsap.to(els, {
      opacity: 1, y: 0, duration: 1.05, ease: "expo.out", stagger: 0.07,
      delay: (_i: number, el: Element) => Number((el as HTMLElement).dataset.revealDelay ?? 0),
    }),
  });

  // Headings rise line by line out of a mask.
  document.querySelectorAll<HTMLElement>("[data-split]").forEach(el => {
    SplitText.create(el, {
      type: "lines", mask: "lines", autoSplit: true,
      onSplit(self) {
        el.classList.add("split-ready");
        return gsap.from(self.lines, {
          yPercent: 105, duration: 1.15, ease: "expo.out", stagger: 0.08,
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      },
    });
  });
}

/** The header gains a backdrop once the page has moved. Runs with or without motion. */
export function initHeader() {
  const nav = document.querySelector(".nav");
  const update = () => nav?.classList.toggle("is-scrolled", window.scrollY > 24);
  update();
  window.addEventListener("scroll", update, { passive: true });
}
