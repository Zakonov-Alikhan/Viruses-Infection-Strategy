export const SOUND_EFFECTS = Object.freeze({
  "piece-place": "piece-place.mp3",
  "piece-destroy": "piece-destroy.mp3",
  "item-spawn": "item-spawn.mp3",
  "timer-warning": "timer-warning.mp3",
  "game-win": "game-win.mp3",
  "game-loss": "game-loss.mp3",
  "bomb-detonate": "bomb-detonate.mp3",
  "shot-fire": "shot-fire.mp3",
  "dirty-bomb": "dirty-bomb.mp3",
  teleport: "teleport.mp3",
  "extra-turn": "extra-turn.mp3",
  "shield-place": "shield-place.mp3",
  "shield-break": "shield-break.mp3",
  "gangsta-shield": "gangsta-shield.mp3",
  wormhole: "wormhole.mp3",
  exchange: "exchange.mp3",
  "game-start": "game-start.mp3"
});

export const BACKGROUND_TRACKS = Object.freeze([
  "ost-01.mp3", "ost-02.mp3", "ost-03.mp3", "ost-04.mp3", "ost-05.mp3", "ost-06.mp3"
]);

/** Derive one sound cue per confirmed state transition, not per render. */
export function getConfirmedAudioEvents(previousState, nextState) {
  if (!previousState || !nextState?.board || !previousState.board) return [];
  const events = new Set();
  const previousMessageCounts = countMessageKeys(previousState.message);
  const nextMessageCounts = countMessageKeys(nextState.message);
  const hasNewMessage = (key) => (nextMessageCounts.get(key) || 0) > (previousMessageCounts.get(key) || 0);
  const wasPlaying = previousState.phase === "playing";

  if (previousState.phase !== "playing" && nextState.phase === "playing") events.add("game-start");

  let placedPiece = false;
  let destroyedPiece = false;
  let debrisAppeared = false;
  let portalMove = false;
  const currentPlayer = previousState.currentPlayer;
  const selectedItem = previousState.inventory?.[currentPlayer]
    ?.find((item) => item.id === previousState.selectedAbility);
  const freePlacementSelected = selectedItem?.type === "freePlacement"
    || previousState.selectedAbility === "admin:freePlacement";
  for (let row = 0; row < nextState.board.length; row += 1) {
    for (let col = 0; col < nextState.board[row].length; col += 1) {
      const before = previousState.board[row]?.[col];
      const after = nextState.board[row][col];
      if (wasPlaying && (after === "X" || after === "O") && before !== after) {
        placedPiece = true;
        if (previousState.phase === "playing" && !freePlacementSelected
          && !hasAdjacentPiece(previousState.board, row, col, currentPlayer)
          && isWormholeRoutedMove(previousState, row, col, currentPlayer)) portalMove = true;
      }
      if (wasPlaying && (before === "X" || before === "O") && before !== after) destroyedPiece = true;
      if (wasPlaying && before !== "#" && after === "#") debrisAppeared = true;
    }
  }
  if (placedPiece) events.add("piece-place");
  if (destroyedPiece) events.add("piece-destroy");
  if (portalMove) events.add("wormhole");
  if (wasPlaying && (debrisAppeared || hasNewMessage("message.antiBomb") || hasNewMessage("message.debris"))) events.add("dirty-bomb");
  if (wasPlaying && hasNewMessage("message.bomb")) events.add("bomb-detonate");
  if (wasPlaying && hasNewMessage("message.pointDestroy")) events.add("shot-fire");
  if (wasPlaying && hasNewMessage("message.freePlacementUsed")) events.add("teleport");
  if (wasPlaying && hasNewMessage("message.extraTurn")) events.add("extra-turn");
  if (wasPlaying && hasNewMessage("message.exchange")) events.add("exchange");

  const previousProtections = new Set((previousState.protections || []).map(protectionKey));
  const nextProtections = new Set((nextState.protections || []).map(protectionKey));
  if (wasPlaying && (nextState.protections || []).some((protection) => !previousProtections.has(protectionKey(protection)))) {
    if ((nextState.protections || []).some((protection) => !previousProtections.has(protectionKey(protection)) && protection.permanent)) {
      events.add("gangsta-shield");
    } else events.add("shield-place");
  }
  if (wasPlaying && (previousState.protections || []).some((protection) => !protection.permanent && !nextProtections.has(protectionKey(protection)))) {
    events.add("shield-break");
  }

  const previousItemIds = new Set((previousState.eventItems || []).map((item) => item.id));
  if ((nextState.eventItems || []).some((item) => !previousItemIds.has(item.id))) events.add("item-spawn");
  return [...events];
}

