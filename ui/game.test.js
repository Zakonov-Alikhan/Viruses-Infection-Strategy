import assert from "node:assert/strict";
import test from "node:test";
import { applyComputerAction, chooseComputerAction } from "./ai.js";
import {
  BLOCKED_CELL,
  cancelAbilitySelection,
  DEFAULT_SETTINGS,
  EVENT_ITEMS,
  canCompleteTurn,
  chooseAbilityTarget,
  createGameState,
  getLegalMoves,
  isLegalMove,
  isItemEnabled,
  isValidDebrisTarget,
  placeEditorObject,
  playMove,
  selectAbility,
  useBomb
} from "./game.js";
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

test("disabled items are omitted from random spawns and cannot be collected or activated", () => {
  const disabledItems = EVENT_ITEMS.filter((type) => type !== "shield");
  const state = makePlayingState({ randomEvents: true, disabledItems });
  assert.equal(state.eventItems.length, 1);
  assert.equal(state.eventItems[0].type, "shield");
  assert.equal(isItemEnabled(state, "bomb"), false);
  assert.equal(isItemEnabled(state, "shield"), true);

  const withDisabledDrop = {
    ...state,
    eventItems: [{ id: 900, type: "bomb", row: 0, col: 1 }],
    inventory: { X: [], O: [] }
  };
  const afterPickup = playMove(withDisabledDrop, 0, 1, () => 1);
  assert.deepEqual(afterPickup.inventory.X, []);
  assert.deepEqual(afterPickup.eventItems, []);

  const owned = { ...state, inventory: { X: [{ id: 901, type: "bomb" }], O: [] } };
  assert.equal(selectAbility(owned, 901), owned);
  const rejected = processGameCommand(owned, "X", { type: "select-ability", itemId: 901 });
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.state, owned);

  const adminState = createGameState({
    ...DEFAULT_SETTINGS, width: 10, height: 10, piecesPerTurn: 1,
    randomEvents: false, freeStartingPositions: false, adminMode: true,
    disabledItems: ["bomb"]
  }, () => 0);
  const adminRejected = processGameCommand(adminState, "X", {
    type: "select-ability", itemId: "admin:bomb"
  });
  assert.equal(adminRejected.ok, false);
  assert.deepEqual(adminRejected.state, adminState);

  const botState = {
    ...owned,
    board: owned.board.map((row) => row.slice()),
    inventory: { X: [{ id: 902, type: "bomb" }], O: [] }
  };
  botState.board[4][4] = "O";
  const botAction = chooseComputerAction(botState, "medium");
  assert.equal(botAction.type, "place");
});

test("random artifact gives only an enabled existing item and never returns itself", () => {
  const enabled = new Set(["bomb", "antiBomb", "randomArtifact"]);
  const state = {
    ...makePlayingState({ disabledItems: EVENT_ITEMS.filter((type) => !enabled.has(type)) }),
    eventItems: [{ id: 71, type: "randomArtifact", row: 0, col: 1 }]
  };
  const before = structuredClone(state);
  const next = playMove(state, 0, 1, () => 0.999);

  assert.deepEqual(next.inventory.X, [{ id: 71, type: "antiBomb", row: 0, col: 1 }]);
  assert.equal(EVENT_ITEMS.includes(next.inventory.X[0].type), true);
  assert.notEqual(next.inventory.X[0].type, "randomArtifact");
  assert.deepEqual(next.message.at(-1), {
    key: "message.collected", params: { player: "X", type: "antiBomb" }
  });
  assert.deepEqual(state, before);
});

test("random artifact spawns only when it has a possible result", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    randomEvents: true,
    freeStartingPositions: false,
    adminMode: true
  };
  const canResolve = createGameState({
    ...settings,
    disabledItems: EVENT_ITEMS.filter((type) => !["bomb", "randomArtifact"].includes(type))
  }, () => 0.999);
  assert.equal(canResolve.eventItems.length, 1);
  assert.equal(canResolve.eventItems[0].type, "randomArtifact");

  const noResult = createGameState({
    ...settings,
    disabledItems: EVENT_ITEMS.filter((type) => type !== "randomArtifact")
  }, () => 0.999);
  assert.deepEqual(noResult.eventItems, []);
  assert.equal(placeEditorObject(noResult, "X", {
    kind: "item", itemType: "randomArtifact", row: 0, col: 1
  }), noResult);
});

