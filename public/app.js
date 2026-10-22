const $ = (selector) => document.querySelector(selector);
const bootView = $("#bootView"),
  loginView = $("#loginView"),
  dashboardView = $("#dashboardView"),
  brandActions = $("#brandActions"),
  accountDialog = $("#accountDialog"),
  logsDialog = $("#logsDialog");
let draftVersion = null;
let timer,
  currentUser,
  currentDevice,
  latestTelemetry = [],
  logsPaused = false,
  renderedTelemetryIds = new Set(),
  dirty = false,
  saving = false,
  refreshing = false,
  sessionGeneration = 0;
const days = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const timeFormat = (options) =>
  new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", ...options });
const boliviaTime = (value) =>
  value
    ? timeFormat({ dateStyle: "medium", timeStyle: "medium" }).format(
        new Date(value),
      )
    : "Sin reportes";
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = new Error(data.error || "No fue posible completar la solicitud");
    e.status = response.status;
    throw e;
  }
  return data;
};
function startPolling() {
  clearInterval(timer);
  timer = setInterval(() => refresh(), 2000);
}
function showLogin(message = "") {
  ++sessionGeneration;
  clearInterval(timer);
  bootView.classList.add("hidden");
  loginView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
  brandActions.classList.add("hidden");
  if (logsDialog.open) logsDialog.close();
  $("#loginError").textContent = message;
}
function showDashboard() {
  bootView.classList.add("hidden");
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  brandActions.classList.remove("hidden");
}
function showBootError(message) {
  $("#bootText").textContent = message;
  $("#retryButton").classList.remove("hidden");
}
function selectTab(name, focus = false) {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const active = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    $("#panel-" + button.dataset.tab).classList.toggle("hidden", !active);
    if (active && focus) button.focus();
  }
  sessionStorage.setItem("vigia-tab", name);
}
for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    const names = ["overview", "activity", "settings"];
    let n = names.indexOf(button.dataset.tab);
    if (event.key === "ArrowRight") n = (n + 1) % 3;
    else if (event.key === "ArrowLeft") n = (n + 2) % 3;
    else if (event.key === "Home") n = 0;
    else if (event.key === "End") n = 2;
    else return;
    event.preventDefault();
    selectTab(names[n], true);
  });
}
selectTab(
  ["overview", "activity", "settings"].includes(
    sessionStorage.getItem("vigia-tab"),
  )
    ? sessionStorage.getItem("vigia-tab")
    : "overview",
);
$("#editSchedule").onclick = () => selectTab("settings", true);
$("#viewActivity").onclick = () => selectTab("activity", true);
function markDirty() {
  if (!dirty) draftVersion = currentDevice?.config.updated_at;
  dirty = true;
  $("#scheduleMessage").textContent = "Cambios sin guardar";
}
const slotSummary = (slot) => {
  const overnight = slot.start > slot.end;
  return `${days[slot.day]} · ${slot.start} → ${slot.end}${overnight ? " · termina al día siguiente" : ""}`;
};
function updateSchedulePreview() {
  const rows = [...document.querySelectorAll(".slot-row")];
  const enabled = $("#scheduleEnabled").checked;
  if (!enabled) {
    $("#schedulePreview").innerHTML =
      "<strong>Monitoreo continuo</strong><span>Capturará movimiento todos los días y a cualquier hora.</span>";
    return;
  }
  if (!rows.length) {
    $("#schedulePreview").innerHTML =
      "<strong>Sin franjas activas</strong><span>No se capturará movimiento hasta que añadas un horario.</span>";
    return;
  }
  $("#schedulePreview").innerHTML =
    `<strong>${rows.length} ${rows.length === 1 ? "franja activa" : "franjas activas"}</strong><div>${rows
      .map((row) => {
        const slot = {
          day: Number(row.querySelector("select").value),
          start: row.querySelector(".slot-start").value,
          end: row.querySelector(".slot-end").value,
        };
        return `<span>${esc(slotSummary(slot))}</span>`;
      })
      .join(
        "",
      )}</div><small>Fuera de estas horas, Vigía no registrará detecciones.</small>`;
}
function slotRow(slot = { day: 1, start: "08:00", end: "18:00" }) {
  const row = document.createElement("div");
  row.className = "slot-row";
  row.innerHTML = `<div class="slot-number"></div><label><span>Día protegido</span><select class="slot-day">${days.map((d, i) => `<option value="${i}" ${i === slot.day ? "selected" : ""}>${d}</option>`).join("")}</select></label><label><span>Comienza</span><input class="slot-start" type="time" required value="${esc(slot.start)}"></label><span class="slot-arrow">→</span><label><span>Termina</span><input class="slot-end" type="time" required value="${esc(slot.end)}"></label><button type="button" class="remove-slot" aria-label="Quitar franja">×</button>`;
  row.querySelector("button").onclick = () => {
    row.remove();
    markDirty();
    updateSchedulePreview();
  };
  row.addEventListener("input", updateSchedulePreview);
  $("#scheduleRows").append(row);
  [...document.querySelectorAll(".slot-number")].forEach(
    (node, index) => (node.textContent = String(index + 1).padStart(2, "0")),
  );
}
function fillSchedule(config) {
  $("#scheduleEnabled").checked = config.schedule_enabled;
  $("#scheduleRows").replaceChildren();
  (config.weekly_schedule || []).forEach(slotRow);
  updateSchedulePreview();
}

