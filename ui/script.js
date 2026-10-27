import {
  BLOCKED_CELL,
  DEFAULT_SETTINGS,
  EVENT_ITEMS,
  MAX_BOARD_DIMENSION,
  MIN_BOARD_DIMENSION,
  EMPTY_CELL,
  chooseStart,
  chooseAbilityTarget,
  cancelAbilitySelection,
  createGameState,
  finishIfNoLegalMoves,
  flagFall,
  getLegalMoves,
  getSelectedAbility,
  isItemEnabled,
  hasPermission,
  isValidAreaTarget,
  isValidDebrisTarget,
  isValidPointDestroyTarget,
  isValidShieldTarget,
  placeEditorObject,
  placeEditorWormholePair,
  playMove,
  PLAYER_PERMISSIONS,
  resign,
  selectAbility,
  useBomb,
  useAntiBomb,
  usePointDestroy
} from "./game.js?v=cascade-package1";
import { chooseComputerAction, applyComputerAction } from "./ai.js?v=random-artifact1";
import { applyTranslations, getLanguage, pieceForm, setLanguage, t } from "./i18n.js?v=account-entry1";
import { resolveClockSettings } from "./settings.js?v=20261021-rulesfix1";
import { resolveSettingsRestart } from "./restart.js?v=restart-consensus1";
import { createTrainingBoard, TRAINING_BOARD_SIZE, TRAINING_LESSONS } from "./training.js?v=20261018-menu12";
import { MultiplayerClient } from "./multiplayer.js?v=restart-consensus1";
import { AccountsClient, logAccountDiagnostic, submitAccountCredentials } from "./accounts.js?v=account-proxy2";
import { TurnUndoHistory } from "./turn-undo.js?v=turn-undo1";
import { downloadBoardPng, downloadMapJson } from "./export.js?v=final-export1";
import { getItemCategory, getItemCategoryLocalizationKey } from "./item-categories.js?v=visual-polish1";
import { copySupportCardNumber, isPublicSupportCardNumber } from "./support.js?v=support-card1";
import {
  appendHistoryEntry,
  createHistoryEntry,
  createUndoHistoryEntry,
  restoreHistoryPosition
} from "./history.js?v=game-history1";

const boardElement = document.querySelector(".game-board");
const boardShell = document.querySelector(".board-shell");
const boardRow = document.querySelector(".board-row");
const topAxis = document.querySelector(".axis-top");
const sideAxis = document.querySelector(".axis-side");
const statusElement = document.querySelector("#game-status");
const messageElement = document.querySelector("#game-message");
const turnElement = document.querySelector("#turn-counter");
const roundCounter = document.querySelector("#round-counter");
const historyCard = document.querySelector("#history-card");
const historyList = document.querySelector("#history-list");
const historyNotice = document.querySelector("#history-notice");
const historyLiveButton = document.querySelector("#history-live-button");
const turnProgress = document.querySelector("#turn-progress");
const piecesLeftCount = document.querySelector("#pieces-left-count");
const piecesTotalCount = document.querySelector("#pieces-total-count");
const turnProgressFill = document.querySelector("#turn-progress-fill");
const turnPlayerLabel = document.querySelector("#turn-player-label");
const turnProgressBar = turnProgress.querySelector('[role="progressbar"]');
const startButton = document.querySelector("#start-button");
const languageSelect = document.querySelector("#language-select");
const supportBank = document.querySelector("#support-bank");
const supportCardNumberElement = document.querySelector("#support-card-number");
const supportPending = document.querySelector("#support-pending");
const supportCopyButton = document.querySelector("#support-copy-card");
const supportCopyStatus = document.querySelector("#support-copy-status");
const supportModal = document.querySelector("#support-modal");
const supportOpenButton = document.querySelector("#support-open-button");
const supportModalCloseButton = document.querySelector("#support-modal-close");
const supportCardNumber = isPublicSupportCardNumber(globalThis.VIRUSES_SUPPORT_CARD_NUMBER)
  ? globalThis.VIRUSES_SUPPORT_CARD_NUMBER
  : "";
const mainMenuScreen = document.querySelector("#main-menu-screen");
const gameScreen = document.querySelector("#game-screen");
const localGameButton = document.querySelector("#local-game-button");
const computerGameButton = document.querySelector("#computer-game-button");
const onlineGameButton = document.querySelector("#online-game-button");
const onlineRoomModal = document.querySelector("#online-room-modal");
const onlinePublicRoomToggle = document.querySelector("#online-public-room");
const activeGamesPage = document.querySelector("#active-games-page");
const activeGamesRows = document.querySelector("#active-games-rows");
const activeGamesStatus = document.querySelector("#active-games-status");
const activeGamesRefresh = document.querySelector("#active-games-refresh");
const onlineRoomCloseButton = document.querySelector("#online-room-close");
const onlineCreateRoomButton = document.querySelector("#online-create-room");
const onlineBoardWidthInput = document.querySelector("#online-board-width");
const onlineBoardHeightInput = document.querySelector("#online-board-height");
const onlinePiecesInput = document.querySelector("#online-pieces-per-turn");
const onlineClockMinutesInput = document.querySelector("#online-clock-minutes");
const onlineClockIncrementInput = document.querySelector("#online-clock-increment");
const onlineUnlimitedTimeToggle = document.querySelector("#online-unlimited-time");
const onlineRandomEventsToggle = document.querySelector("#online-random-events");
const onlineUnlimitedItemLifetimeToggle = document.querySelector("#online-unlimited-item-lifetime");
const onlineItemLifetimeField = document.querySelector("#online-item-lifetime-field");
const onlineItemLifetimeInput = document.querySelector("#online-item-lifetime-turns");
const onlineItemSpawnMode = document.querySelector("#online-item-spawn-mode");
const onlineItemSpawnModeHelp = document.querySelector("#online-item-spawn-mode-help");
const onlineWormholesToggle = document.querySelector("#online-wormholes");
const onlineFreeStartToggle = document.querySelector("#online-free-start");
const onlineItemOptions = document.querySelector("#online-item-options");
const onlineJoinForm = document.querySelector("#online-join-form");
const onlineRoomCodeInput = document.querySelector("#online-room-code");
const onlineResumeButton = document.querySelector("#online-resume-room");
const onlineRoomEntry = document.querySelector("#online-room-entry");
const onlineRoomLobby = document.querySelector("#online-room-lobby");
const onlineRoomStatus = document.querySelector("#online-room-status");
const onlineRoomCodeValue = document.querySelector("#online-room-code-value");
const onlinePlayerSide = document.querySelector("#online-player-side");
const onlineCopyCodeButton = document.querySelector("#online-copy-code");
const onlineCopyLinkButton = document.querySelector("#online-copy-link");
const onlineReturnMenuButton = document.querySelector("#online-return-menu");
const onlineErrorElement = document.querySelector("#online-error");
const onlineGameStatus = document.querySelector("#online-game-status");
const computerDifficultyModal = document.querySelector("#computer-difficulty-modal");
const computerDifficultyCancelButton = document.querySelector("#computer-difficulty-cancel");
const trainingButton = document.querySelector("#training-mode-button");
const returnMenuButton = document.querySelector("#return-menu-button");
const menuSettingsButton = document.querySelector("#menu-settings-button");
const menuSettingsModal = document.querySelector("#menu-settings-modal");
const menuSettingsCloseButton = document.querySelector("#menu-settings-close");
const menuSettingsDoneButton = document.querySelector("#menu-settings-done");
const menuAnimationsToggle = document.querySelector("#menu-animations-toggle");
const menuNotice = document.querySelector("#menu-notice");
const accountActionButton = document.querySelector("#account-action");
const accountModal = document.querySelector("#account-modal");
const accountModalClose = document.querySelector("#account-modal-close");
const accountLoginForm = document.querySelector("#account-login-form");
const accountRegisterForm = document.querySelector("#account-register-form");
const accountAuthTabs = document.querySelector("#account-auth-tabs");
const accountAuthForms = document.querySelector("#account-auth-forms");
const accountProfile = document.querySelector("#account-profile");
const accountStatus = document.querySelector("#account-status");
const accountHeaderName = document.querySelector("#account-header-name");
const accountHeaderDetail = document.querySelector("#account-header-detail");
const leaderboardList = document.querySelector("#leaderboard-list");
const leaderboardStatus = document.querySelector("#leaderboard-status");
const accountsClient = new AccountsClient();
let currentAccount = null;
let accountSubmitting = false;
const menuCanvas = document.querySelector("#menu-ambient");
const menuCanvasContext = menuCanvas.getContext("2d");
const menuDuelCanvas = document.querySelector("#menu-duel");
const menuDuelContext = menuDuelCanvas.getContext("2d");
const demoCard = document.querySelector(".demo-card");
const demoBoard = document.querySelector(".demo-training-frames");
const demoFrames = [...document.querySelectorAll(".demo-training-frame")];
const demoSceneButtons = [...document.querySelectorAll(".demo-progress-segment[data-demo-index]")];
const sideTitle = document.querySelector("#side-title");
const sideDescription = document.querySelector("#side-description");
const pageTitle = document.querySelector("#page-title");
const tutorialPanel = document.querySelector("#tutorial-panel");
const tutorialStep = document.querySelector("#tutorial-step");
const tutorialProgressFill = document.querySelector("#tutorial-progress-fill");
const tutorialTitle = document.querySelector("#tutorial-title");
const tutorialDescription = document.querySelector("#tutorial-description");
const tutorialHint = document.querySelector("#tutorial-hint");
const tutorialAction = document.querySelector("#tutorial-action");
const clockHeading = document.querySelector(".clock-card > .eyebrow");
const currentTurnCard = document.querySelector("#current-turn-card");
const privacyNote = document.querySelector("#privacy-note");
const turnRule = document.querySelector("#rules-turn-count");
const resultModal = document.querySelector("#result-modal");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const resultRoast = document.querySelector("#result-roast");
const resultNewGameButton = document.querySelector("#result-new-game");
const resultRematchButton = document.querySelector("#result-rematch");
const resultRematchStatus = document.querySelector("#result-rematch-status");
const resultExportPngButton = document.querySelector("#result-export-png");
const resultExportJsonButton = document.querySelector("#result-export-json");
const resultExportStatus = document.querySelector("#result-export-status");
const restartConfirmModal = document.querySelector("#restart-confirm-modal");
const restartConfirmButton = document.querySelector("#restart-confirm");
const restartCancelButton = document.querySelector("#restart-cancel");
const restartProposalModal = document.querySelector("#restart-proposal-modal");
const restartProposalDescription = document.querySelector("#restart-proposal-description");
const restartProposalAcceptButton = document.querySelector("#restart-proposal-accept");
const restartProposalDeclineButton = document.querySelector("#restart-proposal-decline");
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
const unlimitedItemLifetimeToggle = document.querySelector("#unlimited-item-lifetime-toggle");
const itemLifetimeField = document.querySelector("#item-lifetime-field");
const itemLifetimeInput = document.querySelector("#item-lifetime-turns-input");
const itemSpawnModeSelect = document.querySelector("#item-spawn-mode");
const itemSpawnModeHelp = document.querySelector("#item-spawn-mode-help");
const wormholesToggle = document.querySelector("#wormholes-toggle");
const adminModeToggle = document.querySelector("#admin-mode-toggle");
const itemOptions = document.querySelector("#item-options");
const adminTools = document.querySelector("#admin-tools");
const adminItemList = document.querySelector("#admin-item-list");
const adminTimeControls = document.querySelector("#admin-time-controls");
const adminTitle = document.querySelector("#admin-title");
const adminHelp = document.querySelector("#admin-help");
const boardEditorToggle = document.querySelector("#board-editor-toggle");
const boardEditorControls = document.querySelector("#board-editor-controls");
const boardEditorTools = document.querySelector("#board-editor-tools");
const boardEditorStatus = document.querySelector("#board-editor-status");
const boardEditorCancel = document.querySelector("#board-editor-cancel");
const boardEditorExit = document.querySelector("#board-editor-exit");
const adminAuthModal = document.querySelector("#admin-auth-modal");
const adminAuthForm = document.querySelector("#admin-auth-form");
const adminSecretInput = document.querySelector("#admin-secret-input");
const adminAuthError = document.querySelector("#admin-auth-error");
const adminAuthCancel = document.querySelector("#admin-auth-cancel");
const adminAuthSubmit = document.querySelector("#admin-auth-submit");
const animationsToggle = document.querySelector("#animations-toggle");
const timeLimitHint = document.querySelector("#time-limit-hint");
const timeControlFields = document.querySelector(".settings-time-control");
const clockXElement = document.querySelector("#clock-x");
const clockOElement = document.querySelector("#clock-o");
const clockPlayerX = document.querySelector("#clock-player-x");
const clockPlayerO = document.querySelector("#clock-player-o");
const clockPlayerOName = document.querySelector("#clock-player-o .clock-player-name span");
const clockAddTimeButtons = [...document.querySelectorAll("[data-clock-add-time]")];
const clockControlSummary = document.querySelector("#clock-control-summary");
const resignButton = document.querySelector("#resign-button");
const undoTurnButton = document.querySelector("#undo-turn-button");
const undoRiskNote = document.querySelector("#undo-risk-note");
const undoProposalModal = document.querySelector("#undo-proposal-modal");
const undoProposalDescription = document.querySelector("#undo-proposal-description");
const undoProposalAcceptButton = document.querySelector("#undo-proposal-accept");
const undoProposalDeclineButton = document.querySelector("#undo-proposal-decline");
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
const remoteAimOverlay = document.createElement("div");
remoteAimOverlay.className = "remote-aim-overlay";
remoteAimOverlay.hidden = true;
remoteAimOverlay.setAttribute("aria-hidden", "true");
const EVENT_ITEM_DEFINITIONS = {
  bomb: { nameKey: "item.bomb", icon: "/ui/assets/items/bomb.svg" },
  freePlacement: { nameKey: "item.freePlacement", icon: "/ui/assets/items/free-placement.svg" },
  extraTurn: { nameKey: "item.extraTurn", icon: "/ui/assets/items/extra-turn.svg" },
  antiBomb: { nameKey: "item.antiBomb", icon: "/ui/assets/items/anti-bomb.svg" },
  debris: { nameKey: "item.debris", icon: "/ui/assets/items/debris.svg" },
  shield: { nameKey: "item.shield", icon: "/ui/assets/items/shield.svg" },
  gangstaShield: { nameKey: "item.gangstaShield", icon: "/ui/assets/items/gangsta-shield.svg" },
  pointDestroy: { nameKey: "item.pointDestroy", icon: "/ui/assets/items/point-destroy.svg" },
  randomArtifact: { nameKey: "item.randomArtifact", icon: "/ui/assets/items/random-artifact.svg" },
  exchange: { nameKey: "item.exchange", icon: "/ui/assets/items/exchange.svg" }
};

function renderItemOptions(container, disabledItems = []) {
  container.replaceChildren();
  for (const type of EVENT_ITEMS) {
    const definition = EVENT_ITEM_DEFINITIONS[type];
    const category = getItemCategory(type);
    const categoryKey = getItemCategoryLocalizationKey(type);
    const label = document.createElement("label");
    label.className = "item-option";
    label.dataset.itemCategory = category;
    label.title = t(categoryKey);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.itemType = type;
    input.checked = !disabledItems.includes(type);
    const icon = document.createElement("img");
    icon.src = definition.icon;
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "item-option-name";
    name.textContent = t(definition.nameKey);
    const categoryBadge = document.createElement("span");
    categoryBadge.className = "item-category-chip item-option-category";
    categoryBadge.textContent = t(categoryKey);
    label.append(input, icon, name, categoryBadge);
    container.append(label);
  }
}

function updateSpawnModeHelp(select, element) {
  if (select && element) element.textContent = t(`settings.spawnMode.${select.value}.help`);
}

function decorateRuleItemCards() {
  for (const card of document.querySelectorAll(".rules-item-card[data-item-type]")) {
    const categoryKey = getItemCategoryLocalizationKey(card.dataset.itemType);
    const category = getItemCategory(card.dataset.itemType);
    const heading = card.querySelector("h4");
    if (!category || !heading) continue;
    card.dataset.itemCategory = category;
    let badge = card.querySelector(".item-category-chip");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "item-category-chip rules-item-category";
      heading.before(badge);
    }
    badge.textContent = t(categoryKey);
  }
}

function disabledItemsFrom(container) {
  return [...container.querySelectorAll("input[data-item-type]")]
    .filter((input) => !input.checked)
    .map((input) => input.dataset.itemType);
}
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
let moveHistory = [];
let historyViewId = null;
let localHistoryId = 0;
let newlyPlacedCells = new Map();
let newlySpawnedItems = new Map();
const expiringItems = new Map();
let newlySpawnedWormholes = new Map();
let activeAreaEffect = null;
let bombAimCell = null;
let remoteAim = null;
let lastSentAim = null;
let lastSentAimAt = 0;
let clockRemaining = { X: settings.clockMinutes * 60_000, O: settings.clockMinutes * 60_000 };
let clockInterval = null;
let clockLastTick = null;
let menuNoticeTimeout = null;
let menuNoticeTranslation = null;
let menuAnimationFrame = null;
let menuAnimationLastFrame = 0;
let ambientNodes = [];
let duelPositions = { X: null, O: null };
let duelDragPlayer = null;
let duelLastTime = 0;
let duelPhysicsLastTime = null;
let duelDragPoint = null;
let duelDragTarget = null;
let duelDragAngle = 0;
let ambientDragNode = null;
let ambientDragPoint = null;
let ambientDragTarget = null;
let menuDragFrame = null;
let menuDragLastTime = null;
let trainingSession = null;
let trainingSavedSettings = null;
let boardEditorActive = false;
let boardEditorTool = null;
let boardEditorFirstWormholeCell = null;
let boardEditorMessageKey = null;
let computerOpponent = { enabled: false, difficulty: "easy" };
let onlineMode = false;
let onlineSide = null;
let onlineRoomCode = null;
let onlineRoomId = null;
let onlineObserverMode = false;
let onlineAdminObserver = false;
let onlineConnected = false;
let onlineAdminAuthenticated = false;
let pendingBoardEdit = false;
let onlineCommandPending = false;
let onlinePreviousSettings = null;
let onlineStatusKey = null;
let onlineStatusError = null;
let onlineClockSnapshot = null;
let onlineClockReceivedAt = null;
let timeBoostPending = false;
let onlineMenuError = null;
let pendingSettings = null;
let incomingRestartProposal = null;
let incomingUndoProposal = null;
let localUndoConfirmation = false;
let onlineUndoAvailable = false;
let onlineUndoPending = false;
const localUndoHistory = new TurnUndoHistory({ preserveCompletedTurns: true });
const multiplayerClient = new MultiplayerClient();
let gameSessionId = 0;
let computerActionToken = 0;
let computerActionTimer = null;
const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let screenTransitionTimer = null;
let screenTransitionId = 0;
const SCREEN_TRANSITION_MS = 170;

function transitionScreens(showGame) {
  const target = showGame ? gameScreen : mainMenuScreen;
  const outgoing = showGame ? mainMenuScreen : gameScreen;
  const shouldAnimate = !reduceMotionQuery.matches && !outgoing.hidden;
  if (screenTransitionTimer !== null) window.clearTimeout(screenTransitionTimer);
  screenTransitionTimer = null;
  const transitionId = ++screenTransitionId;
  for (const screen of [target, outgoing]) {
    screen.classList.remove("screen-entering", "screen-exiting");
  }
  target.hidden = false;
  target.inert = false;
  if (!shouldAnimate) {
    outgoing.hidden = true;
    outgoing.inert = false;
    return;
  }
  outgoing.inert = true;
  target.classList.add("screen-entering");
  if (!outgoing.hidden) outgoing.classList.add("screen-exiting");
  screenTransitionTimer = window.setTimeout(() => {
    if (transitionId !== screenTransitionId) return;
    outgoing.hidden = true;
    outgoing.inert = false;
    target.classList.remove("screen-entering");
    outgoing.classList.remove("screen-exiting");
    screenTransitionTimer = null;
  }, SCREEN_TRANSITION_MS);
}

document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";

function invalidateComputerAction() {
  computerActionToken += 1;
  if (computerActionTimer !== null) window.clearTimeout(computerActionTimer);
  computerActionTimer = null;
}

function beginGameSession() {
  invalidateComputerAction();
  gameSessionId += 1;
  expiringItems.clear();
}

function isComputerControlledTurn() {
  return Boolean(computerOpponent.enabled && state
    && (state.phase === "setup-o" || (state.phase === "playing" && state.currentPlayer === "O")));
}

