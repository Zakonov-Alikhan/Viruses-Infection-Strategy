import {
  chooseAbilityTarget,
  chooseStart,
  flagFall,
  getSelectedAbility,
  playMove,
  placeEditorObject,
  resign,
  selectAbility,
  useAntiBomb,
  useBomb,
  usePointDestroy
} from "../ui/game.js";

const SIDES = new Set(["X", "O"]);
const COMMAND_FIELDS = Object.freeze({
  "choose-start": ["type", "row", "col"],
  place: ["type", "row", "col"],
  "select-ability": ["type", "itemId"],
  "ability-target": ["type", "itemId", "row", "col"],
  "board-edit": ["type", "object"],
  resign: ["type"],
  timeout: ["type"]
});
const PUBLIC_SETTING_FIELDS = Object.freeze([
  "width",
  "height",
  "piecesPerTurn",
  "clockMinutes",
  "incrementSeconds",
  "unlimitedTime",
  "randomEvents",
  "itemSpawnMode",
  "wormholesEnabled",
  "animationsEnabled",
  "freeStartingPositions",
  "disabledItems"
]);

function failure(state, code) {
  return { ok: false, state, error: { code } };
}

function hasExactCommandShape(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) return false;
  const allowed = COMMAND_FIELDS[command.type];
  if (!allowed) return false;
  return Object.keys(command).every((field) => allowed.includes(field));
}

function isCoordinate(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0;
}

function isValidEditorObject(object) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  if (object.kind === "clear") {
    return Object.keys(object).every((key) => ["kind", "row", "col"].includes(key))
      && Object.keys(object).length === 3
      && isCoordinate(object.row, object.col);
  }
  if (object.kind === "item") {
    return Object.keys(object).every((key) => ["kind", "itemType", "row", "col"].includes(key))
      && Object.keys(object).length === 4
      && typeof object.itemType === "string"
      && isCoordinate(object.row, object.col);
  }
  return object.kind === "blocked"
    && Object.keys(object).every((key) => ["kind", "row", "col"].includes(key))
    && Object.keys(object).length === 3
    && isCoordinate(object.row, object.col);
}

function isSetupPhase(phase) {
  return phase === "setup-x" || phase === "setup-o";
}

function applyAbilityTarget(state, command) {
  const ability = getSelectedAbility(state);
  if (!ability || ability.id !== command.itemId) return state;

  if (ability.type === "bomb") return useBomb(state, ability.id, command.row, command.col);
  if (ability.type === "antiBomb") return useAntiBomb(state, ability.id, command.row, command.col);
  if (ability.type === "pointDestroy") return usePointDestroy(state, ability.id, command.row, command.col);
  return chooseAbilityTarget(state, ability.id, command.row, command.col);
}

/**
 * Apply one client intent to the authoritative state. `side` must be assigned
 * by the server transport; it must never be copied from an untrusted payload.
 */