const terminalTime = (value) =>
  timeFormat({
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
function telemetryLine(item) {
  const type =
    item.log_type === "motion_start"
      ? "ALERTA_START"
      : item.log_type === "motion_end"
        ? "ALERTA_END"
        : "HEARTBEAT";
  return `[${terminalTime(item.received_at)}] ${type.padEnd(12)} PIR=${item.raw_pir_high ? "HIGH" : "LOW "} ARMED=${item.sensor_armed ? "YES" : "NO "} MON=${item.monitoring_active ? "ON " : "OFF"} RSSI=${String(item.wifi_rssi ?? "—").padStart(3)}dBm HEAP=${item.free_heap ?? "—"}B EDGES=${item.raw_pir_edges ?? 0} SUPP=${item.suppressed_alerts ?? 0}`;
}
function appendTelemetry(items, reset = false) {
  if (reset) {
    renderedTelemetryIds = new Set();
    $("#liveLogs").textContent = "VIGÍA LIVE CONSOLE · esperando telemetría…\n";
  }
  if (logsPaused) return;
  const unseen = [...items]
    .reverse()
    .filter((item) => !renderedTelemetryIds.has(item.id));
  if (!unseen.length) return;
  const output = unseen.map(telemetryLine).join("\n") + "\n";
  $("#liveLogs").textContent += output;
  unseen.forEach((item) => renderedTelemetryIds.add(item.id));
  const lines = $("#liveLogs").textContent.split("\n");
  if (lines.length > 180)
    $("#liveLogs").textContent = lines.slice(-180).join("\n");
  $("#liveLogs").scrollTop = $("#liveLogs").scrollHeight;
}
function render(data) {
  currentUser = data.user;
  showDashboard();
  $("#welcome").textContent =
    `Hola, ${data.user.name}. Este es el pulso de tu hogar.`;
  const device = data.devices[0];
  if (!device) {
    $("#dashboardError").textContent = "No hay un monitor configurado.";
    return;
  }
  const prior = currentDevice;
  currentDevice = device;
  const c = device.config || {};
  latestTelemetry = data.telemetry || [];
  if (logsDialog.open) appendTelemetry(latestTelemetry);
  if (!dirty && !saving && (!prior || prior.config.updated_at !== c.updated_at))
    fillSchedule(c);
  if (!saving) $("#monitorSwitch").checked = c.monitoring_enabled;
  $("#monitorSwitch").disabled = saving || data.user.role !== "admin";
  $("#deviceName").textContent = device.display_name;
  $("#liveLabel").textContent = device.alive
    ? "Dispositivo conectado"
    : "Dispositivo sin conexión";
  $("#liveDot").className = `status-dot ${device.alive ? "alive" : "offline"}`;
  const applied =
    device.config_synced && device.monitoring_active === device.desired_active;
  $("#configSync").textContent = !device.alive
    ? "Se aplicará cuando el dispositivo vuelva a conectarse"
    : applied
      ? "✓ Configuración aplicada en el ESP32"
      : "Sincronizando con el ESP32…";
  $("#armHint").textContent = c.monitoring_enabled
    ? "Habilitado"
    : "Pausa manual";
  const sensorState = !device.alive
    ? "offline"
    : !applied || !device.desired_active
      ? "paused"
      : device.motion_active
        ? "alarm"
        : device.sensor_ready === false || device.sensor_armed === false
          ? "arming"
          : "calm";
  $(".hero").className = `hero glass hero-${sensorState}`;
  $("#sensorCard").className = `glass sensor-card sensor-${sensorState}`;
  $("#protectionTitle").textContent = !device.alive
    ? "Sensor fuera de línea"
    : !applied
      ? "Actualizando protección"
      : device.motion_active && device.desired_active
        ? "¡Movimiento detectado!"
        : device.desired_active
          ? "Tu hogar, bajo cuidado"
          : "Protección desactivada";
  $("#protectionDescription").textContent = !device.alive
    ? "No hay comunicación reciente. El estado del monitor no se puede confirmar."
    : !applied
      ? "El cambio está guardado. Esperando confirmación del dispositivo."
      : device.motion_active && device.desired_active
        ? "Vigía detectó actividad. Revisa el área monitoreada."
        : !c.monitoring_enabled
          ? "Monitoreo pausado manualmente. Actívalo cuando salgas."
          : !device.desired_active
            ? "Fuera del horario programado. Las alertas están en pausa."
            : "Vigía está atento. Te avisará si detecta movimiento.";
  $("#lastSeen").textContent = device.last_seen
    ? `Última conexión · ${timeFormat({ hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(device.last_seen))}`
    : "Sin conexión registrada";
  $("#motion").textContent = !device.alive
    ? "SIN SENSOR"
    : !applied
      ? "Pendiente"
      : !device.desired_active
        ? "DESACTIVADO"
        : device.motion_active
          ? "¡MOVIMIENTO!"
          : device.sensor_ready === false || device.sensor_armed === false
            ? "ARMANDO"
            : "EN CALMA";
  $("#motion").className =
    device.motion_active && device.desired_active ? "danger" : "";
  $("#sensorHint").textContent =
    sensorState === "offline"
      ? "⚠ No llegan datos del dispositivo"
      : sensorState === "paused"
        ? "⚠ Alertas y registros detenidos"
        : sensorState === "alarm"
          ? "⚠ Actividad confirmada por el PIR"
          : sensorState === "arming"
            ? "Estabilizando lectura del sensor"
            : "● Sensor PIR vigilando activamente";
  const alert = $("#sensorAlert");
  alert.className = `sensor-alert sensor-alert-${sensorState}`;
  if (sensorState === "calm") alert.classList.add("hidden");
  const alertCopy = {
    alarm: [
      "⚠",
      "Movimiento detectado",
      "Hay una alerta activa en el área monitoreada.",
    ],
    paused: [
      "Ⅱ",
      "Monitoreo desactivado",
      "El sensor no generará alertas hasta volver a activarlo o entrar en horario.",
    ],
    offline: [
      "×",
      "No hay sensor activo",
      "El ESP32 dejó de enviar datos. Revisa alimentación, Wi-Fi o conexión.",
    ],
    arming: [
      "…",
      "Sensor preparando vigilancia",
      "Esperando estabilización y una señal PIR en reposo.",
    ],
  }[sensorState];
  if (alertCopy) {
    $("#sensorAlertIcon").textContent = alertCopy[0];
    $("#sensorAlertTitle").textContent = alertCopy[1];
    $("#sensorAlertText").textContent = alertCopy[2];
  }
  $("#rssi").textContent = Number.isFinite(device.wifi_rssi)
    ? `${device.wifi_rssi} dBm`
    : "—";
  $("#wifiQuality").textContent = !device.alive
    ? "Sin señal reciente"
    : device.wifi_rssi > -60
      ? "Señal excelente"
      : device.wifi_rssi > -75
        ? "Señal estable"
        : "Señal débil";
  $("#ip").textContent = `IP local · ${device.local_ip || "—"}`;
  $("#firmware").textContent = `FIRMWARE ${device.firmware_version || "—"}`;
  $("#scheduleSummary").textContent = c.schedule_enabled
    ? "Tu semana, protegida"
    : "Sin restricciones de horario";
  $("#scheduleDetail").textContent = c.schedule_enabled
    ? `${c.weekly_schedule.length} franjas configuradas en hora de Bolivia. ${device.desired_active ? "Dentro del horario activo." : "Protección según tu rutina."}`
    : "Vigía funciona a cualquier hora mientras el interruptor de monitoreo esté activo.";
  const values = [
    ["Sensor", c.sensor_type || "HC-SR501"],
    ["Señal", `GPIO ${c.pir_pin ?? 27}`],
    ["Alcance nominal", `${c.sensor_range_cm || 700} cm`],
    ["Ángulo nominal", `${c.sensor_angle_deg || 120}°`],
    ["Red local", c.ap_ssid || "Vigia-ESP32"],
  ];
  $("#configGrid").innerHTML = values
    .map(
      ([a, b]) => `<div><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`,
    )
    .join("");
  const events = data.events || [],
    starts = events.filter((e) => e.event_type === "motion_start");
  $("#detectionCount").textContent = data.detections_today ?? 0;
  $("#detectionCaption").textContent =
    (data.detections_today ?? 0) === 1
      ? "Detección registrada hoy"
      : "Detecciones registradas hoy";
  $("#detectionCard").classList.toggle(
    "has-detections",
    (data.detections_today ?? 0) > 0,
  );
  const last = starts[0];
  $("#lastDetection").textContent = last
    ? timeFormat({ hour: "2-digit", minute: "2-digit", hour12: false }).format(
        new Date(last.occurred_at),
      )
    : "—";
  $("#lastDetectionDate").textContent = last
    ? timeFormat({ dateStyle: "medium" }).format(new Date(last.occurred_at))
    : "Aún sin detecciones";
  const label = (e) =>
    e.event_type === "motion_start"
      ? "Movimiento detectado"
      : "Movimiento finalizado";
  $("#eventCount").textContent = `${events.length} eventos`;
  $("#eventRows").innerHTML = events
    .map(
      (e) =>
        `<tr><td><span class="event-badge ${e.event_type === "motion_end" ? "end" : ""}">${label(e)}</span></td><td>${esc(boliviaTime(e.occurred_at))}</td><td>${esc(e.device_id)}</td></tr>`,
    )
    .join("");
  $("#emptyEvents").classList.toggle("hidden", events.length > 0);
  $("#recentEvents").innerHTML =
    events
      .slice(0, 3)
      .map(
        (e) =>
          `<div class="recent-item"><strong>${label(e)}</strong><span>${esc(boliviaTime(e.occurred_at))}</span></div>`,
      )
      .join("") ||
    '<p class="muted">Sin movimientos registrados. Todo en calma.</p>';
  const dayKey = (value) =>
      new Date(new Date(value).getTime() - 14400000).toISOString().slice(0, 10),
    today = dayKey(data.server_time),
    counts = Array(24).fill(0);
  starts
    .filter((e) => dayKey(e.occurred_at) === today)
    .forEach(
      (e) =>
        counts[
          new Date(new Date(e.occurred_at).getTime() - 14400000).getUTCHours()
        ]++,
    );
  const max = Math.max(...counts, 1);
  $("#activityChart").replaceChildren();
  counts.forEach((n, h) => {
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(2, (n / max) * 95)}%`;
    bar.title = `${h}:00 · ${n} detecciones`;
    if (n) {
      const span = document.createElement("span");
      span.textContent = n;
      bar.append(span);
    }
    $("#activityChart").append(bar);
  });
  $("#activityChart").setAttribute(
    "aria-label",
    `Detecciones de hoy en la muestra: ${counts.map((n, h) => `${h} horas: ${n}`).join(", ")}`,
  );
  $("#dashboardError").textContent = "";
  $("#terminalConnection").textContent = device.alive
    ? "conectado · streaming"
    : "sin señal";
  $("#terminalFirmware").textContent =
    `firmware ${device.firmware_version || "—"}`;
  $("#terminalRssi").textContent =
    `wifi ${Number.isFinite(device.wifi_rssi) ? `${device.wifi_rssi} dBm` : "—"}`;
  $("#terminalHeap").textContent = `heap ${device.free_heap || "—"} B`;
  $("#terminalPulse").classList.toggle("offline", !device.alive);
}
async function refresh(initial = false) {
  if (refreshing) return;
  refreshing = true;
  const generation = sessionGeneration;
  try {
    const data = await api("/api/dashboard");
    if (generation !== sessionGeneration) return;
    render(data);
    $("#refreshText").textContent =
      `Actualizado ${timeFormat({ hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
    return true;
  } catch (e) {
    if (generation !== sessionGeneration) return;
    if (e.status === 401) showLogin();
    else if (initial)
      showBootError("No pudimos conectar. Reintenta en unos segundos.");
    else $("#dashboardError").textContent = e.message;
    return false;
  } finally {
    refreshing = false;
  }
}
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector("button");
  button.disabled = true;
  $("#loginError").textContent = "";
  const fields = new FormData(form);
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: fields.get("username"),
        password: fields.get("password"),
      }),
    });
    form.reset();
    const ok = await refresh();
    if (ok) startPolling();
    else
      $("#loginError").textContent =
        "Sesión validada, pero el panel no respondió. Vuelve a intentarlo.";
  } catch (e) {
    $("#loginError").textContent = e.message;
  } finally {
    button.disabled = false;
  }
});
$("#logout").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
    currentDevice = null;
    dirty = false;
    accountDialog.close();
    showLogin();
  } catch (e) {
    $("#dashboardError").textContent =
      "No se pudo cerrar la sesión. Reintenta.";
  }
};
$("#retryButton").onclick = () =>
  refresh(true).then((ok) => {
    if (ok) startPolling();
  });