function canHumanAct() {
  if (!state || state.phase === "finished") return false;
  if (onlineMode) {
    if (!onlineConnected || onlineCommandPending || onlineUndoPending || !onlineSide) return false;
    if (state.phase === "setup-x" || state.phase === "setup-o") return state.setupPlayer === onlineSide;
    return state.phase === "playing" && state.currentPlayer === onlineSide;
  }
  if (state.phase === "setup-x") return true;
  return !isComputerControlledTurn();
}

function sendOnlineCommand(command) {
  if (historyViewId !== null) return false;
  const allowedAdminAction = onlineMode && onlineAdminAuthenticated && onlineConnected
    && !onlineCommandPending && !onlineUndoPending;
  if (!onlineMode || (!canHumanAct() && !allowedAdminAction)) return false;
  if (!multiplayerClient.sendCommand(command)) {
    onlineConnected = false;
    onlineStatusKey = "online.disconnected";
    render();
    return false;
  }
  onlineCommandPending = true;
  render();
  return true;
}

function performGameAction(command, transition) {
  if (onlineMode) return sendOnlineCommand(command);
  updateState(transition(), { command, side: state.currentPlayer });
  return true;
}

function scheduleComputerAction() {
  if (!isComputerControlledTurn() || computerActionTimer !== null) return;
  const expectedState = state;
  const expectedSession = gameSessionId;
  const expectedToken = ++computerActionToken;
  const timerId = window.setTimeout(() => {
    if (computerActionTimer === timerId) computerActionTimer = null;
    if (expectedToken !== computerActionToken
      || expectedSession !== gameSessionId
      || state !== expectedState
      || !isComputerControlledTurn()) return;

    if (state.phase === "setup-o") executeComputerStart();
    else executeComputerPlacement();
  }, 180);
  computerActionTimer = timerId;
}

function executeComputerStart() {
  const { row: humanRow, col: humanCol } = state.startChoices.X || {};
  const candidates = [];
  for (let row = 0; row < state.settings.height; row += 1) {
    for (let col = 0; col < state.settings.width; col += 1) {
      if (row !== humanRow || col !== humanCol) candidates.push({ row, col });
    }
  }
  if (candidates.length === 0) return;
  const start = candidates[Math.floor(Math.random() * candidates.length)];
  const next = chooseStart(state, start.row, start.col);
  if (next !== state) updateState(next);
}

function executeComputerPlacement() {
  const decisionState = state;
  const action = chooseComputerAction(decisionState, computerOpponent.difficulty);
  if (state !== decisionState || state.phase !== "playing" || state.currentPlayer !== "O") return;

  if (action.type === "no-legal-move") {
    if (action.reason === "ability-targeting" && state.selectedAbility !== null) {
      const cleared = selectAbility(state, state.selectedAbility);
      if (cleared !== state) {
        updateState(cleared);
        return;
      }
    }
    const finished = finishIfNoLegalMoves(state);
    if (finished !== state) updateState(finished);
    else messageElement.textContent = t("computer.error");
    return;
  }

  const next = applyComputerAction(state, action);
  if (next === state) {
    const finished = finishIfNoLegalMoves(state);
    if (finished !== state) updateState(finished);
    else messageElement.textContent = t("computer.error");
    return;
  }
  updateState(next);
}

function scheduleMenuDragRender() {
  const continuousAnimation = settings.animationsEnabled && !reduceMotionQuery.matches && menuAnimationFrame !== null;
  if (continuousAnimation || menuDragFrame !== null) return;
  menuDragFrame = requestAnimationFrame((timestamp) => {
    menuDragFrame = null;
    const elapsed = menuDragLastTime === null ? 0 : Math.min(50, timestamp - menuDragLastTime);
    menuDragLastTime = timestamp;
    if (ambientDragNode) advanceAmbientNodes(elapsed, timestamp);
    drawMenuAmbient();
    drawDuelScene(timestamp);
  });
}

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
  const onlineElapsed = onlineMode && onlineClockReceivedAt !== null
    ? Math.max(0, performance.now() - onlineClockReceivedAt)
    : 0;
  const shownClock = (player) => {
    if (!onlineMode || settings.unlimitedTime) return clockRemaining[player];
    const serverRemaining = onlineClockSnapshot?.remainingMs?.[player];
    if (!Number.isFinite(serverRemaining)) return clockRemaining[player];
    return Math.max(0, serverRemaining - (onlineClockSnapshot.activePlayer === player ? onlineElapsed : 0));
  };
  clockXElement.hidden = false;
  clockOElement.hidden = false;
  clockXElement.textContent = settings.unlimitedTime ? "∞" : formatClock(shownClock("X"));
  clockOElement.textContent = settings.unlimitedTime ? "∞" : formatClock(shownClock("O"));
  clockControlSummary.textContent = settings.unlimitedTime
    ? t("clock.unlimited")
    : t("clock.summary", { minutes: settings.clockMinutes, seconds: settings.incrementSeconds });
  const xActive = state && state.phase === "playing" && state.currentPlayer === "X";
  const oActive = state && state.phase === "playing" && state.currentPlayer === "O";
  clockPlayerX.classList.toggle("clock-active", xActive);
  clockPlayerO.classList.toggle("clock-active", oActive);
  clockPlayerOName.textContent = t(computerOpponent.enabled ? "computer.player" : "player.o");
  currentTurnCard.classList.toggle("turn-active", state && state.phase !== "finished");
  clockXElement.classList.toggle("clock-low", !settings.unlimitedTime && shownClock("X") <= 10_000);
  clockOElement.classList.toggle("clock-low", !settings.unlimitedTime && shownClock("O") <= 10_000);
  for (const button of clockAddTimeButtons) {
    const targetSide = button.dataset.clockAddTime;
    button.hidden = !onlineMode || !onlineSide || targetSide === onlineSide || !onlineClockSnapshot?.enabled
      || state?.phase !== "playing";
    button.disabled = timeBoostPending || !onlineConnected || onlineCommandPending || onlineUndoPending;
  }
  resignButton.disabled = historyViewId !== null || !state || state.phase !== "playing" || !canHumanAct();
  const localUndoSide = computerOpponent.enabled ? "X" : null;
  const localUndoAvailable = !onlineMode && !trainingSession && historyViewId === null && state?.phase === "playing"
    && localUndoHistory.canUndo(localUndoSide, { latestOnly: !computerOpponent.enabled });
  undoTurnButton.hidden = !(onlineMode ? onlineUndoAvailable : localUndoAvailable);
  undoRiskNote.hidden = undoTurnButton.hidden;
  undoTurnButton.disabled = historyViewId !== null || !state || state.phase !== "playing"
    || (onlineMode && (!onlineConnected || onlineCommandPending || onlineUndoPending));
}

function renderInventories(displayState = state) {
  const state = displayState;
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
        delete slot.dataset.itemCategory;
        slot.setAttribute("aria-label", t("inventory.empty"));
        slot.removeAttribute("title");
        return;
      }

      const definition = EVENT_ITEM_DEFINITIONS[item.type];
      const category = getItemCategory(item.type);
      const categoryName = t(getItemCategoryLocalizationKey(item.type));
      slot.dataset.itemCategory = category;
      const icon = document.createElement("img");
      icon.src = definition.icon;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      slot.appendChild(icon);
      slot.disabled = historyViewId !== null || state.phase !== "playing" || state.currentPlayer !== player
        || item.type === "extraTurn" || !canHumanAct();
      const itemName = t(definition.nameKey);
      slot.setAttribute("aria-label", `${t(item.type === "extraTurn" ? "inventory.auto" : "inventory.choose", { name: itemName })}. ${categoryName}.`);
      slot.title = itemName + (item.type === "extraTurn"
        ? t("inventory.autoHelp")
        : item.type === "freePlacement" ? t("inventory.freeHelp") : t("inventory.useHelp"));
    });
  }
  const hasAdminItemPermission = hasPermission(state, state.currentPlayer, PLAYER_PERMISSIONS.USE_ANY_ITEM);
  const adminToolsReady = state.phase === "playing";
  adminTools.hidden = !hasAdminItemPermission && !(onlineMode && onlineAdminAuthenticated);
  adminTimeControls.hidden = !(onlineMode && onlineAdminAuthenticated);
  adminTitle.textContent = t(onlineMode ? "admin.editorTitle" : "admin.title");
  adminHelp.textContent = onlineMode
    ? t(onlineAdminAuthenticated ? "admin.editorServerHelp" : "admin.editorAuthHelp")
    : t(adminToolsReady ? "admin.help" : "admin.waiting");
  adminItemList.replaceChildren();
  const canUseAdminItems = hasAdminItemPermission || (onlineMode && onlineAdminAuthenticated);
  adminItemList.hidden = onlineMode && !onlineAdminAuthenticated;
  if (canUseAdminItems) {
    for (const type of EVENT_ITEMS) {
      if (type === "randomArtifact" || !isItemEnabled(state, type)) continue;
      const definition = EVENT_ITEM_DEFINITIONS[type];
      const itemId = "admin:" + type;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-item-button" + (state.selectedAbility === itemId ? " is-selected" : "");
      button.dataset.itemCategory = getItemCategory(type);
      button.dataset.itemId = itemId;
      button.disabled = historyViewId !== null || !adminToolsReady
        || (onlineMode ? (!onlineConnected || !onlineAdminAuthenticated || (!onlineObserverMode && !canHumanAct())) : !canHumanAct());
      const itemName = t(definition.nameKey);
      const categoryName = t(getItemCategoryLocalizationKey(type));
      button.title = `${t(adminToolsReady ? "admin.item" : "admin.itemWaiting", { name: itemName })} · ${categoryName}`;
      const icon = document.createElement("img");
      icon.src = definition.icon;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      button.setAttribute("aria-label", `${itemName}, ${categoryName}`);
      button.append(icon, document.createTextNode(itemName));
      adminItemList.appendChild(button);
    }
  }
  boardEditorToggle.hidden = onlineMode ? !onlineAdminAuthenticated : !hasAdminItemPermission;
  boardEditorControls.hidden = !boardEditorActive
    || (onlineMode ? !onlineAdminAuthenticated : !hasAdminItemPermission);
  boardEditorToggle.setAttribute("aria-pressed", String(boardEditorActive));
  boardEditorTools.replaceChildren();
  boardEditorStatus.textContent = t(boardEditorMessageKey || (boardEditorTool ? "admin.editorSelected" : "admin.editorNoTool"), {
    object: boardEditorTool?.kind === "item"
      ? t(EVENT_ITEM_DEFINITIONS[boardEditorTool.itemType].nameKey)
      : t(boardEditorTool?.kind === "clear" ? "admin.clearCell"
        : boardEditorTool?.kind === "wormhole-pair" ? "admin.addWormholes" : "admin.deadCell")
  });
  if ((hasAdminItemPermission || (onlineMode && onlineAdminAuthenticated)) && boardEditorActive) {
    for (const type of EVENT_ITEMS) {
      if (!isItemEnabled(state, type)) continue;
      const definition = EVENT_ITEM_DEFINITIONS[type];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-item-button editor-tool-button";
      button.dataset.itemCategory = getItemCategory(type);
      button.dataset.editorKind = "item";
      button.dataset.itemType = type;
      button.classList.toggle("is-selected", boardEditorTool?.kind === "item" && boardEditorTool.itemType === type);
      button.disabled = !adminToolsReady || isComputerControlledTurn()
        || (onlineMode && (!onlineConnected || onlineCommandPending || !onlineAdminAuthenticated));
      const icon = document.createElement("img");
      icon.src = definition.icon;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      const categoryName = t(getItemCategoryLocalizationKey(type));
      button.title = categoryName;
      button.setAttribute("aria-label", `${t(definition.nameKey)}, ${categoryName}`);
      button.append(icon, document.createTextNode(t(definition.nameKey)));
      boardEditorTools.appendChild(button);
    }
    const blockedButton = document.createElement("button");
    blockedButton.type = "button";
    blockedButton.className = "admin-item-button editor-tool-button";
    blockedButton.dataset.editorKind = "blocked";
    blockedButton.classList.toggle("is-selected", boardEditorTool?.kind === "blocked");
    blockedButton.disabled = !adminToolsReady || isComputerControlledTurn()
      || (onlineMode && (!onlineConnected || onlineCommandPending || !onlineAdminAuthenticated));
    const blockedIcon = document.createElement("span");
    blockedIcon.className = "legend-blocked";
    blockedIcon.textContent = "×";
    blockedIcon.setAttribute("aria-hidden", "true");
    blockedButton.append(blockedIcon, document.createTextNode(t("admin.deadCell")));
    boardEditorTools.appendChild(blockedButton);

    const wormholeButton = document.createElement("button");
    wormholeButton.type = "button";
    wormholeButton.className = "admin-item-button editor-tool-button";
    wormholeButton.dataset.editorKind = "wormhole-pair";
    wormholeButton.classList.toggle("is-selected", boardEditorTool?.kind === "wormhole-pair");
    wormholeButton.disabled = Boolean(state.wormholePair) || !adminToolsReady || isComputerControlledTurn()
      || (onlineMode && (!onlineConnected || onlineCommandPending || !onlineAdminAuthenticated));
    wormholeButton.textContent = t("admin.addWormholes");
    boardEditorTools.appendChild(wormholeButton);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "admin-item-button editor-tool-button";
    clearButton.dataset.editorKind = "clear";
    clearButton.classList.toggle("is-selected", boardEditorTool?.kind === "clear");
    clearButton.disabled = !adminToolsReady || isComputerControlledTurn()
      || (onlineMode && (!onlineConnected || onlineCommandPending || !onlineAdminAuthenticated));
    const clearIcon = document.createElement("span");
    clearIcon.className = "editor-clear-icon";
    clearIcon.textContent = "⌫";
    clearIcon.setAttribute("aria-hidden", "true");
    clearButton.append(clearIcon, document.createTextNode(t("admin.clearCell")));
    boardEditorTools.appendChild(clearButton);
  }
}

function stopClock() {
  if (clockInterval !== null) window.clearInterval(clockInterval);
  clockInterval = null;
  clockLastTick = null;
}

function advanceClock(now = performance.now()) {
  if (onlineMode) return true;
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
  invalidateComputerAction();
  render();
  if (previousState.phase !== "finished" && state.phase === "finished") showResult();
  return false;
}

function startClock() {
  if (onlineMode) {
    if (clockInterval !== null || !state || state.phase !== "playing"
      || settings.unlimitedTime || !onlineClockSnapshot?.activePlayer) return;
    clockInterval = window.setInterval(renderClock, 100);
    renderClock();
    return;
  }
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

function drawMenuAmbient() {
  if (!menuCanvasContext) return;
  const { width, height } = menuCanvas;
  menuCanvasContext.clearRect(0, 0, width, height);
  for (let index = 0; index < ambientNodes.length; index += 1) {
    const node = ambientNodes[index];
    for (let otherIndex = index + 1; otherIndex < ambientNodes.length; otherIndex += 1) {
      const other = ambientNodes[otherIndex];
      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 178) continue;
      const opacity = (1 - distance / 178) * 0.27;
      menuCanvasContext.beginPath();
      menuCanvasContext.moveTo(node.x, node.y);
      menuCanvasContext.lineTo(other.x, other.y);
      menuCanvasContext.strokeStyle = `rgba(133, 194, 164, ${opacity})`;
      menuCanvasContext.lineWidth = 0.65;
      menuCanvasContext.stroke();
    }
    menuCanvasContext.beginPath();
    menuCanvasContext.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    menuCanvasContext.fillStyle = node.tone === 0 ? "rgba(210,255,133,.7)" : "rgba(112,255,221,.62)";
    menuCanvasContext.fill();
  }
}

function advanceAmbientNodes(elapsed, time) {
  if (!elapsed) return;
  const seconds = elapsed / 1000;
  for (const node of ambientNodes) {
    if (node === ambientDragNode) {
      const follow = Math.min(1, elapsed * 0.012);
      node.x += (ambientDragTarget.x - node.x) * follow;
      node.y += (ambientDragTarget.y - node.y) * follow;
      continue;
    }
    node.vx += Math.sin(time * 0.00022 + node.phase) * 0.008 * seconds;
    node.vy += Math.cos(time * 0.00019 + node.phase * 1.7) * 0.008 * seconds;
    node.vx += (node.flowVx - node.vx) * Math.min(1, seconds * 0.18);
    node.vy += (node.flowVy - node.vy) * Math.min(1, seconds * 0.18);
    node.vx = Math.max(-0.06, Math.min(0.06, node.vx));
    node.vy = Math.max(-0.06, Math.min(0.06, node.vy));
    node.x += node.vx * elapsed;
    node.y += node.vy * elapsed;
    if (node.x < -12) node.x = menuCanvas.clientWidth + 12;
    if (node.x > menuCanvas.clientWidth + 12) node.x = -12;
    if (node.y < -12) node.y = menuCanvas.clientHeight + 12;
    if (node.y > menuCanvas.clientHeight + 12) node.y = -12;
  }
}

function findAmbientNode(point, threshold = 24) {
  let closest = null;
  let closestDistance = threshold;
  for (const node of ambientNodes) {
    const distance = Math.hypot(point.x - node.x, point.y - node.y);
    if (distance < closestDistance) {
      closest = node;
      closestDistance = distance;
    }
  }
  return closest;
}

