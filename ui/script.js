import {
  BLOCKED_CELL,
  DEFAULT_SETTINGS,
  EVENT_ITEMS,
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  EMPTY_CELL,
  chooseStart,
  chooseAbilityTarget,
  createGameState,
  flagFall,
  getSelectedAbility,
  hasPermission,
  isLegalMove,
  isValidAreaTarget,
  isValidDebrisTarget,
  isValidPointDestroyTarget,
  isValidShieldTarget,
  playMove,
  PLAYER_PERMISSIONS,
  resign,
  selectAbility,
  useBomb,
  useAntiBomb,
  usePointDestroy
} from "./game.js?v=20261017-i18n2";
import { applyTranslations, getLanguage, pieceForm, setLanguage, t } from "./i18n.js?v=20261017-i18n2";

const boardElement = document.querySelector(".game-board");
const boardShell = document.querySelector(".board-shell");
const boardRow = document.querySelector(".board-row");
const topAxis = document.querySelector(".axis-top");
const sideAxis = document.querySelector(".axis-side");
const statusElement = document.querySelector("#game-status");
const messageElement = document.querySelector("#game-message");
const turnElement = document.querySelector("#turn-counter");
const turnProgress = document.querySelector("#turn-progress");
const piecesLeftCount = document.querySelector("#pieces-left-count");
const piecesTotalCount = document.querySelector("#pieces-total-count");
const turnProgressFill = document.querySelector("#turn-progress-fill");
const turnPlayerLabel = document.querySelector("#turn-player-label");
const turnProgressBar = turnProgress.querySelector('[role="progressbar"]');
const startButton = document.querySelector("#start-button");
const languageSelect = document.querySelector("#language-select");
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
const rulesButton = document.querySelector("#rules-button");
const rulesModal = document.querySelector("#rules-modal");
const rulesCloseButton = document.querySelector("#rules-close");
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
const adminModeToggle = document.querySelector("#admin-mode-toggle");
const adminTools = document.querySelector("#admin-tools");
const adminItemList = document.querySelector("#admin-item-list");
const animationsToggle = document.querySelector("#animations-toggle");
const timeLimitHint = document.querySelector("#time-limit-hint");
const timeControlFields = document.querySelector(".settings-time-control");
const clockXElement = document.querySelector("#clock-x");
const clockOElement = document.querySelector("#clock-o");
const clockPlayerX = document.querySelector("#clock-player-x");
const clockPlayerO = document.querySelector("#clock-player-o");
const clockControlSummary = document.querySelector("#clock-control-summary");
const resignButton = document.querySelector("#resign-button");
const resignConfirmModal = document.querySelector("#resign-confirm-modal");
const resignCancelButton = document.querySelector("#resign-cancel");
const resignConfirmButton = document.querySelector("#resign-confirm");
const inventoryElements = {
  X: document.querySelector("#inventory-x"),
  O: document.querySelector("#inventory-o")
};
const bombAimOverlay = document.createElement("div");
bombAimOverlay.className = "bomb-aim-overlay";
bombAimOverlay.hidden = true;
bombAimOverlay.setAttribute("aria-hidden", "true");
const areaEffectOverlay = document.createElement("div");
areaEffectOverlay.className = "area-effect";
areaEffectOverlay.hidden = true;
areaEffectOverlay.setAttribute("aria-hidden", "true");
const EVENT_ITEM_DEFINITIONS = {
  bomb: { nameKey: "item.bomb", icon: "/ui/assets/items/bomb.svg" },
  freePlacement: { nameKey: "item.freePlacement", icon: "/ui/assets/items/free-placement.svg" },
  extraTurn: { nameKey: "item.extraTurn", icon: "/ui/assets/items/extra-turn.svg" },
  antiBomb: { nameKey: "item.antiBomb", icon: "/ui/assets/items/anti-bomb.svg" },
  debris: { nameKey: "item.debris", icon: "/ui/assets/items/debris.svg" },
  shield: { nameKey: "item.shield", icon: "/ui/assets/items/shield.svg" },
  gangstaShield: { nameKey: "item.gangstaShield", icon: "/ui/assets/items/gangsta-shield.svg" },
  pointDestroy: { nameKey: "item.pointDestroy", icon: "/ui/assets/items/point-destroy.svg" }
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
let newlyPlacedCells = new Map();
let newlySpawnedItems = new Map();
let activeAreaEffect = null;
let bombAimCell = null;
let clockRemaining = { X: settings.clockMinutes * 60_000, O: settings.clockMinutes * 60_000 };
let clockInterval = null;
let clockLastTick = null;
document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";

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
    ? t("clock.unlimited")
    : t("clock.summary", { minutes: settings.clockMinutes, seconds: settings.incrementSeconds });
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
        slot.setAttribute("aria-label", t("inventory.empty"));
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
      const itemName = t(definition.nameKey);
      slot.setAttribute("aria-label", t(item.type === "extraTurn" ? "inventory.auto" : "inventory.choose", { name: itemName }));
      slot.title = itemName + (item.type === "extraTurn"
        ? t("inventory.autoHelp")
        : item.type === "freePlacement" ? t("inventory.freeHelp") : t("inventory.useHelp"));
    });
  }
  const canUseAdminTools = state.phase === "playing"
    && hasPermission(state, state.currentPlayer, PLAYER_PERMISSIONS.USE_ANY_ITEM);
  adminTools.hidden = !canUseAdminTools;
  adminItemList.replaceChildren();
  if (canUseAdminTools) {
    for (const type of EVENT_ITEMS) {
      const definition = EVENT_ITEM_DEFINITIONS[type];
      const itemId = "admin:" + type;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-item-button" + (state.selectedAbility === itemId ? " is-selected" : "");
      button.dataset.itemId = itemId;
      button.disabled = false;
      const itemName = t(definition.nameKey);
      button.title = t("admin.item", { name: itemName });
      const icon = document.createElement("img");
      icon.src = definition.icon;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      button.append(icon, document.createTextNode(itemName));
      adminItemList.appendChild(button);
    }
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
  boardElement.setAttribute("aria-label", t("game.boardSize", { width, height }));
}

