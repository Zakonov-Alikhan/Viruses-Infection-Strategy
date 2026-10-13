import {
  BLOCKED_CELL,
  DEFAULT_SETTINGS,
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  EMPTY_CELL,
  chooseStart,
  createGameState,
  isLegalMove,
  playMove
} from "./game.js";

const boardElement = document.querySelector(".game-board");
const boardShell = document.querySelector(".board-shell");
const boardRow = document.querySelector(".board-row");
const topAxis = document.querySelector(".axis-top");
const sideAxis = document.querySelector(".axis-side");
const statusElement = document.querySelector("#game-status");
const messageElement = document.querySelector("#game-message");
const turnElement = document.querySelector("#turn-counter");
const startButton = document.querySelector("#start-button");
const sideTitle = document.querySelector("#side-title");
const sideDescription = document.querySelector("#side-description");
const privacyNote = document.querySelector("#privacy-note");
const turnRule = document.querySelector("#rules-turn-count");
const resultModal = document.querySelector("#result-modal");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const resultRoast = document.querySelector("#result-roast");
const resultNewGameButton = document.querySelector("#result-new-game");
const settingsModal = document.querySelector("#settings-modal");
const settingsButton = document.querySelector("#settings-button");
const settingsCloseButton = document.querySelector("#settings-close");
const settingsCancelButton = document.querySelector("#settings-cancel");
const settingsForm = document.querySelector("#settings-form");
const widthInput = document.querySelector("#board-width-input");
const heightInput = document.querySelector("#board-height-input");
const piecesInput = document.querySelector("#pieces-per-turn-input");
const freeStartToggle = document.querySelector("#free-start-toggle");
const piecesMaxHint = document.querySelector("#pieces-max-hint");
const toggleHint = document.querySelector(".toggle-copy small");
const widthError = document.querySelector("#board-width-error");
const heightError = document.querySelector("#board-height-error");
const piecesError = document.querySelector("#pieces-per-turn-error");

let settings = { ...DEFAULT_SETTINGS };
let state;

function figureWord(count) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "фигур";
  const last = count % 10;
  if (last === 1) return "фигуру";
  if (last >= 2 && last <= 4) return "фигуры";
  return "фигур";
}

function columnLabel(index) {
  let label = "";
  let value = index;
  while (value >= 0) {
    label = String.fromCharCode((value % 26) + 65) + label;
    value = Math.floor(value / 26) - 1;
  }
  return label;
}

function setAxisLabels() {
  topAxis.replaceChildren();
  sideAxis.replaceChildren();
  for (let col = 0; col < settings.width; col += 1) {
    const label = document.createElement("span");
    label.textContent = columnLabel(col);
    topAxis.appendChild(label);
  }
  for (let row = 1; row <= settings.height; row += 1) {
    const label = document.createElement("span");
    label.textContent = String(row);
    sideAxis.appendChild(label);
  }
}

function syncBoardGeometry() {
  if (!state) return;
  const width = state.settings.width;
  const height = state.settings.height;
  const rowStyle = getComputedStyle(boardRow);
  const boardStyle = getComputedStyle(boardElement);
  const axisWidth = sideAxis.getBoundingClientRect().width;
  const rowGap = Number.parseFloat(rowStyle.columnGap) || 0;
  const columnGap = Number.parseFloat(boardStyle.columnGap) || 0;
  const cellGapY = Number.parseFloat(boardStyle.rowGap) || 0;
  const horizontalChrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
    .reduce((total, property) => total + (Number.parseFloat(boardStyle[property]) || 0), 0);
  const verticalChrome = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]
    .reduce((total, property) => total + (Number.parseFloat(boardStyle[property]) || 0), 0);
  const availableOuterWidth = Math.min(720, Math.max(0, boardRow.clientWidth - axisWidth - rowGap));
  const cellWidthLimit = (availableOuterWidth - horizontalChrome - columnGap * (width - 1)) / width;
  const cellHeightLimit = (720 - verticalChrome - cellGapY * (height - 1)) / height;
  const cellSize = Math.max(4, Math.min(48, cellWidthLimit, cellHeightLimit));
  const innerWidth = cellSize * width + columnGap * (width - 1);
  const innerHeight = cellSize * height + cellGapY * (height - 1);
  boardElement.style.setProperty("--cell-font-size", Math.max(4, Math.min(16, cellSize * 0.58)) + "px");
  boardElement.style.width = (innerWidth + horizontalChrome) + "px";
  boardElement.style.height = (innerHeight + verticalChrome) + "px";
  topAxis.style.gridTemplateColumns = "repeat(" + width + ", minmax(0, 1fr))";
  topAxis.style.columnGap = columnGap + "px";
  topAxis.style.width = innerWidth + "px";
  topAxis.style.marginLeft = (axisWidth + rowGap + (Number.parseFloat(boardStyle.borderLeftWidth) || 0) + (Number.parseFloat(boardStyle.paddingLeft) || 0)) + "px";
  sideAxis.style.gridTemplateRows = "repeat(" + height + ", minmax(0, 1fr))";
  sideAxis.style.rowGap = cellGapY + "px";
  sideAxis.style.height = innerHeight + "px";
  sideAxis.style.marginTop = ((Number.parseFloat(boardStyle.borderTopWidth) || 0) + (Number.parseFloat(boardStyle.paddingTop) || 0)) + "px";
  sideAxis.style.marginBottom = sideAxis.style.marginTop;
  boardElement.setAttribute("aria-label", "Поле " + width + " на " + height);
}

