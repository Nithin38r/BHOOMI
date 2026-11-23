/*
  =====================================================================
   BHOOMI POND NODE  -  single-board hackathon prototype  (v2.1)
   Node of the AgriMesh farm LoRa network
   HackWithAditya 2026 - AgriTech & Aquaculture track
  =====================================================================
   One ESP32 does everything the two-board design did:
     - measures DO (mg/L + % sat), pH and water temperature
     - runs the aeration rule locally (no hub / internet needed)
     - drives a 5 V air pump (stands in for the paddle-wheel aerator)
       through an opto relay and checks the pump current with an INA219
     - shows live values on a 0.96" OLED, beeps on alarms
     - talks to the AgriMesh hub over LoRa (AM1 packets, commands + ACK)

   Board : ESP32-DevKitC (ESP32-WROOM-32), "ESP32 Dev Module"
   Core  : Arduino-ESP32 3.0.x (2.0.x supported)
   Libraries (Library Manager):
     LoRa (Sandeep Mistry) | Adafruit ADS1X15 | OneWire | DallasTemperature
     RTClib (Adafruit) | Adafruit SSD1306 | Adafruit GFX | Adafruit INA219
     (Adafruit BusIO is installed automatically)

   Serial 115200, line ending "Newline". Type "help".

   DEMO MODE (default ON for judging): same logic, short timers so a
   full cycle fits in a few minutes. "demo off" = real pond timings.
                       real pond     demo
     sample (day)      15 min        20 s
     sample (night /
       DO < 5 mg/L)     5 min        10 s
     min pump ON       20 min        60 s
     min pump OFF       5 min        20 s
     current check     30 s           5 s
     DO-trend window   30 min       120 s

   v2.1: a hub command line (AM1,...,T=CMD,DST=<this node>,...) typed or
         sent over USB serial is handled exactly like one received over
         LoRa. With the digital-twin backend on a laptop (SERIAL_PORT=...)
         the node is then fully two-way over USB, no LoRa hub needed.
         Nothing else changed.

   v2.0 fixes compared with the two-board firmware:
     - DO "stuck" (FLT 3) now uses the raw signal (1 ADC step), so calm
       water no longer raises a false alarm
     - pH "not responding" (FLT 5) uses raw mV and a bigger DO swing, so
       a stable bucket no longer raises a false alarm
     - DO "no signal" (FLT 1) threshold follows the zero calibration,
       so a real 0 mg/L is not mistaken for a cut cable after zero-cal
     - hub command de-duplication expires after 60 s (a restarted hub
       reusing N=1 is no longer ignored)
     - calibration happens in SERVICE mode: sampling, alarms and the
       pump rule pause, so probes out of water cannot trip the pump
     - FLT 5 latches until 'service off', so a fouled probe does not
       send a new alert every time the condition flickers
     - every blocking wait feeds the watchdog
  =====================================================================
*/

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_INA219.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <RTClib.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "esp_arduino_version.h"

// =====================================================================
//                               CONFIG
// =====================================================================
#define FW_VERSION          "2.1"
#define START_IN_DEMO       true     // hackathon default; "demo off" for real timings

// ---- LoRa (identical on every AgriMesh node) ----
#define LORA_FREQ_HZ        865062500UL   // 865.0625 MHz
#define LORA_SF             9
#define LORA_BW_HZ          125E3
#define LORA_CR_DENOM       5
#define LORA_SYNC_WORD      0x12
#define LORA_TX_DBM         14
#define MESH_RELAY          false         // true = repeat other AgriMesh packets

// ---- Pins ----
#define PIN_LORA_SCK        18
#define PIN_LORA_MISO       19
#define PIN_LORA_MOSI       23
#define PIN_LORA_NSS        5
#define PIN_LORA_RST        14
#define PIN_LORA_DIO0       26
#define PIN_I2C_SDA         21            // ADS1115 0x48, INA219 0x40, OLED 0x3C, DS3231 0x68
#define PIN_I2C_SCL         22
#define PIN_ONEWIRE         4             // DS18B20 (4.7k pull-up to 3V3)
#define PIN_RELAY           32            // relay IN, ACTIVE LOW -> pump
#define PIN_BUTTON          33            // push button to GND (internal pull-up)
#define PIN_LED_GREEN       2             // pump / heartbeat
#define PIN_LED_RED         25            // any fault
#define PIN_BUZZER          13            // active buzzer module (HIGH = beep)

#define RELAY_ON_LEVEL      LOW
#define RELAY_OFF_LEVEL     HIGH

// ---- ADS1115 ----
#define ADS_ADDR            0x48
#define ADS_CH_DO           0             // A0 <- DO isolator OUT
#define ADS_CH_PH           1             // A1 <- pH isolator OUT

// ---- Aeration rule ----
#define DEFAULT_DO_ON_BELOW   4.0f        // mg/L
#define DEFAULT_DO_OFF_ABOVE  6.0f
#define DO_FAST_BELOW         5.0f        // sample faster below this
#define DO_ALARM_BELOW        3.0f        // buzzer
#define DO_TREND_DROP         0.15f       // FLT 11
#define PUMP_MIN_MA           50.0f       // FLT 10 (5 V mini pump draws 150-400 mA)
#define SUPPLY_LOW_V          4.60f       // FLT 7 (USB / power bank sagging)

// ---- Sensors ----
#define DO_MAX_VALID        20.0f
#define DO_MAX_JUMP         3.0f
#define DO_RAIL_MV          3200.0f
#define DO_TEMP_COEF        0.030f        // galvanic membrane: 3 % per degC
#define FALLBACK_WATER_C    28.0f
#define CAL_DUE_DAYS        14

// ---- Time ----
#define TZ_OFFSET_S         19800         // IST
#define NIGHT_START_H       18
#define NIGHT_END_H         7

