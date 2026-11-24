/*
  ============================================================================
  BHOOMI Soil Node  —  firmware v3.1  (production)
  ============================================================================
  Board  : ESP32 38-pin DevKit ("ESP32 Dev Module"), esp32 core 2.x or 3.x
  Radio  : SX1278 / Ra-02, 433.5 MHz, SF9, BW125, CR4/5, sync 0x12, CRC on
  Libs   : "LoRa" (Sandeep Mistry) · "OneWire" (Paul Stoffregen) ·
           "DallasTemperature" (Miles Burton)            — SHT31 is read directly

  What this node does every cycle (default 15 min):
    1. Wakes from deep sleep, switches the sensor rail (GPIO25) ON.
    2. Reads 2 x soil moisture, soil temp, air temp/RH, leaf wetness, light, battery.
    3. On-node processing (kept in RTC memory across sleeps):
         - moisture trend since last reading (DM1)
         - leaf-wet hours, counts how long leaves have stayed wet (LWH)
         - local flags: DRY, WET, HEAT, FUNGAL, LOWBAT, SENSOR fault (FLG)
         - "urgent" packets get extra retries
    4. Sends one AM1 packet to the hub (directly, or through relay nodes).
    5. Reads the hub's ACK, which carries settings back to the node:
         ACK,<ID>,<N>,HUB[,DRY=<%>][,INT=<min>][,Z=<zone>]
       DRY = this zone's crop "irrigate below" moisture, INT = report minutes,
       Z = zone number. Settings are saved in flash and survive power loss.
    6. Switches everything off and deep-sleeps (≈ 1 mA on a DevKit with the
       power LED removed). Battery < 3.40 V: report hourly. < 3.30 V: silent 6 h.

  RELAY role (NODE_ROLE_RELAY 1): also forwards neighbours' packets (multi-hop
  mesh, max 4 hops, duplicate cache, hub-ACK suppression). Uses light sleep with
  the radio listening — give it 2 x 18650 in parallel + a 2 W panel.

  Packet (all keys parsed by key, any value may be NA):
    AM1,ID=7C9E1A,T=SOIL,N=1043,Z=1,M1=42.5,M2=58.1,ST=26.8,AT=31.2,AH=78.4,
        LW=12,LX=54.3,EC=NA,PH=NA,NPK=NA,BV=4.02,DM1=-1.8,LWH=0.0,FLG=0,HOP=0
    FLG bits: 1 DRY · 2 WET · 4 HEAT · 8 FUNGAL · 16 LOWBAT · 32 SENSOR

  ---- PIN MAP: see BOARD_P1_SOLDERED below. P1 (as soldered): M1 35, M2 32, water S 34,
       water VCC 25, LDR AO 33 / DO 27, DS18B20 4, SHT31 21/22, battery 36, LoRa as below.
  ---------------------------- PIN MAP (BHOOMI_SN_pin, BOARD_P1_SOLDERED 0) -------
   Part                 Pin        ESP32
   SX1278 Ra-02         NSS/SCK/MISO/MOSI/RST/DIO0 -> 5 / 18 / 19 / 23 / 14 / 26
   SHT31                SDA / SCL  -> 21 / 22, VIN -> sensor rail
   DS18B20              data       -> 4  (4.7k data -> sensor rail)
   Moisture 15 cm       AOUT       -> 32
   Moisture 30 cm       AOUT       -> 33
   LDR module           AO         -> 34 (DO not connected)
   Water-level (wet)    S          -> 39 (VN)
   Battery divider      midpoint   -> 35 (100k / 100k)
   Sensor rail          VCC of all sensors -> 25
   Status LED           -> 2 (1k to LED)
   Reserved RS485 probe -> 13 (12 V enable), 16 (RX), 17 (TX), 27 (DE)
  --------------------------------------------------------------------------
  Before field use: set CALIBRATION_MODE 1 once, note dry/wet raw values,
  put them in the CALIBRATION block, then set CALIBRATION_MODE 0.
  ============================================================================
*/