function setupGame() {
  if (resultModal.open) resultModal.close();
  state = createGameState(settings);
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
  boardElement.style.setProperty("--board-width", state.settings.width);
  boardElement.style.setProperty("--board-height", state.settings.height);
  setAxisLabels();

  for (let row = 0; row < state.settings.height; row += 1) {
    for (let col = 0; col < state.settings.width; col += 1) {
      const value = state.board[row][col];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", "Ряд " + (row + 1) + ", столбец " + columnLabel(col) + (value === EMPTY_CELL ? ", пусто" : value === BLOCKED_CELL ? ", заблокировано" : ", игрок " + value));

      if (value === "X" || value === "O") {
        cell.textContent = value;
        cell.classList.add("piece", value === "X" ? "piece-x" : "piece-o");
      } else if (value === BLOCKED_CELL) {
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

      if (destroyedCells.has(row + "," + col)) {
        cell.classList.add("just-destroyed");
      }
      boardElement.appendChild(cell);
    }
  }

  const piecesText = state.settings.piecesPerTurn + " " + figureWord(state.settings.piecesPerTurn);
  turnRule.textContent = "Первым ходит X. За ход нужно поставить " + piecesText + ".";
  privacyNote.lastChild.textContent = state.settings.freeStartingPositions
    ? " Стартовые позиции скрыты до начала партии."
    : " Игроки начинают в противоположных углах поля.";

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
    turnElement.textContent = "Осталось поставить: " + state.piecesLeft + " из " + state.settings.piecesPerTurn;
    sideTitle.textContent = "Ход игрока " + state.currentPlayer;
    sideDescription.textContent = "Поставьте " + piecesText + ", соединяя каждую новую фигуру со своей цепочкой.";
  } else {
    statusElement.textContent = "Игра завершена";
    turnElement.textContent = "Нажмите «Новая игра», чтобы сыграть ещё раз";
    sideTitle.textContent = "Партия завершена";
    sideDescription.textContent = "Начните новую игру, чтобы выбрать стартовые позиции.";
  }

  messageElement.textContent = state.message;
  syncBoardGeometry();
}

function clearFieldError(input, errorElement) {
  input.removeAttribute("aria-invalid");
  errorElement.hidden = true;
  errorElement.textContent = "";
}