// ---- Fault codes (same table as the twin and the hub) ----
#define FLT_DO_NOSIGNAL     1
#define FLT_DO_IMPLAUSIBLE  2
#define FLT_DO_STUCK        3
#define FLT_PH_RANGE        4
#define FLT_PH_STUCK        5
#define FLT_TEMP            6
#define FLT_SUPPLY_LOW      7
#define FLT_PUMP_NO_CURRENT 10
#define FLT_DO_FALLING      11

struct Timing {
  uint32_t sampleDay, sampleNight, minOn, minOff, currentCheck, trendWindow, mute;   // ms
};
const Timing REAL_T = { 900000UL, 300000UL, 1200000UL, 300000UL, 30000UL, 1800000UL, 1800000UL };
const Timing DEMO_T = {  20000UL,  10000UL,   60000UL,  20000UL,  5000UL,  120000UL,   60000UL };

// =====================================================================
//                               OBJECTS
// =====================================================================
Adafruit_ADS1115 ads;
Adafruit_INA219  ina(0x40);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
OneWire          oneWire(PIN_ONEWIRE);
DallasTemperature ds(&oneWire);
RTC_DS3231       rtc;
Preferences      prefs;

bool adsOk = false, inaOk = false, oledOk = false, rtcOk = false, loraOk = false;
String myId;

// =====================================================================
//                                STATE
// =====================================================================
enum Mode { M_AUTO, M_ON, M_OFF };
const char* modeName(Mode m) { return m == M_ON ? "ON" : m == M_OFF ? "OFF" : "AUTO"; }

struct Cal {
  float doV0, doVsat, doTcal; bool doZeroSet; uint32_t doTs;
  float phV7, phPH7, phSlope, phTcal; uint32_t phTs;
  float salinity; bool calibrated;
} cal;

struct Reading {
  float doMv, phMv, wt, doMgL, doSat, ph; bool wtOk;
} R, SV;                      // R = last scheduled sample, SV = service-mode live view
void readSensors(Reading& R);   // explicit prototype (struct parameter)

bool     demo = START_IN_DEMO;
const Timing* T = &DEMO_T;
Mode     mode = M_AUTO;
float    doOnBelow = DEFAULT_DO_ON_BELOW, doOffAbove = DEFAULT_DO_OFF_ABOVE;

// sample history (for fault checks)
#define HIST_N 10
float    hDO[HIST_N], hDoMv[HIST_N], hPhMv[HIST_N]; uint32_t hMs[HIST_N]; uint8_t hN = 0;

bool     haveSample = false;
float    lastGoodDO = 8.0f;
uint32_t faultMask = 0, lastSentMask = 0;
bool     doInvalid = true;
uint32_t seq = 0;
uint32_t nextSampleMs = 0;
bool     tempRequested = false;

// pump
bool     pumpOn = false;
uint32_t lastChangeMs = 0, onAtMs = 0;
float    pumpMa = 0, supplyV = 0;
#define DOLOG_N 24
uint32_t dlT[DOLOG_N]; float dlV[DOLOG_N]; uint8_t dlN = 0;
String   decision = "-", holdText = "";

// UI
bool     serviceMode = false, liveMode = false;
uint32_t muteUntil = 0;
long     lastCmdN = -1; uint32_t lastCmdMs = 0; String lastCmdAck;
uint32_t lastTxMs = 0, txCount = 0, rxCount = 0;
int      lastRssi = 0;

// =====================================================================
//                               HELPERS
// =====================================================================
String chipId6() {
  uint64_t mac = ESP.getEfuseMac(); uint32_t id = 0;
  for (int i = 0; i < 17; i += 8) id |= ((mac >> (40 - i)) & 0xFF) << i;
  char b[7]; snprintf(b, sizeof(b), "%06X", (unsigned)(id & 0xFFFFFF)); return String(b);
}
String getField(const String& p, const char* key) {
  String k = String(",") + key + "="; int i = p.indexOf(k); if (i < 0) return "";
  i += k.length(); int j = p.indexOf(',', i); return j < 0 ? p.substring(i) : p.substring(i, j);
}
bool hasField(const String& p, const char* key) { return p.indexOf(String(",") + key + "=") >= 0; }

uint32_t syncEpoch = 0, syncMs = 0;
uint32_t nowEpoch() {
  if (rtcOk) return rtc.now().unixtime();
  if (syncEpoch) return syncEpoch + (millis() - syncMs) / 1000UL;
  return 0;
}
bool timeValid() { return nowEpoch() > 1700000000UL; }
int  localHour() { return (int)(((nowEpoch() + TZ_OFFSET_S) % 86400UL) / 3600UL); }
bool isNight()   { if (!timeValid()) return true; int h = localHour(); return h >= NIGHT_START_H || h < NIGHT_END_H; }
void setEpoch(uint32_t e) { if (rtcOk) rtc.adjust(DateTime(e)); syncEpoch = e; syncMs = millis(); }
String clockText() {
  if (!timeValid()) return "--:--";
  uint32_t l = nowEpoch() + TZ_OFFSET_S; char b[6];
  snprintf(b, sizeof(b), "%02lu:%02lu", (unsigned long)((l % 86400UL) / 3600UL), (unsigned long)((l % 3600UL) / 60UL));
  return String(b);
}
String fmtSec(uint32_t ms) { uint32_t s = (ms + 999) / 1000; return s < 120 ? String(s) + " s" : String((s + 59) / 60) + " min"; }

void feedWdt() { esp_task_wdt_reset(); }