#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>
#include "esp_sleep.h"
#include "esp_system.h"
#include "driver/gpio.h"

// ============================== ROLE / MODE ==============================
#define NODE_ROLE_RELAY      0      // 0 = leaf (deep sleep), 1 = relay (forwards neighbours)
#define CALIBRATION_MODE     0      // 1 = print raw sensor values every second, never sleep
#define USE_RS485_SOIL       0      // 1 = read RS485 7-in-1 probe (EC, pH, NPK) — needs the 12 V board
#define DEFAULT_ZONE         1      // field zone until the hub sends Z=

// ============================== TIMING / POWER ==============================
#define DEFAULT_REPORT_MIN   15
#define LOWBATT_REPORT_MIN   60
#define LOWBATT_V            3.40f
#define CRITICAL_V           3.30f
#define CRITICAL_SLEEP_MIN   360
#define RS485_MIN_V          3.55f
#define SENSOR_SETTLE_MS     600

// ============================== CALIBRATION (raw ADC 0–4095) ==============================
#define M1_DRY 3200
#define M1_WET 1350
#define M2_DRY 3200
#define M2_WET 1350
#define LW_DRY 50
#define LW_WET 1800
#define LDR_DARK 4000
#define LDR_BRIGHT 300

// ============================== LOCAL RULES ==============================
#define DEFAULT_DRY_PCT      35.0f  // irrigate-below moisture until the hub sends the crop's value
#define WET_M1_PCT           88.0f
#define WET_M2_PCT           80.0f
#define HEAT_C               38.0f
#define LEAF_WET_PCT         50.0f
#define FUNGAL_HOURS         6.0f
#define URGENT_DM1           8.0f   // moisture jump in one cycle that counts as an event (rain / irrigation)

// ============================== RADIO ==============================
#define LORA_FREQ       433500000L
#define LORA_SF         9
#define LORA_BW         125E3
#define LORA_CR         5
#define LORA_TX_DBM     10
#define LORA_SYNC       0x12
#define ACK_TIMEOUT_MS  1200
#define MAX_TRIES       3
#define URGENT_TRIES    5
#define MAX_HOPS        4
#define HUB_ACK_WAIT_MS 450

// ============================== RS485 ==============================
#define RS485_BAUD      9600
#define RS485_ADDR      0x01
#define REG_PH          0x0006
#define REG_EC          0x0015
#define REG_N           0x001E
#define REG_P           0x001F
#define REG_K           0x0020
#define RS485_WARMUP_MS 3000

// ============================== PINS ==============================
// BOARD_P1_SOLDERED 1 = the perfboard as actually soldered (ESP32_sensor_wiring_and_power_plan.pdf,
//                       schematic "BHOOMI Soil Node — Prototype (as soldered)", Rev P1)
// BOARD_P1_SOLDERED 0 = the BHOOMI_SN_pin layout (all sensors on the GPIO25 sensor rail)
#define BOARD_P1_SOLDERED 1

#define PIN_LORA_SCK   18
#define PIN_LORA_MISO  19
#define PIN_LORA_MOSI  23
#define PIN_LORA_NSS    5
#define PIN_LORA_RST   14
#define PIN_LORA_DIO0  26
#define PIN_SDA        21
#define PIN_SCL        22
#define PIN_ONEWIRE     4
#if BOARD_P1_SOLDERED
  #define PIN_M1         35   // soil moisture 1 (15 cm) AOUT
  #define PIN_M2         32   // soil moisture 2 (30 cm) AOUT
  #define PIN_LW         34   // water-level sensor S
  #define PIN_LDR        33   // LDR module AO
  #define PIN_LDR_DO     27   // LDR module DO (dark / bright)
  #define PIN_BATT       36   // battery divider midpoint (VP)
  #define PIN_SENSOR_PWR 25   // water-level sensor VCC only (other sensors are on permanent 3V3)
  #define PIN_12V_EN     13   // not fitted on P1
  #define PIN_RS485_RX   16
  #define PIN_RS485_TX   17
  #define PIN_RS485_DE   12   // placeholder: RS485 is not fitted on P1 (GPIO27 is used by LDR DO)
  #if USE_RS485_SOIL
    #error "The P1 board has no RS485 probe: set USE_RS485_SOIL 0"
  #endif