function showFieldError(input, errorElement, message) {
  input.setAttribute("aria-invalid", "true");
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function updatePiecesLimit() {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const area = width * height;
  const maxArea = MAX_BOARD_DIMENSION * MAX_BOARD_DIMENSION;
  piecesInput.max = String(area > 0 ? area : maxArea);
  piecesMaxHint.textContent = "из " + (area > 0 ? area : maxArea) + " клеток максимум";
}

function validateField(input) {
  const value = Number(input.value);
  if (input === widthInput || input === heightInput) {
    const error = input === widthInput ? widthError : heightError;
    if (!Number.isInteger(value) || value < MIN_BOARD_DIMENSION || value > MAX_BOARD_DIMENSION) {
      showFieldError(input, error, "Введите целое число от " + MIN_BOARD_DIMENSION + " до " + MAX_BOARD_DIMENSION + ".");
      return false;
    }
    clearFieldError(input, error);
    return true;
  }

  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const area = width * height;
  const maxPieces = Number.isInteger(area) && area > 0 ? area : MAX_BOARD_DIMENSION * MAX_BOARD_DIMENSION;
  if (!Number.isInteger(value) || value < 1 || value > maxPieces) {
    showFieldError(input, piecesError, "Количество фигур должно быть от 1 до " + maxPieces + ".");
    return false;
  }
  clearFieldError(input, piecesError);
  return true;
}
function openSettings() {
  widthInput.min = String(MIN_BOARD_DIMENSION);
  widthInput.max = String(MAX_BOARD_DIMENSION);
  heightInput.min = String(MIN_BOARD_DIMENSION);
  heightInput.max = String(MAX_BOARD_DIMENSION);
  widthInput.value = String(settings.width);
  heightInput.value = String(settings.height);
  piecesInput.value = String(settings.piecesPerTurn);
  freeStartToggle.checked = settings.freeStartingPositions;
  toggleHint.textContent = freeStartToggle.checked
    ? "Игроки тайно выбирают стартовые клетки"
    : "Игроки автоматически занимают противоположные углы";
  updatePiecesLimit();
  clearFieldError(widthInput, widthError);
  clearFieldError(heightInput, heightError);
  clearFieldError(piecesInput, piecesError);
  settingsModal.showModal();
  widthInput.focus();
}

function applySettings(event) {
  event.preventDefault();
  clearFieldError(widthInput, widthError);
  clearFieldError(heightInput, heightError);
  clearFieldError(piecesInput, piecesError);

  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const piecesPerTurn = Number(piecesInput.value);
  let firstInvalid = null;
  if (!Number.isInteger(width) || width < MIN_BOARD_DIMENSION || width > MAX_BOARD_DIMENSION) {
    showFieldError(widthInput, widthError, "Введите целое число от " + MIN_BOARD_DIMENSION + " до " + MAX_BOARD_DIMENSION + ".");
    firstInvalid = firstInvalid || widthInput;
  }
  if (!Number.isInteger(height) || height < MIN_BOARD_DIMENSION || height > MAX_BOARD_DIMENSION) {
    showFieldError(heightInput, heightError, "Введите целое число от " + MIN_BOARD_DIMENSION + " до " + MAX_BOARD_DIMENSION + ".");
    firstInvalid = firstInvalid || heightInput;
  }
  const area = width * height;
  if (!Number.isInteger(piecesPerTurn) || piecesPerTurn < 1 || piecesPerTurn > area) {
    showFieldError(piecesInput, piecesError, "Количество фигур должно быть от 1 до " + (Number.isInteger(area) && area > 0 ? area : MAX_BOARD_DIMENSION * MAX_BOARD_DIMENSION) + ".");
    firstInvalid = firstInvalid || piecesInput;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  settings = {
    width,
    height,
    piecesPerTurn,
    freeStartingPositions: freeStartToggle.checked
  };
  settingsModal.close();
  setupGame();
}

widthInput.addEventListener("input", () => {
  updatePiecesLimit();
  validateField(widthInput);
  validateField(piecesInput);
});
heightInput.addEventListener("input", () => {
  updatePiecesLimit();
  validateField(heightInput);
  validateField(piecesInput);
});
piecesInput.addEventListener("input", () => validateField(piecesInput));
freeStartToggle.addEventListener("change", () => {
  toggleHint.textContent = freeStartToggle.checked
    ? "Игроки тайно выбирают стартовые клетки"
    : "Игроки автоматически занимают противоположные углы";
});
settingsButton.addEventListener("click", openSettings);
settingsCloseButton.addEventListener("click", () => settingsModal.close());
settingsCancelButton.addEventListener("click", () => settingsModal.close());
settingsForm.addEventListener("submit", applySettings);
resultModal.addEventListener("cancel", (event) => event.preventDefault());
resultNewGameButton.addEventListener("click", setupGame);
startButton.addEventListener("click", setupGame);
new ResizeObserver(syncBoardGeometry).observe(boardRow);
setupGame();