float doSaturation(float tC, float salPpt) {        // Benson & Krause, mg/L at 1 atm
  float K = tC + 273.15f;
  float ln = -139.34411f + 1.575701e5f / K - 6.642308e7f / (K * K) + 1.2438e10f / (K * K * K) - 8.621949e11f / (K * K * K * K);
  ln -= salPpt * (0.017674f - 10.754f / K + 2140.7f / (K * K));
  return expf(ln);
}
float medianOf(float* a, int n) {
  for (int i = 1; i < n; i++) { float v = a[i]; int j = i - 1; while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; } a[j + 1] = v; }
  return (n % 2) ? a[n / 2] : 0.5f * (a[n / 2 - 1] + a[n / 2]);
}
float adsMv(uint8_t ch, int n = 11) {
  if (!adsOk) return 0;
  float v[15]; if (n > 15) n = 15;
  for (int i = 0; i < n; i++) { v[i] = ads.computeVolts(ads.readADC_SingleEnded(ch)) * 1000.0f; }
  return medianOf(v, n);
}

// =====================================================================
//                          SETTINGS (NVS)
// =====================================================================
void loadSettings() {
  prefs.begin("bhoomi", true);
  cal.doV0 = prefs.getFloat("doV0", 0.0f);     cal.doVsat = prefs.getFloat("doVsat", 1600.0f);
  cal.doTcal = prefs.getFloat("doTcal", 25.0f); cal.doZeroSet = prefs.getBool("doZero", false);
  cal.doTs = prefs.getUInt("doTs", 0);
  cal.phV7 = prefs.getFloat("phV7", 1500.0f);  cal.phPH7 = prefs.getFloat("phPH7", 6.86f);
  cal.phSlope = prefs.getFloat("phSlope", -177.3f); cal.phTcal = prefs.getFloat("phTcal", 25.0f);
  cal.phTs = prefs.getUInt("phTs", 0);
  cal.salinity = prefs.getFloat("sal", 2.0f);  cal.calibrated = prefs.getBool("calOk", false);
  doOnBelow = prefs.getFloat("lo", DEFAULT_DO_ON_BELOW); doOffAbove = prefs.getFloat("hi", DEFAULT_DO_OFF_ABOVE);
  demo = prefs.getBool("demo", START_IN_DEMO);
  prefs.end();
  T = demo ? &DEMO_T : &REAL_T;
}
void saveSettings() {
  prefs.begin("bhoomi", false);
  prefs.putFloat("doV0", cal.doV0); prefs.putFloat("doVsat", cal.doVsat); prefs.putFloat("doTcal", cal.doTcal);
  prefs.putBool("doZero", cal.doZeroSet); prefs.putUInt("doTs", cal.doTs);
  prefs.putFloat("phV7", cal.phV7); prefs.putFloat("phPH7", cal.phPH7); prefs.putFloat("phSlope", cal.phSlope);
  prefs.putFloat("phTcal", cal.phTcal); prefs.putUInt("phTs", cal.phTs);
  prefs.putFloat("sal", cal.salinity); prefs.putBool("calOk", cal.calibrated);
  prefs.putFloat("lo", doOnBelow); prefs.putFloat("hi", doOffAbove); prefs.putBool("demo", demo);
  prefs.end();
}
void setDemo(bool on) {
  demo = on; T = demo ? &DEMO_T : &REAL_T; saveSettings();
  nextSampleMs = millis() + 2000; tempRequested = false;
  Serial.printf("Demo mode %s\n", demo ? "ON (short timers)" : "OFF (real pond timers)");
}

// =====================================================================
//                         MEASUREMENT
// =====================================================================
void readSensors(Reading& R) {               // temperature must be requested ~1 s earlier
  float t = ds.getTempCByIndex(0);
  R.wtOk = !(t == DEVICE_DISCONNECTED_C || t < -5.0f || t > 50.0f || t == 85.0f);
  R.wt = R.wtOk ? t : -127.0f;
  float tc = R.wtOk ? t : FALLBACK_WATER_C;
  R.doMv = adsMv(ADS_CH_DO);
  R.phMv = adsMv(ADS_CH_PH);
  float span = (cal.doVsat - cal.doV0) * (1.0f + DO_TEMP_COEF * (tc - cal.doTcal));
  float frac = span > 1.0f ? (R.doMv - cal.doV0) / span : 0.0f;
  if (frac < 0) frac = 0;
  R.doSat = frac * 100.0f;
  R.doMgL = frac * doSaturation(tc, cal.salinity);
  float slopeT = cal.phSlope * (tc + 273.15f) / (cal.phTcal + 273.15f);
  R.ph = cal.phPH7 + (R.phMv - cal.phV7) / slopeT;
}

void pushHistory() {
  if (hN == HIST_N) { for (int i = 1; i < HIST_N; i++) { hDO[i-1] = hDO[i]; hDoMv[i-1] = hDoMv[i]; hPhMv[i-1] = hPhMv[i]; hMs[i-1] = hMs[i]; } hN--; }
  hDO[hN] = R.doMgL; hDoMv[hN] = R.doMv; hPhMv[hN] = R.phMv; hMs[hN] = millis(); hN++;
}

uint32_t sensorFaults() {
  uint32_t m = 0;
  if (!R.wtOk) m |= 1UL << FLT_TEMP;
  float noSig = max(0.5f, 0.5f * cal.doV0);                    // follows the zero calibration
  if (R.doMv < noSig) m |= 1UL << FLT_DO_NOSIGNAL;
  else {
    bool jump = false;
    if (hN >= 2) {
      uint32_t dt = hMs[hN - 1] - hMs[hN - 2];
      jump = hDO[hN - 2] > 0.5f && fabsf(R.doMgL - hDO[hN - 2]) > DO_MAX_JUMP && dt <= 1200000UL;
    }
    if (R.doMgL > DO_MAX_VALID || R.doMv >= DO_RAIL_MV || jump) m |= 1UL << FLT_DO_IMPLAUSIBLE;
    if (hN >= 6) {                                             // raw signal frozen within 1 ADC step
      float mn = 1e9, mx = -1e9;
      for (int i = hN - 6; i < hN; i++) { mn = min(mn, hDoMv[i]); mx = max(mx, hDoMv[i]); }
      if (mx - mn < 0.13f) m |= 1UL << FLT_DO_STUCK;
    }
  }
  float phNow = R.ph;
  if (phNow < 2.0f || phNow > 12.0f) m |= 1UL << FLT_PH_RANGE;
  else if (hN >= HIST_N) {                                      // electrode not reacting while DO swings
    float pmn = 1e9, pmx = -1e9, dmn = 1e9, dmx = -1e9;
    for (int i = 0; i < HIST_N; i++) { pmn = min(pmn, hPhMv[i]); pmx = max(pmx, hPhMv[i]); dmn = min(dmn, hDO[i]); dmx = max(dmx, hDO[i]); }
    if (pmx - pmn < 0.5f && dmx - dmn > 1.0f) m |= 1UL << FLT_PH_STUCK;
  }
  if (inaOk && supplyV > 1.0f && supplyV < SUPPLY_LOW_V) m |= 1UL << FLT_SUPPLY_LOW;
  return m;
}