#else
  #define PIN_M1         32
  #define PIN_M2         33
  #define PIN_LW         39
  #define PIN_LDR        34
  #define PIN_LDR_DO     -1
  #define PIN_BATT       35
  #define PIN_SENSOR_PWR 25   // VCC of all sensors
  #define PIN_12V_EN     13
  #define PIN_RS485_RX   16
  #define PIN_RS485_TX   17
  #define PIN_RS485_DE   27
#endif
#define PIN_LED         2
#define SHT31_ADDR   0x44

// FLG bits
#define F_DRY     1
#define F_WET     2
#define F_HEAT    4
#define F_FUNGAL  8
#define F_LOWBAT 16
#define F_SENSOR 32

// ============================== STATE ==============================
// RTC memory survives deep sleep (not power loss)
RTC_DATA_ATTR uint32_t seqNo = 0;
RTC_DATA_ATTR float    lastM1 = NAN;
RTC_DATA_ATTR float    leafWetHours = 0;
RTC_DATA_ATTR uint8_t  lastFlags = 0;
RTC_DATA_ATTR uint16_t noAckRun = 0;          // consecutive cycles without any ACK

// Flash (Preferences) survives power loss: settings sent by the hub
struct Settings { float dryPct; uint16_t reportMin; uint8_t zone; } cfg;
Preferences prefs;

OneWire oneWire(PIN_ONEWIRE);
DallasTemperature ds18b20(&oneWire);
String myId;

struct Reading {
  float m1, m2, st, at, ah, lw, lx, ec, ph, bv;
  int n, p, k;
  float dm1, lwh;
  uint8_t flags;
};

// ============================== HELPERS ==============================
String chipId() {
  uint64_t mac = ESP.getEfuseMac();
  char b[7]; snprintf(b, sizeof(b), "%06X", (uint32_t)((mac >> 24) & 0xFFFFFF));
  return String(b);
}
String fmt(float v, int d) { return isnan(v) ? String("NA") : String(v, d); }
int adcAvg(int pin, int n = 16) { long s = 0; for (int i = 0; i < n; i++) { s += analogRead(pin); delay(4); } return s / n; }
float pct(int raw, int dry, int wet) {
  if (raw <= 5 || raw >= 4090) return NAN;              // unplugged / shorted
  return constrain((float)(dry - raw) * 100.0f / (float)(dry - wet), 0.0f, 100.0f);
}
float batteryV() {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) { mv += analogReadMilliVolts(PIN_BATT); delay(2); }
  float v = (mv / 16.0f) * 2.0f / 1000.0f;
  return (v < 2.5f || v > 4.6f) ? NAN : v;              // divider missing -> NA
}
void led(bool on) { digitalWrite(PIN_LED, on ? HIGH : LOW); }
void sensorRail(bool on) { gpio_hold_dis((gpio_num_t)PIN_SENSOR_PWR); pinMode(PIN_SENSOR_PWR, OUTPUT); digitalWrite(PIN_SENSOR_PWR, on ? HIGH : LOW); }
void rail12V(bool on) { gpio_hold_dis((gpio_num_t)PIN_12V_EN); pinMode(PIN_12V_EN, OUTPUT); digitalWrite(PIN_12V_EN, on ? HIGH : LOW); }

