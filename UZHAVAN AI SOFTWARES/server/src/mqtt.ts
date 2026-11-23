/**
 * Built-in MQTT broker, so the hub gateway can talk to the server with no extra software.
 * Topic names match the BHOOMI twin backend, so it can use this same broker (MQTT_URL=mqtt://<this host>:1883).
 *   gateway → server : publish   bhoomi/<gatewayId>/up   (one AM1 packet per line, or JSON {raw, rssi})
 *   server → gateway : subscribe bhoomi/hub/down         (AM1 CMD packets; waiting ones are re-sent on subscribe)
 * If INGEST_TOKEN is set, gateways must use it as the MQTT password.
 */
import { createServer, type Server } from "node:net";
import { Aedes } from "aedes"; // aedes 1.2+: fixes GHSA-xxqp-5qx8-gj5q (crash on malformed packets)
import type { Hub } from "./hub.ts";

export const DOWN_TOPIC = process.env.MQTT_DOWN_TOPIC ?? "bhoomi/hub/down";
const UP_RE = /^bhoomi\/([A-Za-z0-9_-]{1,32})\/up$/;

export async function startMqtt(hub: Hub, port: number, token: string | null): Promise<Server> {
  const broker = await Aedes.createBroker();
  if (token) broker.authenticate = (_client, _user, password, done) => done(null, password?.toString() === token);

  broker.on("publish", (packet, client) => {
    if (!client) return; // our own publishes
    const m = UP_RE.exec(packet.topic);
    if (!m) return;
    const res = hub.ingestPayload(packet.payload.toString(), m[1], Date.now());
    for (const r of res.rejected) console.warn(`[mqtt] rejected from ${m[1]}: ${r.error} :: ${r.raw}`);
  });

  // A gateway that (re)connects gets every command still waiting for an ACK.
  broker.on("subscribe", (subs, client) => {
    if (!client || !subs.some(s => s.topic === DOWN_TOPIC)) return;
    for (const line of hub.pendingFor(null, Date.now()))
      broker.publish({ cmd: "publish", topic: DOWN_TOPIC, payload: Buffer.from(line), qos: 1, retain: false, dup: false }, () => {});
  });
  broker.on("client", c => console.log(`[mqtt] client connected: ${c.id}`));
  broker.on("clientDisconnect", c => console.log(`[mqtt] client disconnected: ${c.id}`));

  hub.publishDown = (_gateway, line) => {
    if (broker.connectedClients === 0) return false;
    broker.publish({ cmd: "publish", topic: DOWN_TOPIC, payload: Buffer.from(line), qos: 1, retain: false, dup: false }, () => {});
    return true;
  };

  const server = createServer(broker.handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}
