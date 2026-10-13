import {
  BLOCKED_CELL,
  DEFAULT_SETTINGS,
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  EMPTY_CELL,
  chooseStart,
  createGameState,
  flagFall,
  isLegalMove,
  isValidBombTarget,
  playMove,
  resign,
  selectAbility,
  useBomb
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
const currentTurnCard = document.querySelector("#current-turn-card");
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
const clockMinutesInput = document.querySelector("#clock-minutes-input");
const clockIncrementInput = document.querySelector("#clock-increment-input");
const unlimitedTimeToggle = document.querySelector("#unlimited-time-toggle");
const randomEventsToggle = document.querySelector("#random-events-toggle");
const timeLimitHint = document.querySelector("#time-limit-hint");
const timeControlFields = document.querySelector(".settings-time-control");
const clockXElement = document.querySelector("#clock-x");
const clockOElement = document.querySelector("#clock-o");
const clockPlayerX = document.querySelector("#clock-player-x");
const clockPlayerO = document.querySelector("#clock-player-o");
const clockControlSummary = document.querySelector("#clock-control-summary");
const resignButton = document.querySelector("#resign-button");
const inventoryElements = {
  X: document.querySelector("#inventory-x"),
  O: document.querySelector("#inventory-o")
};
const bombAimOverlay = document.createElement("div");
bombAimOverlay.className = "bomb-aim-overlay";
bombAimOverlay.hidden = true;
bombAimOverlay.setAttribute("aria-hidden", "true");
const EVENT_ITEM_DEFINITIONS = {
  bomb: { name: "Бомба", icon: "/ui/assets/items/bomb.svg" },
  freePlacement: { name: "Свободное расположение", icon: "/ui/assets/items/free-placement.svg" },
  extraTurn: { name: "Дополнительный ход", icon: "/ui/assets/items/extra-turn.svg" }
};
const freeStartToggle = document.querySelector("#free-start-toggle");
const piecesMaxHint = document.querySelector("#pieces-max-hint");
const toggleHint = document.querySelector("#free-start-hint");
const widthError = document.querySelector("#board-width-error");
const heightError = document.querySelector("#board-height-error");
const piecesError = document.querySelector("#pieces-per-turn-error");
const clockMinutesError = document.querySelector("#clock-minutes-error");
const clockIncrementError = document.querySelector("#clock-increment-error");

let settings = { ...DEFAULT_SETTINGS };
let state;
let clockRemaining = { X: settings.clockMinutes * 60_000, O: settings.clockMinutes * 60_000 };
let clockInterval = null;
let clockLastTick = null;

function formatClock(milliseconds) {
  const remaining = Math.max(0, milliseconds);
  const wholeSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = String(wholeSeconds % 60).padStart(2, "0");
  if (remaining <= 10_000) {
    return String(minutes).padStart(2, "0") + ":" + seconds + "." + Math.floor((remaining % 1000) / 100);
  }
  return String(minutes).padStart(2, "0") + ":" + seconds;
}

function renderClock() {
  clockXElement.textContent = settings.unlimitedTime ? "∞" : formatClock(clockRemaining.X);
  clockOElement.textContent = settings.unlimitedTime ? "∞" : formatClock(clockRemaining.O);
  clockControlSummary.textContent = settings.unlimitedTime
    ? "Без ограничения времени"
    : settings.clockMinutes + " мин на игрока · +" + settings.incrementSeconds + " с за полный ход";
  const xActive = state && state.phase === "playing" && state.currentPlayer === "X";
  const oActive = state && state.phase === "playing" && state.currentPlayer === "O";
  clockPlayerX.classList.toggle("clock-active", xActive);
  clockPlayerO.classList.toggle("clock-active", oActive);
  currentTurnCard.classList.toggle("turn-active", state && state.phase !== "finished");
  clockXElement.classList.toggle("clock-low", !settings.unlimitedTime && clockRemaining.X <= 10_000);
  clockOElement.classList.toggle("clock-low", !settings.unlimitedTime && clockRemaining.O <= 10_000);
  resignButton.disabled = !state || state.phase !== "playing";
}

function renderInventories() {
  for (const player of ["X", "O"]) {
    const container = inventoryElements[player];
    const items = state.inventory[player];
    Array.from(container.children).forEach((slot, index) => {
      const item = items[index];
      slot.replaceChildren();
      slot.classList.toggle("is-selected", Boolean(item && state.selectedAbility === item.id));
      slot.dataset.itemId = item ? String(item.id) : "";
      if (!item) {
        slot.disabled = true;
        slot.setAttribute("aria-label", "Пустой слот");
        slot.removeAttribute("title");
        return;
      }

      const definition = EVENT_ITEM_DEFINITIONS[item.type];
      const icon = document.createElement("img");
      icon.src = definition.icon;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      slot.appendChild(icon);
      slot.disabled = state.phase !== "playing" || state.currentPlayer !== player || item.type === "extraTurn";
      slot.setAttribute("aria-label", definition.name + (item.type === "extraTurn" ? " — сработает автоматически" : " — выбрать"));
      slot.title = definition.name + (item.type === "extraTurn"
        ? " — дополнительный ход будет совершён сразу"
        : item.type === "freePlacement"
          ? " — добавляет одну фигуру вне счётчика хода"
          : " — можно применить в любой момент своего хода");
    });
  }
}

function stopClock() {
  if (clockInterval !== null) window.clearInterval(clockInterval);
  clockInterval = null;
  clockLastTick = null;
}

function advanceClock(now = performance.now()) {
  if (!state || state.phase !== "playing" || settings.unlimitedTime || clockLastTick === null) return true;
  const elapsed = now - clockLastTick;
  clockLastTick = now;
  const player = state.currentPlayer;
  clockRemaining[player] = Math.max(0, clockRemaining[player] - elapsed);
  renderClock();
  if (clockRemaining[player] > 0) return true;

  stopClock();
  const previousState = state;
  state = flagFall(state);
  render();
  if (previousState.phase !== "finished" && state.phase === "finished") showResult();
  return false;
}

function startClock() {
  if (clockInterval !== null || !state || state.phase !== "playing" || settings.unlimitedTime) return;
  clockLastTick = performance.now();
  clockInterval = window.setInterval(() => advanceClock(), 100);
  renderClock();
}

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
  const { width, height } = state.settings;
  const columnLabels = Array.from({ length: width }, (_, col) => {
    const label = document.createElement("span");
    label.textContent = columnLabel(col);
    return label;
  });
  const rowLabels = Array.from({ length: height }, (_, row) => {
    const label = document.createElement("span");
    label.textContent = String(row + 1);
    return label;
  });
  topAxis.replaceChildren(...columnLabels);
  sideAxis.replaceChildren(...rowLabels);
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
  stopClock();
  if (resultModal.open) resultModal.close();
  state = createGameState(settings);
  clockRemaining = {
    X: settings.clockMinutes * 60_000,
    O: settings.clockMinutes * 60_000
  };
  render();
  startClock();
}

