export const MIN_BOARD_DIMENSION = 10;
export const MAX_BOARD_DIMENSION = 50;
export const DEFAULT_SETTINGS = Object.freeze({
  width: 15,
  height: 15,
  piecesPerTurn: 3,
  clockMinutes: 5,
  incrementSeconds: 0,
  unlimitedTime: false,
  randomEvents: false,
  freeStartingPositions: true
});
export const EMPTY_CELL = "";
export const BLOCKED_CELL = "#";
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];
const ORTHOGONAL = new Set(["-1,0", "1,0", "0,-1", "0,1"]);
export const EVENT_ITEMS = Object.freeze([
  "bomb", "freePlacement", "extraTurn", "antiBomb", "debris", "shield", "gangstaShield"
]);
const EVENT_SPAWN_CHANCE = 0.3;
const MAX_EVENT_ITEMS_ON_BOARD = 3;
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

function hasEnoughConnectedCells(player, count, board) {
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

function appendMessage(current, addition) {
  return [current, addition].filter(Boolean).join(" ");
}

const EVENT_ITEM_NAMES = Object.freeze({
  bomb: "Бомба",
  freePlacement: "Свободное расположение",
  extraTurn: "Дополнительный ход",
  antiBomb: "Анти-бомба",
  debris: "Призыв обломков",
  shield: "Щит",
  gangstaShield: "Генгста-Щит"
});

function spawnEventItem(state, random, guaranteed = false) {
  if (!state.settings.randomEvents || state.eventItems.length >= MAX_EVENT_ITEMS_ON_BOARD) return state;
  if (!guaranteed && random() >= EVENT_SPAWN_CHANCE) return state;

  const occupiedByEvent = new Set(state.eventItems.map((item) => item.row + "," + item.col));
  const available = [];
  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board[row].length; col += 1) {
      if (state.board[row][col] === EMPTY_CELL && !occupiedByEvent.has(row + "," + col)) {
        available.push({ row, col });
      }
    }
  }
  if (available.length === 0) return state;

  const location = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  const type = EVENT_ITEMS[Math.min(EVENT_ITEMS.length - 1, Math.floor(random() * EVENT_ITEMS.length))];
  const eventItem = { id: state.nextEventItemId, type, ...location };
  return {
    ...state,
    eventItems: [...state.eventItems, eventItem],
    nextEventItemId: state.nextEventItemId + 1,
    message: appendMessage(state.message, "На поле появился предмет «" + EVENT_ITEM_NAMES[type] + "».")
  };
}

function maybeSpawnEventItem(state, random) {
  return state.phase === "playing" ? spawnEventItem(state, random) : state;
}

function copyInventory(inventory) {
  return { X: inventory.X.slice(), O: inventory.O.slice() };
}

function removeInventoryItem(inventory, player, itemId) {
  const index = inventory[player].findIndex((item) => item.id === itemId);
  if (index >= 0) inventory[player].splice(index, 1);
}

function acquireEventItem(state, player, eventItem) {
  const inventory = copyInventory(state.inventory);
  if (inventory[player].length >= MAX_INVENTORY_ITEMS) {
    const removableIndex = inventory[player].findIndex((item) => item.id !== state.pendingExtraTurn);
    const [replaced] = inventory[player].splice(removableIndex < 0 ? 0 : removableIndex, 1);
    return {
      inventory: { ...inventory, [player]: [...inventory[player], eventItem] },
      selectedAbility: state.selectedAbility === replaced.id ? null : state.selectedAbility,
      pendingExtraTurn: eventItem.type === "extraTurn"
        ? eventItem.id
        : state.pendingExtraTurn === replaced.id ? null : state.pendingExtraTurn
    };
  }
  return {
    inventory: { ...inventory, [player]: [...inventory[player], eventItem] },
    selectedAbility: state.selectedAbility,
    pendingExtraTurn: eventItem.type === "extraTurn" ? eventItem.id : state.pendingExtraTurn
  };
}

export function resign(state) {
  if (state.phase !== "playing") return state;
  const winner = state.currentPlayer === "X" ? "O" : "X";
  return finish(state, winner, "Игрок «" + state.currentPlayer + "» сдался.");
}

export function flagFall(state) {
  if (state.phase !== "playing") return state;
  const winner = state.currentPlayer === "X" ? "O" : "X";
  return finish(state, winner, "У игрока «" + state.currentPlayer + "» закончилось время.");
}

function beginPlay(state, board, message, random) {
  const playingState = {
    ...state,
    board,
    phase: "playing",
    currentPlayer: "X",
    piecesLeft: state.settings.piecesPerTurn,
    lastDestroyed: [],
    message
  };
  return spawnEventItem(playingState, random, true);
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
  const appliedSettings = { ...settings };
  const state = {
    board: emptyBoard(appliedSettings.width, appliedSettings.height),
    settings: appliedSettings,
    phase: "setup-x",
    currentPlayer: "X",
    piecesLeft: appliedSettings.piecesPerTurn,
    setupPlayer: "X",
    startChoices: { X: null, O: null },
    collisionAttempts: 0,
    lastDestroyed: [],
    eventItems: [],
    nextEventItemId: 1,
    inventory: { X: [], O: [] },
    selectedAbility: null,
    abilityTargets: [],
    protections: [],
    pendingExtraTurn: null,
    message: "",
    winner: null,
    finishReason: ""
  };

  if (!appliedSettings.freeStartingPositions) {
    return beginPlay(
      state,
      placeInOppositeCorners(appliedSettings, random),
      "Свободное расположение отключено. Игроки размещены в противоположных углах. Первый ход делает игрок «Х».",
      random
    );
  }

  return state;
}

