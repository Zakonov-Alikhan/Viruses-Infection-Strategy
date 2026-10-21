export const MAX_HISTORY_ENTRIES = 160;

const ITEM_BY_MESSAGE = Object.freeze({
  "message.bomb": "bomb",
  "message.antiBomb": "antiBomb",
  "message.pointDestroy": "pointDestroy",
  "message.debris": "debris",
  "message.shield": "shield",
  "message.gangstaShield": "gangstaShield",
  "message.exchange": "exchange"
});

function messageList(value) {
  if (Array.isArray(value)) return value.flatMap(messageList);
  return value && typeof value === "object" && typeof value.key === "string" ? [value] : [];
}

function cellCode(value) {
  if (value === "X" || value === "O" || value === "#") return value;
  return ".";
}

export function createHistoryPosition(state) {
  return {
    board: state.board.map((row) => row.map(cellCode).join("")),
    settings: {
      width: state.settings.width,
      height: state.settings.height,
      piecesPerTurn: state.settings.piecesPerTurn,
      animationsEnabled: Boolean(state.settings.animationsEnabled),
      freeStartingPositions: Boolean(state.settings.freeStartingPositions)
    },
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    piecesLeft: state.piecesLeft,
    roundNumber: state.roundNumber ?? 1,
    turnNumber: state.turnNumber ?? 0,
    lastDestroyed: (state.lastDestroyed || []).map(({ row, col }) => ({ row, col })),
    eventItems: (state.eventItems || []).map(({ id, type, row, col }) => ({ id, type, row, col })),
    protections: (state.protections || []).map(({ row, col, owner, permanent }) => ({ row, col, owner, permanent })),
    wormholePair: state.wormholePair ? {
      id: state.wormholePair.id,
      endpoints: {
        orange: { ...state.wormholePair.endpoints.orange },
        blue: { ...state.wormholePair.endpoints.blue }
      },
      roundsRemaining: state.wormholePair.roundsRemaining
    } : null,
    inventory: {
      X: (state.inventory?.X || []).map(({ id, type }) => ({ id, type })),
      O: (state.inventory?.O || []).map(({ id, type }) => ({ id, type }))
    },
    winner: state.winner ?? null,
    finishReason: state.finishReason ? structuredClone(state.finishReason) : null,
    message: structuredClone(state.message || [])
  };
}

export function restoreHistoryPosition(position) {
  if (!position || !Array.isArray(position.board) || !position.settings) return null;
  return {
    ...position,
    board: position.board.map((row) => [...row].map((cell) => cell === "." ? "" : cell)),
    startChoices: { X: null, O: null },
    selectedAbility: null,
    abilityTargets: [],
    settings: { ...position.settings },
    lastDestroyed: (position.lastDestroyed || []).map((cell) => ({ ...cell })),
    eventItems: (position.eventItems || []).map((item) => ({ ...item })),
    protections: (position.protections || []).map((protection) => ({ ...protection })),
    inventory: {
      X: (position.inventory?.X || []).map((item) => ({ ...item })),
      O: (position.inventory?.O || []).map((item) => ({ ...item }))
    }
  };
}

function locateNewPiece(previous, next, side) {
  if (!previous?.board || !next?.board) return null;
  for (let row = 0; row < next.board.length; row += 1) {
    for (let col = 0; col < next.board[row].length; col += 1) {
      if (next.board[row][col] === side && previous.board[row]?.[col] !== side) return { row, col };
    }
  }
  return null;
}

function selectedItemType(state, side) {
  const id = state?.selectedAbility;
  if (id === null || id === undefined) return null;
  const item = state.inventory?.[side]?.find(({ id: itemId }) => itemId === id);
  if (item) return item.type;
  return typeof id === "string" && id.startsWith("admin:") ? id.slice("admin:".length) : null;
}

