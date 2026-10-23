import assert from "node:assert/strict";
import test from "node:test";
import { applyComputerAction, chooseComputerAction } from "./ai.js";
import {
  BLOCKED_CELL,
  cancelAbilitySelection,
  DEFAULT_SETTINGS,
  EVENT_ITEMS,
  EMPTY_CELL,
  getItemSpawnProbability,
  getItemSpawnTarget,
  canCompleteTurn,
  canContinueAfterPlacement,
  chooseAbilityTarget,
  createGameState,
  getLegalMoves,
  isLegalMove,
  isItemEnabled,
  isValidDebrisTarget,
  isValidShieldTarget,
  placeEditorObject,
  playMove,
  selectAbility,
  useBomb,
  usePointDestroy
} from "./game.js";
import { getPlayerView, processGameCommand } from "../server/game-service.js";

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

test("defeat check accepts normal moves and the four explicitly rescuing inventory exceptions", () => {
  const base = makePlayingState();
  assert.equal(canContinueAfterPlacement(base), true);
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[0][0] = "X";
  board[9][9] = "O";
  const stranded = { ...base, board, currentPlayer: "X", piecesLeft: 1, selectedAbility: null };
  assert.equal(canContinueAfterPlacement(stranded), false);
  for (const type of ["bomb", "pointDestroy"]) {
    const state = { ...stranded, inventory: { X: [{ id: type, type }], O: [] } };
    assert.equal(canContinueAfterPlacement(state), true, `${type} should prevent defeat`);
  }
  const oneEmpty = board.map((row) => row.slice());
  oneEmpty[5][5] = EMPTY_CELL;
  const freeState = { ...stranded, board: oneEmpty, inventory: { X: [{ id: "free", type: "freePlacement" }], O: [] } };
  assert.equal(canContinueAfterPlacement(freeState), true);
  assert.equal(canContinueAfterPlacement({ ...stranded, inventory: { X: [{ id: "free", type: "freePlacement" }], O: [] } }), false);
});

test("exchange only rescues a stranded player when opponent holds an exception item", () => {
  const base = makePlayingState();
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[0][0] = "X";
  board[9][9] = "O";
  const state = { ...base, board, currentPlayer: "X", piecesLeft: 1,
    inventory: { X: [{ id: "exchange", type: "exchange" }], O: [{ id: "opponent-bomb", type: "bomb" }] } };
  assert.equal(canContinueAfterPlacement(state), true);
  assert.equal(canContinueAfterPlacement({ ...state, inventory: { ...state.inventory, O: [{ id: "ordinary", type: "shield" }] } }), false);
});

test("collecting exchange after placement is applied before checking whether the player is stranded", () => {
  const base = makePlayingState({ piecesPerTurn: 2 });
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[4][4] = "X";
  board[4][5] = EMPTY_CELL;
  board[9][9] = "O";
  const state = { ...base, board, piecesLeft: 2,
    inventory: { X: [], O: [{ id: "opponent-bomb", type: "bomb" }] },
    eventItems: [{ id: 77, type: "exchange", row: 4, col: 5 }] };
  const next = playMove(state, 4, 5, () => 1);
  assert.equal(next.phase, "playing");
  assert.equal(next.currentPlayer, "X");
  assert.equal(next.piecesLeft, 1);
  assert.equal(next.inventory.X[0].type, "exchange");
});

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

test("exchange swaps the post-consumption inventories atomically and carries queued extra turns with their items", () => {
  const base = makePlayingState();
  const state = {
    ...base,
    inventory: {
      X: [
        { id: "exchange-1", type: "exchange" },
        { id: "x-bomb", type: "bomb" },
        { id: "x-extra", type: "extraTurn" }
      ],
      O: [
        { id: "o-shield", type: "shield" },
        { id: "o-extra", type: "extraTurn" }
      ]
    },
    pendingExtraTurns: { X: ["x-extra"], O: ["o-extra"] },
    pendingExtraTurn: "x-extra"
  };
  const originalInventory = structuredClone(state.inventory);
  const next = selectAbility(state, "exchange-1");

  assert.deepEqual(next.inventory.X, originalInventory.O);
  assert.deepEqual(next.inventory.O, [originalInventory.X[1], originalInventory.X[2]]);
  assert.deepEqual(next.pendingExtraTurns, { X: ["o-extra"], O: ["x-extra"] });
  assert.equal(next.pendingExtraTurn, "o-extra");
  assert.equal(next.selectedAbility, null);
  assert.deepEqual(next.abilityTargets, []);
  assert.equal(next.message.key, "message.exchange");
  assert.deepEqual(state.inventory, originalInventory);
  assert.deepEqual(state.pendingExtraTurns, { X: ["x-extra"], O: ["o-extra"] });
});

