#pragma once
#include <ArduinoJson.h>
struct PolicySlot { int day, start, end; };
struct MonitoringPolicy { bool ready=false, enabled=false, scheduled=false; int count=0; PolicySlot slots[28]; char version[40]={0}; };
MonitoringPolicy monitoringPolicy;
portMUX_TYPE policyMux = portMUX_INITIALIZER_UNLOCKED;
MonitoringPolicy policySnapshot() {
  portENTER_CRITICAL(&policyMux); MonitoringPolicy copy=monitoringPolicy; portEXIT_CRITICAL(&policyMux); return copy;
}
bool monitoringAllowed() {
  const auto p=policySnapshot();
  if(!p.ready || !p.enabled)return false;
  if(!p.scheduled)return true;
  time_t now=time(nullptr); if(now<1700000000)return false;
  now-=14400; struct tm local; gmtime_r(&now,&local);
  int day=local.tm_wday, minute=local.tm_hour*60+local.tm_min;
  for(int i=0;i<p.count;++i) { const auto s=p.slots[i];
    if(s.start<s.end ? day==s.day && minute>=s.start && minute<s.end : (day==s.day && minute>=s.start) || (day==(s.day+1)%7 && minute<s.end))return true;
  }
  return false;
}
bool applyMonitoringPolicy(const String& payload) {
  StaticJsonDocument<4096> doc;
  if(deserializeJson(doc,payload) || !doc["enabled"].is<bool>() || !doc["scheduled"].is<bool>() || !doc["version"].is<const char*>() || !doc["slots"].is<JsonArray>())return false;
  MonitoringPolicy p; p.ready=true; p.enabled=doc["enabled"]; p.scheduled=doc["scheduled"];
  strlcpy(p.version,doc["version"],sizeof(p.version));
  for(JsonArray a:doc["slots"].as<JsonArray>()) {
    if(p.count>=28 || a.size()!=3)return false;
    int day=a[0], start=a[1], end=a[2];
    if(day<0 || day>6 || start<0 || start>1439 || end<0 || end>1439 || start==end)return false;
    p.slots[p.count++]={day,start,end};
  }
  portENTER_CRITICAL(&policyMux); monitoringPolicy=p; portEXIT_CRITICAL(&policyMux);
  return true;
}