function countMessageKeys(message) {
  const entries = Array.isArray(message) ? message : message ? [message] : [];
  const counts = new Map();
  for (const entry of entries) {
    if (typeof entry?.key === "string") counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
  }
  return counts;
}

function protectionKey(protection) {
  return `${protection.row},${protection.col},${protection.owner},${Boolean(protection.permanent)}`;
}

function hasAdjacentPiece(board, row, col, player) {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if ((dr || dc) && board[row + dr]?.[col + dc] === player) return true;
    }
  }
  return false;
}

function isWormholeRoutedMove(state, row, col, player) {
  const pair = state.wormholePair;
  if (!pair?.endpoints || !Object.values(pair.endpoints).some(({ row: portalRow, col: portalCol }) =>
    Math.abs(portalRow - row) <= 1 && Math.abs(portalCol - col) <= 1 && (portalRow !== row || portalCol !== col))) return false;
  return Object.values(pair.endpoints).some(({ row: portalRow, col: portalCol }) => {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if ((dr || dc) && state.board[portalRow + dr]?.[portalCol + dc] === player) return true;
      }
    }
    return false;
  });
}

export function getGameResultSound(previousState, nextState, {
  onlineMode = false,
  onlineSide = null,
  computerOpponent = false,
  observerMode = false
} = {}) {
  if (previousState?.phase === "finished" || nextState?.phase !== "finished" || !nextState.winner || observerMode) return null;
  const perspective = onlineMode ? onlineSide : computerOpponent ? "X" : null;
  return perspective ? (nextState.winner === perspective ? "game-win" : "game-loss") : "game-win";
}

const PREFERENCES_KEY = "cascade-wars-audio-v1";
const MUSIC_SESSION_KEY = "cascade-wars-music-session-v1";
const EFFECT_GAIN = Object.freeze({
  "piece-place": 0.48,
  "piece-destroy": 0.68,
  "item-spawn": 0.78,
  "timer-warning": 0.62,
  "game-win": 0.72,
  "game-loss": 0.72,
  "bomb-detonate": 0.7,
  "shot-fire": 0.65,
  "dirty-bomb": 0.76,
  teleport: 0.62,
  "extra-turn": 0.68,
  "shield-place": 0.58,
  "shield-break": 0.68,
  "gangsta-shield": 0.62,
  wormhole: 0.54,
  exchange: 0.66,
  "game-start": 0.58
});
const MAX_EFFECT_VOICES = 4;

function getStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function readPreferences(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PREFERENCES_KEY) || "null");
    return {
      enabled: saved?.enabled !== false,
      volume: Number.isFinite(saved?.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.35,
      musicVolume: Number.isFinite(saved?.musicVolume) ? Math.max(0, Math.min(1, saved.musicVolume)) : 0.18
    };
  } catch {
    return { enabled: true, volume: 0.35, musicVolume: 0.18 };
  }
}

