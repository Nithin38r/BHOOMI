/*
  =====================================================================
   AgriMesh Pond Node  -  PART B : BANK-SIDE AERATOR CONTROLLER
   HackWithAditya 2026 - AgriTech & Aquaculture track
  =====================================================================
   Board   : ESP32-DevKitC (always powered from a 5 V DIN supply)
   Core    : Arduino-ESP32 2.0.x or 3.x
   Libraries (Library Manager):
     - LoRa      by Sandeep Mistry
     - RTClib    by Adafruit (installs Adafruit BusIO)

   What this firmware does (same logic as the digital twin):
     - listens all the time on LoRa
     - when the buoy reports: ACK immediately (aerator state, motor current,
       time, queued commands), then send a status packet to the hub
     - aerator AUTO logic with no hub/internet needed:
         ON  when DO < 4.0 mg/L, OFF when DO > 6.0 mg/L (hysteresis)
         minimum ON time 20 min, minimum OFF time 5 min
         no valid DO (buoy silent > 35 min or DO probe fault):
             night -> run aerator (failsafe), day -> hold state
     - FLT 10: contactor commanded ON but motor current ~0 A (CT) after 30 s
     - FLT 11: aerator ON but DO still falling after 30 min
     - FLT 20: buoy silent > 35 min
     - hub commands: AER=ON/OFF/AUTO, LO=/HI= thresholds, calibration
       status request for the buoy, TS= time sync. Every command is ACKed.
     - mesh relay for other AgriMesh nodes (optional)

   SAFETY: this board only switches the contactor COIL through an
   opto-isolated relay. The motor keeps its own starter, MCB and overload.
   A Hand-Off-Auto switch lets the farmer run the aerator without
   electronics. Mains wiring must be done and signed off by a licensed
   electrician.

   Serial 115200 (line ending: Newline) - type "help".
  =====================================================================
*/

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <RTClib.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "esp_arduino_version.h"

// =====================================================================
//                              CONFIG
// =====================================================================
// ---- LoRa (identical on every AgriMesh node) ----
#define LORA_FREQ_HZ        865062500UL
#define LORA_SF             9
#define LORA_BW_HZ          125E3
#define LORA_CR_DENOM       5
#define LORA_SYNC_WORD      0x12
#define LORA_TX_DBM         14

// ---- Pins ----
#define PIN_LORA_SCK        18
#define PIN_LORA_MISO       19
#define PIN_LORA_MOSI       23
#define PIN_LORA_NSS        5
#define PIN_LORA_RST        14
#define PIN_LORA_DIO0       26
#define PIN_I2C_SDA         21
#define PIN_I2C_SCL         22
#define PIN_RELAY           32     // relay module IN, ACTIVE LOW
#define PIN_CT              36     // SCT-013-030 on 1.65 V bias (ADC1_CH0, VP)
#define PIN_AUX_FB          39     // contactor auxiliary NO contact (HIGH = pulled in), 10k pull-down
#define PIN_HOA_AUTO        34     // HOA switch in AUTO (HIGH = AUTO), 10k pull-down
#define PIN_LED_OK          2      // green: heartbeat
#define PIN_LED_FLT         27     // red: any fault

#define RELAY_ON_LEVEL      LOW
#define RELAY_OFF_LEVEL     HIGH

// Set to false while bench-testing without the HOA switch / aux contact wired
#define USE_HOA_INPUT       true
#define USE_AUX_FEEDBACK    true
#define MESH_RELAY          true   // repeat other AgriMesh node packets towards the hub

// ---- Aerator logic (defaults; LO/HI can be changed from hub, saved in NVS) ----
#define DEFAULT_DO_ON_BELOW   4.0f
#define DEFAULT_DO_OFF_ABOVE  6.0f
#define MIN_ON_MS           (20UL * 60UL * 1000UL)
#define MIN_OFF_MS          (5UL  * 60UL * 1000UL)
#define BUOY_SILENT_MS      (35UL * 60UL * 1000UL)
#define CURRENT_CHECK_MS    (30UL * 1000UL)    // after switching ON
#define MOTOR_MIN_AMPS      0.5f
#define DO_TREND_WINDOW_MS  (30UL * 60UL * 1000UL)
#define DO_TREND_DROP       0.15f              // mg/L
#define STATUS_EVERY_MS     (5UL * 60UL * 1000UL)  // status to hub when the buoy is silent

