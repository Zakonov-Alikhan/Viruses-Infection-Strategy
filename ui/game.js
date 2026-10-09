export const BOARD_SIZE = 15;
export const TURN_PIECES = 3;
const EMPTY = "";
const BLOCKED = "#";
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];
const ORTHOGONAL = new Set(["-1,0", "1,0", "0,-1", "0,1"]);

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function copyBoard(board) {
  return board.map((row) => row.slice());
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function neighbors(row, col) {
  return DIRECTIONS
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc, dr, dc }))
    .filter(({ row: nextRow, col: nextCol }) => inBounds(nextRow, nextCol));
}

function legalMoves(player, board) {
  const moves = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === EMPTY && neighbors(row, col).some(({ row: nextRow, col: nextCol }) => board[nextRow][nextCol] === player)) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

function canCompleteTurn(player, count, board) {
  if (count <= 0) return true;
  const working = copyBoard(board);

  function search(remaining) {
    if (remaining === 0) return true;
    for (const move of legalMoves(player, working)) {
      working[move.row][move.col] = player;
      if (search(remaining - 1)) return true;
      working[move.row][move.col] = EMPTY;
    }
    return false;
  }

  return search(count);
}

function resolveContact(row, col, player, board) {
  const enemy = player === "X" ? "O" : "X";
  const touching = neighbors(row, col)
    .filter(({ row: nextRow, col: nextCol }) => board[nextRow][nextCol] === enemy)
    .sort((a, b) => Number(ORTHOGONAL.has(b.dr + "," + b.dc)) - Number(ORTHOGONAL.has(a.dr + "," + a.dc)));

  if (touching.length === 0) return [];

  const affected = new Map();
  for (const target of touching) {
    affected.set(target.row + "," + target.col, target);
    for (const adjacent of neighbors(target.row, target.col)) {
      if (board[adjacent.row][adjacent.col] === enemy) {
        affected.set(adjacent.row + "," + adjacent.col, adjacent);
      }
    }
  }

  const destroyed = Array.from(affected.values());
  for (const cell of destroyed) board[cell.row][cell.col] = BLOCKED;
  return destroyed;
}

function finish(state, winner, reason) {
  return { ...state, phase: "finished", winner, finishReason: reason };
}

function beginPlay(state, board, message) {
  return {
    ...state,
    board,
    phase: "playing",
    currentPlayer: "X",
    piecesLeft: TURN_PIECES,
    lastDestroyed: [],
    message
  };
}

export function createGameState() {
  return {
    board: emptyBoard(),
    phase: "setup-x",
    currentPlayer: "X",
    piecesLeft: TURN_PIECES,
    setupPlayer: "X",
    startChoices: { X: null, O: null },
    collisionAttempts: 0,
    lastDestroyed: [],
    message: "",
    winner: null,
    finishReason: ""
  };
}

export function isLegalMove(state, row, col) {
  if (state.phase !== "playing" || !inBounds(row, col) || state.board[row][col] !== EMPTY) return false;
  return neighbors(row, col).some(({ row: nextRow, col: nextCol }) => state.board[nextRow][nextCol] === state.currentPlayer);
}

export function chooseStart(state, row, col, random = Math.random) {
  if ((state.phase !== "setup-x" && state.phase !== "setup-o") || !inBounds(row, col)) return state;
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
      const board = emptyBoard();
      if (random() < 0.5) {
        board[0][0] = "X";
        board[BOARD_SIZE - 1][BOARD_SIZE - 1] = "O";
      } else {
        board[0][BOARD_SIZE - 1] = "X";
        board[BOARD_SIZE - 1][0] = "O";
      }
      return beginPlay(
        { ...state, collisionAttempts, startChoices: { X: null, O: null } },
        board,
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

  const board = emptyBoard();
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

  if (piecesLeft > 0 && !canCompleteTurn(state.currentPlayer, piecesLeft, board)) {
    const winner = state.currentPlayer === "X" ? "O" : "X";
    return finish(next, winner, "Игрок «" + state.currentPlayer + "» не смог поставить все три фигуры за ход.");
  }

  if (piecesLeft === 0) {
    const nextPlayer = state.currentPlayer === "X" ? "O" : "X";
    if (!canCompleteTurn(nextPlayer, TURN_PIECES, board)) {
      return finish(next, state.currentPlayer, "Соперник не может разместить три фигуры за ход.");
    }
    next = { ...next, currentPlayer: nextPlayer, piecesLeft: TURN_PIECES };
  }

  return next;
}