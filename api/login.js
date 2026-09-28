import { createSession, setSessionCookie } from "../lib/auth.js";
import { readBody, sendJson } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Método no permitido" });
  const body = readBody(request);
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password || username.length > 80 || password.length > 200) {
    return sendJson(response, 400, { error: "Credenciales inválidas" });
  }
  try {
    const users = await supabase("rpc/authenticate_dashboard_user", {
      method: "POST", body: { p_username: username, p_password: password }
    });
    const user = users?.[0];
    if (!user) {
      await new Promise(resolve => setTimeout(resolve, 350));
      return sendJson(response, 401, { error: "Usuario o contraseña incorrectos" });
    }
    setSessionCookie(response, createSession(user));
    return sendJson(response, 200, { user: { name: user.full_name, username: user.username, role: user.role } });
  } catch (error) {
    console.error("login", error.message);
    return sendJson(response, 503, { error: "El servicio de acceso no está disponible" });
  }
}