// ---- CT sensor ----
#define CT_AMPS_PER_VOLT    30.0f      // SCT-013-030: 30 A -> 1 V RMS
#define CT_NOISE_A          0.10f      // readings below this are shown as 0
#define CT_WINDOWS          25         // 25 x 20 ms = 0.5 s RMS

// ---- Time ----
#define TZ_OFFSET_S         19800      // IST
#define NIGHT_START_H       18
#define NIGHT_END_H         7

// ---- Fault codes ----
#define FLT_NONE            0
#define FLT_AER_NO_CURRENT  10
#define FLT_AER_DO_FALLING  11
#define FLT_BUOY_SILENT     20

// =====================================================================
//                                STATE
// =====================================================================
enum Mode { M_AUTO, M_ON, M_OFF };
const char* modeName(Mode m) { return m == M_ON ? "ON" : m == M_OFF ? "OFF" : "AUTO"; }

Preferences prefs;
RTC_DS3231 rtc;
bool rtcOk = false;
uint32_t syncEpoch = 0, syncMs = 0;     // fallback clock from hub TS= when no DS3231

String myId, buoyId;
float doOnBelow = DEFAULT_DO_ON_BELOW, doOffAbove = DEFAULT_DO_OFF_ABOVE;
Mode  mode = M_AUTO;

bool     relayOn = false;
uint32_t lastChangeMs = 0, onAtMs = 0;
float    motorAmps = 0.0f;
bool     auxOn = false, hoaAuto = true;

// latest buoy data
bool     haveBuoy = false;
uint32_t lastRxMs = 0, buoySeq = 0;
float    bDO = 0, bDOS = 0, bPH = 0, bWT = 0, bBV = 0;
uint8_t  bFlt = 0;
bool     doInvalid = false;
int      lastRssi = 0;

// DO log while aerator is ON (for FLT 11)
#define DOLOG_N 16
uint32_t doLogT[DOLOG_N]; float doLogV[DOLOG_N]; uint8_t doLogN = 0;

uint32_t bankFlt = 0;          // bit mask of 10/11/20
uint32_t lastReportedMask = 0;
uint8_t  lastReportedRelay = 255;
bool     pendingCal = false;
uint32_t ownSeq = 0;
long     lastCmdN = -1;
String   lastCmdAck = "";
String   decision = "-", holdText = "";
uint32_t lastStatusMs = 0;

// CT accumulators
double ctSum = 0, ctSumSq = 0; uint32_t ctN = 0; uint8_t ctWin = 0;

// mesh relay de-duplication
#define SEEN_N 32
String seenKey[SEEN_N]; uint32_t seenMs[SEEN_N]; uint8_t seenIdx = 0;

// =====================================================================
//                               HELPERS
// =====================================================================
String chipId6() {
  uint64_t mac = ESP.getEfuseMac();
  uint32_t id = 0;
  for (int i = 0; i < 17; i += 8) id |= ((mac >> (40 - i)) & 0xFF) << i;
  char b[7]; snprintf(b, sizeof(b), "%06X", (unsigned)(id & 0xFFFFFF));
  return String(b);
}

String getField(const String& pkt, const char* key) {
  String k = String(",") + key + "=";
  int i = pkt.indexOf(k);
  if (i < 0) return "";
  i += k.length();
  int j = pkt.indexOf(',', i);
  return (j < 0) ? pkt.substring(i) : pkt.substring(i, j);
}
bool hasField(const String& pkt, const char* key) { return pkt.indexOf(String(",") + key + "=") >= 0; }

