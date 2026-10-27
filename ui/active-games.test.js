import test from "node:test";
import assert from "node:assert/strict";
import { buildActiveRoomView } from "./active-games.js";
import ru from "./locale-ru.js";
import en from "./locale-en.js";

function translator(key, params = {}) {
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), ru[key] ?? key);
}

test("active room view formats server room status, capacity, access, and actual settings", () => {
  const view = buildActiveRoomView({
    id: "catalog-room-id",
    visibility: "public",
    status: "waiting",
    players: 1,
    maxPlayers: 2,
    observers: 3,
    roomCode: "INVITE-SECRET",
    reconnectToken: "TOKEN-SECRET",
    settings: {
      width: 20,
      height: 18,
      piecesPerTurn: 2,
      clockMinutes: 3,
      incrementSeconds: 10,
      unlimitedTime: false,
      randomEvents: true,
      itemSpawnMode: "adaptive",
      disabledItems: ["bomb", "not-a-real-item"],
      wormholesEnabled: false,
      freeStartingPositions: true,
      unlimitedItemLifetime: false,
      itemLifetimeTurns: 8,
      animationsEnabled: false
    }
  }, translator);

  assert.equal(view.roomId, "CATALOG-".slice(0, 8));
  assert.equal(view.status, ru["activeGames.waiting"]);
  assert.equal(view.players, "1/2");
  assert.equal(view.observerCount, 3);
  assert.equal(view.board, "20×18");
  assert.equal(view.modeBoard, `20×18 · ${ru["activeGames.detail.piecesShort"].replace("{count}", "2")}`);
  assert.equal(view.time, "3+10");
  assert.equal(view.visibility, ru["activeGames.public"]);
  assert.equal(view.actionKey, "join");
  assert.deepEqual(view.groups.time.map(({ value }) => value), [ru["activeGames.detail.timeValue"].replace("{minutes}", "3").replace("{seconds}", "10")]);
  assert.ok(view.groups.rules.some(({ labelKey, value }) => labelKey === "activeGames.detail.animations" && value === ru["activeGames.disabled"]));
  assert.ok(view.groups.rules.some(({ labelKey, value }) => labelKey === "activeGames.detail.disabledItems" && value === ru["item.bomb"]));
  assert.ok(view.groups.field.some(({ labelKey, value }) => labelKey === "activeGames.detail.board" && value === "20×18"));
  assert.equal(JSON.stringify(view).includes("INVITE-SECRET"), false);
  assert.equal(JSON.stringify(view).includes("TOKEN-SECRET"), false);
});

test("active room view handles unlimited time and private-room actions without inventing missing settings", () => {
  const view = buildActiveRoomView({
    id: "private-room",
    visibility: "private",
    status: "active",
    players: 2,
    maxPlayers: 2,
    settings: { unlimitedTime: true }
  }, translator);

  assert.equal(view.time, ru["clock.unlimited"]);
  assert.equal(view.actionKey, "manage");
  assert.equal(view.board, ru["activeGames.unknown"]);
  assert.equal(view.observerCount, null);
  assert.equal(view.groups.field.length, 0);
  assert.equal(view.groups.rules.length, 0);
});

test("active room view chooses observe action for an active public match", () => {
  const view = buildActiveRoomView({
    id: "public-match",
    visibility: "public",
    status: "active",
    players: 2,
    maxPlayers: 2,
    settings: {}
  }, translator);
  assert.equal(view.actionKey, "observe");
});

test("active games table and tooltip labels are localized in Russian and English", () => {
  const keys = [
    "activeGames.subtitle", "activeGames.tableLabel", "activeGames.status", "activeGames.modeBoard",
    "activeGames.details", "activeGames.settingsTitle", "activeGames.waiting", "activeGames.inProgress",
    "activeGames.group.field", "activeGames.group.time", "activeGames.group.rules", "activeGames.group.state",
    "activeGames.detail.board", "activeGames.detail.pieces", "activeGames.detail.startingPositions",
    "activeGames.detail.timeControl", "activeGames.detail.randomEvents", "activeGames.detail.spawnMode",
    "activeGames.detail.disabledItems", "activeGames.detail.freePlacement", "activeGames.detail.wormholes",
    "activeGames.detail.itemLifetime", "activeGames.detail.animations", "activeGames.detail.openSeats"
  ];
  for (const key of keys) {
    assert.ok(ru[key], `Missing Russian translation: ${key}`);
    assert.ok(en[key], `Missing English translation: ${key}`);
  }
});
