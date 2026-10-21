function isValidClockMinutes(value) {
  return Number.isInteger(value) && value >= 1 && value <= 60;
}

function isValidIncrementSeconds(value) {
  return Number.isInteger(value) && value >= 0 && value <= 60;
}

/** Resolve disabled clock inputs safely while retaining validation for timed games. */
export function resolveClockSettings({ unlimitedTime, clockMinutes, incrementSeconds }, fallback) {
  const minutes = clockMinutes === "" ? Number.NaN : Number(clockMinutes);
  const increment = incrementSeconds === "" ? Number.NaN : Number(incrementSeconds);
  if (unlimitedTime) {
    return {
      clockMinutes: isValidClockMinutes(minutes) ? minutes : fallback.clockMinutes,
      incrementSeconds: isValidIncrementSeconds(increment) ? increment : fallback.incrementSeconds
    };
  }
  if (!isValidClockMinutes(minutes) || !isValidIncrementSeconds(increment)) return null;
  return { clockMinutes: minutes, incrementSeconds: increment };
}