uint8_t topFault(uint32_t m) {
  const uint8_t pri[] = { FLT_DO_FALLING, FLT_PUMP_NO_CURRENT, FLT_DO_NOSIGNAL, FLT_DO_IMPLAUSIBLE, FLT_DO_STUCK,
                          FLT_PH_RANGE, FLT_PH_STUCK, FLT_TEMP, FLT_SUPPLY_LOW };
  for (uint8_t c : pri) if (m & (1UL << c)) return c;
  return 0;
}
const char* faultShort(uint8_t f) {
  switch (f) {
    case 1: return "DO PROBE?"; case 2: return "DO ODD"; case 3: return "DO STUCK";
    case 4: return "PH PROBE?"; case 5: return "PH FOULED"; case 6: return "TEMP SENS";
    case 7: return "SUPPLY LOW"; case 10: return "PUMP FAIL"; case 11: return "DO FALLING";
    default: return "OK";
  }
}
const uint32_t SENSOR_MASK = (1UL<<1)|(1UL<<2)|(1UL<<3)|(1UL<<4)|(1UL<<5)|(1UL<<6)|(1UL<<7);
const uint32_t DO_BAD_MASK = (1UL<<1)|(1UL<<2)|(1UL<<3);

// =====================================================================
//                               LoRa
// =====================================================================
bool loraStart() {
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) return false;
  LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW_HZ); LoRa.setCodingRate4(LORA_CR_DENOM);
  LoRa.setSyncWord(LORA_SYNC_WORD); LoRa.enableCrc(); LoRa.setTxPower(LORA_TX_DBM);
  return true;
}
void loraSend(const String& s) {
  Serial.print(F("TX> ")); Serial.println(s);
  if (!loraOk) return;
  LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket();
  lastTxMs = millis(); txCount++;
}
void sendPond() {
  seq++;
  char p[200];
  snprintf(p, sizeof(p), "AM1,ID=%s,T=POND,N=%lu,DO=%.2f,DOS=%.0f,PH=%.2f,WT=%.1f,AER=%u,AERI=%.2f,BV=%.2f,FLT=%u",
           myId.c_str(), (unsigned long)seq, R.doMgL, R.doSat, R.ph, R.wt, pumpOn ? 1 : 0, pumpMa / 1000.0f, supplyV, topFault(faultMask));
  loraSend(p);
  lastSentMask = faultMask;
}
String daysAgo(uint32_t ts) { if (!ts || !timeValid()) return "NA"; return String((nowEpoch() - ts) / 86400UL); }
void sendCal() {
  String due = "NA";
  if (timeValid() && cal.doTs && cal.phTs) due = String((int)CAL_DUE_DAYS - (int)((nowEpoch() - min(cal.doTs, cal.phTs)) / 86400UL));
  loraSend("AM1,ID=" + myId + ",T=CAL,N=" + String(seq) + ",DOCAL=" + daysAgo(cal.doTs) + ",DOZERO=" + String(cal.doZeroSet ? 1 : 0) +
           ",DOVSAT=" + String(cal.doVsat, 1) + ",PHCAL=" + daysAgo(cal.phTs) + ",PHSLOPE=" + String(cal.phSlope, 1) +
           ",PH7V=" + String(cal.phV7, 1) + ",SAL=" + String(cal.salinity, 1) + ",DUE=" + due + ",CALOK=" + String(cal.calibrated ? 1 : 0));
}