function setupGame() {
  stopClock();
  if (resultModal.open) resultModal.close();
  newlyPlacedCells.clear();
  newlySpawnedItems.clear();
  activeAreaEffect = null;
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
  const animationStartedAt = performance.now();
  newlyPlacedCells.clear();
  newlySpawnedItems.clear();
  if (previousState.phase === "playing" && previousState.settings.animationsEnabled && nextState.board !== previousState.board) {
    for (let row = 0; row < nextState.board.length; row += 1) {
      for (let col = 0; col < nextState.board[row].length; col += 1) {
        const value = nextState.board[row][col];
        if ((value === "X" || value === "O") && previousState.board[row][col] !== value) {
          newlyPlacedCells.set(row + "," + col, animationStartedAt);
        }
      }
    }
  }
  let bombStarted = false;
  if (previousState.phase === "playing" && previousState.settings.animationsEnabled) {
    const previousItems = new Set(previousState.eventItems.map((item) => item.id));
    for (const item of nextState.eventItems) {
      if (!previousItems.has(item.id)) newlySpawnedItems.set(item.id, animationStartedAt);
    }

    const usedAbility = getSelectedAbility(previousState);
    if ((usedAbility?.type === "bomb" || usedAbility?.type === "antiBomb")
      && nextState.board !== previousState.board && nextState.lastDestroyed.length === 4) {
      activeAreaEffect = {
        type: usedAbility.type,
        row: Math.min(...nextState.lastDestroyed.map((cell) => cell.row)),
        col: Math.min(...nextState.lastDestroyed.map((cell) => cell.col)),
        startedAt: animationStartedAt
      };
      bombStarted = usedAbility.type === "bomb";
    } else if (usedAbility?.type === "pointDestroy"
      && nextState.board !== previousState.board && nextState.lastDestroyed.length === 1) {
      activeAreaEffect = {
        type: "pointDestroy",
        row: nextState.lastDestroyed[0].row,
        col: nextState.lastDestroyed[0].col,
        startedAt: animationStartedAt
      };
      bombStarted = true;
    }
  }
  if (bombStarted) {
    const shell = document.querySelector(".app-shell");
    shell.classList.remove("bomb-screen-shake");
    void shell.offsetWidth;
    shell.classList.add("bomb-screen-shake");
  }
  state = nextState;
  if (state.phase === "playing") startClock();
  else stopClock();
  render();
  if (gameJustEnded) showResult();
}

