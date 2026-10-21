const PLAYING = "playing";

function cloneState(state) {
  return structuredClone(state);
}

function checkpoint(state, clockRemaining = null) {
  return {
    side: state.currentPlayer,
    turnNumber: state.turnNumber ?? 0,
    state: cloneState(state),
    clockRemaining: clockRemaining ? { ...clockRemaining } : null,
    clockIncrementMs: 0
  };
}

/** Keeps full turn-boundary snapshots for local undo and authoritative server undo. */
export class TurnUndoHistory {
  constructor({ maxEntries = 8, preserveCompletedTurns = false } = {}) {
    this.maxEntries = maxEntries;
    this.preserveCompletedTurns = preserveCompletedTurns;
    this.active = null;
    this.completed = [];
  }

  reset(state = null, clockRemaining = null) {
    this.active = state?.phase === PLAYING ? checkpoint(state, clockRemaining) : null;
    this.completed = [];
  }

  clear() {
    this.active = null;
    this.completed = [];
  }

  record(previous, next, clockRemaining = null, incrementAppliedMs = 0) {
    if (!next || next === previous) return;

    if (previous?.phase !== PLAYING && next.phase === PLAYING) {
      this.reset(next, clockRemaining);
      return;
    }
    if (previous?.phase !== PLAYING) return;
    if (next.phase !== PLAYING) {
      this.clear();
      return;
    }

    if (!this.active) this.active = checkpoint(previous, clockRemaining);
    if (Number.isFinite(incrementAppliedMs) && incrementAppliedMs > 0
      && this.active.side === previous.currentPlayer) {
      this.active.clockIncrementMs += incrementAppliedMs;
    }
    if (next.currentPlayer !== previous.currentPlayer) {
      if (!this.preserveCompletedTurns) this.completed = [];
      this.completed.push(this.active);
      this.completed = this.completed.slice(-this.maxEntries);
      this.active = checkpoint(next, clockRemaining);
      return;
    }

    // Any committed action by the next player makes the previous turn ineligible.
    if (this.completed.length && !this.preserveCompletedTurns) this.completed = [];
    // Same-side extra turns stay in the same undo group, so the snapshot remains
    // before the first turn in the uninterrupted control sequence.
  }

  canUndo(side = null, { latestOnly = false } = {}) {
    if (!this.active || this.active.state.phase !== PLAYING || !this.completed.length) return false;
    const index = this.#findTurn(side, latestOnly);
    return index >= 0;
  }

  undo(side = null, { latestOnly = false } = {}) {
    const index = this.#findTurn(side, latestOnly);
    if (index < 0 || !this.active || this.active.state.phase !== PLAYING) return null;
    const target = this.completed[index];
    const restored = cloneState(target.state);
    this.completed = [];
    this.active = checkpoint(restored, target.clockRemaining);
    return {
      side: target.side,
      turnNumber: target.turnNumber,
      state: restored,
      clockRemaining: target.clockRemaining ? { ...target.clockRemaining } : null,
      clockIncrementMs: target.clockIncrementMs
    };
  }

  #findTurn(side, latestOnly) {
    if (!this.active || this.active.state.phase !== PLAYING || !this.completed.length) return -1;
    const index = side === null
      ? this.completed.length - 1
      : this.completed.findLastIndex((entry) => entry.side === side);
    if (index < 0 || (latestOnly && index !== this.completed.length - 1)) return -1;
    return index;
  }
}