String field(const String& m, const char* key) {        // value of KEY= in an AM1/ACK string
  String k = String(",") + key + "=";
  int a = m.indexOf(k); if (a < 0) return "";
  a += k.length(); int b = m.indexOf(',', a); if (b < 0) b = m.length();
  return m.substring(a, b);
}

void loadSettings() {
  prefs.begin("bhoomi", true);
  cfg.dryPct    = prefs.getFloat("dry", DEFAULT_DRY_PCT);
  cfg.reportMin = prefs.getUShort("int", DEFAULT_REPORT_MIN);
  cfg.zone      = prefs.getUChar("zone", DEFAULT_ZONE);
  prefs.end();
}
void saveSettings() {
  prefs.begin("bhoomi", false);
  prefs.putFloat("dry", cfg.dryPct);
  prefs.putUShort("int", cfg.reportMin);
  prefs.putUChar("zone", cfg.zone);
  prefs.end();
}
// Settings piggy-backed on the hub's ACK: ACK,<ID>,<N>,HUB,DRY=35,INT=15,Z=2
void applyAckSettings(const String& ack) {
  bool changed = false;
  String v;
  v = field(ack, "DRY"); if (v.length()) { float d = v.toFloat(); if (d >= 5 && d <= 90 && fabsf(d - cfg.dryPct) > 0.05f) { cfg.dryPct = d; changed = true; } }
  v = field(ack, "INT"); if (v.length()) { int m = v.toInt(); if (m >= 1 && m <= 240 && m != cfg.reportMin) { cfg.reportMin = m; changed = true; } }
  v = field(ack, "Z");   if (v.length()) { int z = v.toInt(); if (z >= 1 && z <= 9 && z != cfg.zone) { cfg.zone = z; changed = true; } }
  if (changed) { saveSettings(); Serial.printf("Settings from hub: DRY=%.1f INT=%u Z=%u\n", cfg.dryPct, cfg.reportMin, cfg.zone); }
}

// ============================== SENSORS ==============================
uint8_t crc8(const uint8_t* d, int n) {                 // Sensirion CRC (poly 0x31, init 0xFF)
  uint8_t c = 0xFF;
  for (int i = 0; i < n; i++) { c ^= d[i]; for (int b = 0; b < 8; b++) c = (c & 0x80) ? (c << 1) ^ 0x31 : (c << 1); }
  return c;
}
bool readSHT31(float& t, float& h) {
  Wire.beginTransmission(SHT31_ADDR); Wire.write(0x24); Wire.write(0x00);   // single shot, high repeatability
  if (Wire.endTransmission() != 0) return false;
  delay(20);
  if (Wire.requestFrom((uint8_t)SHT31_ADDR, (uint8_t)6) != 6) return false;
  uint8_t b[6]; for (int i = 0; i < 6; i++) b[i] = Wire.read();
  if (crc8(b, 2) != b[2] || crc8(b + 3, 2) != b[5]) return false;
  t = -45.0f + 175.0f * ((b[0] << 8) | b[1]) / 65535.0f;
  h = 100.0f * ((b[3] << 8) | b[4]) / 65535.0f;
  return true;
}
float readDS18B20() {
  ds18b20.begin(); ds18b20.setResolution(11); ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  return (t == DEVICE_DISCONNECTED_C || t < -40 || t > 85) ? NAN : t;
}

