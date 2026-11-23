import { test } from "node:test";
import assert from "node:assert/strict";
import type { Device, Weather } from "../../shared/api.ts";
import { evaluate, safeHarvest } from "./rules.ts";
import { DEFAULT_SETTINGS, Store } from "./store.ts";
import { Hub } from "./hub.ts";

const NOW = 1_800_000_000_000;
const W0: Weather = { source: "none", tempC: null, humidity: null, rainNowMm: 0, rainProb12h: 10, rainMm24h: 0, updatedAt: null };
const dev = (id: string, type: string, latest: Device["latest"], extra: Partial<Device> = {}): Device => ({
  id, type, name: id, zone: null, firstSeen: NOW, lastSeen: NOW, lastSeq: 1, packets: 1, lost: 0, rssi: -80, gateway: "GW1", online: true, latest, ...extra,
});
const run = (devices: Device[], weather = W0, settings = DEFAULT_SETTINGS) =>
  evaluate({ now: NOW, devices, weather, settings, sprays: [], commands: [] });

test("dry soil + no rain → irrigate alert and pump ON", () => {
  const r = run([dev("N1", "SOIL", { M1: 22, M2: 40, AT: 31, AH: 60 }), dev("PUMP1", "PUMP", { RUN: 0 })]);
  assert.ok(r.alerts.some(a => a.code === "IRRIGATE_NOW"));
  assert.deepEqual(r.actions.map(a => [a.cmd, a.val]), [["PUMP", "ON"]]);
});

test("dry soil but rain forecast → postpone, no pump", () => {
  const r = run([dev("N1", "SOIL", { M1: 22, M2: 40 }), dev("PUMP1", "PUMP", { RUN: 0 })], { ...W0, rainProb12h: 85 });
  assert.ok(r.alerts.some(a => a.code === "IRRIGATION_SKIPPED_RAIN"));
  assert.equal(r.actions.length, 0);
});

test("pump running and root zone full → pump OFF", () => {
  const r = run([dev("N1", "SOIL", { M1: 70, M2: 75 }), dev("PUMP1", "PUMP", { RUN: 1, I: 7.1, RT: 40 })]);
  assert.deepEqual(r.actions.map(a => [a.cmd, a.val]), [["PUMP", "OFF"]]);
});

test("waterlogging is critical and sends SMS; tripped pump never auto-starts", () => {
  const r = run([dev("N1", "SOIL", { M1: 98, M2: 95 }), dev("N2", "SOIL", { M1: 20, M2: 30 }), dev("PUMP1", "PUMP", { RUN: 0, TRIP: 1, TR: "DRY" })]);
  const wl = r.alerts.find(a => a.code === "WATERLOGGING");
  assert.equal(wl?.severity, "crit");
  assert.equal(wl?.sms, true);
  assert.ok(r.alerts.some(a => a.code === "PUMP_TRIP"));
  assert.equal(r.actions.length, 0);
});

test("pond: low oxygen and aerator drawing no current", () => {
  const r = run([dev("POND1", "POND", { DO: 2.6, PH: 7.4, AER: 1, AERI: 0.0, FLT: 10 })]);
  assert.ok(r.alerts.some(a => a.code === "DO_CRIT" && a.sms));
  assert.ok(r.alerts.some(a => a.code === "AERATOR_FAULT"));
  assert.ok(!r.alerts.some(a => a.code === "POND_FAULT"), "FLT 10 is reported as AERATOR_FAULT, not twice");
});

test("pond tank prototype: a small air pump's current is not a fault", () => {
  const r = run([dev("POND1", "POND", { DO: 5.8, PH: 7.3, AER: 1, AERI: 0.25, FLT: 0 })]);
  assert.ok(!r.alerts.some(a => a.code === "AERATOR_FAULT"), "0.25 A is normal for the 5 V air pump; trust the firmware's FLT");
});

test("pond: unplugged DO probe (FLT 1, DO=0) is a probe fault, not a fish emergency", () => {
  const r = run([dev("POND1", "POND", { DO: 0, PH: 7.3, AER: 1, AERI: 0.3, FLT: 1 })]);
  assert.ok(r.alerts.some(a => a.code === "POND_FAULT" && a.params.flt === 1));
  assert.ok(!r.alerts.some(a => a.code === "DO_CRIT" || a.code === "DO_LOW"));
});

test("pond: aerator on but oxygen still falling (FLT 11) texts the farmer", () => {
  const r = run([dev("POND1", "POND", { DO: 3.6, PH: 7.3, AER: 1, AERI: 6.4, FLT: 11 })]);
  assert.ok(r.alerts.some(a => a.code === "POND_FAULT" && a.severity === "crit" && a.sms));
});