test("random artifact respects full-inventory replacement and preserves its unique item id", () => {
  const enabled = new Set(["bomb", "antiBomb", "debris", "shield", "randomArtifact"]);
  const base = makePlayingState({ disabledItems: EVENT_ITEMS.filter((type) => !enabled.has(type)) });
  const state = {
    ...base,
    eventItems: [{ id: 81, type: "randomArtifact", row: 0, col: 1 }],
    inventory: {
      X: [{ id: 11, type: "bomb" }, { id: 12, type: "antiBomb" }, { id: 13, type: "debris" }],
      O: []
    }
  };
  const next = playMove(state, 0, 1, () => 0.999);

  assert.deepEqual(next.inventory.X, [
    { id: 12, type: "antiBomb" },
    { id: 13, type: "debris" },
    { id: 81, type: "shield", row: 0, col: 1 }
  ]);
  assert.equal(next.inventory.X.length, 3);
  assert.equal(state.inventory.X[0].id, 11);
});

test("random artifact resolving to extra turn uses the existing queued-turn transition", () => {
  const enabled = new Set(["extraTurn", "randomArtifact"]);
  const base = makePlayingState({ disabledItems: EVENT_ITEMS.filter((type) => !enabled.has(type)) });
  const state = {
    ...base,
    eventItems: [{ id: 91, type: "randomArtifact", row: 0, col: 1 }]
  };
  const next = playMove(state, 0, 1, () => 0.5);

  assert.equal(next.currentPlayer, "X");
  assert.equal(next.piecesLeft, 1);
  assert.deepEqual(next.pendingExtraTurns.X, []);
  assert.deepEqual(next.inventory.X, []);
  assert.equal(state.currentPlayer, "X");
  assert.deepEqual(state.eventItems, [{ id: 91, type: "randomArtifact", row: 0, col: 1 }]);
});

test("random artifact is a collectible object, not an activatable ability", () => {
  const state = makePlayingState({ adminMode: true });
  const selected = selectAbility(state, "admin:randomArtifact");
  assert.equal(selected, state);
  assert.equal(selectAbility({
    ...state,
    inventory: { X: [{ id: 92, type: "randomArtifact" }], O: [] }
  }, 92).selectedAbility, null);
});

test("disabling every item prevents event drops without disrupting normal play", () => {
  const state = makePlayingState({ randomEvents: true, disabledItems: [...EVENT_ITEMS] });
  assert.deepEqual(state.eventItems, []);
  const next = playMove(state, 0, 1, () => 0);
  assert.equal(next.board[0][1], "X");
  assert.deepEqual(next.inventory.X, []);
});