function showResult() {
  const loser = state.winner === "X" ? "O" : "X";
  messageElement.textContent = t("game.winner", { player: state.winner, reason: formatMessage(state.finishReason) });
  resultTitle.textContent = t("dialog.win", { player: state.winner });
  resultDescription.textContent = t("dialog.congrats", { reason: formatMessage(state.finishReason) });
  resultRoast.textContent = t("dialog.roast", { player: loser });
  resultModal.showModal();
  resultNewGameButton.focus();
}

function formatMessage(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(formatMessage).filter(Boolean).join(" ");
  const params = { ...(value.params || {}) };
  if (params.type) params.item = t("item." + params.type);
  return t(value.key, params);
}

function markLegalCell(cell, player) {
  cell.classList.add("legal");
  cell.dataset.player = player;
}

function render() {
  const animationNow = performance.now();
  for (const [key, startedAt] of newlyPlacedCells) {
    if (animationNow - startedAt >= 720) newlyPlacedCells.delete(key);
  }
  for (const [id, startedAt] of newlySpawnedItems) {
    if (animationNow - startedAt >= 680) newlySpawnedItems.delete(id);
  }
  if (activeAreaEffect && animationNow - activeAreaEffect.startedAt >= 520) activeAreaEffect = null;
  boardElement.innerHTML = "";
  const destroyedCells = new Set(state.lastDestroyed.map(({ row, col }) => row + "," + col));
  const selectedAbility = state.phase === "playing" ? getSelectedAbility(state) : null;
  const activeAreaAbility = selectedAbility && (selectedAbility.type === "bomb" || selectedAbility.type === "antiBomb")
    ? selectedAbility
    : null;
  boardElement.classList.toggle("is-aiming-area", Boolean(activeAreaAbility));
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
      const contents = value === EMPTY_CELL ? t("game.empty") : value === BLOCKED_CELL ? t("game.blocked") : t("game.player", { player: value });
      const itemLabel = eventItem ? t("game.item", { item: t(EVENT_ITEM_DEFINITIONS[eventItem.type].nameKey) }) : "";
      cell.setAttribute("aria-label", t("game.cell", { row: row + 1, col: columnLabel(col), contents, item: itemLabel }));

      if (eventItem) {
        const itemIcon = document.createElement("img");
        itemIcon.src = EVENT_ITEM_DEFINITIONS[eventItem.type].icon;
        itemIcon.alt = "";
        itemIcon.setAttribute("aria-hidden", "true");
        cell.classList.add("event-item", "event-item-" + eventItem.type);
        const itemAnimationStartedAt = newlySpawnedItems.get(eventItem.id);
        if (itemAnimationStartedAt !== undefined && state.settings.animationsEnabled) {
          cell.classList.add("event-item-entering");
          cell.style.setProperty("--item-animation-delay", "-" + (animationNow - itemAnimationStartedAt) + "ms");
        }
        cell.appendChild(itemIcon);
      }

      const isSelectedTarget = state.abilityTargets.some((target) => target.row === row && target.col === col);

      if (value === "X" || value === "O") {
        const glyph = document.createElement("span");
        glyph.className = "piece-glyph";
        glyph.textContent = value;
        cell.appendChild(glyph);
        cell.classList.add("piece", value === "X" ? "piece-x" : "piece-o");
        const animationStartedAt = newlyPlacedCells.get(row + "," + col);
        if (animationStartedAt !== undefined) {
          cell.classList.add("piece-entering");
          cell.style.setProperty("--piece-animation-delay", "-" + (animationNow - animationStartedAt) + "ms");
        }
      } else if (value === BLOCKED_CELL) {
        cell.textContent = "×";
        cell.classList.add("blocked");
        cell.disabled = true;
      }

      if (state.phase === "setup-x" || state.phase === "setup-o") {
        cell.disabled = value !== EMPTY_CELL;
        if (!cell.disabled) cell.addEventListener("click", () => updateState(chooseStart(state, row, col)));
      } else if (state.phase === "playing" && selectedAbility) {
        if (selectedAbility.type === "bomb" || selectedAbility.type === "antiBomb") {
          const valid = isValidAreaTarget(state, row, col);
          cell.disabled = !valid;
          if (valid) cell.addEventListener("click", () => updateState(selectedAbility.type === "bomb"
            ? useBomb(state, selectedAbility.id, row, col)
            : useAntiBomb(state, selectedAbility.id, row, col)));
        } else if (selectedAbility.type === "debris") {
          const valid = isValidDebrisTarget(state, row, col);
          cell.disabled = !valid;
          cell.classList.toggle("ability-target-selected", isSelectedTarget);
          if (valid) cell.addEventListener("click", () => updateState(chooseAbilityTarget(state, selectedAbility.id, row, col)));
        } else if (selectedAbility.type === "shield" || selectedAbility.type === "gangstaShield") {
          const valid = isValidShieldTarget(state, row, col);
          cell.disabled = !valid;
          cell.classList.toggle("ability-target-selected", isSelectedTarget);
          if (valid) cell.addEventListener("click", () => updateState(chooseAbilityTarget(state, selectedAbility.id, row, col)));
        } else if (selectedAbility.type === "pointDestroy") {
          const valid = isValidPointDestroyTarget(state, row, col);
          cell.disabled = !valid;
          if (valid) cell.addEventListener("click", () => updateState(usePointDestroy(state, selectedAbility.id, row, col)));
        } else if (isLegalMove(state, row, col)) {
          cell.disabled = false;
          markLegalCell(cell, state.currentPlayer);
          cell.addEventListener("click", () => updateState(playMove(state, row, col)));
        } else {
          cell.disabled = true;
        }
      } else if (state.phase === "playing" && isLegalMove(state, row, col)) {
        cell.disabled = false;
        markLegalCell(cell, state.currentPlayer);
        cell.addEventListener("click", () => updateState(playMove(state, row, col)));
      } else {
        cell.disabled = true;
      }

      const protection = state.protections.find((shield) => shield.row === row && shield.col === col);
      if (protection) {
        cell.classList.add("protected-piece");
        if (protection.permanent) cell.classList.add("protected-permanent");
        const icon = document.createElement("img");
        icon.className = "shield-marker";
        icon.src = protection.permanent ? EVENT_ITEM_DEFINITIONS.gangstaShield.icon : EVENT_ITEM_DEFINITIONS.shield.icon;
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        cell.appendChild(icon);
        cell.title = t(protection.permanent ? "shield.permanent" : "shield.temporary");
      }

      if (destroyedCells.has(row + "," + col)) {
        const effectSize = activeAreaEffect?.type === "pointDestroy" ? 1 : 2;
        const isAreaEffectCell = activeAreaEffect
          && row >= activeAreaEffect.row && row < activeAreaEffect.row + effectSize
          && col >= activeAreaEffect.col && col < activeAreaEffect.col + effectSize;
        if (!isAreaEffectCell) cell.classList.add("just-destroyed");
      }
      boardElement.appendChild(cell);
    }
  }
  areaEffectOverlay.hidden = true;
  areaEffectOverlay.replaceChildren();
  if (activeAreaEffect && state.settings.animationsEnabled) {
    const firstCell = boardElement.querySelector('.cell[data-row="' + activeAreaEffect.row + '"][data-col="' + activeAreaEffect.col + '"]');
    const singleCellEffect = activeAreaEffect.type === "pointDestroy";
    const bottomRightCell = singleCellEffect ? firstCell : boardElement.querySelector('.cell[data-row="' + (activeAreaEffect.row + 1) + '"][data-col="' + (activeAreaEffect.col + 1) + '"]');
    if (firstCell && bottomRightCell) {
      const effectAge = animationNow - activeAreaEffect.startedAt;
      areaEffectOverlay.className = "area-effect area-effect-" + activeAreaEffect.type;
      areaEffectOverlay.style.left = firstCell.offsetLeft + "px";
      areaEffectOverlay.style.top = firstCell.offsetTop + "px";
      areaEffectOverlay.style.width = (bottomRightCell.offsetLeft + bottomRightCell.offsetWidth - firstCell.offsetLeft) + "px";
      areaEffectOverlay.style.height = (bottomRightCell.offsetTop + bottomRightCell.offsetHeight - firstCell.offsetTop) + "px";
      areaEffectOverlay.style.setProperty("--effect-delay", "-" + effectAge + "ms");
      areaEffectOverlay.hidden = false;
    }
  }
  boardElement.appendChild(areaEffectOverlay);
  bombAimOverlay.hidden = true;
  boardElement.appendChild(bombAimOverlay);
  updateBombAim();

  turnRule.textContent = t("game.turnCount", { count: state.settings.piecesPerTurn, pieces: pieceForm(state.settings.piecesPerTurn) });
  privacyNote.lastChild.textContent = " " + t(state.settings.freeStartingPositions ? "privacy.hidden" : "privacy.corners");

  if (state.phase === "setup-x") {
    statusElement.textContent = t("game.statusX");
    turnElement.textContent = t("board.preparingTurn");
    turnProgress.hidden = true;
    sideTitle.textContent = t("game.choosePlayer", { player: "X" });
    sideDescription.textContent = t("game.pickStartX");
  } else if (state.phase === "setup-o") {
    statusElement.textContent = t("game.statusO");
    turnElement.textContent = t("game.hiddenChoice");
    turnProgress.hidden = true;
    sideTitle.textContent = t("game.choosePlayer", { player: "O" });
    sideDescription.textContent = t("game.pickStartO");
  } else if (state.phase === "playing") {
    statusElement.textContent = t("game.statusTurn", { player: state.currentPlayer });
    turnElement.textContent = t("game.left", { left: state.piecesLeft, total: state.settings.piecesPerTurn });
    turnProgress.hidden = false;
    piecesLeftCount.textContent = String(state.piecesLeft);
    piecesTotalCount.textContent = t("game.piecesTotal", { total: state.settings.piecesPerTurn });
    turnProgressFill.style.width = (state.piecesLeft / state.settings.piecesPerTurn * 100) + "%";
    turnProgressBar.setAttribute("aria-valuemax", String(state.settings.piecesPerTurn));
    turnProgressBar.setAttribute("aria-valuenow", String(state.piecesLeft));
    turnPlayerLabel.textContent = state.currentPlayer;
    turnProgress.dataset.player = state.currentPlayer;
    turnProgress.classList.toggle("turn-progress-low", state.piecesLeft <= Math.ceil(state.settings.piecesPerTurn / 3));
    sideTitle.textContent = t("game.sideTurn", { player: state.currentPlayer });
    sideDescription.textContent = t("game.sideHelp");
  } else {
    statusElement.textContent = t("game.finished");
    turnElement.textContent = t("game.playAgain");
    turnProgress.hidden = true;
    sideTitle.textContent = t("game.sideFinished");
    sideDescription.textContent = t("game.sideFinishedHelp");
  }

  messageElement.textContent = formatMessage(state.message);
  syncBoardGeometry();
  renderClock();
  renderInventories();
}

