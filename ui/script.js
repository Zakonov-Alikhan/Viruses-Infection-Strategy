"use strict";

const BOARD_SIZE = 15;
const TURN_PIECES = 3;
const EMPTY = "";
const BLOCKED = "#";
const DIRECTIONS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];
const ORTHOGONAL = new Set(["-1,0", "1,0", "0,-1", "0,1"]);

const boardElement = document.querySelector(".game-board");
const statusElement = document.querySelector("#game-status");
const messageElement = document.querySelector("#game-message");
const turnElement = document.querySelector("#turn-counter");
const startButton = document.querySelector("#start-button");
const sideTitle = document.querySelector("#side-title");
const sideDescription = document.querySelector("#side-description");

let board;
let phase;
let currentPlayer;
let piecesLeft;
let setupPlayer;
let startChoices;
let collisionAttempts;
let lastDestroyed;

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function neighbors(row, col) {
  return DIRECTIONS
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc, dr, dc }))
    .filter(({ row: nextRow, col: nextCol }) => inBounds(nextRow, nextCol));
}

function isAdjacentToPlayer(row, col, player, sourceBoard = board) {
  return neighbors(row, col).some(({ row: nextRow, col: nextCol }) => sourceBoard[nextRow][nextCol] === player);
}

function legalMoves(player, sourceBoard = board) {
  const moves = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (sourceBoard[row][col] === EMPTY && isAdjacentToPlayer(row, col, player, sourceBoard)) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

// Check whether a player can complete the requested number of connected placements.
function canCompleteTurn(player, count, sourceBoard = board) {
  if (count <= 0) return true;
  const working = sourceBoard.map((row) => row.slice());

  function search(remaining) {
    if (remaining === 0) return true;
    const moves = legalMoves(player, working);
    for (const move of moves) {
      working[move.row][move.col] = player;
      if (search(remaining - 1)) return true;
      working[move.row][move.col] = EMPTY;
    }
    return false;
  }

  return search(count);
}

function setupGame() {
  board = emptyBoard();
  phase = "setup-x";
  currentPlayer = "X";
  piecesLeft = TURN_PIECES;
  setupPlayer = "X";
  startChoices = { X: null, O: null };
  collisionAttempts = 0;
  lastDestroyed = [];
  messageElement.textContent = "";
  render();
}

function placeInOppositeCorners() {
  board = emptyBoard();
  const diagonal = Math.random() < 0.5;
  if (diagonal) {
    board[0][0] = "X";
    board[BOARD_SIZE - 1][BOARD_SIZE - 1] = "O";
  } else {
    board[0][BOARD_SIZE - 1] = "X";
    board[BOARD_SIZE - 1][0] = "O";
  }
  beginPlay("Стартовые позиции выбраны автоматически: игроки находятся в противоположных углах.");
}

function beginPlay(message = "") {
  phase = "playing";
  currentPlayer = "X";
  piecesLeft = TURN_PIECES;
  lastDestroyed = [];
  messageElement.textContent = message;
  render();
}

function chooseStart(row, col) {
  startChoices[setupPlayer] = { row, col };
  if (setupPlayer === "X") {
    setupPlayer = "O";
    phase = "setup-o";
    messageElement.textContent = "Позиция игрока «Х» сохранена скрыто. Передайте устройство игроку «О».";
    render();
    return;
  }

  const xChoice = startChoices.X;
  const oChoice = startChoices.O;
  if (xChoice.row === oChoice.row && xChoice.col === oChoice.col) {
    collisionAttempts += 1;
    startChoices = { X: null, O: null };
    if (collisionAttempts >= 3) {
      placeInOppositeCorners();
      return;
    }
    setupPlayer = "X";
    phase = "setup-x";
    messageElement.textContent = "Была выбрана идентичная позиция. Оба игрока выбирают заново (попытка " + collisionAttempts + " из 3).";
    render();
    return;
  }

  board = emptyBoard();
  board[xChoice.row][xChoice.col] = "X";
  board[oChoice.row][oChoice.col] = "O";
  beginPlay("Стартовые позиции приняты. Первый ход делает игрок «Х».");
}

function resolveContact(row, col, player) {
  const enemy = player === "X" ? "O" : "X";
  const touching = neighbors(row, col)
    .filter(({ row: nextRow, col: nextCol }) => board[nextRow][nextCol] === enemy)
    .sort((a, b) => Number(ORTHOGONAL.has(b.dr + "," + b.dc)) - Number(ORTHOGONAL.has(a.dr + "," + a.dc)));

  if (touching.length === 0) return [];

  // Only enemy figures in the directly touched figure's first neighboring layer are removed.
  const affected = new Map();
  for (const target of touching) {
    const key = target.row + "," + target.col;
    affected.set(key, target);
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

function finishGame(winner, reason) {
  phase = "finished";
  messageElement.textContent = "Игрок «" + winner + "» победил! " + reason;
  render();
}

function handleMove(row, col) {
  if (phase !== "playing" || board[row][col] !== EMPTY || !isAdjacentToPlayer(row, col, currentPlayer)) return;

  board[row][col] = currentPlayer;
  piecesLeft -= 1;
  lastDestroyed = resolveContact(row, col, currentPlayer);
  if (lastDestroyed.length > 0) {
    messageElement.textContent = "Цепная реакция: уничтожено фигур противника — " + lastDestroyed.length + ". Освобождённые клетки заблокированы.";
  } else {
    messageElement.textContent = "";
  }

  if (piecesLeft > 0 && !canCompleteTurn(currentPlayer, piecesLeft)) {
    finishGame(currentPlayer === "X" ? "O" : "X", "Игрок «" + currentPlayer + "» не смог поставить все три фигуры за ход.");
    return;
  }

  if (piecesLeft === 0) {
    const previousPlayer = currentPlayer;
    const nextPlayer = currentPlayer === "X" ? "O" : "X";
    if (!canCompleteTurn(nextPlayer, TURN_PIECES)) {
      finishGame(previousPlayer, "Соперник не может разместить три фигуры за ход.");
      return;
    }
    currentPlayer = nextPlayer;
    piecesLeft = TURN_PIECES;
  }

  render();
}

function render() {
  if (!board) board = emptyBoard();
  boardElement.innerHTML = "";
  boardElement.style.setProperty("--board-size", BOARD_SIZE);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const value = board[row][col];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", "Ряд " + (row + 1) + ", столбец " + (col + 1) + (value === EMPTY ? ", пусто" : value === BLOCKED ? ", заблокировано" : ", игрок " + value));

      if (value === "X" || value === "O") {
        cell.textContent = value;
        cell.classList.add("piece", value === "X" ? "piece-x" : "piece-o");
      } else if (value === BLOCKED) {
        cell.textContent = "×";
        cell.classList.add("blocked");
        cell.disabled = true;
      } else if (phase === "playing" && isAdjacentToPlayer(row, col, currentPlayer)) {
        cell.classList.add("legal");
        cell.addEventListener("click", () => handleMove(row, col));
      } else if (phase === "setup-x" || phase === "setup-o") {
        cell.addEventListener("click", () => chooseStart(row, col));
      } else {
        cell.disabled = true;
      }

      if (lastDestroyed.some((destroyed) => destroyed.row === row && destroyed.col === col)) {
        cell.classList.add("just-destroyed");
      }
      boardElement.appendChild(cell);
    }
  }

  if (phase === "setup-x") {
    statusElement.textContent = "Игрок «Х»: выберите стартовую клетку";
    turnElement.textContent = "Подготовка к игре";
    sideTitle.textContent = "Игрок X выбирает";
    sideDescription.textContent = "Нажмите любую клетку, чтобы тайно выбрать стартовую позицию.";
  } else if (phase === "setup-o") {
    statusElement.textContent = "Игрок «О»: выберите стартовую клетку";
    turnElement.textContent = "Выбор позиций скрыт";
    sideTitle.textContent = "Игрок O выбирает";
    sideDescription.textContent = "Позиция X скрыта. Игрок O выбирает свою стартовую клетку.";
  } else if (phase === "playing") {
    statusElement.textContent = "Ход игрока «" + currentPlayer + "»";
    turnElement.textContent = "Осталось поставить фигур: " + piecesLeft + " из " + TURN_PIECES;
    sideTitle.textContent = "Ход игрока " + currentPlayer;
    sideDescription.textContent = "Поставьте три фигуры. Каждая должна соединяться с вашей цепочкой.";
  } else {
    statusElement.textContent = "Игра завершена";
    turnElement.textContent = "Нажмите «Новая игра», чтобы сыграть ещё раз";
    sideTitle.textContent = "Партия завершена";
    sideDescription.textContent = "Начните новую игру, чтобы выбрать стартовые позиции.";
  }
}

startButton.addEventListener("click", setupGame);
setupGame();