menuCanvas.addEventListener("pointerdown", (event) => {
  if (mainMenuScreen.hidden || event.pointerType !== "mouse") return;
  const rect = menuCanvas.getBoundingClientRect();
  const node = findAmbientNode({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  if (!node) return;
  ambientDragNode = node;
  ambientDragTarget = { x: node.x, y: node.y };
  ambientDragPoint = { x: event.clientX, y: event.clientY, time: event.timeStamp,
    offsetX: node.x - (event.clientX - rect.left), offsetY: node.y - (event.clientY - rect.top) };
  menuCanvas.setPointerCapture(event.pointerId);
  menuCanvas.classList.add("is-dragging");
  event.preventDefault();
});
menuCanvas.addEventListener("pointermove", (event) => {
  if (!ambientDragNode) return;
  const rect = menuCanvas.getBoundingClientRect();
  const elapsed = Math.max(1, event.timeStamp - ambientDragPoint.time);
  const dx = event.clientX - ambientDragPoint.x;
  const dy = event.clientY - ambientDragPoint.y;
  const padding = ambientDragNode.radius + 1;
  ambientDragTarget.x = Math.max(padding, Math.min(rect.width - padding, event.clientX - rect.left + ambientDragPoint.offsetX));
  ambientDragTarget.y = Math.max(padding, Math.min(rect.height - padding, event.clientY - rect.top + ambientDragPoint.offsetY));
  ambientDragNode.vx = dx / elapsed;
  ambientDragNode.vy = dy / elapsed;
  ambientDragPoint = { ...ambientDragPoint, x: event.clientX, y: event.clientY, time: event.timeStamp };
  scheduleMenuDragRender();
});
const endAmbientDrag = () => {
  if (ambientDragNode && ambientDragTarget) {
    ambientDragNode.vx += (ambientDragTarget.x - ambientDragNode.x) * 0.008;
    ambientDragNode.vy += (ambientDragTarget.y - ambientDragNode.y) * 0.008;
  }
  ambientDragNode = null;
  ambientDragPoint = null;
  ambientDragTarget = null;
  menuCanvas.classList.remove("is-dragging");
};
menuCanvas.addEventListener("pointerup", endAmbientDrag);
menuCanvas.addEventListener("pointercancel", endAmbientDrag);

function drawVirusSystem(context, x, y, radius, color, time, phase, drag = null) {
  const pulse = 1 + Math.sin(time * 0.0012 + phase) * 0.035;
  const size = radius * pulse;
  const colorLight = color === "x" ? "rgba(202,255,129," : "rgba(255,153,133,";
  const glow = context.createRadialGradient(x, y, size * 0.2, x, y, size * 1.85);
  glow.addColorStop(0, colorLight + "0.22)");
  glow.addColorStop(0.52, colorLight + "0.08)");
  glow.addColorStop(1, colorLight + "0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, size * 1.85, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.translate(x, y);
  if (drag?.active) {
    context.rotate(drag.angle + Math.sin(time * 0.0012 + phase) * 0.018);
    const stretch = Math.min(1, drag.tension * 5);
    context.scale(1 + stretch * 0.22, 1 - stretch * 0.1 + Math.sin(time * 0.001 + phase) * 0.006);
  } else {
    context.rotate(time * 0.00006 * (color === "x" ? 1 : -1) + phase);
  }
  const spikeCount = 15;
  context.lineWidth = 2;
  context.strokeStyle = color === "x" ? "rgba(203,255,133,.85)" : "rgba(255,167,148,.82)";
  for (let index = 0; index < spikeCount; index += 1) {
    const angle = (Math.PI * 2 * index) / spikeCount;
    const innerRadius = size * 0.77;
    const outerRadius = size * (1.03 + 0.11 * Math.sin(index * 2.17 + phase));
    context.beginPath();
    context.moveTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
    context.lineTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius);
    context.stroke();
    context.beginPath();
    context.arc(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius, 2.1, 0, Math.PI * 2);
    context.fillStyle = color === "x" ? "rgba(218,255,171,.9)" : "rgba(255,191,173,.9)";
    context.fill();
  }

  context.beginPath();
  for (let index = 0; index <= 60; index += 1) {
    const angle = (Math.PI * 2 * index) / 60;
    const irregularity = 1 + 0.055 * Math.sin(angle * 5 + phase) + 0.035 * Math.cos(angle * 8 - phase);
    const edgeRadius = size * 0.78 * irregularity;
    const px = Math.cos(angle) * edgeRadius;
    const py = Math.sin(angle) * edgeRadius;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fillStyle = color === "x" ? "rgba(47,75,46,.95)" : "rgba(83,49,45,.96)";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = color === "x" ? "rgba(203,255,133,.88)" : "rgba(255,167,148,.84)";
  context.stroke();

  const core = context.createRadialGradient(-size * 0.25, -size * 0.28, size * 0.04, 0, 0, size * 0.68);
  if (color === "x") {
    core.addColorStop(0, "rgba(223,255,180,.92)");
    core.addColorStop(0.34, "rgba(158,220,91,.68)");
    core.addColorStop(1, "rgba(84,135,70,.12)");
  } else {
    core.addColorStop(0, "rgba(255,222,196,.9)");
    core.addColorStop(0.35, "rgba(244,128,105,.68)");
    core.addColorStop(1, "rgba(158,76,66,.13)");
  }
  context.beginPath();
  context.arc(0, 0, size * 0.66, 0, Math.PI * 2);
  context.fillStyle = core;
  context.fill();
  for (let index = 0; index < 5; index += 1) {
    const angle = index * 2.399 + phase;
    const organelleX = Math.cos(angle) * size * (0.18 + (index % 2) * 0.2);
    const organelleY = Math.sin(angle) * size * (0.16 + (index % 3) * 0.12);
    context.beginPath();
    context.ellipse(organelleX, organelleY, size * 0.07, size * 0.045, angle, 0, Math.PI * 2);
    context.fillStyle = color === "x" ? "rgba(232,255,190,.64)" : "rgba(255,214,195,.58)";
    context.fill();
  }
  context.restore();
}

function drawDuelScene(time = 0) {
  if (!menuDuelContext) return;
  const width = menuDuelCanvas.clientWidth;
  const height = menuDuelCanvas.clientHeight;
  menuDuelContext.clearRect(0, 0, width, height);
  const scale = Math.min(width / 500, height / 330, 1.15);
  const radius = Math.max(35, 51 * scale);
  duelLastTime = time;
  const drift = Math.sin(time * 0.00025);
  const defaults = {
    X: { x: 0.275 + drift * 11 * scale / width, y: 0.49 + Math.sin(time * 0.00038) * 8 * scale / height },
    O: { x: 0.725 - drift * 11 * scale / width, y: 0.51 - Math.sin(time * 0.00034 + 1.2) * 8 * scale / height }
  };
  const elapsed = duelPhysicsLastTime === null ? 0 : Math.min(0.06, Math.max(0, time - duelPhysicsLastTime) / 1000);
  duelPhysicsLastTime = time;
  for (const [player, fallback] of Object.entries(defaults)) {
    if (!duelPositions[player]) {
      duelPositions[player] = { ...fallback, vx: 0, vy: 0, phase: player === "X" ? 0.4 : 2.1 };
      continue;
    }
    const body = duelPositions[player];
    if (elapsed > 0 && duelDragPlayer === player && duelDragTarget) {
      const follow = 1 - Math.exp(-elapsed * 7.5);
      body.x += (duelDragTarget.x - body.x) * follow;
      body.y += (duelDragTarget.y - body.y) * follow;
    } else if (elapsed > 0) {
      body.vx += Math.sin(time * 0.00043 + body.phase) * 0.018 * elapsed;
      body.vy += Math.cos(time * 0.00037 + body.phase * 1.3) * 0.018 * elapsed;
      const damping = Math.pow(0.91, elapsed);
      body.vx *= damping;
      body.vy *= damping;
      body.x += body.vx * elapsed;
      body.y += body.vy * elapsed;
    }
    const constrained = constrainDuelPosition(body.x, body.y, width, height, radius);
    if (constrained.x !== body.x || constrained.y !== body.y) {
      body.vx *= -0.72;
      body.vy *= -0.72;
      body.x = constrained.x;
      body.y = constrained.y;
    }
  }
  const left = { x: duelPositions.X.x * width, y: duelPositions.X.y * height };
  const right = { x: duelPositions.O.x * width, y: duelPositions.O.y * height };
  const contactX = width * 0.5;
  const contactY = height * 0.5;

  const centralGlow = menuDuelContext.createRadialGradient(contactX, contactY, 0, contactX, contactY, radius * 2.8);
  centralGlow.addColorStop(0, "rgba(219,243,210,.13)");
  centralGlow.addColorStop(1, "rgba(219,243,210,0)");
  menuDuelContext.fillStyle = centralGlow;
  menuDuelContext.fillRect(contactX - radius * 2.8, contactY - radius * 2.8, radius * 5.6, radius * 5.6);

  const drawStrands = (origin, direction, color, phase) => {
    for (let index = 0; index < 4; index += 1) {
      const offset = (index - 1.5) * radius * 0.46;
      const startX = origin.x + direction * radius * 0.67;
      const startY = origin.y + offset * 0.65;
      const endX = contactX - direction * (5 + (index % 2) * 5);
      const endY = contactY + offset * 0.43;
      const controlX = startX + (endX - startX) * 0.56;
      const controlY = (startY + endY) / 2 + Math.sin(time * 0.0006 + phase + index) * 17 * scale;
      menuDuelContext.beginPath();
      menuDuelContext.moveTo(startX, startY);
      menuDuelContext.quadraticCurveTo(controlX, controlY, endX, endY);
      menuDuelContext.lineWidth = (index === 1 || index === 2 ? 2.4 : 1.35) * scale;
      menuDuelContext.strokeStyle = color === "x" ? "rgba(197,255,127,.48)" : "rgba(255,151,131,.45)";
      menuDuelContext.stroke();

      const progress = (time * 0.00012 + index * 0.21 + phase) % 1;
      const inverse = 1 - progress;
      const pulseX = inverse * inverse * startX + 2 * inverse * progress * controlX + progress * progress * endX;
      const pulseY = inverse * inverse * startY + 2 * inverse * progress * controlY + progress * progress * endY;
      menuDuelContext.beginPath();
      menuDuelContext.arc(pulseX, pulseY, (2 + (index % 2)) * scale, 0, Math.PI * 2);
      menuDuelContext.fillStyle = color === "x" ? "rgba(221,255,173,.95)" : "rgba(255,203,184,.92)";
      menuDuelContext.fill();
    }
  };
  drawStrands(left, 1, "x", 0.2);
  drawStrands(right, -1, "o", 0.65);

  const fieldPulse = 0.5 + 0.5 * Math.sin(time * 0.00135);
  menuDuelContext.beginPath();
  menuDuelContext.moveTo(contactX, contactY - radius * 1.5);
  menuDuelContext.quadraticCurveTo(contactX + Math.sin(time * 0.0008) * 5, contactY, contactX, contactY + radius * 1.5);
  menuDuelContext.lineWidth = 1.5 + fieldPulse * 1.4;
  menuDuelContext.strokeStyle = `rgba(231,255,235,${0.2 + fieldPulse * 0.28})`;
  menuDuelContext.shadowColor = "rgba(217,255,224,.7)";
  menuDuelContext.shadowBlur = (9 + fieldPulse * 13) * scale;
  menuDuelContext.stroke();
  menuDuelContext.shadowBlur = 0;

  const pulsePhase = (time % 2300) / 2300;
  for (let index = 0; index < 2; index += 1) {
    const progress = (pulsePhase + index * 0.5) % 1;
    menuDuelContext.beginPath();
    menuDuelContext.arc(contactX, contactY, (8 + progress * radius * 0.74) * scale, 0, Math.PI * 2);
    menuDuelContext.lineWidth = 1.2 * scale;
    menuDuelContext.strokeStyle = `rgba(224,247,228,${(1 - progress) * 0.24})`;
    menuDuelContext.stroke();
  }

  const dragState = (player) => {
    const body = duelPositions[player];
    const tension = duelDragPlayer === player && duelDragTarget
      ? Math.hypot(duelDragTarget.x - body.x, duelDragTarget.y - body.y)
      : 0;
    return { active: duelDragPlayer === player, tension, angle: duelDragAngle };
  };
  drawVirusSystem(menuDuelContext, left.x, left.y, radius, "x", time, 0.2, dragState("X"));
  drawVirusSystem(menuDuelContext, right.x, right.y, radius, "o", time, 1.15, dragState("O"));
  drawSymbioticBacteria(menuDuelContext, contactX, contactY, radius * 0.58, time);
}

function constrainDuelPosition(x, y, width, height, radius) {
  const padding = radius * 1.42;
  const rx = Math.max(1, width / 2 - padding) / width;
  const ry = Math.max(1, height / 2 - padding) / height;
  const dx = (x - 0.5) / rx;
  const dy = (y - 0.5) / ry;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1) return { x, y };
  return { x: 0.5 + dx / distance * rx, y: 0.5 + dy / distance * ry };
}

function drawSymbioticBacteria(context, x, y, radius, time) {
  context.save();
  context.translate(x, y);
  const wobble = Math.sin(time * 0.0011) * radius * 0.045;
  const drawCell = (side, phase) => {
    context.save();
    context.rotate(side * (0.1 + Math.sin(time * 0.00042 + phase) * 0.035));
    context.translate(side * radius * 0.14, 0);
    const color = side < 0 ? "#c6f36b" : "#ff917e";
    const dark = side < 0 ? "rgba(86,126,55,.48)" : "rgba(149,73,66,.48)";
    const tilt = side * 0.13;
    context.rotate(tilt);
    context.shadowColor = side < 0 ? "rgba(198,243,107,.48)" : "rgba(255,145,126,.43)";
    context.shadowBlur = radius * 0.28;
    context.beginPath();
    if (side < 0) {
      context.moveTo(radius * 0.22, -radius * 0.94);
      context.bezierCurveTo(-radius * 0.48, -radius * 1.02, -radius * 1.03, -radius * 0.42, -radius * 0.85, radius * 0.2 + wobble);
      context.bezierCurveTo(-radius * 0.7, radius * 0.82, -radius * 0.12, radius * 1.02, radius * 0.34, radius * 0.69);
      context.bezierCurveTo(radius * 0.65, radius * 0.45, radius * 0.5, radius * 0.18, radius * 0.12, radius * 0.02);
      context.bezierCurveTo(-radius * 0.24, -radius * 0.13, -radius * 0.3, -radius * 0.48, radius * 0.22, -radius * 0.94);
    } else {
      context.moveTo(-radius * 0.22, radius * 0.94);
      context.bezierCurveTo(radius * 0.48, radius * 1.02, radius * 1.03, radius * 0.42, radius * 0.85, -radius * 0.2 - wobble);
      context.bezierCurveTo(radius * 0.7, -radius * 0.82, radius * 0.12, -radius * 1.02, -radius * 0.34, -radius * 0.69);
      context.bezierCurveTo(-radius * 0.65, -radius * 0.45, -radius * 0.5, -radius * 0.18, -radius * 0.12, -radius * 0.02);
      context.bezierCurveTo(radius * 0.24, radius * 0.13, radius * 0.3, radius * 0.48, -radius * 0.22, radius * 0.94);
    }
    context.closePath();
    context.fillStyle = side < 0 ? "rgba(44,72,43,.98)" : "rgba(79,47,45,.98)";
    context.fill();
    context.lineWidth = Math.max(1.4, radius * 0.045);
    context.strokeStyle = color;
    context.stroke();
    context.shadowBlur = 0;

    context.beginPath();
    context.ellipse(side * radius * 0.2, -side * radius * 0.05, radius * 0.35, radius * 0.17, side * 0.55, 0, Math.PI * 2);
    context.fillStyle = dark;
    context.fill();
    for (let index = 0; index < 4; index += 1) {
      const organelleX = side * radius * (0.08 + index * 0.095);
      const organelleY = Math.sin(time * 0.0008 + phase + index * 1.9) * radius * 0.28;
      context.beginPath();
      context.ellipse(organelleX, organelleY, radius * 0.042, radius * 0.022, side * 0.4, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    }
    context.restore();
  };
  drawCell(-1, 0.3);
  drawCell(1, 1.8);

  // Waving flagella make the paired cells read as living bacteria, not a flat emblem.
  for (let side of [-1, 1]) {
    for (let index = 0; index < 3; index += 1) {
      const startX = side * radius * (0.62 + index * 0.09);
      const startY = (index - 1) * radius * 0.42;
      const sway = Math.sin(time * 0.0012 + index * 1.8 + side) * radius * 0.18;
      context.beginPath();
      context.moveTo(startX, startY);
      context.bezierCurveTo(startX + side * radius * 0.28, startY - radius * 0.18 + sway,
        startX + side * radius * 0.44, startY + radius * 0.21 - sway,
        startX + side * radius * 0.68, startY + sway);
      context.lineWidth = Math.max(0.8, radius * 0.025);
      context.strokeStyle = side < 0 ? "rgba(198,243,107,.72)" : "rgba(255,145,126,.7)";
      context.stroke();
    }
  }

  // A fine membrane filament loops between the two cells and gently pulses.
  context.beginPath();
  context.moveTo(-radius * 0.12, -radius * 0.44);
  context.bezierCurveTo(radius * (0.48 + wobble / radius), -radius * 0.2, -radius * 0.48, radius * 0.18, radius * 0.12, radius * 0.44);
  context.lineWidth = Math.max(0.9, radius * 0.025);
  context.strokeStyle = `rgba(222,245,211,${0.42 + (Math.sin(time * 0.0014) + 1) * 0.12})`;
  context.stroke();
  context.restore();
}

function getDuelPointer(event) {
  const rect = menuDuelCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
}

menuDuelCanvas.addEventListener("pointerdown", (event) => {
  if (menuDuelCanvas.closest(".main-menu-screen").hidden || event.pointerType !== "mouse") return;
  const point = getDuelPointer(event);
  const scale = Math.min(point.width / 500, point.height / 330, 1.15);
  const radius = Math.max(35, 51 * scale);
  const time = duelLastTime;
  const drift = Math.sin(time * 0.00025);
  const defaults = {
    X: duelPositions.X || { x: 0.275 + drift * 11 * scale / point.width, y: 0.49 + Math.sin(time * 0.00038) * 8 * scale / point.height },
    O: duelPositions.O || { x: 0.725 - drift * 11 * scale / point.width, y: 0.51 - Math.sin(time * 0.00034 + 1.2) * 8 * scale / point.height }
  };
  const candidates = ["X", "O"].map((player) => ({
    player,
    distance: Math.hypot(point.x - (duelPositions[player]?.x ?? defaults[player].x) * point.width,
      point.y - (duelPositions[player]?.y ?? defaults[player].y) * point.height)
  })).sort((a, b) => a.distance - b.distance);
  if (candidates[0].distance > radius * 1.45) return;
  duelDragPlayer = candidates[0].player;
  const body = duelPositions[duelDragPlayer];
  duelDragTarget = { x: body.x, y: body.y };
  duelDragPoint = { x: point.x, y: point.y, time: event.timeStamp,
    offsetX: body.x - point.x / point.width, offsetY: body.y - point.y / point.height };
  menuDuelCanvas.setPointerCapture(event.pointerId);
  menuDuelCanvas.classList.add("is-dragging");
  event.preventDefault();
});
menuDuelCanvas.addEventListener("pointermove", (event) => {
  if (!duelDragPlayer) return;
  const point = getDuelPointer(event);
  const body = duelPositions[duelDragPlayer];
  const elapsed = Math.max(1, event.timeStamp - duelDragPoint.time) / 1000;
  duelDragTarget = constrainDuelPosition(
    point.x / point.width + duelDragPoint.offsetX,
    point.y / point.height + duelDragPoint.offsetY,
    point.width,
    point.height,
    Math.max(35, 51 * Math.min(point.width / 500, point.height / 330, 1.15))
  );
  const deltaX = point.x - duelDragPoint.x;
  const deltaY = point.y - duelDragPoint.y;
  body.vx = Math.max(-0.5, Math.min(0.5, deltaX / point.width / elapsed));
  body.vy = Math.max(-0.5, Math.min(0.5, deltaY / point.height / elapsed));
  if (Math.hypot(deltaX, deltaY) > 0.75) {
    const targetAngle = Math.atan2(deltaY, deltaX);
    const angleDelta = Math.atan2(Math.sin(targetAngle - duelDragAngle), Math.cos(targetAngle - duelDragAngle));
    duelDragAngle += angleDelta * 0.16;
  }
  duelDragPoint = { ...duelDragPoint, x: point.x, y: point.y, time: event.timeStamp };
  scheduleMenuDragRender();
});
const endDuelDrag = () => {
  duelDragPlayer = null;
  duelDragPoint = null;
  duelDragTarget = null;
  menuDuelCanvas.classList.remove("is-dragging");
};
menuDuelCanvas.addEventListener("pointerup", endDuelDrag);
menuDuelCanvas.addEventListener("pointercancel", endDuelDrag);

function resizeDuelCanvas() {
  if (!menuDuelContext) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.35);
  const width = Math.max(1, Math.round(menuDuelCanvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(menuDuelCanvas.clientHeight * ratio));
  if (menuDuelCanvas.width !== width || menuDuelCanvas.height !== height) {
    menuDuelCanvas.width = width;
    menuDuelCanvas.height = height;
    menuDuelContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  drawDuelScene();
}

function resizeMenuAmbient() {
  if (!menuCanvasContext) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.35);
  const width = Math.max(1, Math.round(menuCanvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(menuCanvas.clientHeight * ratio));
  if (menuCanvas.width === width && menuCanvas.height === height) return;
  menuCanvas.width = width;
  menuCanvas.height = height;
  menuCanvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  const logicalWidth = menuCanvas.clientWidth;
  const logicalHeight = menuCanvas.clientHeight;
  const count = Math.min(44, Math.max(22, Math.round((logicalWidth * logicalHeight) / 34000)));
  ambientNodes = Array.from({ length: count }, () => ({
    x: Math.random() * logicalWidth,
    y: Math.random() * logicalHeight,
    vx: (Math.random() - 0.5) * 0.015,
    vy: (Math.random() - 0.5) * 0.015,
    flowVx: (Math.random() - 0.5) * 0.015,
    flowVy: (Math.random() - 0.5) * 0.015,
    phase: Math.random() * Math.PI * 2,
    radius: 1 + Math.random() * 1.15,
    tone: Math.random() < 0.5 ? 0 : 1
  }));
  drawMenuAmbient();
  resizeDuelCanvas();
}

function syncMenuAmbient() {
  if (menuAnimationFrame !== null) cancelAnimationFrame(menuAnimationFrame);
  menuAnimationFrame = null;
  if (mainMenuScreen.hidden || !settings.animationsEnabled || reduceMotionQuery.matches) {
    drawMenuAmbient();
    drawDuelScene();
    return;
  }

  const animate = (timestamp) => {
    if (mainMenuScreen.hidden || !settings.animationsEnabled || reduceMotionQuery.matches) {
      menuAnimationFrame = null;
      drawMenuAmbient();
      drawDuelScene();
      return;
    }
    const frameInterval = duelDragPlayer || ambientDragNode ? 16 : 42;
    if (timestamp - menuAnimationLastFrame >= frameInterval) {
      const elapsed = Math.min(timestamp - (menuAnimationLastFrame || timestamp), 50);
      menuAnimationLastFrame = timestamp;
      advanceAmbientNodes(elapsed, timestamp);
      drawMenuAmbient();
      drawDuelScene(timestamp);
    }
    menuAnimationFrame = requestAnimationFrame(animate);
  };
  menuAnimationFrame = requestAnimationFrame(animate);
}

function showMenuNotice(key, params = {}) {
  menuNoticeTranslation = { key, params };
  menuNotice.textContent = t(key, params);
  menuNotice.hidden = false;
  window.clearTimeout(menuNoticeTimeout);
  menuNoticeTimeout = window.setTimeout(() => {
    menuNotice.hidden = true;
    menuNoticeTranslation = null;
  }, 3600);
}

function onlineErrorMessage(code) {
  const key = "online.error." + (code || "generic");
  return t(key) === key ? t("online.error.generic") : t(key);
}

function isCurrentOnlineEvent(event) {
  return onlineObserverMode
    ? event.roomId === onlineRoomId
    : event.roomCode === onlineRoomCode;
}

let activeGamesRefreshTimer = null;
let activeGamesOpenSettings = null;
function positionActiveGamesSettings(details, row) {
  const popover = details.querySelector(".active-games-settings-popover");
  if (!popover || !details.open) return;
  const rowRect = row.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 32);
  const left = Math.min(Math.max(16, rowRect.right - width), window.innerWidth - width - 16);
  let top = rowRect.bottom + 8;
  if (top + popoverRect.height > window.innerHeight - 12) top = Math.max(12, rowRect.top - popoverRect.height - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}
async function refreshActiveGames() {
  if (!activeGamesPage || activeGamesPage.hidden) return;
  activeGamesStatus.textContent = t("activeGames.loading");
  try {
    const response = await fetch("/api/rooms", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("room-catalog-unavailable");
    const payload = await response.json();
    const rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
    activeGamesRows.replaceChildren();
    if (rooms.length === 0) {
      activeGamesStatus.textContent = t("activeGames.empty");
      return;
    }
    activeGamesStatus.textContent = "";
    rooms.forEach((room, index) => {
      const tr = document.createElement("tr");
      const cell = (text) => { const td = document.createElement("td"); td.textContent = text; return td; };
      tr.append(cell(`#${index + 1}`));
      tr.append(cell(t(room.visibility === "public" ? "activeGames.public" : "activeGames.private")));
      tr.append(cell(`${room.players}/2 · ${t("activeGames.spectators", { count: room.observers || 0 })}`));
      tr.append(cell(`${room.settings.width}×${room.settings.height}`));
      tr.append(cell(room.settings.unlimitedTime ? t("clock.unlimited") : `${room.settings.clockMinutes}+${room.settings.incrementSeconds}`));
      tr.append(cell(String(room.maxPlayers)));
      const actionCell = document.createElement("td");
      const actions = document.createElement("div"); actions.className = "active-games-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-secondary";
      const action = room.visibility !== "public" ? "manage"
        : room.status === "waiting" ? "join" : "observe";
      button.textContent = t(`activeGames.${action}`);
      button.disabled = room.status === "waiting" && room.players === 0;
      button.addEventListener("click", () => action === "join"
        ? multiplayerClient.joinPublicRoom(room.id).catch((error) => { activeGamesStatus.textContent = onlineErrorMessage(error.code); })
        : observeCatalogRoom(room));
      actions.append(button);
      actionCell.append(actions);
      const details = document.createElement("details");
      details.className = "active-games-settings";
      const summary = document.createElement("summary"); summary.textContent = t("activeGames.settings");
      const popover = document.createElement("div");
      popover.className = "active-games-settings-popover";
      popover.setAttribute("role", "note");
      const content = document.createElement("p");
      const disabled = (room.settings.disabledItems || []).map((type) => EVENT_ITEM_DEFINITIONS[type] ? t(EVENT_ITEM_DEFINITIONS[type].nameKey) : type).join(", ") || t("settings.itemsNoneDisabled");
      content.textContent = [
        `${room.settings.width}×${room.settings.height}`,
        `${room.settings.piecesPerTurn} ${t("turn.pieces")}`,
        room.settings.unlimitedTime ? t("clock.unlimited") : `${room.settings.clockMinutes}+${room.settings.incrementSeconds}`,
        t(`settings.spawnMode.${room.settings.itemSpawnMode}`),
        t(room.settings.randomEvents ? "settings.randomEnabled" : "settings.randomDisabled"),
        `${t("settings.itemsTitle")}: ${disabled}`,
        room.settings.unlimitedItemLifetime ? t("settings.itemsUnlimited") : `${t("settings.itemLifetime")}: ${room.settings.itemLifetimeTurns} ${t("settings.itemLifetimeTurns")}`,
        t(room.settings.wormholesEnabled ? "settings.wormholesEnabled" : "settings.randomDisabled")
      ].join(" · ");
      popover.append(content);
      details.append(summary, popover);
      let closeTimer = null;
      const cancelClose = () => window.clearTimeout(closeTimer);
      const scheduleClose = () => {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(() => {
          if (!details.matches(":hover") && !details.contains(document.activeElement)) {
            details.open = false;
            if (activeGamesOpenSettings === details) activeGamesOpenSettings = null;
          }
        }, 180);
      };
      tr.addEventListener("pointerenter", () => {
        cancelClose();
        if (activeGamesOpenSettings && activeGamesOpenSettings !== details) activeGamesOpenSettings.open = false;
        activeGamesOpenSettings = details;
        details.open = true;
        positionActiveGamesSettings(details, tr);
      });
      tr.addEventListener("pointerleave", scheduleClose);
      details.addEventListener("pointerenter", cancelClose);
      details.addEventListener("pointerleave", scheduleClose);
      tr.addEventListener("focusin", () => {
        cancelClose();
        if (activeGamesOpenSettings && activeGamesOpenSettings !== details) activeGamesOpenSettings.open = false;
        activeGamesOpenSettings = details;
        details.open = true;
        positionActiveGamesSettings(details, tr);
      });
      tr.addEventListener("focusout", scheduleClose);
      details.addEventListener("toggle", () => positionActiveGamesSettings(details, tr));
      actionCell.append(details);
      tr.append(actionCell);
      activeGamesRows.append(tr);
    });
  } catch {
    activeGamesStatus.textContent = t("activeGames.failed");
  }
}

function showActiveGamesPage(show) {
  const menuContent = mainMenuScreen.querySelector(".menu-content");
  const footer = mainMenuScreen.querySelector(".menu-footer");
  activeGamesPage.hidden = !show;
  menuContent.hidden = show;
  footer.hidden = show;
  if (show) {
    if (activeGamesRefreshTimer !== null) window.clearInterval(activeGamesRefreshTimer);
    void refreshActiveGames();
    activeGamesRefreshTimer = window.setInterval(() => void refreshActiveGames(), 10_000);
  } else if (activeGamesRefreshTimer !== null) {
    window.clearInterval(activeGamesRefreshTimer);
    activeGamesRefreshTimer = null;
  }
}

async function observeCatalogRoom(room) {
  let secret;
  if (room.visibility !== "public") {
    secret = window.prompt(t("activeGames.adminSecret"));
    if (!secret) return;
  }
  try {
    await multiplayerClient.observeRoom(room.id, secret);
  } catch (error) {
    activeGamesStatus.textContent = onlineErrorMessage(error.code);
  }
}

function showOnlineError(code) {
  onlineMenuError = code;
  onlineErrorElement.textContent = onlineErrorMessage(code);
  onlineErrorElement.hidden = false;
}

function clearOnlinePresentation() {
  onlineObserverMode = false;
  onlineAdminObserver = false;
  onlineRoomId = null;
  onlineMode = false;
  onlineSide = null;
  onlineRoomCode = null;
  onlineRoomId = null;
  boardEditorFirstWormholeCell = null;
  onlineConnected = false;
  onlineAdminAuthenticated = false;
  pendingBoardEdit = false;
  boardEditorActive = false;
  boardEditorTool = null;
  boardEditorMessageKey = null;
  onlineCommandPending = false;
  onlineStatusKey = null;
  onlineStatusError = null;
  onlineClockSnapshot = null;
  onlineClockReceivedAt = null;
  onlineUndoAvailable = false;
  onlineUndoPending = false;
  incomingUndoProposal = null;
  localUndoConfirmation = false;
  onlineGameStatus.hidden = true;
  onlineGameStatus.textContent = "";
  incomingRestartProposal = null;
  if (restartProposalModal.open) restartProposalModal.close();
  if (undoProposalModal.open) undoProposalModal.close();
  gameScreen.classList.remove("is-online");
  if (onlinePreviousSettings) settings = { ...onlinePreviousSettings };
  onlinePreviousSettings = null;
  if (state) renderClock();
}

function leaveOnlineSession({ showMenu = false } = {}) {
  const wasObserver = onlineObserverMode;
  const fromGamesPage = !activeGamesPage.hidden;
  clearOnlinePresentation();
  remoteAim = null;
  lastSentAim = null;
  if (wasObserver) multiplayerClient.leaveObserver();
  else multiplayerClient.leave();
  if (resultModal.open) resultModal.close();
  if (restartConfirmModal.open) restartConfirmModal.close();
  if (restartProposalModal.open) restartProposalModal.close();
  if (onlineRoomModal.open) onlineRoomModal.close();
  onlineRoomEntry.hidden = false;
  onlineRoomLobby.hidden = true;
  onlineErrorElement.hidden = true;
  onlineMenuError = null;
  if (showMenu) {
    beginGameSession();
    stopClock();
    transitionScreens(false);
    syncMenuAmbient();
    if (fromGamesPage) showActiveGamesPage(true);
  }
}

function openOnlineRoom(inviteCode = "") {
  onlineMenuError = null;
  onlineErrorElement.hidden = true;
  onlineRoomEntry.hidden = false;
  onlineRoomLobby.hidden = true;
  const savedSession = multiplayerClient.savedSession;
  onlineResumeButton.hidden = !savedSession;
  if (savedSession) onlineResumeButton.textContent = t("online.resume");
  onlineRoomModal.showModal();
  const requestedCode = inviteCode || new URLSearchParams(window.location.search).get("room") || "";
  if (requestedCode) onlineRoomCodeInput.value = requestedCode.slice(0, 8).toUpperCase();
  syncOnlineRoomSettings();
  (savedSession ? onlineResumeButton : onlineCreateRoomButton).focus();
}

function syncOnlineRoomSettings() {
  onlineBoardWidthInput.value = String(settings.width);
  onlineBoardHeightInput.value = String(settings.height);
  onlinePiecesInput.value = String(settings.piecesPerTurn);
  onlineClockMinutesInput.value = String(settings.clockMinutes);
  onlineClockIncrementInput.value = String(settings.incrementSeconds);
  onlineUnlimitedTimeToggle.checked = settings.unlimitedTime;
  onlineRandomEventsToggle.checked = settings.randomEvents;
  onlinePublicRoomToggle.checked = false;
  onlineUnlimitedItemLifetimeToggle.checked = settings.unlimitedItemLifetime;
  onlineItemLifetimeInput.value = String(settings.itemLifetimeTurns);
  onlineItemLifetimeField.hidden = settings.unlimitedItemLifetime;
  onlineItemLifetimeInput.disabled = settings.unlimitedItemLifetime;
  onlineItemSpawnMode.value = settings.itemSpawnMode;
  updateSpawnModeHelp(onlineItemSpawnMode, onlineItemSpawnModeHelp);
  onlineWormholesToggle.checked = settings.wormholesEnabled;
  onlineFreeStartToggle.checked = settings.freeStartingPositions;
  renderItemOptions(onlineItemOptions, settings.disabledItems);
  onlineClockMinutesInput.disabled = settings.unlimitedTime;
  onlineClockIncrementInput.disabled = settings.unlimitedTime;
  const validDimensions = [Number(onlineBoardWidthInput.value), Number(onlineBoardHeightInput.value)]
    .every((dimension) => Number.isInteger(dimension) && dimension >= MIN_BOARD_DIMENSION && dimension <= MAX_BOARD_DIMENSION);
  onlinePiecesInput.max = String(validDimensions
    ? Math.floor(Number(onlineBoardWidthInput.value) * Number(onlineBoardHeightInput.value) / 10)
    : Math.floor(MAX_BOARD_DIMENSION * MAX_BOARD_DIMENSION / 10));
}

function collectOnlineRoomSettings() {
  const width = Number(onlineBoardWidthInput.value);
  const height = Number(onlineBoardHeightInput.value);
  const piecesPerTurn = Number(onlinePiecesInput.value);
  const unlimitedTime = onlineUnlimitedTimeToggle.checked;
  const resolvedClock = resolveClockSettings({
    unlimitedTime,
    clockMinutes: onlineClockMinutesInput.value,
    incrementSeconds: onlineClockIncrementInput.value
  }, DEFAULT_SETTINGS);
  const clockMinutes = resolvedClock?.clockMinutes ?? Number(onlineClockMinutesInput.value);
  const incrementSeconds = resolvedClock?.incrementSeconds ?? Number(onlineClockIncrementInput.value);
  const unlimitedItemLifetime = onlineUnlimitedItemLifetimeToggle.checked;
  const itemLifetimeTurns = Number(onlineItemLifetimeInput.value);
  onlinePiecesInput.max = String(Math.floor(width * height / 10));
  if (![width, height].every((value) => Number.isInteger(value) && value >= MIN_BOARD_DIMENSION && value <= MAX_BOARD_DIMENSION)
    || !Number.isInteger(piecesPerTurn) || piecesPerTurn < 1 || piecesPerTurn > Math.floor(width * height / 10)
    || !resolvedClock
    || (!unlimitedItemLifetime && (!Number.isInteger(itemLifetimeTurns) || itemLifetimeTurns < 1 || itemLifetimeTurns > 1000))) {
    onlineErrorElement.textContent = t("online.error.invalid-settings");
    onlineErrorElement.hidden = false;
    if (!unlimitedItemLifetime && (!Number.isInteger(itemLifetimeTurns) || itemLifetimeTurns < 1 || itemLifetimeTurns > 1000)) {
      onlineItemLifetimeInput.focus();
    }
    return null;
  }
  return {
    width,
    height,
    piecesPerTurn,
    clockMinutes,
    incrementSeconds,
    unlimitedTime,
    randomEvents: onlineRandomEventsToggle.checked,
    unlimitedItemLifetime,
    itemLifetimeTurns,
    itemSpawnMode: onlineItemSpawnMode.value,
    wormholesEnabled: onlineWormholesToggle.checked,
    animationsEnabled: settings.animationsEnabled,
    freeStartingPositions: onlineFreeStartToggle.checked,
    disabledItems: disabledItemsFrom(onlineItemOptions)
  };
}

function showOnlineRoom(message) {
  onlineRoomCode = message.roomCode;
  onlineSide = message.side;
  onlineRoomCodeValue.textContent = message.roomCode;
  onlineRoomStatus.textContent = t(message.status === "active" ? "online.joined" : "online.waiting");
  onlinePlayerSide.textContent = message.side
    ? t("online.yourSide", { side: message.side })
    : t("online.sidePending");
  onlineRoomEntry.hidden = true;
  onlineRoomLobby.hidden = false;
  onlineErrorElement.hidden = true;
  if (!onlineRoomModal.open) onlineRoomModal.showModal();
}

function enterOnlineGame(message) {
  const isNewOnlineSession = !onlineMode;
  if (Array.isArray(message.history)) moveHistory = message.history;
  else if (isNewOnlineSession) moveHistory = [];
  if (isNewOnlineSession) historyViewId = null;
  if (isNewOnlineSession) {
    leaveTraining(true);
    beginGameSession();
    stopClock();
    if (resultModal.open) resultModal.close();
    onlinePreviousSettings = { ...settings };
    onlineAdminAuthenticated = false;
    boardEditorActive = false;
    boardEditorTool = null;
    computerOpponent = { enabled: false, difficulty: "easy" };
    settings = { ...settings, ...message.state.settings, adminMode: false };
    onlineMode = true;
    gameScreen.classList.add("is-online");
    transitionScreens(true);
    syncMenuAmbient();
  }
  onlineRoomCode = message.roomCode || onlineRoomCode || multiplayerClient.savedSession?.roomCode;
  onlineSide = message.side || onlineSide || multiplayerClient.savedSession?.side;
  onlineConnected = true;
  onlineCommandPending = false;
  onlineStatusKey = null;
  onlineStatusError = null;
  onlineClockSnapshot = message.clock || null;
  onlineClockReceivedAt = performance.now();
  onlineUndoAvailable = Boolean(message.undoAvailable);
  onlineUndoPending = Boolean(message.undoProposal);
  if (onlineUndoPending) onlineStatusKey = "undo.waiting";
  incomingUndoProposal = message.undoProposal?.toSide === onlineSide
    ? { roomCode: message.roomCode, ...message.undoProposal }
    : null;
  onlineGameStatus.hidden = true;
  if (onlineRoomModal.open) onlineRoomModal.close();

  if (isNewOnlineSession || !state) {
    state = message.state;
    newlyPlacedCells.clear();
    newlySpawnedItems.clear();
    newlySpawnedWormholes.clear();
    activeAreaEffect = null;
    remoteAim = null;
    clockRemaining = { X: 0, O: 0 };
    render();
    startClock();
    if (state.phase === "finished") showResult();
  } else {
    updateState(message.state, { serverUpdate: true });
  }
  if (incomingUndoProposal) showUndoProposal(incomingUndoProposal);
}

function handleMultiplayerEvent(event) {
  if (event.type === "observing-room") {
    onlineObserverMode = true;
    onlineAdminObserver = event.isAdmin === true;
    onlineRoomId = event.roomId;
    onlineRoomCode = null;
    boardEditorFirstWormholeCell = null;
    onlineSide = null;
    onlineMode = true;
    onlineConnected = true;
    onlineAdminAuthenticated = onlineAdminObserver;
    onlinePreviousSettings = { ...settings };
    settings = { ...event.state.settings, adminMode: false };
    state = event.state;
    moveHistory = [];
    historyViewId = null;
    gameScreen.classList.add("is-online");
    beginGameSession();
    stopClock();
    transitionScreens(true);
    syncMenuAmbient();
    onlineGameStatus.textContent = t("activeGames.observing");
    onlineGameStatus.hidden = false;
    onlineClockSnapshot = event.clock;
    onlineClockReceivedAt = performance.now();
    render();
    return;
  }
  if (event.type === "admin-time-added" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineClockSnapshot = event.clock || onlineClockSnapshot;
    onlineClockReceivedAt = performance.now();
    onlineGameStatus.textContent = t("activeGames.adminTimeAdded");
    onlineGameStatus.hidden = false;
    renderClock();
    return;
  }
  if (event.type === "room-ready" && onlineObserverMode) event.type = "state";
  if (event.type === "time-added" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineClockSnapshot = event.clock || onlineClockSnapshot;
    onlineClockReceivedAt = performance.now();
    onlineGameStatus.textContent = t("clock.added", { player: event.targetSide, seconds: event.seconds });
    onlineGameStatus.hidden = false;
    renderClock();
    return;
  }
  if (event.type === "rating-updated" && onlineMode && isCurrentOnlineEvent(event)) {
    void refreshAccount();
    return;
  }
  if (event.type === "admin-authenticated" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineAdminAuthenticated = true;
    return;
  }
  if (event.type === "room-created" || event.type === "room-joined") {
    moveHistory = Array.isArray(event.history) ? event.history : [];
    historyViewId = null;
    showOnlineRoom(event);
    return;
  }
  if (event.type === "room-ready") {
    enterOnlineGame(event.room || event);
    return;
  }
  if (event.type === "room-resumed" || event.type === "reconnected") {
    const room = event.room || event;
    if (room.status === "waiting") {
      onlineRoomCode = room.roomCode;
      onlineSide = room.side;
      onlineConnected = true;
      showOnlineRoom(room);
    } else enterOnlineGame(room);
    return;
  }
  if (event.type === "aim" && onlineMode && isCurrentOnlineEvent(event)) {
    remoteAim = event.target ? { ...event.target, side: event.side } : null;
    render();
    return;
  }
  if (event.type === "undo-proposal" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineUndoPending = true;
    onlineUndoAvailable = false;
    onlineClockSnapshot = event.clock || onlineClockSnapshot;
    onlineClockReceivedAt = performance.now();
    if (event.toSide === onlineSide) {
      incomingUndoProposal = event;
      showUndoProposal(event);
    } else {
      onlineStatusKey = "undo.waiting";
      onlineGameStatus.hidden = false;
    }
    render();
    return;
  }
  if (event.type === "undo-cancelled" && onlineMode && isCurrentOnlineEvent(event)) {
    if (incomingUndoProposal?.proposalId === event.proposalId) incomingUndoProposal = null;
    onlineUndoPending = false;
    onlineUndoAvailable = event.undoAvailableFor === onlineSide;
    onlineClockSnapshot = event.clock || onlineClockSnapshot;
    onlineClockReceivedAt = performance.now();
    if (undoProposalModal.open && !localUndoConfirmation) undoProposalModal.close();
    onlineStatusKey = null;
    onlineStatusError = null;
    render();
    onlineGameStatus.textContent = t("undo.cancelled", { reason: t("undo.reason." + event.reason) });
    onlineGameStatus.hidden = false;
    return;
  }
  if (event.type === "undo-complete" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineUndoPending = false;
    incomingUndoProposal = null;
    onlineStatusKey = null;
    if (undoProposalModal.open) undoProposalModal.close();
    render();
    onlineGameStatus.textContent = t("undo.complete");
    onlineGameStatus.hidden = false;
    return;
  }
  if (event.type === "visual-event" && onlineMode && isCurrentOnlineEvent(event)) {
    if (historyViewId !== null) return;
    if (event.abilityType === "exchange") {
      if (state?.settings.animationsEnabled) playInventoryExchangeAnimation();
      return;
    }
    if (state?.settings.animationsEnabled && ["bomb", "antiBomb", "pointDestroy"].includes(event.abilityType)) {
      activeAreaEffect = {
        type: event.abilityType,
        row: event.row,
        col: event.col,
        startedAt: performance.now(),
        eventId: event.eventId
      };
      if (event.abilityType === "bomb" || event.abilityType === "pointDestroy") {
        const shell = document.querySelector(".app-shell");
        shell.classList.remove("bomb-screen-shake");
        void shell.offsetWidth;
        shell.classList.add("bomb-screen-shake");
      }
      render();
    }
    return;
  }
  if (event.type === "undo-proposal-created" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineStatusKey = "undo.waiting";
    onlineUndoPending = true;
    render();
    return;
  }
  if (event.type === "undo-vote-recorded" && onlineMode && isCurrentOnlineEvent(event)) {
    if (!event.accepted) {
      onlineStatusKey = null;
      render();
      onlineGameStatus.textContent = t("undo.cancelled", { reason: t("undo.reason.declined") });
      onlineGameStatus.hidden = false;
    }
    return;
  }
  if (event.type === "restart-proposal" && onlineMode && isCurrentOnlineEvent(event)) {
    incomingRestartProposal = event;
    const offeredSettings = event.settings || {};
    const disabledNames = (offeredSettings.disabledItems || [])
      .map((type) => EVENT_ITEM_DEFINITIONS[type]?.nameKey)
      .filter(Boolean)
      .map((key) => t(key));
    restartProposalDescription.textContent = event.kind === "rematch"
      ? t("dialog.rematchOffer")
      : t("dialog.restartSettingsOffer", {
        width: offeredSettings.width ?? "?",
        height: offeredSettings.height ?? "?",
        pieces: offeredSettings.piecesPerTurn ?? "?",
        clock: offeredSettings.unlimitedTime
          ? t("clock.unlimited")
          : t("clock.summary", { minutes: offeredSettings.clockMinutes ?? "?", seconds: offeredSettings.incrementSeconds ?? "?" }),
        disabled: disabledNames.length ? disabledNames.join(", ") : t("settings.itemsNoneDisabled"),
        events: t(offeredSettings.randomEvents ? "settings.randomEnabled" : "settings.randomDisabled"),
        spawnMode: t(`settings.spawnMode.${offeredSettings.itemSpawnMode || "standard"}`),
        wormholes: t(offeredSettings.wormholesEnabled ? "settings.wormholesEnabled" : "settings.randomDisabled")
      });
    restartProposalModal.showModal();
    restartProposalAcceptButton.focus();
    return;
  }
  if (event.type === "restart-cancelled" && onlineMode && isCurrentOnlineEvent(event)) {
    incomingRestartProposal = null;
    if (resultRematchButton) resultRematchButton.disabled = false;
    if (restartProposalModal.open) restartProposalModal.close();
    const message = t("dialog.restartCancelled", { reason: t("dialog.restartReason." + event.reason) });
    if (resultModal.open) {
      resultRematchStatus.textContent = message;
      resultRematchStatus.hidden = false;
    } else {
      onlineGameStatus.textContent = message;
      onlineGameStatus.hidden = false;
    }
    return;
  }
  if (event.type === "restart-complete" && onlineMode && isCurrentOnlineEvent(event)) {
    incomingRestartProposal = null;
    resultRematchButton.disabled = false;
    if (restartProposalModal.open) restartProposalModal.close();
    resultRematchStatus.hidden = true;
    return;
  }
  if (event.type === "restart-proposal-created" && onlineMode && isCurrentOnlineEvent(event)) {
    resultRematchButton.disabled = event.kind === "rematch";
    const message = t("dialog.restartWaiting");
    if (resultModal.open) {
      resultRematchStatus.textContent = message;
      resultRematchStatus.hidden = false;
    } else {
      onlineGameStatus.textContent = message;
      onlineGameStatus.hidden = false;
    }
    return;
  }
  if (event.type === "state" && onlineMode && isCurrentOnlineEvent(event)) {
    onlineConnected = true;
    onlineSide = event.side || onlineSide;
    settings = { ...event.state.settings, adminMode: false };
    document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";
    onlineCommandPending = false;
    if (pendingBoardEdit) {
      pendingBoardEdit = false;
      boardEditorMessageKey = "admin.editorPlaced";
      boardEditorStatus.textContent = t(boardEditorMessageKey);
    }
    onlineStatusError = null;
    onlineClockSnapshot = event.clock || null;
    onlineClockReceivedAt = performance.now();
    onlineUndoAvailable = Boolean(event.undoAvailable);
    onlineUndoPending = Boolean(event.undoProposal);
    if (!onlineUndoPending) incomingUndoProposal = null;
    else if (event.undoProposal.toSide === onlineSide) {
      incomingUndoProposal = { roomCode: event.roomCode, ...event.undoProposal };
    }
    lastSentAim = null;
    if (event.restartKind) {
      beginGameSession();
      boardEditorActive = false;
      boardEditorTool = null;
      activeAreaEffect = null;
      newlyPlacedCells.clear();
      newlySpawnedItems.clear();
      newlySpawnedWormholes.clear();
      remoteAim = null;
      lastSentAim = null;
      historyViewId = null;
    }
    syncHistoryFromServer(event);
    updateState(event.state, { serverUpdate: true });
    return;
  }
  if (event.type === "disconnected") {
    incomingRestartProposal = null;
    if (restartProposalModal.open) restartProposalModal.close();
    onlineConnected = false;
    onlineAdminAuthenticated = false;
    boardEditorActive = false;
    boardEditorTool = null;
    pendingBoardEdit = false;
    onlineCommandPending = false;
    onlineUndoAvailable = false;
    onlineUndoPending = false;
    incomingUndoProposal = null;
    if (undoProposalModal.open && !localUndoConfirmation) undoProposalModal.close();
    onlineStatusKey = "online.reconnecting";
    if (onlineMode) {
      onlineGameStatus.textContent = t(onlineStatusKey);
      onlineGameStatus.hidden = false;
      render();
    } else if (onlineRoomModal.open && multiplayerClient.savedSession) {
      onlineRoomStatus.textContent = t(onlineStatusKey);
    }
    return;
  }
  if (event.type === "reconnect-failed" || event.type === "room-closed") {
    onlineConnected = false;
    onlineAdminAuthenticated = false;
    boardEditorActive = false;
    boardEditorTool = null;
    pendingBoardEdit = false;
    remoteAim = null;
    lastSentAim = null;
    onlineCommandPending = false;
    onlineUndoAvailable = false;
    onlineUndoPending = false;
    incomingUndoProposal = null;
    if (undoProposalModal.open && !localUndoConfirmation) undoProposalModal.close();
    onlineStatusError = event.code || event.reason;
    onlineGameStatus.textContent = onlineErrorMessage(onlineStatusError);
    onlineGameStatus.hidden = false;
    if (onlineMode) render();
    else if (onlineRoomModal.open) showOnlineError(onlineStatusError);
    return;
  }
  if (event.type === "server-error" || event.type === "command-error" || event.type === "transport-error") {
    if (event.type === "command-error") {
      onlineCommandPending = false;
      if (pendingBoardEdit) {
        pendingBoardEdit = false;
        boardEditorMessageKey = "admin.editorInvalid";
        boardEditorStatus.textContent = t(boardEditorMessageKey);
      }
    }
    onlineStatusError = event.code;
    if (onlineMode) {
      onlineGameStatus.textContent = onlineErrorMessage(event.code);
      onlineGameStatus.hidden = false;
      render();
    } else if (onlineRoomModal.open) showOnlineError(event.code);
  }
}

multiplayerClient.subscribe(handleMultiplayerEvent);

function openLocalGame() {
  if (multiplayerClient.savedSession || onlineMode) leaveOnlineSession();
  leaveTraining(true);
  computerOpponent = { enabled: false, difficulty: "easy" };
  transitionScreens(true);
  syncMenuAmbient();
  setupGame();
  startButton.focus();
}

function openComputerDifficulty() {
  computerDifficultyModal.showModal();
  computerDifficultyModal.querySelector("[data-computer-difficulty='easy']")?.focus();
}

function startComputerGame(difficulty) {
  if (multiplayerClient.savedSession || onlineMode) leaveOnlineSession();
  computerOpponent = { enabled: true, difficulty };
  computerDifficultyModal.close();
  leaveTraining(true);
  transitionScreens(true);
  syncMenuAmbient();
  setupGame();
}

function returnToMainMenu() {
  if (onlineMode || multiplayerClient.savedSession) {
    leaveOnlineSession({ showMenu: true });
    return;
  }
  beginGameSession();
  leaveTraining(true);
  stopClock();
  computerOpponent = { enabled: false, difficulty: "easy" };
  transitionScreens(false);
  syncMenuAmbient();
}

function leaveTraining(restoreSettings) {
  if (!trainingSession) return;
  trainingSession = null;
  if (restoreSettings && trainingSavedSettings) settings = { ...trainingSavedSettings };
  trainingSavedSettings = null;
  document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";
}

function startTraining(lessonIndex = 0) {
  if (multiplayerClient.savedSession || onlineMode) leaveOnlineSession();
  beginGameSession();
  moveHistory = [];
  historyViewId = null;
  computerOpponent = { enabled: false, difficulty: "easy" };
  stopClock();
  if (trainingSession && trainingSavedSettings) settings = { ...trainingSavedSettings };
  else trainingSavedSettings = { ...settings };
  const lesson = TRAINING_LESSONS[lessonIndex];
  const trainingPiecesPerTurn = lesson.objective === "shield" ? 2 : 1;
  settings = { ...settings, width: TRAINING_BOARD_SIZE, height: TRAINING_BOARD_SIZE, piecesPerTurn: trainingPiecesPerTurn,
    unlimitedTime: true, randomEvents: false, freeStartingPositions: false, adminMode: false };
  document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";
  state = createGameState(settings);
  state = {
    ...state,
    board: createTrainingBoard(lessonIndex),
    phase: "playing",
    currentPlayer: "X",
    piecesLeft: trainingPiecesPerTurn,
    inventory: { X: lesson.item ? [{ id: "tutorial-shield", type: lesson.item }] : [], O: [] },
    nextEventItemId: 1,
    eventItems: [],
    selectedAbility: null,
    abilityTargets: [],
    protections: [],
    lastDestroyed: [],
    pendingExtraTurn: null,
    message: []
  };
  trainingSession = { lessonIndex, completed: false, feedbackKey: null, hintShown: false, piecePlaced: false };
  clockRemaining = { X: 0, O: 0 };
  transitionScreens(true);
  syncMenuAmbient();
  render();
}

function completeTrainingLesson() {
  if (!trainingSession || trainingSession.completed) return;
  trainingSession.completed = true;
  trainingSession.feedbackKey = TRAINING_LESSONS[trainingSession.lessonIndex].successKey;
  render();
}

function handleTrainingMove(row, col) {
  if (onlineMode) return sendOnlineCommand({ type: "place", row, col });
  if (!trainingSession) return updateState(playMove(state, row, col));
  const lesson = TRAINING_LESSONS[trainingSession.lessonIndex];
  if (lesson.objective === "shield" && trainingSession.piecePlaced) {
    trainingSession.feedbackKey = "training.lesson.shield.useItem";
    renderTrainingPanel();
    return;
  }
  if (!lesson.targets.some((target) => target.row === row && target.col === col)) {
    trainingSession.feedbackKey = "training.tryTarget";
    renderTrainingPanel();
    return;
  }
  const previous = state;
  updateState(playMove(state, row, col));
  if (lesson.objective === "piece" && state.board !== previous.board) completeTrainingLesson();
  if (lesson.objective === "reaction" && state.lastDestroyed.length > 0) completeTrainingLesson();
  if (lesson.objective === "shield" && state.board !== previous.board) {
    trainingSession.piecePlaced = true;
    trainingSession.feedbackKey = "training.lesson.shield.useItem";
    render();
  }
}

function handleTrainingAbilityTarget(itemId, row, col) {
  if (onlineMode) return sendOnlineCommand({ type: "ability-target", itemId, row, col });
  if (!trainingSession) return updateState(chooseAbilityTarget(state, itemId, row, col), {
    command: { type: "ability-target", itemId, row, col }, side: state.currentPlayer
  });
  const lesson = TRAINING_LESSONS[trainingSession.lessonIndex];
  if (!lesson.targets.some((target) => target.row === row && target.col === col)) {
    trainingSession.feedbackKey = "training.tryTarget";
    renderTrainingPanel();
    return;
  }
  updateState(chooseAbilityTarget(state, itemId, row, col));
  if (lesson.objective === "shield" && state.protections.length >= lesson.targets.length) completeTrainingLesson();
}

function handleTrainingAreaTarget(itemId, row, col) {
  if (onlineMode) return sendOnlineCommand({ type: "ability-target", itemId, row, col });
  if (!trainingSession) return updateState(useBomb(state, itemId, row, col), {
    command: { type: "ability-target", itemId, row, col }, side: state.currentPlayer
  });
  const lesson = TRAINING_LESSONS[trainingSession.lessonIndex];
  if (lesson.objective !== "bomb" || !lesson.targets.some((target) => target.row === row && target.col === col)) {
    trainingSession.feedbackKey = "training.tryTarget";
    renderTrainingPanel();
    return;
  }
  const previous = state;
  updateState(useBomb(state, itemId, row, col));
  if (state.board !== previous.board) completeTrainingLesson();
}

function renderTrainingPanel() {
  const active = Boolean(trainingSession);
  tutorialPanel.hidden = !active;
  gameScreen.classList.toggle("is-training", active);
  if (!active) {
    pageTitle.textContent = t("page.title");
    clockHeading.textContent = t("clock.heading");
    return;
  }
  const lesson = TRAINING_LESSONS[trainingSession.lessonIndex];
  const current = trainingSession.lessonIndex + 1;
  tutorialStep.textContent = t("training.step", { current, total: TRAINING_LESSONS.length });
  tutorialProgressFill.style.width = (current / TRAINING_LESSONS.length * 100) + "%";
  tutorialTitle.textContent = t(lesson.titleKey);
  tutorialDescription.textContent = t(lesson.descriptionKey);
  const feedback = trainingSession.feedbackKey || (trainingSession.hintShown ? lesson.hintKey : null);
  tutorialHint.hidden = !feedback;
  tutorialHint.textContent = feedback ? t(feedback) : "";
  tutorialAction.textContent = trainingSession.completed
    ? t(current === TRAINING_LESSONS.length ? "training.finish" : "training.next")
    : t(trainingSession.hintShown ? "training.hideHint" : "training.showHint");
  pageTitle.textContent = t("training.title");
  clockHeading.textContent = t("training.inventoryTitle");
}

function advanceTraining() {
  if (!trainingSession) return;
  if (!trainingSession.completed) {
    trainingSession.hintShown = !trainingSession.hintShown;
    trainingSession.feedbackKey = null;
    renderTrainingPanel();
    return;
  }
  if (trainingSession.lessonIndex + 1 < TRAINING_LESSONS.length) {
    startTraining(trainingSession.lessonIndex + 1);
  } else {
    leaveTraining(true);
    transitionScreens(false);
    syncMenuAmbient();
  }
}

function openMenuSettings() {
  menuAnimationsToggle.checked = settings.animationsEnabled;
  menuSettingsModal.showModal();
  menuSettingsDoneButton.focus();
}

function saveMenuSettings() {
  settings.animationsEnabled = menuAnimationsToggle.checked;
  animationsToggle.checked = settings.animationsEnabled;
  if (state) state.settings = { ...state.settings, animationsEnabled: settings.animationsEnabled };
  document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";
  menuSettingsModal.close();
  syncMenuAmbient();
}

function setupGame() {
  boardEditorActive = false;
  boardEditorTool = null;
  boardEditorMessageKey = null;
  pendingSettings = null;
  incomingRestartProposal = null;
  if (restartConfirmModal.open) restartConfirmModal.close();
  if (restartProposalModal.open) restartProposalModal.close();
  beginGameSession();
  stopClock();
  if (resultModal.open) resultModal.close();
  newlyPlacedCells.clear();
  newlySpawnedItems.clear();
  newlySpawnedWormholes.clear();
  moveHistory = [];
  historyViewId = null;
  localHistoryId = 0;
  incomingUndoProposal = null;
  localUndoConfirmation = false;
  onlineUndoAvailable = false;
  onlineUndoPending = false;
  if (undoProposalModal.open) undoProposalModal.close();
  activeAreaEffect = null;
  state = createGameState(settings);
  const initialHistoryEntry = createHistoryEntry(null, state, ++localHistoryId);
  if (initialHistoryEntry) moveHistory = appendHistoryEntry(moveHistory, initialHistoryEntry);
  clockRemaining = {
    X: settings.clockMinutes * 60_000,
    O: settings.clockMinutes * 60_000
  };
  localUndoHistory.preserveCompletedTurns = Boolean(computerOpponent.enabled);
  localUndoHistory.reset(state, clockRemaining);
  render();
  startClock();
  scheduleComputerAction();
}

function acceptHistoryEntry(entry) {
  if (!entry) return;
  moveHistory = appendHistoryEntry(moveHistory, entry);
  if (historyViewId !== null && !moveHistory.some(({ id }) => id === historyViewId)) historyViewId = null;
  renderHistoryControls();
}

function syncHistoryFromServer(message) {
  if (Array.isArray(message.history)) {
    moveHistory = message.history;
    if (historyViewId !== null && !moveHistory.some(({ id }) => id === historyViewId)) historyViewId = null;
  }
  acceptHistoryEntry(message.historyEntry);
}

function describeHistoryEntry(entry) {
  const coordinates = (entry.coordinates || []).map(({ row, col }) => `${columnLabel(col)}${row + 1}`).join(", ");
  if (entry.type === "start") return t("history.start");
  if (entry.type === "placement") return t("history.placement", { side: entry.side, coordinates });
  if (entry.type === "ability") return t("history.ability", {
    side: entry.side,
    item: t(`item.${entry.itemType || "unknown"}`),
    coordinates: coordinates ? ` · ${coordinates}` : ""
  });
  if (entry.type === "board-edit") return t("history.edit", { side: entry.side, coordinates });
  if (entry.type === "resign") return t("history.resign", { side: entry.side });
  if (entry.type === "timeout") return t("history.timeout", { side: entry.side });
  if (entry.type === "undo") return t("history.undo", { side: entry.side, turn: entry.turnNumber });
  return t("history.action", { side: entry.side || "—" });
}

function renderHistoryControls() {
  if (!historyList || !historyCard) return;
  historyCard.hidden = !state || !moveHistory.length || Boolean(trainingSession);
  historyList.replaceChildren();
  for (const entry of moveHistory) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-entry" + (entry.id === historyViewId ? " is-selected" : "");
    button.setAttribute("aria-current", entry.id === historyViewId ? "true" : "false");
    button.addEventListener("click", () => {
      historyViewId = entry.id;
      invalidateComputerAction();
      historyCard.open = true;
      render();
    });
    const heading = document.createElement("span");
    heading.className = "history-entry-heading";
    heading.textContent = `${t("history.counter", { round: entry.roundNumber, turn: entry.turnNumber })} · ${describeHistoryEntry(entry)}`;
    button.append(heading);
    if (entry.result?.length) {
      const result = document.createElement("small");
      result.className = "history-entry-result";
      result.textContent = formatMessage(entry.result);
      button.append(result);
    }
    row.append(button);
    historyList.append(row);
  }
  const viewing = historyViewId !== null;
  historyNotice.hidden = !viewing;
  historyLiveButton.hidden = !viewing;
  historyLiveButton.disabled = Boolean(viewing && onlineMode && !onlineConnected);
}

historyLiveButton.addEventListener("click", () => {
  if (onlineMode && !onlineConnected) return;
  historyViewId = null;
  render();
  if (state?.phase === "finished" && !resultModal.open) showResult();
  if (!onlineMode) scheduleComputerAction();
});

function updateState(nextState, {
  serverUpdate = false,
  command = null,
  side = null,
  undoRestore = false,
  undoTurn = null
} = {}) {
  if (onlineMode !== serverUpdate) return;
  if (historyViewId !== null && !serverUpdate) return;
  const previousState = state;
  const nextItemIds = new Set(nextState.eventItems.map((item) => item.id));
  if (previousState?.settings && !nextState.settings.unlimitedItemLifetime) {
    for (const item of previousState.eventItems) {
      if (item.lifetimeTurns === 1 && !nextItemIds.has(item.id)
        && nextState.board?.[item.row]?.[item.col] === EMPTY_CELL
        && nextState.settings.animationsEnabled
        && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        const key = `${item.row},${item.col}`;
        const expiry = { ...item, startedAt: performance.now() };
        expiringItems.set(key, expiry);
        const session = gameSessionId;
        window.setTimeout(() => {
          if (expiringItems.get(key) === expiry) expiringItems.delete(key);
          if (session === gameSessionId) render();
        }, 480);
      }
    }
  }
  const now = performance.now();
  if (!onlineMode && previousState.phase === "playing" && !advanceClock(now)) return;
  if (!onlineMode && !trainingSession) {
    const entry = undoRestore
      ? createUndoHistoryEntry(nextState, localHistoryId + 1, undoTurn)
      : createHistoryEntry(previousState, nextState, localHistoryId + 1, { command, side });
    if (entry) {
      localHistoryId += 1;
      acceptHistoryEntry(entry);
    }
  }
  const completedTurn = !undoRestore && previousState.phase === "playing"
    && previousState.piecesLeft === 1
    && (nextState.currentPlayer !== previousState.currentPlayer
      || (nextState.phase === "playing"
        && nextState.currentPlayer === previousState.currentPlayer
        && nextState.piecesLeft === nextState.settings.piecesPerTurn
        && Array.isArray(nextState.message)
        && nextState.message.some((entry) => entry?.key === "message.extraTurn"))
      || (nextState.phase === "finished" && nextState.piecesLeft === 0));
  const incrementAppliedMs = !onlineMode && completedTurn && !settings.unlimitedTime
    ? settings.incrementSeconds * 1000
    : 0;
  if (incrementAppliedMs > 0) clockRemaining[previousState.currentPlayer] += incrementAppliedMs;
  if (!onlineMode && !trainingSession && !undoRestore) {
    localUndoHistory.record(previousState, nextState, clockRemaining, incrementAppliedMs);
  }
  const gameJustEnded = previousState.phase !== "finished" && nextState.phase === "finished";
  const inventoryExchangeConfirmed = !onlineMode
    && nextState.message?.key === "message.exchange"
    && previousState.inventory !== nextState.inventory;
  const animationStartedAt = performance.now();
  newlyPlacedCells.clear();
  newlySpawnedItems.clear();
  if (!undoRestore && previousState.phase === "playing" && previousState.settings.animationsEnabled && nextState.board !== previousState.board) {
    for (let row = 0; row < nextState.board.length; row += 1) {
      for (let col = 0; col < nextState.board[row].length; col += 1) {
        const value = nextState.board[row][col];
        if ((value === "X" || value === "O") && previousState.board[row][col] !== value) {
          newlyPlacedCells.set(row + "," + col, animationStartedAt);
        }
      }
    }
  }
  if (!undoRestore && previousState.phase === "playing" && previousState.settings.animationsEnabled) {
    const previousItems = new Set(previousState.eventItems.map((item) => item.id));
    for (const item of nextState.eventItems) {
      if (!previousItems.has(item.id)) newlySpawnedItems.set(item.id, animationStartedAt);
    }
    if (nextState.wormholePair && nextState.wormholePair.id !== previousState.wormholePair?.id) {
      newlySpawnedWormholes.set(nextState.wormholePair.id, animationStartedAt);
    }
  }
  let bombStarted = false;
  if (!undoRestore && !onlineMode && historyViewId === null
    && previousState.phase === "playing" && previousState.settings.animationsEnabled) {
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
  if (state.phase !== "finished" && resultModal.open) resultModal.close();
  if (state.phase === "playing") startClock();
  else stopClock();
  if (state.phase === "finished") invalidateComputerAction();
  render();
  if (inventoryExchangeConfirmed && state.settings.animationsEnabled) playInventoryExchangeAnimation();
  if (gameJustEnded && historyViewId === null) showResult();
  else if (!onlineMode) scheduleComputerAction();
}

function playInventoryExchangeAnimation() {
  for (const player of ["X", "O"]) {
    const slots = inventoryElements[player];
    slots.classList.remove("inventory-exchange-animation");
    void slots.offsetWidth;
    slots.classList.add("inventory-exchange-animation");
  }
  window.setTimeout(() => {
    for (const player of ["X", "O"]) inventoryElements[player].classList.remove("inventory-exchange-animation");
  }, 560);
}

function placeBoardEditorObject(row, col) {
  if (historyViewId !== null || !boardEditorTool || !state || state.phase !== "playing" || isComputerControlledTurn()) return;
  if (boardEditorTool.kind === "wormhole-pair") {
    if (!boardEditorFirstWormholeCell) {
      boardEditorFirstWormholeCell = { row, col };
      boardEditorMessageKey = "admin.wormholeFirst";
      boardEditorStatus.textContent = t(boardEditorMessageKey);
      render();
      return;
    }
    if (boardEditorFirstWormholeCell.row === row && boardEditorFirstWormholeCell.col === col) return;
  }
  const object = boardEditorTool.kind === "wormhole-pair"
    ? { kind: "wormhole-pair", first: boardEditorFirstWormholeCell, second: { row, col } }
    : { ...boardEditorTool, row, col };
  if (onlineMode) {
    if (!onlineConnected || !onlineAdminAuthenticated || onlineCommandPending) return;
    pendingBoardEdit = true;
    if (!sendOnlineCommand({
      type: "board-edit",
      object
    })) {
      pendingBoardEdit = false;
      boardEditorMessageKey = "admin.editorInvalid";
      boardEditorStatus.textContent = t(boardEditorMessageKey);
    }
    if (boardEditorTool.kind === "wormhole-pair") boardEditorFirstWormholeCell = null;
    return;
  }
  const nextState = boardEditorTool.kind === "wormhole-pair"
    ? placeEditorWormholePair(state, state.currentPlayer, object.first, object.second, { admin: true })
    : placeEditorObject(state, state.currentPlayer, object);
  if (nextState === state) {
    boardEditorStatus.textContent = t("admin.editorInvalid");
    return;
  }
  boardEditorFirstWormholeCell = null;
  boardEditorMessageKey = "admin.editorPlaced";
  boardEditorStatus.textContent = t(boardEditorMessageKey);
  updateState(nextState, {
    command: { type: "board-edit", object },
    side: state.currentPlayer
  });
}

function showResult() {
  const loser = state.winner === "X" ? "O" : "X";
  messageElement.textContent = t("game.winner", { player: state.winner, reason: formatMessage(state.finishReason) });
  resultTitle.textContent = t("dialog.win", { player: state.winner });
  resultDescription.textContent = t("dialog.congrats", { reason: formatMessage(state.finishReason) });
  resultRoast.textContent = t("dialog.roast", { player: loser });
  resultRematchStatus.hidden = true;
  resultRematchButton.hidden = false;
  resultExportPngButton.hidden = false;
  resultExportJsonButton.hidden = false;
  resultExportStatus.hidden = true;
  resultModal.showModal();
  resultRematchButton.focus();
}

async function exportFinalMap(format) {
  const exportState = state;
  if (!exportState || exportState.phase !== "finished") {
    resultExportStatus.textContent = t("export.failed");
    resultExportStatus.hidden = false;
    return;
  }
  const button = format === "png" ? resultExportPngButton : resultExportJsonButton;
  button.disabled = true;
  resultExportStatus.textContent = t("export.preparing");
  resultExportStatus.hidden = false;
  try {
    if (format === "png") {
      await downloadBoardPng(exportState, {
        itemIconUrl: (type) => EVENT_ITEM_DEFINITIONS[type]?.icon,
        shieldIconUrl: (permanent) => EVENT_ITEM_DEFINITIONS[permanent ? "gangstaShield" : "shield"]?.icon
      });
    } else {
      downloadMapJson(exportState);
    }
    resultExportStatus.textContent = t("export.complete");
  } catch {
    resultExportStatus.textContent = t("export.failed");
  } finally {
    button.disabled = false;
  }
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
  const displayState = historyViewId === null
    ? state
    : restoreHistoryPosition(moveHistory.find(({ id }) => id === historyViewId)?.position) || state;
  renderGamePosition(displayState);
}

function renderGamePosition(state) {
  settingsButton.disabled = Boolean(onlineMode
    && (state?.phase === "finished" || !onlineConnected || onlineCommandPending)) || historyViewId !== null;
  const animationNow = performance.now();
  const legalMoveKeys = new Set(getLegalMoves(state).map(({ row, col }) => row + "," + col));
  for (const [key, startedAt] of newlyPlacedCells) {
    if (animationNow - startedAt >= 720) newlyPlacedCells.delete(key);
  }
  for (const [id, startedAt] of newlySpawnedItems) {
    if (animationNow - startedAt >= 680) newlySpawnedItems.delete(id);
  }
  for (const [id, startedAt] of newlySpawnedWormholes) {
    if (animationNow - startedAt >= 760) newlySpawnedWormholes.delete(id);
  }
  if (activeAreaEffect && animationNow - activeAreaEffect.startedAt >= 520) activeAreaEffect = null;
  boardElement.innerHTML = "";
  const destroyedCells = new Set(state.lastDestroyed.map(({ row, col }) => row + "," + col));
  const protectedCells = new Set(state.protections.map(({ row, col }) => row + "," + col));
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
      const protectedCell = protectedCells.has(row + "," + col);
      const endpoints = state.wormholePair?.endpoints;
      const wormholeEndpoint = endpoints?.orange?.row === row && endpoints.orange.col === col
        ? ["orange", endpoints.orange]
        : endpoints?.blue?.row === row && endpoints.blue.col === col
          ? ["blue", endpoints.blue]
          : null;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      const contents = value === EMPTY_CELL ? t("game.empty") : value === BLOCKED_CELL ? t("game.blocked") : t("game.player", { player: value });
      const itemLabel = eventItem ? t("game.item", {
        item: `${t(EVENT_ITEM_DEFINITIONS[eventItem.type].nameKey)} · ${t(getItemCategoryLocalizationKey(eventItem.type))}`
      }) : "";
      const wormholeLabel = wormholeEndpoint
        ? t("wormhole.cell", { color: t(`wormhole.${wormholeEndpoint[0]}`), rounds: state.wormholePair.roundsRemaining })
        : "";
      cell.setAttribute("aria-label", t("game.cell", {
        row: row + 1, col: columnLabel(col), contents, item: [itemLabel, wormholeLabel].filter(Boolean).join(". ")
      }));

      if (wormholeEndpoint) {
        const [color] = wormholeEndpoint;
        cell.classList.add("wormhole-endpoint", `wormhole-${color}`);
        const startedAt = newlySpawnedWormholes.get(state.wormholePair.id);
        if (startedAt !== undefined && state.settings.animationsEnabled) {
          cell.classList.add("wormhole-entering");
          cell.style.setProperty("--wormhole-animation-delay", `-${animationNow - startedAt}ms`);
        }
        const vortex = document.createElement("span");
        vortex.className = "wormhole-vortex";
        vortex.setAttribute("aria-hidden", "true");
        const rounds = document.createElement("span");
        rounds.className = "wormhole-rounds";
        rounds.textContent = String(state.wormholePair.roundsRemaining);
        rounds.setAttribute("aria-hidden", "true");
        cell.append(vortex, rounds);
      }

      if (eventItem) {
        const itemIcon = document.createElement("img");
        itemIcon.src = EVENT_ITEM_DEFINITIONS[eventItem.type].icon;
        itemIcon.alt = "";
        itemIcon.setAttribute("aria-hidden", "true");
        cell.classList.add("event-item", "event-item-" + eventItem.type);
        cell.dataset.itemCategory = getItemCategory(eventItem.type);
        if (Number.isInteger(eventItem.lifetimeTurns)) {
          cell.dataset.itemLifetime = String(eventItem.lifetimeTurns);
          if (eventItem.lifetimeTurns <= 2) cell.classList.add("event-item-expiring");
          if (eventItem.lifetimeTurns === 1) cell.classList.add("event-item-expiring-soon");
        }
        const itemAnimationStartedAt = newlySpawnedItems.get(eventItem.id);
        if (itemAnimationStartedAt !== undefined && state.settings.animationsEnabled) {
          cell.classList.add("event-item-entering");
          cell.style.setProperty("--item-animation-delay", "-" + (animationNow - itemAnimationStartedAt) + "ms");
        }
        cell.appendChild(itemIcon);
      } else {
        const fadingItem = expiringItems.get(`${row},${col}`);
        if (fadingItem) {
          const icon = document.createElement("img");
          icon.src = EVENT_ITEM_DEFINITIONS[fadingItem.type]?.icon || "";
          icon.alt = "";
          icon.className = "event-item-fading-away";
          icon.setAttribute("aria-hidden", "true");
          cell.append(icon);
        }
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

      if (boardEditorActive && state.phase === "playing" && !isComputerControlledTurn()
        && (!onlineMode || (onlineConnected && onlineAdminAuthenticated && !onlineCommandPending))) {
        const editableCell = boardEditorTool?.kind === "clear"
          ? value !== EMPTY_CELL || eventItem || protectedCell || wormholeEndpoint
          : value === EMPTY_CELL && !wormholeEndpoint && !eventItem && !protectedCell;
        cell.disabled = !editableCell || historyViewId !== null;
        cell.classList.toggle("editor-target", editableCell && Boolean(boardEditorTool));
        cell.classList.toggle("editor-wormhole-first", Boolean(boardEditorFirstWormholeCell
          && boardEditorFirstWormholeCell.row === row && boardEditorFirstWormholeCell.col === col));
        if (editableCell) cell.addEventListener("click", () => placeBoardEditorObject(row, col));
      } else if (isComputerControlledTurn() || (onlineMode && !canHumanAct())) {
        cell.disabled = true;
      } else if (state.phase === "setup-x" || state.phase === "setup-o") {
        cell.disabled = value !== EMPTY_CELL;
        if (!cell.disabled) cell.addEventListener("click", () => performGameAction(
          { type: "choose-start", row, col },
          () => chooseStart(state, row, col)
        ));
      } else if (state.phase === "playing" && selectedAbility) {
        if (selectedAbility.type === "bomb" || selectedAbility.type === "antiBomb") {
          const lessonAllowsArea = !trainingSession || TRAINING_LESSONS[trainingSession.lessonIndex].objective !== "bomb"
            || TRAINING_LESSONS[trainingSession.lessonIndex].targets.some((target) => target.row === row && target.col === col);
          const valid = isValidAreaTarget(state, row, col) && lessonAllowsArea;
          cell.disabled = !valid;
          if (valid) cell.addEventListener("click", () => selectedAbility.type === "bomb"
            ? handleTrainingAreaTarget(selectedAbility.id, row, col)
            : onlineMode
              ? sendOnlineCommand({ type: "ability-target", itemId: selectedAbility.id, row, col })
              : updateState(useAntiBomb(state, selectedAbility.id, row, col), {
                command: { type: "ability-target", itemId: selectedAbility.id, row, col }, side: state.currentPlayer
              }));
        } else if (selectedAbility.type === "debris") {
          const valid = isValidDebrisTarget(state, row, col);
          cell.disabled = !valid;
          cell.classList.toggle("ability-target-selected", isSelectedTarget);
          if (valid) cell.addEventListener("click", () => handleTrainingAbilityTarget(selectedAbility.id, row, col));
        } else if (selectedAbility.type === "shield" || selectedAbility.type === "gangstaShield") {
          const valid = isValidShieldTarget(state, row, col);
          cell.disabled = !valid;
          cell.classList.toggle("ability-target-selected", isSelectedTarget);
          if (valid) cell.addEventListener("click", () => handleTrainingAbilityTarget(selectedAbility.id, row, col));
        } else if (selectedAbility.type === "pointDestroy") {
          const valid = isValidPointDestroyTarget(state, row, col);
          cell.disabled = !valid;
          if (valid) cell.addEventListener("click", () => onlineMode
            ? sendOnlineCommand({ type: "ability-target", itemId: selectedAbility.id, row, col })
            : updateState(usePointDestroy(state, selectedAbility.id, row, col), {
              command: { type: "ability-target", itemId: selectedAbility.id, row, col }, side: state.currentPlayer
            }));
        } else if (trainingSession?.piecePlaced && TRAINING_LESSONS[trainingSession.lessonIndex].objective === "shield") {
          cell.disabled = true;
        } else if (legalMoveKeys.has(row + "," + col)) {
          cell.disabled = false;
          markLegalCell(cell, state.currentPlayer);
          cell.addEventListener("click", () => handleTrainingMove(row, col));
        } else {
          cell.disabled = true;
        }
      } else if (state.phase === "playing" && trainingSession?.piecePlaced && TRAINING_LESSONS[trainingSession.lessonIndex].objective === "shield") {
        cell.disabled = true;
      } else if (state.phase === "playing" && legalMoveKeys.has(row + "," + col)) {
        cell.disabled = false;
        markLegalCell(cell, state.currentPlayer);
        cell.addEventListener("click", () => handleTrainingMove(row, col));
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

      if (trainingSession) {
        const lesson = TRAINING_LESSONS[trainingSession.lessonIndex];
        const isLessonTarget = lesson.objective === "bomb"
          ? lesson.targets.some((target) => row >= target.row && row < target.row + 2 && col >= target.col && col < target.col + 2)
          : lesson.targets.some((target) => target.row === row && target.col === col);
        if (!trainingSession.completed && isLessonTarget) {
          cell.classList.add("training-target");
        }
        if (trainingSession.completed) cell.disabled = true;
      }

      if (destroyedCells.has(row + "," + col)) {
        const effectSize = activeAreaEffect?.type === "pointDestroy" ? 1 : 2;
        const isAreaEffectCell = activeAreaEffect
          && row >= activeAreaEffect.row && row < activeAreaEffect.row + effectSize
          && col >= activeAreaEffect.col && col < activeAreaEffect.col + effectSize;
        if (!isAreaEffectCell) cell.classList.add("just-destroyed");
      }
      if (historyViewId !== null) cell.disabled = true;
      boardElement.appendChild(cell);
    }
  }
  areaEffectOverlay.hidden = true;
  areaEffectOverlay.replaceChildren();
  if (historyViewId === null && activeAreaEffect && state.settings.animationsEnabled) {
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
  if (historyViewId === null) updateBombAim();
  else bombAimOverlay.hidden = true;
  remoteAimOverlay.hidden = true;
  remoteAimOverlay.className = "remote-aim-overlay";
  if (historyViewId === null && onlineMode && remoteAim && remoteAim.side !== onlineSide) {
    const firstCell = boardElement.querySelector('.cell[data-row="' + remoteAim.row + '"][data-col="' + remoteAim.col + '"]');
    const isArea = remoteAim.abilityType === "bomb" || remoteAim.abilityType === "antiBomb";
    const lastCell = isArea
      ? boardElement.querySelector('.cell[data-row="' + (remoteAim.row + 1) + '"][data-col="' + (remoteAim.col + 1) + '"]')
      : firstCell;
    if (firstCell && lastCell) {
      remoteAimOverlay.classList.add("remote-aim-" + remoteAim.side.toLowerCase());
      remoteAimOverlay.style.left = firstCell.offsetLeft + "px";
      remoteAimOverlay.style.top = firstCell.offsetTop + "px";
      remoteAimOverlay.style.width = (lastCell.offsetLeft + lastCell.offsetWidth - firstCell.offsetLeft) + "px";
      remoteAimOverlay.style.height = (lastCell.offsetTop + lastCell.offsetHeight - firstCell.offsetTop) + "px";
      remoteAimOverlay.hidden = false;
    }
  }
  boardElement.appendChild(remoteAimOverlay);

  turnRule.textContent = t("game.turnCount", { count: state.settings.piecesPerTurn, pieces: pieceForm(state.settings.piecesPerTurn) });
  privacyNote.lastChild.textContent = " " + t(state.settings.freeStartingPositions ? "privacy.hidden" : "privacy.corners");

  if (state.phase === "setup-x") {
    roundCounter.hidden = true;
    statusElement.textContent = t("game.statusX");
    turnElement.textContent = t("board.preparingTurn");
    turnProgress.hidden = true;
    sideTitle.textContent = onlineMode
      ? t(state.setupPlayer === onlineSide ? "online.chooseStart" : "online.waitingStart")
      : t("game.choosePlayer", { player: "X" });
    sideDescription.textContent = onlineMode
      ? t(state.setupPlayer === onlineSide ? "online.chooseStartHelp" : "online.waitingStartHelp", { player: state.setupPlayer })
      : t("game.pickStartX");
  } else if (state.phase === "setup-o") {
    roundCounter.hidden = true;
    statusElement.textContent = t("game.statusO");
    turnElement.textContent = t("game.hiddenChoice");
    turnProgress.hidden = true;
    sideTitle.textContent = onlineMode
      ? t(state.setupPlayer === onlineSide ? "online.chooseStart" : "online.waitingStart")
      : t(computerOpponent.enabled ? "computer.setupTitle" : "game.choosePlayer", { player: "O" });
    sideDescription.textContent = onlineMode
      ? t(state.setupPlayer === onlineSide ? "online.chooseStartHelp" : "online.waitingStartHelp", { player: state.setupPlayer })
      : t(computerOpponent.enabled ? "computer.setupHelp" : "game.pickStartO");
  } else if (state.phase === "playing") {
    roundCounter.hidden = false;
    roundCounter.textContent = t("history.counter", {
      round: state.roundNumber ?? 1,
      turn: state.turnNumber ?? 1
    });
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
    sideTitle.textContent = onlineMode
      ? t(state.currentPlayer === onlineSide ? "online.yourTurn" : "online.opponentTurn", { player: state.currentPlayer })
      : t(computerOpponent.enabled && state.currentPlayer === "O" ? "computer.turnTitle" : "game.sideTurn", { player: state.currentPlayer });
    sideDescription.textContent = onlineMode
      ? t(state.currentPlayer === onlineSide ? "online.yourTurnHelp" : "online.opponentTurnHelp")
      : t(computerOpponent.enabled && state.currentPlayer === "O" ? "computer.turnHelp" : "game.sideHelp");
  } else {
    roundCounter.hidden = false;
    roundCounter.textContent = t("history.counter", {
      round: state.roundNumber ?? 1,
      turn: state.turnNumber ?? 1
    });
    statusElement.textContent = t("game.finished");
    turnElement.textContent = t("game.playAgain");
    turnProgress.hidden = true;
    sideTitle.textContent = t("game.sideFinished");
    sideDescription.textContent = t("game.sideFinishedHelp");
  }

  messageElement.textContent = formatMessage(state.message);
  if (onlineMode) {
    onlineGameStatus.textContent = onlineStatusError
      ? onlineErrorMessage(onlineStatusError)
      : onlineStatusKey ? t(onlineStatusKey) : t("online.connectedAs", { side: onlineSide });
    onlineGameStatus.hidden = false;
  } else {
    onlineGameStatus.hidden = true;
  }
  syncBoardGeometry();
  renderClock();
  renderInventories(state);
  renderTrainingPanel();
  renderHistoryControls();
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
  if (trainingSession && TRAINING_LESSONS[trainingSession.lessonIndex].objective === "bomb"
    && !TRAINING_LESSONS[trainingSession.lessonIndex].targets.some((target) => target.row === row && target.col === col)) {
    bombAimOverlay.hidden = true;
    return;
  }
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
  if (onlineMode && onlineConnected && state?.phase === "playing" && state.currentPlayer === onlineSide) {
    const selected = getSelectedAbility(state);
    const aimCell = bombAimCell;
    const key = selected && aimCell && isValidAimTarget(selected, aimCell.row, aimCell.col)
      ? `${selected.type}:${aimCell.row}:${aimCell.col}`
      : null;
    const timestamp = performance.now();
    if (key !== lastSentAim && (key === null || timestamp - lastSentAimAt >= 55)) {
      if (key === null) multiplayerClient.clearAim();
      else multiplayerClient.sendAim(aimCell.row, aimCell.col);
      lastSentAim = key;
      lastSentAimAt = timestamp;
    }
  }
});
boardElement.addEventListener("pointerleave", () => {
  bombAimCell = null;
  bombAimOverlay.hidden = true;
  if (onlineMode && lastSentAim !== null) multiplayerClient.clearAim();
  lastSentAim = null;
});

function isValidAimTarget(ability, row, col) {
  if (ability.type === "bomb" || ability.type === "antiBomb") return isValidAreaTarget(state, row, col);
  if (ability.type === "pointDestroy") return isValidPointDestroyTarget(state, row, col);
  if (ability.type === "debris") return isValidDebrisTarget(state, row, col);
  if (ability.type === "shield" || ability.type === "gangstaShield") return isValidShieldTarget(state, row, col);
  return false;
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
  unlimitedItemLifetimeToggle.checked = settings.unlimitedItemLifetime;
  itemLifetimeInput.value = String(settings.itemLifetimeTurns);
  itemLifetimeField.hidden = settings.unlimitedItemLifetime;
  itemLifetimeInput.disabled = settings.unlimitedItemLifetime;
  itemSpawnModeSelect.value = settings.itemSpawnMode;
  updateSpawnModeHelp(itemSpawnModeSelect, itemSpawnModeHelp);
  wormholesToggle.checked = settings.wormholesEnabled;
  animationsToggle.checked = settings.animationsEnabled;
  adminModeToggle.checked = settings.adminMode;
  freeStartToggle.checked = settings.freeStartingPositions;
  renderItemOptions(itemOptions, settings.disabledItems);
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
  const unlimitedItemLifetime = unlimitedItemLifetimeToggle.checked;
  const itemLifetimeTurns = Number(itemLifetimeInput.value);
  const animationsEnabled = animationsToggle.checked;
  const adminMode = adminModeToggle.checked;
  const resolvedClock = resolveClockSettings({
    unlimitedTime,
    clockMinutes: clockMinutesInput.value,
    incrementSeconds: clockIncrementInput.value
  }, settings);
  const clockMinutes = resolvedClock?.clockMinutes ?? Number(clockMinutesInput.value);
  const incrementSeconds = resolvedClock?.incrementSeconds ?? Number(clockIncrementInput.value);
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
  if (!unlimitedTime && (!resolvedClock || !Number.isInteger(clockMinutes) || clockMinutes < 1 || clockMinutes > 60)) {
    showFieldError(clockMinutesInput, clockMinutesError, t("validation.minutes"));
    firstInvalid = firstInvalid || clockMinutesInput;
  }
  if (!unlimitedTime && (!resolvedClock || !Number.isInteger(incrementSeconds) || incrementSeconds < 0 || incrementSeconds > 60)) {
    showFieldError(clockIncrementInput, clockIncrementError, t("validation.increment"));
    firstInvalid = firstInvalid || clockIncrementInput;
  }
  if (!unlimitedItemLifetime && (!Number.isInteger(itemLifetimeTurns) || itemLifetimeTurns < 1 || itemLifetimeTurns > 1000)) {
    itemLifetimeInput.setAttribute("aria-invalid", "true");
    itemLifetimeInput.focus();
    return;
  }
  itemLifetimeInput.removeAttribute("aria-invalid");

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  pendingSettings = {
    width,
    height,
    piecesPerTurn,
    clockMinutes,
    incrementSeconds,
    unlimitedTime,
    randomEvents,
    unlimitedItemLifetime,
    itemLifetimeTurns,
    itemSpawnMode: itemSpawnModeSelect.value,
    wormholesEnabled: wormholesToggle.checked,
    animationsEnabled,
    freeStartingPositions: freeStartToggle.checked,
    ...(onlineMode ? {} : { adminMode }),
    disabledItems: disabledItemsFrom(itemOptions)
  };
  settingsModal.close();
  restartConfirmModal.showModal();
  restartConfirmButton.focus();
}

function cancelSettingsRestart() {
  settings = resolveSettingsRestart(settings, pendingSettings, false);
  pendingSettings = null;
  if (restartConfirmModal.open) restartConfirmModal.close();
}

function confirmSettingsRestart() {
  if (!pendingSettings) {
    restartConfirmModal.close();
    return;
  }
  const nextSettings = pendingSettings;
  pendingSettings = null;
  restartConfirmModal.close();
  if (onlineMode) {
    multiplayerClient.proposeRestart("settings", nextSettings).catch((error) => {
      onlineStatusError = error.code;
      onlineGameStatus.textContent = onlineErrorMessage(error.code);
      onlineGameStatus.hidden = false;
    });
    onlineGameStatus.textContent = t("dialog.restartSending");
    onlineGameStatus.hidden = false;
    return;
  }
  settings = resolveSettingsRestart(settings, nextSettings, true);
  document.documentElement.dataset.gameAnimations = settings.animationsEnabled ? "on" : "off";
  setupGame();
}

async function answerRestartProposal(accept) {
  const proposal = incomingRestartProposal;
  if (!proposal) return;
  incomingRestartProposal = null;
  if (restartProposalModal.open) restartProposalModal.close();
  try {
    await multiplayerClient.voteRestart(proposal.proposalId, accept);
  } catch (error) {
    onlineGameStatus.textContent = onlineErrorMessage(error.code);
    onlineGameStatus.hidden = false;
  }
}

function showUndoProposal(proposal) {
  document.querySelector("#undo-proposal-title").textContent = t("undo.proposalTitle");
  undoProposalDescription.textContent = t("undo.proposalText");
  undoProposalAcceptButton.textContent = t("dialog.restartAccept");
  undoProposalDeclineButton.textContent = t("dialog.restartDecline");
  if (!undoProposalModal.open) undoProposalModal.showModal();
  undoProposalAcceptButton.focus();
}

function applyLocalUndo() {
  if (!state || state.phase !== "playing" || historyViewId !== null) return false;
  if (!advanceClock(performance.now())) return false;
  const targetSide = computerOpponent.enabled ? "X" : null;
  const undo = localUndoHistory.undo(targetSide, { latestOnly: !computerOpponent.enabled });
  if (!undo) return false;
  invalidateComputerAction();
  if (Number.isFinite(undo.clockIncrementMs) && undo.clockIncrementMs > 0) {
    clockRemaining[undo.side] = Math.max(0, clockRemaining[undo.side] - undo.clockIncrementMs);
  }
  updateState(undo.state, {
    undoRestore: true,
    undoTurn: { side: undo.side, turnNumber: undo.turnNumber }
  });
  return true;
}

async function answerUndoProposal(accept) {
  if (localUndoConfirmation) {
    localUndoConfirmation = false;
    if (undoProposalModal.open) undoProposalModal.close();
    if (accept) applyLocalUndo();
    return;
  }
  const proposal = incomingUndoProposal;
  if (!proposal) return;
  incomingUndoProposal = null;
  if (undoProposalModal.open) undoProposalModal.close();
  try {
    await multiplayerClient.voteUndo(proposal.proposalId, accept);
  } catch (error) {
    onlineStatusKey = null;
    onlineStatusError = error.code;
    render();
  }
}

function requestUndoTurn() {
  if (!state || state.phase !== "playing" || historyViewId !== null) return;
  if (onlineMode) {
    if (!onlineConnected || !onlineUndoAvailable || onlineUndoPending) return;
    undoTurnButton.disabled = true;
    multiplayerClient.proposeUndo().catch((error) => {
      onlineStatusKey = null;
      onlineStatusError = error.code;
      render();
    });
    return;
  }
  const targetSide = computerOpponent.enabled ? "X" : null;
  if (!localUndoHistory.canUndo(targetSide, { latestOnly: !computerOpponent.enabled })) return;
  localUndoConfirmation = true;
  document.querySelector("#undo-proposal-title").textContent = t("undo.localTitle");
  undoProposalDescription.textContent = t("undo.localText");
  undoProposalDeclineButton.textContent = t("settings.cancel");
  undoProposalAcceptButton.textContent = t("undo.button");
  undoProposalModal.showModal();
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
itemSpawnModeSelect.addEventListener("change", () => updateSpawnModeHelp(itemSpawnModeSelect, itemSpawnModeHelp));
onlineItemSpawnMode.addEventListener("change", () => updateSpawnModeHelp(onlineItemSpawnMode, onlineItemSpawnModeHelp));
onlineUnlimitedItemLifetimeToggle.addEventListener("change", () => {
  onlineItemLifetimeField.hidden = onlineUnlimitedItemLifetimeToggle.checked;
  onlineItemLifetimeInput.disabled = onlineUnlimitedItemLifetimeToggle.checked;
});
unlimitedItemLifetimeToggle.addEventListener("change", () => {
  itemLifetimeField.hidden = unlimitedItemLifetimeToggle.checked;
  itemLifetimeInput.disabled = unlimitedItemLifetimeToggle.checked;
});
settingsButton.addEventListener("click", openSettings);
localGameButton.addEventListener("click", openLocalGame);
onlineGameButton.addEventListener("click", () => openOnlineRoom());
activeGamesRefresh.addEventListener("click", () => void refreshActiveGames());
onlineRoomCloseButton.addEventListener("click", () => onlineRoomModal.close());
onlineCreateRoomButton.addEventListener("click", async () => {
  const roomSettings = collectOnlineRoomSettings();
  if (!roomSettings) return;
  onlineCreateRoomButton.disabled = true;
  onlineErrorElement.hidden = true;
  onlineRoomStatus.textContent = t("online.connecting");
  try {
    await multiplayerClient.createRoom(roomSettings, { publicRoom: onlinePublicRoomToggle.checked });
  } catch (error) {
    showOnlineError(error.code);
  } finally {
    onlineCreateRoomButton.disabled = false;
  }
});
for (const input of [onlineBoardWidthInput, onlineBoardHeightInput]) {
  input.addEventListener("input", () => {
    const width = Number(onlineBoardWidthInput.value);
    const height = Number(onlineBoardHeightInput.value);
    onlinePiecesInput.max = String(Math.floor(width * height / 10));
  });
}
onlineUnlimitedTimeToggle.addEventListener("change", () => {
  onlineClockMinutesInput.disabled = onlineUnlimitedTimeToggle.checked;
  onlineClockIncrementInput.disabled = onlineUnlimitedTimeToggle.checked;
});
onlineJoinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = onlineRoomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showOnlineError("invalid-room-code");
    onlineRoomCodeInput.focus();
    return;
  }
  onlineJoinForm.querySelector("button[type='submit']").disabled = true;
  onlineErrorElement.hidden = true;
  try {
    await multiplayerClient.joinRoom(code);
  } catch (error) {
    showOnlineError(error.code);
  } finally {
    onlineJoinForm.querySelector("button[type='submit']").disabled = false;
  }
});
onlineResumeButton.addEventListener("click", async () => {
  onlineResumeButton.disabled = true;
  onlineErrorElement.hidden = true;
  try {
    await multiplayerClient.resumeSavedRoom();
  } catch (error) {
    showOnlineError(error.code);
  } finally {
    onlineResumeButton.disabled = false;
  }
});
onlineCopyCodeButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(onlineRoomCode || onlineRoomCodeValue.textContent);
    onlineRoomStatus.textContent = t("online.codeCopied");
  } catch {
    showOnlineError("clipboard-unavailable");
  }
});
onlineCopyLinkButton.addEventListener("click", async () => {
  try {
    const invite = new URL(window.location.href);
    invite.searchParams.set("room", onlineRoomCode || onlineRoomCodeValue.textContent);
    await navigator.clipboard.writeText(invite.toString());
    onlineRoomStatus.textContent = t("online.linkCopied");
  } catch {
    showOnlineError("clipboard-unavailable");
  }
});
onlineReturnMenuButton.addEventListener("click", () => {
  if (multiplayerClient.savedSession || onlineMode) leaveOnlineSession();
  if (onlineRoomModal.open) onlineRoomModal.close();
  onlineRoomEntry.hidden = false;
  onlineRoomLobby.hidden = true;
  onlineErrorElement.hidden = true;
});
adminTimeControls.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-time]");
  if (!button || !onlineMode || !onlineAdminAuthenticated || !onlineConnected) return;
  button.disabled = true;
  try {
    await multiplayerClient.adjustAdminTime(button.dataset.adminTime, 30);
  } catch (error) {
    onlineGameStatus.textContent = t("clock.addFailed", { reason: error.code || "unknown" });
    onlineGameStatus.hidden = false;
  } finally {
    button.disabled = false;
  }
});
computerGameButton.addEventListener("click", openComputerDifficulty);
computerDifficultyModal.querySelectorAll("[data-computer-difficulty]").forEach((button) => {
  button.addEventListener("click", () => startComputerGame(button.dataset.computerDifficulty));
});
computerDifficultyCancelButton.addEventListener("click", () => computerDifficultyModal.close());
trainingButton.addEventListener("click", () => startTraining(0));
 tutorialAction.addEventListener("click", advanceTraining);
