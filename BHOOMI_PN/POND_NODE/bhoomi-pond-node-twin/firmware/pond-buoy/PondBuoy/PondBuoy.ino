/*
  =====================================================================
   AgriMesh Pond Node  -  PART A : FLOATING SENSOR BUOY
   HackWithAditya 2026 - AgriTech & Aquaculture track
  =====================================================================
   Board   : FireBeetle 2 ESP32-E (or any ESP32 dev board)
   Core    : Arduino-ESP32 2.0.x or 3.x
   Libraries (Library Manager):
     - LoRa                    by Sandeep Mistry
     - Adafruit ADS1X15        by Adafruit (installs Adafruit BusIO)
     - OneWire                 by Paul Stoffregen
     - DallasTemperature       by Miles Burton

   What this firmware does (same logic as the digital twin):
     wake -> sensors ON -> read DO / pH / water temp / battery
          -> fault checks (FLT 1..7, 21)
          -> send AM1 POND packet over LoRa
          -> listen up to 1.5 s for the bank controller's ACK
             (ACK carries aerator state, motor current, time, commands)
          -> sensors OFF -> deep sleep
     Sampling: every 5 min when DO < 5 mg/L or at night (18:00-07:00),
               every 15 min in daytime, every 30 min when battery low.

   Calibration mode (Serial 115200):
     - hold the magnet on the reed switch (GPIO33) -> buoy wakes into it, or
     - press 'c' within 5 s after power-on / reset.
     Type "help" in the Serial Monitor (line ending: Newline).
  =====================================================================
*/

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <Adafruit_ADS1X15.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>
#include <sys/time.h>
#include <time.h>
#include "esp_sleep.h"
#include "driver/rtc_io.h"

// =====================================================================
//                              CONFIG
// =====================================================================
// ---- LoRa (must be identical on every AgriMesh node) ----
#define LORA_FREQ_HZ        865062500UL   // 865.0625 MHz (India licence-free band)
#define LORA_SF             9             // SF7..SF9
#define LORA_BW_HZ          125E3
#define LORA_CR_DENOM       5             // coding rate 4/5
#define LORA_SYNC_WORD      0x12
#define LORA_TX_DBM         14            // normal power
#define LORA_TX_DBM_BOOST   17            // used when bank controller is not answering
#define ACK_WINDOW_MS       1500          // listen time after each packet

// ---- Pins ----
#define PIN_LORA_SCK        18
#define PIN_LORA_MISO       19
#define PIN_LORA_MOSI       23
#define PIN_LORA_NSS        5
#define PIN_LORA_RST        14
#define PIN_LORA_DIO0       26
#define PIN_I2C_SDA         21
#define PIN_I2C_SCL         22
#define PIN_ONEWIRE         4             // DS18B20 data (4.7k pull-up to 3V3)
#define PIN_SENSOR_EN       25            // HIGH = 5 V sensor rail ON (100k pull-down on board)
#define PIN_CAL_REED        33            // reed switch to GND -> calibration mode (RTC GPIO)
#define PIN_LED             2             // status LED (on-board on FireBeetle / DevKitC)

// ---- ADS1115 channels ----
#define ADS_ADDR            0x48          // ADDR pin to GND
#define ADS_CH_DO           0             // A0 <- DO isolator output
#define ADS_CH_PH           1             // A1 <- pH isolator output
#define ADS_CH_BATT         2             // A2 <- battery through 100k/100k divider
#define BATT_DIVIDER        2.00f         // (R1+R2)/R2

// ---- Timing ----
#define SENSOR_WARMUP_MS    5000          // isolators + pH/DO boards settle
#define INTERVAL_FAST_S     300           // night, or DO < 5 mg/L
#define INTERVAL_DAY_S      900           // daytime
#define INTERVAL_SAVER_S    1800          // battery low and DO is fine
#define NIGHT_START_H       18
#define NIGHT_END_H         7
#define TZ_OFFSET_S         19800         // IST = UTC + 5:30
#define CAL_MODE_TIMEOUT_S  900           // leave calibration mode after 15 min idle

