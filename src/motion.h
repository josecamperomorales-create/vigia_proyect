#pragma once
#include <stdint.h>
struct MotionDetector {
  bool ready = false, active = false, candidate = false;
  uint32_t candidateSince = 0;
  // Return 1=ready, 2=motion/alert started, 3=alert ended.
  int update(uint32_t now, bool high) {
    if (!ready) {
      if (now < 60000) return 0;
      ready = true; candidate = high; candidateSince = now;
      return 1;
    }
    if (high != candidate) { candidate = high; candidateSince = now; }
    if (candidate != active && uint32_t(now - candidateSince) >= 100) {
      active = candidate;
      return active ? 2 : 3;
    }
    return 0;
  }
};
