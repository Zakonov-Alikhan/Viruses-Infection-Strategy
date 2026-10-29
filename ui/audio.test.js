import test from "node:test";
import assert from "node:assert/strict";
import { createAudioManager, getConfirmedAudioEvents, SOUND_EFFECTS } from "./audio.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src;
    this.paused = true;
    this.playCount = 0;
    this.listeners = new Map();
    FakeAudio.instances.push(this);
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  play() { this.paused = false; this.playCount += 1; return Promise.resolve(); }
  pause() { this.paused = true; }
  end() { this.paused = true; this.listeners.get("ended")?.(); }
}

test("confirmed state changes map placements, destruction, and item spawns to one cue each", () => {
  const previous = {
    phase: "playing",
    board: [["X", "", ""], ["", "O", ""]],
    eventItems: []
  };
  const next = {
    phase: "playing",
    board: [["X", "", ""], ["X", "", ""]],
    eventItems: [{ id: 7, type: "bomb", row: 0, col: 2 }]
  };
  assert.deepEqual(getConfirmedAudioEvents(previous, next), ["piece-place", "piece-destroy", "item-spawn"]);
  assert.deepEqual(getConfirmedAudioEvents(next, structuredClone(next)), []);
});

test("audio effects reuse prepared players and do not overlap the same effect", () => {
  FakeAudio.instances = [];
  const manager = createAudioManager({ AudioCtor: FakeAudio, storage: new MemoryStorage() });
  assert.equal(FakeAudio.instances.length, Object.keys(SOUND_EFFECTS).length + 1);
  assert.equal(manager.play("piece-place"), true);
  assert.equal(manager.play("piece-place"), false);
  const placeAudio = FakeAudio.instances.find((audio) => audio.src.endsWith("piece-place.mp3"));
  assert.equal(placeAudio.playCount, 1);
  assert.ok(placeAudio.volume < 0.35);
  manager.setVolume(0.2);
  assert.equal(placeAudio.volume, 0.2 * 0.48);
  manager.setEnabled(false);
  assert.equal(placeAudio.paused, true);
});

test("effect mute and volume preferences persist and are respected", () => {
  FakeAudio.instances = [];
  const storage = new MemoryStorage();
  const manager = createAudioManager({ AudioCtor: FakeAudio, storage });
  manager.setVolume(0.6);
  manager.setEnabled(false);
  assert.equal(manager.play("item-spawn"), false);
  const restored = createAudioManager({ AudioCtor: FakeAudio, storage });
  assert.deepEqual(restored.getPreferences(), { enabled: false, volume: 0.6 });
  restored.setEnabled(true);
  assert.equal(restored.play("item-spawn"), true);
  const itemAudio = FakeAudio.instances.filter((audio) => audio.src.endsWith("item-spawn.mp3")).at(-1);
  assert.equal(itemAudio.volume, 0.6 * 0.78);
});

test("critical timer cue fires once when an active clock crosses ten seconds", () => {
  FakeAudio.instances = [];
  const manager = createAudioManager({ AudioCtor: FakeAudio, storage: new MemoryStorage() });
  manager.observeTimer(1, "X", 10_200, true);
  manager.observeTimer(1, "X", 9_900, true);
  manager.observeTimer(1, "X", 9_000, true);
  const warningAudio = FakeAudio.instances.find((audio) => audio.src.endsWith("timer-warning.mp3"));
  assert.equal(warningAudio.playCount, 1);
  warningAudio.end();
  manager.resetTimerWarnings(2);
  manager.observeTimer(2, "X", 10_001, true);
  manager.observeTimer(2, "X", 10_000, true);
  assert.equal(warningAudio.playCount, 2);
});

test("background tracks are shuffled and continue after the current track ends", () => {
  FakeAudio.instances = [];
  const tracks = ["one.mp3", "two.mp3", "three.mp3"];
  const manager = createAudioManager({
    AudioCtor: FakeAudio,
    storage: new MemoryStorage(),
    random: () => 0,
    musicTracks: tracks
  });
  manager.setMusicActive(true);
  manager.unlock();
  const music = FakeAudio.instances.at(-1);
  assert.equal(music.playCount, 1);
  const firstTrack = music.src;
  music.end();
  assert.equal(music.playCount, 2);
  assert.notEqual(music.src, firstTrack);
  manager.setMusicActive(false);
  assert.equal(music.paused, true);
});