// ---- Thresholds ----
#define DO_FAST_BELOW       5.0f          // mg/L -> sample every 5 min
#define BATT_LOW_V          3.40f         // FLT 7
#define DO_MAX_VALID        20.0f         // mg/L
#define DO_MAX_JUMP         3.0f          // mg/L between two samples <= 20 min apart
#define DO_MIN_SIGNAL_MV    2.0f          // below this the probe is treated as disconnected (FLT 1)
#define DO_RAIL_MV          3200.0f       // at/above this the signal is saturated (FLT 2)
#define DO_TEMP_COEF        0.030f        // galvanic probe sensitivity change per degC (3 %/degC)
#define FALLBACK_WATER_C    28.0f         // used for compensation when DS18B20 fails
#define CAL_DUE_DAYS        14            // pH/DO recalibration interval reminder

// ---- Fault codes (same table as the twin and the hub) ----
#define FLT_NONE            0
#define FLT_DO_NOSIGNAL     1
#define FLT_DO_IMPLAUSIBLE  2
#define FLT_DO_STUCK        3
#define FLT_PH_RANGE        4
#define FLT_PH_STUCK        5
#define FLT_TEMP            6
#define FLT_BATT_LOW        7
#define FLT_BANK_SILENT     21

// =====================================================================
//                         STATE KEPT IN DEEP SLEEP
// =====================================================================
#define HIST_N 10
RTC_DATA_ATTR uint32_t rSeq        = 0;
RTC_DATA_ATTR uint8_t  rHistCount  = 0;
RTC_DATA_ATTR float    rHistDO[HIST_N];
RTC_DATA_ATTR float    rHistPH[HIST_N];
RTC_DATA_ATTR uint32_t rHistT[HIST_N];      // seconds since boot-of-time (RTC clock)
RTC_DATA_ATTR float    rLastGoodDO = 8.0f;
RTC_DATA_ATTR uint8_t  rNoAck      = 0;
RTC_DATA_ATTR uint8_t  rLastAER    = 0;
RTC_DATA_ATTR float    rLastAERI   = 0.0f;
RTC_DATA_ATTR uint32_t rFltMaskPrev= 0;

// =====================================================================
//                           CALIBRATION (NVS)
// =====================================================================
struct Cal {
  float doV0;      // mV in zero-oxygen solution
  float doVsat;    // mV at 100 % saturation (air cal)
  float doTcal;    // degC during air cal
  bool  doZeroSet;
  uint32_t doTs;   // unix time of DO cal (0 = unknown)
  float phV7;      // mV in neutral buffer
  float phPH7;     // its pH (6.86 or 7.00)
  float phSlope;   // mV per pH unit at phTcal (negative for DFRobot boards)
  float phTcal;
  uint32_t phTs;
  float salinity;  // ppt
  bool  calibrated;
} cal;

Preferences prefs;
String bankId = "";            // paired bank controller (learned from first ACK)
String myId;

Adafruit_ADS1115 ads;
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature ds(&oneWire);

struct Reading {
  float doMv, phMv, battV;
  float wt;          // degC (or -127 on failure)
  bool  wtOk;
  float doMgL, doSat, ph;
} R;

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

uint32_t nowEpoch() { time_t t = time(nullptr); return (uint32_t)t; }
bool timeValid()    { return nowEpoch() > 1700000000UL; }
int  localHour()    { return (int)(((nowEpoch() + TZ_OFFSET_S) % 86400UL) / 3600UL); }
bool isNight() {
  if (!timeValid()) return true;           // unknown time -> behave like night (safer)
  int h = localHour();
  return (h >= NIGHT_START_H || h < NIGHT_END_H);
}
void setEpoch(uint32_t e) { struct timeval tv = { (time_t)e, 0 }; settimeofday(&tv, nullptr); }

// Benson & Krause oxygen solubility (mg/L), freshwater -> brackish, 1 atm
float doSaturation(float tC, float salPpt) {
  float K = tC + 273.15f;
  float ln = -139.34411f + 1.575701e5f / K - 6.642308e7f / (K * K)
             + 1.2438e10f / (K * K * K) - 8.621949e11f / (K * K * K * K);
  ln -= salPpt * (0.017674f - 10.754f / K + 2140.7f / (K * K));
  return expf(ln);
}

