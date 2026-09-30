import test from "node:test";
import assert from "node:assert/strict";
import {
  isMonitoringActive,
  validatePolicy,
  devicePolicy,
} from "../lib/monitoring.js";
const config = {
  monitoring_enabled: true,
  schedule_enabled: true,
  weekly_schedule: [{ day: 1, start: "22:00", end: "06:00" }],
};
const at = (iso) => isMonitoringActive(config, new Date(iso));
test("Bolivia: Monday overnight interval uses start day and exclusive end", () => {
  assert.equal(at("2026-09-28T21:59:00-04:00"), false);
  assert.equal(at("2026-09-28T22:00:00-04:00"), true);
  assert.equal(at("2026-09-29T05:59:00-04:00"), true);
  assert.equal(at("2026-09-29T06:00:00-04:00"), false);
  assert.equal(at("2026-09-30T02:00:00-04:00"), false);
});
test("manual pause overrides active schedules; unrestricted mode is always on", () => {
  assert.equal(
    isMonitoringActive(
      { ...config, monitoring_enabled: false },
      new Date("2026-09-29T02:00:00-04:00"),
    ),
    false,
  );
  assert.equal(
    isMonitoringActive({ ...config, schedule_enabled: false }),
    true,
  );
});
test("Sunday overnight wraps to Monday", () => {
  const c = {
    ...config,
    weekly_schedule: [{ day: 0, start: "23:00", end: "02:00" }],
  };
  assert.equal(
    isMonitoringActive(c, new Date("2026-09-28T01:00:00-04:00")),
    true,
  );
  assert.equal(
    isMonitoringActive(c, new Date("2026-09-28T02:00:00-04:00")),
    false,
  );
});
test("reject invalid days, identical bounds, too many slots and empty active schedule", () => {
  for (const weekly_schedule of [
    [],
    [{ day: 7, start: "08:00", end: "09:00" }],
    [{ day: 1, start: "08:00", end: "08:00" }],
    [{ day: 1, start: "24:00", end: "09:00" }],
    Array(29).fill(config.weekly_schedule[0]),
  ])
    assert.throws(() => validatePolicy({ ...config, weekly_schedule }));
  assert.deepEqual(validatePolicy(config), config);
  assert.deepEqual(devicePolicy(config).slots, [[1, 1320, 360]]);
});
test("same-day boundaries and disabled days", () => {
  const c = {
    ...config,
    weekly_schedule: [{ day: 2, start: "08:00", end: "18:00" }],
  };
  assert.equal(
    isMonitoringActive(c, new Date("2026-09-29T08:00:00-04:00")),
    true,
  );
  assert.equal(
    isMonitoringActive(c, new Date("2026-09-29T18:00:00-04:00")),
    false,
  );
  assert.equal(
    isMonitoringActive(c, new Date("2026-09-30T12:00:00-04:00")),
    false,
  );
});