returnMenuButton.addEventListener("click", returnToMainMenu);
menuSettingsButton.addEventListener("click", openMenuSettings);
menuSettingsCloseButton.addEventListener("click", () => menuSettingsModal.close());
menuSettingsDoneButton.addEventListener("click", saveMenuSettings);
function accountErrorMessage(error) {
  const code = error instanceof Error ? error.message : "network";
  const key = `account.error.${code}`;
  return t(key) === key ? t("account.error.network") : t(key);
}

function renderAccount(account) {
  currentAccount = account ?? null;
  accountStatus.classList.remove("account-status-error");
  accountActionButton.classList.toggle("is-guest", !currentAccount);
  accountActionButton.classList.toggle("is-authenticated", Boolean(currentAccount));
  accountAuthForms.hidden = Boolean(currentAccount);
  accountProfile.hidden = !currentAccount;
  if (currentAccount) {
    accountHeaderName.textContent = currentAccount.username;
    accountHeaderDetail.textContent = t("account.headerRating", { rating: currentAccount.rating });
    document.querySelector("#account-profile-name").textContent = currentAccount.username;
    document.querySelector("#account-profile-rating").textContent = currentAccount.rating;
    document.querySelector("#account-profile-wins").textContent = currentAccount.wins;
    document.querySelector("#account-profile-losses").textContent = currentAccount.losses;
    accountStatus.textContent = t("account.signedIn", { username: currentAccount.username });
  } else {
    accountHeaderName.textContent = t("account.guestHeader");
    accountHeaderDetail.textContent = t("account.guestDetail");
    accountStatus.textContent = t("account.signedOut");
  }
}