test("exchange works with an empty opponent inventory and cannot be reused after consumption", () => {
  const base = makePlayingState();
  const state = {
    ...base,
    inventory: { X: [{ id: 801, type: "exchange" }, { id: 802, type: "bomb" }], O: [] }
  };
  const used = processGameCommand(state, "X", { type: "select-ability", itemId: 801 });

  assert.equal(used.ok, true);
  assert.deepEqual(used.state.inventory, { X: [], O: [{ id: 802, type: "bomb" }] });
  const repeated = processGameCommand(used.state, "X", { type: "select-ability", itemId: 801 });
  assert.equal(repeated.ok, false);
  assert.deepEqual(repeated.state, used.state);
  assert.deepEqual(state.inventory, { X: [{ id: 801, type: "exchange" }, { id: 802, type: "bomb" }], O: [] });
});

test("exchange keeps both inventories within capacity when both were full", () => {
  const base = makePlayingState();
  const state = {
    ...base,
    inventory: {
      X: [
        { id: "exchange-full", type: "exchange" },
        { id: "x-bomb", type: "bomb" },
        { id: "x-shield", type: "shield" }
      ],
      O: [
        { id: "o-debris", type: "debris" },
        { id: "o-free", type: "freePlacement" },
        { id: "o-point", type: "pointDestroy" }
      ]
    }
  };
  const next = selectAbility(state, "exchange-full");
  assert.equal(next.inventory.X.length, 3);
  assert.equal(next.inventory.O.length, 2);
  assert.ok(next.inventory.X.every((item) => EVENT_ITEMS.includes(item.type)));
  assert.ok(next.inventory.O.every((item) => EVENT_ITEMS.includes(item.type)));
});