function updateState(nextState) {
  const previousState = state;
  const now = performance.now();
  if (previousState.phase === "playing" && !advanceClock(now)) return;
  const completedTurn = previousState.phase === "playing"
    && previousState.piecesLeft === 1
    && (nextState.currentPlayer !== previousState.currentPlayer || (nextState.phase === "finished" && nextState.piecesLeft === 0));
  if (completedTurn && !settings.unlimitedTime) clockRemaining[previousState.currentPlayer] += settings.incrementSeconds * 1000;
  const gameJustEnded = previousState.phase !== "finished" && nextState.phase === "finished";
  state = nextState;
  if (state.phase === "playing") startClock();
  else stopClock();
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
  const destroyedCells = new Set(state.lastDestroyed.map(({ row, col }) => row + "," + col));
  boardElement.style.setProperty("--board-width", state.settings.width);
  boardElement.style.setProperty("--board-height", state.settings.height);
  setAxisLabels();

  for (let row = 0; row < state.settings.height; row += 1) {
    for (let col = 0; col < state.settings.width; col += 1) {
      const value = state.board[row][col];
      const eventItem = state.eventItems.find((item) => item.row === row && item.col === col);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      const itemLabel = eventItem ? ", предмет: " + EVENT_ITEM_DEFINITIONS[eventItem.type].name : "";
      cell.setAttribute("aria-label", "Ряд " + (row + 1) + ", столбец " + columnLabel(col) + (value === EMPTY_CELL ? ", пусто" : value === BLOCKED_CELL ? ", заблокировано" : ", игрок " + value) + itemLabel);

      if (eventItem) {
        const itemIcon = document.createElement("img");
        itemIcon.src = EVENT_ITEM_DEFINITIONS[eventItem.type].icon;
        itemIcon.alt = "";
        itemIcon.setAttribute("aria-hidden", "true");
        cell.classList.add("event-item", "event-item-" + eventItem.type);
        cell.appendChild(itemIcon);
      }

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

      const selectedAbility = state.inventory[state.currentPlayer].find((item) => item.id === state.selectedAbility);
      if (state.phase === "playing" && selectedAbility && selectedAbility.type === "bomb") {
        cell.classList.remove("legal");
        cell.disabled = !isValidBombTarget(state, row, col);
        if (!cell.disabled) cell.addEventListener("click", () => updateState(useBomb(state, selectedAbility.id, row, col)));
      }

      if (destroyedCells.has(row + "," + col)) {
        cell.classList.add("just-destroyed");
      }
      boardElement.appendChild(cell);
    }
  }
  bombAimOverlay.hidden = true;
  boardElement.appendChild(bombAimOverlay);

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
  renderClock();
  renderInventories();
}