String getField(const String& pkt, const char* key) {
  String k = String(",") + key + "=";
  int i = pkt.indexOf(k);
  if (i < 0) return "";
  i += k.length();
  int j = pkt.indexOf(',', i);
  return (j < 0) ? pkt.substring(i) : pkt.substring(i, j);
}

float medianOf(float* a, int n) {
  for (int i = 1; i < n; i++) { float v = a[i]; int j = i - 1; while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; } a[j + 1] = v; }
  return (n % 2) ? a[n / 2] : 0.5f * (a[n / 2 - 1] + a[n / 2]);
}

float adsMv(uint8_t ch, int n = 15) {
  float v[25]; if (n > 25) n = 25;
  for (int i = 0; i < n; i++) { v[i] = ads.computeVolts(ads.readADC_SingleEnded(ch)) * 1000.0f; delay(5); }
  return medianOf(v, n);
}

// =====================================================================
//                              CALIBRATION
// =====================================================================
void loadCal() {
  prefs.begin("pond", true);
  cal.doV0      = prefs.getFloat("doV0", 0.0f);
  cal.doVsat    = prefs.getFloat("doVsat", 1600.0f);   // DFRobot typical, replace by real cal
  cal.doTcal    = prefs.getFloat("doTcal", 25.0f);
  cal.doZeroSet = prefs.getBool("doZero", false);
  cal.doTs      = prefs.getUInt("doTs", 0);
  cal.phV7      = prefs.getFloat("phV7", 1500.0f);
  cal.phPH7     = prefs.getFloat("phPH7", 6.86f);
  cal.phSlope   = prefs.getFloat("phSlope", -177.3f);
  cal.phTcal    = prefs.getFloat("phTcal", 25.0f);
  cal.phTs      = prefs.getUInt("phTs", 0);
  cal.salinity  = prefs.getFloat("sal", 2.0f);
  cal.calibrated= prefs.getBool("calOk", false);
  bankId        = prefs.getString("bank", "");
  prefs.end();
}

void saveCal() {
  prefs.begin("pond", false);
  prefs.putFloat("doV0", cal.doV0);   prefs.putFloat("doVsat", cal.doVsat);
  prefs.putFloat("doTcal", cal.doTcal); prefs.putBool("doZero", cal.doZeroSet);
  prefs.putUInt("doTs", cal.doTs);
  prefs.putFloat("phV7", cal.phV7);   prefs.putFloat("phPH7", cal.phPH7);
  prefs.putFloat("phSlope", cal.phSlope); prefs.putFloat("phTcal", cal.phTcal);
  prefs.putUInt("phTs", cal.phTs);
  prefs.putFloat("sal", cal.salinity);
  prefs.putBool("calOk", cal.calibrated);
  prefs.end();
}

void saveBankId(const String& id) {
  prefs.begin("pond", false); prefs.putString("bank", id); prefs.end();
  bankId = id;
}

// =====================================================================
//                        SENSOR READING + MATHS
// =====================================================================
void sensorsOn()  { digitalWrite(PIN_SENSOR_EN, HIGH); }
void sensorsOff() { digitalWrite(PIN_SENSOR_EN, LOW);  }

void readSensors() {
  // temperature (conversion was started earlier)
  float t = ds.getTempCByIndex(0);
  R.wtOk = !(t == DEVICE_DISCONNECTED_C || t < -5.0f || t > 50.0f || t == 85.0f);
  R.wt   = R.wtOk ? t : -127.0f;
  float tc = R.wtOk ? t : FALLBACK_WATER_C;

  R.doMv  = adsMv(ADS_CH_DO);
  R.phMv  = adsMv(ADS_CH_PH);
  R.battV = adsMv(ADS_CH_BATT, 7) / 1000.0f * BATT_DIVIDER;

  // DO: two-point linear (zero + air saturation), temperature compensated
  float span = (cal.doVsat - cal.doV0) * (1.0f + DO_TEMP_COEF * (tc - cal.doTcal));
  float frac = (span > 1.0f) ? (R.doMv - cal.doV0) / span : 0.0f;
  if (frac < 0) frac = 0;
  R.doSat = frac * 100.0f;
  R.doMgL = frac * doSaturation(tc, cal.salinity);

  // pH: Nernst slope scales with absolute temperature
  float slopeT = cal.phSlope * (tc + 273.15f) / (cal.phTcal + 273.15f);
  R.ph = cal.phPH7 + (R.phMv - cal.phV7) / slopeT;
}