test("exchange rejects disabled or malformed inventory contents without partial changes", () => {
  const base = makePlayingState({ disabledItems: ["exchange"] });
  const disabled = {
    ...base,
    inventory: { X: [{ id: "disabled-exchange", type: "exchange" }], O: [] }
  };
  const disabledResult = processGameCommand(disabled, "X", {
    type: "select-ability", itemId: "disabled-exchange"
  });
  assert.equal(disabledResult.ok, false);
  assert.deepEqual(disabledResult.state, disabled);

  const malformed = {
    ...makePlayingState(),
    inventory: {
      X: [{ id: "exchange-2", type: "exchange" }],
      O: [{ id: "bad-random", type: "randomArtifact" }]
    }
  };
  const malformedResult = selectAbility(malformed, "exchange-2");
  assert.equal(malformedResult, malformed);

  const overCapacity = {
    ...makePlayingState(),
    inventory: {
      X: [
        { id: "exchange-3", type: "exchange" },
        { id: "x-1", type: "bomb" },
        { id: "x-2", type: "shield" },
        { id: "x-3", type: "debris" }
      ],
      O: []
    }
  };
  assert.equal(selectAbility(overCapacity, "exchange-3"), overCapacity);
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

function roundBoundaryState(overrides = {}) {
  const base = makePlayingState({ randomEvents: false, ...overrides });
  return {
    ...base,
    settings: { ...base.settings, randomEvents: true },
    eventItems: [],
    protections: [],
    wormholePair: null
  };
}

function finishOPlayerTurn(state, random) {
  state = {
    ...state,
    settings: { ...state.settings, wormholesEnabled: false },
    currentPlayer: "O",
    piecesLeft: 1
  };
  state.board[9][9] = "O";
  return playMove(state, 9, 8, random);
}

test("standard item spawning makes exactly one 30% check per completed turn", () => {
  const state = roundBoundaryState({ itemSpawnMode: "standard" });
  let calls = 0;
  const spawned = finishOPlayerTurn(state, () => [0.29, 0.1, 0.2][calls++] ?? 0);
  assert.equal(spawned.eventItems.length, 1);
  assert.equal(calls, 3); // one probability check, one cell choice, one item choice

  const failed = finishOPlayerTurn(state, () => 0.3);
  assert.equal(failed.eventItems.length, 0);
});

test("adaptive and hybrid item targets and probabilities clamp on small, typical and large maps", () => {
  assert.equal(getItemSpawnTarget({ width: 10, height: 10 }, "adaptive"), 4);
  assert.equal(getItemSpawnTarget({ width: 30, height: 30 }, "adaptive"), 8);
  assert.equal(getItemSpawnTarget({ width: 50, height: 50 }, "adaptive"), 13);
  assert.equal(getItemSpawnTarget({ width: 10, height: 10 }, "hybrid"), 3);
  assert.equal(getItemSpawnTarget({ width: 30, height: 30 }, "hybrid"), 5);
  assert.equal(getItemSpawnTarget({ width: 50, height: 50 }, "hybrid"), 8);
  assert.equal(getItemSpawnTarget({ width: 50, height: 50, area: 10_000 }, "hybrid"), 8);
  assert.equal(getItemSpawnProbability({ width: 10, height: 10, itemSpawnMode: "adaptive" }, 100), 0.05);
  assert.equal(getItemSpawnProbability({ width: 50, height: 50, itemSpawnMode: "adaptive" }, 0), 0.5);
  assert.equal(getItemSpawnProbability({ width: 50, height: 50, itemSpawnMode: "hybrid" }, 0), 0.5);
  assert.equal(getItemSpawnProbability({ width: 10, height: 10, itemSpawnMode: "hybrid" }, 100), 0.05);
});

test("adaptive and hybrid modes use the current item count and spawn at most one per turn", () => {
  for (const [mode, expectedChance] of [["adaptive", 0.4], ["hybrid", 0.42]]) {
    const state = roundBoundaryState({ itemSpawnMode: mode });
    const probability = getItemSpawnProbability(state.settings, 0);
    assert.equal(probability, expectedChance);
    let calls = 0;
    const spawned = finishOPlayerTurn(state, () => [probability - 0.001, 0, 0, 0][calls++] ?? 0);
    assert.equal(spawned.eventItems.length, 1);
    assert.equal(calls, 3);
  }
});

test("cascade uses the current base chance to increasing powers and stops at first failure", () => {
  const state = roundBoundaryState({ itemSpawnMode: "cascade" });
  const values = [0.1, 0.1, 0.1, 0.13, 0.2, 0.2, 0.05];
  let calls = 0;
  const spawned = finishOPlayerTurn(state, () => values[calls++] ?? 1);
  assert.equal(spawned.eventItems.length, 2);
  assert.equal(calls, 7); // probabilities a, updated a², updated a³ (failure), with two placements
});

test("large cascade mode starts two independent cascades; standard remains backward-compatible by default", () => {
  assert.equal(DEFAULT_SETTINGS.itemSpawnMode, "standard");
  const state = {
    ...roundBoundaryState({ itemSpawnMode: "cascade" }),
    settings: { ...roundBoundaryState().settings, width: 30, height: 30, itemSpawnMode: "cascade" }
  };
  // The first cascade fails; the second starts again at its first-power probability.
  let calls = 0;
  const spawned = finishOPlayerTurn(state, () => {
    calls += 1;
    return calls === 2 ? 0.3 : 1;
  });
  assert.equal(spawned.eventItems.length, 1);
  assert.equal(calls, 5); // the second cascade uses a¹ (0.3 succeeds), then checks a²
});

test("the second large-board cascade recalculates its base chance after the first cascade spawn", () => {
  const state = {
    ...roundBoundaryState({ itemSpawnMode: "cascade" }),
    settings: { ...roundBoundaryState().settings, width: 30, height: 30, itemSpawnMode: "cascade" }
  };
  const values = [0.1, 0, 0, 1, 0.49];
  let calls = 0;
  const spawned = finishOPlayerTurn(state, () => values[calls++] ?? 1);
  assert.equal(spawned.eventItems.length, 1);
  assert.equal(calls, 5); // at n=1, updated a=0.475; the second cascade's a¹ check fails at 0.49
});

test("cascade stops safely when the existing three-item field limit is reached or no free cell exists", () => {
  const fullItems = [0, 1, 2].map((col, id) => ({ id, type: "bomb", row: 0, col }));
  const atCapacity = { ...roundBoundaryState({ itemSpawnMode: "cascade" }), eventItems: fullItems };
  let calls = 0;
  const capacityResult = finishOPlayerTurn(atCapacity, () => { calls += 1; return 0; });
  assert.equal(capacityResult.eventItems.length, 3);
  assert.equal(calls, 0);

  const noSpace = { ...roundBoundaryState({ itemSpawnMode: "cascade" }), board: Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL)) };
  noSpace.board[9][9] = "O";
  noSpace.board[9][8] = EMPTY_CELL;
  const noSpaceResult = finishOPlayerTurn(noSpace, () => 0);
  assert.equal(noSpaceResult.eventItems.length, 0);
});