uint16_t crc16(const uint8_t* b, int n) {
  uint16_t c = 0xFFFF;
  for (int i = 0; i < n; i++) { c ^= b[i]; for (int j = 0; j < 8; j++) c = (c & 1) ? (c >> 1) ^ 0xA001 : (c >> 1); }
  return c;
}
bool mbRead(uint16_t reg, uint16_t& val) {
  for (int attempt = 0; attempt < 3; attempt++) {
    uint8_t q[8] = {RS485_ADDR, 0x03, (uint8_t)(reg >> 8), (uint8_t)(reg & 0xFF), 0x00, 0x01, 0, 0};
    uint16_t c = crc16(q, 6); q[6] = c & 0xFF; q[7] = c >> 8;
    while (Serial2.available()) Serial2.read();
    digitalWrite(PIN_RS485_DE, HIGH); delayMicroseconds(100);
    Serial2.write(q, 8); Serial2.flush();
    digitalWrite(PIN_RS485_DE, LOW);
    uint8_t r[7]; int got = 0; unsigned long t0 = millis();
    while (got < 7 && millis() - t0 < 400) { if (Serial2.available()) r[got++] = Serial2.read(); }
    if (got == 7 && r[0] == RS485_ADDR && r[1] == 0x03 && r[2] == 2) {
      uint16_t rc = crc16(r, 5);
      if (r[5] == (rc & 0xFF) && r[6] == (rc >> 8)) { val = (r[3] << 8) | r[4]; return true; }
    }
    delay(60);
  }
  return false;
}
void readSoilProbe(Reading& r) {
  r.ec = r.ph = NAN; r.n = r.p = r.k = -1;
#if USE_RS485_SOIL
  if (!isnan(r.bv) && r.bv < RS485_MIN_V) { Serial.println("RS485 probe skipped: battery low"); return; }
  rail12V(true);
  pinMode(PIN_RS485_DE, OUTPUT); digitalWrite(PIN_RS485_DE, LOW);
  Serial2.begin(RS485_BAUD, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
  delay(RS485_WARMUP_MS);
  uint16_t v;
  if (mbRead(REG_PH, v)) r.ph = v / 100.0f;
  if (mbRead(REG_EC, v)) r.ec = v / 1000.0f;           // µS/cm -> dS/m
  if (mbRead(REG_N, v))  r.n = v;
  if (mbRead(REG_P, v))  r.p = v;
  if (mbRead(REG_K, v))  r.k = v;
  Serial2.end();
  rail12V(false);
#endif
}

Reading readAll() {
  Reading r;
  r.bv = batteryV();
  sensorRail(true);
  delay(SENSOR_SETTLE_MS);
  r.m1 = pct(adcAvg(PIN_M1), M1_DRY, M1_WET);
  r.m2 = pct(adcAvg(PIN_M2), M2_DRY, M2_WET);
  { int w = adcAvg(PIN_LW); r.lw = constrain((float)(w - LW_DRY) * 100.0f / (float)(LW_WET - LW_DRY), 0.0f, 100.0f); }
  { int l = adcAvg(PIN_LDR); r.lx = constrain((float)(LDR_DARK - l) * 100.0f / (float)(LDR_DARK - LDR_BRIGHT), 0.0f, 100.0f); }
  r.st = readDS18B20();
  Wire.begin(PIN_SDA, PIN_SCL);
  if (!readSHT31(r.at, r.ah)) { r.at = NAN; r.ah = NAN; }
  Wire.end();
  sensorRail(false);
  readSoilProbe(r);
  return r;
}

// ============================== ON-NODE PROCESSING ==============================
// minutesSinceLast = time covered by this reading (for leaf-wet hours)
void processReading(Reading& r, float minutesSinceLast) {
  // 1. moisture trend
  r.dm1 = (!isnan(r.m1) && !isnan(lastM1)) ? r.m1 - lastM1 : NAN;
  if (!isnan(r.m1)) lastM1 = r.m1;

  // 2. leaf-wet duration: grows while wet, resets when leaves dry
  if (r.lw > LEAF_WET_PCT) leafWetHours += minutesSinceLast / 60.0f;
  else leafWetHours = 0;
  if (leafWetHours > 99) leafWetHours = 99;
  r.lwh = leafWetHours;

  // 3. local flags
  uint8_t f = 0;
  if (!isnan(r.m1) && r.m1 < cfg.dryPct) f |= F_DRY;
  if (!isnan(r.m1) && !isnan(r.m2) && r.m1 > WET_M1_PCT && r.m2 > WET_M2_PCT) f |= F_WET;
  if (!isnan(r.at) && r.at > HEAT_C) f |= F_HEAT;
  if (leafWetHours >= FUNGAL_HOURS && !isnan(r.at) && r.at >= 18 && r.at <= 32 && !isnan(r.ah) && r.ah > 85) f |= F_FUNGAL;
  if (!isnan(r.bv) && r.bv < LOWBATT_V) f |= F_LOWBAT;
  if (isnan(r.m1) || isnan(r.m2) || isnan(r.st) || isnan(r.at)) f |= F_SENSOR;
  r.flags = f;
}
// A packet is urgent when a new problem appears or moisture jumps (rain/irrigation)
bool isUrgent(const Reading& r) {
  uint8_t newFlags = r.flags & ~lastFlags & (F_DRY | F_WET | F_HEAT | F_FUNGAL);
  return newFlags || (!isnan(r.dm1) && fabsf(r.dm1) >= URGENT_DM1);
}

String buildPacket(const Reading& r) {
  String npk = (r.n < 0 || r.p < 0 || r.k < 0) ? String("NA") : String(r.n) + "-" + String(r.p) + "-" + String(r.k);
  String s = "AM1,ID=" + myId + ",T=SOIL,N=" + String(seqNo) + ",Z=" + String(cfg.zone);
  s += ",M1=" + fmt(r.m1, 1) + ",M2=" + fmt(r.m2, 1) + ",ST=" + fmt(r.st, 1);
  s += ",AT=" + fmt(r.at, 1) + ",AH=" + fmt(r.ah, 1) + ",LW=" + fmt(r.lw, 0) + ",LX=" + fmt(r.lx, 1);
  s += ",EC=" + fmt(r.ec, 2) + ",PH=" + fmt(r.ph, 1) + ",NPK=" + npk + ",BV=" + fmt(r.bv, 2);
  s += ",DM1=" + fmt(r.dm1, 1) + ",LWH=" + String(r.lwh, 1) + ",FLG=" + String(r.flags) + ",HOP=0";
  return s;
}

// ============================== RADIO ==============================
bool radioInit() {
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) return false;
  LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(LORA_CR);
  LoRa.setTxPower(LORA_TX_DBM); LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc();
  return true;
}
bool takePacket(String& out) {
  int len = LoRa.parsePacket(); if (len <= 0) return false;
  out = ""; while (LoRa.available()) out += (char)LoRa.read();
  return true;
}
void sendRaw(const String& s) { LoRa.idle(); LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket(); }
void sendAck(const String& id, const String& n) { sendRaw(String("ACK,") + id + "," + n + "," + myId); }