boardElement.addEventListener("pointermove", (event) => {
  const selected = state && state.phase === "playing"
    ? state.inventory[state.currentPlayer].find((item) => item.id === state.selectedAbility && item.type === "bomb")
    : null;
  const cell = event.target.closest(".cell");
  if (!selected || !cell) {
    bombAimOverlay.hidden = true;
    return;
  }
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (!isValidBombTarget(state, row, col)) {
    bombAimOverlay.hidden = true;
    return;
  }
  bombAimOverlay.style.gridRow = (row + 1) + " / span 2";
  bombAimOverlay.style.gridColumn = (col + 1) + " / span 2";
  bombAimOverlay.hidden = false;
});
boardElement.addEventListener("pointerleave", () => { bombAimOverlay.hidden = true; });

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

function maxPiecesFor(width, height) {
  const dimensionsAreValid = [width, height].every((dimension) =>
    Number.isInteger(dimension) && dimension >= MIN_BOARD_DIMENSION && dimension <= MAX_BOARD_DIMENSION
  );
  return dimensionsAreValid
    ? Math.floor(width * height / 10)
    : Math.floor(MAX_BOARD_DIMENSION * MAX_BOARD_DIMENSION / 10);
}

function updatePiecesLimit() {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const maxPieces = maxPiecesFor(width, height);
  piecesInput.max = String(maxPieces);
  piecesMaxHint.textContent = "до " + maxPieces + " фигур (1/10 поля)";
}

function syncTimeLimitSettings() {
  const unlimitedTime = unlimitedTimeToggle.checked;
  clockMinutesInput.disabled = unlimitedTime;
  clockIncrementInput.disabled = unlimitedTime;
  timeControlFields.setAttribute("aria-disabled", String(unlimitedTime));
  timeLimitHint.textContent = unlimitedTime
    ? "Часы остановлены, время не ограничено"
    : "Часы идут во время хода каждого игрока";
  if (unlimitedTime) {
    clearFieldError(clockMinutesInput, clockMinutesError);
    clearFieldError(clockIncrementInput, clockIncrementError);
  }
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
  const maxPieces = maxPiecesFor(width, height);
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
  clockMinutesInput.value = String(settings.clockMinutes);
  clockIncrementInput.value = String(settings.incrementSeconds);
  unlimitedTimeToggle.checked = settings.unlimitedTime;
  randomEventsToggle.checked = settings.randomEvents;
  freeStartToggle.checked = settings.freeStartingPositions;
  syncTimeLimitSettings();
  toggleHint.textContent = freeStartToggle.checked
    ? "Игроки тайно выбирают стартовые клетки"
    : "Игроки автоматически занимают противоположные углы";
  updatePiecesLimit();
  clearFieldError(widthInput, widthError);
  clearFieldError(heightInput, heightError);
  clearFieldError(piecesInput, piecesError);
  clearFieldError(clockMinutesInput, clockMinutesError);
  clearFieldError(clockIncrementInput, clockIncrementError);
  settingsModal.showModal();
  widthInput.focus();
}