test("wormhole pair spawns on free cells with a shared lifetime in the board-size range", () => {
  let state = roundBoundaryState();
  state = playMove(state, 0, 1, () => 1);
  const values = [0, 0, 0.4, 0.999, 1];
  let index = 0;
  state = playMove(state, 9, 8, () => values[index++] ?? 1);

  assert.ok(state.wormholePair);
  const { orange, blue } = state.wormholePair.endpoints;
  assert.notDeepEqual(orange, blue);
  assert.equal(state.board[orange.row][orange.col], "");
  assert.equal(state.board[blue.row][blue.col], "");
  assert.ok(state.wormholePair.roundsRemaining >= 3);
  assert.ok(state.wormholePair.roundsRemaining <= Math.round(Math.sqrt(100)));
  assert.equal(state.wormholePair.roundsRemaining, 10);
  assert.ok(Number.isInteger(state.wormholePair.roundsRemaining));
});

test("wormhole spawning excludes items and shielded cells and never replaces an active pair", () => {
  let state = roundBoundaryState();
  state = {
    ...state,
    eventItems: [{ id: 91, type: "bomb", row: 0, col: 1 }],
    protections: [{ row: 0, col: 2, owner: "O", permanent: true }]
  };
  state = playMove(state, 0, 1, () => 1);
  let rng = [0, 0, 0, 0, 1];
  let cursor = 0;
  state = playMove(state, 9, 8, () => rng[cursor++] ?? 1);
  assert.ok(state.wormholePair);
  assert.equal(state.wormholePair.roundsRemaining, 3);
  for (const endpoint of Object.values(state.wormholePair.endpoints)) {
    assert.notDeepEqual(endpoint, { row: 0, col: 2 });
    assert.notDeepEqual(endpoint, { row: 0, col: 1 });
  }

  const active = { ...state, wormholePair: { ...state.wormholePair, roundsRemaining: 4 } };
  const xTurn = playMove(active, 0, 2, () => 1);
  const oTurn = playMove(xTurn, 9, 7, () => 0);
  assert.equal(oTurn.wormholePair.id, active.wormholePair.id);
});

test("both players can continue a chain through the paired portal, but not place on portals or beyond the exit", () => {
  const base = makePlayingState();
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[2][1] = "X";
  board[9][9] = "O";
  board[7][8] = "";
  const pair = { id: 1, endpoints: { orange: { row: 2, col: 2 }, blue: { row: 7, col: 7 } }, roundsRemaining: 3 };
  const xState = { ...base, board, currentPlayer: "X", piecesLeft: 1, wormholePair: pair };
  assert.equal(isLegalMove(xState, 7, 8), true);
  assert.ok(getLegalMoves(xState).some(({ row, col }) => row === 7 && col === 8));
  assert.equal(canCompleteTurn(xState, "X", 1), true);
  assert.equal(canCompleteTurn(xState, "X", 2), false);
  assert.equal(isLegalMove(xState, 7, 7), false);
  assert.equal(isLegalMove(xState, 5, 5), false);
  const action = chooseComputerAction(xState, "easy", { random: () => 0 });
  assert.deepEqual({ row: action.row, col: action.col }, { row: 7, col: 8 });
  const localTransition = playMove(xState, action.row, action.col, () => 1);
  const aiTransition = applyComputerAction(xState, action, () => 1);
  const serverTransition = processGameCommand(xState, "X", {
    type: "place", row: action.row, col: action.col
  }, { random: () => 1 });
  assert.equal(serverTransition.ok, true);
  assert.deepEqual(aiTransition, localTransition);
  assert.deepEqual(serverTransition.state, localTransition);

  const oBoard = board.map((row) => row.slice());
  oBoard[2][1] = "";
  oBoard[9][9] = "X";
  oBoard[7][8] = "O";
  const oState = { ...xState, board: oBoard, currentPlayer: "O" };
  assert.equal(isLegalMove(oState, 2, 1), true);
  assert.equal(canCompleteTurn(oState, "O", 1), true);
});