async function refreshAccount() {
  try {
    renderAccount((await accountsClient.me()).account);
  } catch (error) {
    renderAccount(null);
    accountStatus.textContent = accountErrorMessage(error);
    accountStatus.classList.add("account-status-error");
  }
}

async function refreshLeaderboard() {
  leaderboardStatus.textContent = "";
  leaderboardList.replaceChildren();
  try {
    const { entries } = await accountsClient.leaderboard();
    if (!entries.length) {
      leaderboardStatus.textContent = t("account.emptyLeaderboard");
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      const score = document.createElement("span");
      name.textContent = `${entry.rank}. ${entry.username} · ${t("account.wins")}: ${entry.wins} · ${t("account.losses")}: ${entry.losses}`;
      score.textContent = String(entry.rating);
      row.append(name, score);
      leaderboardList.append(row);
    }
  } catch (error) {
    leaderboardStatus.textContent = accountErrorMessage(error);
    leaderboardStatus.classList.add("account-status-error");
  }
}

function selectAccountTab(name) {
  for (const tab of accountAuthTabs.querySelectorAll("[data-account-tab]")) {
    const active = tab.dataset.accountTab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  accountLoginForm.hidden = name !== "login";
  accountRegisterForm.hidden = name !== "register";
  for (const form of [accountLoginForm, accountRegisterForm]) {
    const error = form.querySelector(".account-form-error");
    error.hidden = true;
    error.textContent = "";
  }
}

async function submitAccountForm(event, method) {
  logAccountDiagnostic("form-handler-enter", { method, formId: event.currentTarget?.id });
  if (accountSubmitting) {
    event.preventDefault();
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const submit = form.querySelector('button[type="submit"]');
  const errorElement = form.querySelector(".account-form-error");
  errorElement.hidden = true;
  errorElement.textContent = "";
  accountStatus.classList.remove("account-status-error");
  await submitAccountCredentials({
    event,
    client: accountsClient,
    method,
    username: data.get("username"),
    password: data.get("password"),
    onLoading(loading) {
      logAccountDiagnostic("ui-loading", { method, loading });
      accountSubmitting = loading;
      accountAuthTabs.querySelectorAll("button").forEach((tab) => { tab.disabled = loading; });
      submit.disabled = loading;
      submit.setAttribute("aria-busy", String(loading));
      submit.textContent = t(loading ? `account.loading.${method}` : `account.${method}`);
    },
    onSuccess(result) {
      logAccountDiagnostic("ui-profile-updated", { method, authenticated: Boolean(result?.account) });
      renderAccount(result.account);
      form.reset();
      if (method === "register") accountStatus.textContent = `${t("account.registered")} ${accountStatus.textContent}`;
      void refreshLeaderboard();
    },
    onError(error) {
      logAccountDiagnostic("ui-error-rendered", { method, errorCode: error instanceof Error ? error.message : "unknown" });
      errorElement.textContent = accountErrorMessage(error);
      errorElement.hidden = false;
    }
  });
}

accountActionButton.addEventListener("click", () => {
  accountModal.showModal();
  void refreshAccount();
  void refreshLeaderboard();
});
accountModalClose.addEventListener("click", () => accountModal.close());
accountModal.addEventListener("click", (event) => {
  if (event.target === accountModal) accountModal.close();
});
accountLoginForm.addEventListener("submit", (event) => {
  logAccountDiagnostic("dom-submit", { formId: event.currentTarget?.id });
  void submitAccountForm(event, "login");
});
accountRegisterForm.addEventListener("submit", (event) => {
  logAccountDiagnostic("dom-submit", { formId: event.currentTarget?.id });
  void submitAccountForm(event, "register");
});
accountAuthTabs.addEventListener("click", (event) => {
  if (accountSubmitting) return;
  const tab = event.target.closest("[data-account-tab]");
  if (tab) selectAccountTab(tab.dataset.accountTab);
});
accountAuthTabs.addEventListener("keydown", (event) => {
  if (accountSubmitting) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const next = event.target.dataset.accountTab === "login" ? "register" : "login";
  selectAccountTab(next);
  accountAuthTabs.querySelector(`[data-account-tab="${next}"]`).focus();
});
document.querySelector("#account-logout").addEventListener("click", async () => {
  try {
    await accountsClient.logout();
    renderAccount(null);
    accountStatus.textContent = t("account.loggedOut");
  } catch (error) {
    accountStatus.textContent = accountErrorMessage(error);
  }
});
document.querySelector("#account-leaderboard-refresh").addEventListener("click", () => void refreshLeaderboard());
document.addEventListener("languagechange", () => renderAccount(currentAccount));
void refreshAccount();
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => showMenuNotice("menu.missing", { feature: t("menu." + button.dataset.mode) }));
});
rulesButton.addEventListener("click", () => rulesModal.showModal());
rulesCloseButton.addEventListener("click", () => rulesModal.close());
settingsCloseButton.addEventListener("click", () => settingsModal.close());
settingsCancelButton.addEventListener("click", () => settingsModal.close());
settingsForm.addEventListener("submit", applySettings);
restartConfirmButton.addEventListener("click", confirmSettingsRestart);
restartCancelButton.addEventListener("click", cancelSettingsRestart);
restartConfirmModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelSettingsRestart();
});
restartProposalAcceptButton.addEventListener("click", () => answerRestartProposal(true));
restartProposalDeclineButton.addEventListener("click", () => answerRestartProposal(false));
restartProposalModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  answerRestartProposal(false);
});
undoTurnButton.addEventListener("click", requestUndoTurn);
undoProposalAcceptButton.addEventListener("click", () => answerUndoProposal(true));
undoProposalDeclineButton.addEventListener("click", () => answerUndoProposal(false));
undoProposalModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  answerUndoProposal(false);
});
resultModal.addEventListener("cancel", (event) => event.preventDefault());
resultExportPngButton.addEventListener("click", () => exportFinalMap("png"));
resultExportJsonButton.addEventListener("click", () => exportFinalMap("json"));
resultRematchButton.addEventListener("click", async () => {
  if (!state || state.phase !== "finished") return;
  if (!onlineMode) {
    setupGame();
    return;
  }
  resultRematchButton.disabled = true;
  multiplayerClient.proposeRestart("rematch").catch((error) => {
    resultRematchButton.disabled = false;
    resultRematchStatus.textContent = onlineErrorMessage(error.code);
    resultRematchStatus.hidden = false;
  });
});
resultNewGameButton.addEventListener("click", () => {
  if (onlineMode) leaveOnlineSession({ showMenu: true });
  else setupGame();
});
resignButton.addEventListener("click", () => {
  if (state.phase !== "playing" || !canHumanAct()) return;
  resignConfirmModal.showModal();
  resignCancelButton.focus();
});
resignCancelButton.addEventListener("click", () => resignConfirmModal.close());
resignConfirmButton.addEventListener("click", () => {
  if (state.phase !== "playing" || !canHumanAct()) {
    resignConfirmModal.close();
    return;
  }
  resignConfirmModal.close();
  if (onlineMode) sendOnlineCommand({ type: "resign" });
  else updateState(resign(state), { command: { type: "resign" }, side: state.currentPlayer });
});
for (const player of ["X", "O"]) {
  inventoryElements[player].addEventListener("click", (event) => {
    const slot = event.target.closest(".inventory-slot");
    if (!slot || slot.disabled || !canHumanAct() || state.currentPlayer !== player) return;
    const item = state.inventory[player].find((candidate) => String(candidate.id) === slot.dataset.itemId);
    if (item) {
      if (onlineMode) sendOnlineCommand({ type: "select-ability", itemId: item.id });
      else updateState(selectAbility(state, item.id), {
        command: { type: "select-ability", itemId: item.id }, side: player
      });
    }
  });
}
for (const button of clockAddTimeButtons) {
  button.addEventListener("click", async () => {
    if (!onlineMode || button.hidden || timeBoostPending) return;
    timeBoostPending = true;
    renderClock();
    try {
      await multiplayerClient.addTimeToOpponent();
    } catch (error) {
      onlineGameStatus.textContent = t("clock.addFailed", { reason: error.code || "unknown" });
      onlineGameStatus.hidden = false;
    } finally {
      timeBoostPending = false;
      renderClock();
    }
  });
}
function createDemoLessonState(lessonIndex) {
  const lesson = TRAINING_LESSONS[lessonIndex];
  const piecesPerTurn = lesson.objective === "shield" ? 2 : 1;
  const lessonSettings = {
    ...DEFAULT_SETTINGS,
    width: TRAINING_BOARD_SIZE,
    height: TRAINING_BOARD_SIZE,
    piecesPerTurn,
    unlimitedTime: true,
    randomEvents: false,
    freeStartingPositions: false,
    adminMode: false
  };
  let lessonState = {
    ...createGameState(lessonSettings),
    board: createTrainingBoard(lessonIndex),
    phase: "playing",
    currentPlayer: "X",
    piecesLeft: piecesPerTurn,
    inventory: { X: lesson.item ? [{ id: "demo-item", type: lesson.item }] : [], O: [] },
    nextEventItemId: 1,
    eventItems: [],
    selectedAbility: null,
    abilityTargets: [],
    protections: [],
    lastDestroyed: [],
    pendingExtraTurn: null,
    message: []
  };

  if (lesson.objective === "reaction") {
    const [target] = lesson.targets;
    lessonState = playMove(lessonState, target.row, target.col);
  } else if (lesson.objective === "shield") {
    lessonState = selectAbility(lessonState, "demo-item");
    for (const target of lesson.targets) {
      lessonState = chooseAbilityTarget(lessonState, "demo-item", target.row, target.col);
    }
  } else if (lesson.objective === "bomb") {
    lessonState = selectAbility(lessonState, "demo-item");
  }

  return lessonState;
}

