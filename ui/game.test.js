import assert from "node:assert/strict";
import test from "node:test";
import { applyComputerAction, chooseComputerAction } from "./ai.js";
import { DEFAULT_SETTINGS, createGameState, playMove } from "./game.js";
import { processGameCommand } from "../server/game-service.js";

function makePlayingState(overrides = {}) {
  return createGameState({
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    randomEvents: false,
    freeStartingPositions: false,
    ...overrides
  }, () => 0);
}

test("stacked extra-turn items are consumed in order before control passes to the opponent", () => {
  let state = createGameState({
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 2,
    randomEvents: false,
    freeStartingPositions: false
  }, () => 0);
  state = {
    ...state,
    eventItems: [
      { id: 51, type: "extraTurn", row: 0, col: 1 },
      { id: 52, type: "extraTurn", row: 1, col: 1 }
    ]
  };

  const originalState = state;
  state = playMove(state, 0, 1, () => 1);
  assert.deepEqual(state.pendingExtraTurns.X, [51]);
  state = playMove(state, 1, 1, () => 1);
  assert.equal(state.currentPlayer, "X");
  assert.equal(state.piecesLeft, 2);
  assert.deepEqual(state.pendingExtraTurns.X, [52]);
  assert.deepEqual(state.inventory.X.map(({ id }) => id), [52]);

  state = playMove(state, 0, 2, () => 1);
  state = playMove(state, 0, 3, () => 1);
  assert.equal(state.currentPlayer, "X");
  assert.equal(state.piecesLeft, 2);
  assert.deepEqual(state.pendingExtraTurns.X, []);
  assert.deepEqual(state.inventory.X, []);

  state = playMove(state, 0, 4, () => 1);
  state = playMove(state, 0, 5, () => 1);
  assert.equal(state.currentPlayer, "O");
  assert.equal(state.piecesLeft, 2);
  assert.deepEqual(state.pendingExtraTurns.X, []);
  assert.equal(originalState.currentPlayer, "X");
  assert.deepEqual(originalState.pendingExtraTurns.X, []);
});

test("local, computer, and server command paths apply the same legal placement transition", () => {
  const state = makePlayingState();
  const action = chooseComputerAction(state, "easy", { random: () => 0 });
  assert.equal(action.type, "place");

  const localNext = playMove(state, action.row, action.col, () => 1);
  const computerNext = applyComputerAction(state, action, () => 1);
  const serverResult = processGameCommand(state, "X", {
    type: "place",
    row: action.row,
    col: action.col
  }, { random: () => 1 });

  assert.equal(serverResult.ok, true);
  assert.deepEqual(computerNext, localNext);
  assert.deepEqual(serverResult.state, localNext);
  assert.equal(state.board[action.row][action.col], "");
  assert.equal(state.currentPlayer, "X");
});