test("touching either wormhole activates legal cells around both endpoints", () => {
  const base = makePlayingState();
  const pair = { id: 41, endpoints: { orange: { row: 3, col: 3 }, blue: { row: 6, col: 6 } }, roundsRemaining: 3 };
  for (const entryColor of ["orange", "blue"]) {
    const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
    const entry = pair.endpoints[entryColor];
    board[entry.row - 1][entry.col - 1] = "X"; // diagonal contact
    const targets = Object.values(pair.endpoints).map(({ row, col }) => ({ row: row + 1, col }));
    for (const target of targets) board[target.row][target.col] = EMPTY_CELL;
    const state = { ...base, board, currentPlayer: "X", piecesLeft: 1, wormholePair: pair };
    for (const target of targets) {
      assert.equal(isLegalMove(state, target.row, target.col), true,
        `${entryColor} contact should activate a move beside each endpoint`);
      assert.ok(getLegalMoves(state).some(({ row, col }) => row === target.row && col === target.col));
    }
  }
});

test("wormhole routing is symmetric across both endpoint colors and all eight neighbor directions", () => {
  const base = makePlayingState({ piecesPerTurn: 2 });
  const offsets = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];
  const pair = { id: 12, endpoints: { orange: { row: 3, col: 3 }, blue: { row: 6, col: 6 } }, roundsRemaining: 3 };

  for (const player of ["X", "O"]) {
    for (const entryColor of ["orange", "blue"]) {
      const exitColor = entryColor === "orange" ? "blue" : "orange";
      for (const [entryRowOffset, entryColOffset] of offsets) {
        for (const [exitRowOffset, exitColOffset] of offsets) {
          const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
          const entry = pair.endpoints[entryColor];
          const exit = pair.endpoints[exitColor];
          const source = { row: entry.row + entryRowOffset, col: entry.col + entryColOffset };
          const target = { row: exit.row + exitRowOffset, col: exit.col + exitColOffset };
          board[source.row][source.col] = player;
          board[target.row][target.col] = EMPTY_CELL;
          const state = { ...base, board, currentPlayer: player, piecesLeft: 2, wormholePair: pair };

          assert.equal(isLegalMove(state, target.row, target.col), true,
            `${player} should connect ${entryColor}→${exitColor} from ${JSON.stringify(source)} to ${JSON.stringify(target)}`);
          assert.ok(getLegalMoves(state).some(({ row, col }) => row === target.row && col === target.col));
        }
      }
    }
  }
});

test("after placing through a wormhole, the same player's chain can route back through its pair", () => {
  const base = makePlayingState({ piecesPerTurn: 2 });
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[2][2] = "X";
  board[9][9] = "O";
  board[6][7] = EMPTY_CELL;
  board[4][3] = EMPTY_CELL;
  const pair = { id: 13, endpoints: { orange: { row: 3, col: 3 }, blue: { row: 6, col: 6 } }, roundsRemaining: 3 };
  const before = { ...base, board, currentPlayer: "X", piecesLeft: 2, wormholePair: pair };

  assert.equal(isLegalMove(before, 6, 7), true);
  const after = playMove(before, 6, 7, () => 1);
  assert.equal(after.currentPlayer, "X");
  assert.equal(after.piecesLeft, 1);
  assert.equal(isLegalMove(after, 4, 3), true);
  assert.ok(getLegalMoves(after).some(({ row, col }) => row === 4 && col === 3));
  assert.equal(before.board[6][7], EMPTY_CELL);
});