function renderDemoTrainingFrames() {
  demoFrames.forEach((frame, lessonIndex) => {
    const lessonState = createDemoLessonState(lessonIndex);
    const legalMoves = new Set(getLegalMoves(lessonState).map(({ row, col }) => row + "," + col));
    const targets = new Set(TRAINING_LESSONS[lessonIndex].targets.map(({ row, col }) => row + "," + col));
    const cells = document.createDocumentFragment();

    for (let row = 0; row < TRAINING_BOARD_SIZE; row += 1) {
      for (let col = 0; col < TRAINING_BOARD_SIZE; col += 1) {
        const value = lessonState.board[row][col];
        const cell = document.createElement("span");
        cell.className = "cell";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.setAttribute("aria-hidden", "true");
        if (value === "X" || value === "O") {
          cell.classList.add("piece", value === "X" ? "piece-x" : "piece-o");
          const glyph = document.createElement("span");
          glyph.className = "piece-glyph";
          glyph.textContent = value;
          cell.appendChild(glyph);
        } else if (value === BLOCKED_CELL) {
          cell.textContent = "×";
          cell.classList.add("blocked");
        } else if (legalMoves.has(row + "," + col) && targets.has(row + "," + col)) {
          cell.classList.add("legal", "training-target");
          cell.dataset.player = lessonState.currentPlayer;
        }

        const protection = lessonState.protections.find((shield) => shield.row === row && shield.col === col);
        if (protection) {
          cell.classList.add("protected-piece");
          if (protection.permanent) cell.classList.add("protected-permanent");
          const icon = document.createElement("img");
          icon.className = "shield-marker";
          icon.src = protection.permanent ? EVENT_ITEM_DEFINITIONS.gangstaShield.icon : EVENT_ITEM_DEFINITIONS.shield.icon;
          icon.alt = "";
          icon.setAttribute("aria-hidden", "true");
          cell.appendChild(icon);
        }
        cells.appendChild(cell);
      }
    }

    frame.replaceChildren(cells);
    if (TRAINING_LESSONS[lessonIndex].objective === "bomb") {
      const [target] = TRAINING_LESSONS[lessonIndex].targets;
      if (isValidAreaTarget(lessonState, target.row, target.col)) {
        const aim = document.createElement("div");
        aim.className = "bomb-aim-overlay demo-bomb-aim";
        aim.setAttribute("aria-hidden", "true");
        frame.appendChild(aim);
      }
    }
  });
}