export function isLegalMove(state, row, col) {
  if (state.phase !== "playing" || !inBounds(row, col, state.board) || state.board[row][col] !== EMPTY_CELL) return false;
  const selected = state.inventory[state.currentPlayer].find((item) => item.id === state.selectedAbility);
  if (selected) return selected.type === "freePlacement";
  return neighbors(row, col, state.board).some(({ row: nextRow, col: nextCol }) => state.board[nextRow][nextCol] === state.currentPlayer);
}

export function selectAbility(state, itemId) {
  if (state.phase !== "playing") return state;
  const item = state.inventory[state.currentPlayer].find((candidate) => candidate.id === itemId);
  if (!item || item.type === "extraTurn") return state;
  const selectedAbility = state.selectedAbility === itemId ? null : itemId;
  const instructions = {
    bomb: "Выберите верхнюю левую клетку области 2×2 для бомбы.",
    freePlacement: "Выберите любую пустую клетку для дополнительной фигуры.",
    antiBomb: "Выберите верхнюю левую клетку области 2×2 для анти-бомбы.",
    debris: "Выберите три клетки без фигур, чтобы завалить их обломками.",
    shield: "Выберите три свои фигуры для временной защиты.",
    gangstaShield: "Выберите свою фигуру для постоянной защиты."
  };
  return {
    ...state,
    selectedAbility,
    abilityTargets: [],
    message: selectedAbility === null
      ? "Способность отключена."
      : instructions[item.type]
  };
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

function startTurn(state, player, piecesPerTurn) {
  return {
    ...state,
    currentPlayer: player,
    piecesLeft: piecesPerTurn,
    selectedAbility: null,
    abilityTargets: [],
    protections: state.protections.filter((protection) => protection.permanent || protection.owner !== player)
  };
}

function useAreaAbility(state, itemId, row, col, type) {
  const item = state.inventory[state.currentPlayer].find((candidate) => candidate.id === itemId);
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
  removeInventoryItem(inventory, state.currentPlayer, itemId);
  const isBomb = type === "bomb";
  const next = {
    ...state,
    board,
    inventory,
    eventItems: clearEventItemsAt(state, cleared),
    protections: removeProtectionsAt(state, cleared),
    selectedAbility: null,
    abilityTargets: [],
    lastDestroyed: cleared,
    message: isBomb
      ? "Бомба очистила область 2×2. Все четыре клетки снова доступны."
      : "Анти-бомба загрязнила область 2×2: фигуры уничтожены, клетки заблокированы."
  };

  if (!hasEnoughConnectedCells(state.currentPlayer, state.piecesLeft, board)) {
    const winner = state.currentPlayer === "X" ? "O" : "X";
    return finish(next, winner, "После применения способности игрок «" + state.currentPlayer + "» не смог завершить свой ход.");
  }
  return next;
}

export function useBomb(state, itemId, row, col) {
  return useAreaAbility(state, itemId, row, col, "bomb");
}

export function useAntiBomb(state, itemId, row, col) {
  return useAreaAbility(state, itemId, row, col, "antiBomb");
}

export function isValidDebrisTarget(state, row, col) {
  return state.phase === "playing"
    && inBounds(row, col, state.board)
    && state.board[row][col] !== "X"
    && state.board[row][col] !== "O"
    && !state.abilityTargets.some((target) => target.row === row && target.col === col);
}

export function isValidShieldTarget(state, row, col) {
  return state.phase === "playing"
    && inBounds(row, col, state.board)
    && state.board[row][col] === state.currentPlayer
    && !isProtected(state, row, col)
    && !state.abilityTargets.some((target) => target.row === row && target.col === col);
}

export function chooseAbilityTarget(state, itemId, row, col) {
  const item = state.inventory[state.currentPlayer].find((candidate) => candidate.id === itemId);
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
      message: targetableDebris
        ? "Выбрано клеток под обломки: " + abilityTargets.length + " из 3."
        : "Выбрано фигур под защиту: " + abilityTargets.length + " из " + targetCount + "."
    };
  }

  const inventory = copyInventory(state.inventory);
  removeInventoryItem(inventory, state.currentPlayer, itemId);
  if (targetableDebris) {
    const board = copyBoard(state.board);
    for (const target of abilityTargets) board[target.row][target.col] = BLOCKED_CELL;
    const next = {
      ...state,
      board,
      inventory,
      eventItems: clearEventItemsAt(state, abilityTargets),
      protections: removeProtectionsAt(state, abilityTargets),
      selectedAbility: null,
      abilityTargets: [],
      lastDestroyed: abilityTargets,
      message: "Обломки заблокировали три выбранные клетки. Ход не расходуется."
    };
    if (!hasEnoughConnectedCells(state.currentPlayer, state.piecesLeft, board)) {
      const winner = state.currentPlayer === "X" ? "O" : "X";
      return finish(next, winner, "После призыва обломков игрок «" + state.currentPlayer + "» не смог завершить свой ход.");
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
    selectedAbility: null,
    abilityTargets: [],
    message: item.type === "gangstaShield"
      ? "Генгста-Щит будет защищать выбранную фигуру до конца партии."
      : "Щит защитит выбранные фигуры до начала вашего следующего хода."
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
      message: "Позиция игрока «Х» сохранена скрыто. Передайте устройство игроку «О»."
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
        "Была выбрана идентичная позиция три раза подряд. Игроки размещены в противоположных углах.",
        random
      );
    }

    return {
      ...state,
      collisionAttempts,
      startChoices: { X: null, O: null },
      setupPlayer: "X",
      phase: "setup-x",
      message: "Была выбрана идентичная позиция. Оба игрока выбирают заново (попытка " + collisionAttempts + " из 3)."
    };
  }

  const board = emptyBoard(state.settings.width, state.settings.height);
  board[xChoice.row][xChoice.col] = "X";
  board[oChoice.row][oChoice.col] = "O";
  return beginPlay(state, board, "Стартовые позиции приняты. Первый ход делает игрок «Х».", random);
}

