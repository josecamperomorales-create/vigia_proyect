#pragma once
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

enum CloudEventType : uint8_t { CLOUD_HEARTBEAT = 0, CLOUD_MOTION_START = 1, CLOUD_MOTION_END = 2 };
struct CloudJob { CloudEventType type; uint32_t epoch; uint32_t uptime; bool motionActive; };
QueueHandle_t cloudQueue = nullptr;
TaskHandle_t cloudTaskHandle = nullptr;
volatile int cloudStateCode = 0;
uint32_t lastCloudHeartbeat = 0;

const char* cloudStateText() {
  switch (cloudStateCode) {
    case 1: return "En cola";
    case 2: return "Enviando";
    case 3: return "Sincronizado";
    case 4: return "Error de nube";
    case 5: return "Sin Wi-Fi";
    default: return strlen(CLOUD_API_URL) ? "Esperando" : "Pendiente de configurar";
  }
}

void queueCloudEvent(CloudEventType type, bool motionActive) {
  if (!cloudQueue || !strlen(CLOUD_API_URL) || !strlen(DEVICE_API_KEY)) return;
  const time_t now = time(nullptr);
  CloudJob job = {type, now > 1700000000 ? static_cast<uint32_t>(now) : 0,
                  static_cast<uint32_t>(esp_timer_get_time() / 1000000), motionActive};
  if (xQueueSend(cloudQueue, &job, 0) == pdTRUE) cloudStateCode = 1;
  else Serial.println("Nube: cola llena; evento omitido");
}

void cloudWorker(void*) {
  CloudJob job;
  for (;;) {
    if (xQueueReceive(cloudQueue, &job, portMAX_DELAY) != pdTRUE) continue;
    if (WiFi.status() != WL_CONNECTED) { cloudStateCode = 5; continue; }
    if (!tlsMutex) { cloudStateCode = 4; continue; }
    xSemaphoreTake(tlsMutex, portMAX_DELAY);
    cloudStateCode = 2;
    WiFiClientSecure client;
    client.setCACert(CLOUD_CA);
    client.setHandshakeTimeout(12);
    client.setTimeout(12000);
    HTTPClient http;
    http.setConnectTimeout(10000);
    http.setTimeout(12000);
    const char* type = job.type == CLOUD_MOTION_START ? "motion_start" : job.type == CLOUD_MOTION_END ? "motion_end" : "heartbeat";
    int status = -1;
    if (http.begin(client, CLOUD_API_URL)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", String("Bearer ") + DEVICE_API_KEY);
      String payload;
      payload.reserve(420);
      payload = String("{\"device_id\":\"") + DEVICE_ID + "\",\"display_name\":\"Vigía ESP32 principal\",\"type\":\"" + type +
        "\",\"wifi_rssi\":" + String(WiFi.RSSI()) + ",\"uptime_seconds\":" + String(job.uptime) +
        ",\"firmware_version\":\"" + FIRMWARE_VERSION + "\",\"local_ip\":\"" + WiFi.localIP().toString() +
        "\",\"motion_active\":" + (job.motionActive ? "true" : "false") + ",\"epoch\":" + String(job.epoch) + "}";
      status = http.POST(payload);
      http.end();
    }
    xSemaphoreGive(tlsMutex);
    cloudStateCode = status >= 200 && status < 300 ? 3 : 4;
    Serial.printf("Nube: %s -> HTTP %d\n", type, status);
  }
}

void startCloudSync() {
  if (!strlen(CLOUD_API_URL) || !strlen(DEVICE_API_KEY)) {
    Serial.println("Nube: pendiente de configurar CLOUD_API_URL y DEVICE_API_KEY");
    return;
  }
  cloudQueue = xQueueCreate(10, sizeof(CloudJob));
  if (!cloudQueue) { cloudStateCode = 4; Serial.println("Nube: no se pudo crear la cola"); return; }
  if (xTaskCreatePinnedToCore(cloudWorker, "vigia-cloud", 8192, nullptr, 1, &cloudTaskHandle, 0) != pdPASS) {
    vQueueDelete(cloudQueue); cloudQueue = nullptr; cloudStateCode = 4;
    Serial.println("Nube: no se pudo iniciar la tarea"); return;
  }
  lastCloudHeartbeat = millis() - CLOUD_HEARTBEAT_INTERVAL_MS;
}

void pollCloudSync(bool motionActive) {
  if (!cloudQueue || WiFi.status() != WL_CONNECTED) return;
  const uint32_t now = millis();
  if (now - lastCloudHeartbeat >= CLOUD_HEARTBEAT_INTERVAL_MS) {
    lastCloudHeartbeat = now;
    // Heartbeats are disposable. Never let them accumulate ahead of motion events.
    if (uxQueueMessagesWaiting(cloudQueue) == 0) queueCloudEvent(CLOUD_HEARTBEAT, motionActive);
  }
}
