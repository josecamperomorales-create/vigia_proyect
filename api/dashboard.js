import { isMonitoringActive } from "../lib/monitoring.js";
import { readSession } from "../lib/auth.js";
import { sendJson } from "../lib/http.js";
import { supabase, supabaseCount } from "../lib/supabase.js";

export default async function handler(request, response) {
  if (request.method !== "GET")
    return sendJson(response, 405, { error: "Método no permitido" });
  const session = readSession(request);
  if (!session) return sendJson(response, 401, { error: "Sesión requerida" });
  try {
    const serverNow = new Date();
    const bolivia = new Date(serverNow.getTime() - 4 * 3600000);
    const todayStart = new Date(
      Date.UTC(
        bolivia.getUTCFullYear(),
        bolivia.getUTCMonth(),
        bolivia.getUTCDate(),
      ) +
        4 * 3600000,
    );
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);
    const countQuery =
      `motion_events?select=id&event_type=eq.motion_start` +
      `&occurred_at=gte.${encodeURIComponent(todayStart.toISOString())}` +
      `&occurred_at=lt.${encodeURIComponent(tomorrowStart.toISOString())}`;
    const [devices, configs, events, telemetry, detectionsToday] =
      await Promise.all([
        supabase(
          "devices?select=device_id,display_name,last_seen,wifi_rssi,uptime_seconds,firmware_version,local_ip,motion_active,monitoring_active,config_version,raw_pir_high,raw_pir_edges,sensor_ready,sensor_armed,suppressed_alerts,free_heap&order=last_seen.desc",
        ),
        supabase("device_config?select=*"),
        supabase(
          "motion_events?select=id,device_id,event_type,occurred_at,device_epoch,uptime_seconds&order=occurred_at.desc&limit=100",
        ),
        supabase(
          "device_telemetry?select=id,device_id,log_type,received_at,uptime_seconds,wifi_rssi,free_heap,motion_active,monitoring_active,sensor_ready,sensor_armed,raw_pir_high,raw_pir_edges,suppressed_alerts,firmware_version&order=received_at.desc&limit=80",
        ),
        supabaseCount(countQuery),
      ]);
    const configByDevice = Object.fromEntries(
      (configs || []).map((item) => [item.device_id, item]),
    );
    const now = Date.now();
    const status = (devices || []).map((device) => {
      const config = configByDevice[device.device_id] || {};
      const heartbeat = config.heartbeat_interval_seconds || 15;
      const ageSeconds = device.last_seen
        ? Math.floor((now - Date.parse(device.last_seen)) / 1000)
        : null;
      return {
        ...device,
        config,
        desired_active: isMonitoringActive(config),
        config_synced: device.config_version === config.updated_at,
        age_seconds: ageSeconds,
        alive: ageSeconds !== null && ageSeconds <= heartbeat * 3,
      };
    });
    return sendJson(response, 200, {
      user: {
        name: session.name,
        username: session.username,
        role: session.role,
      },
      server_time: new Date().toISOString(),
      devices: status,
      events: events || [],
      telemetry: telemetry || [],
      detections_today: detectionsToday,
    });
  } catch (error) {
    console.error("dashboard", error.message);
    return sendJson(response, 503, {
      error: "No fue posible consultar Supabase",
    });
  }
}
