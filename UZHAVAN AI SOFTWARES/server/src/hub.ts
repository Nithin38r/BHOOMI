/**
 * The hub: everything that happens when a packet arrives or a farmer taps a button.
 * ingest → store → rules → alerts / SMS / automatic commands → live events to every open dashboard.
 */
import { Am1Error, encodeAm1, parseAm1 } from "../../shared/am1.ts";
import { alertText } from "../../shared/alerts-i18n.ts";
import type { Command, Device, LiveEvent, Settings, Spray, State, Weather } from "../../shared/api.ts";
import { evaluate, safeHarvest, soilMeans, type Candidate } from "./rules.ts";
import type { Store } from "./store.ts";
import { NO_WEATHER } from "./weather.ts";

/**
 * Commands the app may send, and which device types accept them. Each becomes one KEY=VALUE field in the
 * firmware's command packet, e.g. AER=ON, STATUS=?, CAL=? (pond firmware v2.0) or PUMP=ON (pump switch).
 */
export const ALLOWED_COMMANDS: Record<string, { types: string[]; vals: string[] }> = {
  AER: { types: ["POND"], vals: ["ON", "OFF", "AUTO"] },
  STATUS: { types: ["POND", "PUMP", "TANK"], vals: ["?"] },
  CAL: { types: ["POND"], vals: ["?"] },
  PUMP: { types: ["PUMP"], vals: ["ON", "OFF"] },
  VALVE1: { types: ["TANK"], vals: ["OPEN", "CLOSE"] },
  VALVE2: { types: ["TANK"], vals: ["OPEN", "CLOSE"] },
  VALVE3: { types: ["TANK"], vals: ["OPEN", "CLOSE"] },
};
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_BACKDATE_MS = 7 * 86_400_000;
/** The mesh can deliver the same packet over two routes; the same ID and N within this window is a repeat. */
const DUPLICATE_WINDOW_MS = 30 * 60_000;

export interface IngestMeta { gateway: string | null; rssi?: number | null; ts?: number | null }
export interface IngestResult { accepted: number; duplicates: number; rejected: { raw: string; error: string }[] }

export class Hub {
  store: Store;
  /** The hub's own AM1 ID, sent as ID= on every command (firmware replies to DST=<its own ID>). */
  hubId: string;
  private seen = new Map<string, number>();
  weatherBase: Weather = NO_WEATHER;
  /** Set by the MQTT module; returns true if the command line was published. */
  publishDown: ((gateway: string | null, line: string) => boolean) | null = null;
  private listeners = new Set<(e: LiveEvent) => void>();
  /** While a gateway is uploading buffered history, devices look "silent"; the periodic check waits. */
  private backfillUntil = 0;

  constructor(store: Store, hubId = "HUB001") { this.store = store; this.hubId = hubId; }

  on(fn: (e: LiveEvent) => void) { this.listeners.add(fn); }
  off(fn: (e: LiveEvent) => void) { this.listeners.delete(fn); }
  private emit(e: LiveEvent) { for (const fn of this.listeners) { try { fn(e); } catch { /* a closed stream must not break the hub */ } } }

  /* ---------------------------------------------------------------- state */
  weather(): Weather {
    const o = this.store.settings().weatherOverride;
    return o ? { ...this.weatherBase, ...o, source: "override", updatedAt: this.weatherBase.updatedAt } : this.weatherBase;
  }

  sprays(now: number, devices?: Device[]): Spray[] {
    const { t, m } = soilMeans(devices ?? this.store.listDevices(now));
    return this.store.sprayRows().map(s => ({ ...s, ...safeHarvest(s.sprayedAt, s.phiDays, s.halfLifeDays, t, m) }));
  }

  state(now: number): State {
    const devices = this.store.listDevices(now);
    return {
      now, devices, alerts: this.store.openAlerts(), commands: this.store.recentCommands(), sprays: this.sprays(now, devices),
      messages: this.store.messages(0, 30), weather: this.weather(), settings: this.store.settings(),
    };
  }