/** A single shared set of audio elements; event playback is safe to call from confirmed state transitions. */
export function createAudioManager({
  AudioCtor = globalThis.Audio,
  storage = getStorage(),
  sessionStorage = (() => { try { return globalThis.sessionStorage; } catch { return null; } })(),
  random = Math.random,
  basePath = "/ui/audio/",
  musicTracks = BACKGROUND_TRACKS
} = {}) {
  const preferences = readPreferences(storage);
  const effects = new Map();
  const warningTimers = new Map();
  let music = null;
  let unlocked = false;
  let musicActive = false;
  let autoplayAttempted = false;
  let currentTrackIndex = null;
  let shuffledTracks = [];
  let lastTrack = null;
  let restoredPosition = 0;

  try {
    const saved = JSON.parse(sessionStorage?.getItem(MUSIC_SESSION_KEY) || "null");
    const savedTrackIndex = musicTracks.findIndex((track) => track === saved?.track);
    if (savedTrackIndex >= 0) {
      currentTrackIndex = savedTrackIndex;
      restoredPosition = Number.isFinite(saved.position) && saved.position >= 0 ? saved.position : 0;
      shuffledTracks = Array.isArray(saved.shuffledTracks)
        ? saved.shuffledTracks.filter((index) => Number.isInteger(index) && index >= 0 && index < musicTracks.length)
        : [];
      lastTrack = Number.isInteger(saved.lastTrack) && saved.lastTrack >= 0 && saved.lastTrack < musicTracks.length
        ? saved.lastTrack : savedTrackIndex;
    }
  } catch { /* A corrupt or unavailable session store should not prevent music playback. */ }

  const save = () => {
    try { storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Storage can be unavailable in private browsing. */ }
  };

  function getAudio(file, preload = "auto") {
    if (typeof AudioCtor !== "function") return null;
    const audio = new AudioCtor(basePath + encodeURIComponent(file));
    audio.preload = preload;
    return audio;
  }

  function prepare() {
    for (const [name, file] of Object.entries(SOUND_EFFECTS)) {
      if (!effects.has(name)) effects.set(name, [getAudio(file)]);
    }
    if (!music) {
      music = getAudio(musicTracks[0] || "", "metadata");
      if (music) music.addEventListener?.("ended", advanceMusic);
      if (music && !music.addEventListener) music.onended = advanceMusic;
      if (music && currentTrackIndex !== null) {
        music.src = basePath + encodeURIComponent(musicTracks[currentTrackIndex]);
        const restorePosition = () => {
          if (restoredPosition > 0 && music && Number.isFinite(music.duration)) {
            try {
              music.currentTime = restoredPosition < music.duration ? restoredPosition : 0;
            } catch { /* Wait for another metadata event if needed. */ }
            restoredPosition = 0;
          }
          if (musicActive && music?.paused && (!autoplayAttempted || unlocked)) playCurrentTrack();
        };
        music.addEventListener?.("loadedmetadata", restorePosition, { once: true });
        restorePosition();
      }
    }
  }

  function persistMusicSession() {
    if (currentTrackIndex === null || !musicTracks[currentTrackIndex]) return;
    try {
      sessionStorage?.setItem(MUSIC_SESSION_KEY, JSON.stringify({
        track: musicTracks[currentTrackIndex],
        position: Number.isFinite(music?.currentTime) ? music.currentTime : restoredPosition,
        shuffledTracks,
        lastTrack
      }));
    } catch { /* Session persistence is best-effort; playback remains available. */ }
  }

  function refillTrackBag() {
    shuffledTracks = musicTracks.map((_, index) => index);
    for (let index = shuffledTracks.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.min(index, Math.floor(random() * (index + 1)));
      [shuffledTracks[index], shuffledTracks[swapIndex]] = [shuffledTracks[swapIndex], shuffledTracks[index]];
    }
    if (shuffledTracks.length > 1 && shuffledTracks.at(-1) === lastTrack) {
      [shuffledTracks[0], shuffledTracks[shuffledTracks.length - 1]] = [shuffledTracks.at(-1), shuffledTracks[0]];
    }
  }

  function startNextTrack() {
    if (!musicActive || !music || musicTracks.length === 0) return;
    if (shuffledTracks.length === 0) refillTrackBag();
    const index = shuffledTracks.pop();
    lastTrack = index;
    currentTrackIndex = index;
    music.src = basePath + encodeURIComponent(musicTracks[currentTrackIndex]);
    music.currentTime = 0;
    restoredPosition = 0;
    playCurrentTrack();
    persistMusicSession();
  }

  function playCurrentTrack() {
    if (!musicActive || !music || currentTrackIndex === null) return;
    if (restoredPosition > 0) {
      if (!Number.isFinite(music.duration)) return;
      try { music.currentTime = restoredPosition < music.duration ? restoredPosition : 0; } catch { return; }
      restoredPosition = 0;
    }
    music.volume = preferences.musicVolume;
    if (!unlocked) autoplayAttempted = true;
    try {
      const result = music.play?.();
      result?.then?.(() => { autoplayAttempted = false; }).catch?.(() => { autoplayAttempted = true; });
      if (!result?.then) autoplayAttempted = false;
    } catch {
      autoplayAttempted = true;
    }
  }

  function advanceMusic() {
    if (musicActive) startNextTrack();
  }

  function unlock() {
    prepare();
    unlocked = true;
    if (currentTrackIndex !== null && music?.paused) playCurrentTrack();
    else if (currentTrackIndex === null) startNextTrack();
  }

  function play(name) {
    if (!preferences.enabled || preferences.volume <= 0 || !SOUND_EFFECTS[name]) return false;
    prepare();
    const voices = effects.get(name);
    if (!voices) return false;
    let audio = voices.find((voice) => voice && voice.paused !== false);
    if (!audio && voices.length < MAX_EFFECT_VOICES) {
      audio = getAudio(SOUND_EFFECTS[name]);
      if (audio) voices.push(audio);
    }
    if (!audio) return false;
    audio.volume = preferences.volume * EFFECT_GAIN[name];
    try { audio.currentTime = 0; } catch { /* Some browsers reject seeking before metadata loads. */ }
    const result = audio.play?.();
    result?.catch?.(() => {});
    return true;
  }

  function observeTimer(sessionId, side, remainingMs, active) {
    const key = `${sessionId}:${side}`;
    const previous = warningTimers.get(key);
    warningTimers.set(key, remainingMs);
    if (active && remainingMs <= 10_000 && remainingMs > 0
      && (previous === undefined || previous > 10_000)) {
      play("timer-warning");
    }
  }

  function resetTimerWarnings(sessionId) {
    for (const key of warningTimers.keys()) {
      if (!key.startsWith(`${sessionId}:`)) warningTimers.delete(key);
    }
  }

  function setMusicActive(active) {
    musicActive = Boolean(active);
    prepare();
    if (!musicActive && music && !music.paused) music.pause();
    else if (musicActive && music?.paused && (!autoplayAttempted || unlocked)) {
      if (currentTrackIndex === null) startNextTrack();
      else playCurrentTrack();
    }
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("pagehide", persistMusicSession);
  }

  function setMusicVolume(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) return;
    preferences.musicVolume = Math.max(0, Math.min(1, value));
    if (music) music.volume = preferences.musicVolume;
    save();
  }

  function setEnabled(enabled) {
    preferences.enabled = Boolean(enabled);
    if (!preferences.enabled) {
      for (const voices of effects.values()) for (const audio of voices) audio?.pause?.();
    }
    save();
  }

  function setVolume(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) return;
    preferences.volume = Math.max(0, Math.min(1, value));
    if (preferences.volume === 0) {
      for (const voices of effects.values()) for (const audio of voices) audio?.pause?.();
    } else if (preferences.enabled) {
      for (const [name, voices] of effects) for (const audio of voices) {
        if (audio?.paused === false) audio.volume = preferences.volume * EFFECT_GAIN[name];
      }
    }
    save();
  }

  prepare();
  return {
    play,
    unlock,
    setMusicActive,
    setMusicVolume,
    setEnabled,
    setVolume,
    observeTimer,
    resetTimerWarnings,
    persistMusicSession,
    getPreferences: () => ({ ...preferences })
  };
}

export const audioManager = createAudioManager();