// =====================================================================
//                               PUMP
// =====================================================================
void readPump() {
  if (!inaOk) { pumpMa = 0; supplyV = 0; return; }
  float ma = ina.getCurrent_mA();
  pumpMa = ma < 5.0f ? 0.0f : ma;                             // ignore offset noise
  supplyV = ina.getBusVoltage_V() + ina.getShuntVoltage_mV() / 1000.0f;
}
void setPump(bool on) {
  digitalWrite(PIN_RELAY, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
  pumpOn = on; lastChangeMs = millis();
  if (on) { onAtMs = millis(); dlN = 0; if (haveSample && !doInvalid) { dlT[0] = millis(); dlV[0] = R.doMgL; dlN = 1; } }
  else faultMask &= ~((1UL << FLT_PUMP_NO_CURRENT) | (1UL << FLT_DO_FALLING));
  Serial.printf("[%s] PUMP %s  (%s)\n", clockText().c_str(), on ? "ON" : "OFF", decision.c_str());
  sendPond();                                                  // tell the hub at once
}
void logDO(float v) {
  if (dlN == DOLOG_N) { for (int i = 1; i < DOLOG_N; i++) { dlT[i-1] = dlT[i]; dlV[i-1] = dlV[i]; } dlN--; }
  dlT[dlN] = millis(); dlV[dlN] = v; dlN++;
}
void checkTrend() {                                            // FLT 11
  if (!pumpOn || millis() - onAtMs < T->trendWindow || dlN < 2) return;
  if (inaOk && pumpMa < PUMP_MIN_MA) return;                   // that is FLT 10, not 11
  int ref = -1;
  for (int i = dlN - 1; i >= 0; i--) if (millis() - dlT[i] >= T->trendWindow) { ref = i; break; }
  if (ref >= 0 && R.doMgL < dlV[ref] - DO_TREND_DROP) faultMask |= 1UL << FLT_DO_FALLING;
}

void control() {
  if (serviceMode) { decision = "Service mode: pump rule paused"; holdText = ""; if (pumpOn) setPump(false); return; }
  uint32_t now = millis();
  bool want = pumpOn;
  if (mode == M_ON)       { want = true;  decision = "Manual ON"; }
  else if (mode == M_OFF) { want = false; decision = "Manual OFF"; }
  else if (!haveSample)   { decision = "Waiting for first sample"; }
  else if (doInvalid) {
    if (isNight()) { want = true; decision = "Failsafe: no valid DO at night -> pump ON"; }
    else decision = "Failsafe: no valid DO, daytime -> hold";
  }
  else if (R.doMgL < doOnBelow)  { want = true;  decision = "DO " + String(R.doMgL, 2) + " < " + String(doOnBelow, 1) + " -> ON"; }
  else if (R.doMgL > doOffAbove) { want = false; decision = "DO " + String(R.doMgL, 2) + " > " + String(doOffAbove, 1) + " -> OFF"; }
  else decision = "DO " + String(R.doMgL, 2) + " in band -> hold";

  holdText = "";
  if (want != pumpOn) {
    uint32_t el = now - lastChangeMs;
    if (pumpOn && el < T->minOn)        holdText = "min ON " + fmtSec(T->minOn - el);
    else if (!pumpOn && el < T->minOff) holdText = "min OFF " + fmtSec(T->minOff - el);
    else setPump(want);
  }
  if (pumpOn && inaOk && now - onAtMs > T->currentCheck) {
    if (pumpMa < PUMP_MIN_MA) faultMask |= 1UL << FLT_PUMP_NO_CURRENT;
    else faultMask &= ~(1UL << FLT_PUMP_NO_CURRENT);
  }
  checkTrend();
}

// =====================================================================
//                         SAMPLING CYCLE
// =====================================================================
uint32_t nextInterval() {
  if (lastGoodDO < DO_FAST_BELOW) return T->sampleNight;     // DO < 5 -> fast
  if (isNight()) return T->sampleNight;
  return T->sampleDay;
}
void takeSample() {
  readSensors(R);
  readPump();
  pushHistory();
  // pump faults are managed by control(); FLT 5 latches until the electrode is serviced ('service off')
  uint32_t keep = faultMask & ((1UL << FLT_PUMP_NO_CURRENT) | (1UL << FLT_DO_FALLING) | (1UL << FLT_PH_STUCK));
  faultMask = sensorFaults() | keep;
  doInvalid = (faultMask & DO_BAD_MASK) != 0;
  if (!doInvalid) { lastGoodDO = R.doMgL; if (pumpOn) logDO(R.doMgL); }
  haveSample = true;
  control();
  Serial.printf("[%s] DO %.2f mg/L (%.0f%%, %.1f mV)  pH %.2f (%.1f mV)  WT %.2f  pump %s %.0f mA  %.2f V  FLT %u\n",
                clockText().c_str(), R.doMgL, R.doSat, R.doMv, R.ph, R.phMv, R.wt, pumpOn ? "ON" : "OFF", pumpMa, supplyV, topFault(faultMask));
  sendPond();
  nextSampleMs = millis() + nextInterval();
  tempRequested = false;
}

// =====================================================================
//                       HUB COMMANDS (LoRa)
// =====================================================================
void handleCommand(const String& p) {
  long n = getField(p, "N").toInt();
  if (n == lastCmdN && millis() - lastCmdMs < 60000UL && lastCmdAck.length()) { delay(50); loraSend(lastCmdAck); return; }
  bool ok = true; String extra;
  if (hasField(p, "TS")) {
    uint32_t e = strtoul(getField(p, "TS").c_str(), nullptr, 10);
    if (e > 1700000000UL) { setEpoch(e); extra += ",TS=" + String(e); } else { ok = false; extra += ",ERR=TS"; }
  }
  if (hasField(p, "AER")) {
    String v = getField(p, "AER");
    if (v == "ON") mode = M_ON; else if (v == "OFF") mode = M_OFF; else if (v == "AUTO") mode = M_AUTO; else { ok = false; extra += ",ERR=AER"; }
    control();
  }
  if (hasField(p, "LO") || hasField(p, "HI")) {
    float lo = hasField(p, "LO") ? getField(p, "LO").toFloat() : doOnBelow;
    float hi = hasField(p, "HI") ? getField(p, "HI").toFloat() : doOffAbove;
    if (lo >= 2.0f && hi <= 9.0f && hi - lo >= 0.5f) { doOnBelow = lo; doOffAbove = hi; saveSettings(); extra += ",LO=" + String(lo, 1) + ",HI=" + String(hi, 1); }
    else { ok = false; extra += ",ERR=RANGE"; }
  }
  if (hasField(p, "DEMO")) { setDemo(getField(p, "DEMO") == "1"); extra += ",DEMO=" + String(demo ? 1 : 0); }
  String ack = "AM1,ID=" + myId + ",T=ACK,N=" + String(n) + ",OK=" + String(ok ? 1 : 0) + ",MODE=" + modeName(mode) +
               ",AER=" + String(pumpOn ? 1 : 0) + extra + (holdText.length() ? ",HOLD=1" : "");
  lastCmdN = n; lastCmdMs = millis(); lastCmdAck = ack;
  delay(50);
  loraSend(ack);
  if (hasField(p, "CAL")) { delay(150); sendCal(); }
  if (hasField(p, "STATUS")) { delay(150); sendPond(); }
}

#define SEEN_N 24
String seenKey[SEEN_N]; uint32_t seenMs[SEEN_N]; uint8_t seenIdx = 0;
bool seenBefore(const String& k) {
  for (int i = 0; i < SEEN_N; i++) if (seenKey[i] == k && millis() - seenMs[i] < 600000UL) return true;
  seenKey[seenIdx] = k; seenMs[seenIdx] = millis(); seenIdx = (seenIdx + 1) % SEEN_N; return false;
}
void handlePacket(const String& p) {
  if (!p.startsWith("AM1,")) return;
  String from = getField(p, "ID"), type = getField(p, "T");
  if (from == myId) return;
  rxCount++; lastRssi = LoRa.packetRssi();
  Serial.print(F("RX< ")); Serial.print(p); Serial.printf("  RSSI %d\n", lastRssi);
  if (type == "CMD" && getField(p, "DST") == myId) { handleCommand(p); return; }
  if (MESH_RELAY && type != "ACK") {
    String key = from + ":" + type + ":" + getField(p, "N");
    if (!seenBefore(key)) { delay(random(100, 400)); loraSend(p); }
  }
}

// =====================================================================
//                       OLED + LEDs + BUZZER
// =====================================================================
void drawOled() {
  if (!oledOk) return;
  oled.clearDisplay(); oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1); oled.setCursor(0, 0);
  oled.print("BHOOMI "); oled.print(myId);
  oled.setCursor(98, 0); oled.print(clockText());
  if (serviceMode) {
    oled.setTextSize(2); oled.setCursor(10, 20); oled.print("SERVICE");
    oled.setTextSize(1); oled.setCursor(0, 44); oled.print("calibration mode");
    oled.setCursor(0, 54); oled.printf("DO %.0fmV pH %.0fmV", SV.doMv, SV.phMv);
    oled.display(); return;
  }
  oled.setCursor(0, 14); oled.print("DO");
  oled.setTextSize(2); oled.setCursor(18, 11);
  if (!haveSample) oled.print("--.--"); else if (doInvalid) oled.print("ERR"); else oled.printf("%.2f", R.doMgL);
  oled.setTextSize(1); oled.setCursor(84, 14); oled.print("mg/L");
  oled.setCursor(84, 22); if (haveSample && !doInvalid) oled.printf("%.0f%%", R.doSat);
  oled.setCursor(0, 32); oled.printf("pH %.2f  ", R.ph);
  if (R.wtOk) oled.printf("%.1fC", R.wt); else oled.print("--.-C");
  oled.setCursor(0, 42); oled.printf("PUMP %s %.2fA %s", pumpOn ? "ON " : "OFF", pumpMa / 1000.0f, modeName(mode));
  oled.setCursor(0, 54);
  uint8_t f = topFault(faultMask);
  if (f) oled.printf("FLT%u %s", f, faultShort(f));
  else if (holdText.length()) oled.print(holdText);
  else { uint32_t left = nextSampleMs > millis() ? nextSampleMs - millis() : 0; oled.printf("OK next %s", fmtSec(left).c_str()); }
  if (demo) { oled.setCursor(116, 54); oled.print("D"); }
  if (millis() - lastTxMs < 600) { oled.fillCircle(124, 36, 3, SSD1306_WHITE); }     // LoRa TX blip
  oled.display();
}