void pushHistory() {
  if (rHistCount == HIST_N) {
    for (int i = 1; i < HIST_N; i++) { rHistDO[i-1] = rHistDO[i]; rHistPH[i-1] = rHistPH[i]; rHistT[i-1] = rHistT[i]; }
    rHistCount--;
  }
  rHistDO[rHistCount] = R.doMgL; rHistPH[rHistCount] = R.ph; rHistT[rHistCount] = nowEpoch();
  rHistCount++;
}

// returns bit-mask of active fault codes (bit n = FLT n)
uint32_t detectFaults() {
  uint32_t m = 0;
  if (!R.wtOk) m |= 1UL << FLT_TEMP;
  if (R.doMv < DO_MIN_SIGNAL_MV) m |= 1UL << FLT_DO_NOSIGNAL;
  else {
    bool jump = false;
    if (rHistCount >= 2) {
      float prev = rHistDO[rHistCount - 2];
      uint32_t dt = rHistT[rHistCount - 1] - rHistT[rHistCount - 2];
      jump = (prev > 0.5f && fabsf(R.doMgL - prev) > DO_MAX_JUMP && dt <= 1200);
    }
    if (R.doMgL > DO_MAX_VALID || R.doMv >= DO_RAIL_MV || jump) m |= 1UL << FLT_DO_IMPLAUSIBLE;
    if (rHistCount >= 6) {
      bool same = true; float a = rHistDO[rHistCount - 6];
      for (int i = rHistCount - 5; i < rHistCount; i++) if (fabsf(rHistDO[i] - a) >= 0.005f) same = false;
      if (same) m |= 1UL << FLT_DO_STUCK;
    }
  }
  if (R.ph < 2.0f || R.ph > 12.0f) m |= 1UL << FLT_PH_RANGE;
  else if (rHistCount >= HIST_N) {
    float pmin = 99, pmax = -99, dmin = 99, dmax = -99;
    for (int i = 0; i < HIST_N; i++) {
      pmin = min(pmin, rHistPH[i]); pmax = max(pmax, rHistPH[i]);
      dmin = min(dmin, rHistDO[i]); dmax = max(dmax, rHistDO[i]);
    }
    if (pmax - pmin < 0.02f && dmax - dmin > 0.3f) m |= 1UL << FLT_PH_STUCK;
  }
  if (R.battV < BATT_LOW_V) m |= 1UL << FLT_BATT_LOW;
  if (rNoAck >= 2) m |= 1UL << FLT_BANK_SILENT;
  return m;
}

uint8_t topFault(uint32_t m) {
  const uint8_t pri[] = { FLT_BANK_SILENT, FLT_DO_NOSIGNAL, FLT_DO_IMPLAUSIBLE, FLT_DO_STUCK,
                          FLT_PH_RANGE, FLT_PH_STUCK, FLT_TEMP, FLT_BATT_LOW };
  for (uint8_t c : pri) if (m & (1UL << c)) return c;
  return FLT_NONE;
}

bool doInvalid(uint32_t m) {
  return m & ((1UL << FLT_DO_NOSIGNAL) | (1UL << FLT_DO_IMPLAUSIBLE) | (1UL << FLT_DO_STUCK));
}

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
  LoRa.setTxPower(rNoAck >= 2 ? LORA_TX_DBM_BOOST : LORA_TX_DBM);
  return true;
}

void loraSend(const String& s) {
  digitalWrite(PIN_LED, HIGH);
  LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket();   // blocking until sent
  digitalWrite(PIN_LED, LOW);
  Serial.print(F("TX> ")); Serial.println(s);
}

