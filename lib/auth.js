import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "vigia_session";
const MAX_AGE = 8 * 60 * 60;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  return value;
}

function signature(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSession(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.user_id,
    name: user.full_name,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function readSession(request) {
  const cookies = Object.fromEntries((request.headers.cookie || "").split(";").map(item => {
    const index = item.indexOf("=");
    return index < 0 ? ["", ""] : [item.slice(0, index).trim(), item.slice(index + 1).trim()];
  }));
  const [payload, supplied = ""] = (cookies[COOKIE] || "").split(".");
  if (!payload || !supplied) return null;
  const expected = signature(payload);
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch { return null; }
}

export function setSessionCookie(response, token) {
  response.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
}

export function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function safeTokenMatch(value, expected) {
  if (!value || !expected) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
