#pragma once
#include <stdint.h>

struct MotionDetector {
  const uint32_t warmupMs, armingMs, highConfirmMs, lowConfirmMs;
  bool ready = false, enabled = false, armed = false, active = false;
  bool candidate = false, baselineLow = false;
  uint32_t enabledSince = 0, candidateSince = 0, baselineSince = 0;

  MotionDetector(uint32_t warmup = 60000, uint32_t arming = 30000,
                 uint32_t highConfirm = 2000, uint32_t lowConfirm = 3000)
      : warmupMs(warmup), armingMs(arming), highConfirmMs(highConfirm),
        lowConfirmMs(lowConfirm) {}

  // Return 1=boot warmup complete, 2=confirmed motion start,
  // 3=confirmed motion end, 4=armed after a clean LOW baseline.
  int update(uint32_t now, bool monitoringEnabled, bool high) {
    if (!ready) {
      if (now < warmupMs) return 0;
      ready = true;
      return 1;
    }

    if (!monitoringEnabled) {
      const bool wasActive = active;
      enabled = armed = active = baselineLow = false;
      candidate = false;
      return wasActive ? 3 : 0;
    }
    if (!enabled) {
      enabled = true;
      armed = active = baselineLow = false;
      candidate = high;
      candidateSince = enabledSince = now;
    }
    if (!armed) {
      if (uint32_t(now - enabledSince) < armingMs) return 0;
      if (high) { baselineLow = false; return 0; }
      if (!baselineLow) { baselineLow = true; baselineSince = now; return 0; }
      if (uint32_t(now - baselineSince) < lowConfirmMs) return 0;
      armed = true;
      candidate = false;
      candidateSince = now;
      return 4;
    }

    if (high != candidate) { candidate = high; candidateSince = now; }
    const uint32_t required = candidate ? highConfirmMs : lowConfirmMs;
    if (candidate != active && uint32_t(now - candidateSince) >= required) {
      active = candidate;
      return active ? 2 : 3;
    }
    return 0;
  }

  uint32_t armingRemainingMs(uint32_t now) const {
    if (!ready || !enabled || armed) return 0;
    const uint32_t elapsed = uint32_t(now - enabledSince);
    return elapsed >= armingMs ? 0 : armingMs - elapsed;
  }
};

struct AlertGate {
  const uint32_t cooldownMs;
  bool used = false;
  uint32_t lastAccepted = 0;
  explicit AlertGate(uint32_t cooldown = 60000) : cooldownMs(cooldown) {}
  bool allow(uint32_t now) {
    if (used && uint32_t(now - lastAccepted) < cooldownMs) return false;
    used = true;
    lastAccepted = now;
    return true;
  }
};