// waits for an ACK addressed to this sequence number
bool waitAck(uint32_t seq, String& ack) {
  uint32_t t0 = millis();
  while (millis() - t0 < ACK_WINDOW_MS) {
    int n = LoRa.parsePacket();
    if (n > 0) {
      String p; while (LoRa.available()) p += (char)LoRa.read();
      if (!p.startsWith("AM1,")) continue;
      if (getField(p, "T") != "ACK") continue;
      if (getField(p, "N").toInt() != (long)seq) continue;
      String from = getField(p, "ID");
      if (bankId.length() && from != bankId) continue;
      if (!bankId.length()) { saveBankId(from); Serial.println("Paired with bank " + from); }
      Serial.print(F("RX< ")); Serial.print(p); Serial.print(F("  RSSI ")); Serial.println(LoRa.packetRssi());
      ack = p; return true;
    }
    delay(2);
  }
  return false;
}

String daysAgo(uint32_t ts) {
  if (!ts || !timeValid()) return "NA";
  return String((nowEpoch() - ts) / 86400UL);
}

void sendCalStatus() {
  int dueDays = -1;
  if (timeValid() && cal.doTs && cal.phTs) {
    uint32_t oldest = min(cal.doTs, cal.phTs);
    dueDays = (int)CAL_DUE_DAYS - (int)((nowEpoch() - oldest) / 86400UL);
  }
  String s = "AM1,ID=" + myId + ",T=CAL,N=" + String(rSeq) +
             ",DOCAL=" + daysAgo(cal.doTs) + ",DOZERO=" + String(cal.doZeroSet ? 1 : 0) +
             ",DOVSAT=" + String(cal.doVsat, 1) +
             ",PHCAL=" + daysAgo(cal.phTs) + ",PHSLOPE=" + String(cal.phSlope, 1) +
             ",PH7V=" + String(cal.phV7, 1) + ",SAL=" + String(cal.salinity, 1) +
             ",DUE=" + (dueDays == -1 ? String("NA") : String(dueDays)) +
             ",CALOK=" + String(cal.calibrated ? 1 : 0);
  delay(150);
  loraSend(s);
}

// =====================================================================
//                         CALIBRATION MODE (Serial)
// =====================================================================
void printHelp() {
  Serial.println(F("\n--- Pond buoy calibration mode ---"));
  Serial.println(F("live            toggle 1 s live readings"));
  Serial.println(F("cal do air      probe in water-saturated air (wet sponge, shade), 100 % sat"));
  Serial.println(F("cal do zero     probe in zero-oxygen solution (sodium sulfite), optional"));
  Serial.println(F("cal ph 6.86     probe in 6.86 buffer   (or: cal ph 7.00)"));
  Serial.println(F("cal ph 4.01     probe in 4.01 buffer   (do neutral buffer first)"));
  Serial.println(F("set sal 2.0     pond salinity in ppt (0 for freshwater)"));
  Serial.println(F("set time 2026-11-20 18:30   set clock (IST) for testing"));
  Serial.println(F("unpair          forget the paired bank controller"));
  Serial.println(F("show            show calibration"));
  Serial.println(F("reset cal       restore defaults"));
  Serial.println(F("exit            leave and start normal sampling"));
}

void showCal() {
  Serial.printf("ID %s  bank %s  seq %lu\n", myId.c_str(), bankId.length() ? bankId.c_str() : "(not paired)", (unsigned long)rSeq);
  Serial.printf("DO : V0 %.1f mV  Vsat %.1f mV @ %.1f C  zero %s  age %s d\n",
                cal.doV0, cal.doVsat, cal.doTcal, cal.doZeroSet ? "yes" : "no", daysAgo(cal.doTs).c_str());
  Serial.printf("pH : %.2f at %.1f mV, slope %.1f mV/pH @ %.1f C, age %s d\n",
                cal.phPH7, cal.phV7, cal.phSlope, cal.phTcal, daysAgo(cal.phTs).c_str());
  Serial.printf("Salinity %.1f ppt   calibrated: %s\n", cal.salinity, cal.calibrated ? "yes" : "NO (defaults)");
}

