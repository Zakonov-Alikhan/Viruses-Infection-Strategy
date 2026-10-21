import {
  EMPTY_CELL,
  canCompleteTurn,
  getLegalMoves,
  getSelectedAbility,
  isItemEnabled,
  isValidAreaTarget,
  isValidPointDestroyTarget,
  playMove,
  selectAbility,
  useAntiBomb,
  useBomb,
  usePointDestroy
} from "./game.js?v=random-artifact1";

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
const ABILITY_USE_MARGIN = 1;
const IMMEDIATE_WIN_SCORE = 500_000;
const EASY_ATTACK_CANDIDATE_LIMIT = 12;
const EASY_PLACEMENT_CANDIDATE_LIMIT = 12;
const MAX_ATTACK_TARGETS_PER_ITEM = 12;
const ATTACK_TYPES = new Set(["bomb", "antiBomb", "pointDestroy"]);
const ATTACK_CONTEXTS = new WeakMap();
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
    if (!isItemEnabled(state, item.type)) continue;
    if (item.type !== "freePlacement") continue;
    const abilityState = selectAbility(state, item.id);
    if (abilityState.selectedAbility !== item.id) continue;
    for (const { row, col } of getLegalMoves(abilityState)) {
      actions.push({ type: "place", row, col, abilityId: item.id });
    }
  }
  return actions;
}

function listAttackActions(state, items) {
  const actions = [];
  const enemy = state.currentPlayer === "X" ? "O" : "X";

  for (const item of items) {
    if (!ATTACK_TYPES.has(item.type)) continue;
    const abilityState = state.selectedAbility === item.id ? state : selectAbility(state, item.id);
    if (getSelectedAbility(abilityState)?.id !== item.id) continue;
    const itemActions = [];

    if (item.type === "pointDestroy") {
      for (let row = 0; row < state.board.length; row += 1) {
        for (let col = 0; col < state.board[row].length; col += 1) {
          if (isValidPointDestroyTarget(abilityState, row, col) && state.board[row][col] === enemy) {
            itemActions.push({ type: "attack", abilityId: item.id, row, col });
          }
        }
      }
    } else {
      for (let row = 0; row < state.board.length - 1; row += 1) {
        for (let col = 0; col < state.board[row].length - 1; col += 1) {
          if (!isValidAreaTarget(abilityState, row, col)) continue;
          const hitsEnemy = state.board[row][col] === enemy
            || state.board[row][col + 1] === enemy
            || state.board[row + 1][col] === enemy
            || state.board[row + 1][col + 1] === enemy;
          if (hitsEnemy) itemActions.push({ type: "attack", abilityId: item.id, row, col });
        }
      }
    }

    actions.push(...selectAttackTargets(state, itemActions));
  }
  return actions;
}