function updateDemoSceneLabels() {
  demoSceneButtons.forEach((button) => {
    button.setAttribute("aria-label", t("demo.sceneLabel", { scene: t(button.dataset.demoSceneLabel) }));
  });
}

function selectDemoScene(index) {
  if (!demoCard || demoSceneButtons.length === 0) return;
  const sceneIndex = (index + demoSceneButtons.length) % demoSceneButtons.length;
  demoCard.dataset.demoManual = "true";
  demoCard.dataset.demoCurrent = String(sceneIndex);
  demoSceneButtons.forEach((button, buttonIndex) => {
    if (buttonIndex === sceneIndex) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
  updateDemoBombAim(sceneIndex);
}

function updateDemoBombAim(sceneIndex = Number(demoCard?.dataset.demoCurrent ?? 0)) {
  if (sceneIndex !== 3) return;
  const frame = demoFrames[sceneIndex];
  const [target] = TRAINING_LESSONS[sceneIndex].targets;
  const firstCell = frame?.querySelector(`.cell[data-row="${target.row}"][data-col="${target.col}"]`);
  const bottomRightCell = frame?.querySelector(`.cell[data-row="${target.row + 1}"][data-col="${target.col + 1}"]`);
  const aim = frame?.querySelector(".demo-bomb-aim");
  if (!firstCell || !bottomRightCell || !aim) return;
  aim.style.left = `${firstCell.offsetLeft}px`;
  aim.style.top = `${firstCell.offsetTop}px`;
  aim.style.width = `${bottomRightCell.offsetLeft + bottomRightCell.offsetWidth - firstCell.offsetLeft}px`;
  aim.style.height = `${bottomRightCell.offsetTop + bottomRightCell.offsetHeight - firstCell.offsetTop}px`;
}

renderDemoTrainingFrames();
updateDemoSceneLabels();
window.addEventListener("resize", () => updateDemoBombAim());
demoSceneButtons.forEach((button) => {
  button.addEventListener("click", () => selectDemoScene(Number(button.dataset.demoIndex)));
});
demoCard?.querySelector("[data-demo-previous]")?.addEventListener("click", () => {
  selectDemoScene(Number(demoCard.dataset.demoCurrent ?? 0) - 1);
});
demoCard?.querySelector("[data-demo-next]")?.addEventListener("click", () => {
  selectDemoScene(Number(demoCard.dataset.demoCurrent ?? 0) + 1);
});

let demoSwipeStartX = null;
demoBoard?.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") demoSwipeStartX = event.clientX;
});
demoBoard?.addEventListener("pointerup", (event) => {
  if (demoSwipeStartX === null) return;
  const deltaX = event.clientX - demoSwipeStartX;
  demoSwipeStartX = null;
  if (Math.abs(deltaX) < 36) return;
  selectDemoScene(Number(demoCard?.dataset.demoCurrent ?? 0) + (deltaX < 0 ? 1 : -1));
});
demoBoard?.addEventListener("pointercancel", () => { demoSwipeStartX = null; });