$("#accountButton").onclick = () => {
  $("#accountForm").reset();
  $("#newUsername").value = currentUser?.username || "";
  $("#accountMessage").textContent = "";
  accountDialog.showModal();
};
$("#closeAccount").onclick = () => accountDialog.close();
$("#accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    fields = new FormData(form),
    password = fields.get("new_password");
  if (password !== fields.get("confirm_password")) {
    $("#accountMessage").textContent = "Las contraseñas no coinciden";
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/account", {
      method: "PATCH",
      body: JSON.stringify({
        current_password: fields.get("current_password"),
        new_username: fields.get("new_username"),
        new_password: password,
      }),
    });
    accountDialog.close();
    await refresh();
  } catch (e) {
    $("#accountMessage").textContent = e.message;
  } finally {
    button.disabled = false;
  }
});
$("#scheduleForm").addEventListener("input", () => {
  markDirty();
  $("#scheduleMessage").textContent = "Cambios sin guardar";
  updateSchedulePreview();
});
$("#addSlot").onclick = () => {
  if (document.querySelectorAll(".slot-row").length >= 28) return;
  slotRow();
  markDirty();
  updateSchedulePreview();
};
const schedulePresets = {
  work: [1, 2, 3, 4, 5].map((day) => ({ day, start: "08:00", end: "18:00" })),
  night: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    start: "22:00",
    end: "06:00",
  })),
  weekend: [
    { day: 6, start: "00:00", end: "23:59" },
    { day: 0, start: "00:00", end: "23:59" },
  ],
};
for (const button of document.querySelectorAll("[data-preset]")) {
  button.onclick = () => {
    $("#scheduleEnabled").checked = true;
    $("#scheduleRows").replaceChildren();
    schedulePresets[button.dataset.preset].forEach(slotRow);
    markDirty();
    updateSchedulePreview();
  };
}