test("debris rejects both players' occupied cells in core, local admin, and server command paths", () => {
  const base = makePlayingState();
  const board = base.board.map((row) => row.slice());
  board[0][1] = "X";
  board[9][8] = "O";
  const state = {
    ...base,
    board,
    inventory: { X: [{ id: "debris-1", type: "debris" }], O: [] },
    selectedAbility: "debris-1",
    abilityTargets: []
  };
  const before = JSON.stringify(state);

  for (const target of [{ row: 0, col: 1 }, { row: 9, col: 8 }]) {
    assert.equal(isValidDebrisTarget(state, target.row, target.col), false);
    assert.equal(chooseAbilityTarget(state, "debris-1", target.row, target.col), state);
    const rejected = processGameCommand(state, "X", {
      type: "ability-target", itemId: "debris-1", ...target
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.state, state);
  }
  assert.equal(JSON.stringify(state), before);

  const adminState = createGameState({
    ...DEFAULT_SETTINGS,
    width: 10,
    height: 10,
    piecesPerTurn: 1,
    randomEvents: false,
    freeStartingPositions: false,
    adminMode: true
  }, () => 0);
  const adminSelected = selectAbility(adminState, "admin:debris");
  const adminBoard = adminSelected.board.map((row) => row.slice());
  adminBoard[0][1] = "X";
  assert.equal(isValidDebrisTarget({ ...adminSelected, board: adminBoard }, 0, 1), false);

  let validDebrisState = {
    ...base,
    inventory: { X: [{ id: "debris-valid", type: "debris" }], O: [] },
    selectedAbility: "debris-valid",
    abilityTargets: []
  };
  for (const target of [{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 1 }]) {
    validDebrisState = chooseAbilityTarget(validDebrisState, "debris-valid", target.row, target.col);
  }
  assert.deepEqual([validDebrisState.board[0][1], validDebrisState.board[1][1], validDebrisState.board[2][1]], [
    BLOCKED_CELL, BLOCKED_CELL, BLOCKED_CELL
  ]);
});

test("a shield on an empty cell does not reserve it and still protects the piece placed there", () => {
  const base = makePlayingState({ piecesPerTurn: 1 });
  const state = {
    ...base,
    protections: [{ row: 0, col: 1, owner: "O", permanent: true }]
  };
  assert.equal(isLegalMove(state, 0, 1), true);
  assert.ok(getLegalMoves(state).some(({ row, col }) => row === 0 && col === 1));
  assert.equal(canCompleteTurn(state, "X", 1), true);

  const occupied = playMove(state, 0, 1, () => 1);
  assert.equal(occupied.board[0][1], "X");
  assert.equal(occupied.protections.length, 1);

  const contactBoard = occupied.board.map((row) => row.slice());
  contactBoard[1][2] = "O";
  const contactState = {
    ...occupied,
    board: contactBoard,
    currentPlayer: "O",
    piecesLeft: 1
  };
  const adjacentAttack = playMove(contactState, 0, 2, () => 1);
  assert.equal(adjacentAttack.board[0][1], "X");
  assert.ok(adjacentAttack.protections.some(({ row, col }) => row === 0 && col === 1));
});

test("free placement consumes one regular piece and queued extra turns remain independent", () => {
  const base = makePlayingState({ piecesPerTurn: 2 });
  const extraTurnId = "extra-turn-1";
  const state = {
    ...base,
    inventory: {
      X: [
        { id: "teleport-1", type: "freePlacement" },
        { id: extraTurnId, type: "extraTurn" }
      ],
      O: []
    },
    pendingExtraTurns: { X: [extraTurnId], O: [] },
    pendingExtraTurn: extraTurnId
  };

  const localSelected = selectAbility(state, "teleport-1");
  const localNext = playMove(localSelected, 5, 5, () => 1);
  const computerNext = applyComputerAction(state, {
    type: "place", abilityId: "teleport-1", row: 5, col: 5
  }, () => 1);
  const serverSelected = processGameCommand(state, "X", {
    type: "select-ability", itemId: "teleport-1"
  });
  const serverNext = processGameCommand(serverSelected.state, "X", {
    type: "place", row: 5, col: 5
  }, { random: () => 1 });

  assert.equal(serverNext.ok, true);
  assert.deepEqual(computerNext, localNext);
  assert.deepEqual(serverNext.state, localNext);
  assert.equal(localNext.currentPlayer, "X");
  assert.equal(localNext.piecesLeft, 1);
  assert.deepEqual(localNext.pendingExtraTurns.X, [extraTurnId]);
  assert.equal(state.currentPlayer, "X");
  assert.deepEqual(state.pendingExtraTurns.X, [extraTurnId]);

  const normalPiece = playMove(localNext, 0, 1, () => 1);
  assert.equal(normalPiece.currentPlayer, "X");
  assert.equal(normalPiece.piecesLeft, 2);
  assert.deepEqual(normalPiece.pendingExtraTurns.X, []);
  const extraTurnPiece = playMove(normalPiece, 0, 2, () => 1);
  assert.equal(extraTurnPiece.currentPlayer, "X");
  assert.equal(extraTurnPiece.piecesLeft, 1);
  const completedExtraTurn = playMove(extraTurnPiece, 0, 3, () => 1);
  assert.equal(completedExtraTurn.currentPlayer, "O");
});

test("admin-selected attack items stay selected and can be used repeatedly without mutating old state", () => {
  const base = makePlayingState({ adminMode: true });
  const selected = selectAbility(base, "admin:bomb");
  const firstUse = useBomb(selected, "admin:bomb", 2, 2);
  assert.equal(firstUse.selectedAbility, "admin:bomb");
  assert.deepEqual(firstUse.inventory, selected.inventory);
  assert.equal(selected.board[2][2], "");
  assert.equal(firstUse.board[2][2], "");

  const secondUse = useBomb(firstUse, "admin:bomb", 4, 4);
  assert.equal(secondUse.selectedAbility, "admin:bomb");
  assert.equal(secondUse.board[4][4], "");
  assert.equal(selected.board[4][4], "");
});

test("board editor adds canonical event items and dead cells without changing unrelated game data", () => {
  const state = makePlayingState({ adminMode: true });
  const itemState = placeEditorObject(state, "X", { kind: "item", itemType: "bomb", row: 0, col: 1 });
  assert.notEqual(itemState, state);
  assert.deepEqual(itemState.eventItems, [{ id: state.nextEventItemId, type: "bomb", row: 0, col: 1 }]);
  assert.equal(itemState.nextEventItemId, state.nextEventItemId + 1);
  assert.equal(itemState.currentPlayer, state.currentPlayer);
  assert.equal(itemState.piecesLeft, state.piecesLeft);
  assert.deepEqual(state.eventItems, []);

  const blockedState = placeEditorObject(state, "X", { kind: "blocked", row: 0, col: 1 });
  assert.equal(blockedState.board[0][1], BLOCKED_CELL);
  assert.equal(blockedState.board[0][0], state.board[0][0]);
  assert.deepEqual(blockedState.eventItems, state.eventItems);
  assert.equal(blockedState.currentPlayer, state.currentPlayer);
  assert.equal(blockedState.piecesLeft, state.piecesLeft);
});

test("board editor rejects unauthorized, overlapping, disabled, excessive, and turn-breaking placements atomically", () => {
  const admin = makePlayingState({ adminMode: true, disabledItems: ["bomb"] });
  const nonAdmin = makePlayingState();
  const overlapState = { ...admin, eventItems: [{ id: 3, type: "shield", row: 0, col: 1 }] };
  const fullItemState = { ...admin, eventItems: [1, 2, 3].map((id, index) => ({
    id, type: "shield", row: index + 1, col: 1
  })) };
  for (const [source, result] of [
    [nonAdmin, placeEditorObject(nonAdmin, "X", { kind: "item", itemType: "bomb", row: 0, col: 1 })],
    [admin, placeEditorObject(admin, "X", { kind: "item", itemType: "bomb", row: 0, col: 1 })],
    [admin, placeEditorObject(admin, "X", { kind: "item", itemType: "unknown", row: 0, col: 1 })],
    [admin, placeEditorObject(admin, "X", { kind: "blocked", row: 0, col: 0 })],
    [overlapState, placeEditorObject(overlapState, "X", { kind: "blocked", row: 0, col: 1 })],
    [fullItemState, placeEditorObject(fullItemState, "X", { kind: "item", itemType: "shield", row: 0, col: 1 })]
  ]) assert.equal(result, source);

  const sparseBoard = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  sparseBoard[0][0] = "X";
  sparseBoard[9][9] = "O";
  sparseBoard[0][1] = "";
  const constrained = { ...admin, board: sparseBoard, currentPlayer: "X", piecesLeft: 1 };
  const original = structuredClone(constrained);
  assert.equal(placeEditorObject(constrained, "X", { kind: "blocked", row: 0, col: 1 }), constrained);
  assert.deepEqual(constrained, original);
});

test("admin can cancel a pending ability selection before entering board edit mode", () => {
  const state = makePlayingState({ adminMode: true });
  const selected = selectAbility(state, "admin:bomb");
  const cancelled = cancelAbilitySelection(selected, "X");
  assert.equal(cancelled.selectedAbility, null);
  assert.deepEqual(cancelled.abilityTargets, []);
  assert.equal(state.selectedAbility, null);
  assert.equal(cancelAbilitySelection(selected, "O"), selected);
});
