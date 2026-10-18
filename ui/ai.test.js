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

function makeAttackState({ items, piecesLeft = 1, piecesPerTurn = 1, pieces, protections = [], eventItems = [] }) {
  const state = makeState({ settings: { piecesPerTurn } });
  const board = Array.from({ length: 10 }, () => Array(10).fill(EMPTY_CELL));
  for (const { row, col, player } of pieces) board[row][col] = player;
  return {
    ...state,
    board,
    phase: "playing",
    currentPlayer: "X",
    piecesLeft,
    inventory: { X: items, O: [] },
    eventItems,
    selectedAbility: null,
    abilityTargets: [],
    protections,
    lastDestroyed: []
  };
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
    reason: "no-legal-action"
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

test("non-attacking selected ability returns an explicit targeting result", () => {
  const state = makeState({
    state: {
      inventory: { X: [{ id: "debris-test", type: "debris" }], O: [] },
      selectedAbility: "debris-test"
    }
  });
  assert.deepEqual(chooseComputerAction(state, "easy"), {
    type: "no-legal-move",
    reason: "ability-targeting"
  });
});

test("medium uses a bomb when it removes several enemy figures and consumes it correctly", () => {
  const bomb = { id: "bomb-1", type: "bomb" };
  const state = makeAttackState({
    items: [bomb],
    pieces: [
      { row: 0, col: 0, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 4, col: 5, player: "O" }
    ]
  });
  const before = JSON.stringify(state);
  const action = chooseComputerAction(state, "medium");

  assert.equal(action.type, "attack");
  assert.equal(action.abilityId, bomb.id);
  const next = applyComputerAction(state, action, () => 1);
  assert.notEqual(next, state);
  assert.equal(JSON.stringify(state), before);
  assert.equal(next.inventory.X.some((item) => item.id === bomb.id), false);
  assert.equal(next.piecesLeft, state.piecesLeft);
  assert.equal(next.board[4][4], EMPTY_CELL);
  assert.equal(next.board[4][5], EMPTY_CELL);
});

test("medium preserves a low-count point target with strategic shield value among many alternatives", () => {
  const pointDestroy = { id: "point-1", type: "pointDestroy" };
  const pieces = [{ row: 0, col: 0, player: "X" }];
  for (let row = 1; row < 10; row += 2) {
    for (let col = 1; col < 10; col += 2) pieces.push({ row, col, player: "O" });
  }
  const protectedTarget = { row: 9, col: 9 };
  const state = makeAttackState({
    items: [pointDestroy],
    pieces,
    protections: [{ ...protectedTarget, owner: "O", permanent: true }]
  });

  const action = chooseComputerAction(state, "medium");
  assert.deepEqual(action, {
    type: "attack",
    abilityId: pointDestroy.id,
    ...protectedTarget
  });
});

test("easy uses an anti-bomb for an obvious multi-figure hit", () => {
  const antiBomb = { id: "anti-1", type: "antiBomb" };
  const state = makeAttackState({
    items: [antiBomb],
    pieces: [
      { row: 0, col: 0, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 4, col: 5, player: "O" }
    ]
  });
  const action = chooseComputerAction(state, "easy", { random: () => 0 });
  assert.equal(action.type, "attack");
  assert.equal(action.abilityId, antiBomb.id);

  const next = applyComputerAction(state, action);
  assert.equal(next.board[action.row][action.col], BLOCKED_CELL);
  assert.equal(next.inventory.X.length, 0);
  assert.equal(next.piecesLeft, state.piecesLeft);
});

test("medium keeps a bomb when its area would destroy more of its own figures", () => {
  const state = makeAttackState({
    items: [{ id: "bomb-1", type: "bomb" }],
    pieces: [
      { row: 0, col: 0, player: "X" },
      { row: 3, col: 4, player: "X" },
      { row: 3, col: 5, player: "X" },
      { row: 4, col: 3, player: "X" },
      { row: 4, col: 5, player: "X" },
      { row: 5, col: 3, player: "X" },
      { row: 5, col: 4, player: "X" },
      { row: 5, col: 5, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 8, col: 8, player: "X" },
      { row: 8, col: 9, player: "X" },
      { row: 9, col: 8, player: "X" },
      { row: 9, col: 9, player: "O" }
    ]
  });
  const action = chooseComputerAction(state, "medium");

  assert.equal(action.type, "place");
  assert.equal(state.inventory.X.length, 1);
});

test("attacks ignore shields and remove their protection from affected cells", () => {
  const pointDestroy = { id: "point-1", type: "pointDestroy" };
  const state = makeAttackState({
    items: [pointDestroy],
    pieces: [
      { row: 0, col: 0, player: "X" },
      { row: 4, col: 4, player: "O" }
    ],
    protections: [{ row: 4, col: 4, owner: "O", permanent: true }]
  });
  const action = chooseComputerAction(state, "easy", { random: () => 0 });
  assert.deepEqual(action, { type: "attack", abilityId: pointDestroy.id, row: 4, col: 4 });

  const next = applyComputerAction(state, action);
  assert.equal(next.board[4][4], EMPTY_CELL);
  assert.equal(next.protections.length, 0);
  assert.equal(next.inventory.X.length, 0);
  assert.equal(next.piecesLeft, state.piecesLeft);
});

test("a visually attractive shielded target does not justify an area attack that loses own pieces", () => {
  const antiBomb = { id: "anti-1", type: "antiBomb" };
  const state = makeAttackState({
    items: [antiBomb],
    pieces: [
      { row: 0, col: 0, player: "X" },
      { row: 3, col: 4, player: "X" },
      { row: 3, col: 5, player: "X" },
      { row: 4, col: 3, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 4, col: 5, player: "X" },
      { row: 5, col: 3, player: "X" },
      { row: 5, col: 4, player: "X" },
      { row: 5, col: 5, player: "X" }
    ],
    protections: [{ row: 4, col: 4, owner: "O", permanent: true }],
    eventItems: [{ id: 8, type: "shield", row: 3, col: 3 }]
  });
  const action = chooseComputerAction(state, "medium");
  assert.equal(action.type, "place");

  const forcedAttack = applyComputerAction(state, {
    type: "attack", abilityId: antiBomb.id, row: 3, col: 3
  });
  assert.equal(forcedAttack.board[4][4], BLOCKED_CELL);
  assert.equal(forcedAttack.board[3][3], BLOCKED_CELL);
  assert.equal(forcedAttack.eventItems.some((item) => item.id === 8), false);
  assert.equal(forcedAttack.protections.length, 0);
  assert.equal(forcedAttack.inventory.X.length, 0);
  assert.equal(forcedAttack.piecesLeft, state.piecesLeft);
});

test("anti-bomb ranking avoids sealing the computer's only legal placement", () => {
  const antiBomb = { id: "anti-1", type: "antiBomb" };
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[3][3] = "X";
  board[3][4] = EMPTY_CELL;
  board[4][4] = "O";
  const state = {
    ...makeAttackState({ items: [antiBomb], pieces: [] }),
    board,
    piecesLeft: 1,
    settings: { ...DEFAULT_SETTINGS, width: 10, height: 10, piecesPerTurn: 1 }
  };

  assert.deepEqual(getLegalMoves(state), [{ row: 3, col: 4 }]);
  const action = chooseComputerAction(state, "medium");
  assert.deepEqual(action, { type: "place", row: 3, col: 4, abilityId: null });
});

test("medium accounts for the full first-layer chain reaction when comparing with a bomb", () => {
  const state = makeAttackState({
    items: [{ id: "bomb-1", type: "bomb" }],
    pieces: [
      { row: 2, col: 2, player: "X" },
      { row: 2, col: 4, player: "O" },
      { row: 1, col: 4, player: "O" },
      { row: 3, col: 4, player: "O" }
    ]
  });
  const action = chooseComputerAction(state, "medium");

  assert.equal(action.type, "place");
  const next = applyComputerAction(state, action);
  assert.equal(next.winner, "X");
  assert.equal(next.lastDestroyed.length, 3);
  assert.equal(next.board[2][4], BLOCKED_CELL);
  assert.equal(next.board[1][4], BLOCKED_CELL);
  assert.equal(next.board[3][4], BLOCKED_CELL);
  assert.equal(next.inventory.X.length, 1);
});

test("without a direct-damage target, the bot chooses a legal placement or reports no action", () => {
  const noEnemy = makeAttackState({
    items: [{ id: "bomb-1", type: "bomb" }],
    pieces: [{ row: 0, col: 0, player: "X" }]
  });
  const action = chooseComputerAction(noEnemy, "hard");
  assert.equal(action.type, "place");
  assert.ok(getLegalMoves(noEnemy).some(({ row, col }) => row === action.row && col === action.col));

  const blocked = {
    ...noEnemy,
    board: noEnemy.board.map((row) => row.map(() => BLOCKED_CELL))
  };
  blocked.board[0][0] = "X";
  assert.deepEqual(chooseComputerAction(blocked, "medium"), {
    type: "no-legal-move",
    reason: "no-legal-action"
  });
});

test("hard includes attack candidates without exceeding its existing node budget", () => {
  const state = makeAttackState({
    items: [
      { id: "bomb-1", type: "bomb" },
      { id: "point-1", type: "pointDestroy" },
      { id: "anti-1", type: "antiBomb" }
    ],
    pieces: [
      { row: 0, col: 0, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 6, col: 6, player: "O" }
    ]
  });
  const before = JSON.stringify(state);
  const result = analyzeComputerAction(state, "hard");

  assert.ok(result.nodesSearched <= AI_SEARCH_LIMITS.hard.maxNodes);
  assert.ok(["place", "attack"].includes(result.action.type));
  assert.equal(JSON.stringify(state), before);
});

test("attack target generation remains bounded on a densely occupied 50 by 50 board", () => {
  const base = makeState({
    settings: { width: 50, height: 50, piecesPerTurn: 1 }
  });
  const board = Array.from({ length: 50 }, () => Array(50).fill("O"));
  board[0][0] = "X";
  const state = {
    ...base,
    board,
    phase: "playing",
    currentPlayer: "X",
    piecesLeft: 1,
    inventory: {
      X: [
        { id: "bomb-1", type: "bomb" },
        { id: "anti-1", type: "antiBomb" },
        { id: "point-1", type: "pointDestroy" }
      ],
      O: []
    },
    eventItems: [],
    selectedAbility: null,
    protections: []
  };

  const result = analyzeComputerAction(state, "hard");
  const mediumResult = analyzeComputerAction(state, "medium");
  assert.ok(result.legalActionCount <= 3 * 12);
  assert.ok(result.nodesSearched <= AI_SEARCH_LIMITS.hard.maxNodes);
  assert.ok(mediumResult.nodesSearched <= AI_SEARCH_LIMITS.medium.maxEvaluations);
});
