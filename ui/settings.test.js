import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "./game.js";
import enLocale from "./locale-en.js";
import ruLocale from "./locale-ru.js";
import { resolveClockSettings } from "./settings.js";

test("item spawn modes have player-facing names and descriptions in both locales", () => {
  const modes = ["standard", "cascade", "adaptive", "hybrid"];
  for (const locale of [ruLocale, enLocale]) {
    for (const mode of modes) {
      assert.ok(locale[`settings.spawnMode.${mode}`]);
      assert.ok(locale[`settings.spawnMode.${mode}.help`]);
    }
  }
});

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
