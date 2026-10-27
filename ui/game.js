export const MIN_BOARD_DIMENSION = 10;
export const MAX_BOARD_DIMENSION = 50;
export const DEFAULT_SETTINGS = Object.freeze({
  width: 20,
  height: 20,
  piecesPerTurn: 3,
  clockMinutes: 3,
  incrementSeconds: 10,
  unlimitedItemLifetime: true,
  itemLifetimeTurns: 10,
  unlimitedTime: false,
  randomEvents: true,
  itemSpawnMode: "standard",
  wormholesEnabled: true,
  animationsEnabled: true,
  freeStartingPositions: true,
  adminMode: false,
  disabledItems: Object.freeze([])
});
export const PLAYER_ROLES = Object.freeze({ PLAYER: "player", ADMIN: "admin" });
export const PLAYER_PERMISSIONS = Object.freeze({ USE_OWN_ITEMS: "items:use-owned", USE_ANY_ITEM: "items:use-any" });
const ROLE_PERMISSIONS = Object.freeze({
  [PLAYER_ROLES.PLAYER]: [PLAYER_PERMISSIONS.USE_OWN_ITEMS],
  [PLAYER_ROLES.ADMIN]: [PLAYER_PERMISSIONS.USE_OWN_ITEMS, PLAYER_PERMISSIONS.USE_ANY_ITEM]
});
export const EMPTY_CELL = "";
export const BLOCKED_CELL = "#";
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];
const ORTHOGONAL = new Set(["-1,0", "1,0", "0,-1", "0,1"]);
export const EVENT_ITEMS = Object.freeze([
  "bomb", "freePlacement", "extraTurn", "antiBomb", "pointDestroy", "debris", "shield", "gangstaShield", "randomArtifact", "exchange"
]);
export const ITEM_SPAWN_MODES = Object.freeze(["standard", "cascade", "adaptive", "hybrid"]);
const RANDOM_ARTIFACT = "randomArtifact";
const EVENT_SPAWN_CHANCE = 0.3;
const MAX_INVENTORY_ITEMS = 3;

function emptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(EMPTY_CELL));
}

function copyBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(row, col, board) {
  return row >= 0 && row < board.length && col >= 0 && col < board[0].length;
}

function neighbors(row, col, board) {
  return DIRECTIONS
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc, dr, dc }))
    .filter(({ row: nextRow, col: nextCol }) => inBounds(nextRow, nextCol, board));
}

function wormholeAt(pair, row, col) {
  if (!pair) return null;
  const { orange, blue } = pair.endpoints || {};
  if (orange?.row === row && orange?.col === col) return "orange";
  if (blue?.row === row && blue?.col === col) return "blue";
  return null;
}

function hasEnoughConnectedCells(player, count, board, wormholePair = null) {
  if (count <= 0) return true;
  const visited = new Set();
  const queue = [];

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col] === player) {
        const key = row + "," + col;
        visited.add(key);
        queue.push({ row, col });
      }
    }
  }

  let reachableEmpty = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of neighbors(current.row, current.col, board)) {
      const key = next.row + "," + next.col;
      if (visited.has(key)) continue;
      const portal = wormholeAt(wormholePair, next.row, next.col);
      if (portal) {
        visited.add(key);
        const paired = wormholePair.endpoints[portal === "orange" ? "blue" : "orange"];
        for (const exit of neighbors(paired.row, paired.col, board)) {
          const exitKey = exit.row + "," + exit.col;
          if (visited.has(exitKey)) continue;
          const exitValue = board[exit.row][exit.col];
          if (exitValue !== EMPTY_CELL && exitValue !== player) continue;
          visited.add(exitKey);
          if (exitValue === EMPTY_CELL) {
            reachableEmpty += 1;
            if (reachableEmpty >= count) return true;
          }
          queue.push({ row: exit.row, col: exit.col });
        }
        continue;
      }
      const value = board[next.row][next.col];
      if (value !== EMPTY_CELL && value !== player) continue;
      visited.add(key);
      if (value === EMPTY_CELL) {
        reachableEmpty += 1;
        if (reachableEmpty >= count) return true;
      }
      queue.push({ row: next.row, col: next.col });
    }
  }

  return false;
}

export function canCompleteTurn(state, player = state?.currentPlayer, count = state?.piecesLeft) {
  return Boolean(state?.board?.length)
    && (player === "X" || player === "O")
    && Number.isInteger(count)
    && hasEnoughConnectedCells(player, count, state.board, state.wormholePair);
}

function isWormholeCell(state, row, col) {
  return Boolean(wormholeAt(state?.wormholePair, row, col));
}

function randomIndex(random, length) {
  return Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999999999, random())) * length));
}

function maybeSpawnWormholePair(state, random) {
  if (!state.settings.randomEvents || !state.settings.wormholesEnabled || state.wormholePair || random() >= EVENT_SPAWN_CHANCE) return state;
  const occupiedByItems = new Set(state.eventItems.map(({ row, col }) => row + "," + col));
  const occupiedByProtection = new Set(state.protections.map(({ row, col }) => row + "," + col));
  const available = [];
  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board[row].length; col += 1) {
      const key = row + "," + col;
      if (state.board[row][col] === EMPTY_CELL && !occupiedByItems.has(key) && !occupiedByProtection.has(key)) {
        available.push({ row, col });
      }
    }
  }
  if (available.length < 2) return state;

  const firstIndex = randomIndex(random, available.length);
  const [orange] = available.splice(firstIndex, 1);
  const blue = available[randomIndex(random, available.length)];
  const maxRounds = Math.max(3, Math.round(Math.sqrt(state.settings.width * state.settings.height)));
  const roundsRemaining = 3 + randomIndex(random, maxRounds - 2);
  return {
    ...state,
    wormholePair: { id: state.nextWormholeId, endpoints: { orange, blue }, roundsRemaining },
    nextWormholeId: state.nextWormholeId + 1
  };
}