uint32_t nowEpoch() {
  if (rtcOk) return rtc.now().unixtime();
  if (syncEpoch) return syncEpoch + (millis() - syncMs) / 1000UL;
  return 0;
}
bool timeValid() { return nowEpoch() > 1700000000UL; }
int  localHour()  { return (int)(((nowEpoch() + TZ_OFFSET_S) % 86400UL) / 3600UL); }
bool isNight() {
  if (!timeValid()) return true;          // unknown time -> treat as night (safer)
  int h = localHour();
  return h >= NIGHT_START_H || h < NIGHT_END_H;
}
void setEpoch(uint32_t e) {
  if (rtcOk) rtc.adjust(DateTime(e));
  syncEpoch = e; syncMs = millis();
}
String clockText() {
  if (!timeValid()) return "--:--";
  uint32_t l = nowEpoch() + TZ_OFFSET_S;
  char b[6]; snprintf(b, sizeof(b), "%02lu:%02lu", (unsigned long)((l % 86400UL) / 3600UL), (unsigned long)((l % 3600UL) / 60UL));
  return String(b);
}
String fmtMin(uint32_t ms) { return String((ms + 59999UL) / 60000UL) + " min"; }

uint8_t mergedFault() {
  const uint8_t pri[] = { 11, 10, 21, 20, 1, 2, 3, 4, 5, 6, 7 };
  for (uint8_t c : pri) {
    if (c >= 10 && c != 21 && (bankFlt & (1UL << c))) return c;
    if (bFlt == c && haveBuoy) return c;
  }
  return FLT_NONE;
}

void loadSettings() {
  prefs.begin("bank", true);
  doOnBelow  = prefs.getFloat("lo", DEFAULT_DO_ON_BELOW);
  doOffAbove = prefs.getFloat("hi", DEFAULT_DO_OFF_ABOVE);
  buoyId     = prefs.getString("buoy", "");
  prefs.end();
}
void saveThresholds() { prefs.begin("bank", false); prefs.putFloat("lo", doOnBelow); prefs.putFloat("hi", doOffAbove); prefs.end(); }
void saveBuoy(const String& id) { prefs.begin("bank", false); prefs.putString("buoy", id); prefs.end(); buoyId = id; }

// =====================================================================
//                                LoRa
// =====================================================================
bool loraStart() {
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) return false;
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW_HZ);
  LoRa.setCodingRate4(LORA_CR_DENOM);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();
  LoRa.setTxPower(LORA_TX_DBM);
  return true;
}

void loraSend(const String& s) {
  LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket();   // blocking
  Serial.print(F("TX> ")); Serial.println(s);
}