languageSelect.value = getLanguage();
applyTranslations();
supportOpenButton.addEventListener("click", () => supportModal.showModal());
supportModalCloseButton.addEventListener("click", () => supportModal.close());
supportModal.addEventListener("click", (event) => {
  if (event.target === supportModal) supportModal.close();
});
supportBank.hidden = !supportCardNumber;
supportCardNumberElement.hidden = !supportCardNumber;
supportCardNumberElement.textContent = supportCardNumber.replace(/\B(?=(\d{4})+(?!\d))/g, " ");
supportPending.hidden = Boolean(supportCardNumber);
supportCopyButton.hidden = !supportCardNumber;
supportCopyButton.addEventListener("click", async () => {
  supportCopyButton.disabled = true;
  supportCopyStatus.hidden = true;
  try {
    await copySupportCardNumber(supportCardNumber);
    supportCopyStatus.textContent = t("support.copied");
  } catch {
    supportCopyStatus.textContent = t("support.copyError");
  } finally {
    supportCopyStatus.hidden = false;
    supportCopyButton.disabled = false;
  }
});
decorateRuleItemCards();
languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));
document.addEventListener("languagechange", () => {
  applyTranslations();
  updateDemoSceneLabels();
  updateSpawnModeHelp(itemSpawnModeSelect, itemSpawnModeHelp);
  updateSpawnModeHelp(onlineItemSpawnMode, onlineItemSpawnModeHelp);
  decorateRuleItemCards();
  for (const container of [itemOptions, onlineItemOptions]) {
    for (const input of container.querySelectorAll("input[data-item-type]")) {
      const name = input.parentElement.querySelector(".item-option-name");
      if (name) name.textContent = t(EVENT_ITEM_DEFINITIONS[input.dataset.itemType].nameKey);
      const badge = input.parentElement.querySelector(".item-option-category");
      if (badge) badge.textContent = t(getItemCategoryLocalizationKey(input.dataset.itemType));
      input.parentElement.title = t(getItemCategoryLocalizationKey(input.dataset.itemType));
    }
  }
  languageSelect.value = getLanguage();
  if (menuNoticeTranslation) {
    menuNotice.textContent = t(menuNoticeTranslation.key, menuNoticeTranslation.params);
  }
  syncMenuAmbient();
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
reduceMotionQuery.addEventListener?.("change", syncMenuAmbient);
adminItemList.addEventListener("click", (event) => {
  const button = event.target.closest(".admin-item-button");
  const authorizedAdmin = onlineMode && onlineConnected && onlineAdminAuthenticated;
  if (historyViewId !== null || !button || boardEditorActive
    || (onlineMode ? (!authorizedAdmin || (!onlineObserverMode && !canHumanAct()))
      : (!canHumanAct() || !hasPermission(state, state.currentPlayer, PLAYER_PERMISSIONS.USE_ANY_ITEM)))) return;
  if (onlineMode) {
    sendOnlineCommand({ type: "select-ability", itemId: button.dataset.itemId });
    return;
  }
  updateState(selectAbility(state, button.dataset.itemId), {
    command: { type: "select-ability", itemId: button.dataset.itemId }, side: state.currentPlayer
  });
});
boardEditorToggle.addEventListener("click", () => {
  if (historyViewId !== null) return;
  if (onlineMode) {
    if (!onlineConnected || onlineCommandPending) return;
    if (!onlineAdminAuthenticated) {
      adminAuthError.hidden = true;
      adminSecretInput.value = "";
      adminAuthModal.showModal();
      adminSecretInput.focus();
      return;
    }
    boardEditorActive = !boardEditorActive;
    boardEditorTool = null;
    boardEditorMessageKey = null;
    render();
    return;
  }
  if (isComputerControlledTurn()
    || !hasPermission(state, state.currentPlayer, PLAYER_PERMISSIONS.USE_ANY_ITEM)) return;
  boardEditorActive = !boardEditorActive;
  boardEditorTool = null;
  boardEditorMessageKey = null;
  if (boardEditorActive && state.selectedAbility !== null) {
    updateState(cancelAbilitySelection(state));
    return;
  }
  render();
});
boardEditorTools.addEventListener("click", (event) => {
  const button = event.target.closest(".editor-tool-button");
  if (historyViewId !== null || !button || !boardEditorActive
    || (onlineMode ? (!onlineConnected || onlineCommandPending || !onlineAdminAuthenticated)
      : !hasPermission(state, state.currentPlayer, PLAYER_PERMISSIONS.USE_ANY_ITEM))) return;
  boardEditorTool = button.dataset.editorKind === "item"
    ? { kind: "item", itemType: button.dataset.itemType }
    : { kind: button.dataset.editorKind };
  boardEditorMessageKey = null;
  boardEditorFirstWormholeCell = null;
  render();
});
boardEditorCancel.addEventListener("click", () => {
  boardEditorTool = null;
  boardEditorFirstWormholeCell = null;
  boardEditorMessageKey = null;
  render();
});
boardEditorExit.addEventListener("click", () => {
  boardEditorActive = false;
  boardEditorTool = null;
  boardEditorFirstWormholeCell = null;
  boardEditorMessageKey = null;
  render();
});
adminAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!onlineMode || !onlineConnected || !adminSecretInput.value) return;
  adminAuthSubmit.disabled = true;
  adminAuthError.hidden = true;
  try {
    await multiplayerClient.authenticateAdmin(adminSecretInput.value);
    if (onlineMode && onlineConnected) {
      onlineAdminAuthenticated = true;
      boardEditorActive = true;
      boardEditorTool = null;
      adminAuthModal.close();
      render();
    }
  } catch {
    adminAuthError.textContent = t("admin.authFailed");
    adminAuthError.hidden = false;
  } finally {
    adminSecretInput.value = "";
    adminAuthSubmit.disabled = false;
  }
});
adminAuthCancel.addEventListener("click", () => {
  adminSecretInput.value = "";
  adminAuthModal.close();
});
adminAuthModal.addEventListener("close", () => {
  adminSecretInput.value = "";
});
startButton.addEventListener("click", setupGame);
resizeMenuAmbient();
resizeDuelCanvas();
syncMenuAmbient();
window.addEventListener("resize", resizeMenuAmbient);
window.addEventListener("resize", resizeDuelCanvas);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncMenuAmbient();
  else if (menuAnimationFrame !== null) {
    cancelAnimationFrame(menuAnimationFrame);
    menuAnimationFrame = null;
  }
});
if (typeof ResizeObserver === "function") {
  new ResizeObserver(syncBoardGeometry).observe(boardRow);
  new ResizeObserver(resizeMenuAmbient).observe(mainMenuScreen);
  new ResizeObserver(resizeDuelCanvas).observe(menuDuelCanvas);
} else {
  window.addEventListener("resize", syncBoardGeometry);
}
if (window.location.pathname === "/games") showActiveGamesPage(true);
const inviteUrl = new URL(window.location.href);
const inviteCode = inviteUrl.searchParams.get("room");
if (inviteCode) {
  inviteUrl.searchParams.delete("room");
  window.history.replaceState(null, "", inviteUrl.pathname + inviteUrl.search + inviteUrl.hash);
  openOnlineRoom(inviteCode);
  onlineJoinForm.requestSubmit();
}