function advanceRound(state) {
  const roundNumber = state.roundNumber + 1;
  let wormholePair = state.wormholePair;
  let expired = false;
  if (wormholePair) {
    const roundsRemaining = wormholePair.roundsRemaining - 1;
    expired = roundsRemaining <= 0;
    wormholePair = expired ? null : { ...wormholePair, roundsRemaining };
  }
  return { ...state, roundNumber, wormholePair };
}

function isProtected(state, row, col) {
  return state.protections.some((protection) => protection.row === row && protection.col === col);
}

function resolveContact(row, col, player, board, protections) {
  const enemy = player === "X" ? "O" : "X";
  const touching = neighbors(row, col, board)
    .filter(({ row: nextRow, col: nextCol }) => board[nextRow][nextCol] === enemy
      && !protections.some((protection) => protection.row === nextRow && protection.col === nextCol))
    .sort((a, b) => Number(ORTHOGONAL.has(b.dr + "," + b.dc)) - Number(ORTHOGONAL.has(a.dr + "," + a.dc)));

  if (touching.length === 0) return [];

  const affected = new Map();
  for (const target of touching) {
    affected.set(target.row + "," + target.col, target);
    for (const adjacent of neighbors(target.row, target.col, board)) {
      if (board[adjacent.row][adjacent.col] === enemy
        && !protections.some((protection) => protection.row === adjacent.row && protection.col === adjacent.col)) {
        affected.set(adjacent.row + "," + adjacent.col, adjacent);
      }
    }
  }

  const destroyed = Array.from(affected.values());
  for (const cell of destroyed) board[cell.row][cell.col] = BLOCKED_CELL;
  return destroyed;
}

function finish(state, winner, reason) {
  return { ...state, phase: "finished", winner, finishReason: reason };
}

const message = (key, params = {}) => ({ key, params });

function appendMessage(current, addition) {
  return [...(Array.isArray(current) ? current : current ? [current] : []), addition];
}

function randomArtifactCandidates(state) {
  return EVENT_ITEMS.filter((type) => type !== RANDOM_ARTIFACT && isItemEnabled(state, type));
}

function availableEventItemCells(state) {
  if (!state.settings.randomEvents) return [];
  const occupiedByEvent = new Set(state.eventItems.map((item) => item.row + "," + item.col));
  const available = [];
  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board[row].length; col += 1) {
      if (state.board[row][col] === EMPTY_CELL && !occupiedByEvent.has(row + "," + col)
        && !isWormholeCell(state, row, col)) available.push({ row, col });
    }
  }
  return available;
}

function spawnOneEventItem(state, random) {
  const hasRandomArtifactResult = randomArtifactCandidates(state).length > 0;
  const enabledItems = EVENT_ITEMS.filter((type) => isItemEnabled(state, type)
    && (type !== RANDOM_ARTIFACT || hasRandomArtifactResult));
  if (enabledItems.length === 0) return state;

  const available = availableEventItemCells(state);
  if (available.length === 0) return state;

  const location = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  const type = enabledItems[Math.min(enabledItems.length - 1, Math.floor(random() * enabledItems.length))];
  const eventItem = {
    id: state.nextEventItemId,
    type,
    ...location,
    ...(!state.settings.unlimitedItemLifetime ? { lifetimeTurns: state.settings.itemLifetimeTurns } : {})
  };
  return {
    ...state,
    eventItems: [...state.eventItems, eventItem],
    nextEventItemId: state.nextEventItemId + 1,
    message: appendMessage(state.message, message("message.spawn", { type }))
  };
}

function ageFieldItems(state) {
  if (state.settings.unlimitedItemLifetime) return state;
  const eventItems = [];
  for (const item of state.eventItems) {
    // Legacy/editor-created items acquire the configured lifetime when they
    // first cross a completed-turn boundary.
    const remaining = Number.isInteger(item.lifetimeTurns)
      ? item.lifetimeTurns - 1
      : state.settings.itemLifetimeTurns - 1;
    if (remaining > 0) eventItems.push({ ...item, lifetimeTurns: remaining });
  }
  return eventItems.length === state.eventItems.length
    && eventItems.every((item, index) => item === state.eventItems[index])
    ? state
    : { ...state, eventItems };
}

function maybeSpawnEventItem(state, random) {
  if (state.phase !== "playing" || !state.settings.randomEvents) return state;

  const mode = state.settings.itemSpawnMode;
  if (mode === "cascade") {
    let next = state;
    const cascades = next.settings.width * next.settings.height >= 30 * 30 ? 2 : 1;
    for (let cascade = 0; cascade < cascades; cascade += 1) {
      for (let attempt = 1; ; attempt += 1) {
        if (availableEventItemCells(next).length === 0) break;
        const chance = getItemSpawnProbability(next.settings, next.eventItems.length);
        if (random() >= chance ** attempt) break;
        const spawned = spawnOneEventItem(next, random);
        if (spawned === next) break;
        next = spawned;
      }
    }
    return next;
  }

  const chance = getItemSpawnProbability(state.settings, state.eventItems.length);
  return random() < chance ? spawnOneEventItem(state, random) : state;
}