// =====================================================================
//                             AERATOR
// =====================================================================
void setRelay(bool on) {
  digitalWrite(PIN_RELAY, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
  relayOn = on; lastChangeMs = millis();
  if (on) { onAtMs = millis(); doLogN = 0; if (haveBuoy && !doInvalid) { doLogT[0] = millis(); doLogV[0] = bDO; doLogN = 1; } }
  else    { bankFlt &= ~((1UL << FLT_AER_NO_CURRENT) | (1UL << FLT_AER_DO_FALLING)); }
  Serial.printf("[%s] CONTACTOR %s  (%s)\n", clockText().c_str(), on ? "ON" : "OFF", decision.c_str());
}

void logDO(float v) {
  if (doLogN == DOLOG_N) { for (int i = 1; i < DOLOG_N; i++) { doLogT[i-1] = doLogT[i]; doLogV[i-1] = doLogV[i]; } doLogN--; }
  doLogT[doLogN] = millis(); doLogV[doLogN] = v; doLogN++;
  // drop entries older than 40 min
  while (doLogN > 1 && millis() - doLogT[0] > 40UL * 60UL * 1000UL) {
    for (int i = 1; i < doLogN; i++) { doLogT[i-1] = doLogT[i]; doLogV[i-1] = doLogV[i]; } doLogN--;
  }
}

void checkDoTrend() {          // FLT 11
  if (!relayOn || motorAmps < MOTOR_MIN_AMPS || millis() - onAtMs < DO_TREND_WINDOW_MS || doLogN < 2) return;
  for (int i = 0; i < doLogN; i++) {
    if (millis() - doLogT[i] >= DO_TREND_WINDOW_MS) {
      if (bDO < doLogV[i] - DO_TREND_DROP) bankFlt |= (1UL << FLT_AER_DO_FALLING);
      return;
    }
  }
}

void control() {
  uint32_t now = millis();
  hoaAuto = USE_HOA_INPUT ? (digitalRead(PIN_HOA_AUTO) == HIGH) : true;
  auxOn   = USE_AUX_FEEDBACK ? (digitalRead(PIN_AUX_FB) == HIGH) : relayOn;

  bool silent = (now - lastRxMs > BUOY_SILENT_MS);
  if (silent) bankFlt |= (1UL << FLT_BUOY_SILENT); else bankFlt &= ~(1UL << FLT_BUOY_SILENT);

  if (!hoaAuto) {              // HAND or OFF on the panel: electronics stand aside
    decision = "HOA switch not in AUTO - panel has control"; holdText = "";
    if (relayOn) setRelay(false);
    return;
  }

  bool want = relayOn;
  bool validDO = haveBuoy && !silent && !doInvalid;
  if (mode == M_ON)       { want = true;  decision = "Manual ON from hub"; }
  else if (mode == M_OFF) { want = false; decision = "Manual OFF from hub"; }
  else if (!haveBuoy && !silent) { decision = "Waiting for first buoy packet -> hold"; }
  else if (!validDO) {
    if (isNight()) { want = true; decision = "Failsafe: no valid DO at night -> run aerator"; }
    else           { decision = "Failsafe: no valid DO, daytime -> hold state"; }
  }
  else if (bDO < doOnBelow)  { want = true;  decision = "DO " + String(bDO, 2) + " < " + String(doOnBelow, 1) + " -> ON"; }
  else if (bDO > doOffAbove) { want = false; decision = "DO " + String(bDO, 2) + " > " + String(doOffAbove, 1) + " -> OFF"; }
  else decision = "DO " + String(bDO, 2) + " inside band -> hold";

  holdText = "";
  if (want != relayOn) {
    uint32_t el = now - lastChangeMs;
    if (relayOn && el < MIN_ON_MS)        holdText = "min ON time, " + fmtMin(MIN_ON_MS - el) + " left";
    else if (!relayOn && el < MIN_OFF_MS) holdText = "min OFF time, " + fmtMin(MIN_OFF_MS - el) + " left";
    else setRelay(want);
  }

  // FLT 10: commanded ON, but no motor current (or contactor did not pull in)
  if (relayOn && now - onAtMs > CURRENT_CHECK_MS) {
    if (motorAmps < MOTOR_MIN_AMPS || (USE_AUX_FEEDBACK && !auxOn)) bankFlt |= (1UL << FLT_AER_NO_CURRENT);
    else bankFlt &= ~(1UL << FLT_AER_NO_CURRENT);
  }
  checkDoTrend();
}

// =====================================================================
//                         CURRENT SENSOR (CT)
// =====================================================================
void sampleCtWindow() {        // one 20 ms window = one 50 Hz cycle
  uint32_t t0 = micros();
  while (micros() - t0 < 20000UL) {
    float mv = analogReadMilliVolts(PIN_CT);
    ctSum += mv; ctSumSq += (double)mv * mv; ctN++;
  }
  if (++ctWin >= CT_WINDOWS) {
    double mean = ctSum / ctN;
    double var  = ctSumSq / ctN - mean * mean;
    float vrms  = var > 0 ? sqrt(var) / 1000.0 : 0;
    float a = vrms * CT_AMPS_PER_VOLT;
    motorAmps = (a < CT_NOISE_A) ? 0.0f : a;
    ctSum = ctSumSq = 0; ctN = 0; ctWin = 0;
  }
}

// =====================================================================
//                          PACKETS OUT
// =====================================================================
void sendStatus() {             // bank's own POND packet: latest buoy data + live aerator state
  ownSeq++;
  char p[200];
  snprintf(p, sizeof(p),
           "AM1,ID=%s,T=POND,N=%lu,DO=%.2f,DOS=%.0f,PH=%.2f,WT=%.1f,AER=%u,AERI=%.1f,BV=%.2f,FLT=%u",
           myId.c_str(), (unsigned long)ownSeq, bDO, bDOS, bPH, bWT, relayOn ? 1 : 0, motorAmps, bBV, mergedFault());
  loraSend(p);
  lastStatusMs = millis();
  lastReportedMask = bankFlt; lastReportedRelay = relayOn;
}

void sendAckToBuoy(uint32_t seq) {
  String a = "AM1,ID=" + myId + ",T=ACK,N=" + String(seq) +
             ",AER=" + String(relayOn ? 1 : 0) + ",AERI=" + String(motorAmps, 1) +
             ",TS=" + String(timeValid() ? nowEpoch() : 0);
  if (pendingCal) { a += ",CMD=CAL?"; pendingCal = false; }
  loraSend(a);
}

String ackHead(long n, bool ok) {
  return "AM1,ID=" + myId + ",T=ACK,N=" + String(n) + ",OK=" + String(ok ? 1 : 0) +
         ",MODE=" + modeName(mode) + ",AER=" + String(relayOn ? 1 : 0);
}

// =====================================================================
//                          PACKETS IN
// =====================================================================
bool seenBefore(const String& key) {
  for (int i = 0; i < SEEN_N; i++)
    if (seenKey[i] == key && millis() - seenMs[i] < 10UL * 60UL * 1000UL) return true;
  seenKey[seenIdx] = key; seenMs[seenIdx] = millis(); seenIdx = (seenIdx + 1) % SEEN_N;
  return false;
}

void handleBuoy(const String& p) {
  uint32_t seq = getField(p, "N").toInt();
  sendAckToBuoy(seq);                               // reply first: buoy listens only 1.5 s
  haveBuoy = true; lastRxMs = millis(); buoySeq = seq; lastRssi = LoRa.packetRssi();
  bDO  = getField(p, "DO").toFloat();  bDOS = getField(p, "DOS").toFloat();
  bPH  = getField(p, "PH").toFloat();  bWT  = getField(p, "WT").toFloat();
  bBV  = getField(p, "BV").toFloat();  bFlt = getField(p, "FLT").toInt();
  doInvalid = (bFlt >= 1 && bFlt <= 3);
  if (relayOn && !doInvalid) logDO(bDO);
  control();
  delay(250);
  sendStatus();
}

void handleCommand(const String& p) {
  long n = getField(p, "N").toInt();
  if (n == lastCmdN && lastCmdAck.length()) { delay(100); loraSend(lastCmdAck); return; }   // retry of same command
  String ack; bool ok = true; String extra;

  if (hasField(p, "TS")) {
    uint32_t e = strtoul(getField(p, "TS").c_str(), nullptr, 10);
    if (e > 1700000000UL) { setEpoch(e); extra += ",TS=" + String(e); } else { ok = false; extra += ",ERR=TS"; }
  }
  if (hasField(p, "AER")) {
    String v = getField(p, "AER");
    if (v == "ON") mode = M_ON; else if (v == "OFF") mode = M_OFF; else if (v == "AUTO") mode = M_AUTO;
    else { ok = false; extra += ",ERR=AER"; }
    control();
  }
  if (hasField(p, "LO") || hasField(p, "HI")) {
    float lo = hasField(p, "LO") ? getField(p, "LO").toFloat() : doOnBelow;
    float hi = hasField(p, "HI") ? getField(p, "HI").toFloat() : doOffAbove;
    if (lo >= 2.0f && hi <= 9.0f && hi - lo >= 0.5f) {
      doOnBelow = lo; doOffAbove = hi; saveThresholds();
      extra += ",LO=" + String(lo, 1) + ",HI=" + String(hi, 1);
    } else { ok = false; extra += ",ERR=RANGE"; }
  }
  if (hasField(p, "CAL")) {
    String fwd = getField(p, "FWD");
    if (!fwd.length() || fwd == buoyId) { pendingCal = true; extra += ",QUEUED=" + (buoyId.length() ? buoyId : String("BUOY")); }
    else { ok = false; extra += ",ERR=FWD"; }
  }
  ack = ackHead(n, ok) + extra;
  if (holdText.length()) ack += ",HOLD=1";
  lastCmdN = n; lastCmdAck = ack;
  delay(100);
  loraSend(ack);
}

void handlePacket(const String& p) {
  if (!p.startsWith("AM1,")) return;
  String from = getField(p, "ID"), type = getField(p, "T");
  if (from == myId) return;
  Serial.print(F("RX< ")); Serial.print(p); Serial.print(F("  RSSI ")); Serial.println(LoRa.packetRssi());

  if (type == "POND" && (from == buoyId || !buoyId.length())) {
    if (!buoyId.length()) { saveBuoy(from); Serial.println("Paired with buoy " + from); }
    handleBuoy(p); return;
  }
  if (type == "CAL" && from == buoyId) { delay(200); loraSend(p); return; }        // pass to hub
  if (type == "CMD" && getField(p, "DST") == myId) { handleCommand(p); return; }

  if (MESH_RELAY && type != "ACK") {
    String key = from + ":" + type + ":" + getField(p, "N");
    if (!seenBefore(key)) { delay(random(100, 400)); loraSend(p); }
  }
}

// =====================================================================
//                             SERIAL
// =====================================================================
void printStatus() {
  Serial.printf("\nBank %s  buoy %s  time %s (%s)\n", myId.c_str(), buoyId.length() ? buoyId.c_str() : "(not paired)",
                clockText().c_str(), timeValid() ? (isNight() ? "night" : "day") : "unknown -> night rules");
  Serial.printf("Mode %s  HOA %s  contactor %s  aux %s  motor %.2f A\n", modeName(mode), hoaAuto ? "AUTO" : "HAND/OFF",
                relayOn ? "ON" : "OFF", auxOn ? "closed" : "open", motorAmps);
  Serial.printf("Thresholds ON < %.1f  OFF > %.1f mg/L\n", doOnBelow, doOffAbove);
  if (haveBuoy) Serial.printf("Buoy N=%lu DO %.2f (%0.f%%) pH %.2f WT %.1f BV %.2f FLT %u, %lu s ago, RSSI %d\n",
                (unsigned long)buoySeq, bDO, bDOS, bPH, bWT, bBV, bFlt, (unsigned long)((millis() - lastRxMs) / 1000), lastRssi);
  else Serial.println(F("No buoy packet yet"));
  Serial.printf("Decision: %s  %s\nFLT now: %u\n", decision.c_str(), holdText.c_str(), mergedFault());
}

void handleSerial(String c) {
  c.trim();
  String l = c; l.toLowerCase();
  if (l == "help") {
    Serial.println(F("status | pair XXXXXX | unpair | aer on|off|auto | set lo 4.0 | set hi 6.0 | time 2026-11-20 18:30 | cal"));
  } else if (l == "status") printStatus();
  else if (l.startsWith("pair ")) { String id = c.substring(5); id.trim(); id.toUpperCase(); saveBuoy(id); Serial.println("Paired with " + id); }
  else if (l == "unpair") { saveBuoy(""); Serial.println(F("Buoy pairing cleared (next POND packet pairs)")); }
  else if (l.startsWith("aer ")) {
    String v = l.substring(4);
    if (v == "on") mode = M_ON; else if (v == "off") mode = M_OFF; else if (v == "auto") mode = M_AUTO;
    Serial.printf("Mode %s\n", modeName(mode)); control();
  }
  else if (l.startsWith("set lo ") || l.startsWith("set hi ")) {
    float v = l.substring(7).toFloat();
    float lo = l.startsWith("set lo") ? v : doOnBelow, hi = l.startsWith("set hi") ? v : doOffAbove;
    if (lo >= 2.0f && hi <= 9.0f && hi - lo >= 0.5f) { doOnBelow = lo; doOffAbove = hi; saveThresholds(); Serial.println(F("Saved")); }
    else Serial.println(F("Need 2 <= LO, HI <= 9, HI - LO >= 0.5"));
  }
  else if (l.startsWith("time ")) {
    int Y, M, D, h, m;
    if (sscanf(l.c_str() + 5, "%d-%d-%d %d:%d", &Y, &M, &D, &h, &m) == 5) {
      DateTime local(Y, M, D, h, m, 0);
      setEpoch(local.unixtime() - TZ_OFFSET_S);
      Serial.printf("Time set: %s (%s)\n", clockText().c_str(), isNight() ? "night" : "day");
    } else Serial.println(F("Format: time 2026-11-20 18:30   (IST)"));
  }
  else if (l == "cal") { pendingCal = true; Serial.println(F("Calibration request queued for the buoy's next wake")); }
  else if (l.length()) Serial.println(F("Unknown. Type help"));
}

// =====================================================================
//                          SETUP / LOOP
// =====================================================================
void setup() {
  digitalWrite(PIN_RELAY, RELAY_OFF_LEVEL);       // set level BEFORE enabling output: no click at boot
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_AUX_FB, INPUT);                     // GPIO34/39 are input-only, external pull-downs
  pinMode(PIN_HOA_AUTO, INPUT);
  pinMode(PIN_LED_OK, OUTPUT); pinMode(PIN_LED_FLT, OUTPUT);
  analogSetPinAttenuation(PIN_CT, ADC_11db);

  Serial.begin(115200); delay(200);
  myId = chipId6();
  loadSettings();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  rtcOk = rtc.begin();
  if (rtcOk && rtc.lostPower()) { Serial.println(F("DS3231 lost power: time unknown until hub TS= or 'time' command")); rtcOk = true; rtc.adjust(DateTime(2000, 1, 1, 0, 0, 0)); }
  if (!rtcOk) Serial.println(F("DS3231 not found: using hub time sync only"));

  Serial.printf("\nAgriMesh Pond Bank Controller  ID=%s  paired buoy=%s\n", myId.c_str(), buoyId.length() ? buoyId.c_str() : "(auto-pair)");
  if (!loraStart()) Serial.println(F("ERROR: RFM95W not found - check SPI wiring / 3V3"));

  lastChangeMs = millis();                         // min OFF time also applies after a reboot
  lastRxMs = millis();

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdt = { .timeout_ms = 20000, .idle_core_mask = 0, .trigger_panic = true };
  if (esp_task_wdt_init(&wdt) != ESP_OK) esp_task_wdt_reconfigure(&wdt);
#else
  esp_task_wdt_init(20, true);
#endif
  esp_task_wdt_add(NULL);
  randomSeed(esp_random());
  printStatus();
}

void loop() {
  static uint32_t lastCtrl = 0;
  static String line;

  int n = LoRa.parsePacket();
  if (n > 0) { String p; while (LoRa.available()) p += (char)LoRa.read(); handlePacket(p); }

  sampleCtWindow();

  if (millis() - lastCtrl >= 1000) {
    lastCtrl = millis();
    control();
    // report immediately on any aerator change or new bank-side fault
    if ((uint8_t)relayOn != lastReportedRelay || (bankFlt & ~lastReportedMask)) sendStatus();
    else if (bankFlt != lastReportedMask) lastReportedMask = bankFlt;   // a fault cleared
    // keep the hub informed while the buoy is silent
    if ((bankFlt & (1UL << FLT_BUOY_SILENT)) && millis() - lastStatusMs > STATUS_EVERY_MS) sendStatus();
    digitalWrite(PIN_LED_FLT, mergedFault() ? HIGH : LOW);
  }
  digitalWrite(PIN_LED_OK, (millis() / 500) % 2);

  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') { if (line.length()) { handleSerial(line); line = ""; } }
    else line += ch;
  }
  esp_task_wdt_reset();
}
