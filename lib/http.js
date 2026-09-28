export function sendJson(response, status, value) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(status).json(value);
}

export function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.length <= 16_384) {
    try { return JSON.parse(request.body); } catch { return null; }
  }
  return null;
}