function updateBombAim() {
  const selected = state && state.phase === "playing" ? getSelectedAbility(state) : null;
  const cell = bombAimCell
    ? boardElement.querySelector('.cell[data-row="' + bombAimCell.row + '"][data-col="' + bombAimCell.col + '"]')
    : null;
  if (!selected || (selected.type !== "bomb" && selected.type !== "antiBomb") || !cell) {
    bombAimOverlay.hidden = true;
    return;
  }
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (!isValidAreaTarget(state, row, col)) {
    bombAimOverlay.hidden = true;
    return;
  }
  const bottomRightCell = boardElement.querySelector('.cell[data-row="' + (row + 1) + '"][data-col="' + (col + 1) + '"]');
  if (!bottomRightCell) {
    bombAimOverlay.hidden = true;
    return;
  }
  bombAimOverlay.style.left = cell.offsetLeft + "px";
  bombAimOverlay.style.top = cell.offsetTop + "px";
  bombAimOverlay.style.width = (bottomRightCell.offsetLeft + bottomRightCell.offsetWidth - cell.offsetLeft) + "px";
  bombAimOverlay.style.height = (bottomRightCell.offsetTop + bottomRightCell.offsetHeight - cell.offsetTop) + "px";
  bombAimOverlay.classList.toggle("is-antibomb", selected.type === "antiBomb");
  bombAimOverlay.hidden = false;
}
boardElement.addEventListener("pointermove", (event) => {
  let cell = event.target.closest?.(".cell") || null;
  if (!cell) {
    const boardRect = boardElement.getBoundingClientRect();
    const boardStyle = getComputedStyle(boardElement);
    const firstCell = boardElement.querySelector(".cell");
    if (firstCell && event.clientX >= boardRect.left && event.clientX <= boardRect.right
      && event.clientY >= boardRect.top && event.clientY <= boardRect.bottom) {
      const gapX = parseFloat(boardStyle.columnGap) || 0;
      const gapY = parseFloat(boardStyle.rowGap) || 0;
      const cellRect = firstCell.getBoundingClientRect();
      const cellWidth = cellRect.width;
      const cellHeight = cellRect.height;
      const left = boardRect.left + boardElement.clientLeft + (parseFloat(boardStyle.paddingLeft) || 0);
      const top = boardRect.top + boardElement.clientTop + (parseFloat(boardStyle.paddingTop) || 0);
      const relativeX = event.clientX - left;
      const relativeY = event.clientY - top;
      const col = Math.floor(relativeX / (cellWidth + gapX));
      const row = Math.floor(relativeY / (cellHeight + gapY));
      const inCellX = relativeX >= 0 && relativeX % (cellWidth + gapX) <= cellWidth;
      const inCellY = relativeY >= 0 && relativeY % (cellHeight + gapY) <= cellHeight;
      if (inCellX && inCellY && row < state.settings.height && col < state.settings.width) {
        cell = boardElement.querySelector('.cell[data-row="' + row + '"][data-col="' + col + '"]');
      }
    }
  }
  bombAimCell = cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
  updateBombAim();
});
boardElement.addEventListener("pointerleave", () => { bombAimCell = null; bombAimOverlay.hidden = true; });

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
  piecesMaxHint.textContent = t("settings.maxPieces", { count: maxPieces });
}