export function getItemSpawnTarget(settings, mode = settings?.itemSpawnMode) {
  const area = Math.max(0, Number(settings?.width) * Number(settings?.height));
  if (mode === "adaptive") return Math.max(4, Math.min(20, Math.round(0.25 * Math.sqrt(area))));
  if (mode === "hybrid") return Math.min(16, Math.max(3, Math.round(0.15 * Math.sqrt(area))));
  return null;
}

export function getItemSpawnProbability(settings, itemCount = 0) {
  const mode = ITEM_SPAWN_MODES.includes(settings?.itemSpawnMode) ? settings.itemSpawnMode : "standard";
  if (mode === "adaptive" || mode === "cascade") {
    const target = getItemSpawnTarget(settings, "adaptive");
    return Math.max(0.05, Math.min(0.5, 0.3 + 0.025 * (target - itemCount)));
  }
  if (mode === "hybrid") {
    const target = getItemSpawnTarget(settings, mode);
    return Math.max(0.05, Math.min(0.5, 0.3 + 0.04 * (target - itemCount)));
  }
  return EVENT_SPAWN_CHANCE;
}

function copyInventory(inventory) {
  return { X: inventory.X.slice(), O: inventory.O.slice() };
}

function removeInventoryItem(inventory, player, itemId) {
  const index = inventory[player].findIndex((item) => item.id === itemId);
  if (index >= 0) inventory[player].splice(index, 1);
}

