import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing.tsx";
import { initHeader, initMotion } from "./motion.ts";
import "./landing.css";

createRoot(document.getElementById("root")!).render(<StrictMode><Landing /></StrictMode>);

// Start motion after fonts load, so headings split into lines at their final widths.
const start = () => requestAnimationFrame(() => { initHeader(); initMotion(); });
if (document.fonts?.ready) document.fonts.ready.then(start, start); else start();
