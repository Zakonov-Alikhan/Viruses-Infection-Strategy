import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  EMPTY_CELL,
  createGameState
} from "../ui/game.js";
import { getPlayerView, processGameCommand } from "./game-service.js";

function setupState(overrides = {}) {
  return createGameState({
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    randomEvents: false,
    freeStartingPositions: true,
    adminMode: false,
    ...overrides
  }, () => 0.75);
}

function playingState(overrides = {}) {
  return createGameState({
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    randomEvents: false,
    freeStartingPositions: false,
    adminMode: false,
    ...overrides
  }, () => 0.75);
}

test("accepts a start choice from the assigned side and advances setup", () => {
  const state = setupState();
  const result = processGameCommand(state, "X", { type: "choose-start", row: 2, col: 3 });

  assert.equal(result.ok, true);
  assert.equal(result.state.phase, "setup-o");
  assert.deepEqual(result.state.startChoices.X, { row: 2, col: 3 });
  assert.equal(state.startChoices.X, null);
});

test("accepts a legal placement through the game engine", () => {
  const state = playingState();
  const result = processGameCommand(state, "X", { type: "place", row: 0, col: 8 }, { random: () => 1 });

  assert.equal(result.ok, true);
  assert.equal(result.state.board[0][8], "X");
  assert.equal(result.state.currentPlayer, "O");
  assert.equal(state.board[0][8], EMPTY_CELL);
});

