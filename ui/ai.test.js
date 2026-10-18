import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  EMPTY_CELL,
  BLOCKED_CELL,
  chooseStart,
  canCompleteTurn,
  createGameState,
  finishIfNoLegalMoves,
  getLegalMoves,
  isLegalMove,
  playMove,
  selectAbility
} from "./game.js";
import {
  AI_SEARCH_LIMITS,
  applyComputerAction,
  analyzeComputerAction,
  chooseComputerAction
} from "./ai.js";

function makeState(overrides = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 3,
    randomEvents: false,
    freeStartingPositions: false,
    ...overrides.settings
  };
  const initial = createGameState(settings, () => 0.75);
  return { ...initial, ...overrides.state };
}

function makeBlockedState() {
  const state = makeState();
  const board = state.board.map((row) => Array(row.length).fill(BLOCKED_CELL));
  board[0][0] = "X";
  board[9][9] = "O";
  return { ...state, board, piecesLeft: 1, selectedAbility: null, protections: [] };
}

function applyPlacement(state, action) {
  const prepared = action.abilityId === null
    ? state
    : state.selectedAbility === action.abilityId
      ? state
      : selectAbility(state, action.abilityId);
  return playMove(prepared, action.row, action.col, () => 1);
}

test("all difficulties return legal placements and do not mutate the input state", () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const state = makeState();
    const before = JSON.stringify(state);
    const legal = getLegalMoves(state);
    const action = chooseComputerAction(state, difficulty, { random: () => 0.25 });

    assert.equal(action.type, "place");
    assert.ok(legal.some(({ row, col }) => row === action.row && col === action.col));
    assert.equal(JSON.stringify(state), before);
    const next = applyPlacement(state, action);
    assert.equal(next.board[action.row][action.col], "X");
  }
});

test("reports setup, terminal, and no-placement states explicitly", () => {
  const setup = createGameState({ ...DEFAULT_SETTINGS, randomEvents: false });
  assert.deepEqual(chooseComputerAction(setup, "easy"), {
    type: "no-legal-move",
    reason: "game-not-playing"
  });

  const blocked = makeBlockedState();
  assert.equal(getLegalMoves(blocked).length, 0);
  assert.deepEqual(chooseComputerAction(blocked, "medium"), {
    type: "no-legal-move",
    reason: "no-legal-placement"
  });

  assert.deepEqual(chooseComputerAction({ ...blocked, phase: "finished" }, "hard"), {
    type: "no-legal-move",
    reason: "game-not-playing"
  });
});

test("free placement permits remote cells and respects shield reservations", () => {
  const state = makeState();
  const freeId = "free-placement-test";
  const withFreeItem = {
    ...state,
    inventory: { ...state.inventory, X: [{ id: freeId, type: "freePlacement" }] }
  };
  const selected = selectAbility(withFreeItem, freeId);
  const available = getLegalMoves(selected);
  const remoteIndex = available.findIndex(({ row, col }) => row === 5 && col === 5);
  assert.ok(remoteIndex >= 0);
  assert.equal(isLegalMove(withFreeItem, 5, 5), false);

  const action = chooseComputerAction(selected, "easy", {
    random: () => (remoteIndex + 0.1) / available.length
  });
  assert.deepEqual(action, { type: "place", row: 5, col: 5, abilityId: freeId });
  const afterFreePlacement = applyPlacement(selected, action);
  assert.equal(afterFreePlacement.board[5][5], "X");
  assert.equal(afterFreePlacement.piecesLeft, selected.piecesLeft);

  const protectedState = {
    ...selected,
    protections: [{ row: 5, col: 5, owner: "O", permanent: false }]
  };
  assert.equal(getLegalMoves(protectedState).some(({ row, col }) => row === 5 && col === 5), false);
  const nextAction = chooseComputerAction(protectedState, "easy", { random: () => 0.5 });
  assert.notDeepEqual({ row: nextAction.row, col: nextAction.col }, { row: 5, col: 5 });
});