float stableMv(uint8_t ch, const char* what) {
  Serial.printf("Measuring %s for 30 s, keep the probe still...\n", what);
  float buf[6]; int n = 0;
  for (int i = 0; i < 30; i++) {
    float v = adsMv(ch, 9);
    buf[n % 6] = v; n++;
    Serial.printf("  %2d s  %.1f mV\n", i + 1, v);
    delay(1000);
  }
  float mn = 1e9, mx = -1e9; for (int i = 0; i < 6; i++) { mn = min(mn, buf[i]); mx = max(mx, buf[i]); }
  if (mx - mn > 5.0f) Serial.printf("WARNING: still drifting (%.1f mV in last 6 s). Repeat if possible.\n", mx - mn);
  float a[6]; memcpy(a, buf, sizeof(a));
  return medianOf(a, 6);
}

float tempNow() {
  ds.requestTemperatures();
  float t = ds.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -5 || t > 50) { Serial.println(F("DS18B20 not found, using 25.0 C")); return 25.0f; }
  return t;
}

bool phNeutralDone = false;

void handleCalCommand(String c) {
  c.trim(); c.toLowerCase();
  if (c == "help" || c == "?") printHelp();
  else if (c == "show") showCal();
  else if (c == "cal do air") {
    float t = tempNow();
    cal.doVsat = stableMv(ADS_CH_DO, "DO in air"); cal.doTcal = t;
    cal.doTs = timeValid() ? nowEpoch() : 0; cal.calibrated = true; saveCal();
    Serial.printf("DO air cal saved: %.1f mV at %.1f C (100 %% sat = %.2f mg/L)\n", cal.doVsat, t, doSaturation(t, cal.salinity));
  }
  else if (c == "cal do zero") {
    cal.doV0 = stableMv(ADS_CH_DO, "DO in zero solution"); cal.doZeroSet = true; saveCal();
    Serial.printf("DO zero saved: %.1f mV. Rinse the probe well, then redo 'cal do air'.\n", cal.doV0);
  }
  else if (c.startsWith("cal ph ")) {
    float buf = c.substring(7).toFloat();
    if (buf < 1 || buf > 13) { Serial.println(F("Give the buffer value, e.g. cal ph 6.86")); return; }
    float t = tempNow();
    float v = stableMv(ADS_CH_PH, "pH buffer");
    if (buf > 6.0f && buf < 7.5f) {
      cal.phV7 = v; cal.phPH7 = buf; cal.phTcal = t; phNeutralDone = true; saveCal();
      Serial.printf("Neutral point saved: pH %.2f = %.1f mV. Now rinse and do 'cal ph 4.01'.\n", buf, v);
    } else {
      if (!phNeutralDone) Serial.println(F("Note: using the stored neutral point. Best practice is neutral first."));
      float slope = (v - cal.phV7) / (buf - cal.phPH7);
      if (fabsf(slope) < 40.0f || fabsf(slope) > 300.0f) {
        Serial.printf("Slope %.1f mV/pH looks wrong (expected ~ -170 on DFRobot V2, -59 raw). Not saved.\n", slope);
        return;
      }
      cal.phSlope = slope; cal.phTcal = t; cal.phTs = timeValid() ? nowEpoch() : 0; cal.calibrated = true; saveCal();
      Serial.printf("pH 2-point saved: slope %.1f mV/pH at %.1f C\n", slope, t);
    }
  }
  else if (c.startsWith("set sal ")) {
    float s = c.substring(8).toFloat();
    if (s < 0 || s > 40) { Serial.println(F("Salinity must be 0..40 ppt")); return; }
    cal.salinity = s; saveCal(); Serial.printf("Salinity %.1f ppt saved\n", s);
  }
  else if (c.startsWith("set time ")) {
    int Y, M, D, h, m;
    if (sscanf(c.c_str() + 9, "%d-%d-%d %d:%d", &Y, &M, &D, &h, &m) == 5) {
      struct tm tmv = {}; tmv.tm_year = Y - 1900; tmv.tm_mon = M - 1; tmv.tm_mday = D; tmv.tm_hour = h; tmv.tm_min = m;
      setenv("TZ", "UTC0", 1); tzset();
      time_t e = mktime(&tmv) - TZ_OFFSET_S; setEpoch((uint32_t)e);
      Serial.printf("Clock set. Local hour now %d (night=%s)\n", localHour(), isNight() ? "yes" : "no");
    } else Serial.println(F("Format: set time 2026-11-20 18:30"));
  }
  else if (c == "unpair") { saveBankId(""); Serial.println(F("Bank pairing cleared")); }
  else if (c == "reset cal") {
    prefs.begin("pond", false); prefs.clear(); prefs.end(); loadCal(); Serial.println(F("Defaults restored"));
  }
  else if (c.length()) Serial.println(F("Unknown command. Type help."));
}

