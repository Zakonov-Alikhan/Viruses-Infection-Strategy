import {
  canCompleteTurn,
  getLegalMoves,
  getSelectedAbility,
  playMove,
  selectAbility
} from "./game.js?v=20261018-menu13";

export const AI_DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);
export const AI_SEARCH_LIMITS = Object.freeze({
  medium: Object.freeze({ maxEvaluations: 32 }),
  hard: Object.freeze({
    maxRootCandidates: 12,
    maxCandidatesPerNode: 5,
    maxNodes: 96,
    maxDepth: 3
  })
});

const NO_FUTURE_EVENT = () => 1;
const ITEM_VALUES = Object.freeze({
  bomb: 6,
  freePlacement: 7,
  extraTurn: 8,
  antiBomb: 4,
  pointDestroy: 5,
  debris: 3,
  shield: 4,
  gangstaShield: 6
});
const CONTACT_OFFSETS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]
]);

function noAction(reason) {
  return { type: "no-legal-move", reason };
}

function listPlacementActions(state) {
  if (!state || state.phase !== "playing") return [];

  const selected = getSelectedAbility(state);
  if (selected && selected.type !== "freePlacement") return [];

  if (selected?.type === "freePlacement") {
    return getLegalMoves(state).map(({ row, col }) => ({
      type: "place",
      row,
      col,
      abilityId: selected.id
    }));
  }

  const actions = getLegalMoves(state).map(({ row, col }) => ({
    type: "place",
    row,
    col,
    abilityId: null
  }));

  for (const item of state.inventory?.[state.currentPlayer] || []) {
    if (item.type !== "freePlacement") continue;
    const abilityState = selectAbility(state, item.id);
    if (abilityState.selectedAbility !== item.id) continue;
    for (const { row, col } of getLegalMoves(abilityState)) {
      actions.push({ type: "place", row, col, abilityId: item.id });
    }
  }
  return actions;
}

function simulateAction(state, action) {
  return applyComputerAction(state, action, NO_FUTURE_EVENT);
}

export function applyComputerAction(state, action, random = Math.random) {
  if (!state || !action || action.type !== "place"
    || !Number.isInteger(action.row) || !Number.isInteger(action.col)) return state;
  let moveState = state;
  if (action.abilityId != null && moveState.selectedAbility !== action.abilityId) {
    moveState = selectAbility(moveState, action.abilityId);
    if (moveState.selectedAbility !== action.abilityId) return state;
  }
  return playMove(moveState, action.row, action.col, random);
}

function itemValue(item) {
  return ITEM_VALUES[item.type] || 0;
}

function inventoryScore(state, player) {
  return (state.inventory?.[player] || []).reduce((sum, item) => sum + itemValue(item), 0);
}

function protectionScore(state, player) {
  return (state.protections || []).reduce((sum, protection) => {
    const piece = state.board[protection.row]?.[protection.col];
    const beneficiary = piece === "X" || piece === "O" ? piece : protection.owner;
    const value = protection.permanent ? 5 : piece === "" ? 0.75 : 2;
    return sum + (beneficiary === player ? value : -value);
  }, 0);
}

function evaluateState(state, perspective, lastActor) {
  if (state.phase === "finished") {
    return state.winner === perspective ? 1_000_000 : -1_000_000;
  }

  const currentMobility = getLegalMoves(state).length;
  const activeSign = state.currentPlayer === perspective ? 1 : -1;
  const mobilityScore = activeSign * Math.sqrt(Math.min(currentMobility, 64)) * 3;
  const captureScore = (state.lastDestroyed?.length || 0) * (lastActor === perspective ? 9 : -9);
  const inventoryDifference = inventoryScore(state, perspective)
    - inventoryScore(state, perspective === "X" ? "O" : "X");
  const protectionDifference = protectionScore(state, perspective)
    - protectionScore(state, perspective === "X" ? "O" : "X");
  const completionPenalty = state.phase === "playing"
    && !canCompleteTurn(state, state.currentPlayer, state.piecesLeft)
    ? activeSign * -250
    : 0;

  return mobilityScore
    + captureScore
    + inventoryDifference
    + protectionDifference
    + completionPenalty;
}

function actionPriority(state, action, protectedCells) {
  const item = state.eventItems?.find((candidate) => candidate.row === action.row && candidate.col === action.col);
  const enemy = state.currentPlayer === "X" ? "O" : "X";
  let contactPotential = 0;
  for (const [rowOffset, colOffset] of CONTACT_OFFSETS) {
    const row = action.row + rowOffset;
    const col = action.col + colOffset;
    if (state.board[row]?.[col] !== enemy) continue;
    if (protectedCells.has(row + "," + col)) continue;
    contactPotential += 1;
  }
  return (item ? itemValue(item) * 100 : 0) + contactPotential * 10;
}

