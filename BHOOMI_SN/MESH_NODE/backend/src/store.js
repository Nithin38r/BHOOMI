// In-memory digital-twin state + append-only JSONL log on disk.
// Every accepted packet is one line in data/packets.jsonl, so history survives a restart
// and can be opened in Excel/pandas later.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export class Store extends EventEmitter {
  constructor({ dataDir, historyPerNode = 500 }) {
    super();
    this.dataDir = dataDir;
    this.historyPerNode = historyPerNode;
    this.nodes = new Map();        // id -> { id, type, firstSeen, lastSeen, packets, last, history[] }
    this.recent = [];              // last 200 packets of any node
    this.seen = new Map();         // "id:n" -> time, drops duplicates heard via two routes
    this.total = 0;
    this.file = null;
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true });
      this.file = path.join(dataDir, 'packets.jsonl');
      this.#load();
    }
  }

  #load() {
    if (!fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    for (const l of lines.slice(-20000)) {
      try { this.#apply(JSON.parse(l), false); } catch { /* skip a damaged line */ }
    }
  }

  /**
   * Add a parsed packet. Returns the stored record, or null for a duplicate.
   * @param {{raw,type,id,n,fields}} pkt  from parseAM1
   * @param {{rssi?,snr?,hop?,via?,source?}} rx  how it arrived
   */
  add(pkt, rx = {}) {
    const key = pkt.n !== null ? `${pkt.id}:${pkt.n}` : null;
    const now = Date.now();
    if (key) {
      const t = this.seen.get(key);
      if (t && now - t < 30 * 60 * 1000) return null;   // same packet heard twice (mesh)
      this.seen.set(key, now);
      if (this.seen.size > 5000) for (const k of [...this.seen.keys()].slice(0, 1000)) this.seen.delete(k);
    }
    const rec = {
      ts: new Date(now).toISOString(),
      rxAt: now,
      id: pkt.id, type: pkt.type, n: pkt.n, fields: pkt.fields, raw: pkt.raw,
      rx: { rssi: rx.rssi ?? null, snr: rx.snr ?? null, hop: rx.hop ?? pkt.fields.HOP ?? null, via: rx.via ?? null, source: rx.source ?? 'unknown',
        ...(rx.simMinute !== undefined ? { simMinute: rx.simMinute } : {}),
        ...(Array.isArray(rx.path) ? { path: rx.path } : {}) },
    };
    this.#apply(rec, true);
    if (this.file) fs.appendFile(this.file, JSON.stringify(rec) + '\n', () => {});
    this.emit('packet', rec);
    return rec;
  }

  #apply(rec, live) {
    if (rec.type === 'ACK' || rec.type === 'CMD') {            // command traffic: kept in the log, not a node state
      this.recent.push(rec); if (this.recent.length > 200) this.recent.shift(); this.total += 1; return;
    }
    let node = this.nodes.get(rec.id);
    if (!node) {
      node = { id: rec.id, type: rec.type, firstSeen: rec.ts, lastSeen: rec.ts, packets: 0, last: null, history: [] };
      this.nodes.set(rec.id, node);
      if (live) this.emit('node', node);
    }
    node.type = rec.type;
    node.lastSeen = rec.ts;
    node.packets += 1;
    node.last = rec;
    node.history.push({ ts: rec.ts, n: rec.n, ...rec.fields, rssi: rec.rx?.rssi ?? null });
    if (node.history.length > this.historyPerNode) node.history.shift();
    this.recent.push(rec);
    if (this.recent.length > 200) this.recent.shift();
    this.total += 1;
  }

  summary(node) {
    const ageS = Math.round((Date.now() - Date.parse(node.lastSeen)) / 1000);
    return { id: node.id, type: node.type, firstSeen: node.firstSeen, lastSeen: node.lastSeen, ageS,
      packets: node.packets, n: node.last?.n ?? null, fields: node.last?.fields ?? {}, rx: node.last?.rx ?? {} };
  }
  list() { return [...this.nodes.values()].map((n) => this.summary(n)); }
  get(id) { return this.nodes.get(String(id).toUpperCase()) || null; }
}
