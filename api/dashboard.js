import { readSession } from "../lib/auth.js";
import { sendJson } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { error: "Método no permitido" });
  const session = readSession(request);
  if (!session) return sendJson(response, 401, { error: "Sesión requerida" });
  try {
    const [devices, configs, events] = await Promise.all([
      supabase("devices?select=device_id,display_name,last_seen,wifi_rssi,uptime_seconds,firmware_version,local_ip,motion_active&order=last_seen.desc"),
      supabase("device_config?select=device_id,heartbeat_interval_seconds,alert_cooldown_seconds,pir_pin,sensor_type,sensor_range_cm,sensor_angle_deg,ap_ssid"),
      supabase("motion_events?select=id,device_id,event_type,occurred_at,device_epoch,uptime_seconds&order=occurred_at.desc&limit=100")
    ]);
    const configByDevice = Object.fromEntries((configs || []).map(item => [item.device_id, item]));
    const now = Date.now();
    const status = (devices || []).map(device => {
      const config = configByDevice[device.device_id] || {};
      const heartbeat = config.heartbeat_interval_seconds || 15;
      const ageSeconds = device.last_seen ? Math.floor((now - Date.parse(device.last_seen)) / 1000) : null;
      return { ...device, config, age_seconds: ageSeconds, alive: ageSeconds !== null && ageSeconds <= heartbeat * 3 };
    });
    return sendJson(response, 200, {
      user: { name: session.name, username: session.username, role: session.role },
      server_time: new Date().toISOString(), devices: status, events: events || []
    });
  } catch (error) {
    console.error("dashboard", error.message);
    return sendJson(response, 503, { error: "No fue posible consultar Supabase" });
  }
}