$("#openLogs").onclick = () => {
  logsPaused = false;
  $("#pauseLogs").textContent = "Pausar";
  appendTelemetry(latestTelemetry, true);
  logsDialog.showModal();
};
$("#closeLogs").onclick = () => logsDialog.close();
$("#pauseLogs").onclick = () => {
  logsPaused = !logsPaused;
  $("#pauseLogs").textContent = logsPaused ? "Continuar" : "Pausar";
  if (!logsPaused) appendTelemetry(latestTelemetry);
};
$("#clearLogs").onclick = () => appendTelemetry([], true);
logsDialog.addEventListener("click", (event) => {
  if (event.target === logsDialog) logsDialog.close();
});
async function saveConfig(changes) {
  if (saving || !currentDevice) return;
  saving = true;
  $("#monitorSwitch").disabled = true;
  $("#saveSchedule").disabled = true;
  try {
    const { config } = await api("/api/config", {
      method: "PATCH",
      body: JSON.stringify({
        device_id: currentDevice.device_id,
        version: currentDevice.config.updated_at,
        monitoring_enabled: currentDevice.config.monitoring_enabled,
        schedule_enabled: currentDevice.config.schedule_enabled,
        weekly_schedule: currentDevice.config.weekly_schedule,
        ...changes,
      }),
    });
    currentDevice.config = config;
    if (dirty && !Object.hasOwn(changes, "weekly_schedule"))
      draftVersion = config.updated_at;
    $("#configSync").textContent = "Guardado. Esperando al ESP32…";
    return true;
  } catch (e) {
    $("#dashboardError").textContent = e.message;
    $("#scheduleMessage").textContent = e.message;
    return false;
  } finally {
    saving = false;
    $("#monitorSwitch").disabled = false;
    $("#saveSchedule").disabled = false;
  }
}
$("#monitorSwitch").onchange = async (event) => {
  const checked = event.currentTarget.checked;
  if (await saveConfig({ monitoring_enabled: checked })) await refresh();
  else $("#monitorSwitch").checked = currentDevice.config.monitoring_enabled;
};
$("#scheduleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const slots = [...document.querySelectorAll(".slot-row")].map((row) => ({
    day: Number(row.querySelector("select").value),
    start: row.querySelector(".slot-start").value,
    end: row.querySelector(".slot-end").value,
  }));
  if (
    await saveConfig({
      version: draftVersion || currentDevice.config.updated_at,
      schedule_enabled: $("#scheduleEnabled").checked,
      weekly_schedule: slots,
    })
  ) {
    dirty = false;
    draftVersion = null;
    $("#scheduleMessage").textContent =
      "Horarios guardados. Se sincronizarán automáticamente con el monitor.";
    await refresh();
  }
});
refresh(true).then((ok) => {
  if (ok) startPolling();
});