bool alarmActive() {
  if (serviceMode) return false;
  if (faultMask & ((1UL << FLT_PUMP_NO_CURRENT) | (1UL << FLT_DO_FALLING))) return true;
  return haveSample && !doInvalid && R.doMgL < DO_ALARM_BELOW;
}
void updateIndicators() {
  uint32_t ms = millis();
  digitalWrite(PIN_LED_GREEN, pumpOn ? HIGH : ((ms / 500) % 2));
  digitalWrite(PIN_LED_RED, faultMask ? HIGH : LOW);
  bool beep = alarmActive() && ms > muteUntil && (ms % 2000) < 200;
  digitalWrite(PIN_BUZZER, beep ? HIGH : LOW);
}

// short press: AUTO -> ON -> OFF -> AUTO ; long press (2 s): mute alarm
void readButton() {
  static bool last = HIGH; static uint32_t downAt = 0; static bool longDone = false;
  bool b = digitalRead(PIN_BUTTON);
  if (b != last) {
    delay(15); b = digitalRead(PIN_BUTTON);
    if (b != last) {
      last = b;
      if (b == LOW) { downAt = millis(); longDone = false; }
      else if (!longDone && millis() - downAt > 30) {
        mode = mode == M_AUTO ? M_ON : mode == M_ON ? M_OFF : M_AUTO;
        Serial.printf("Button: mode %s\n", modeName(mode)); control();
      }
    }
  }
  if (last == LOW && !longDone && millis() - downAt > 2000) {
    longDone = true; muteUntil = millis() + T->mute; Serial.println(F("Button: alarm muted"));
  }
}

// =====================================================================
//                     SERIAL COMMANDS / CALIBRATION
// =====================================================================
float tempNow() {
  ds.setWaitForConversion(true); ds.requestTemperatures(); ds.setWaitForConversion(false);
  float t = ds.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -5 || t > 50) { Serial.println(F("DS18B20 not found, using 25.0 C")); return 25.0f; }
  return t;
}
float stableMv(uint8_t ch, const char* what) {
  Serial.printf("Measuring %s for 30 s, keep the probe still...\n", what);
  float buf[6] = {0}; int n = 0;
  for (int i = 0; i < 30; i++) {
    float v = adsMv(ch, 9); buf[n % 6] = v; n++;
    Serial.printf("  %2d s  %.1f mV\n", i + 1, v);
    uint32_t t0 = millis(); while (millis() - t0 < 1000) { feedWdt(); delay(20); }
  }
  float mn = 1e9, mx = -1e9; for (float v : buf) { mn = min(mn, v); mx = max(mx, v); }
  if (mx - mn > 5.0f) Serial.printf("WARNING: still drifting %.1f mV in the last 6 s - repeat if you can\n", mx - mn);
  return medianOf(buf, 6);
}