void calibrationMode() {
  Serial.println(F("\n*** CALIBRATION MODE ***  (sensor rail ON, LoRa off)"));
  sensorsOn(); delay(SENSOR_WARMUP_MS);
  printHelp(); showCal();
  bool live = false; uint32_t lastAct = millis(), lastLive = 0; String line;
  digitalWrite(PIN_LED, HIGH);
  while (true) {
    while (Serial.available()) {
      char ch = Serial.read(); lastAct = millis();
      if (ch == '\n' || ch == '\r') {
        if (line.length()) {
          String l = line; line = ""; l.trim();
          if (l == "exit") { Serial.println(F("Leaving calibration mode")); digitalWrite(PIN_LED, LOW); return; }
          if (l == "live") { live = !live; continue; }
          handleCalCommand(l);
        }
      } else line += ch;
    }
    if (live && millis() - lastLive > 1000) {
      lastLive = millis();
      ds.requestTemperatures(); readSensors();
      Serial.printf("DO %.1f mV -> %.2f mg/L (%.0f %%)  pH %.1f mV -> %.2f  WT %.2f C  BV %.2f V\n",
                    R.doMv, R.doMgL, R.doSat, R.phMv, R.ph, R.wt, R.battV);
    }
    if (millis() - lastAct > CAL_MODE_TIMEOUT_S * 1000UL) { Serial.println(F("Idle timeout")); digitalWrite(PIN_LED, LOW); return; }
    delay(10);
  }
}

// =====================================================================
//                            SLEEP
// =====================================================================
void goToSleep(uint32_t seconds, uint32_t awakeMs) {
  LoRa.sleep();
  sensorsOff();
  uint64_t us = (uint64_t)seconds * 1000000ULL;
  uint64_t used = (uint64_t)awakeMs * 1000ULL;
  us = (us > used + 5000000ULL) ? us - used : 5000000ULL;
  esp_sleep_enable_timer_wakeup(us);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_CAL_REED, 0);   // magnet -> wake
  rtc_gpio_pullup_en((gpio_num_t)PIN_CAL_REED);                // keep reed input high in sleep
  rtc_gpio_pulldown_dis((gpio_num_t)PIN_CAL_REED);
  Serial.printf("Sleeping %lu s\n", (unsigned long)(us / 1000000ULL));
  Serial.flush();
  esp_deep_sleep_start();
}