function applySettings(event) {
  event.preventDefault();
  clearFieldError(widthInput, widthError);
  clearFieldError(heightInput, heightError);
  clearFieldError(piecesInput, piecesError);
  clearFieldError(clockMinutesInput, clockMinutesError);
  clearFieldError(clockIncrementInput, clockIncrementError);

  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const piecesPerTurn = Number(piecesInput.value);
  const unlimitedTime = unlimitedTimeToggle.checked;
  const randomEvents = randomEventsToggle.checked;
  const clockMinutes = unlimitedTime ? settings.clockMinutes : Number(clockMinutesInput.value);
  const incrementSeconds = unlimitedTime ? settings.incrementSeconds : Number(clockIncrementInput.value);
  let firstInvalid = null;
  if (!Number.isInteger(width) || width < MIN_BOARD_DIMENSION || width > MAX_BOARD_DIMENSION) {
    showFieldError(widthInput, widthError, "Введите целое число от " + MIN_BOARD_DIMENSION + " до " + MAX_BOARD_DIMENSION + ".");
    firstInvalid = firstInvalid || widthInput;
  }
  if (!Number.isInteger(height) || height < MIN_BOARD_DIMENSION || height > MAX_BOARD_DIMENSION) {
    showFieldError(heightInput, heightError, "Введите целое число от " + MIN_BOARD_DIMENSION + " до " + MAX_BOARD_DIMENSION + ".");
    firstInvalid = firstInvalid || heightInput;
  }
  const maxPieces = maxPiecesFor(width, height);
  if (!Number.isInteger(piecesPerTurn) || piecesPerTurn < 1 || piecesPerTurn > maxPieces) {
    showFieldError(piecesInput, piecesError, "Количество фигур должно быть от 1 до " + maxPieces + " (не больше 1/10 площади поля).");
    firstInvalid = firstInvalid || piecesInput;
  }
  if (!unlimitedTime && (!Number.isInteger(clockMinutes) || clockMinutes < 1 || clockMinutes > 60)) {
    showFieldError(clockMinutesInput, clockMinutesError, "Введите целое число от 1 до 60 минут.");
    firstInvalid = firstInvalid || clockMinutesInput;
  }
  if (!unlimitedTime && (!Number.isInteger(incrementSeconds) || incrementSeconds < 0 || incrementSeconds > 60)) {
    showFieldError(clockIncrementInput, clockIncrementError, "Добавка должна быть целым числом от 0 до 60 секунд.");
    firstInvalid = firstInvalid || clockIncrementInput;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  settings = {
    width,
    height,
    piecesPerTurn,
    clockMinutes,
    incrementSeconds,
    unlimitedTime,
    randomEvents,
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
unlimitedTimeToggle.addEventListener("change", syncTimeLimitSettings);
clockMinutesInput.addEventListener("input", () => {
  const value = Number(clockMinutesInput.value);
  if (!Number.isInteger(value) || value < 1 || value > 60) {
    showFieldError(clockMinutesInput, clockMinutesError, "Введите целое число от 1 до 60 минут.");
  } else {
    clearFieldError(clockMinutesInput, clockMinutesError);
  }
});
clockIncrementInput.addEventListener("input", () => {
  const value = Number(clockIncrementInput.value);
  if (!Number.isInteger(value) || value < 0 || value > 60) {
    showFieldError(clockIncrementInput, clockIncrementError, "Добавка должна быть целым числом от 0 до 60 секунд.");
  } else {
    clearFieldError(clockIncrementInput, clockIncrementError);
  }
});
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
resignButton.addEventListener("click", () => {
  if (state.phase !== "playing") return;
  if (window.confirm("Сдаться? Победа будет засчитана сопернику.")) updateState(resign(state));
});
for (const player of ["X", "O"]) {
  inventoryElements[player].addEventListener("click", (event) => {
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.disabled || state.currentPlayer !== player) return;
    updateState(selectAbility(state, Number(slot.dataset.itemId)));
  });
}
startButton.addEventListener("click", setupGame);
new ResizeObserver(syncBoardGeometry).observe(boardRow);
setupGame();