void printHelp() {
  Serial.println(F("\n--- BHOOMI Pond Node ---"));
  Serial.println(F("status | sample | live | aer on|off|auto | set lo 4.0 | set hi 6.0 | demo on|off | mute"));
  Serial.println(F("time 2026-11-25 18:30   (IST, saved in DS3231)"));
  Serial.println(F("service on|off          pause pump rule + sampling for calibration"));
  Serial.println(F("  cal ph 6.86 | cal ph 4.01 | cal do zero | cal do air | set sal 2.0 | show | reset cal"));
}
void printStatus() {
  Serial.printf("\nBHOOMI Pond Node %s  fw %s  %s  %s\n", myId.c_str(), FW_VERSION, demo ? "DEMO timers" : "REAL timers",
                timeValid() ? (clockText() + (isNight() ? " night" : " day")).c_str() : "time unknown (night rules)");
  Serial.printf("HW: ADS1115 %s  INA219 %s  OLED %s  DS3231 %s  LoRa %s\n", adsOk ? "ok" : "MISSING", inaOk ? "ok" : "MISSING",
                oledOk ? "ok" : "MISSING", rtcOk ? "ok" : "MISSING", loraOk ? "ok" : "MISSING");
  Serial.printf("DO %.2f mg/L (%.0f%%)  pH %.2f  WT %.2f C  supply %.2f V\n", R.doMgL, R.doSat, R.ph, R.wt, supplyV);
  Serial.printf("Mode %s  pump %s %.0f mA  ON<%.1f OFF>%.1f\n", modeName(mode), pumpOn ? "ON" : "OFF", pumpMa, doOnBelow, doOffAbove);
  Serial.printf("Decision: %s %s\nFLT %u (%s)  mask 0x%lX\n", decision.c_str(), holdText.c_str(), topFault(faultMask),
                faultShort(topFault(faultMask)), (unsigned long)faultMask);
  Serial.printf("Next sample in %s  LoRa tx %lu rx %lu  last RSSI %d\n",
                fmtSec(nextSampleMs > millis() ? nextSampleMs - millis() : 0).c_str(), (unsigned long)txCount, (unsigned long)rxCount, lastRssi);
}
void showCal() {
  Serial.printf("DO : V0 %.1f mV  Vsat %.1f mV @ %.1f C  zero %s  age %s d\n", cal.doV0, cal.doVsat, cal.doTcal, cal.doZeroSet ? "yes" : "no", daysAgo(cal.doTs).c_str());
  Serial.printf("pH : %.2f at %.1f mV, slope %.1f mV/pH @ %.1f C, age %s d\n", cal.phPH7, cal.phV7, cal.phSlope, cal.phTcal, daysAgo(cal.phTs).c_str());
  Serial.printf("Salinity %.1f ppt  calibrated: %s\n", cal.salinity, cal.calibrated ? "yes" : "NO (defaults)");
}

void handleSerial(String c) {
  c.trim();
  if (c.startsWith("AM1,")) {               // v2.1: hub command over USB (twin backend), same path as LoRa
    if (getField(c, "T") == "CMD" && getField(c, "DST") == myId) { Serial.println(F("USB command")); handleCommand(c); }
    return;
  }
  String l = c; l.toLowerCase();
  if (l == "help" || l == "?") printHelp();
  else if (l == "status") printStatus();
  else if (l == "show") showCal();
  else if (l == "sample") { ds.requestTemperatures(); delay(800); takeSample(); }
  else if (l == "live") { liveMode = !liveMode; Serial.printf("Live %s\n", liveMode ? "on" : "off"); }
  else if (l == "mute") { muteUntil = millis() + T->mute; Serial.println(F("Alarm muted")); }
  else if (l == "demo on") setDemo(true);
  else if (l == "demo off") setDemo(false);
  else if (l.startsWith("aer ")) {
    String v = l.substring(4);
    if (v == "on") mode = M_ON; else if (v == "off") mode = M_OFF; else if (v == "auto") mode = M_AUTO;
    Serial.printf("Mode %s\n", modeName(mode)); control();
  }
  else if (l.startsWith("set lo ") || l.startsWith("set hi ")) {
    float v = l.substring(7).toFloat();
    float lo = l.startsWith("set lo") ? v : doOnBelow, hi = l.startsWith("set hi") ? v : doOffAbove;
    if (lo >= 2.0f && hi <= 9.0f && hi - lo >= 0.5f) { doOnBelow = lo; doOffAbove = hi; saveSettings(); Serial.printf("ON < %.1f  OFF > %.1f saved\n", lo, hi); }
    else Serial.println(F("Need 2 <= LO, HI <= 9 and HI - LO >= 0.5"));
  }
  else if (l.startsWith("time ")) {
    int Y, M, D, h, m;
    if (sscanf(l.c_str() + 5, "%d-%d-%d %d:%d", &Y, &M, &D, &h, &m) == 5) {
      DateTime local(Y, M, D, h, m, 0); setEpoch(local.unixtime() - TZ_OFFSET_S);
      Serial.printf("Time %s (%s)\n", clockText().c_str(), isNight() ? "night" : "day");
    } else Serial.println(F("Format: time 2026-11-25 18:30"));
  }
  else if (l == "service on")  { serviceMode = true; control(); Serial.println(F("SERVICE: pump off, sampling paused. Calibrate now.")); }
  else if (l == "service off") { serviceMode = false; hN = 0; faultMask &= ~(1UL << FLT_PH_STUCK); nextSampleMs = millis() + 2000; Serial.println(F("Back to normal operation")); }
  else if (l.startsWith("cal ") || l.startsWith("set sal") || l == "reset cal") {
    if (!serviceMode) { Serial.println(F("Type 'service on' first")); return; }
    if (l == "cal do air") {
      float t = tempNow(); cal.doVsat = stableMv(ADS_CH_DO, "DO in moist air"); cal.doTcal = t;
      cal.doTs = timeValid() ? nowEpoch() : 0; cal.calibrated = true; saveSettings();
      Serial.printf("DO air cal: %.1f mV at %.1f C (100%% = %.2f mg/L)\n", cal.doVsat, t, doSaturation(t, cal.salinity));
    } else if (l == "cal do zero") {
      cal.doV0 = stableMv(ADS_CH_DO, "DO in zero solution"); cal.doZeroSet = true; saveSettings();
      Serial.printf("DO zero: %.1f mV. Rinse well, then 'cal do air'.\n", cal.doV0);
    } else if (l.startsWith("cal ph ")) {
      float buf = l.substring(7).toFloat();
      if (buf < 1 || buf > 13) { Serial.println(F("e.g. cal ph 6.86")); return; }
      float t = tempNow(); float v = stableMv(ADS_CH_PH, "pH buffer");
      if (buf > 6.0f && buf < 7.5f) { cal.phV7 = v; cal.phPH7 = buf; cal.phTcal = t; saveSettings(); Serial.printf("Neutral %.2f = %.1f mV. Now cal ph 4.01\n", buf, v); }
      else {
        float slope = (v - cal.phV7) / (buf - cal.phPH7);
        if (fabsf(slope) < 40.0f || fabsf(slope) > 300.0f) { Serial.printf("Slope %.1f mV/pH looks wrong, not saved\n", slope); return; }
        cal.phSlope = slope; cal.phTcal = t; cal.phTs = timeValid() ? nowEpoch() : 0; cal.calibrated = true; saveSettings();
        Serial.printf("pH saved: slope %.1f mV/pH at %.1f C\n", slope, t);
      }
    } else if (l.startsWith("set sal ")) {
      float s = l.substring(8).toFloat(); if (s < 0 || s > 40) { Serial.println(F("0..40 ppt")); return; }
      cal.salinity = s; saveSettings(); Serial.printf("Salinity %.1f ppt\n", s);
    } else if (l == "reset cal") {
      prefs.begin("bhoomi", false); prefs.clear(); prefs.end(); loadSettings(); Serial.println(F("Defaults restored"));
    } else Serial.println(F("Unknown cal command. Type help."));
  }
  else if (l.length()) Serial.println(F("Unknown. Type help"));
}