// =====================================================================
//                         ONE SAMPLING CYCLE
// =====================================================================
void setup() {
  uint32_t t0 = millis();
  setCpuFrequencyMhz(80);                     // saves ~20 mA while awake
  pinMode(PIN_SENSOR_EN, OUTPUT); sensorsOff();
  pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW);
  rtc_gpio_deinit((gpio_num_t)PIN_CAL_REED);
  pinMode(PIN_CAL_REED, INPUT_PULLUP);
  Serial.begin(115200); delay(50);

  setenv("TZ", "UTC0", 1); tzset();
  myId = chipId6();
  loadCal();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  bool adsOk = ads.begin(ADS_ADDR);
  if (adsOk) ads.setGain(GAIN_ONE);           // +/-4.096 V, 0.125 mV/bit
  ds.begin(); ds.setResolution(12); ds.setWaitForConversion(false);

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  bool wantCal = (cause == ESP_SLEEP_WAKEUP_EXT0) || (digitalRead(PIN_CAL_REED) == LOW);
  if (cause == ESP_SLEEP_WAKEUP_UNDEFINED) {          // power-on or reset button
    Serial.printf("\nAgriMesh Pond Buoy  ID=%s\nPress 'c' within 5 s for calibration mode...\n", myId.c_str());
    uint32_t w = millis();
    while (millis() - w < 5000) { if (Serial.available() && tolower(Serial.read()) == 'c') { wantCal = true; break; } delay(10); }
  }
  if (wantCal) { calibrationMode(); t0 = millis(); }
  if (!adsOk) Serial.println(F("ERROR: ADS1115 not found at 0x48 - check I2C wiring"));

  // ---- measure ----
  sensorsOn();
  ds.requestTemperatures();                   // 750 ms conversion runs during warm-up
  delay(SENSOR_WARMUP_MS);
  if (adsOk) readSensors();
  else { R.doMv = 0; R.phMv = 0; R.battV = 0; R.wt = -127; R.wtOk = false; R.doMgL = 0; R.doSat = 0; R.ph = 0; }
  sensorsOff();

  rSeq++;
  pushHistory();
  uint32_t m = detectFaults();
  if (!doInvalid(m)) rLastGoodDO = R.doMgL;
  uint8_t flt = topFault(m);

  Serial.printf("DO %.2f mg/L (%.0f%%, %.1f mV)  pH %.2f (%.1f mV)  WT %.2f  BV %.2f  FLT %u\n",
                R.doMgL, R.doSat, R.doMv, R.ph, R.phMv, R.wt, R.battV, flt);

  // ---- send ----
  char pkt[200];
  snprintf(pkt, sizeof(pkt),
           "AM1,ID=%s,T=POND,N=%lu,DO=%.2f,DOS=%.0f,PH=%.2f,WT=%.1f,AER=%u,AERI=%.1f,BV=%.2f,FLT=%u",
           myId.c_str(), (unsigned long)rSeq, R.doMgL, R.doSat, R.ph, R.wt, rLastAER, rLastAERI, R.battV, flt);

  if (loraStart()) {
    loraSend(pkt);
    String ack;
    bool got = waitAck(rSeq, ack);
    if (!got && (m != rFltMaskPrev)) {        // new fault and no ACK -> one retry
      delay(random(300, 900));
      loraSend(pkt);
      got = waitAck(rSeq, ack);
    }
    if (got) {
      rNoAck = 0;
      rLastAER  = (uint8_t)getField(ack, "AER").toInt();
      rLastAERI = getField(ack, "AERI").toFloat();
      uint32_t ts = (uint32_t)strtoul(getField(ack, "TS").c_str(), nullptr, 10);
      if (ts > 1700000000UL) setEpoch(ts);
      if (getField(ack, "CMD") == "CAL?") sendCalStatus();
    } else {
      if (rNoAck < 255) rNoAck++;
      Serial.printf("No ACK (%u in a row)%s\n", rNoAck, rNoAck >= 2 ? " -> FLT 21, sending direct to hub at boosted power" : "");
    }
  } else {
    Serial.println(F("ERROR: RFM95W not found - check SPI wiring / 3V3"));
  }
  rFltMaskPrev = m;

  // ---- choose next interval (same order as the twin) ----
  uint32_t interval; const char* why;
  bool doLow = (!doInvalid(m) && R.doMgL < DO_FAST_BELOW) || (doInvalid(m) && rLastGoodDO < DO_FAST_BELOW);
  if (doLow)                          { interval = INTERVAL_FAST_S;  why = "DO < 5 mg/L"; }
  else if (m & (1UL << FLT_BATT_LOW)) { interval = INTERVAL_SAVER_S; why = "battery saver"; }
  else if (isNight())                 { interval = INTERVAL_FAST_S;  why = timeValid() ? "night mode" : "time unknown"; }
  else                                { interval = INTERVAL_DAY_S;   why = "daytime"; }
  Serial.printf("Next sample in %lu s (%s)\n", (unsigned long)interval, why);

  goToSleep(interval, millis() - t0);
}

void loop() { /* never reached: the buoy deep-sleeps at the end of setup() */ }