export function processGameCommand(state, side, command, {
  random = Math.random,
  authority = "player"
} = {}) {
  if (!state || typeof state !== "object") return failure(state, "invalid-state");
  if (!SIDES.has(side)) return failure(state, "invalid-player");
  if (!hasExactCommandShape(command)) return failure(state, "invalid-command");

  if (command.type === "resign") {
    if (state.phase !== "playing") return failure(state, "wrong-phase");
    return { ok: true, state: resign(state, side) };
  }

  if (command.type === "timeout") {
    if (authority !== "server") return failure(state, "server-command-only");
    if (state.phase !== "playing") return failure(state, "wrong-phase");
    if (side !== state.currentPlayer) return failure(state, "not-your-turn");
    return { ok: true, state: flagFall(state) };
  }

  if (command.type === "board-edit") {
    if (authority !== "admin") return failure(state, "admin-required");
    if (state.phase !== "playing") return failure(state, "wrong-phase");
    if (!isValidEditorObject(command.object)) return failure(state, "invalid-editor-object");
    const next = placeEditorObject(state, side, command.object, { admin: true });
    return next === state ? failure(state, "invalid-action") : { ok: true, state: next };
  }

  if (command.type === "choose-start") {
    if (!isSetupPhase(state.phase)) return failure(state, "wrong-phase");
    if (state.setupPlayer !== side) return failure(state, "not-your-turn");
    if (!isCoordinate(command.row, command.col)) return failure(state, "invalid-coordinate");
    const next = chooseStart(state, command.row, command.col, random);
    return next === state ? failure(state, "invalid-action") : { ok: true, state: next };
  }

  if (state.phase !== "playing") return failure(state, "wrong-phase");
  if (state.currentPlayer !== side) return failure(state, "not-your-turn");

  if (command.type === "place" || command.type === "ability-target") {
    if (!isCoordinate(command.row, command.col)) return failure(state, "invalid-coordinate");
  }
  if ((command.type === "select-ability" || command.type === "ability-target")
    && !((typeof command.itemId === "string" && command.itemId.length > 0)
      || (Number.isSafeInteger(command.itemId) && command.itemId > 0))) {
    return failure(state, "invalid-item");
  }
  if (command.type === "ability-target" && state.selectedAbility !== command.itemId) {
    return failure(state, "ability-not-selected");
  }

  let next;
  switch (command.type) {
    case "place":
      next = playMove(state, command.row, command.col, random);
      break;
    case "select-ability":
      next = selectAbility(state, command.itemId);
      break;
    case "ability-target":
      next = applyAbilityTarget(state, command);
      break;
    default:
      return failure(state, "invalid-command");
  }

  return next === state ? failure(state, "invalid-action") : { ok: true, state: next };
}

function copyPublicInventory(inventory = {}, disabledItems = new Set()) {
  const result = {};
  for (const side of SIDES) {
    result[side] = (inventory[side] || [])
      .filter(({ type }) => !disabledItems.has(type))
      .map(({ id, type }) => ({ id, type }));
  }
  return result;
}

/** Return a detached, allow-listed view suitable for one player's client. */
export function getPlayerView(state, side) {
  if (!state || typeof state !== "object") throw new TypeError("A game state is required");
  if (!SIDES.has(side)) throw new RangeError("Player side must be X or O");

  const settings = {};
  for (const key of PUBLIC_SETTING_FIELDS) {
    if (Object.hasOwn(state.settings || {}, key)) {
      settings[key] = key === "disabledItems" ? [...(state.settings[key] || [])] : state.settings[key];
    }
  }

  const setupPhase = isSetupPhase(state.phase);
  const maySeePrivateAction = state.currentPlayer === side;
  return {
    board: state.board.map((row) => row.slice()),
    settings,
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    piecesLeft: state.piecesLeft,
    roundNumber: state.roundNumber ?? 1,
    turnNumber: state.turnNumber ?? 0,
    setupPlayer: setupPhase ? state.setupPlayer : null,
    startChoices: {
      X: setupPhase && side === "X" && state.startChoices?.X
        ? { row: state.startChoices.X.row, col: state.startChoices.X.col }
        : null,
      O: setupPhase && side === "O" && state.startChoices?.O
        ? { row: state.startChoices.O.row, col: state.startChoices.O.col }
        : null
    },
    lastDestroyed: (state.lastDestroyed || []).map(({ row, col }) => ({ row, col })),
    eventItems: (state.eventItems || []).map(({ id, type, row, col }) => ({ id, type, row, col })),
    wormholePair: state.wormholePair ? {
      id: state.wormholePair.id,
      endpoints: {
        orange: { ...state.wormholePair.endpoints.orange },
        blue: { ...state.wormholePair.endpoints.blue }
      },
      roundsRemaining: state.wormholePair.roundsRemaining
    } : null,
    inventory: copyPublicInventory(state.inventory, new Set(settings.disabledItems || [])),
    selectedAbility: maySeePrivateAction ? state.selectedAbility ?? null : null,
    abilityTargets: maySeePrivateAction
      ? (state.abilityTargets || []).map(({ row, col }) => ({ row, col }))
      : [],
    protections: (state.protections || []).map(({ row, col, owner, permanent }) => ({
      row, col, owner, permanent
    })),
    message: Array.isArray(state.message)
      ? structuredClone(state.message)
      : state.message ? structuredClone(state.message) : [],
    winner: state.winner ?? null,
    finishReason: state.finishReason
      ? structuredClone(state.finishReason)
      : null
  };
}
