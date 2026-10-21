import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "./game.js";
import { resolveClockSettings } from "./settings.js";

test("unlimited-time settings accept blank clock inputs and resolve finite safe defaults", () => {
  assert.deepEqual(resolveClockSettings({
    unlimitedTime: true,
    clockMinutes: "",
    incrementSeconds: ""
  }, DEFAULT_SETTINGS), {
    clockMinutes: DEFAULT_SETTINGS.clockMinutes,
    incrementSeconds: DEFAULT_SETTINGS.incrementSeconds
  });
});

test("timed games still reject missing clock values and unlimited games preserve valid values", () => {
  assert.equal(resolveClockSettings({
    unlimitedTime: false,
    clockMinutes: "",
    incrementSeconds: ""
  }, DEFAULT_SETTINGS), null);
  assert.deepEqual(resolveClockSettings({
    unlimitedTime: true,
    clockMinutes: "8",
    incrementSeconds: "3"
  }, DEFAULT_SETTINGS), { clockMinutes: 8, incrementSeconds: 3 });
});
