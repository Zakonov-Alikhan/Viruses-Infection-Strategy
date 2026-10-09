import { BOARD_SIZE, TURN_PIECES, chooseStart, createGameState, isLegalMove, playMove } from "./game.js";

const boardElement = document.querySelector(".game-board");
const statusElement = document.querySelector("#game-status");
const messageElement = document.querySelector("#game-message");
const turnElement = document.querySelector("#turn-counter");
const startButton = document.querySelector("#start-button");
const sideTitle = document.querySelector("#side-title");
const sideDescription = document.querySelector("#side-description");
const resultModal = document.querySelector("#result-modal");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const resultRoast = document.querySelector("#result-roast");
const resultNewGameButton = document.querySelector("#result-new-game");

let state;

function setupGame() {
  if (resultModal.open) resultModal.close();
  state = createGameState();
  render();
}

function updateState(nextState) {
  const gameJustEnded = state.phase !== "finished" && nextState.phase === "finished";
  state = nextState;
  render();
  if (gameJustEnded) showResult();
}

function showResult() {
  const loser = state.winner === "X" ? "O" : "X";
  messageElement.textContent = "Победил игрок «" + state.winner + "». " + state.finishReason;
  resultTitle.textContent = "Победа игрока «" + state.winner + "»!";
  resultDescription.textContent = "Поздравляем! Твоя цепочка выдержала битву. " + state.finishReason;
  resultRoast.textContent = "Игрок «" + loser + "», клетки закончились быстрее твоих идей. Пора тренироваться и возвращаться за реваншем!";
  resultModal.showModal();
  resultNewGameButton.focus();
}

function render() {
  boardElement.innerHTML = "";
  boardElement.style.setProperty("--board-size", BOARD_SIZE);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const value = state.board[row][col];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", "Ряд " + (row + 1) + ", столбец " + (col + 1) + (value === "" ? ", пусто" : value === "#" ? ", заблокировано" : ", игрок " + value));

      if (value === "X" || value === "O") {
        cell.textContent = value;
        cell.classList.add("piece", value === "X" ? "piece-x" : "piece-o");
      } else if (value === "#") {
        cell.textContent = "×";
        cell.classList.add("blocked");
        cell.disabled = true;
      } else if (state.phase === "playing" && isLegalMove(state, row, col)) {
        cell.classList.add("legal");
        cell.addEventListener("click", () => updateState(playMove(state, row, col)));
      } else if (state.phase === "setup-x" || state.phase === "setup-o") {
        cell.addEventListener("click", () => updateState(chooseStart(state, row, col)));
      } else {
        cell.disabled = true;
      }

      if (state.lastDestroyed.some((destroyed) => destroyed.row === row && destroyed.col === col)) {
        cell.classList.add("just-destroyed");
      }
      boardElement.appendChild(cell);
    }
  }

  if (state.phase === "setup-x") {
    statusElement.textContent = "Игрок «Х»: выберите стартовую клетку";
    turnElement.textContent = "Подготовка к игре";
    sideTitle.textContent = "Игрок X выбирает";
    sideDescription.textContent = "Нажмите любую клетку, чтобы тайно выбрать стартовую позицию.";
  } else if (state.phase === "setup-o") {
    statusElement.textContent = "Игрок «О»: выберите стартовую клетку";
    turnElement.textContent = "Выбор позиций скрыт";
    sideTitle.textContent = "Игрок O выбирает";
    sideDescription.textContent = "Позиция X скрыта. Игрок O выбирает свою стартовую клетку.";
  } else if (state.phase === "playing") {
    statusElement.textContent = "Ход игрока «" + state.currentPlayer + "»";
    turnElement.textContent = "Осталось поставить фигур: " + state.piecesLeft + " из " + TURN_PIECES;
    sideTitle.textContent = "Ход игрока " + state.currentPlayer;
    sideDescription.textContent = "Поставьте три фигуры. Каждая должна соединяться с вашей цепочкой.";
  } else {
    statusElement.textContent = "Игра завершена";
    turnElement.textContent = "Нажмите «Новая игра», чтобы сыграть ещё раз";
    sideTitle.textContent = "Партия завершена";
    sideDescription.textContent = "Начните новую игру, чтобы выбрать стартовые позиции.";
  }

  messageElement.textContent = state.message;
}

resultModal.addEventListener("cancel", (event) => event.preventDefault());
resultNewGameButton.addEventListener("click", setupGame);
startButton.addEventListener("click", setupGame);
setupGame();