export function hasPermission(state, player, permission) {
  const role = state.playerRoles?.[player] || PLAYER_ROLES.PLAYER;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isItemEnabled(state, type) {
  const disabledItems = state?.settings?.disabledItems;
  return EVENT_ITEMS.includes(type)
    && !(Array.isArray(disabledItems) && disabledItems.includes(type));
}

/** Place an existing board object through the local administrator editor.
 * The editor deliberately uses the game's canonical eventItems and board cells.
 */
export function placeEditorObject(state, player, object, { admin = false } = {}) {
  if (!state || state.phase !== "playing" || !["X", "O"].includes(player)
    || (!admin && !hasPermission(state, player, PLAYER_PERMISSIONS.USE_ANY_ITEM))
    || !object || typeof object !== "object" || Array.isArray(object)
    || !Number.isInteger(object.row) || !Number.isInteger(object.col)
    || !inBounds(object.row, object.col, state.board)) return state;

  if (object.kind === "clear" && Object.keys(object).every((key) => ["kind", "row", "col"].includes(key))) {
    const { row, col } = object;
    const hasBoardObject = state.board[row][col] !== EMPTY_CELL
      || state.eventItems.some((item) => item.row === row && item.col === col)
      || state.protections.some((protection) => protection.row === row && protection.col === col)
      || isWormholeCell(state, row, col);
    if (!hasBoardObject) return state;

    const board = copyBoard(state.board);
    board[row][col] = EMPTY_CELL;
    const coordinates = [{ row, col }];
    return {
      ...state,
      board,
      eventItems: clearEventItemsAt(state, coordinates),
      protections: removeProtectionsAt(state, coordinates),
      wormholePair: clearWormholePairAt(state, coordinates),
      lastDestroyed: (state.lastDestroyed || []).filter((cell) => cell.row !== row || cell.col !== col)
    };
  }

  if (state.board[object.row][object.col] !== EMPTY_CELL || isWormholeCell(state, object.row, object.col)) return state;
  const itemAtTarget = state.eventItems.some((item) => item.row === object.row && item.col === object.col);
  const protectionAtTarget = state.protections.some((protection) => protection.row === object.row && protection.col === object.col);

  if (object.kind === "item") {
    if (Object.keys(object).some((key) => !["kind", "itemType", "row", "col"].includes(key))
      || !isItemEnabled(state, object.itemType) || itemAtTarget || protectionAtTarget
      || (object.itemType === RANDOM_ARTIFACT && randomArtifactCandidates(state).length === 0)
      || !Number.isSafeInteger(state.nextEventItemId) || state.nextEventItemId < 0) return state;
    const usedIds = new Set(state.eventItems.map((item) => item.id));
    let itemId = state.nextEventItemId;
    while (usedIds.has(itemId) && Number.isSafeInteger(itemId)) itemId += 1;
    if (!Number.isSafeInteger(itemId + 1)) return state;
    return {
      ...state,
      eventItems: [...state.eventItems, {
        id: itemId,
        type: object.itemType,
        row: object.row,
        col: object.col,
        ...(!state.settings.unlimitedItemLifetime ? { lifetimeTurns: state.settings.itemLifetimeTurns } : {})
      }],
      nextEventItemId: itemId + 1
    };
  }

  if (object.kind === "blocked" && Object.keys(object).every((key) => ["kind", "row", "col"].includes(key))
    && !itemAtTarget && !protectionAtTarget) {
    const board = copyBoard(state.board);
    board[object.row][object.col] = BLOCKED_CELL;
    if (!canCompleteTurn({ ...state, board }, state.currentPlayer, state.piecesLeft)) return state;
    return { ...state, board, lastDestroyed: [] };
  }

  return state;
}

export function placeEditorWormholePair(state, player, first, second, { admin = false, random = Math.random } = {}) {
  if (!state || state.phase !== "playing" || !["X", "O"].includes(player)
    || (!admin && !hasPermission(state, player, PLAYER_PERMISSIONS.USE_ANY_ITEM))
    || state.wormholePair || !first || !second
    || !Number.isInteger(first.row) || !Number.isInteger(first.col)
    || !Number.isInteger(second.row) || !Number.isInteger(second.col)
    || !inBounds(first.row, first.col, state.board) || !inBounds(second.row, second.col, state.board)
    || (first.row === second.row && first.col === second.col)) return state;
  const occupiedItems = new Set(state.eventItems.map(({ row, col }) => `${row},${col}`));
  const occupiedProtections = new Set(state.protections.map(({ row, col }) => `${row},${col}`));
  for (const point of [first, second]) {
    const key = `${point.row},${point.col}`;
    if (state.board[point.row][point.col] !== EMPTY_CELL || occupiedItems.has(key) || occupiedProtections.has(key)) return state;
  }
  const maxRounds = Math.max(3, Math.round(Math.sqrt(state.settings.width * state.settings.height)));
  const roundsRemaining = 3 + randomIndex(random, maxRounds - 2);
  return {
    ...state,
    wormholePair: {
      id: state.nextWormholeId,
      endpoints: { orange: { ...first }, blue: { ...second } },
      roundsRemaining
    },
    nextWormholeId: state.nextWormholeId + 1
  };
}

function getAbility(state, player, itemId) {
  const owned = state.inventory[player].find((item) => item.id === itemId);
  if (owned) return owned.type !== RANDOM_ARTIFACT && isItemEnabled(state, owned.type) ? owned : null;
  if (typeof itemId !== "string" || !itemId.startsWith("admin:")
    || !hasPermission(state, player, PLAYER_PERMISSIONS.USE_ANY_ITEM)) return null;
  const type = itemId.slice("admin:".length);
  return type !== RANDOM_ARTIFACT && isItemEnabled(state, type) ? { id: itemId, type, adminGranted: true } : null;
}

export function getSelectedAbility(state) {
  return state.selectedAbility === null ? null : getAbility(state, state.currentPlayer, state.selectedAbility);
}

function pendingExtraTurnQueues(state) {
  const queues = state.pendingExtraTurns;
  if (queues && !Array.isArray(queues) && typeof queues === "object") {
    const result = { X: [...(queues.X || [])], O: [...(queues.O || [])] };
    const legacyId = state.pendingExtraTurn;
    if (legacyId !== null && legacyId !== undefined && result.X.length === 0 && result.O.length === 0) {
      const owner = ["X", "O"].find((player) => state.inventory?.[player]?.some((item) => item.id === legacyId));
      if (owner) result[owner].push(legacyId);
    }
    return result;
  }
  const legacyId = state.pendingExtraTurn;
  if (legacyId === null || legacyId === undefined) return { X: [], O: [] };
  const owner = ["X", "O"].find((player) => state.inventory?.[player]?.some((item) => item.id === legacyId));
  return { X: owner === "X" ? [legacyId] : [], O: owner === "O" ? [legacyId] : [] };
}

function withPendingExtraTurnQueues(state, queues) {
  return {
    ...state,
    pendingExtraTurns: queues,
    // Keep the old scalar field readable for older local fixtures/integrations.
    pendingExtraTurn: queues[state.currentPlayer]?.[0] ?? queues.X[0] ?? queues.O[0] ?? null
  };
}

function acquireEventItem(state, player, eventItem) {
  const inventory = copyInventory(state.inventory);
  const pendingExtraTurns = pendingExtraTurnQueues(state);
  if (inventory[player].length >= MAX_INVENTORY_ITEMS) {
    const protectedIds = new Set(pendingExtraTurns[player]);
    const removableIndex = inventory[player].findIndex((item) => !protectedIds.has(item.id));
    const [replaced] = inventory[player].splice(removableIndex < 0 ? 0 : removableIndex, 1);
    if (eventItem.type === "extraTurn") pendingExtraTurns[player].push(eventItem.id);
    return {
      inventory: { ...inventory, [player]: [...inventory[player], eventItem] },
      selectedAbility: state.selectedAbility === replaced.id ? null : state.selectedAbility,
      pendingExtraTurns,
      pendingExtraTurn: pendingExtraTurns[state.currentPlayer]?.[0] ?? pendingExtraTurns.X[0] ?? pendingExtraTurns.O[0] ?? null
    };
  }
  if (eventItem.type === "extraTurn") pendingExtraTurns[player].push(eventItem.id);
  return {
    inventory: { ...inventory, [player]: [...inventory[player], eventItem] },
    selectedAbility: state.selectedAbility,
    pendingExtraTurns,
    pendingExtraTurn: pendingExtraTurns[state.currentPlayer]?.[0] ?? pendingExtraTurns.X[0] ?? pendingExtraTurns.O[0] ?? null
  };
}

export function resign(state, player = state.currentPlayer) {
  if (state.phase !== "playing" || (player !== "X" && player !== "O")) return state;
  const winner = player === "X" ? "O" : "X";
  return finish(state, winner, message("message.resigned", { player }));
}

export function flagFall(state) {
  if (state.phase !== "playing") return state;
  const winner = state.currentPlayer === "X" ? "O" : "X";
  return finish(state, winner, message("message.timeUp", { player: state.currentPlayer }));
}

function beginPlay(state, board, message, random) {
  const playingState = {
    ...state,
    board,
    phase: "playing",
    currentPlayer: "X",
    turnNumber: 1,
    piecesLeft: state.settings.piecesPerTurn,
    lastDestroyed: [],
    message
  };
  return spawnOneEventItem(playingState, random);
}

function placeInOppositeCorners(settings, random) {
  const board = emptyBoard(settings.width, settings.height);
  if (random() < 0.5) {
    board[0][0] = "X";
    board[settings.height - 1][settings.width - 1] = "O";
  } else {
    board[0][settings.width - 1] = "X";
    board[settings.height - 1][0] = "O";
  }
  return board;
}

export function createGameState(settings = DEFAULT_SETTINGS, random = Math.random) {
  const disabledItems = Array.isArray(settings.disabledItems)
    ? [...new Set(settings.disabledItems.filter((type) => EVENT_ITEMS.includes(type)))]
    : [];
  const appliedSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    itemSpawnMode: ITEM_SPAWN_MODES.includes(settings.itemSpawnMode) ? settings.itemSpawnMode : "standard",
    disabledItems
  };
  const state = {
    board: emptyBoard(appliedSettings.width, appliedSettings.height),
    settings: appliedSettings,
    // In multiplayer, derive these roles from the authenticated server session.
    playerRoles: appliedSettings.adminMode
      ? { X: PLAYER_ROLES.ADMIN, O: PLAYER_ROLES.ADMIN }
      : { X: PLAYER_ROLES.PLAYER, O: PLAYER_ROLES.PLAYER },
    phase: "setup-x",
    currentPlayer: "X",
    piecesLeft: appliedSettings.piecesPerTurn,
    setupPlayer: "X",
    startChoices: { X: null, O: null },
    collisionAttempts: 0,
    lastDestroyed: [],
    eventItems: [],
    nextEventItemId: 1,
    wormholePair: null,
    nextWormholeId: 1,
    roundNumber: 1,
    turnNumber: 0,
    inventory: { X: [], O: [] },
    selectedAbility: null,
    abilityTargets: [],
    protections: [],
    pendingExtraTurns: { X: [], O: [] },
    pendingExtraTurn: null,
    message: [],
    winner: null,
    finishReason: null
  };

  if (!appliedSettings.freeStartingPositions) {
    return beginPlay(
      state,
      placeInOppositeCorners(appliedSettings, random),
      message("message.fixedStart"),
      random
    );
  }

  return state;
}

