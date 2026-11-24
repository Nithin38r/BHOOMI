/*
  ============================================================================
  BHOOMI Hub  —  firmware v3.0  (production)
  ============================================================================
  Board  : ESP32 38-pin DevKit ("ESP32 Dev Module"), powered from USB / 5 V
  Radio  : SX1278 / Ra-02, 433.5 MHz, SF9, BW125, CR4/5, sync 0x12, CRC on
           (same wiring as the soil node: NSS 5, SCK 18, MISO 19, MOSI 23, RST 14, DIO0 26)
  Libs   : "LoRa" (Sandeep Mistry). With USE_MQTT 1 also "PubSubClient" (Nick O'Leary).

  What the hub does:
    1. Listens all the time. ACKs every node packet within ~40 ms and sends
       settings back in the ACK:  ACK,<ID>,<N>,HUB,DRY=<crop start %>,INT=<min>[,Z=<zone>]
    2. Drops duplicates (same packet direct + through a relay).
    3. Keeps a table of every node: last values, battery, signal, hops, packet loss.
    4. Runs the UZHAVAN AI field rules and prints/publishes ALERT and CLEAR events:
         soil : DRY, VDRY, WET (waterlogged ≥ 2 h), HEAT, FUNGAL, COLD, BATLOW,
                SENSOR (same sensor NA 3 times), SILENT (node stopped reporting)
         pond : DOCRIT (DO < 3), DOLOW (DO < 4 and aerator off), PHBAD, WTHOT, FAULT n
    5. Decides irrigation per zone from the crop table (start / stop moisture),
       with rain skip, 45-min cap, 10-min minimum off-time and a stale-data
       failsafe. Drives a pump relay + one valve relay per zone when
       IRRIGATION_OUTPUTS is 1 (otherwise it only prints the decisions).
    6. Sends commands to pond nodes (aerator ON/OFF/AUTO, thresholds, clock sync)
       with retries and reports their T=ACK. Syncs pond clocks every 6 h.
    7. Talks to the UZHAVAN AI software:
         USB serial lines (115200):  RX <AM1 packet> | RSSI=-97 SNR=7.25
                                     ALERT,ID=..,CODE=..,SEV=..,MSG=..
                                     CLEAR,ID=..,CODE=..
                                     IRR,Z=..,ACT=START|STOP,AVG=..,WHY=..
                                     CMDACK,ID=..,N=..,OK=..   / CMDFAIL,ID=..,N=..
         MQTT (USE_MQTT 1): bhoomi/<farm>/node/<ID>/raw, .../data (JSON),
                            bhoomi/<farm>/alert, bhoomi/<farm>/irrigation,
                            bhoomi/<farm>/hub/status (retained, LWT offline),
                            subscribes bhoomi/<farm>/cmd/<ID>  e.g. {"AER":"ON"}

  Serial commands (type in the Serial Monitor, newline ending):
    help · nodes · zones · crops
    crop <zone> <rice|wheat|tomato|onion|orange|grape>
    zone <nodeID> <zone>          assign a node to a zone (sent to it in the next ACK)
    int <minutes>                 report interval for all soil nodes (1–240)
    irr auto | irr off            automatic irrigation on/off
    irr <zone> start | stop       manual start/stop for one zone
    cmd <nodeID> KEY=VAL[,KEY=VAL] LoRa command, e.g.  cmd A1B2C3 AER=ON
    time <unix seconds>           set hub clock (for pond clock sync without Wi-Fi)
  ============================================================================
*/

#include <SPI.h>
#include <LoRa.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>

// ============================== OPTIONS ==============================
#define USE_MQTT             0       // 1 = Wi-Fi + MQTT to the UZHAVAN AI software
#define IRRIGATION_OUTPUTS   0       // 1 = drive pump + valve relays from this hub
#define RELAY_ACTIVE_LOW     1       // most relay modules switch ON with a LOW input

#if USE_MQTT
  #include <WiFi.h>
  #include <PubSubClient.h>
  const char* WIFI_SSID   = "your-wifi";
  const char* WIFI_PASS   = "your-password";
  const char* MQTT_HOST   = "192.168.1.10";
  const uint16_t MQTT_PORT = 1883;
#endif
const char* FARM = "farm1";

// ============================== RADIO ==============================
#define LORA_FREQ  433500000L
#define LORA_SF    9
#define LORA_BW    125E3
#define LORA_CR    5
#define LORA_SYNC  0x12
#define LORA_TX_DBM 10
#define PIN_LORA_SCK  18
#define PIN_LORA_MISO 19
#define PIN_LORA_MOSI 23
#define PIN_LORA_NSS   5
#define PIN_LORA_RST  14
#define PIN_LORA_DIO0 26
#define PIN_LED        2

