import { readSession, safeTokenMatch } from "../lib/auth.js";
import { readBody, sendJson } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";
import { validatePolicy, devicePolicy } from "../lib/monitoring.js";

export default async function handler(req, res) {
  const deviceAccess =
    req.method === "GET" &&
    safeTokenMatch(
      (req.headers.authorization || "").replace(/^Bearer\s+/i, ""),
      process.env.DEVICE_API_KEY,
    );
  const session = deviceAccess ? null : readSession(req);
  if (!deviceAccess && !session)
    return sendJson(res, 401, { error: "Sesión requerida" });
  if (!["GET", "PATCH"].includes(req.method))
    return sendJson(res, 405, { error: "Método no permitido" });
  const body = req.method === "PATCH" ? readBody(req) : null;
  const id = body?.device_id || req.query?.device_id;
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id || ""))
    return sendJson(res, 400, { error: "Dispositivo inválido" });
  try {
    if (req.method === "GET") {
      const [config] = await supabase(
        `device_config?device_id=eq.${id}&select=*`,
      );
      if (!config)
        return sendJson(res, 404, { error: "Dispositivo sin configuración" });
      return sendJson(
        res,
        200,
        deviceAccess ? devicePolicy(config) : { config },
      );
    }
    if (session.role !== "admin")
      return sendJson(res, 403, { error: "Se requiere administrador" });
    let policy;
    try {
      policy = validatePolicy(body);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
    if (typeof body.version !== "string")
      return sendJson(res, 400, { error: "Falta la versión de configuración" });
    const rows = await supabase(
      `device_config?device_id=eq.${id}&updated_at=eq.${encodeURIComponent(body.version)}`,
      {
        method: "PATCH",
        body: { ...policy, updated_at: new Date().toISOString() },
        prefer: "return=representation",
      },
    );
    if (!rows?.length)
      return sendJson(res, 409, {
        error:
          "La configuración cambió en otra sesión. Recarga antes de guardar.",
      });
    return sendJson(res, 200, { config: rows[0] });
  } catch (e) {
    console.error("config", e.message);
    return sendJson(res, 503, {
      error: "No fue posible sincronizar la configuración",
    });
  }
}