export function isLegalMove(state, row, col) {
  if (state.phase !== "playing" || !inBounds(row, col, state.board) || state.board[row][col] !== EMPTY_CELL
    || isWormholeCell(state, row, col)) return false;
  const selected = getSelectedAbility(state);
  if (selected) return selected.type === "freePlacement";
  if (neighbors(row, col, state.board).some(({ row: nextRow, col: nextCol }) => state.board[nextRow][nextCol] === state.currentPlayer)) return true;
  const pair = state.wormholePair;
  if (!pair) return false;
  const connectedToPair = Object.values(pair.endpoints).some((endpoint) =>
    neighbors(endpoint.row, endpoint.col, state.board)
      .some(({ row: ownRow, col: ownCol }) => state.board[ownRow][ownCol] === state.currentPlayer));
  return connectedToPair && Object.values(pair.endpoints).some((endpoint) =>
    neighbors(endpoint.row, endpoint.col, state.board)
      .some(({ row: targetRow, col: targetCol }) => targetRow === row && targetCol === col));
}

export function getLegalMoves(state) {
  if (!state?.board?.length || state.phase !== "playing") return [];
  const moves = [];
  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board[row].length; col += 1) {
      if (isLegalMove(state, row, col)) moves.push({ row, col });
    }
  }
  return moves;
}

const RESCUE_ITEM_TYPES = new Set(["bomb", "freePlacement", "pointDestroy", "exchange"]);

export function canContinueAfterPlacement(state, player = state?.currentPlayer) {
  if (!state?.board?.length || state.phase !== "playing" || (player !== "X" && player !== "O")) return false;
  const ordinaryState = { ...state, currentPlayer: player, selectedAbility: null, abilityTargets: [] };
  if (getLegalMoves(ordinaryState).length > 0) return true;

  const owned = (state.inventory?.[player] || [])
    .filter((item) => item && RESCUE_ITEM_TYPES.has(item.type) && isItemEnabled(state, item.type));
  const has = (type, inventory = owned) => inventory.some((item) => item.type === type);
  if (has("bomb") || has("pointDestroy")) return true;

  if (has("freePlacement")) {
    for (let row = 0; row < state.board.length; row += 1) {
      for (let col = 0; col < state.board[row].length; col += 1) {
        if (state.board[row][col] !== EMPTY_CELL || isWormholeCell(state, row, col)) continue;
        return true;
      }
    }
  }

  if (has("exchange")) {
    const opponent = player === "X" ? "O" : "X";
    const opponentItems = (state.inventory?.[opponent] || [])
      .filter((item) => item && RESCUE_ITEM_TYPES.has(item.type) && isItemEnabled(state, item.type));
    return opponentItems.length > 0;
  }
  return false;
}

