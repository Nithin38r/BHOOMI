// Optional USB-serial input: plug the hub ESP32 into the laptop running the backend.
// Any printed line that contains "AM1," is taken as a packet; "RSSI -96" / "SNR 7.5" on the
// same line are picked up too. Install only if you use it:  npm install serialport
export async function startSerial({ port, baud = 115200, ingest, log = console.log }) {
  if (!port) return null;
  let SerialPort;
  try { ({ SerialPort } = await import('serialport')); }
  catch { log('[serial] package not installed: run "npm install serialport" in backend/ to enable USB serial'); return null; }

  const sp = new SerialPort({ path: port, baudRate: baud });
  const state = { port, baud, open: false };
  let buf = '';
  sp.on('open', () => { state.open = true; log(`[serial] reading ${port} @ ${baud}`); });
  sp.on('close', () => { state.open = false; });
  sp.on('error', (e) => log('[serial] ' + e.message));
  sp.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.includes('AM1,')) continue;
      const rssi = /RSSI[:= ]+(-?\d+)/i.exec(line); const snr = /SNR[:= ]+(-?[\d.]+)/i.exec(line);
      ingest(line, { rssi: rssi ? Number(rssi[1]) : null, snr: snr ? Number(snr[1]) : null, source: 'serial:' + port });
    }
    if (buf.length > 4096) buf = '';
  });
  state.write = (line) => sp.write(line + '\n');
  state.stop = () => sp.close();
  return state;
}