test("rejects commands from the wrong side without changing the source state", () => {
  const state = playingState();
  const before = JSON.stringify(state);
  const result = processGameCommand(state, "O", { type: "place", row: 9, col: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not-your-turn");
  assert.equal(result.state, state);
  assert.equal(JSON.stringify(state), before);
});

test("rejects a command in the wrong phase and rejects state-shaped payload fields", () => {
  const state = setupState();
  const wrongPhase = processGameCommand(state, "X", { type: "place", row: 0, col: 0 });
  const injectedState = processGameCommand(state, "X", {
    type: "choose-start",
    row: 0,
    col: 0,
    state: { phase: "playing", winner: "X" }
  });

  assert.equal(wrongPhase.error.code, "wrong-phase");
  assert.equal(wrongPhase.state, state);
  assert.equal(injectedState.error.code, "invalid-command");
  assert.equal(injectedState.state, state);
  assert.equal(state.phase, "setup-x");
});

test("rejects an illegal move without mutating the source state", () => {
  const state = playingState();
  const before = JSON.stringify(state);
  const result = processGameCommand(state, "X", { type: "place", row: 5, col: 5 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid-action");
  assert.equal(result.state, state);
  assert.equal(JSON.stringify(state), before);
});

test("applies a selected bomb through core ability transitions", () => {
  const base = playingState();
  const board = base.board.map((row) => row.slice());
  board[4][4] = "O";
  const state = {
    ...base,
    board,
    inventory: { X: [{ id: "bomb-1", type: "bomb" }], O: [] }
  };
  const selected = processGameCommand(state, "X", { type: "select-ability", itemId: "bomb-1" });
  assert.equal(selected.ok, true);
  assert.equal(selected.state.selectedAbility, "bomb-1");

  const used = processGameCommand(selected.state, "X", {
    type: "ability-target",
    itemId: "bomb-1",
    row: 4,
    col: 4
  });
  assert.equal(used.ok, true);
  assert.equal(used.state.board[4][4], EMPTY_CELL);
  assert.deepEqual(used.state.inventory.X, []);
  assert.deepEqual(state.inventory.X, [{ id: "bomb-1", type: "bomb" }]);
});

test("accepts numeric event-item IDs from the game engine through the server command API", () => {
  const base = playingState();
  const board = base.board.map((row) => row.slice());
  board[4][4] = "O";
  const state = {
    ...base,
    board,
    inventory: { X: [{ id: 17, type: "bomb" }], O: [] }
  };
  const selected = processGameCommand(state, "X", {
    type: "select-ability", itemId: 17
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.state.selectedAbility, 17);
  assert.deepEqual(getPlayerView(selected.state, "X").inventory.X, [{ id: 17, type: "bomb" }]);

  const used = processGameCommand(selected.state, "X", {
    type: "ability-target", itemId: 17, row: 4, col: 4
  });
  assert.equal(used.ok, true);
  assert.equal(used.state.board[4][4], EMPTY_CELL);
  assert.deepEqual(used.state.inventory.X, []);
  assert.deepEqual(state.inventory.X, [{ id: 17, type: "bomb" }]);
});

test("forwards staged shield targets to the core and applies the shield after the final target", () => {
  const base = playingState();
  const state = {
    ...base,
    inventory: { X: [{ id: "shield-1", type: "shield" }], O: [] }
  };
  const selected = processGameCommand(state, "X", {
    type: "select-ability", itemId: "shield-1"
  }).state;
  const first = processGameCommand(selected, "X", {
    type: "ability-target", itemId: "shield-1", row: 1, col: 1
  });
  const second = processGameCommand(first.state, "X", {
    type: "ability-target", itemId: "shield-1", row: 1, col: 2
  });
  const third = processGameCommand(second.state, "X", {
    type: "ability-target", itemId: "shield-1", row: 1, col: 3
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.equal(third.state.protections.length, 3);
  assert.equal(third.state.inventory.X.length, 0);
  assert.equal(state.protections.length, 0);
  assert.equal(state.inventory.X.length, 1);
});

test("rejects ability use by another side or without selecting its owned item", () => {
  const base = playingState();
  const state = { ...base, inventory: { X: [{ id: "bomb-1", type: "bomb" }], O: [] } };
  const wrongSide = processGameCommand(state, "O", { type: "select-ability", itemId: "bomb-1" });
  const notSelected = processGameCommand(state, "X", {
    type: "ability-target", itemId: "bomb-1", row: 4, col: 4
  });

  assert.equal(wrongSide.error.code, "not-your-turn");
  assert.equal(notSelected.error.code, "ability-not-selected");
  assert.equal(state.selectedAbility, null);
});

test("a player can resign out of turn and the opponent wins", () => {
  const state = playingState();
  const result = processGameCommand(state, "O", { type: "resign" });
  const activePlayerResult = processGameCommand(state, "X", { type: "resign" });

  assert.equal(result.ok, true);
  assert.equal(result.state.phase, "finished");
  assert.equal(result.state.winner, "X");
  assert.deepEqual(result.state.finishReason, {
    key: "message.resigned",
    params: { player: "O" }
  });
  assert.equal(activePlayerResult.state.winner, "O");
  assert.equal(state.phase, "playing");
});

test("timeout is server-only, must match the active side, and ends the game", () => {
  const state = playingState();
  const clientAttempt = processGameCommand(state, "X", { type: "timeout" });
  const wrongSide = processGameCommand(state, "O", { type: "timeout" }, { authority: "server" });
  const timeout = processGameCommand(state, "X", { type: "timeout" }, { authority: "server" });

  assert.equal(clientAttempt.error.code, "server-command-only");
  assert.equal(wrongSide.error.code, "not-your-turn");
  assert.equal(timeout.ok, true);
  assert.equal(timeout.state.phase, "finished");
  assert.equal(timeout.state.winner, "O");
  assert.equal(state.phase, "playing");
});

test("player view hides the opponent's pending start choice and is detached", () => {
  const state = setupState();
  const afterXChoice = processGameCommand(state, "X", {
    type: "choose-start", row: 6, col: 7
  }).state;
  const xView = getPlayerView(afterXChoice, "X");
  const oView = getPlayerView(afterXChoice, "O");

  assert.deepEqual(xView.startChoices.X, { row: 6, col: 7 });
  assert.equal(xView.startChoices.O, null);
  assert.deepEqual(oView.startChoices, { X: null, O: null });
  xView.board[0][0] = "tampered";
  xView.startChoices.X.row = 99;
  assert.notEqual(afterXChoice.board[0][0], "tampered");
  assert.equal(afterXChoice.startChoices.X.row, 6);
});

test("player view is allow-listed and strips server-only fields and role metadata", () => {
  const state = {
    ...playingState({ adminMode: true }),
    serverSecret: "do-not-send",
    playerRoles: { X: "admin", O: "player" },
    pendingExtraTurn: "private-marker",
    nextEventItemId: 900,
    message: { key: "test", params: { nested: { private: true } } },
    inventory: { X: [{ id: "item-1", type: "bomb", adminGranted: true }], O: [] }
  };
  const view = getPlayerView(state, "X");

  assert.deepEqual(Object.keys(view).sort(), [
    "abilityTargets", "board", "currentPlayer", "eventItems",
    "finishReason", "inventory", "lastDestroyed", "message", "phase", "piecesLeft",
    "protections", "selectedAbility", "settings", "setupPlayer", "startChoices", "winner"
  ].sort());
  assert.equal("serverSecret" in view, false);
  assert.equal("playerRoles" in view, false);
  assert.equal("pendingExtraTurn" in view, false);
  assert.equal("nextEventItemId" in view, false);
  assert.equal("adminMode" in view.settings, false);
  assert.deepEqual(view.inventory.X, [{ id: "item-1", type: "bomb" }]);
  view.message.params.nested.private = false;
  assert.equal(state.message.params.nested.private, true);
});

test("player view hides an incomplete ability selection from the opponent", () => {
  const base = playingState();
  const state = {
    ...base,
    inventory: { X: [{ id: "shield-1", type: "shield" }], O: [] },
    selectedAbility: "shield-1",
    abilityTargets: [{ row: 1, col: 2 }]
  };
  const opponentView = getPlayerView(state, "O");

  assert.equal(opponentView.selectedAbility, null);
  assert.deepEqual(opponentView.abilityTargets, []);
});

test("player view does not retain setup choices after the initial positions are revealed", () => {
  const setup = setupState();
  const xChoice = processGameCommand(setup, "X", {
    type: "choose-start", row: 2, col: 3
  }).state;
  const playing = processGameCommand(xChoice, "O", {
    type: "choose-start", row: 7, col: 8
  }).state;
  const view = getPlayerView(playing, "X");

  assert.equal(playing.phase, "playing");
  assert.deepEqual(view.startChoices, { X: null, O: null });
  assert.equal(view.setupPlayer, null);
  assert.equal(view.board[2][3], "X");
  assert.equal(view.board[7][8], "O");
});