export function finishIfNoLegalMoves(state) {
  if (!state || state.phase !== "playing" || canContinueAfterPlacement(state)) return state;
  const winner = state.currentPlayer === "X" ? "O" : "X";
  return finish(state, winner, message("message.cannotFinish", {
    player: state.currentPlayer,
    count: state.settings.piecesPerTurn
  }));
}

export function selectAbility(state, itemId) {
  if (state.phase !== "playing") return state;
  const item = getAbility(state, state.currentPlayer, itemId);
  if (!item) return state;
  if (item.type === "exchange") {
    const currentInventory = state.inventory?.[state.currentPlayer];
    const opponent = state.currentPlayer === "X" ? "O" : "X";
    const opponentInventory = state.inventory?.[opponent];
    if (!Array.isArray(currentInventory) || !Array.isArray(opponentInventory)
      || currentInventory.length > MAX_INVENTORY_ITEMS || opponentInventory.length > MAX_INVENTORY_ITEMS
      || [...currentInventory, ...opponentInventory].some((ownedItem) =>
        !ownedItem || ownedItem.type === RANDOM_ARTIFACT || !isItemEnabled(state, ownedItem.type))) return state;

    const inventory = copyInventory(state.inventory);
    if (!item.adminGranted) removeInventoryItem(inventory, state.currentPlayer, itemId);
    [inventory[state.currentPlayer], inventory[opponent]] = [inventory[opponent], inventory[state.currentPlayer]];

    const pendingExtraTurns = pendingExtraTurnQueues(state);
    [pendingExtraTurns[state.currentPlayer], pendingExtraTurns[opponent]] = [
      pendingExtraTurns[opponent], pendingExtraTurns[state.currentPlayer]
    ];
    return withPendingExtraTurnQueues({
      ...state,
      inventory,
      selectedAbility: null,
      abilityTargets: [],
      message: message("message.exchange")
    }, pendingExtraTurns);
  }
  if (item.type === "extraTurn") {
    if (!item.adminGranted) return state;
    return {
      ...state,
      piecesLeft: state.piecesLeft + state.settings.piecesPerTurn,
      message: message("message.adminExtra", { player: state.currentPlayer }),
      selectedAbility: null,
      abilityTargets: []
    };
  }
  const selectedAbility = state.selectedAbility === itemId ? null : itemId;
  const instructions = {
    bomb: "select.bomb",
    freePlacement: "select.free",
    antiBomb: "select.antiBomb",
    pointDestroy: "select.pointDestroy",
    debris: "select.debris",
    shield: "select.shield",
    gangstaShield: "select.gangstaShield"
  };
  return {
    ...state,
    selectedAbility,
    abilityTargets: [],
    message: selectedAbility === null
      ? message("message.disabled")
      : message(instructions[item.type])
  };
}

export function cancelAbilitySelection(state, player = state?.currentPlayer) {
  if (!state || state.phase !== "playing" || player !== state.currentPlayer
    || (state.selectedAbility === null && !(state.abilityTargets?.length))) return state;
  return { ...state, selectedAbility: null, abilityTargets: [] };
}

export function isValidAreaTarget(state, row, col) {
  return state.phase === "playing"
    && row >= 0 && row < state.board.length - 1
    && col >= 0 && col < state.board[0].length - 1;
}

export const isValidBombTarget = isValidAreaTarget;

function clearEventItemsAt(state, coordinates) {
  const cleared = new Set(coordinates.map(({ row, col }) => row + "," + col));
  return state.eventItems.filter((item) => !cleared.has(item.row + "," + item.col));
}

function removeProtectionsAt(state, coordinates) {
  const cleared = new Set(coordinates.map(({ row, col }) => row + "," + col));
  return state.protections.filter((protection) => !cleared.has(protection.row + "," + protection.col));
}

function clearWormholePairAt(state, coordinates) {
  const cleared = new Set(coordinates.map(({ row, col }) => row + "," + col));
  const pair = state.wormholePair;
  if (!pair || !Object.values(pair.endpoints).some(({ row, col }) => cleared.has(row + "," + col))) {
    return pair ?? null;
  }
  return null;
}

function startTurn(state, player, piecesPerTurn) {
  return {
    ...state,
    currentPlayer: player,
    turnNumber: (state.turnNumber || 0) + 1,
    piecesLeft: piecesPerTurn,
    selectedAbility: null,
    abilityTargets: [],
    protections: state.protections.filter((protection) => protection.permanent || protection.owner !== player)
  };
}

function useAreaAbility(state, itemId, row, col, type) {
  const item = getAbility(state, state.currentPlayer, itemId);
  if (state.selectedAbility !== itemId || !item || item.type !== type || !isValidAreaTarget(state, row, col)) return state;

  const board = copyBoard(state.board);
  const cleared = [];
  for (let targetRow = row; targetRow < row + 2; targetRow += 1) {
    for (let targetCol = col; targetCol < col + 2; targetCol += 1) {
      board[targetRow][targetCol] = type === "bomb" ? EMPTY_CELL : BLOCKED_CELL;
      cleared.push({ row: targetRow, col: targetCol });
    }
  }

  const inventory = copyInventory(state.inventory);
  if (!item.adminGranted) removeInventoryItem(inventory, state.currentPlayer, itemId);
  const isBomb = type === "bomb";
  const next = {
    ...state,
    board,
    inventory,
    eventItems: clearEventItemsAt(state, cleared),
    protections: removeProtectionsAt(state, cleared),
    wormholePair: clearWormholePairAt(state, cleared),
    selectedAbility: item.adminGranted ? itemId : null,
    abilityTargets: [],
    lastDestroyed: cleared,
    message: message(isBomb ? "message.bomb" : "message.antiBomb")
  };

  if (!canContinueAfterPlacement(next, state.currentPlayer)) {
    const winner = state.currentPlayer === "X" ? "O" : "X";
    return finish(next, winner, message("message.cannotFinishAbility", { player: state.currentPlayer }));
  }
  return next;
}

