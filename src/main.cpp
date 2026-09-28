#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <time.h>
#include <esp_timer.h>
#include "config.h"
#include "motion.h"

WebServer server(80);
bool previouslyConnected = false;
uint32_t lastReconnect = 0;
constexpr uint8_t PIR_PIN = 27;
MotionDetector motion;
struct Event { uint32_t id; unsigned long uptime; unsigned long epoch; uint8_t kind; };
constexpr size_t EVENT_LIMIT = 100;
Event events[EVENT_LIMIT];
size_t eventCount = 0, nextEvent = 0;
uint32_t eventId = 0;
void logEvent(uint8_t kind) {
  time_t now = time(nullptr);
  events[nextEvent] = {++eventId, static_cast<unsigned long>(esp_timer_get_time()/1000000), now > 1700000000 ? static_cast<unsigned long>(now) : 0, kind};
  nextEvent = (nextEvent + 1) % EVENT_LIMIT;
  if (eventCount < EVENT_LIMIT) ++eventCount;
  Serial.printf("Evento %lu | tipo %u | GPIO27=%d\n", static_cast<unsigned long>(eventId), kind, digitalRead(PIR_PIN));
}
#include "mail_alert.h"

void sendEvents() {
  String json; json.reserve(14000); json = "{\"events\":[";
  for (size_t i=0; i<eventCount; ++i) {
    const Event& e = events[(nextEvent + EVENT_LIMIT - 1 - i) % EVENT_LIMIT];
    if (i) json += ',';
    json += "{\"id\":" + String(e.id) + ",\"uptime_seconds\":" + String(e.uptime) + ",\"epoch\":" + String(e.epoch) + ",\"kind\":" + String(e.kind) + "}";
  }
  json += "],\"capacity\":100,\"persistent\":false}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", json);
}

String jsonString(const char* input) {
  String result = "\"";
  while (*input) {
    const uint8_t c = static_cast<uint8_t>(*input++);
    if (c == '"' || c == '\\') { result += '\\'; result += char(c); }
    else if (c < 0x20) { char escaped[7]; snprintf(escaped, sizeof(escaped), "\\u%04x", c); result += escaped; }
    else result += char(c);
  }
  return result + "\"";
}

void sendStatus() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const time_t now = time(nullptr);
  String json = "{\"wifi_connected\":";
  json += connected ? "true" : "false";
  json += ",\"station_ip\":" + jsonString(connected ? WiFi.localIP().toString().c_str() : "Sin conexión");
  json += ",\"ap_ssid\":" + jsonString(AP_SSID);
  json += ",\"ap_ip\":" + jsonString(WiFi.softAPIP().toString().c_str());
  json += ",\"ap_clients\":" + String(WiFi.softAPgetStationNum());
  json += ",\"uptime_seconds\":" + String(static_cast<unsigned long>(esp_timer_get_time() / 1000000));
  json += ",\"free_heap\":" + String(ESP.getFreeHeap());
  json += ",\"time_synced\":";
  json += now > 1700000000 ? "true" : "false";
  json += ",\"mail_state\":" + jsonString(mailState);
  json += ",\"sensor_ready\":"; json += motion.ready ? "true" : "false";
  json += ",\"motion_active\":"; json += motion.active ? "true" : "false";
  json += ",\"warmup_remaining\":" + String(motion.ready ? 0 : (60000 - millis() + 999) / 1000);
  json += ",\"epoch\":" + String(static_cast<unsigned long>(now)) + "}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json; charset=utf-8", json);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT_PULLDOWN);
  logEvent(0);
  WiFi.persistent(false);
  WiFi.setHostname("vigia");
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(true);
  if (!WiFi.softAP(AP_SSID, AP_PASSWORD)) Serial.println("ERROR: no se pudo iniciar el punto de acceso");
  Serial.printf("Red propia: %s | http://%s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  server.on("/", HTTP_GET, []() { server.send_P(200, "text/html; charset=utf-8", INDEX_HTML); });
  server.on("/api/status", HTTP_GET, sendStatus);
  server.on("/api/events", HTTP_GET, sendEvents);
  server.on("/api/time", HTTP_GET, []() {
    const time_t now = time(nullptr);
    const bool synced = now > 1700000000;
    server.sendHeader("Cache-Control", "no-store");
    server.send(synced ? 200 : 503, "application/json", String("{\"synced\":") + (synced ? "true" : "false") + ",\"epoch\":" + String(static_cast<unsigned long>(now)) + "}");
  });
  server.onNotFound([]() { server.send(404, "application/json", "{\"error\":\"Recurso no encontrado\"}"); });
  server.begin();
  startMail();
  Serial.println("Servidor HTTP iniciado. Conectando a Wi-Fi...");
}

void loop() {
  const int transition = motion.update(millis(), digitalRead(PIR_PIN) == HIGH);
  if (transition) logEvent(transition);
  if (transition == 2) queueAlertMail();
  pollMail();
  server.handleClient();
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !previouslyConnected) {
    Serial.printf("Wi-Fi conectado | http://%s\n", WiFi.localIP().toString().c_str());
    if (MDNS.begin("vigia")) MDNS.addService("http", "tcp", 80);
  }
  if (!connected && previouslyConnected) { MDNS.end(); Serial.println("Wi-Fi desconectado; el punto de acceso sigue disponible"); }
  previouslyConnected = connected;
  if (!connected && millis() - lastReconnect >= 30000) {
    lastReconnect = millis();
    WiFi.reconnect();
    Serial.printf("Reintentando Wi-Fi (estado %d)\n", WiFi.status());
  }
  static bool reportedTime = false;
  if (!reportedTime && time(nullptr) > 1700000000) { Serial.println("Hora sincronizada desde internet (NTP)"); reportedTime = true; }
  delay(2);
}