// ============================== IRRIGATION OUTPUTS ==============================
#define NUM_ZONES 3
#define PIN_PUMP  27
const int PIN_VALVE[NUM_ZONES] = {32, 33, 25};
#define IRR_MAX_RUN_MIN   45
#define IRR_MIN_OFF_MIN   10
#define RAIN_LW           70.0f

// ============================== RULE CONSTANTS (05_UZHAVAN_AI_RULES) ==============================
#define WET_M1        88.0f
#define WET_M2        80.0f
#define WET_HOURS     2.0f
#define HEAT_C        38.0f
#define COLD_C        12.0f
#define FUNGAL_HOURS  6.0f
#define LOWBATT_V     3.40f
#define LOWBATT_INT_MIN 60
#define DO_CRIT       3.0f
#define DO_LOW        4.0f
#define PH_MIN        6.5f
#define PH_MAX        9.0f
#define WT_HOT        33.0f
#define POND_SILENT_MIN 35

// ============================== CROPS (FAO 29 + BHOOMI thresholds) ==============================
struct Crop { const char* name; float start, stop, ec100, ec90; };
const Crop CROPS[] = {
  {"rice",   50, 80, 2.0, 2.6}, {"wheat",  30, 70, 4.0, 4.9}, {"tomato", 35, 72, 1.7, 2.3},
  {"onion",  38, 72, 0.8, 1.2}, {"orange", 28, 68, 1.1, 1.6}, {"grape",  26, 66, 1.0, 1.7},
};
const int NUM_CROPS = sizeof(CROPS) / sizeof(CROPS[0]);

// ============================== ALERT CODES ==============================
enum { A_DRY, A_VDRY, A_WET, A_HEAT, A_FUNGAL, A_COLD, A_BATLOW, A_SENSOR, A_SILENT,
       A_DOCRIT, A_DOLOW, A_PHBAD, A_WTHOT, A_FAULT, A_COUNT };
const char* A_NAME[A_COUNT] = {"DRY","VDRY","WET","HEAT","FUNGAL","COLD","BATLOW","SENSOR","SILENT",
                               "DOCRIT","DOLOW","PHBAD","WTHOT","FAULT"};
const char* A_SEV[A_COUNT]  = {"warn","high","warn","warn","warn","info","info","info","warn",
                               "critical","high","warn","info","high"};

// ============================== NODE TABLE ==============================
#define MAX_NODES 32
struct Node {
  bool used;
  char id[7];
  char type;                // 'S' soil, 'P' pond
  uint8_t zone;
  uint32_t lastSeenMs, firstN, lastN, rx, missed;
  int rssi; float snr; uint8_t hop;
  float m1, m2, st, at, ah, lw, lx, bv, lwh;       // soil
  float dO, ph, wt; int aer, flt;                  // pond
  uint8_t dryRun, naRun;
  uint32_t wetSinceMs;
  uint32_t alerts;          // active alert bits
  uint32_t tsSyncMs;        // pond clock last synced
};
Node nodes[MAX_NODES];

// ============================== ZONES ==============================
struct Zone { uint8_t crop; bool running; uint32_t startMs, stopMs; bool manual; };
Zone zones[NUM_ZONES];
uint16_t reportMin = 15;
bool irrAuto = true;

// ============================== COMMAND QUEUE (hub -> pond / any node) ==============================
struct Cmd { bool active; char dst[7]; String body; uint32_t n; uint8_t tries; uint32_t nextMs; };
#define MAX_CMDS 6
Cmd cmds[MAX_CMDS];
uint32_t cmdN = 1;
String hubId;

Preferences prefs;
uint32_t dupCache[64]; int dupIdx = 0;
uint32_t rxOk = 0, rxDup = 0;

#if USE_MQTT
WiFiClient wifi;
PubSubClient mqtt(wifi);
#endif