export function useBomb(state, itemId, row, col) {
  return useAreaAbility(state, itemId, row, col, "bomb");
}

export function useAntiBomb(state, itemId, row, col) {
  return useAreaAbility(state, itemId, row, col, "antiBomb");
}

export function isValidPointDestroyTarget(state, row, col) {
  return state.phase === "playing" && inBounds(row, col, state.board);
}

export function usePointDestroy(state, itemId, row, col) {
  const item = getAbility(state, state.currentPlayer, itemId);
  if (state.selectedAbility !== itemId || !item || item.type !== "pointDestroy"
    || !isValidPointDestroyTarget(state, row, col)) return state;

  const board = copyBoard(state.board);
  board[row][col] = EMPTY_CELL;
  const cleared = [{ row, col }];
  const inventory = copyInventory(state.inventory);
  if (!item.adminGranted) removeInventoryItem(inventory, state.currentPlayer, itemId);
  const next = {
    ...state,
    board,
    inventory,
    eventItems: clearEventItemsAt(state, cleared),
    protections: removeProtectionsAt(state, cleared),
    wormholePair: clearWormholePairAt(state, cleared),
    selectedAbility: item.adminGranted ? itemId : null,
    abilityTargets: [],
    lastDestroyed: cleared,
    message: message("message.pointDestroy")
  };

  if (!canContinueAfterPlacement(next, state.currentPlayer)) {
    const winner = state.currentPlayer === "X" ? "O" : "X";
    return finish(next, winner, message("message.cannotFinishAbility", { player: state.currentPlayer }));
  }
  return next;
}

export function isValidDebrisTarget(state, row, col) {
  return state.phase === "playing"
    && inBounds(row, col, state.board)
    && state.board[row][col] === EMPTY_CELL
    && !isWormholeCell(state, row, col)
    && !state.abilityTargets.some((target) => target.row === row && target.col === col);
}

export function isValidShieldTarget(state, row, col) {
  return state.phase === "playing"
    && inBounds(row, col, state.board)
    && (state.board[row][col] === "X" || state.board[row][col] === "O" || state.board[row][col] === EMPTY_CELL)
    && !isWormholeCell(state, row, col)
    && !isProtected(state, row, col)
    && !state.abilityTargets.some((target) => target.row === row && target.col === col);
}

export function chooseAbilityTarget(state, itemId, row, col) {
  const item = getAbility(state, state.currentPlayer, itemId);
  if (state.phase !== "playing" || state.selectedAbility !== itemId || !item) return state;

  const targetableDebris = item.type === "debris" && isValidDebrisTarget(state, row, col);
  const targetableShield = (item.type === "shield" || item.type === "gangstaShield")
    && isValidShieldTarget(state, row, col);
  if (!targetableDebris && !targetableShield) return state;

  const abilityTargets = [...state.abilityTargets, { row, col }];
  const targetCount = item.type === "gangstaShield" ? 1 : 3;
  if (abilityTargets.length < targetCount) {
    return {
      ...state,
      abilityTargets,
      message: message(targetableDebris ? "message.debrisSelected" : "message.shieldSelected", {
        count: abilityTargets.length,
        total: targetableDebris ? 3 : targetCount
      })
    };
  }

  const inventory = copyInventory(state.inventory);
  if (!item.adminGranted) removeInventoryItem(inventory, state.currentPlayer, itemId);
  if (targetableDebris) {
    const board = copyBoard(state.board);
    for (const target of abilityTargets) board[target.row][target.col] = BLOCKED_CELL;
    const next = {
      ...state,
      board,
      inventory,
      eventItems: clearEventItemsAt(state, abilityTargets),
      protections: removeProtectionsAt(state, abilityTargets),
      selectedAbility: item.adminGranted ? itemId : null,
      abilityTargets: [],
      lastDestroyed: abilityTargets,
      message: message("message.debris")
    };
    if (!canContinueAfterPlacement(next, state.currentPlayer)) {
      const winner = state.currentPlayer === "X" ? "O" : "X";
      return finish(next, winner, message("message.cannotFinishDebris", { player: state.currentPlayer }));
    }
    return next;
  }

  const protections = [
    ...state.protections,
    ...abilityTargets.map((target) => ({
      ...target,
      owner: state.currentPlayer,
      permanent: item.type === "gangstaShield"
    }))
  ];
  return {
    ...state,
    inventory,
    protections,
    selectedAbility: item.adminGranted ? itemId : null,
    abilityTargets: [],
    message: message(item.type === "gangstaShield" ? "message.gangstaShield" : "message.shield")
  };
}

