/*
  =====================================================================
   BHOOMI · Stage 3 · HUB BRIDGE (ESP32 + SX1278 LoRa 433 MHz + Wi-Fi)
  =====================================================================
   The farmhouse hub: receives every AM1 packet from the LoRa mesh and
   passes it to the BHOOMI backend, then carries commands back to the field.

     field nodes ──LoRa 433.5 MHz──► this hub ──MQTT / HTTP / USB serial──► backend ──► 3D twins
     backend ──MQTT bhoomi/hub/down──► this hub ──LoRa──► pump / tank / pond node

   What it does
   - ACKs every packet the way soil_node_v2.2 expects:  ACK,<ID>,<N>,HUB
   - drops duplicates (the same ID:N heard twice through the mesh)
   - prints   RX AM1,... RSSI -96 SNR 7.5   on USB serial (the backend's
     serial source reads exactly this line)
   - publishes {"raw":"AM1,...","rssi":-96,"snr":7.5} to MQTT  bhoomi/<hubId>/up
     or POSTs it to http://<backend>/api/ingest   (choose below)
   - keeps up to 64 packets while Wi-Fi or the broker is down, sends them later
   - subscribes to bhoomi/hub/down and transmits each AM1 CMD line over LoRa
   - an AM1 line typed into the Serial Monitor is transmitted too (bench tests)

   Board : ESP32 Dev Module (38-pin DevKit), Arduino-ESP32 core 2.0.x / 3.x
   Libraries: LoRa (Sandeep Mistry), PubSubClient (Nick O'Leary)
   Radio settings must match soil_node_v2.2.ino: 433.5 MHz, SF9, BW 125 kHz,
   CR 4/5, sync word 0x12, CRC on.
  =====================================================================
*/
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>

// ============================== CONFIG ==============================
#define WIFI_SSID        "your-wifi"
#define WIFI_PASS        "your-password"

// Uplink: 1 = MQTT (needs a broker, e.g. docker compose up), 2 = HTTP POST, 0 = USB serial only
#define UPLINK_MODE      1
#define MQTT_HOST        "192.168.1.20"        // laptop/RPi running Mosquitto
#define MQTT_PORT        1883
#define MQTT_USER        ""                    // empty = no login
#define MQTT_PASS        ""
#define MQTT_DOWN_TOPIC  "bhoomi/hub/down"
#define HTTP_INGEST_URL  "http://192.168.1.20:8080/api/ingest"
#define INGEST_TOKEN     ""                    // same as INGEST_TOKEN on the backend, if set

// LoRa (must match the nodes)
#define LORA_FREQ        433.5E6
#define LORA_SF          9
#define LORA_BW          125E3
#define LORA_CR          5
#define LORA_SYNC        0x12
#define LORA_TX_DBM      10

// Pins (same wiring as the soil node: NSS on GPIO5)
#define PIN_LORA_SCK     18
#define PIN_LORA_MISO    19
#define PIN_LORA_MOSI    23
#define PIN_LORA_NSS     5
#define PIN_LORA_RST     14
#define PIN_LORA_DIO0    26
#define PIN_LED          2                     // blinks on every packet

#define ACK_DELAY_MS     40                    // node switches to RX before the ACK arrives
#define DEDUP_SIZE       48
#define QUEUE_SIZE       64

// ============================== STATE ==============================
WiFiClient   net;
PubSubClient mqtt(net);
String hubId;
String upTopic;
String dedupKey[DEDUP_SIZE]; uint8_t dedupPos = 0;
String queueBuf[QUEUE_SIZE]; uint8_t qHead = 0, qCount = 0;
uint32_t rxCount = 0, dupCount = 0, upCount = 0, lastWifiTry = 0, lastMqttTry = 0, ledOff = 0;

String chipId6() {
  uint64_t mac = ESP.getEfuseMac(); uint32_t id = 0;
  for (int i = 0; i < 17; i += 8) id |= ((mac >> (40 - i)) & 0xFF) << i;
  char b[7]; snprintf(b, sizeof(b), "%06X", (unsigned)(id & 0xFFFFFF)); return String(b);
}

String field(const String& p, const char* key) {        // value of KEY in an AM1 line
  String k = String(",") + key + "=";
  int i = p.indexOf(k); if (i < 0) return "";
  i += k.length(); int j = p.indexOf(',', i);
  return j < 0 ? p.substring(i) : p.substring(i, j);
}

bool seenBefore(const String& key) {
  for (uint8_t i = 0; i < DEDUP_SIZE; i++) if (dedupKey[i] == key) return true;
  dedupKey[dedupPos] = key; dedupPos = (dedupPos + 1) % DEDUP_SIZE; return false;
}

// ============================== RADIO ==============================
bool radioInit() {
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_NSS);
  LoRa.setPins(PIN_LORA_NSS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) return false;
  LoRa.setSpreadingFactor(LORA_SF); LoRa.setSignalBandwidth(LORA_BW); LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNC); LoRa.enableCrc(); LoRa.setTxPower(LORA_TX_DBM);
  return true;
}
void loraSend(const String& s) {
  LoRa.idle(); LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket();
}

