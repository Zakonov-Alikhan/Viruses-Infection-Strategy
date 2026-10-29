export const SOUND_EFFECTS = Object.freeze({
  "piece-place": "piece-place.mp3",
  "piece-destroy": "piece-destroy.mp3",
  "item-spawn": "item-spawn.mp3",
  "timer-warning": "timer-warning.mp3",
  "game-win": "game-win.mp3",
  "game-loss": "game-loss.mp3"
});

export const BACKGROUND_TRACKS = Object.freeze([
  "ost-01.mp3", "ost-02.mp3", "ost-03.mp3", "ost-04.mp3", "ost-05.mp3", "ost-06.mp3"
]);

/** Derive one sound cue per confirmed state transition, not per render. */
export function getConfirmedAudioEvents(previousState, nextState) {
  if (previousState?.phase !== "playing" || !nextState?.board || !previousState.board) return [];
  const events = [];
  let placedPiece = false;
  let destroyedPiece = false;
  for (let row = 0; row < nextState.board.length; row += 1) {
    for (let col = 0; col < nextState.board[row].length; col += 1) {
      const before = previousState.board[row]?.[col];
      const after = nextState.board[row][col];
      if ((after === "X" || after === "O") && before !== after) placedPiece = true;
      if ((before === "X" || before === "O") && before !== after) destroyedPiece = true;
    }
  }
  if (placedPiece) events.push("piece-place");
  if (destroyedPiece) events.push("piece-destroy");
  const previousItemIds = new Set((previousState.eventItems || []).map((item) => item.id));
  if ((nextState.eventItems || []).some((item) => !previousItemIds.has(item.id))) events.push("item-spawn");
  return events;
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
  "game-loss": 0.72
});

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
      if (!effects.has(name)) effects.set(name, getAudio(file));
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
    const audio = effects.get(name);
    if (!audio || audio.paused === false) return false;
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
      for (const audio of effects.values()) audio?.pause?.();
    }
    save();
  }

  function setVolume(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) return;
    preferences.volume = Math.max(0, Math.min(1, value));
    if (preferences.volume === 0) {
      for (const audio of effects.values()) audio?.pause?.();
    } else if (preferences.enabled) {
      for (const [name, audio] of effects) {
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
