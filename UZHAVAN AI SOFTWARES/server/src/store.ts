/** SQLite persistence (Node's built-in node:sqlite, so no native build step). */
import { DatabaseSync } from "node:sqlite";
import type { Am1Packet, FieldValue } from "../../shared/am1.ts";
import { REPORT_EVERY_MIN } from "../../shared/am1.ts";
import type { Alert, AlertCode, Command, CommandStatus, Device, HistoryPoint, Message, Params, Settings, Severity, Spray } from "../../shared/api.ts";

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, zone TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_seq INTEGER,
  packets INTEGER NOT NULL DEFAULT 0, lost INTEGER NOT NULL DEFAULT 0,
  rssi INTEGER, gateway TEXT, latest TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, ts INTEGER NOT NULL, seq INTEGER,
  data TEXT NOT NULL, raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS readings_dev_ts ON readings(device_id, ts);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL,
  device_id TEXT, params TEXT NOT NULL, opened_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts(closed_at);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, cmd TEXT NOT NULL, val TEXT NOT NULL,
  source TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sprays (
  id INTEGER PRIMARY KEY, product TEXT NOT NULL, kind TEXT NOT NULL, phi_days REAL NOT NULL,
  half_life_days REAL NOT NULL, zone TEXT, sprayed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL, code TEXT NOT NULL, params TEXT NOT NULL,
  text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export const DEFAULT_SETTINGS: Settings = {
  farmName: "Demo farm · Surampalem",
  lat: 17.088, lon: 82.07,
  language: "te",
  autoIrrigate: true,
  dryBelow: 30,
  fullAt: 72,
  rainSkipProb: 60,
  doLow: 4,
  weatherOverride: null,
};

/** Packet types that are not devices of their own. */
const NOT_DEVICES = new Set(["CMD", "ACK", "CAL"]);
const TYPE_NAME: Record<string, string> = { SOIL: "Soil", POND: "Pond", PUMP: "Pump", TANK: "Tank", TRAP: "Trap cam", COLD: "Cold room" };

type Row = Record<string, unknown>;
const j = (s: unknown) => JSON.parse(String(s));

export class Store {
  db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  /* ---------------------------------------------------------------- devices */
  private toDevice(r: Row, now: number): Device {
    const latest = j(r.latest) as Record<string, FieldValue>;
    const every = (typeof latest.BV === "number" && latest.BV < 3.4) ? 60 : (REPORT_EVERY_MIN[String(r.type)] ?? 15);
    return {
      id: String(r.id), type: String(r.type), name: String(r.name), zone: r.zone == null ? null : String(r.zone),
      firstSeen: Number(r.first_seen), lastSeen: Number(r.last_seen), lastSeq: r.last_seq == null ? null : Number(r.last_seq),
      packets: Number(r.packets), lost: Number(r.lost), rssi: r.rssi == null ? null : Number(r.rssi),
      gateway: r.gateway == null ? null : String(r.gateway),
      online: now - Number(r.last_seen) <= (2 * every + 5) * 60_000,
      latest,
    };
  }

  listDevices(now: number): Device[] {
    return (this.db.prepare("SELECT * FROM devices ORDER BY type, first_seen").all() as Row[]).map(r => this.toDevice(r, now));
  }

  getDevice(id: string, now: number): Device | null {
    const r = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toDevice(r, now) : null;
  }

  /** Stores a packet; registers the device on its first packet. Returns null for non-device packets. */
  recordPacket(p: Am1Packet, ts: number, gateway: string | null, rssi: number | null): { device: Device; isNew: boolean } | null {
    if (NOT_DEVICES.has(p.type)) {
      this.db.prepare("INSERT INTO readings (device_id, ts, seq, data, raw) VALUES (?, ?, ?, ?, ?)").run(p.id, ts, p.seq, JSON.stringify(p.fields), p.raw);
      return null;
    }
    const data = { ...p.fields } as Record<string, FieldValue>;
    if (rssi != null) data.RSSI = rssi;
    const existing = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(p.id) as Row | undefined;
    let isNew = false;
    if (!existing) {
      isNew = true;
      const count = Number((this.db.prepare("SELECT COUNT(*) AS c FROM devices WHERE type = ?").get(p.type) as Row).c);
      const base = TYPE_NAME[p.type] ?? p.type;
      const name = p.type === "SOIL" ? `N${count + 1}` : count ? `${base} ${count + 1}` : base;
      this.db.prepare(`INSERT INTO devices (id, type, name, first_seen, last_seen, last_seq, packets, rssi, gateway, latest)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(p.id, p.type, name, ts, ts, p.seq, rssi, gateway, JSON.stringify(data));
    } else {
      const lastSeen = Number(existing.last_seen), lastSeq = existing.last_seq == null ? null : Number(existing.last_seq);
      let lost = 0;
      // A gap in sequence numbers means packets never arrived. A smaller N means the node rebooted.
      if (p.seq != null && lastSeq != null && p.seq > lastSeq + 1 && p.seq - lastSeq < 1000) lost = p.seq - lastSeq - 1;
      const newer = ts >= lastSeen;
      this.db.prepare(`UPDATE devices SET type = ?, last_seen = ?, last_seq = ?, packets = packets + 1, lost = lost + ?,
        rssi = ?, gateway = COALESCE(?, gateway), latest = ? WHERE id = ?`).run(
        p.type, newer ? ts : lastSeen, newer ? p.seq : lastSeq, lost,
        newer ? rssi : (existing.rssi as number | null), gateway,
        newer ? JSON.stringify({ ...j(existing.latest), ...data }) : String(existing.latest), p.id);
    }
    this.db.prepare("INSERT INTO readings (device_id, ts, seq, data, raw) VALUES (?, ?, ?, ?, ?)").run(p.id, ts, p.seq, JSON.stringify(data), p.raw);
    return { device: this.getDevice(p.id, ts)!, isNew };
  }

  updateDevice(id: string, patch: { name?: string; zone?: string | null }): void {
    if (patch.name !== undefined) this.db.prepare("UPDATE devices SET name = ? WHERE id = ?").run(patch.name, id);
    if (patch.zone !== undefined) this.db.prepare("UPDATE devices SET zone = ? WHERE id = ?").run(patch.zone, id);
  }

  history(id: string, since: number, maxPoints = 400): HistoryPoint[] {
    const rows = this.db.prepare("SELECT ts, data FROM readings WHERE device_id = ? AND ts >= ? ORDER BY ts").all(id, since) as Row[];
    const step = Math.max(1, Math.ceil(rows.length / maxPoints));
    const out: HistoryPoint[] = [];
    for (let i = 0; i < rows.length; i += step) out.push({ t: Number(rows[i].ts), v: j(rows[i].data) });
    return out;
  }

  rawLog(limit: number): { ts: number; deviceId: string; raw: string }[] {
    return (this.db.prepare("SELECT ts, device_id, raw FROM readings ORDER BY id DESC LIMIT ?").all(limit) as Row[])
      .map(r => ({ ts: Number(r.ts), deviceId: String(r.device_id), raw: String(r.raw) }));
  }

  /* ---------------------------------------------------------------- alerts */
  private toAlert(r: Row): Alert {
    return { id: Number(r.id), key: String(r.key), code: String(r.code) as AlertCode, severity: String(r.severity) as Severity,
      deviceId: r.device_id == null ? null : String(r.device_id), params: j(r.params), openedAt: Number(r.opened_at) };
  }
  openAlerts(): Alert[] {
    return (this.db.prepare("SELECT * FROM alerts WHERE closed_at IS NULL ORDER BY opened_at DESC").all() as Row[]).map(r => this.toAlert(r));
  }
  openAlert(a: Omit<Alert, "id">): void {
    this.db.prepare("INSERT INTO alerts (key, code, severity, device_id, params, opened_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(a.key, a.code, a.severity, a.deviceId, JSON.stringify(a.params), a.openedAt);
  }
  updateAlert(id: number, severity: Severity, params: Params): void {
    this.db.prepare("UPDATE alerts SET severity = ?, params = ? WHERE id = ?").run(severity, JSON.stringify(params), id);
  }
  closeAlert(id: number, at: number): void {
    this.db.prepare("UPDATE alerts SET closed_at = ? WHERE id = ?").run(at, id);
  }

  /* ---------------------------------------------------------------- commands */
  private toCommand(r: Row): Command {
    return { id: Number(r.id), deviceId: String(r.device_id), cmd: String(r.cmd), val: String(r.val),
      source: String(r.source) as Command["source"], reason: String(r.reason), status: String(r.status) as CommandStatus,
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) };
  }
  addCommand(c: Omit<Command, "id" | "status" | "updatedAt">): Command {
    const res = this.db.prepare("INSERT INTO commands (device_id, cmd, val, source, reason, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
      .run(c.deviceId, c.cmd, c.val, c.source, c.reason, c.createdAt, c.createdAt);
    return this.getCommand(Number(res.lastInsertRowid))!;
  }
  getCommand(id: number): Command | null {
    const r = this.db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toCommand(r) : null;
  }
  setCommandStatus(id: number, status: CommandStatus, at: number): Command | null {
    this.db.prepare("UPDATE commands SET status = ?, updated_at = ? WHERE id = ?").run(status, at, id);
    return this.getCommand(id);
  }
  recentCommands(limit = 30): Command[] {
    return (this.db.prepare("SELECT * FROM commands ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map(r => this.toCommand(r));
  }
  commandsWithStatus(statuses: CommandStatus[]): Command[] {
    const q = `SELECT * FROM commands WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY id`;
    return (this.db.prepare(q).all(...statuses) as Row[]).map(r => this.toCommand(r));
  }

  /* ---------------------------------------------------------------- sprays */
  addSpray(s: { product: string; kind: Spray["kind"]; phiDays: number; halfLifeDays: number; zone: string | null; sprayedAt: number }): void {
    this.db.prepare("INSERT INTO sprays (product, kind, phi_days, half_life_days, zone, sprayed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(s.product, s.kind, s.phiDays, s.halfLifeDays, s.zone, s.sprayedAt);
  }
  deleteSpray(id: number): void { this.db.prepare("DELETE FROM sprays WHERE id = ?").run(id); }
  sprayRows(): Omit<Spray, "modelDays" | "safeAt">[] {
    return (this.db.prepare("SELECT * FROM sprays ORDER BY sprayed_at DESC LIMIT 50").all() as Row[]).map(r => ({
      id: Number(r.id), product: String(r.product), kind: String(r.kind) as Spray["kind"], phiDays: Number(r.phi_days),
      halfLifeDays: Number(r.half_life_days), zone: r.zone == null ? null : String(r.zone), sprayedAt: Number(r.sprayed_at) }));
  }

  /* ---------------------------------------------------------------- messages (SMS outbox) */
  addMessage(m: Omit<Message, "id">): Message {
    const res = this.db.prepare("INSERT INTO messages (channel, code, params, text, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(m.channel, m.code, JSON.stringify(m.params), m.text, m.createdAt);
    return { ...m, id: Number(res.lastInsertRowid) };
  }
  messages(sinceId = 0, limit = 30): Message[] {
    return (this.db.prepare("SELECT * FROM messages WHERE id > ? ORDER BY id DESC LIMIT ?").all(sinceId, limit) as Row[]).map(r => ({
      id: Number(r.id), channel: "sms", code: String(r.code) as AlertCode, params: j(r.params), text: String(r.text), createdAt: Number(r.created_at) }));
  }

  /* ---------------------------------------------------------------- settings */
  settings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as Row[];
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) if (String(r.key) in DEFAULT_SETTINGS) s[String(r.key)] = j(r.value);
    return s as unknown as Settings;
  }
  saveSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v));
    return this.settings();
  }

  /** Wipes all farm data (used by the simulator's --reset). */
  reset(): void {
    this.db.exec("DELETE FROM devices; DELETE FROM readings; DELETE FROM alerts; DELETE FROM commands; DELETE FROM sprays; DELETE FROM messages;");
  }
}