export function chooseStart(state, row, col, random = Math.random) {
  if ((state.phase !== "setup-x" && state.phase !== "setup-o") || !inBounds(row, col, state.board)) return state;
  const choices = { ...state.startChoices, [state.setupPlayer]: { row, col } };

  if (state.setupPlayer === "X") {
    return {
      ...state,
      startChoices: choices,
      setupPlayer: "O",
      phase: "setup-o",
      message: message("message.startX")
    };
  }

  const xChoice = choices.X;
  const oChoice = choices.O;
  if (xChoice.row === oChoice.row && xChoice.col === oChoice.col) {
    const collisionAttempts = state.collisionAttempts + 1;
    if (collisionAttempts >= 3) {
      return beginPlay(
        { ...state, collisionAttempts, startChoices: { X: null, O: null } },
        placeInOppositeCorners(state.settings, random),
        message("message.collisionFallback"),
        random
      );
    }

    return {
      ...state,
      collisionAttempts,
      startChoices: { X: null, O: null },
      setupPlayer: "X",
      phase: "setup-x",
      message: message("message.collision", { attempt: collisionAttempts })
    };
  }

  const board = emptyBoard(state.settings.width, state.settings.height);
  board[xChoice.row][xChoice.col] = "X";
  board[oChoice.row][oChoice.col] = "O";
  return beginPlay(state, board, message("message.startAccepted"), random);
}

export function playMove(state, row, col, random = Math.random) {
  if (!isLegalMove(state, row, col)) return state;

  const player = state.currentPlayer;
  const selectedItem = getSelectedAbility(state);
  const inventory = copyInventory(state.inventory);
  const isFreePlacement = selectedItem?.type === "freePlacement";
  if (isFreePlacement && !selectedItem.adminGranted) {
    removeInventoryItem(inventory, player, selectedItem.id);
  }

  const board = copyBoard(state.board);
  board[row][col] = player;
  // Free placement changes where this turn's piece may be placed, not how many pieces the turn contains.
  const piecesLeft = state.piecesLeft - 1;
  const lastDestroyed = resolveContact(row, col, player, board, state.protections);
  const eventIndex = state.eventItems.findIndex((item) => item.row === row && item.col === col);
  const candidateItem = eventIndex >= 0 ? state.eventItems[eventIndex] : null;
  let collectedItem = candidateItem && isItemEnabled(state, candidateItem.type) ? candidateItem : null;
  let next = {
    ...state,
    board,
    inventory,
    eventItems: state.eventItems.filter((_, index) => index !== eventIndex),
    piecesLeft,
    selectedAbility: selectedItem?.type === "freePlacement" && !selectedItem.adminGranted
      ? null
      : state.selectedAbility,
    lastDestroyed,
    message: lastDestroyed.length > 0 ? message("message.destroyed", { count: lastDestroyed.length }) : []
  };

  if (collectedItem) {
    if (collectedItem.type === RANDOM_ARTIFACT) {
      const candidates = randomArtifactCandidates(next);
      if (candidates.length > 0) {
        const resultIndex = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
        collectedItem = { ...collectedItem, type: candidates[resultIndex] };
      } else {
        collectedItem = null;
      }
    }
  }

  if (collectedItem) {
    const acquired = acquireEventItem(next, player, collectedItem);
    next = { ...next, ...acquired };
    next.message = appendMessage(next.message, message("message.collected", { player, type: collectedItem.type }));
  }
  if (selectedItem && selectedItem.type === "freePlacement") {
    next.message = appendMessage(next.message, message("message.freePlacementUsed"));
  }

  if (piecesLeft > 0 && !canContinueAfterPlacement(next, player)) {
    const winner = player === "X" ? "O" : "X";
    return finish(next, winner, message("message.cannotFinish", { player, count: state.settings.piecesPerTurn }));
  }

  if (piecesLeft === 0) {
    const pendingExtraTurns = pendingExtraTurnQueues(next);
    const pendingExtraTurn = pendingExtraTurns[player][0];
    if (pendingExtraTurn !== undefined) {
      next = ageFieldItems(next);
      const nextInventory = copyInventory(next.inventory);
      removeInventoryItem(nextInventory, player, pendingExtraTurn);
      pendingExtraTurns[player].shift();
      next = {
        ...next,
        inventory: nextInventory,
        message: appendMessage(next.message, message("message.extraTurn", { player }))
      };
      next = withPendingExtraTurnQueues(next, pendingExtraTurns);
      next = startTurn(next, player, state.settings.piecesPerTurn);
      if (!canContinueAfterPlacement(next, player)) {
        const winner = player === "X" ? "O" : "X";
        return finish(next, winner, message("message.extraCannotFinish", { player }));
      }
      return maybeSpawnEventItem(next, random);
    }

    const nextPlayer = player === "X" ? "O" : "X";
    next = ageFieldItems(next);
    next = startTurn(next, nextPlayer, state.settings.piecesPerTurn);
    const completedRound = player === "O";
    const pairExpired = completedRound && Boolean(next.wormholePair && next.wormholePair.roundsRemaining <= 1);
    if (completedRound) next = advanceRound(next);
    if (!canContinueAfterPlacement(next, nextPlayer)) {
      return finish(next, player, message("message.opponentCannotFinish", { count: state.settings.piecesPerTurn }));
    }
    if (completedRound && !pairExpired) next = maybeSpawnWormholePair(next, random);
    return maybeSpawnEventItem(next, random);
  }

  return next;
}