function syncTimeLimitSettings() {
  const unlimitedTime = unlimitedTimeToggle.checked;
  clockMinutesInput.disabled = unlimitedTime;
  clockIncrementInput.disabled = unlimitedTime;
  timeControlFields.setAttribute("aria-disabled", String(unlimitedTime));
  timeLimitHint.textContent = t(unlimitedTime ? "time.stopped" : "time.running");
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
      showFieldError(input, error, t("validation.dimension", { min: MIN_BOARD_DIMENSION, max: MAX_BOARD_DIMENSION }));
      return false;
    }
    clearFieldError(input, error);
    return true;
  }

  const width = Number(widthInput.value);
  const height = Number(heightInput.value);
  const maxPieces = maxPiecesFor(width, height);
  if (!Number.isInteger(value) || value < 1 || value > maxPieces) {
    showFieldError(input, piecesError, t("validation.pieces", { max: maxPieces }));
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
  animationsToggle.checked = settings.animationsEnabled;
  adminModeToggle.checked = settings.adminMode;
  freeStartToggle.checked = settings.freeStartingPositions;
  syncTimeLimitSettings();
  toggleHint.textContent = t(freeStartToggle.checked ? "start.hidden" : "start.corners");
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
  const animationsEnabled = animationsToggle.checked;
  const adminMode = adminModeToggle.checked;
  const clockMinutes = unlimitedTime ? settings.clockMinutes : Number(clockMinutesInput.value);
  const incrementSeconds = unlimitedTime ? settings.incrementSeconds : Number(clockIncrementInput.value);
  let firstInvalid = null;
  if (!Number.isInteger(width) || width < MIN_BOARD_DIMENSION || width > MAX_BOARD_DIMENSION) {
    showFieldError(widthInput, widthError, t("validation.dimension", { min: MIN_BOARD_DIMENSION, max: MAX_BOARD_DIMENSION }));
    firstInvalid = firstInvalid || widthInput;
  }
  if (!Number.isInteger(height) || height < MIN_BOARD_DIMENSION || height > MAX_BOARD_DIMENSION) {
    showFieldError(heightInput, heightError, t("validation.dimension", { min: MIN_BOARD_DIMENSION, max: MAX_BOARD_DIMENSION }));
    firstInvalid = firstInvalid || heightInput;
  }
  const maxPieces = maxPiecesFor(width, height);
  if (!Number.isInteger(piecesPerTurn) || piecesPerTurn < 1 || piecesPerTurn > maxPieces) {
    showFieldError(piecesInput, piecesError, t("validation.piecesArea", { max: maxPieces }));
    firstInvalid = firstInvalid || piecesInput;
  }
  if (!unlimitedTime && (!Number.isInteger(clockMinutes) || clockMinutes < 1 || clockMinutes > 60)) {
    showFieldError(clockMinutesInput, clockMinutesError, t("validation.minutes"));
    firstInvalid = firstInvalid || clockMinutesInput;
  }
  if (!unlimitedTime && (!Number.isInteger(incrementSeconds) || incrementSeconds < 0 || incrementSeconds > 60)) {
    showFieldError(clockIncrementInput, clockIncrementError, t("validation.increment"));
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
    animationsEnabled,
    freeStartingPositions: freeStartToggle.checked,
    adminMode
  };
  document.documentElement.dataset.gameAnimations = animationsEnabled ? "on" : "off";
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
    showFieldError(clockMinutesInput, clockMinutesError, t("validation.minutes"));
  } else {
    clearFieldError(clockMinutesInput, clockMinutesError);
  }
});
clockIncrementInput.addEventListener("input", () => {
  const value = Number(clockIncrementInput.value);
  if (!Number.isInteger(value) || value < 0 || value > 60) {
    showFieldError(clockIncrementInput, clockIncrementError, t("validation.increment"));
  } else {
    clearFieldError(clockIncrementInput, clockIncrementError);
  }
});
freeStartToggle.addEventListener("change", () => {
  toggleHint.textContent = t(freeStartToggle.checked ? "start.hidden" : "start.corners");
});
settingsButton.addEventListener("click", openSettings);
rulesButton.addEventListener("click", () => rulesModal.showModal());
rulesCloseButton.addEventListener("click", () => rulesModal.close());
settingsCloseButton.addEventListener("click", () => settingsModal.close());
settingsCancelButton.addEventListener("click", () => settingsModal.close());
settingsForm.addEventListener("submit", applySettings);
resultModal.addEventListener("cancel", (event) => event.preventDefault());
resultNewGameButton.addEventListener("click", setupGame);
resignButton.addEventListener("click", () => {
  if (state.phase !== "playing") return;
  resignConfirmModal.showModal();
  resignCancelButton.focus();
});
resignCancelButton.addEventListener("click", () => resignConfirmModal.close());
resignConfirmButton.addEventListener("click", () => {
  if (state.phase !== "playing") {
    resignConfirmModal.close();
    return;
  }
  resignConfirmModal.close();
  updateState(resign(state));
});
for (const player of ["X", "O"]) {
  inventoryElements[player].addEventListener("click", (event) => {
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.disabled || state.currentPlayer !== player) return;
    updateState(selectAbility(state, Number(slot.dataset.itemId)));
  });
}
languageSelect.value = getLanguage();
applyTranslations();
languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));
document.addEventListener("languagechange", () => {
  applyTranslations();
  languageSelect.value = getLanguage();
  if (state) {
    render();
    if (state.phase === "finished" && resultModal.open) showResult();
  }
  syncTimeLimitSettings();
  toggleHint.textContent = t(freeStartToggle.checked ? "start.hidden" : "start.corners");
  updatePiecesLimit();
  if (widthInput.getAttribute("aria-invalid") === "true") validateField(widthInput);
  if (heightInput.getAttribute("aria-invalid") === "true") validateField(heightInput);
  if (piecesInput.getAttribute("aria-invalid") === "true") validateField(piecesInput);
  if (clockMinutesInput.getAttribute("aria-invalid") === "true") {
    showFieldError(clockMinutesInput, clockMinutesError, t("validation.minutes"));
  }
  if (clockIncrementInput.getAttribute("aria-invalid") === "true") {
    showFieldError(clockIncrementInput, clockIncrementError, t("validation.increment"));
  }
});
adminItemList.addEventListener("click", (event) => {
  const button = event.target.closest(".admin-item-button");
  if (!button || !hasPermission(state, state.currentPlayer, PLAYER_PERMISSIONS.USE_ANY_ITEM)) return;
  updateState(selectAbility(state, button.dataset.itemId));
});
startButton.addEventListener("click", setupGame);
setupGame();
if (typeof ResizeObserver === "function") {
  new ResizeObserver(syncBoardGeometry).observe(boardRow);
} else {
  window.addEventListener("resize", syncBoardGeometry);
}