// ============================== HELPERS ==============================
String field(const String& m, const char* key) {
  String k = String(",") + key + "=";
  int a = m.indexOf(k); if (a < 0) return "";
  a += k.length(); int b = m.indexOf(',', a); if (b < 0) b = m.length();
  return m.substring(a, b);
}
float fval(const String& m, const char* key) {
  String v = field(m, key);
  if (v.length() == 0 || v == "NA") return NAN;
  return v.toFloat();
}
String f1(float v) { return isnan(v) ? String("null") : String(v, 2); }
uint32_t keyOf(const String& id, const String& n) { uint32_t h = 2166136261u; for (unsigned i = 0; i < id.length(); i++) { h ^= (uint8_t)id[i]; h *= 16777619u; } return h ^ (uint32_t)(n.toInt() * 2654435761u); }
bool isDup(uint32_t k) { for (int i = 0; i < 64; i++) if (dupCache[i] == k) return true; dupCache[dupIdx] = k; dupIdx = (dupIdx + 1) % 64; return false; }
float minutesSince(uint32_t ms) { return (millis() - ms) / 60000.0f; }
bool clockValid() { return time(nullptr) > 1700000000; }

void publish(const String& topic, const String& payload, bool retain = false) {
#if USE_MQTT
  if (mqtt.connected()) mqtt.publish(topic.c_str(), payload.c_str(), retain);
#endif
}
String topicBase() { return String("bhoomi/") + FARM; }

Node* findNode(const String& id, bool create) {
  for (int i = 0; i < MAX_NODES; i++) if (nodes[i].used && id == nodes[i].id) return &nodes[i];
  if (!create) return nullptr;
  for (int i = 0; i < MAX_NODES; i++) if (!nodes[i].used) {
    Node& n = nodes[i]; memset(&n, 0, sizeof(Node)); n.used = true;
    strncpy(n.id, id.c_str(), 6); n.id[6] = 0;
    n.m1 = n.m2 = n.st = n.at = n.ah = n.lw = n.lx = n.bv = n.lwh = NAN;
    n.dO = n.ph = n.wt = NAN; n.aer = -1; n.flt = 0;
    return &n;
  }
  return nullptr;
}
// Zone assignment saved by the "zone" command (0 = none, use what the node reports)
uint8_t savedZone(const char* id) {
  prefs.begin("bhoomi", true); uint8_t z = prefs.getUChar((String("z_") + id).c_str(), 0); prefs.end(); return z;
}
const Crop& cropOfZone(uint8_t z) { if (z < 1 || z > NUM_ZONES) z = 1; return CROPS[zones[z - 1].crop]; }
uint16_t expectedMin(const Node& n) {
  if (n.type == 'P') return POND_SILENT_MIN;
  return (!isnan(n.bv) && n.bv < LOWBATT_V) ? LOWBATT_INT_MIN : reportMin;
}
bool fresh(const Node& n) { return minutesSince(n.lastSeenMs) <= 2.0f * expectedMin(n) + 2; }

// ============================== ALERTS ==============================
void setAlert(Node& n, int code, bool on, const String& msg) {
  uint32_t bit = 1UL << code;
  bool was = n.alerts & bit;
  if (on == was) return;
  if (on) {
    n.alerts |= bit;
    String line = String("ALERT,ID=") + n.id + ",CODE=" + A_NAME[code] + ",SEV=" + A_SEV[code] + ",Z=" + n.zone + ",MSG=" + msg;
    Serial.println(line);
    publish(topicBase() + "/alert", String("{\"id\":\"") + n.id + "\",\"code\":\"" + A_NAME[code] + "\",\"sev\":\"" + A_SEV[code] +
            "\",\"zone\":" + n.zone + ",\"active\":true,\"msg\":\"" + msg + "\"}");
  } else {
    n.alerts &= ~bit;
    Serial.println(String("CLEAR,ID=") + n.id + ",CODE=" + A_NAME[code]);
    publish(topicBase() + "/alert", String("{\"id\":\"") + n.id + "\",\"code\":\"" + A_NAME[code] + "\",\"active\":false}");
  }
}

