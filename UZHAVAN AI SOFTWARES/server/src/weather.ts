/** Rain forecast from Open-Meteo (free, no API key). Used to skip irrigation before rain. */
import type { Weather } from "../../shared/api.ts";

export const NO_WEATHER: Weather = { source: "none", tempC: null, humidity: null, rainNowMm: null, rainProb12h: null, rainMm24h: null, updatedAt: null };

interface OpenMeteo {
  current?: { temperature_2m?: number; relative_humidity_2m?: number; precipitation?: number };
  hourly?: { precipitation_probability?: (number | null)[]; precipitation?: (number | null)[] };
}

export async function fetchWeather(lat: number, lon: number, now: number): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,precipitation&hourly=precipitation_probability,precipitation&forecast_hours=24&timezone=auto";
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const d = (await res.json()) as OpenMeteo;
  const prob = (d.hourly?.precipitation_probability ?? []).slice(0, 12).filter((x): x is number => x != null);
  const mm = (d.hourly?.precipitation ?? []).filter((x): x is number => x != null);
  return {
    source: "open-meteo",
    tempC: d.current?.temperature_2m ?? null,
    humidity: d.current?.relative_humidity_2m ?? null,
    rainNowMm: d.current?.precipitation ?? null,
    rainProb12h: prob.length ? Math.max(...prob) : null,
    rainMm24h: mm.length ? Math.round(mm.reduce((a, b) => a + b, 0) * 10) / 10 : null,
    updatedAt: now,
  };
}