  /* ---------------------------------------------------------------- ingest */
  /** Accepts plain text (one AM1 packet per line) or JSON ({raw} / {packets:[{raw, rssi, ts}]}). */
  ingestPayload(body: unknown, gateway: string | null, now: number): IngestResult {
    const items: { raw: string; rssi?: number | null; ts?: number | null }[] = [];
    if (typeof body === "string") {
      const t = body.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try { return this.ingestPayload(JSON.parse(t), gateway, now); } catch { return { accepted: 0, duplicates: 0, rejected: [{ raw: t.slice(0, 80), error: "invalid JSON" }] }; }
      }
      for (const line of t.split(/\r?\n/)) if (line.trim()) items.push({ raw: line });
    } else if (Array.isArray(body)) {
      for (const x of body) items.push(typeof x === "string" ? { raw: x } : x);
    } else if (body && typeof body === "object") {
      const o = body as { raw?: string; packets?: unknown[]; gw?: string; rssi?: number; ts?: number };
      if (o.gw) gateway = String(o.gw);
      if (Array.isArray(o.packets)) for (const x of o.packets) items.push(typeof x === "string" ? { raw: x } : (x as { raw: string }));
      else if (typeof o.raw === "string") items.push({ raw: o.raw, rssi: o.rssi, ts: o.ts });
    }
    const res: IngestResult = { accepted: 0, duplicates: 0, rejected: [] };
    let live = false;
    for (const it of items) {
      try {
        if (this.ingestOne(String(it.raw), { gateway, rssi: it.rssi, ts: it.ts }, now) === "duplicate") { res.duplicates++; continue; }
        res.accepted++;
        if (it.ts == null || now - it.ts < 10 * 60_000) live = true;
      } catch (e) { res.rejected.push({ raw: String(it.raw).slice(0, 120), error: e instanceof Error ? e.message : String(e) }); }
    }
    // Old buffered readings update history but must not fire alerts or SMS as if they were happening now.
    if (live) this.evaluate(now);
    else if (res.accepted) this.backfillUntil = now + 30_000;
    return res;
  }

  ingestOne(raw: string, meta: IngestMeta, now: number): "ok" | "duplicate" {
    const p = parseAm1(raw);
    if (p.id === this.hubId) return "duplicate"; // our own command heard back through a relay
    // ACKs skip this filter: they are safe to apply twice, and their N is a command number that can match another ACK's.
    if (p.seq != null && p.type !== "CMD" && p.type !== "ACK") {
      const key = `${p.id}:${p.type}:${p.seq}`, at = this.seen.get(key);
      if (at != null && now - at < DUPLICATE_WINDOW_MS) return "duplicate";
      this.seen.set(key, now);
      if (this.seen.size > 20_000) for (const [k, t] of this.seen) if (now - t > DUPLICATE_WINDOW_MS) this.seen.delete(k);
    }
    // Gateways buffer readings while offline and upload them later with their original time.
    let ts = now;
    if (meta.ts != null) {
      if (!(Number.isFinite(meta.ts) && meta.ts <= now + 60_000 && meta.ts >= now - MAX_BACKDATE_MS)) throw new Am1Error("ts must be epoch ms within the last 7 days");
      ts = meta.ts;
    }
    const rssi = typeof p.fields.RSSI === "number" ? p.fields.RSSI : (meta.rssi ?? null);

    // Firmware reply to a command: AM1,ID=<node>,T=ACK,N=<command N>,OK=1|0,...
    // Only ACKs with OK= answer us; the pond bank's ACKs to its buoy carry no OK field.
    if (p.type === "ACK" && p.seq != null && "OK" in p.fields) {
      const c = this.store.getCommand(p.seq);
      if (c && c.deviceId === p.id && (c.status === "pending" || c.status === "sent" || c.status === "failed")) {
        const upd = this.store.setCommandStatus(c.id, p.fields.OK === 1 ? "acked" : "failed", now);
        if (upd) this.emit({ type: "command", command: upd });
      }
    }
    const r = this.store.recordPacket(p, ts, meta.gateway, rssi);
    if (r) {
      if (r.isNew) console.log(`[hub] new device registered: ${r.device.name} (${p.id}, ${p.type})`);
      this.emit({ type: "device", device: r.device });
    }
    return "ok";
  }

  /* ---------------------------------------------------------------- rules → alerts, SMS, auto commands */
  evaluate(now: number): void {
    const devices = this.store.listDevices(now);
    const sprays = this.sprays(now, devices);
    const settings = this.store.settings();
    const commands = this.store.recentCommands(50);
    const { alerts, actions } = evaluate({ now, devices, weather: this.weather(), settings, sprays, commands });

    const open = new Map(this.store.openAlerts().map(a => [a.key, a]));
    let changed = false;
    for (const c of alerts) {
      const ex = open.get(c.key);
      if (!ex) {
        this.store.openAlert({ key: c.key, code: c.code, severity: c.severity, deviceId: c.deviceId, params: c.params, openedAt: now });
        if (c.sms) this.sms(c, settings, now);
        changed = true;
      } else {
        if (ex.severity !== c.severity || ex.code !== c.code || JSON.stringify(ex.params) !== JSON.stringify(c.params)) {
          if (ex.code !== c.code) { this.store.closeAlert(ex.id, now); this.store.openAlert({ ...c, openedAt: now }); if (c.sms) this.sms(c, settings, now); }
          else {
            this.store.updateAlert(ex.id, c.severity, c.params);
            if (c.sms && ex.severity !== "crit" && c.severity === "crit") this.sms(c, settings, now);
          }
          changed = true;
        }
        open.delete(c.key);
      }
    }
    for (const a of open.values()) { this.store.closeAlert(a.id, now); changed = true; }
    if (changed) this.emit({ type: "alerts", alerts: this.store.openAlerts() });

    for (const a of actions) this.autoCommand(a.deviceId, a.cmd, a.val, a.reason, now, commands);
  }

  private sms(c: Candidate, settings: Settings, now: number) {
    const t = alertText(c.code, c.params, settings.language);
    const m = this.store.addMessage({ channel: "sms", code: c.code, params: c.params, text: `BHOOMI: ${t.title}. ${t.detail}`, createdAt: now });
    console.log(`[sms] ${m.text}`);
    this.emit({ type: "message", message: m });
  }

  private autoCommand(deviceId: string, cmd: string, val: string, reason: string, now: number, recent: Command[]) {
    const mine = recent.filter(c => c.deviceId === deviceId && c.cmd === cmd);
    if (mine.some(c => c.status === "pending" || c.status === "sent")) return;            // one at a time
    if (mine.some(c => c.source === "farmer" && now - c.createdAt < 30 * 60_000)) return;  // the farmer's tap wins for 30 min
    if (mine.some(c => c.val === val && c.status !== "failed" && now - c.createdAt < 10 * 60_000)) return; // no repeats
    this.command(deviceId, cmd, val, "auto", reason, now);
  }

  /* ---------------------------------------------------------------- commands down to devices */
  command(deviceId: string, cmd: string, val: string, source: Command["source"], reason: string, now: number): Command {
    const dev = this.store.getDevice(deviceId, now);
    const rule = ALLOWED_COMMANDS[cmd];
    if (!dev) throw new Error(`unknown device ${deviceId}`);
    if (!rule || !rule.types.includes(dev.type) || !rule.vals.includes(val)) throw new Error(`${cmd}=${val} is not allowed for a ${dev.type} device`);
    let c = this.store.addCommand({ deviceId, cmd, val, source, reason, createdAt: now });
    console.log(`[cmd] #${c.id} ${dev.name} ${cmd}=${val} (${source}: ${reason})`);
    if (this.publishDown?.(dev.gateway, this.commandLine(c, now))) c = this.store.setCommandStatus(c.id, "sent", now)!;
    this.emit({ type: "command", command: c });
    return c;
  }

  /**
   * Firmware command format: AM1,ID=<hub>,T=CMD,N=<n>,DST=<node>,AER=ON,TS=<unix s>.
   * TS sets the node's clock, which its night-time aerator failsafe needs.
   */
  commandLine(c: Command, now: number): string {
    return encodeAm1(this.hubId, "CMD", c.id, { DST: c.deviceId, [c.cmd]: c.val, TS: Math.floor(now / 1000) });
  }

  /** For gateways that poll over HTTP instead of MQTT. */
  pendingFor(gateway: string | null, now: number): string[] {
    const out: string[] = [];
    for (const c of this.store.commandsWithStatus(["pending", "sent"])) {
      const dev = this.store.getDevice(c.deviceId, now);
      if (gateway && dev?.gateway && dev.gateway !== gateway) continue;
      out.push(this.commandLine(c, now));
      if (c.status === "pending") { const u = this.store.setCommandStatus(c.id, "sent", now); if (u) this.emit({ type: "command", command: u }); }
    }
    return out;
  }

  /** Runs every few seconds: expires unconfirmed commands and re-checks rules (devices going quiet, timers). */
  tick(now: number): void {
    for (const c of this.store.commandsWithStatus(["pending", "sent"])) {
      if (now - c.createdAt > COMMAND_TIMEOUT_MS) {
        const u = this.store.setCommandStatus(c.id, "failed", now);
        if (u) { console.log(`[cmd] #${c.id} not confirmed in time`); this.emit({ type: "command", command: u }); }
      }
    }
    if (now >= this.backfillUntil) this.evaluate(now);
  }

  /* ---------------------------------------------------------------- sprays, settings, weather */
  addSpray(s: { product: string; kind: Spray["kind"]; phiDays: number; halfLifeDays: number; zone: string | null; sprayedAt: number }, now: number) {
    this.store.addSpray(s);
    this.emit({ type: "sprays", sprays: this.sprays(now) });
    this.evaluate(now);
  }
  deleteSpray(id: number, now: number) {
    this.store.deleteSpray(id);
    this.emit({ type: "sprays", sprays: this.sprays(now) });
    this.evaluate(now);
  }
  saveSettings(patch: Partial<Settings>, now: number): Settings {
    const s = this.store.saveSettings(patch);
    this.emit({ type: "settings", settings: s });
    if ("weatherOverride" in patch) this.emit({ type: "weather", weather: this.weather() });
    this.evaluate(now);
    return s;
  }
  setWeather(w: Weather, now: number) {
    this.weatherBase = w;
    this.emit({ type: "weather", weather: this.weather() });
    this.evaluate(now);
  }
  renameDevice(id: string, patch: { name?: string; zone?: string | null }, now: number) {
    this.store.updateDevice(id, patch);
    const d = this.store.getDevice(id, now);
    if (d) this.emit({ type: "device", device: d });
    return d;
  }
}
