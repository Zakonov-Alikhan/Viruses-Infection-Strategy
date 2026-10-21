import assert from "node:assert/strict";
import test from "node:test";
import { resolveSettingsRestart } from "./restart.js";

test("cancelled settings confirmation keeps the current game settings unchanged", () => {
  const current = { width: 15, height: 15, disabledItems: ["bomb"] };
  const proposed = { width: 20, height: 12, disabledItems: ["shield"] };
  assert.equal(resolveSettingsRestart(current, proposed, false), current);
  assert.deepEqual(current, { width: 15, height: 15, disabledItems: ["bomb"] });
});

test("confirmed settings restart commits a detached settings snapshot", () => {
  const current = { width: 15, height: 15, disabledItems: ["bomb"] };
  const proposed = { width: 20, height: 12, disabledItems: ["shield"] };
  const next = resolveSettingsRestart(current, proposed, true);
  assert.deepEqual(next, proposed);
  assert.notEqual(next, proposed);
  assert.notEqual(next.disabledItems, proposed.disabledItems);
  assert.equal(current.width, 15);
});