test("silent device → offline alert", () => {
  const r = run([dev("N1", "SOIL", { M1: 50 }, { online: false, lastSeen: NOW - 50 * 60_000 })]);
  const a = r.alerts.find(a => a.code === "NODE_OFFLINE");
  assert.equal(a?.params.min, 50);
});

test("safe-harvest timer never beats the label PHI, and cold soil slows breakdown", () => {
  const warm = safeHarvest(0, 7, 1, 25, 50);
  assert.equal(warm.safeAt, 7 * 86_400_000);
  const cold = safeHarvest(0, 1, 3, 15, 50);
  assert.ok(cold.modelDays > 3 * 3.32);
});

test("hub: ingest registers device, auto-commands pump in firmware format, ACK with OK=1 confirms it", () => {
  const hub = new Hub(new Store(":memory:"), "HUB001");
  let r = hub.ingestPayload("AM1,ID=P1A2B3,T=PUMP,N=1,RUN=0,I=0.0\nAM1,ID=7C9E1A,T=SOIL,N=1,M1=21.0,M2=35.0,AT=30,AH=60,BV=3.9", "GW1", NOW);
  assert.equal(r.accepted, 2);
  const cmds = hub.store.recentCommands();
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].val, "ON");
  assert.equal(cmds[0].source, "auto");
  assert.deepEqual(hub.pendingFor("GW1", NOW), [`AM1,ID=HUB001,T=CMD,N=${cmds[0].id},DST=P1A2B3,PUMP=ON,TS=${NOW / 1000}`]);
  r = hub.ingestPayload(`AM1,ID=P1A2B3,T=ACK,N=${cmds[0].id},OK=1,RUN=1`, "GW1", NOW + 1000);
  assert.equal(hub.store.getCommand(cmds[0].id)?.status, "acked");
  const soil = hub.store.getDevice("7C9E1A", NOW)!;
  assert.equal(soil.name, "N1");
  assert.equal(hub.store.listDevices(NOW).length, 2, "an ACK must not register a device");
  r = hub.ingestPayload("garbage\nAM1,ID=7C9E1A,T=SOIL,N=5,M1=40", "GW1", NOW + 2000);
  assert.equal(r.accepted, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(hub.store.getDevice("7C9E1A", NOW)!.lost, 3, "N jumped 1 → 5, so 3 packets were lost");
});

test("hub: pond command matches BhoomiPondNode v2.0; OK=0 marks it failed; bank→buoy ACKs are ignored", () => {
  const hub = new Hub(new Store(":memory:"), "HUB001");
  hub.ingestPayload("AM1,ID=7C9E2A,T=POND,N=1,DO=6.10,DOS=80,PH=7.30,WT=28.4,AER=0,AERI=0.00,BV=5.02,FLT=0", "GW1", NOW);
  const c = hub.command("7C9E2A", "AER", "ON", "farmer", "test", NOW);
  assert.match(hub.commandLine(c, NOW), /^AM1,ID=HUB001,T=CMD,N=\d+,DST=7C9E2A,AER=ON,TS=\d+$/);
  // The pond bank answers its buoy with T=ACK but no OK field; that must not confirm our command.
  hub.ingestPayload(`AM1,ID=7C9E2A,T=ACK,N=${c.id},AER=1,AERI=6.4,TS=0`, "GW1", NOW + 500);
  assert.equal(hub.store.getCommand(c.id)?.status, "pending");
  hub.ingestPayload(`AM1,ID=7C9E2A,T=ACK,N=${c.id},OK=0,MODE=AUTO,AER=0,ERR=AER`, "GW1", NOW + 1000);
  assert.equal(hub.store.getCommand(c.id)?.status, "failed");
  assert.throws(() => hub.command("7C9E2A", "PUMP", "ON", "farmer", "test", NOW), /not allowed/);
});

test("hub: the same packet heard over two mesh routes is stored once", () => {
  const hub = new Hub(new Store(":memory:"), "HUB001");
  const line = "AM1,ID=3F21A0,T=SOIL,N=88,M1=50,M2=60,ST=27,AT=30,AH=60,LW=0,LX=70,EC=NA,PH=NA,NPK=NA,BV=3.9,HOP=1";
  const r = hub.ingestPayload(`${line}\n${line}`, "GW1", NOW);
  assert.equal(r.accepted, 1);
  assert.equal(r.duplicates, 1);
  assert.equal(hub.store.getDevice("3F21A0", NOW)!.packets, 1);
  assert.equal(hub.store.getDevice("3F21A0", NOW)!.latest.NPK, null, "NPK=NA is a missing value, not text");
});
