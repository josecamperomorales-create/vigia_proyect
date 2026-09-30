const $ = selector => document.querySelector(selector);
const bootView = $("#bootView");
const loginView = $("#loginView");
const dashboardView = $("#dashboardView");
const brandActions = $("#brandActions");
const accountDialog = $("#accountDialog");
let timer;
let currentUser;

const boliviaTime = value => value ? new Intl.DateTimeFormat("es-BO", {
  dateStyle: "medium", timeStyle: "medium", timeZone: "America/La_Paz"
}).format(new Date(value)) : "Sin reportes";
const duration = seconds => {
  if (!Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), mins = Math.floor(seconds % 3600 / 60);
  return [days && `${days} d`, hours && `${hours} h`, `${mins} min`].filter(Boolean).join(" ");
};
const api = async (url, options) => {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || "Solicitud fallida"); error.status = response.status; throw error; }
  return data;
};
function startPolling() { clearInterval(timer); timer = setInterval(refresh, 15000); }
function showLogin(message = "") {
  clearInterval(timer); bootView.classList.add("hidden"); loginView.classList.remove("hidden"); dashboardView.classList.add("hidden"); brandActions.classList.add("hidden");
  $("#loginError").textContent = message;
}
function showDashboard() {
  bootView.classList.add("hidden"); loginView.classList.add("hidden"); dashboardView.classList.remove("hidden"); brandActions.classList.remove("hidden");
}
function showBootError(message) {
  $("#bootText").textContent = message; $("#retryButton").classList.remove("hidden");
}
function render(data) {
  currentUser = data.user; showDashboard();
  $("#welcome").textContent = `${data.user.name} · ${data.user.role}`;
  const device = data.devices[0];
  if (!device) { $("#dashboardError").textContent = "No existe un dispositivo configurado en Supabase."; return; }
  $("#deviceName").textContent = device.display_name;
  $("#liveLabel").textContent = device.alive ? "Monitor activo" : "Monitor sin conexión";
  $("#liveDot").className = `status-dot ${device.alive ? "alive" : "offline"}`;
  $("#lastSeen").textContent = device.last_seen ? `Último latido: ${boliviaTime(device.last_seen)} · hace ${Math.max(0, device.age_seconds)} s` : "El ESP32 todavía no envió su primer latido";
  $("#motion").textContent = device.motion_active ? "Movimiento" : "En calma";
  $("#motion").className = device.motion_active ? "danger" : "";
  $("#rssi").textContent = Number.isFinite(device.wifi_rssi) ? `${device.wifi_rssi} dBm` : "—";
  $("#ip").textContent = device.local_ip || "Sin IP reportada";
  $("#uptime").textContent = duration(device.uptime_seconds);
  $("#firmware").textContent = `Firmware ${device.firmware_version || "—"}`;
  const c = device.config || {};
  const values = [["Latido",`${c.heartbeat_interval_seconds || 15} segundos`],["Alerta por correo",`${c.alert_cooldown_seconds || 10} segundos`],["Sensor",c.sensor_type || "HC-SR501"],["Pin de señal",`GPIO ${c.pir_pin ?? 27}`],["Alcance nominal",`${c.sensor_range_cm || 700} cm`],["Ángulo nominal",`${c.sensor_angle_deg || 120}°`],["Red local",c.ap_ssid || "Vigia-ESP32"],["Identificador",device.device_id]];
  $("#configGrid").innerHTML = values.map(([label,value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#eventCount").textContent = `${data.events.length} evento${data.events.length === 1 ? "" : "s"}`;
  $("#eventRows").innerHTML = data.events.map(event => `<tr><td><span class="event-badge ${event.event_type === "motion_end" ? "end" : ""}">${event.event_type === "motion_start" ? "Movimiento detectado" : "Movimiento finalizado"}</span></td><td>${boliviaTime(event.occurred_at)}</td><td>${event.device_id}</td><td>${duration(event.uptime_seconds)}</td></tr>`).join("");
  $("#emptyEvents").classList.toggle("hidden", data.events.length > 0);
  $("#dashboardError").textContent = "";
}
async function refresh(initial = false) {
  try { render(await api("/api/dashboard")); $("#refreshText").textContent = `Actualizado ${new Date().toLocaleTimeString("es-BO")}`; }
  catch (error) {
    if (error.status === 401) showLogin();
    else if (initial) showBootError("No se pudo conectar con el servicio. Comprueba tu conexión y reintenta.");
    else $("#dashboardError").textContent = error.message;
  }
}
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault(); $("#loginError").textContent = "";
  const form = event.currentTarget;
  const fields = new FormData(form);
  try { await api("/api/login", { method: "POST", body: JSON.stringify({ username: fields.get("username"), password: fields.get("password") }) }); form.reset(); await refresh(); startPolling(); }
  catch (error) { $("#loginError").textContent = error.message; }
});
$("#logout").addEventListener("click", async () => { try { await api("/api/logout", { method: "POST" }); } finally { showLogin(); } });
$("#retryButton").addEventListener("click", () => { $("#retryButton").classList.add("hidden"); $("#bootText").textContent = "Validando tu sesión segura…"; refresh(true).then(() => { if (!dashboardView.classList.contains("hidden")) startPolling(); }); });
$("#accountButton").addEventListener("click", () => { $("#accountForm").reset(); $("#newUsername").value = currentUser?.username || ""; $("#accountMessage").textContent = ""; accountDialog.showModal(); });
$("#closeAccount").addEventListener("click", () => accountDialog.close());
$("#accountForm").addEventListener("submit", async event => {
  event.preventDefault(); const fields = new FormData(event.currentTarget); const password = fields.get("new_password");
  if (password !== fields.get("confirm_password")) { $("#accountMessage").textContent = "Las contraseñas nuevas no coinciden"; return; }
  $("#accountMessage").textContent = "";
  try {
    const result = await api("/api/account", { method: "PATCH", body: JSON.stringify({ current_password: fields.get("current_password"), new_username: fields.get("new_username"), new_password: password }) });
    currentUser = result.user; accountDialog.close(); await refresh();
  } catch (error) { $("#accountMessage").textContent = error.message; }
});
refresh(true).then(() => { if (!dashboardView.classList.contains("hidden")) startPolling(); });
