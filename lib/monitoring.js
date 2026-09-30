export function validatePolicy(body) {
  if (
    typeof body?.monitoring_enabled !== "boolean" ||
    typeof body?.schedule_enabled !== "boolean" ||
    !Array.isArray(body.weekly_schedule) ||
    body.weekly_schedule.length > 28
  )
    throw new Error("Configuración inválida");
  const slots = body.weekly_schedule.map((slot) => {
    if (
      !Number.isInteger(slot.day) ||
      slot.day < 0 ||
      slot.day > 6 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end) ||
      slot.start === slot.end
    )
      throw new Error("Cada franja necesita un día y horas diferentes");
    return { day: slot.day, start: slot.start, end: slot.end };
  });
  if (body.schedule_enabled && !slots.length)
    throw new Error("Añade al menos una franja para activar los horarios");
  return {
    monitoring_enabled: body.monitoring_enabled,
    schedule_enabled: body.schedule_enabled,
    weekly_schedule: slots,
  };
}
const minutes = (value) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function isMonitoringActive(config, date = new Date()) {
  if (!config || !config.monitoring_enabled) return false;
  if (!config.schedule_enabled) return true;
  const local = new Date(date.getTime() - 4 * 3600000);
  const day = local.getUTCDay(),
    minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return (config.weekly_schedule || []).some((s) => {
    const start = minutes(s.start),
      end = minutes(s.end);
    return start < end
      ? day === s.day && minute >= start && minute < end
      : (day === s.day && minute >= start) ||
          (day === (s.day + 1) % 7 && minute < end);
  });
}
export function devicePolicy(config) {
  return {
    enabled: config.monitoring_enabled,
    scheduled: config.schedule_enabled,
    version: config.updated_at,
    slots: (config.weekly_schedule || []).map((s) => [
      s.day,
      minutes(s.start),
      minutes(s.end),
    ]),
  };
}