void soilRules(Node& n) {
  const Crop& c = cropOfZone(n.zone);
  bool dryNow = !isnan(n.m1) && n.m1 < c.start;
  n.dryRun = dryNow ? min(n.dryRun + 1, 250) : 0;
  setAlert(n, A_DRY,  n.dryRun >= 2 && !(n.m1 < c.start - 10), String("Zone ") + n.zone + " dry at roots (" + String(n.m1, 1) + "% < " + String(c.start, 0) + "% for " + c.name + ") - irrigate");
  setAlert(n, A_VDRY, !isnan(n.m1) && n.m1 < c.start - 10, String("Zone ") + n.zone + " very dry (" + String(n.m1, 1) + "%) - irrigate now");
  bool wetNow = !isnan(n.m1) && !isnan(n.m2) && n.m1 > WET_M1 && n.m2 > WET_M2;
  if (wetNow && n.wetSinceMs == 0) n.wetSinceMs = millis();
  if (!wetNow) n.wetSinceMs = 0;
  setAlert(n, A_WET, wetNow && minutesSince(n.wetSinceMs) >= WET_HOURS * 60, "Too wet for 2 h - stop irrigation, check drainage");
  setAlert(n, A_HEAT, !isnan(n.at) && n.at > HEAT_C, String("Heat stress (air ") + String(n.at, 1) + " C) - irrigate early morning/evening");
  setAlert(n, A_FUNGAL, !isnan(n.lwh) && n.lwh >= FUNGAL_HOURS && !isnan(n.at) && n.at >= 18 && n.at <= 32 && !isnan(n.ah) && n.ah > 85,
           String("Leaves wet ") + String(n.lwh, 1) + " h - fungal disease risk, inspect crop");
  setAlert(n, A_COLD, !isnan(n.st) && n.st < COLD_C, String("Soil cold (") + String(n.st, 1) + " C) - slow growth");
  setAlert(n, A_BATLOW, !isnan(n.bv) && n.bv < LOWBATT_V, String("Battery low (") + String(n.bv, 2) + " V) - clean the solar panel");
  bool na = isnan(n.m1) || isnan(n.m2) || isnan(n.st) || isnan(n.at);
  n.naRun = na ? min(n.naRun + 1, 250) : 0;
  setAlert(n, A_SENSOR, n.naRun >= 3, "A sensor is disconnected (NA 3 times)");
}

void pondRules(Node& n) {
  setAlert(n, A_DOCRIT, !isnan(n.dO) && n.dO < DO_CRIT, String("Oxygen critical (") + String(n.dO, 2) + " mg/L) - fish at risk");
  setAlert(n, A_DOLOW, !isnan(n.dO) && n.dO >= DO_CRIT && n.dO < DO_LOW && n.aer == 0, "Oxygen low and aerator OFF - check");
  setAlert(n, A_PHBAD, !isnan(n.ph) && (n.ph < PH_MIN || n.ph > PH_MAX), String("Pond pH out of range (") + String(n.ph, 2) + ")");
  setAlert(n, A_WTHOT, !isnan(n.wt) && n.wt > WT_HOT, "Water very warm - less oxygen");
  setAlert(n, A_FAULT, n.flt != 0, String("Pond fault ") + n.flt);
}

void silentCheck() {
  for (int i = 0; i < MAX_NODES; i++) if (nodes[i].used) {
    Node& n = nodes[i];
    setAlert(n, A_SILENT, !fresh(n), String("Node not reporting for ") + String(minutesSince(n.lastSeenMs), 0) + " min");
  }
}

