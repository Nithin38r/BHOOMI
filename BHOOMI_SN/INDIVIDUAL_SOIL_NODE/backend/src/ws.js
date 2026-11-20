// Minimal WebSocket server (RFC 6455) on Node's own http module: text frames, ping/pong, close.
// Enough for pushing packets to browsers without any npm dependency.
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

class Client {
  constructor(socket, onMessage, onClose) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.alive = true;
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.#read(onMessage); });
    socket.on('close', () => { this.alive = false; onClose(this); });
    socket.on('error', () => socket.destroy());
  }
  #read(onMessage) {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.socket.destroy(); return; }          // 1 MB cap
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((x, i) => x ^ mask[i % 4]));
      }
      this.buf = this.buf.subarray(need);
      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { this.socket.write(encodeFrame(payload.toString(), 0xA)); continue; }
      if (opcode === 0x1) { try { onMessage(this, JSON.parse(payload.toString())); } catch { /* ignore bad JSON */ } }
    }
  }
  send(obj) { if (this.alive) this.socket.write(encodeFrame(JSON.stringify(obj))); }
  close() { if (this.alive) { this.alive = false; try { this.socket.end(Buffer.from([0x88, 0])); } catch {} } }
}

export class WsHub {
  constructor() { this.clients = new Set(); this.onConnect = () => {}; this.onMessage = () => {}; }

  /** Attach to an http.Server; accepts upgrades on `path`. */
  attach(server, path = '/ws') {
    server.on('upgrade', (req, socket) => {
      const url = new URL(req.url, 'http://x');
      const key = req.headers['sec-websocket-key'];
      if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return;
      }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.setNoDelay(true);
      const c = new Client(socket, (cl, msg) => this.onMessage(cl, msg), (cl) => this.clients.delete(cl));
      this.clients.add(c);
      this.onConnect(c, url);
    });
    // keep idle connections open through proxies
    this.timer = setInterval(() => { for (const c of this.clients) if (c.alive) c.socket.write(encodeFrame('', 0x9)); }, 25000);
    this.timer.unref();
  }
  broadcast(obj) { for (const c of this.clients) c.send(obj); }
  get size() { return this.clients.size; }
}