// =====================================================================
//                            SETUP / LOOP
// =====================================================================
void setup() {
  digitalWrite(PIN_RELAY, RELAY_OFF_LEVEL); pinMode(PIN_RELAY, OUTPUT);   // no click at boot
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED_GREEN, OUTPUT); pinMode(PIN_LED_RED, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  Serial.begin(115200); delay(200);

  myId = chipId6();
  loadSettings();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  adsOk = ads.begin(ADS_ADDR); if (adsOk) ads.setGain(GAIN_ONE);         // +/-4.096 V, 0.125 mV/bit
  inaOk = ina.begin();
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  rtcOk = rtc.begin();
  if (rtcOk && rtc.lostPower()) { Serial.println(F("DS3231 lost power: set time with 'time ...' or hub TS=")); rtc.adjust(DateTime(2000, 1, 1, 0, 0, 0)); }
  ds.begin(); ds.setResolution(12); ds.setWaitForConversion(false);
  loraOk = loraStart();

  if (oledOk) { oled.clearDisplay(); oled.setTextColor(SSD1306_WHITE); oled.setTextSize(2); oled.setCursor(4, 8); oled.print("BHOOMI");
                oled.setTextSize(1); oled.setCursor(4, 32); oled.print("Pond Node "); oled.print(myId); oled.setCursor(4, 46);
                oled.print(demo ? "DEMO timers" : "REAL timers"); oled.display(); }

  lastChangeMs = millis();                       // min OFF time applies after a reboot
  nextSampleMs = millis() + 3000;                // first sample after 3 s warm-up

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdt = { .timeout_ms = 20000, .idle_core_mask = 0, .trigger_panic = true };
  if (esp_task_wdt_init(&wdt) != ESP_OK) esp_task_wdt_reconfigure(&wdt);
#else
  esp_task_wdt_init(20, true);
#endif
  esp_task_wdt_add(NULL);
  randomSeed(esp_random());
  printHelp(); printStatus();
}

void loop() {
  static uint32_t lastCtrl = 0, lastOled = 0, lastLive = 0;
  static String line;

  int n = loraOk ? LoRa.parsePacket() : 0;
  if (n > 0) { String p; while (LoRa.available()) p += (char)LoRa.read(); handlePacket(p); }

  if (!serviceMode) {
    if (!tempRequested && (int32_t)(millis() - (nextSampleMs - 1000)) >= 0) { ds.requestTemperatures(); tempRequested = true; }
    if ((int32_t)(millis() - nextSampleMs) >= 0) takeSample();
  }

  if (millis() - lastCtrl >= 1000) {
    lastCtrl = millis();
    readPump();
    if (haveSample) {
      uint32_t before = faultMask;
      control();
      if ((faultMask & ~before) & ~SENSOR_MASK) sendPond();     // new pump fault -> report now
    } else control();
  }
  if (serviceMode && millis() - lastLive >= 1000 && !liveMode) { lastLive = millis(); readSensors(SV); ds.requestTemperatures(); }
  if (liveMode && millis() - lastLive >= 1000) {
    lastLive = millis();
    Reading L; readSensors(L); ds.requestTemperatures();         // separate copy: live view never changes the control data
    Serial.printf("live: DO %.1f mV -> %.2f mg/L (%.0f%%)  pH %.1f mV -> %.2f  WT %.2f  pump %.0f mA\n",
                  L.doMv, L.doMgL, L.doSat, L.phMv, L.ph, L.wt, pumpMa);
  }
  if (millis() - lastOled >= 500) { lastOled = millis(); drawOled(); }

  readButton();
  updateIndicators();

  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') { if (line.length()) { handleSerial(line); line = ""; } }
    else line += ch;
  }
  feedWdt();
}