// ============================== IRRIGATION ==============================
void setOutputs() {
#if IRRIGATION_OUTPUTS
  bool any = false;
  for (int z = 0; z < NUM_ZONES; z++) {
    digitalWrite(PIN_VALVE[z], (zones[z].running ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
    any |= zones[z].running;
  }
  digitalWrite(PIN_PUMP, (any ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
#endif
}
void irrEvent(int z, bool start, float avg, const String& why) {
  Zone& Z = zones[z];
  Z.running = start;
  if (start) Z.startMs = millis(); else { Z.stopMs = millis(); Z.manual = false; }
  setOutputs();
  String line = String("IRR,Z=") + (z + 1) + ",ACT=" + (start ? "START" : "STOP") + ",AVG=" + (isnan(avg) ? String("NA") : String(avg, 1)) +
                ",CROP=" + CROPS[Z.crop].name + ",WHY=" + why;
  Serial.println(line);
  publish(topicBase() + "/irrigation", String("{\"zone\":") + (z + 1) + ",\"action\":\"" + (start ? "start" : "stop") + "\",\"avg_m1\":" + f1(avg) +
          ",\"crop\":\"" + CROPS[Z.crop].name + "\",\"why\":\"" + why + "\"}");
}
void irrigationTick() {
  for (int z = 0; z < NUM_ZONES; z++) {
    Zone& Z = zones[z];
    const Crop& c = CROPS[Z.crop];
    float sum = 0; int cnt = 0, rainy = 0;
    for (int i = 0; i < MAX_NODES; i++) {
      Node& n = nodes[i];
      if (!n.used || n.type != 'S' || n.zone != z + 1 || !fresh(n) || isnan(n.m1)) continue;
      sum += n.m1; cnt++;
      if (!isnan(n.lw) && n.lw > RAIN_LW) rainy++;
    }
    float avg = cnt ? sum / cnt : NAN;
    bool rain = cnt && rainy * 2 > cnt;
    if (Z.running) {
      if (minutesSince(Z.startMs) >= IRR_MAX_RUN_MIN) irrEvent(z, false, avg, "max run time reached");
      else if (Z.manual) continue;
      else if (!cnt)              irrEvent(z, false, avg, "no fresh soil data (failsafe)");
      else if (avg >= c.stop)     irrEvent(z, false, avg, "target moisture reached");
      else if (rain)              irrEvent(z, false, avg, "rain detected");
    } else if (irrAuto && cnt && !rain && avg < c.start &&
               (Z.stopMs == 0 || minutesSince(Z.stopMs) >= IRR_MIN_OFF_MIN)) {
      irrEvent(z, true, avg, String("zone average below ") + String(c.start, 0) + "%");
    }
  }
}

// ============================== RADIO ==============================
void sendRaw(const String& s) { LoRa.idle(); LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket(); LoRa.receive(); }

bool queueCmd(const String& dst, const String& body) {
  for (int i = 0; i < MAX_CMDS; i++) if (!cmds[i].active) {
    cmds[i].active = true; strncpy(cmds[i].dst, dst.c_str(), 6); cmds[i].dst[6] = 0;
    cmds[i].body = body; cmds[i].n = cmdN++; cmds[i].tries = 0; cmds[i].nextMs = millis();
    return true;
  }
  Serial.println("Command queue full");
  return false;
}
void cmdTick() {
  for (int i = 0; i < MAX_CMDS; i++) {
    Cmd& c = cmds[i];
    if (!c.active || (int32_t)(millis() - c.nextMs) < 0) continue;
    if (c.tries >= 3) {
      Serial.printf("CMDFAIL,ID=%s,N=%lu\n", c.dst, (unsigned long)c.n);
      publish(topicBase() + "/node/" + c.dst + "/ack", String("{\"n\":") + c.n + ",\"ok\":false,\"err\":\"TIMEOUT\"}");
      c.active = false; continue;
    }
    String pkt = "AM1,ID=" + hubId + ",T=CMD,N=" + String(c.n) + ",DST=" + c.dst + "," + c.body;
    sendRaw(pkt);
    Serial.printf("TX %s\n", pkt.c_str());
    c.tries++; c.nextMs = millis() + 2000 + random(0, 500);   // retry with the SAME N (node replies idempotently)
  }
}
void handleCmdAck(const String& m, const String& id) {
  uint32_t n = field(m, "N").toInt();
  for (int i = 0; i < MAX_CMDS; i++) if (cmds[i].active && id == cmds[i].dst && cmds[i].n == n) {
    cmds[i].active = false;
    Serial.printf("CMDACK,ID=%s,N=%lu,OK=%s,MODE=%s,AER=%s%s\n", id.c_str(), (unsigned long)n, field(m, "OK").c_str(),
                  field(m, "MODE").c_str(), field(m, "AER").c_str(), field(m, "HOLD") == "1" ? ",HOLD=1" : "");
  }
}

void syncPondClock(Node& n) {
  if (!clockValid()) return;
  if (n.tsSyncMs && millis() - n.tsSyncMs < 6UL * 3600000UL) return;
  n.tsSyncMs = millis();
  queueCmd(n.id, String("TS=") + (uint32_t)time(nullptr));
}

String dataJson(const Node& n, uint32_t seq) {
  String j = String("{\"id\":\"") + n.id + "\",\"type\":\"" + (n.type == 'P' ? "POND" : "SOIL") + "\",\"n\":" + seq +
             ",\"zone\":" + n.zone + ",\"rssi\":" + n.rssi + ",\"snr\":" + String(n.snr, 2) + ",\"hop\":" + n.hop + ",\"values\":{";
  if (n.type == 'S')
    j += "\"M1\":" + f1(n.m1) + ",\"M2\":" + f1(n.m2) + ",\"ST\":" + f1(n.st) + ",\"AT\":" + f1(n.at) + ",\"AH\":" + f1(n.ah) +
         ",\"LW\":" + f1(n.lw) + ",\"LX\":" + f1(n.lx) + ",\"LWH\":" + f1(n.lwh) + ",\"BV\":" + f1(n.bv);
  else
    j += "\"DO\":" + f1(n.dO) + ",\"PH\":" + f1(n.ph) + ",\"WT\":" + f1(n.wt) + ",\"AER\":" + n.aer + ",\"FLT\":" + n.flt + ",\"BV\":" + f1(n.bv);
  return j + "}}";
}

void handlePacket(const String& m, int rssi, float snr) {
  if (m.startsWith("ACK,")) return;                         // node-to-node ACKs: not for the hub
  if (!m.startsWith("AM1,")) return;
  String id = field(m, "ID"), type = field(m, "T"), nStr = field(m, "N");
  if (id.length() != 6 || nStr.length() == 0) return;
  if (id == hubId) return;

  if (type == "ACK") { handleCmdAck(m, id); return; }       // pond reply to a command
  if (type == "CMD") return;

  // 1) ACK first (the node waits only ~1.2 s), with settings for soil nodes
  Node* np = findNode(id, true);
  uint8_t zone = 1;
  if (type == "SOIL") {
    uint8_t zs = savedZone(id.c_str());
    int zp = field(m, "Z").toInt();
    zone = zs ? zs : (zp >= 1 && zp <= NUM_ZONES ? zp : 1);
    String ack = "ACK," + id + "," + nStr + ",HUB,DRY=" + String(cropOfZone(zone).start, 0) + ",INT=" + String(reportMin);
    if (zs && zs != zp) ack += ",Z=" + String(zs);
    delay(40); sendRaw(ack);
  } else {
    delay(40); sendRaw("ACK," + id + "," + nStr + ",HUB");
  }

  // 2) duplicates are acknowledged but not processed again
  if (isDup(keyOf(id, nStr))) { rxDup++; return; }
  rxOk++;
  digitalWrite(PIN_LED, HIGH);
  Serial.printf("RX %s | RSSI=%d SNR=%.2f\n", m.c_str(), rssi, snr);
  publish(topicBase() + "/node/" + id + "/raw", m);
  if (!np) { Serial.println("Node table full"); digitalWrite(PIN_LED, LOW); return; }

  // 3) update the node table
  Node& n = *np;
  uint32_t seq = nStr.toInt();
  if (n.rx > 0 && seq > n.lastN && seq - n.lastN < 200) n.missed += seq - n.lastN - 1;   // gaps = lost packets
  if (n.rx == 0) n.firstN = seq;
  n.lastN = seq; n.rx++; n.lastSeenMs = millis(); n.rssi = rssi; n.snr = snr;
  n.hop = field(m, "HOP").toInt();
  n.bv = fval(m, "BV");
  if (type == "SOIL") {
    n.type = 'S'; n.zone = zone;
    n.m1 = fval(m, "M1"); n.m2 = fval(m, "M2"); n.st = fval(m, "ST"); n.at = fval(m, "AT"); n.ah = fval(m, "AH");
    n.lw = fval(m, "LW"); n.lx = fval(m, "LX"); n.lwh = fval(m, "LWH");
    soilRules(n);
  } else if (type == "POND") {
    n.type = 'P'; n.zone = 0;
    n.dO = fval(m, "DO"); n.ph = fval(m, "PH"); n.wt = fval(m, "WT");
    String a = field(m, "AER"); n.aer = a.length() ? a.toInt() : -1;
    n.flt = field(m, "FLT").toInt();
    pondRules(n);
    syncPondClock(n);
  }
  setAlert(n, A_SILENT, false, "");
  publish(topicBase() + "/node/" + id + "/data", dataJson(n, seq));
  digitalWrite(PIN_LED, LOW);
}

// ============================== SERIAL COMMANDS ==============================
int cropIndex(const String& name) { for (int i = 0; i < NUM_CROPS; i++) if (name.equalsIgnoreCase(CROPS[i].name)) return i; return -1; }
void saveZones() {
  prefs.begin("bhoomi", false);
  for (int z = 0; z < NUM_ZONES; z++) prefs.putUChar((String("crop") + z).c_str(), zones[z].crop);
  prefs.putUShort("int", reportMin); prefs.putBool("auto", irrAuto);
  prefs.end();
}
void loadZones() {
  prefs.begin("bhoomi", true);
  const uint8_t def[NUM_ZONES] = {2, 3, 0};                 // tomato, onion, rice
  for (int z = 0; z < NUM_ZONES; z++) { zones[z].crop = prefs.getUChar((String("crop") + z).c_str(), def[z]); if (zones[z].crop >= NUM_CROPS) zones[z].crop = 0; }
  reportMin = prefs.getUShort("int", 15); irrAuto = prefs.getBool("auto", true);
  prefs.end();
}
void printNodes() {
  Serial.println("ID     T Z  seen(min)  RSSI hop  loss%  values");
  for (int i = 0; i < MAX_NODES; i++) if (nodes[i].used) {
    Node& n = nodes[i];
    float loss = (n.rx + n.missed) ? 100.0f * n.missed / (n.rx + n.missed) : 0;
    Serial.printf("%s %c %u  %8.1f  %4d  %u  %5.1f  ", n.id, n.type ? n.type : '?', n.zone, minutesSince(n.lastSeenMs), n.rssi, n.hop, loss);
    if (n.type == 'S') Serial.printf("M1=%.1f M2=%.1f AT=%.1f AH=%.0f LWH=%.1f BV=%.2f", n.m1, n.m2, n.at, n.ah, n.lwh, n.bv);
    else Serial.printf("DO=%.2f PH=%.2f WT=%.1f AER=%d FLT=%d", n.dO, n.ph, n.wt, n.aer, n.flt);
    String al; for (int a = 0; a < A_COUNT; a++) if (n.alerts & (1UL << a)) { al += " "; al += A_NAME[a]; }
    Serial.printf("  alerts:%s\n", al.length() ? al.c_str() : " none");
  }
}
void printZones() {
  for (int z = 0; z < NUM_ZONES; z++) {
    const Crop& c = CROPS[zones[z].crop];
    Serial.printf("Zone %d: %-6s start<%.0f%% stop>=%.0f%%  %s%s\n", z + 1, c.name, c.start, c.stop,
                  zones[z].running ? "IRRIGATING" : "idle", zones[z].manual ? " (manual)" : "");
  }
  Serial.printf("Auto irrigation: %s · report interval %u min · outputs %s\n", irrAuto ? "ON" : "OFF", reportMin, IRRIGATION_OUTPUTS ? "ON" : "print only");
}
void handleSerial(String l) {
  l.trim(); if (!l.length()) return;
  String lc = l; lc.toLowerCase();
  if (lc == "help") Serial.println("nodes | zones | crops | crop <z> <name> | zone <ID> <z> | int <min> | irr auto|off | irr <z> start|stop | cmd <ID> K=V[,K=V] | time <unix>");
  else if (lc == "nodes") printNodes();
  else if (lc == "zones") printZones();
  else if (lc == "crops") for (int i = 0; i < NUM_CROPS; i++) Serial.printf("%-6s start %.0f stop %.0f ECw100 %.1f ECw90 %.1f\n", CROPS[i].name, CROPS[i].start, CROPS[i].stop, CROPS[i].ec100, CROPS[i].ec90);
  else if (lc.startsWith("crop ")) {
    int sp = lc.indexOf(' ', 5); int z = lc.substring(5, sp).toInt(); int c = cropIndex(lc.substring(sp + 1));
    if (z >= 1 && z <= NUM_ZONES && c >= 0) { zones[z - 1].crop = c; saveZones(); Serial.printf("Zone %d crop = %s\n", z, CROPS[c].name); }
    else Serial.println("Usage: crop <1-3> <rice|wheat|tomato|onion|orange|grape>");
  }
  else if (lc.startsWith("zone ")) {
    String id = l.substring(5, 11); id.toUpperCase(); int z = l.substring(12).toInt();
    if (id.length() == 6 && z >= 1 && z <= NUM_ZONES) {
      prefs.begin("bhoomi", false); prefs.putUChar((String("z_") + id).c_str(), z); prefs.end();
      Node* n = findNode(id, false); if (n) n->zone = z;
      Serial.printf("Node %s -> zone %d (sent in its next ACK)\n", id.c_str(), z);
    } else Serial.println("Usage: zone <6-hex ID> <1-3>");
  }
  else if (lc.startsWith("int ")) { int m = lc.substring(4).toInt(); if (m >= 1 && m <= 240) { reportMin = m; saveZones(); Serial.printf("Report interval %d min\n", m); } }
  else if (lc == "irr auto") { irrAuto = true; saveZones(); Serial.println("Auto irrigation ON"); }
  else if (lc == "irr off") { irrAuto = false; saveZones(); for (int z = 0; z < NUM_ZONES; z++) if (zones[z].running) irrEvent(z, false, NAN, "auto switched off"); Serial.println("Auto irrigation OFF"); }
  else if (lc.startsWith("irr ")) {
    int z = lc.substring(4, 5).toInt();
    if (z >= 1 && z <= NUM_ZONES && lc.endsWith("start")) { zones[z - 1].manual = true; irrEvent(z - 1, true, NAN, "manual start"); }
    else if (z >= 1 && z <= NUM_ZONES && lc.endsWith("stop")) irrEvent(z - 1, false, NAN, "manual stop");
  }
  else if (lc.startsWith("cmd ")) {
    String id = l.substring(4, 10); id.toUpperCase(); String body = l.substring(11); body.trim(); body.toUpperCase();
    if (id.length() == 6 && body.length()) { queueCmd(id, body); } else Serial.println("Usage: cmd <ID> AER=ON");
  }
  else if (lc.startsWith("time ")) {
    struct timeval tv = { (time_t)l.substring(5).toInt(), 0 }; settimeofday(&tv, nullptr);
    Serial.printf("Hub clock set: %ld\n", (long)time(nullptr));
  }
  else Serial.println("Unknown command — type help");
}

// ============================== MQTT ==============================
#if USE_MQTT
// bhoomi/<farm>/cmd/<ID>  payload {"AER":"ON"} or {"LO":3.5,"HI":6} -> AER=ON / LO=3.5,HI=6
void onMqtt(char* topic, byte* payload, unsigned int len) {
  String t(topic), p; for (unsigned i = 0; i < len; i++) p += (char)payload[i];
  String id = t.substring(t.lastIndexOf('/') + 1); id.toUpperCase();
  String body;
  p.replace("{", ""); p.replace("}", ""); p.replace("\"", ""); p.replace(" ", "");
  int s = 0;
  while (s < (int)p.length()) {
    int c = p.indexOf(',', s); if (c < 0) c = p.length();
    String kv = p.substring(s, c); int col = kv.indexOf(':');
    if (col > 0) { if (body.length()) body += ","; body += kv.substring(0, col) + "=" + kv.substring(col + 1); }
    s = c + 1;
  }
  body.toUpperCase();
  if (id.length() == 6 && body.length()) queueCmd(id, body);
}
void mqttTick() {
  static uint32_t lastTry = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastTry > 15000) { lastTry = millis(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
    return;
  }
  if (!mqtt.connected() && millis() - lastTry > 5000) {
    lastTry = millis();
    String st = topicBase() + "/hub/status";
    if (mqtt.connect((String("bhoomi-hub-") + hubId).c_str(), st.c_str(), 1, true, "{\"online\":false}")) {
      mqtt.publish(st.c_str(), "{\"online\":true}", true);
      mqtt.subscribe((topicBase() + "/cmd/+").c_str(), 1);
      configTime(0, 0, "pool.ntp.org");                      // real clock for pond time sync
    }
  }
  mqtt.loop();
}
#endif

// ============================== SETUP / LOOP ==============================
void setup() {
  Serial.begin(115200); delay(200);
  pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW);
  uint64_t mac = ESP.getEfuseMac(); char b[7]; snprintf(b, sizeof(b), "%06X", (uint32_t)((mac >> 24) & 0xFFFFFF)); hubId = b;
  loadZones();
#if IRRIGATION_OUTPUTS
  pinMode(PIN_PUMP, OUTPUT);
  for (int z = 0; z < NUM_ZONES; z++) pinMode(PIN_VALVE[z], OUTPUT);
#endif
  setOutputs();
  randomSeed(esp_random());
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) { Serial.println("LoRa init FAILED"); while (true) { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(200); } }
  LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc(); LoRa.setTxPower(LORA_TX_DBM);
  LoRa.receive();
#if USE_MQTT
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
  mqtt.setServer(MQTT_HOST, MQTT_PORT); mqtt.setCallback(onMqtt); mqtt.setBufferSize(768);
#endif
  Serial.printf("\nBHOOMI Hub v3.0  ID=%s  433.5 MHz  listening\n", hubId.c_str());
  printZones();
  Serial.println("Type 'help' for commands");
}

void loop() {
  // radio
  int len = LoRa.parsePacket();
  if (len > 0) {
    String m; while (LoRa.available()) m += (char)LoRa.read();
    handlePacket(m, LoRa.packetRssi(), LoRa.packetSnr());
  }
  // commands to nodes
  cmdTick();
  // periodic jobs
  static uint32_t lastTick = 0;
  if (millis() - lastTick > 30000) {
    lastTick = millis();
    silentCheck();
    irrigationTick();
    publish(topicBase() + "/hub/status", String("{\"online\":true,\"rx_ok\":") + rxOk + ",\"rx_dup\":" + rxDup + ",\"uptime_s\":" + millis() / 1000 + "}", true);
  }
  // serial console
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { if (line.length()) handleSerial(line); line = ""; }
    else if (line.length() < 120) line += c;
  }
#if USE_MQTT
  mqttTick();
#endif
}
