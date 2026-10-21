import assert from "node:assert/strict";
import test from "node:test";
import { TurnUndoHistory } from "./turn-undo.js";

function state(side, turnNumber, value = 0) {
  return { phase: "playing", currentPlayer: side, turnNumber, board: [[value]], inventory: { X: [], O: [] } };
}

test("turn undo stores a detached full checkpoint and restores clocks without mutation", () => {
  const original = state("X", 1);
  const history = new TurnUndoHistory();
  history.reset(original, { X: 60, O: 60 });
  const afterTurn = state("O", 2, "piece");
  history.record(original, afterTurn, { X: 45, O: 60 });

  assert.equal(history.canUndo("X", { latestOnly: true }), true);
  const undo = history.undo("X", { latestOnly: true });
  assert.deepEqual(undo.state, original);
  assert.deepEqual(undo.clockRemaining, { X: 60, O: 60 });
  undo.state.board[0][0] = "changed";
  assert.deepEqual(original.board, [[0]]);
});

test("same-side extra turns are grouped into the original completed turn", () => {
  const history = new TurnUndoHistory();
  const firstTurn = state("X", 1);
  history.reset(firstTurn, { X: 60, O: 60 });
  const extraTurn = state("X", 2, "extra");
  history.record(firstTurn, extraTurn, { X: 57, O: 60 }, 2_000);
  const stillExtraTurn = state("X", 2, "placed");
  history.record(extraTurn, stillExtraTurn, { X: 53, O: 60 });
  const opponent = state("O", 3, "placed");
  history.record(stillExtraTurn, opponent, { X: 53, O: 60 });

  const undo = history.undo("X", { latestOnly: true });
  assert.equal(undo.state.board[0][0], 0);
  assert.equal(undo.turnNumber, 1);
  assert.equal(undo.clockIncrementMs, 2_000);
});

test("multiple placements in one turn do not expose an early undo checkpoint", () => {
  const history = new TurnUndoHistory();
  const start = state("X", 1);
  history.reset(start);
  const firstPlacement = state("X", 1, "first");
  history.record(start, firstPlacement);
  assert.equal(history.canUndo("X"), false);
  const secondPlacement = state("O", 2, "second");
  history.record(firstPlacement, secondPlacement);
  assert.equal(history.canUndo("X", { latestOnly: true }), true);
  assert.deepEqual(history.undo("X").state, start);
});

test("local undo can rewind a human turn and the following computer response", () => {
  const history = new TurnUndoHistory({ preserveCompletedTurns: true });
  const xStart = state("X", 1);
  history.reset(xStart, { X: 60, O: 60 });
  const oStart = state("O", 2, "human move");
  history.record(xStart, oStart, { X: 57, O: 60 });
  const xStartAgain = state("X", 3, "computer move");
  history.record(oStart, xStartAgain, { X: 57, O: 58 });

  const undo = history.undo("X");
  assert.equal(undo.state.currentPlayer, "X");
  assert.equal(undo.state.turnNumber, 1);
  assert.equal(undo.state.board[0][0], 0);
});

test("the authoritative latest-turn window invalidates after an opponent action", () => {
  const history = new TurnUndoHistory();
  const xStart = state("X", 1);
  history.reset(xStart, { X: 60, O: 60 });
  const oStart = state("O", 2, "x move");
  history.record(xStart, oStart, { X: 60, O: 60 });
  const oAfterAction = state("O", 2, "opponent ability");
  history.record(oStart, oAfterAction, { X: 60, O: 60 });

  assert.equal(history.canUndo("X", { latestOnly: true }), false);
});

test("finished games clear undo eligibility", () => {
  const history = new TurnUndoHistory();
  const xStart = state("X", 1);
  history.reset(xStart);
  const oStart = state("O", 2, "x move");
  history.record(xStart, oStart);
  history.record(oStart, { ...oStart, phase: "finished", winner: "X" });
  assert.equal(history.canUndo("X"), false);
});