// Send and wait for ACK,<id>,<n>,<who>[,settings]. Returns the ACK text ("" = none).
String sendWithAck(const String& pkt, const String& id, const String& n, int tries) {
  String want = String("ACK,") + id + "," + n + ",";
  for (int a = 0; a < tries; a++) {
    led(true); sendRaw(pkt); led(false);
    Serial.printf("TX try %d: %s\n", a + 1, pkt.c_str());
    LoRa.receive();
    unsigned long t0 = millis();
    while (millis() - t0 < ACK_TIMEOUT_MS) {
      if (digitalRead(PIN_LORA_DIO0)) {
        String m;
        if (takePacket(m) && m.startsWith(want)) { Serial.printf("ACK: %s\n", m.c_str()); return m; }
        LoRa.receive();
      }
      delay(2);
    }
    delay(random(200, 800) * (a + 1));                  // back-off before retry
  }
  Serial.println("No ACK: packet not confirmed");
  return "";
}

// ---- relay: managed flooding with hub-ACK suppression and duplicate cache
uint32_t seenCache[32]; int seenIdx = 0;
uint32_t keyOf(const String& id, const String& n) { uint32_t h = 2166136261u; for (unsigned i = 0; i < id.length(); i++) { h ^= (uint8_t)id[i]; h *= 16777619u; } return h ^ (uint32_t)(n.toInt() * 2654435761u); }
bool seenBefore(uint32_t k) { for (int i = 0; i < 32; i++) if (seenCache[i] == k) return true; seenCache[seenIdx] = k; seenIdx = (seenIdx + 1) % 32; return false; }