function selectCandidates(state, actions, limit) {
  if (actions.length <= limit) return actions;

  const protectedCells = new Set((state.protections || []).map((protection) => protection.row + "," + protection.col));
  const prioritized = actions
    .map((action, index) => ({ action, index, priority: actionPriority(state, action, protectedCells) }))
    .filter(({ priority }) => priority > 0)
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, limit);
  const selectedKeys = new Set(prioritized.map(({ index }) => index));
  const remainingSlots = limit - prioritized.length;
  if (remainingSlots <= 0) return prioritized.map(({ action }) => action);

  const remaining = actions
    .map((action, index) => ({ action, index }))
    .filter(({ index }) => !selectedKeys.has(index));
  for (let slot = 0; slot < remainingSlots && remaining.length > 0; slot += 1) {
    const index = Math.min(remaining.length - 1, Math.floor((slot + 0.5) * remaining.length / remainingSlots));
    const candidate = remaining[index];
    selectedKeys.add(candidate.index);
    prioritized.push({ action: candidate.action, index: candidate.index, priority: 0 });
    remaining.splice(index, 1);
  }
  return prioritized.map(({ action }) => action);
}

function randomIndex(random, length) {
  const value = Number(random());
  const unit = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
  return Math.floor(unit * length);
}

function validateDifficulty(difficulty) {
  if (!AI_DIFFICULTIES.includes(difficulty)) {
    throw new RangeError("Unknown AI difficulty: " + difficulty);
  }
}

function analyzeEasy(actions, random) {
  return { action: actions[randomIndex(random, actions.length)], nodesSearched: 0 };
}

function analyzeMedium(state, actions) {
  const candidates = selectCandidates(state, actions, AI_SEARCH_LIMITS.medium.maxEvaluations);
  let bestAction = null;
  let bestScore = -Infinity;

  for (const action of candidates) {
    const next = simulateAction(state, action);
    const score = evaluateState(next, state.currentPlayer, state.currentPlayer);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  return { action: bestAction || actions[0], nodesSearched: candidates.length };
}

function analyzeHard(state, actions) {
  const limits = AI_SEARCH_LIMITS.hard;
  const rootPlayer = state.currentPlayer;
  const rootCandidates = selectCandidates(state, actions, limits.maxRootCandidates);
  const budget = { nodes: 0 };
  let bestAction = null;
  let bestScore = -Infinity;

  const continuation = (position, depth, lastActor) => {
    if (position.phase === "finished"
      || position.phase !== "playing"
      || position.currentPlayer !== rootPlayer
      || depth >= limits.maxDepth
      || budget.nodes >= limits.maxNodes) {
      return evaluateState(position, rootPlayer, lastActor);
    }

    const available = listPlacementActions(position);
    if (available.length === 0) return evaluateState(position, rootPlayer, lastActor);
    const candidates = selectCandidates(position, available, limits.maxCandidatesPerNode);
    let best = -Infinity;
    for (const action of candidates) {
      if (budget.nodes >= limits.maxNodes) break;
      budget.nodes += 1;
      const next = simulateAction(position, action);
      best = Math.max(best, continuation(next, depth + 1, position.currentPlayer));
    }
    return best === -Infinity ? evaluateState(position, rootPlayer, lastActor) : best;
  };

  for (const action of rootCandidates) {
    if (budget.nodes >= limits.maxNodes) break;
    budget.nodes += 1;
    const next = simulateAction(state, action);
    const score = continuation(next, 1, rootPlayer);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  return {
    action: bestAction || rootCandidates[0] || actions[0],
    nodesSearched: budget.nodes
  };
}

export function analyzeComputerAction(state, difficulty = "easy", options = {}) {
  validateDifficulty(difficulty);
  const actions = listPlacementActions(state);
  if (actions.length === 0) {
    const reason = !state || state.phase !== "playing"
      ? "game-not-playing"
      : getSelectedAbility(state)?.type && getSelectedAbility(state).type !== "freePlacement"
        ? "ability-targeting"
        : "no-legal-placement";
    return { action: noAction(reason), nodesSearched: 0, legalActionCount: 0 };
  }

  const analysis = difficulty === "easy"
    ? analyzeEasy(actions, options.random || Math.random)
    : difficulty === "medium"
      ? analyzeMedium(state, actions)
      : analyzeHard(state, actions);
  return { ...analysis, legalActionCount: actions.length };
}

export function chooseComputerAction(state, difficulty = "easy", options = {}) {
  return analyzeComputerAction(state, difficulty, options).action;
}