test("wormholes do not cause contact destruction, and overlapping debris or shields are rejected", () => {
  const base = makePlayingState();
  const board = base.board.map((row) => row.slice());
  board[1][1] = "X";
  board[8][8] = "O";
  const state = {
    ...base,
    board,
    wormholePair: { id: 1, endpoints: { orange: { row: 2, col: 2 }, blue: { row: 7, col: 7 } }, roundsRemaining: 3 }
  };
  const moved = playMove(state, 1, 2, () => 1);
  assert.equal(moved.board[8][8], "O");
  assert.equal(isValidDebrisTarget(state, 2, 2), false);
  assert.equal(isValidShieldTarget(state, 7, 7), false);
  assert.equal(placeEditorObject(state, "X", { kind: "blocked", row: 2, col: 2 }, { admin: true }), state);
  assert.equal(placeEditorObject(state, "X", { kind: "item", itemType: "bomb", row: 7, col: 7 }, { admin: true }), state);
});

test("destructive abilities clear the entire pair atomically when they hit either endpoint", () => {
  const base = makePlayingState();
  const pair = { id: 4, endpoints: { orange: { row: 2, col: 2 }, blue: { row: 7, col: 7 } }, roundsRemaining: 3 };
  const bombState = {
    ...base, wormholePair: pair, inventory: { X: [{ id: 501, type: "bomb" }], O: [] }
  };
  const bombed = useBomb(selectAbility(bombState, 501), 501, 2, 2);
  assert.equal(bombed.wormholePair, null);

  const pointState = {
    ...base, wormholePair: pair, inventory: { X: [{ id: 502, type: "pointDestroy" }], O: [] }
  };
  const destroyed = usePointDestroy(selectAbility(pointState, 502), 502, 7, 7);
  assert.equal(destroyed.wormholePair, null);
});

test("wormhole lifetime decreases only at the completed O-to-X round boundary and then expires", () => {
  let state = {
    ...makePlayingState(),
    wormholePair: { id: 8, endpoints: { orange: { row: 4, col: 4 }, blue: { row: 6, col: 6 } }, roundsRemaining: 2 }
  };
  state = playMove(state, 0, 1, () => 1);
  assert.equal(state.wormholePair.roundsRemaining, 2);
  state = playMove(state, 9, 8, () => 1);
  assert.equal(state.wormholePair.roundsRemaining, 1);
  state = playMove(state, 0, 2, () => 1);
  state = playMove(state, 9, 7, () => 1);
  assert.equal(state.wormholePair, null);
  assert.equal(state.roundNumber, 3);
});

test("a round with fewer than two available cells cannot spawn a partial wormhole pair", () => {
  const base = roundBoundaryState();
  const board = Array.from({ length: 10 }, () => Array(10).fill(BLOCKED_CELL));
  board[0][0] = "X";
  board[9][9] = "O";
  board[0][1] = "";
  board[0][2] = "";
  board[9][8] = "";
  let state = { ...base, board };
  state = playMove(state, 0, 1, () => 1);
  state = playMove(state, 9, 8, () => 0);
  assert.equal(state.currentPlayer, "X");
  assert.equal(state.phase, "playing");
  assert.equal(state.wormholePair, null);
});

test("wormhole generation requires both random events and the wormhole setting", () => {
  assert.equal(DEFAULT_SETTINGS.wormholesEnabled, true);
  for (const settings of [
    { randomEvents: false, wormholesEnabled: true },
    { randomEvents: true, wormholesEnabled: false }
  ]) {
    let state = roundBoundaryState();
    state = { ...state, settings: { ...state.settings, ...settings } };
    state = playMove(state, 0, 1, () => 0);
    state = playMove(state, 9, 8, () => 0);
    assert.equal(state.wormholePair, null);
  }
});

test("server player views expose the same detached public wormhole pair to both sides", () => {
  const base = makePlayingState();
  const pair = { id: 2, endpoints: { orange: { row: 1, col: 2 }, blue: { row: 7, col: 8 } }, roundsRemaining: 5 };
  const state = { ...base, wormholePair: pair, nextWormholeId: 3, roundNumber: 9 };
  const xView = getPlayerView(state, "X");
  const oView = getPlayerView(state, "O");
  assert.deepEqual(xView.wormholePair, pair);
  assert.deepEqual(oView.wormholePair, pair);
  assert.notEqual(xView.wormholePair, pair);
  xView.wormholePair.endpoints.orange.row = 99;
  assert.equal(state.wormholePair.endpoints.orange.row, 1);
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