void handleIncoming(const String& m) {
  if (!m.startsWith("AM1,")) return;                     // ignore ACKs and foreign traffic
  String id = field(m, "ID"), n = field(m, "N");
  if (id.length() == 0 || id == myId) return;
  int hop = field(m, "HOP").toInt();
  if (seenBefore(keyOf(id, n)) || hop >= MAX_HOPS) return;
  // 1) if the hub already acknowledged the sender, nothing to do
  String hubAck = String("ACK,") + id + "," + n + ",HUB";
  LoRa.receive(); unsigned long t0 = millis();
  while (millis() - t0 < HUB_ACK_WAIT_MS) {
    if (digitalRead(PIN_LORA_DIO0)) { String a; if (takePacket(a) && a.startsWith(hubAck)) { LoRa.receive(); return; } LoRa.receive(); }
    delay(2);
  }
  // 2) hub did not answer: ACK the sender ourselves and forward with HOP+1
  sendAck(id, n);
  int p = m.lastIndexOf(",HOP=");
  String fwd = (p >= 0 ? m.substring(0, p) : m) + ",HOP=" + String(hop + 1);
  delay(random(60, 300));
  Serial.printf("Relaying %s #%s (hop %d)\n", id.c_str(), n.c_str(), hop + 1);
  sendWithAck(fwd, id, n, MAX_TRIES);
  LoRa.receive();
}

// ============================== CYCLE ==============================
uint32_t intervalMin(float bv) { return (!isnan(bv) && bv < LOWBATT_V) ? LOWBATT_REPORT_MIN : cfg.reportMin; }

void measureAndSend(bool radioReady, float minutesSinceLast) {
  seqNo++;
  Reading r = readAll();
  processReading(r, minutesSinceLast);
  bool urgent = isUrgent(r);
  String pkt = buildPacket(r);
  Serial.printf("\nNode %s zone %u reading #%lu  flags=%u%s\n", myId.c_str(), cfg.zone, (unsigned long)seqNo, r.flags, urgent ? "  URGENT" : "");
  if (radioReady || radioInit()) {
    String ack = sendWithAck(pkt, myId, String(seqNo), urgent ? URGENT_TRIES : MAX_TRIES);
    if (ack.length()) { applyAckSettings(ack); noAckRun = 0; lastFlags = r.flags; }
    else if (noAckRun < 65535) noAckRun++;               // keep lastFlags so the alert is re-sent as urgent next time
  } else {
    Serial.println("LoRa init FAILED — check wiring and antenna");
  }
}

void goDeepSleep(uint32_t minutes) {
  LoRa.sleep();
  sensorRail(false); rail12V(false);
  gpio_hold_en((gpio_num_t)PIN_SENSOR_PWR); gpio_hold_en((gpio_num_t)PIN_12V_EN);
  gpio_deep_sleep_hold_en();
  uint64_t us = ((uint64_t)minutes * 60ULL + (esp_random() % 10)) * 1000000ULL;   // jitter avoids collisions
  Serial.printf("Deep sleep %lu min\n", (unsigned long)minutes); Serial.flush();
  esp_sleep_enable_timer_wakeup(us);
  esp_deep_sleep_start();
}

