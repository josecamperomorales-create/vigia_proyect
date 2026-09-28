import { clearSessionCookie } from "../lib/auth.js";
import { sendJson } from "../lib/http.js";

export default function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Método no permitido" });
  clearSessionCookie(response);
  return sendJson(response, 200, { ok: true });
}