function selectAttackTargets(state, actions) {
  if (actions.length <= MAX_ATTACK_TARGETS_PER_ITEM) return actions;
  const context = getAttackContext(state);
  const ranked = actions
    .map((action, index) => ({ action, index, priority: attackTargetPriority(state, action, context) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  // Keep most slots for likely tactical gains, while retaining spatial samples
  // so a cheap estimate cannot discard every unusual but promising target.
  const topCount = Math.ceil(MAX_ATTACK_TARGETS_PER_ITEM * 2 / 3);
  const selected = ranked.slice(0, topCount).map(({ action }) => action);
  const selectedIndexes = new Set(ranked.slice(0, topCount).map(({ index }) => index));
  const remaining = actions.filter((_, index) => !selectedIndexes.has(index));
  const remainingSlots = MAX_ATTACK_TARGETS_PER_ITEM - selected.length;
  for (let slot = 0; slot < remainingSlots && remaining.length > 0; slot += 1) {
    const index = Math.min(remaining.length - 1, Math.floor((slot + 0.5) * remaining.length / remainingSlots));
    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return selected;
}

function listComputerActions(state) {
  if (!state || state.phase !== "playing") return [];
  const selected = getSelectedAbility(state);
  if (selected && selected.type !== "freePlacement" && !ATTACK_TYPES.has(selected.type)) return [];

  const placements = listPlacementActions(state);
  const availableItems = selected
    ? ATTACK_TYPES.has(selected.type) ? [selected] : []
    : (state.inventory?.[state.currentPlayer] || []).filter((item) => isItemEnabled(state, item.type));
  return [...placements, ...listAttackActions(state, availableItems)];
}

function simulateAction(state, action) {
  return applyComputerAction(state, action, NO_FUTURE_EVENT);
}

export function applyComputerAction(state, action, random = Math.random) {
  if (!state || !action || !Number.isInteger(action.row) || !Number.isInteger(action.col)) return state;
  if (action.type === "attack") {
    let abilityState = state;
    if (abilityState.selectedAbility !== action.abilityId) {
      abilityState = selectAbility(abilityState, action.abilityId);
    }
    const ability = getSelectedAbility(abilityState);
    if (!ability || ability.id !== action.abilityId || !ATTACK_TYPES.has(ability.type)) return state;
    if (ability.type === "bomb") return useBomb(abilityState, ability.id, action.row, action.col);
    if (ability.type === "antiBomb") return useAntiBomb(abilityState, ability.id, action.row, action.col);
    if (ability.type === "pointDestroy") return usePointDestroy(abilityState, ability.id, action.row, action.col);
    return state;
  }
  if (action.type !== "place") return state;
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
  return (state.inventory?.[player] || [])
    .filter((item) => isItemEnabled(state, item.type))
    .reduce((sum, item) => sum + itemValue(item), 0);
}

function protectionScore(state, player) {
  return (state.protections || []).reduce((sum, protection) => {
    const piece = state.board[protection.row]?.[protection.col];
    const beneficiary = piece === "X" || piece === "O" ? piece : protection.owner;
    const value = protection.permanent ? 5 : piece === "" ? 0.75 : 2;
    return sum + (beneficiary === player ? value : -value);
  }, 0);
}

function pieceCount(state, player) {
  let count = 0;
  for (const row of state.board) {
    for (const cell of row) if (cell === player) count += 1;
  }
  return count;
}

function evaluateState(state, perspective) {
  if (state.phase === "finished") {
    return state.winner === perspective ? 1_000_000 : -1_000_000;
  }

  const opponent = perspective === "X" ? "O" : "X";
  const currentMobility = getLegalMoves(state).length;
  const activeSign = state.currentPlayer === perspective ? 1 : -1;
  const mobilityScore = activeSign * Math.sqrt(Math.min(currentMobility, 64)) * 3;
  const materialScore = (pieceCount(state, perspective) - pieceCount(state, opponent)) * 9;
  const inventoryDifference = inventoryScore(state, perspective)
    - inventoryScore(state, opponent);
  const protectionDifference = protectionScore(state, perspective)
    - protectionScore(state, opponent);
  const boardItemPotential = (state.eventItems || []).reduce((sum, item) => sum + itemValue(item) * 0.5, 0);
  const completionPenalty = state.phase === "playing"
    && !canCompleteTurn(state, state.currentPlayer, state.piecesLeft)
    ? activeSign * -250
    : 0;
  const opponentTurnThreat = state.phase === "playing"
    && state.currentPlayer === perspective
    && !canCompleteTurn(state, opponent, state.settings.piecesPerTurn)
    ? 250
    : 0;

  return mobilityScore
    + materialScore
    + inventoryDifference
    + protectionDifference
    + boardItemPotential
    + completionPenalty
    + opponentTurnThreat;
}

function actionPriority(state, action) {
  if (action.type === "attack") {
    return attackTargetPriority(state, action);
  }

  const item = state.eventItems?.find((candidate) => candidate.row === action.row && candidate.col === action.col);
  const enemy = state.currentPlayer === "X" ? "O" : "X";
  let contactPotential = 0;
  for (const [rowOffset, colOffset] of CONTACT_OFFSETS) {
    const row = action.row + rowOffset;
    const col = action.col + colOffset;
    if (state.board[row]?.[col] !== enemy) continue;
    if (state.protections?.some((protection) => protection.row === row && protection.col === col)) continue;
    contactPotential += 1;
  }
  return (item ? itemValue(item) * 100 : 0) + contactPotential * 10;
}

function getAttackContext(state) {
  const cached = ATTACK_CONTEXTS.get(state);
  if (cached) return cached;
  const enemy = state.currentPlayer === "X" ? "O" : "X";
  const ownMoveKeys = new Set(getLegalMoves({ ...state, selectedAbility: null, abilityTargets: [] })
    .map(({ row, col }) => row + "," + col));
  const enemyMoveKeys = new Set(getLegalMoves({
    ...state,
    currentPlayer: enemy,
    selectedAbility: null,
    abilityTargets: []
  }).map(({ row, col }) => row + "," + col));
  const context = {
    ownMoveKeys,
    enemyMoveKeys,
    enemyPieceCount: pieceCount(state, enemy),
    enemyHasFreePlacement: (state.inventory?.[enemy] || []).some((item) => item.type === "freePlacement"),
    movesPerTurn: state.settings?.piecesPerTurn || 1
  };
  ATTACK_CONTEXTS.set(state, context);
  return context;
}

function attackTargetPriority(state, action, context = getAttackContext(state)) {
  const item = state.inventory?.[state.currentPlayer]?.find((candidate) => candidate.id === action.abilityId)
    || getSelectedAbility(state);
  const enemy = state.currentPlayer === "X" ? "O" : "X";
  const own = state.currentPlayer;
  const areaSize = item?.type === "pointDestroy" ? 1 : 2;
  const affected = new Set(Array.from({ length: areaSize }, (_, rowOffset) =>
    Array.from({ length: areaSize }, (_, colOffset) => (action.row + rowOffset) + "," + (action.col + colOffset))
  ).flat());
  let enemyPieces = 0;
  let ownPieces = 0;
  let enemyShields = 0;
  let ownShields = 0;
  let removedItemValue = 0;
  let enemyRoutePressure = 0;
  let ownRoutePressure = 0;
  let ownLegalMovesHit = 0;
  let enemyLegalMovesHit = 0;

  for (let row = action.row; row < action.row + areaSize; row += 1) {
    for (let col = action.col; col < action.col + areaSize; col += 1) {
      const key = row + "," + col;
      const piece = state.board[row]?.[col];
      if (piece === enemy) enemyPieces += 1;
      if (piece === own) ownPieces += 1;
      if (state.protections?.some((shield) => shield.row === row && shield.col === col)) {
        if (piece === enemy) enemyShields += 1;
        if (piece === own) ownShields += 1;
      }

      const boardItem = state.eventItems?.find((candidate) => candidate.row === row && candidate.col === col);
      if (boardItem) removedItemValue += itemValue(boardItem);
      if (context.ownMoveKeys.has(key)) ownLegalMovesHit += 1;
      if (context.enemyMoveKeys.has(key)) enemyLegalMovesHit += 1;

      // Area attacks do not trigger contact chains. Estimate only the local
      // placement routes their clearing/blocking changes for each player.
      if (item?.type !== "pointDestroy" && piece === EMPTY_CELL) {
        let ownNeighbors = 0;
        let enemyNeighbors = 0;
        for (const [rowOffset, colOffset] of CONTACT_OFFSETS) {
          if (affected.has((row + rowOffset) + "," + (col + colOffset))) continue;
          const neighbor = state.board[row + rowOffset]?.[col + colOffset];
          if (neighbor === own) ownNeighbors += 1;
          if (neighbor === enemy) enemyNeighbors += 1;
        }
        if (item?.type === "antiBomb") {
          ownRoutePressure += ownNeighbors;
          enemyRoutePressure += enemyNeighbors;
        } else {
          ownRoutePressure -= ownNeighbors;
          enemyRoutePressure -= enemyNeighbors;
        }
      }
    }
  }

  const enemyCountAfter = context.enemyPieceCount - enemyPieces;
  const itemCost = ITEM_VALUES[item?.type] || 0;
  let priority = enemyPieces * 100 - ownPieces * 125
    + enemyShields * 14 - ownShields * 22
    - removedItemValue * 8
    + (enemyRoutePressure - ownRoutePressure) * 3
    - itemCost * 8;

  if (item?.type === "antiBomb") {
    const ownMovesAfter = context.ownMoveKeys.size - ownLegalMovesHit;
    const enemyMovesAfter = context.enemyMoveKeys.size - enemyLegalMovesHit;
    if (context.ownMoveKeys.size > 0 && ownMovesAfter === 0) priority -= 100_000;
    if (context.enemyMoveKeys.size > 0 && enemyMovesAfter < context.movesPerTurn) {
      priority += 120 + (context.movesPerTurn - enemyMovesAfter) * 20;
    }
    if (context.enemyMoveKeys.size > 0 && enemyMovesAfter === 0 && !context.enemyHasFreePlacement) {
      priority += 100_000;
    }
  }

  // Removing the opponent's final connected piece guarantees they cannot
  // complete a future turn. Reserve this tactical case even if it hits only one.
  if (enemyPieces > 0 && enemyCountAfter === 0) priority += 100_000;
  return priority;
}

function selectFromPool(state, actions, limit) {
  if (actions.length <= limit) return actions;
  const prioritized = actions
    .map((action, index) => ({ action, index, priority: actionPriority(state, action) }))
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

function selectCandidates(state, actions, limit) {
  if (actions.length <= limit) return actions;
  const placements = actions.filter((action) => action.type === "place");
  const attacks = actions.filter((action) => action.type === "attack");
  if (placements.length === 0 || attacks.length === 0) return selectFromPool(state, actions, limit);

  const attackLimit = Math.min(attacks.length, Math.max(1, Math.floor(limit / 3)));
  const placementLimit = Math.min(placements.length, limit - attackLimit);
  const selected = [
    ...selectFromPool(state, placements, placementLimit),
    ...selectFromPool(state, attacks, attackLimit)
  ];
  return selected.length < limit
    ? [...selected, ...selectFromPool(state, actions.filter((action) => !selected.includes(action)), limit - selected.length)]
    : selected;
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

function evaluateAction(state, action) {
  return evaluateState(simulateAction(state, action), state.currentPlayer);
}

function choosePreferredAction(bestPlacement, bestAttack, attackIsDelta = false) {
  if (!bestPlacement) return bestAttack?.action || null;
  if (!bestAttack) return bestPlacement.action;
  if (bestPlacement.score >= IMMEDIATE_WIN_SCORE) return bestPlacement.action;
  if (attackIsDelta) return bestAttack.score > ABILITY_USE_MARGIN ? bestAttack.action : bestPlacement.action;
  return bestAttack.score > bestPlacement.score + ABILITY_USE_MARGIN
    ? bestAttack.action
    : bestPlacement.action;
}

function analyzeEasy(state, actions, random) {
  const placements = actions.filter((action) => action.type === "place");
  const attacks = actions.filter((action) => action.type === "attack");
  const randomPlacement = placements.length > 0 ? placements[randomIndex(random, placements.length)] : null;
  const placementCandidates = selectFromPool(state, placements, EASY_PLACEMENT_CANDIDATE_LIMIT);
  const attackCandidates = selectFromPool(state, attacks, EASY_ATTACK_CANDIDATE_LIMIT);
  let bestAttack = null;
  const currentScore = evaluateState(state, state.currentPlayer);
  let winningPlacement = null;
  for (const action of placementCandidates) {
    const score = evaluateAction(state, action);
    if (score >= IMMEDIATE_WIN_SCORE && (!winningPlacement || score > winningPlacement.score)) {
      winningPlacement = { action, score };
    }
  }
  if (winningPlacement) {
    return { action: winningPlacement.action, nodesSearched: placementCandidates.length };
  }

  for (const action of attackCandidates) {
    const score = evaluateAction(state, action) - currentScore;
    if (!bestAttack || score > bestAttack.score) bestAttack = { action, score };
  }
  const bestPlacement = randomPlacement
    ? { action: randomPlacement, score: evaluateAction(state, randomPlacement) }
    : null;

  return {
    action: choosePreferredAction(bestPlacement, bestAttack, true) || actions[0],
    nodesSearched: placementCandidates.length + attackCandidates.length + (bestPlacement ? 1 : 0)
  };
}

function analyzeMedium(state, actions) {
  const candidates = selectCandidates(state, actions, AI_SEARCH_LIMITS.medium.maxEvaluations);
  let bestPlacement = null;
  let bestAttack = null;
  const currentScore = evaluateState(state, state.currentPlayer);
  for (const action of candidates) {
    const evaluated = evaluateAction(state, action);
    const candidate = {
      action,
      score: action.type === "attack" ? evaluated - currentScore : evaluated
    };
    const best = action.type === "attack" ? bestAttack : bestPlacement;
    if (!best || candidate.score > best.score) {
      if (action.type === "attack") bestAttack = candidate;
      else bestPlacement = candidate;
    }
  }

  return {
    action: choosePreferredAction(bestPlacement, bestAttack, true) || actions[0],
    nodesSearched: candidates.length
  };
}

function analyzeHard(state, actions) {
  const limits = AI_SEARCH_LIMITS.hard;
  const rootPlayer = state.currentPlayer;
  const rootCandidates = selectCandidates(state, actions, limits.maxRootCandidates);
  const budget = { nodes: 0 };

  const continuation = (position, depth) => {
    if (position.phase === "finished"
      || position.phase !== "playing"
      || position.currentPlayer !== rootPlayer
      || depth >= limits.maxDepth
      || budget.nodes >= limits.maxNodes) {
      return evaluateState(position, rootPlayer);
    }

    const available = listComputerActions(position);
    if (available.length === 0) return evaluateState(position, rootPlayer);
    const candidates = selectCandidates(position, available, limits.maxCandidatesPerNode);
    let best = -Infinity;
    for (const action of candidates) {
      if (budget.nodes >= limits.maxNodes) break;
      budget.nodes += 1;
      const next = simulateAction(position, action);
      best = Math.max(best, continuation(next, depth + 1));
    }
    return best === -Infinity ? evaluateState(position, rootPlayer) : best;
  };

  let bestPlacement = null;
  let bestAttack = null;
  for (const action of rootCandidates) {
    if (budget.nodes >= limits.maxNodes) break;
    budget.nodes += 1;
    const next = simulateAction(state, action);
    const candidate = { action, score: continuation(next, 1) };
    const best = action.type === "attack" ? bestAttack : bestPlacement;
    if (!best || candidate.score > best.score) {
      if (action.type === "attack") bestAttack = candidate;
      else bestPlacement = candidate;
    }
  }

  return {
    action: choosePreferredAction(bestPlacement, bestAttack) || rootCandidates[0] || actions[0],
    nodesSearched: budget.nodes
  };
}

export function analyzeComputerAction(state, difficulty = "easy", options = {}) {
  validateDifficulty(difficulty);
  const actions = listComputerActions(state);
  if (actions.length === 0) {
    const reason = !state || state.phase !== "playing"
      ? "game-not-playing"
      : getSelectedAbility(state)?.type && getSelectedAbility(state).type !== "freePlacement"
        ? "ability-targeting"
        : "no-legal-action";
    return { action: noAction(reason), nodesSearched: 0, legalActionCount: 0 };
  }

  const analysis = difficulty === "easy"
    ? analyzeEasy(state, actions, options.random || Math.random)
    : difficulty === "medium"
      ? analyzeMedium(state, actions)
      : analyzeHard(state, actions);
  return { ...analysis, legalActionCount: actions.length };
}

export function chooseComputerAction(state, difficulty = "easy", options = {}) {
  return analyzeComputerAction(state, difficulty, options).action;
}