// ============================== UPLINK ==============================
String toJson(const String& raw, int rssi, float snr) {
  String j = "{\"raw\":\""; j += raw; j += "\",\"rssi\":"; j += rssi; j += ",\"snr\":"; j += String(snr, 1);
  j += ",\"hub\":\""; j += hubId; j += "\"}"; return j;
}

bool uplinkOne(const String& json) {
#if UPLINK_MODE == 1
  if (!mqtt.connected()) return false;
  return mqtt.publish(upTopic.c_str(), json.c_str());
#elif UPLINK_MODE == 2
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setTimeout(3000);
  if (!http.begin(HTTP_INGEST_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  if (strlen(INGEST_TOKEN)) http.addHeader("X-BHOOMI-Token", INGEST_TOKEN);
  int code = http.POST(json);
  http.end();
  return code >= 200 && code < 300;
#else
  (void)json; return true;                           // serial only: the backend reads USB serial
#endif
}

void enqueue(const String& json) {
  uint8_t pos = (qHead + qCount) % QUEUE_SIZE;
  queueBuf[pos] = json;
  if (qCount < QUEUE_SIZE) qCount++; else qHead = (qHead + 1) % QUEUE_SIZE;   // full: drop the oldest
}
void flushQueue() {
  while (qCount) {
    if (!uplinkOne(queueBuf[qHead])) return;
    queueBuf[qHead] = ""; qHead = (qHead + 1) % QUEUE_SIZE; qCount--; upCount++;
  }
}

void onMqtt(char* topic, byte* payload, unsigned int len) {
  String line; line.reserve(len);
  for (unsigned int i = 0; i < len; i++) line += (char)payload[i];
  line.trim();
  if (!line.startsWith("AM1,")) return;
  loraSend(line);
  Serial.print(F("TX ")); Serial.println(line);       // command from the backend sent into the mesh
}

void keepConnected() {
#if UPLINK_MODE != 0
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiTry > 10000) { lastWifiTry = millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
    return;
  }
#endif
#if UPLINK_MODE == 1
  if (!mqtt.connected() && millis() - lastMqttTry > 5000) {
    lastMqttTry = millis();
    String cid = "bhoomi-hub-" + hubId;
    bool ok = strlen(MQTT_USER) ? mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASS) : mqtt.connect(cid.c_str());
    if (ok) { mqtt.subscribe(MQTT_DOWN_TOPIC); Serial.println(F("# MQTT connected")); }
  }
  mqtt.loop();
#endif
}

// ============================== MAIN ==============================
void handlePacket(const String& p, int rssi, float snr) {
  if (!p.startsWith("AM1,")) return;                   // soil ACKs and other traffic are not for the backend
  String id = field(p, "ID"), n = field(p, "N"), type = field(p, "T");
  if (!id.length() || type == "CMD") return;           // our own commands repeated by a relay
  digitalWrite(PIN_LED, HIGH); ledOff = millis() + 80;
  if (type != "ACK") { delay(ACK_DELAY_MS); loraSend("ACK," + id + "," + n + ",HUB"); }
  if (seenBefore(id + ":" + n)) { dupCount++; return; }
  rxCount++;
  Serial.printf("RX %s RSSI %d SNR %.1f\n", p.c_str(), rssi, snr);
  String json = toJson(p, rssi, snr);
  if (qCount || !uplinkOne(json)) enqueue(json); else upCount++;
}

void setup() {
  Serial.begin(115200); delay(200);
  pinMode(PIN_LED, OUTPUT);
  hubId = chipId6();
  upTopic = "bhoomi/" + hubId + "/up";
  Serial.printf("\n# BHOOMI hub bridge %s  uplink=%d\n", hubId.c_str(), UPLINK_MODE);
  if (!radioInit()) { Serial.println(F("# LoRa init FAILED: check SPI wiring, 3.3 V and NSS on GPIO5")); while (true) delay(1000); }
  Serial.printf("# LoRa %.1f MHz SF%d sync 0x%02X ready\n", LORA_FREQ / 1e6, LORA_SF, LORA_SYNC);
#if UPLINK_MODE != 0
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
#endif
#if UPLINK_MODE == 1
  mqtt.setServer(MQTT_HOST, MQTT_PORT); mqtt.setCallback(onMqtt); mqtt.setBufferSize(512);
#endif
  LoRa.receive();
}

void loop() {
  int len = LoRa.parsePacket();
  if (len > 0) {
    String p; p.reserve(len);
    while (LoRa.available()) p += (char)LoRa.read();
    handlePacket(p, LoRa.packetRssi(), LoRa.packetSnr());
  }
  keepConnected();
  if (qCount) flushQueue();

  // bench: an AM1 line typed into the Serial Monitor goes out over LoRa
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line.startsWith("AM1,")) { loraSend(line); Serial.print(F("TX ")); Serial.println(line); }
      else if (line == "status") Serial.printf("# rx %lu  dup %lu  up %lu  queued %u  wifi %d  mqtt %d\n", (unsigned long)rxCount, (unsigned long)dupCount, (unsigned long)upCount, qCount, WiFi.status() == WL_CONNECTED, mqtt.connected());
      line = "";
    } else line += c;
  }
  if (ledOff && millis() > ledOff) { digitalWrite(PIN_LED, LOW); ledOff = 0; }
}