function describeAction(previous, next, command, side) {
  if (previous?.phase !== "playing" && next.phase === "playing") {
    return { type: "start", side: null, coordinates: [] };
  }
  if (command?.type === "place") {
    return {
      type: "placement", side,
      coordinates: [{ row: command.row, col: command.col }],
      itemType: selectedItemType(previous, side)
    };
  }
  if (command?.type === "board-edit") {
    return {
      type: "board-edit", side,
      coordinates: [{ row: command.object.row, col: command.object.col }],
      itemType: command.object.kind === "item" ? command.object.itemType : null
    };
  }
  if (command?.type === "resign" || command?.type === "timeout") {
    return { type: command.type, side, coordinates: [] };
  }

  const messages = messageList(next.message);
  const actionMessage = messages.find(({ key }) => ITEM_BY_MESSAGE[key]);
  if (command?.type === "ability-target") {
    const changed = previous.board !== next.board
      || previous.protections !== next.protections
      || previous.inventory?.[side] !== next.inventory?.[side];
    if (!changed) return null;
    const coordinates = [...(previous.abilityTargets || []), { row: command.row, col: command.col }];
    return {
      type: "ability", side,
      itemType: selectedItemType(previous, side) || ITEM_BY_MESSAGE[actionMessage?.key],
      coordinates
    };
  }
  if (command?.type === "select-ability" && actionMessage?.key === "message.exchange") {
    return { type: "ability", side, itemType: "exchange", coordinates: [] };
  }
  if (command?.type === "select-ability" && messages.some(({ key }) => key === "message.adminExtra")) {
    return { type: "ability", side, itemType: "extraTurn", coordinates: [] };
  }
  if (command) return null;

  if (next.phase === "finished" && next.phase !== previous?.phase) {
    const finishKey = messageList(next.finishReason)[0]?.key || next.finishReason?.key;
    if (finishKey === "message.resigned") return { type: "resign", side: previous.currentPlayer, coordinates: [] };
    if (finishKey === "message.timeUp") return { type: "timeout", side: previous.currentPlayer, coordinates: [] };
  }

  const placed = locateNewPiece(previous, next, previous?.currentPlayer);
  if (placed) return {
    type: "placement", side: previous.currentPlayer,
    coordinates: [placed],
    itemType: selectedItemType(previous, previous.currentPlayer)
  };
  if (actionMessage) return {
    type: "ability", side: previous.currentPlayer,
    itemType: ITEM_BY_MESSAGE[actionMessage.key],
    coordinates: (next.lastDestroyed || []).slice(0, 4).map(({ row, col }) => ({ row, col }))
  };
  if (previous?.phase === "playing" && next.board !== previous.board) {
    return { type: "board-edit", side: previous.currentPlayer, coordinates: [], itemType: null };
  }
  return null;
}

export function createHistoryEntry(previous, next, id, { command = null, side = null } = {}) {
  if (!next || next === previous || next.phase === "setup-x" || next.phase === "setup-o") return null;
  const action = describeAction(previous, next, command, side || previous?.currentPlayer || null);
  if (!action) return null;
  const isStart = action.type === "start";
  return {
    id,
    side: action.side,
    roundNumber: isStart ? next.roundNumber ?? 1 : previous?.roundNumber ?? next.roundNumber ?? 1,
    turnNumber: isStart ? next.turnNumber ?? 1 : previous?.turnNumber ?? next.turnNumber ?? 1,
    type: action.type,
    coordinates: action.coordinates,
    itemType: action.itemType ?? null,
    result: structuredClone(next.message || []),
    position: createHistoryPosition(next)
  };
}

export function createUndoHistoryEntry(state, id, { side, turnNumber } = {}) {
  if (!state || state.phase !== "playing") return null;
  return {
    id,
    side,
    roundNumber: state.roundNumber ?? 1,
    turnNumber: turnNumber ?? state.turnNumber ?? 1,
    type: "undo",
    coordinates: [],
    itemType: null,
    result: [{ key: "history.undoResult", params: { side, turn: turnNumber ?? state.turnNumber ?? 1 } }],
    position: createHistoryPosition(state)
  };
}

export function appendHistoryEntry(entries, entry, limit = MAX_HISTORY_ENTRIES) {
  if (!entry || entries.some(({ id }) => id === entry.id)) return entries;
  return [...entries, entry].slice(-limit);
}
