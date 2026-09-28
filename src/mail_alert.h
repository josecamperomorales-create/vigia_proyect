#pragma once
#include <WiFiClientSecure.h>
#include <mbedtls/base64.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// All mutable SMTP state belongs to the worker; main loop owns event logging.
struct MailJob { unsigned long epoch; unsigned long uptime; bool test; };
QueueHandle_t mailJobs = nullptr, mailResults = nullptr;
const char* mailState = "Disponible";
uint32_t lastAlertQueued = 0;
bool alertEverQueued = false;
bool mailBusy = false;

String smtpBase64(const String& input) {
  size_t size = 4 * ((input.length()+2)/3) + 1, written=0;
  unsigned char* buffer = new unsigned char[size];
  mbedtls_base64_encode(buffer,size,&written,reinterpret_cast<const unsigned char*>(input.c_str()),input.length());
  buffer[written]=0;
  String result(reinterpret_cast<char*>(buffer)); delete[] buffer; return result;
}
void appendWrappedBase64(String& target, const String& input) {
  const String encoded=smtpBase64(input);
  for(size_t i=0;i<encoded.length();i+=76)target+=encoded.substring(i,i+76)+"\r\n";
}
// Bound response sizes/time and consume multiline SMTP replies completely.
int smtpReply(WiFiClientSecure& client) {
  const uint32_t start=millis(); String line; line.reserve(256);
  while(uint32_t(millis()-start)<15000) {
    while(client.available()) {
      char c=client.read();
      if(c=='\n') {
        if(line.length()>=4 && line[3]==' ') return line.substring(0,3).toInt();
        line="";
      } else if(c!='\r') { if(line.length()>=1024)return -1; line+=c; }
    }
    if(!client.connected() && !client.available())return -1;
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  return -1;
}
bool smtpCommand(WiFiClientSecure& client,const String& command,int expected) {
  client.print(command);client.print("\r\n");
  return smtpReply(client)==expected;
}
// 5 accepted, 6 failure, 9 ambiguous result after DATA (never automatically resend).
uint8_t sendAlertMail(const MailJob& job) {
  WiFiClientSecure client;
  client.setCACert(SMTP_CA);
  client.setHandshakeTimeout(15);
  client.setTimeout(15000);
  if(!client.connect(SMTP_HOST,465))return 6;
  if(smtpReply(client)!=220 || !smtpCommand(client,"EHLO vigia.local",250)
     || !smtpCommand(client,"AUTH LOGIN",334)
     || !smtpCommand(client,smtpBase64(SMTP_USER),334)
     || !smtpCommand(client,smtpBase64(SMTP_PASSWORD),235)
     || !smtpCommand(client,"MAIL FROM:<"+String(SMTP_USER)+">",250)
     || !smtpCommand(client,"RCPT TO:<"+String(ALERT_EMAIL_TO)+">",250)
     || !smtpCommand(client,"DATA",354)) { client.stop(); return 6; }

  const time_t now=time(nullptr);
  struct tm utc; gmtime_r(&now,&utc); char date[64];
  strftime(date,sizeof(date),"%a, %d %b %Y %H:%M:%S +0000",&utc);
  const time_t eventEpoch=job.epoch?static_cast<time_t>(job.epoch):now;
  const time_t boliviaEpoch=eventEpoch-(4*60*60);
  struct tm bolivia; gmtime_r(&boliviaEpoch,&bolivia);
  char boliviaDisplay[40],boliviaIso[40];
  strftime(boliviaDisplay,sizeof(boliviaDisplay),"%d/%m/%Y · %H:%M:%S",&bolivia);
  strftime(boliviaIso,sizeof(boliviaIso),"%Y-%m-%dT%H:%M:%S-04:00",&bolivia);
  const String eventTitle=job.test?"Prueba del sistema":"Movimiento detectado";
  const String eventLabel=job.test?"PRUEBA CONTROLADA":"ALERTA ACTIVA";

  String body=eventTitle+"\r\n\r\n";
  body+="Fecha y hora (Bolivia): "+String(boliviaDisplay)+" BOT (UTC-04:00)\r\n";
  body+="Marca ISO 8601: "+String(boliviaIso)+"\r\n";
  body+="Tiempo encendido: "+String(job.uptime)+" segundos\r\n";
  body+="Dispositivo: Vigia ESP32\r\nRed: "+WiFi.SSID()+"\r\nIP local: "+WiFi.localIP().toString()+"\r\n\r\n";
  body+=job.test?"Este mensaje verifica el canal de alertas. No corresponde a una deteccion real.\r\n":"El sensor PIR registro actividad compatible con movimiento. Verifica el area.\r\n";
  body+="El PIR detecta movimiento; esta alerta por si sola no confirma una intrusion.\r\n";

  String html="<!doctype html><html><body style=\"margin:0;padding:0;background:#edf3f3;font-family:Arial,Helvetica,sans-serif;color:#17383b\">";
  html+="<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#edf3f3;padding:28px 12px\"><tr><td align=\"center\">";
  html+="<table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden\">";
  html+="<tr><td style=\"background-color:#075e65;background-image:linear-gradient(135deg,#075e65,#0b8584);padding:30px;color:#ffffff\">";
  html+="<div style=\"font-size:13px;letter-spacing:3px;opacity:.82\">VIGÍA · MONITOREO EN TIEMPO REAL</div>";
  html+="<div style=\"font-size:30px;font-weight:bold;margin-top:10px\">◉ "+eventTitle+"</div>";
  html+="<div style=\"margin-top:14px;display:inline-block;padding:7px 12px;border-radius:999px;background:#ffffff;color:#075e65;font-size:12px;font-weight:bold;letter-spacing:1px\">"+eventLabel+"</div></td></tr>";
  html+="<tr><td style=\"padding:30px\"><p style=\"font-size:17px;line-height:1.55;margin:0 0 22px\">";
  html+=job.test?"El canal de correo de Vigía está funcionando correctamente.":"El sensor PIR detectó actividad. Revisa el área monitoreada cuando sea seguro hacerlo.";
  html+="</p><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f8f8;border-radius:12px\">";
  html+="<tr><td style=\"padding:16px 18px;border-bottom:1px solid #dce9e9;color:#567477;font-size:13px\">HORA EN BOLIVIA</td><td align=\"right\" style=\"padding:16px 18px;border-bottom:1px solid #dce9e9;font-weight:bold\">"+String(boliviaDisplay)+"</td></tr>";
  html+="<tr><td style=\"padding:16px 18px;border-bottom:1px solid #dce9e9;color:#567477;font-size:13px\">ZONA HORARIA</td><td align=\"right\" style=\"padding:16px 18px;border-bottom:1px solid #dce9e9\">BOT · UTC−04:00</td></tr>";
  html+="<tr><td style=\"padding:16px 18px;border-bottom:1px solid #dce9e9;color:#567477;font-size:13px\">DISPOSITIVO</td><td align=\"right\" style=\"padding:16px 18px;border-bottom:1px solid #dce9e9\">Vigía ESP32</td></tr>";
  html+="<tr><td style=\"padding:16px 18px;border-bottom:1px solid #dce9e9;color:#567477;font-size:13px\">TIEMPO ENCENDIDO</td><td align=\"right\" style=\"padding:16px 18px;border-bottom:1px solid #dce9e9\">"+String(job.uptime)+" s</td></tr>";
  html+="<tr><td style=\"padding:16px 18px;color:#567477;font-size:13px\">IP LOCAL</td><td align=\"right\" style=\"padding:16px 18px\">"+WiFi.localIP().toString()+"</td></tr></table>";
  html+="<p style=\"margin:24px 0 0;color:#789092;font-size:12px;line-height:1.5\">Evento: "+String(boliviaIso)+" · Mensaje automático de Vigía</p>";
  html+="</td></tr><tr><td style=\"padding:18px 30px;background:#143f43;color:#bcd3d4;font-size:12px\">Protección activa · ESP32 + sensor PIR</td></tr></table></td></tr></table></body></html>";

  const String boundary="vigia-"+String(esp_random(),HEX);
  String message="From: "+String(SMTP_FROM_NAME)+" <"+SMTP_USER+">\r\nTo: <"+ALERT_EMAIL_TO+">\r\nDate: "+date;
  message+="\r\nMessage-ID: <"+String(static_cast<unsigned long>(now))+"."+String(esp_random(),HEX)+"@vigia.local>";
  const String subject=job.test?"[Vigía] Prueba visual del sistema":"[Vigía] Movimiento detectado";
  message+="\r\nSubject: =?UTF-8?B?"+smtpBase64(subject)+"?=";
  message+="\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\""+boundary+"\"\r\n\r\n";
  message+="--"+boundary+"\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
  appendWrappedBase64(message,body);
  message+="--"+boundary+"\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
  appendWrappedBase64(message,html);
  message+="--"+boundary+"--\r\n.\r\n";
  const size_t written=client.print(message);
  const int reply=written==message.length()?smtpReply(client):-1;
  client.stop();
  return reply==250?5:reply<0?9:6;
}
void mailWorker(void*) {
  MailJob job;
  for(;;) {
    if(xQueueReceive(mailJobs,&job,portMAX_DELAY)!=pdTRUE)continue;
    uint8_t result=6;
    // Up to 60s waiting for network/time. No automatic resend after SMTP DATA.
    for(int wait=0;wait<60 && (WiFi.status()!=WL_CONNECTED || time(nullptr)<1700000000);++wait)
      vTaskDelay(pdMS_TO_TICKS(1000));
    if(WiFi.status()==WL_CONNECTED && time(nullptr)>1700000000) result=sendAlertMail(job);
    xQueueSend(mailResults,&result,portMAX_DELAY);
  }
}
void startMail() {
  mailJobs=xQueueCreate(1,sizeof(MailJob));mailResults=xQueueCreate(1,sizeof(uint8_t));
  if(!mailJobs || !mailResults || xTaskCreate(mailWorker,"vigia-mail",16384,nullptr,1,nullptr)!=pdPASS) {
    mailState="No disponible"; logEvent(6);
    if(mailJobs)vQueueDelete(mailJobs);
    if(mailResults)vQueueDelete(mailResults);
    mailJobs=nullptr;mailResults=nullptr;
  }
}
void queueAlertMail(bool test=false) {
  if(!mailJobs){logEvent(6);return;}
  if(mailBusy || (!test && alertEverQueued && uint32_t(millis()-lastAlertQueued)<ALERT_EMAIL_COOLDOWN_MS)) {
    logEvent(7);return;
  }
  time_t now=time(nullptr);
  MailJob job={now>1700000000?static_cast<unsigned long>(now):0,static_cast<unsigned long>(esp_timer_get_time()/1000000),test};
  if(xQueueSend(mailJobs,&job,0)==pdTRUE) {
    mailBusy=true;mailState="Enviando";logEvent(4);
    // Diagnostic emails must not suppress the next real motion alert.
    if(!test){alertEverQueued=true;lastAlertQueued=millis();}
  }
}
void pollMail() {
  uint8_t result;
  if(mailResults && xQueueReceive(mailResults,&result,0)==pdTRUE) {
    mailBusy=false;
    mailState=result==5?"Aceptado por Gmail":result==9?"Resultado incierto":"Error de envio";
    logEvent(result);Serial.printf("Correo: %s\n",mailState);
  }
  // USB-only diagnostic: T sends a labeled test without consuming motion cooldown.
  while(Serial.available()) { char c=Serial.read();if(c=='T')queueAlertMail(true); }
}