void calibrationLoop() {
  sensorRail(true); delay(SENSOR_SETTLE_MS); Wire.begin(PIN_SDA, PIN_SCL);
  Serial.println("CALIBRATION MODE — note raw values dry and wet, then set CALIBRATION_MODE 0");
  while (true) {
    float t = NAN, h = NAN; readSHT31(t, h);
    Serial.printf("M1 raw %4d | M2 raw %4d | WET raw %4d | LDR raw %4d DO %d | DS18B20 %.1f C | SHT31 %.1f C %.0f %% | batt %.2f V\n",
                  adcAvg(PIN_M1), adcAvg(PIN_M2), adcAvg(PIN_LW), adcAvg(PIN_LDR), PIN_LDR_DO >= 0 ? digitalRead(PIN_LDR_DO) : -1,
                  readDS18B20(), t, h, batteryV());
    delay(1000);
  }
}

// RTC memory holds the last sleep length so leaf-wet hours count real time
RTC_DATA_ATTR uint32_t lastSleepMin = DEFAULT_REPORT_MIN;

void setup() {
  Serial.begin(115200); delay(150);
  pinMode(PIN_LED, OUTPUT); led(false);
  if (PIN_LDR_DO >= 0) pinMode(PIN_LDR_DO, INPUT);
  analogReadResolution(12); analogSetAttenuation(ADC_11db);
  gpio_hold_dis((gpio_num_t)PIN_SENSOR_PWR); gpio_hold_dis((gpio_num_t)PIN_12V_EN);
  rail12V(false);
  myId = chipId();
  randomSeed(esp_random());
  loadSettings();
  if (esp_reset_reason() != ESP_RST_DEEPSLEEP) {        // fresh power-up
    seqNo = 1000 + (esp_random() % 50000);              // avoid the hub's duplicate cache after a reset
    lastM1 = NAN; leafWetHours = 0; lastFlags = 0; noAckRun = 0; lastSleepMin = cfg.reportMin;
    Serial.printf("\nBHOOMI Soil Node v3.1  ID=%s  zone=%u  dry<%.0f%%  every %u min\n", myId.c_str(), cfg.zone, cfg.dryPct, cfg.reportMin);
  }
#if CALIBRATION_MODE
  calibrationLoop();
#endif
#if NODE_ROLE_RELAY
  if (!radioInit()) Serial.println("LoRa init FAILED");
  Serial.printf("BHOOMI RELAY node %s started\n", myId.c_str());
#else
  float bv0 = batteryV();
  if (!isnan(bv0) && bv0 < CRITICAL_V) {                 // nearly empty: stay silent, let the sun recharge it
    Serial.printf("Battery critical (%.2f V) — sleeping %d min\n", bv0, CRITICAL_SLEEP_MIN);
    lastSleepMin = CRITICAL_SLEEP_MIN;
    goDeepSleep(CRITICAL_SLEEP_MIN);
  }
  measureAndSend(false, (float)lastSleepMin);
  lastSleepMin = intervalMin(batteryV());
  goDeepSleep(lastSleepMin);
#endif
}

// loop() runs only on relay nodes: light sleep with the radio listening
void loop() {
#if NODE_ROLE_RELAY
  static uint32_t nextReadMs = 0, lastReadMs = 0;
  if ((int32_t)(millis() - nextReadMs) >= 0) {
    float mins = lastReadMs ? (millis() - lastReadMs) / 60000.0f : (float)cfg.reportMin;
    lastReadMs = millis();
    measureAndSend(true, mins);
    nextReadMs = millis() + intervalMin(batteryV()) * 60000UL;
  }
  LoRa.receive();
  if (!digitalRead(PIN_LORA_DIO0)) {
    int32_t waitMs = (int32_t)(nextReadMs - millis());
    if (waitMs < 5) return;
    esp_sleep_enable_timer_wakeup((uint64_t)waitMs * 1000ULL);
    esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_LORA_DIO0, 1);
    Serial.flush();
    esp_light_sleep_start();
  }
  if (digitalRead(PIN_LORA_DIO0)) {
    String m;
    if (takePacket(m)) handleIncoming(m);
  }
#endif
}
