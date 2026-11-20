// Optional MQTT input. The hub ESP32 (or a LoRa gateway) publishes each received AM1 line to
//   bhoomi/<hubId>/up      payload: the raw AM1 line, or JSON {"raw":"AM1,...","rssi":-96,"snr":7.5}
// Install the client only if you use it:  npm install mqtt
export async function startMqtt({ url, upTopic, downTopic, ingest, log = console.log }) {
  if (!url) return null;
  let mqtt;
  try { mqtt = (await import('mqtt')).default; }
  catch { log('[mqtt] package not installed: run "npm install mqtt" in backend/ to enable MQTT'); return null; }

  const client = mqtt.connect(url, { reconnectPeriod: 3000, clientId: 'bhoomi-twin-' + Math.random().toString(16).slice(2, 8) });
  const state = { connected: false, url, upTopic, downTopic };
  client.on('connect', () => {
    state.connected = true;
    client.subscribe(upTopic, { qos: 0 });
    log(`[mqtt] connected to ${url}, listening on ${upTopic}`);
  });
  client.on('close', () => { state.connected = false; });
  client.on('error', (e) => log('[mqtt] ' + e.message));
  client.on('message', (topic, buf) => {
    const text = buf.toString().trim();
    let line = text, rx = {};
    if (text.startsWith('{')) {
      try { const j = JSON.parse(text); line = j.raw; rx = { rssi: j.rssi, snr: j.snr, hop: j.hop, via: j.via }; } catch { return; }
    }
    ingest(line, { ...rx, source: 'mqtt:' + topic });
  });
  state.publish = (line) => client.publish(downTopic, line);
  state.stop = () => client.end(true);
  return state;
}