test("turn capacity excludes empty cells reserved by the opponent", () => {
  const state = makeBlockedState();
  const board = state.board.map((row) => row.slice());
  board[4][4] = "X";
  board[0][0] = BLOCKED_CELL;
  const reserved = {
    ...state,
    board,
    protections: [{ row: 4, col: 5, owner: "O", permanent: true }]
  };
  const oneEmptyCell = reserved.board.map((row) => row.slice());
  oneEmptyCell[4][5] = EMPTY_CELL;
  const onlyReservedRoute = { ...reserved, board: oneEmptyCell };
  assert.equal(canCompleteTurn(onlyReservedRoute, "X", 1), false);
  assert.equal(canCompleteTurn({
    ...onlyReservedRoute,
    protections: [{ row: 4, col: 5, owner: "X", permanent: true }]
  }, "X", 1), true);
});

test("the engine completes the turn and changes the active player", () => {
  const state = makeState({
    settings: { piecesPerTurn: 1 },
    state: { piecesLeft: 1 }
  });
  const action = chooseComputerAction(state, "easy", { random: () => 0 });
  const next = applyPlacement(state, action);
  assert.equal(next.currentPlayer, "O");
  assert.equal(next.piecesLeft, 1);
  assert.equal(state.currentPlayer, "X");
});

test("the computer applies each placement from fresh state until control returns", () => {
  let state = makeState({
    settings: { piecesPerTurn: 3 },
    state: { currentPlayer: "O", piecesLeft: 3 }
  });
  let actionsTaken = 0;
  while (state.phase === "playing" && state.currentPlayer === "O" && actionsTaken < 4) {
    const action = chooseComputerAction(state, "easy", { random: () => 0.5 });
    const next = applyComputerAction(state, action, () => 1);
    assert.notEqual(next, state);
    state = next;
    actionsTaken += 1;
  }
  assert.equal(actionsTaken, 3);
  assert.equal(state.currentPlayer, "X");
  assert.equal(state.piecesLeft, 3);
});

test("a human and computer can play a complete local match through core transitions", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    randomEvents: false,
    freeStartingPositions: true
  };
  let state = createGameState(settings, () => 1);
  state = chooseStart(state, 0, 0, () => 1);
  assert.equal(state.phase, "setup-o");
  state = chooseStart(state, 9, 9, () => 1);
  let actionCount = 0;

  while (state.phase === "playing" && actionCount < 300) {
    if (state.currentPlayer === "X") {
      const move = getLegalMoves(state)[0];
      if (!move) {
        state = finishIfNoLegalMoves(state);
        break;
      }
      state = playMove(state, move.row, move.col, () => 1);
    } else {
      const action = chooseComputerAction(state, "easy", { random: () => 0.5 });
      if (action.type === "no-legal-move") {
        state = finishIfNoLegalMoves(state);
        break;
      }
      state = applyComputerAction(state, action, () => 1);
    }
    actionCount += 1;
  }

  assert.equal(state.phase, "finished");
  assert.ok(["X", "O"].includes(state.winner));
  assert.ok(actionCount < 300);
});

test("a playing state with no legal placements is awarded to the opponent", () => {
  const state = makeBlockedState();
  const finished = finishIfNoLegalMoves(state);
  assert.equal(finished.phase, "finished");
  assert.equal(finished.winner, "O");
  assert.equal(finishIfNoLegalMoves(finished), finished);
});

test("hard search stays under its fixed budget on a 50 by 50 board", () => {
  const state = makeState({
    settings: { width: 50, height: 50, piecesPerTurn: 250 },
    state: {
      inventory: {
        X: [
          { id: "free-1", type: "freePlacement" },
          { id: "free-2", type: "freePlacement" },
          { id: "free-3", type: "freePlacement" }
        ],
        O: []
      }
    }
  });
  const analysis = analyzeComputerAction(state, "hard");
  assert.ok(analysis.legalActionCount > 1000);
  assert.ok(analysis.nodesSearched <= AI_SEARCH_LIMITS.hard.maxNodes);
  assert.equal(analysis.action.type, "place");
  assert.equal(state.board[analysis.action.row][analysis.action.col], EMPTY_CELL);
});

test("non-placement ability selection returns an explicit targeting result", () => {
  const state = makeState({
    state: {
      inventory: { X: [{ id: "bomb-test", type: "bomb" }], O: [] },
      selectedAbility: "bomb-test"
    }
  });
  assert.deepEqual(chooseComputerAction(state, "easy"), {
    type: "no-legal-move",
    reason: "ability-targeting"
  });
});
