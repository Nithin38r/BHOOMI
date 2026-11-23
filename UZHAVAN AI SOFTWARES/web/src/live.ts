/** Live connection to the hub: load the full state once, then apply events from /api/stream. */
import { useCallback, useEffect, useRef, useState } from "react";
import { REPORT_EVERY_MIN } from "../../shared/am1.ts";
import type { Command, Device, HistoryPoint, LiveEvent, Settings, State } from "../../shared/api.ts";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  command: (deviceId: string, cmd: string, val: string) => json<Command>("/api/commands", { method: "POST", body: JSON.stringify({ deviceId, cmd, val }) }),
  settings: (patch: Partial<Settings>) => json<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  history: (id: string, hours = 24) => json<HistoryPoint[]>(`/api/devices/${encodeURIComponent(id)}/history?hours=${hours}`),
  rename: (id: string, name: string) => json<Device>(`/api/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  addSpray: (s: { product: string; kind: string; phiDays: number; halfLifeDays: number }) => json("/api/sprays", { method: "POST", body: JSON.stringify(s) }),
  deleteSpray: (id: number) => json(`/api/sprays/${id}`, { method: "DELETE" }),
  log: () => json<{ ts: number; deviceId: string; raw: string }[]>("/api/log"),
};

/** A device is "online" if it reported within two of its intervals (+5 min). Recomputed on the client clock. */
export function isOnline(d: Device, now: number): boolean {
  const every = typeof d.latest.BV === "number" && d.latest.BV < 3.4 ? 60 : (REPORT_EVERY_MIN[d.type] ?? 15);
  return now - d.lastSeen <= (2 * every + 5) * 60_000;
}

export function useLive() {
  const [state, setState] = useState<State | null>(null);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    try { setState(await json<State>("/api/state")); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    void load();
    const es = new EventSource("/api/stream");
    esRef.current = es;
    let dropped = false;
    es.onopen = () => { setConnected(true); if (dropped) { dropped = false; void load(); } };
    es.onerror = () => { setConnected(false); dropped = true; };
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as LiveEvent;
      setState(s => (s ? apply(s, e) : s));
    };
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { es.close(); clearInterval(tick); };
  }, [load]);

  return { state, connected, now, error, reload: load };
}

function apply(s: State, e: LiveEvent): State {
  switch (e.type) {
    case "device": {
      const i = s.devices.findIndex(d => d.id === e.device.id);
      const devices = i >= 0 ? s.devices.map(d => (d.id === e.device.id ? e.device : d)) : [...s.devices, e.device];
      return { ...s, devices };
    }
    case "alerts": return { ...s, alerts: e.alerts };
    case "command": {
      const rest = s.commands.filter(c => c.id !== e.command.id);
      return { ...s, commands: [e.command, ...rest].sort((a, b) => b.id - a.id).slice(0, 30) };
    }
    case "message": return { ...s, messages: [e.message, ...s.messages].slice(0, 30) };
    case "sprays": return { ...s, sprays: e.sprays };
    case "weather": return { ...s, weather: e.weather };
    case "settings": return { ...s, settings: e.settings };
  }
}
