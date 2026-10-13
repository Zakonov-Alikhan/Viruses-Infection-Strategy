export const MIN_BOARD_DIMENSION = 10;
export const MAX_BOARD_DIMENSION = 50;
export const DEFAULT_SETTINGS = Object.freeze({
  width: 15,
  height: 15,
  piecesPerTurn: 3,
  clockMinutes: 5,
  incrementSeconds: 0,
  unlimitedTime: false,
  freeStartingPositions: true
});
export const EMPTY_CELL = "";
export const BLOCKED_CELL = "#";
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];
const ORTHOGONAL = new Set(["-1,0", "1,0", "0,-1", "0,1"]);

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

function resolveContact(row, col, player, board) {
  const enemy = player === "X" ? "O" : "X";
  const touching = neighbors(row, col, board)
    .filter(({ row: nextRow, col: nextCol }) => board[nextRow][nextCol] === enemy)
    .sort((a, b) => Number(ORTHOGONAL.has(b.dr + "," + b.dc)) - Number(ORTHOGONAL.has(a.dr + "," + a.dc)));

  if (touching.length === 0) return [];

  const affected = new Map();
  for (const target of touching) {
    affected.set(target.row + "," + target.col, target);
    for (const adjacent of neighbors(target.row, target.col, board)) {
      if (board[adjacent.row][adjacent.col] === enemy) {
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

function beginPlay(state, board, message) {
  return {
    ...state,
    board,
    phase: "playing",
    currentPlayer: "X",
    piecesLeft: state.settings.piecesPerTurn,
    lastDestroyed: [],
    message
  };
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
    message: "",
    winner: null,
    finishReason: ""
  };

  if (!appliedSettings.freeStartingPositions) {
    return beginPlay(
      state,
      placeInOppositeCorners(appliedSettings, random),
      "Свободное расположение отключено. Игроки размещены в противоположных углах. Первый ход делает игрок «Х»."
    );
  }

  return state;
}

export function isLegalMove(state, row, col) {
  if (state.phase !== "playing" || !inBounds(row, col, state.board) || state.board[row][col] !== EMPTY_CELL) return false;
  return neighbors(row, col, state.board).some(({ row: nextRow, col: nextCol }) => state.board[nextRow][nextCol] === state.currentPlayer);
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
        "Была выбрана идентичная позиция три раза подряд. Игроки размещены в противоположных углах."
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
  return beginPlay(state, board, "Стартовые позиции приняты. Первый ход делает игрок «Х».");
}

export function playMove(state, row, col) {
  if (!isLegalMove(state, row, col)) return state;

  const board = copyBoard(state.board);
  board[row][col] = state.currentPlayer;
  const piecesLeft = state.piecesLeft - 1;
  const lastDestroyed = resolveContact(row, col, state.currentPlayer, board);
  let next = {
    ...state,
    board,
    piecesLeft,
    lastDestroyed,
    message: lastDestroyed.length > 0
      ? "Цепная реакция: уничтожено фигур противника — " + lastDestroyed.length + ". Освобождённые клетки заблокированы."
      : ""
  };

  if (piecesLeft > 0 && !hasEnoughConnectedCells(state.currentPlayer, piecesLeft, board)) {
    const winner = state.currentPlayer === "X" ? "O" : "X";
    return finish(next, winner, "Игрок «" + state.currentPlayer + "» не смог завершить ход из " + state.settings.piecesPerTurn + " фигур.");
  }

  if (piecesLeft === 0) {
    const nextPlayer = state.currentPlayer === "X" ? "O" : "X";
    if (!hasEnoughConnectedCells(nextPlayer, state.settings.piecesPerTurn, board)) {
      return finish(next, state.currentPlayer, "Соперник не может завершить ход из " + state.settings.piecesPerTurn + " фигур.");
    }
    next = { ...next, currentPlayer: nextPlayer, piecesLeft: state.settings.piecesPerTurn };
  }

  return next;
}
