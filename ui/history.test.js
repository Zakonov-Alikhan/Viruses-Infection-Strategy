import assert from "node:assert/strict";
import test from "node:test";
import { createGameState, DEFAULT_SETTINGS, getLegalMoves, playMove, selectAbility, useBomb } from "./game.js";
import {
  appendHistoryEntry,
  createHistoryEntry,
  createHistoryPosition,
  restoreHistoryPosition
} from "./history.js";

function playingState(overrides = {}) {
  return createGameState({
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 2,
    randomEvents: false,
    freeStartingPositions: false,
    ...overrides
  }, () => 0);
}

test("history stores successive placements in one turn and distinguishes turns from rounds", () => {
  const initial = playingState();
  const [first, second] = getLegalMoves(initial);
  const afterFirst = playMove(initial, first.row, first.col, () => 0);
  const afterSecond = playMove(afterFirst, second.row, second.col, () => 0);
  const entryOne = createHistoryEntry(initial, afterFirst, 1, {
    command: { type: "place", ...first }, side: "X"
  });
  const entryTwo = createHistoryEntry(afterFirst, afterSecond, 2, {
    command: { type: "place", ...second }, side: "X"
  });

  assert.equal(initial.roundNumber, 1);
  assert.equal(initial.turnNumber, 1);
  assert.equal(afterFirst.turnNumber, 1);
  assert.equal(entryOne.turnNumber, 1);
  assert.equal(entryTwo.turnNumber, 1);
  assert.equal(entryOne.roundNumber, 1);
  assert.equal(entryTwo.roundNumber, 1);
  assert.deepEqual(entryOne.coordinates, [first]);
  assert.equal(afterSecond.currentPlayer, "O");
  assert.equal(afterSecond.turnNumber, 2);
  assert.equal(afterSecond.roundNumber, 1);

  const opponentMoves = getLegalMoves(afterSecond);
  const afterOpponentFirst = playMove(afterSecond, opponentMoves[0].row, opponentMoves[0].col, () => 0);
  const opponentSecondMove = getLegalMoves(afterOpponentFirst)[0];
  const completedRound = playMove(afterOpponentFirst, opponentSecondMove.row, opponentSecondMove.col, () => 0);
  const nextTurnEntry = createHistoryEntry(afterOpponentFirst, completedRound, 3, {
    command: { type: "place", ...opponentSecondMove }, side: "O"
  });
  assert.equal(completedRound.currentPlayer, "X");
  assert.equal(completedRound.turnNumber, 3);
  assert.equal(completedRound.roundNumber, 2);
  assert.equal(nextTurnEntry.roundNumber, 1);
  assert.equal(nextTurnEntry.turnNumber, 2);
});

test("an extra turn increments the turn counter without advancing the round", () => {
  let state = playingState({ piecesPerTurn: 1 });
  const target = getLegalMoves(state)[0];
  state = {
    ...state,
    eventItems: [{ id: 1, type: "extraTurn", row: target.row, col: target.col }]
  };
  const afterPickup = playMove(state, target.row, target.col, () => 0);
  assert.equal(afterPickup.currentPlayer, "X");
  assert.equal(afterPickup.roundNumber, 1);
  assert.equal(afterPickup.turnNumber, 2);
  const entry = createHistoryEntry(state, afterPickup, 1, {
    command: { type: "place", ...target }, side: "X"
  });
  assert.equal(entry.roundNumber, 1);
  assert.equal(entry.turnNumber, 1);
});

test("successful ability use records its type and target, while rejected transitions are omitted", () => {
  let state = playingState();
  state = { ...state, inventory: { X: [{ id: 7, type: "bomb" }], O: [] } };
  const selected = selectAbility(state, 7);
  const afterBomb = useBomb(selected, 7, 0, 0);
  const entry = createHistoryEntry(selected, afterBomb, 1, {
    command: { type: "ability-target", itemId: 7, row: 0, col: 0 }, side: "X"
  });

  assert.equal(entry.type, "ability");
  assert.equal(entry.itemType, "bomb");
  assert.deepEqual(entry.coordinates, [{ row: 0, col: 0 }]);
  assert.equal(createHistoryEntry(selected, selected, 2, {
    command: { type: "ability-target", itemId: 7, row: -1, col: -1 }, side: "X"
  }), null);
});

test("restoring a historical position is detached and does not change the live state", () => {
  const state = playingState();
  const move = getLegalMoves(state)[0];
  const next = playMove(state, move.row, move.col, () => 0);
  const liveBoardBefore = state.board.map((row) => [...row]);
  const historical = createHistoryPosition(next);
  const restored = restoreHistoryPosition(historical);

  assert.deepEqual(restored.board, next.board);
  assert.notEqual(restored.board, next.board);
  assert.notEqual(restored.inventory, next.inventory);
  restored.board[0][0] = "tampered";
  assert.deepEqual(state.board, liveBoardBefore);
  assert.notEqual(next.board[0][0], "tampered");
  assert.equal("startChoices" in historical, false);
  assert.deepEqual(restored.startChoices, { X: null, O: null });
});

test("history append ignores duplicate confirmations and retains only the configured window", () => {
  const entries = [{ id: 1 }, { id: 2 }];
  assert.equal(appendHistoryEntry(entries, { id: 2 }), entries);
  assert.deepEqual(appendHistoryEntry(entries, { id: 3 }, 2), [{ id: 2 }, { id: 3 }]);
  assert.equal(appendHistoryEntry(entries, null), entries);
});