export function playMove(state, row, col, random = Math.random) {
  if (!isLegalMove(state, row, col)) return state;

  const player = state.currentPlayer;
  const selectedItem = state.inventory[player].find((item) => item.id === state.selectedAbility);
  const inventory = copyInventory(state.inventory);
  const isFreePlacement = selectedItem && selectedItem.type === "freePlacement";
  if (isFreePlacement) {
    removeInventoryItem(inventory, player, selectedItem.id);
  }

  const board = copyBoard(state.board);
  board[row][col] = player;
  const piecesLeft = isFreePlacement ? state.piecesLeft : state.piecesLeft - 1;
  const lastDestroyed = resolveContact(row, col, player, board, state.protections);
  const eventIndex = state.eventItems.findIndex((item) => item.row === row && item.col === col);
  const collectedItem = eventIndex >= 0 ? state.eventItems[eventIndex] : null;
  let next = {
    ...state,
    board,
    inventory,
    eventItems: state.eventItems.filter((_, index) => index !== eventIndex),
    piecesLeft,
    selectedAbility: selectedItem && selectedItem.type === "freePlacement" ? null : state.selectedAbility,
    lastDestroyed,
    message: lastDestroyed.length > 0
      ? "Цепная реакция: уничтожено фигур противника — " + lastDestroyed.length + ". Освобождённые клетки заблокированы."
      : ""
  };

  if (collectedItem) {
    const acquired = acquireEventItem(next, player, collectedItem);
    next = { ...next, ...acquired };
    next.message = appendMessage(next.message, "Игрок «" + player + "» получил способность «" + EVENT_ITEM_NAMES[collectedItem.type] + "».");
  }
  if (selectedItem && selectedItem.type === "freePlacement") {
    next.message = appendMessage(next.message, "Дополнительная фигура размещена без ограничения по расстоянию; число фигур хода не изменилось.");
  }

  if (piecesLeft > 0 && !hasEnoughConnectedCells(player, piecesLeft, board)) {
    const winner = player === "X" ? "O" : "X";
    return finish(next, winner, "Игрок «" + player + "» не смог завершить ход из " + state.settings.piecesPerTurn + " фигур.");
  }

  if (piecesLeft === 0) {
    const pendingExtraTurn = next.pendingExtraTurn;
    if (pendingExtraTurn !== null && next.inventory[player].some((item) => item.id === pendingExtraTurn)) {
      const nextInventory = copyInventory(next.inventory);
      removeInventoryItem(nextInventory, player, pendingExtraTurn);
      next = {
        ...next,
        inventory: nextInventory,
        pendingExtraTurn: null,
        message: appendMessage(next.message, "Дополнительный ход игрока «" + player + "» начинается сразу.")
      };
      next = startTurn(next, player, state.settings.piecesPerTurn);
      if (!hasEnoughConnectedCells(player, state.settings.piecesPerTurn, board)) {
        const winner = player === "X" ? "O" : "X";
        return finish(next, winner, "Игрок «" + player + "» не смог завершить дополнительный ход.");
      }
      return maybeSpawnEventItem(next, random);
    }

    const nextPlayer = player === "X" ? "O" : "X";
    if (!hasEnoughConnectedCells(nextPlayer, state.settings.piecesPerTurn, board)) {
      return finish(next, player, "Соперник не может завершить ход из " + state.settings.piecesPerTurn + " фигур.");
    }
    next = startTurn(next, nextPlayer, state.settings.piecesPerTurn);
    return maybeSpawnEventItem(next, random);
  }

  return next;
}
