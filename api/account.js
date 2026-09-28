import bcrypt from "bcryptjs";
import { createSession, readSession, setSessionCookie } from "../lib/auth.js";
import { readBody, sendJson } from "../lib/http.js";
import { supabase } from "../lib/supabase.js";

const USERNAME = /^[a-z0-9._-]{3,40}$/;

export default async function handler(request, response) {
  if (request.method !== "PATCH") return sendJson(response, 405, { error: "Método no permitido" });
  const session = readSession(request);
  if (!session) return sendJson(response, 401, { error: "Sesión requerida" });
  const body = readBody(request);
  const currentPassword = body?.current_password;
  const newUsername = String(body?.new_username || "").trim().toLowerCase();
  const newPassword = String(body?.new_password || "");
  if (!currentPassword || !USERNAME.test(newUsername)) {
    return sendJson(response, 400, { error: "El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo" });
  }
  if (newPassword && (newPassword.length < 8 || newPassword.length > 200)) {
    return sendJson(response, 400, { error: "La nueva contraseña debe tener entre 8 y 200 caracteres" });
  }
  try {
    const users = await supabase("rpc/authenticate_dashboard_user", {
      method: "POST", body: { p_username: session.username, p_password: currentPassword }
    });
    const current = users?.[0];
    if (!current || current.user_id !== session.id) {
      return sendJson(response, 401, { error: "La contraseña actual es incorrecta" });
    }
    const changes = { username: newUsername };
    if (newPassword) changes.password_hash = await bcrypt.hash(newPassword, 12);
    await supabase(`dashboard_users?id=eq.${encodeURIComponent(session.id)}`, {
      method: "PATCH", body: changes, prefer: "return=minimal"
    });
    const updated = { ...current, username: newUsername };
    setSessionCookie(response, createSession(updated));
    return sendJson(response, 200, {
      user: { name: updated.full_name, username: updated.username, role: updated.role }
    });
  } catch (error) {
    console.error("account", error.message);
    if (error.message.includes("23505")) return sendJson(response, 409, { error: "Ese nombre de usuario ya existe" });
    return sendJson(response, 503, { error: "No fue posible actualizar la cuenta" });
  }
}
