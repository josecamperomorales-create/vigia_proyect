import { safeTokenMatch } from "../lib/auth.js";
import { readBody, sendJson } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";

const DEVICE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const EVENTS = new Set(["motion_start", "motion_end"]);

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Método no permitido" });
  const token = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!safeTokenMatch(token, process.env.DEVICE_API_KEY)) return sendJson(response, 401, { error: "Dispositivo no autorizado" });
  const body = readBody(request);
  if (!body || !DEVICE_ID.test(body.device_id || "") || (body.type !== "heartbeat" && !EVENTS.has(body.type))) {
    return sendJson(response, 400, { error: "Evento inválido" });
  }
  const integer = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
  const receivedAt = new Date().toISOString();
  const device = {
    device_id: body.device_id,
    display_name: String(body.display_name || "Vigía ESP32").slice(0, 80),
    last_seen: receivedAt,
    wifi_rssi: integer(body.wifi_rssi, -127, 0),
    uptime_seconds: integer(body.uptime_seconds, 0, 4_294_967_295),
    firmware_version: String(body.firmware_version || "desconocida").slice(0, 32),
    local_ip: body.local_ip ? String(body.local_ip).slice(0, 45) : null,
    motion_active: Boolean(body.motion_active),
    updated_at: receivedAt
  };
  try {
    await supabase("devices?on_conflict=device_id", {
      method: "POST", body: device, prefer: "resolution=merge-duplicates,return=minimal"
    });
    if (EVENTS.has(body.type)) {
      await supabase("motion_events", {
        method: "POST",
        body: {
          device_id: body.device_id,
          event_type: body.type,
          occurred_at: receivedAt,
          device_epoch: integer(body.epoch, 0, 4_294_967_295),
          uptime_seconds: integer(body.uptime_seconds, 0, 4_294_967_295)
        },
        prefer: "return=minimal"
      });
    }
    return sendJson(response, 202, { ok: true, received_at: receivedAt });
  } catch (error) {
    console.error("device-ingest", error.message);
    return sendJson(response, 503, { error: "No fue posible almacenar el evento" });
  }
}
