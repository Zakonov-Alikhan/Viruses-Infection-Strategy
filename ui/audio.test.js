import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAudioManager, getConfirmedAudioEvents, getGameResultSound, SOUND_EFFECTS } from "./audio.js";

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
    this.currentTime = 0;
    this.duration = 240;
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

test("every requested SFX resolves to an audio file already present in the project", async () => {
  const required = [
    "bomb-detonate", "shot-fire", "dirty-bomb", "teleport", "extra-turn", "shield-place",
    "shield-break", "gangsta-shield", "wormhole", "exchange", "game-start"
  ];
  for (const name of required) {
    assert.ok(SOUND_EFFECTS[name], `missing audio mapping for ${name}`);
    const file = new URL(`./audio/${SOUND_EFFECTS[name]}`, import.meta.url);
    assert.ok((await readFile(file)).length > 0, `missing or empty audio file for ${name}`);
  }
});

test("confirmed ability transitions play action cues only after the effect changes state", () => {
  const playing = { phase: "playing", currentPlayer: "X", board: [["X", "O"], ["", ""]], eventItems: [], protections: [], inventory: { X: [], O: [] } };
  const event = (key, fields = {}) => ({ ...playing, ...fields, message: [{ key }] });
  assert.deepEqual(getConfirmedAudioEvents(playing, event("message.bomb")), ["bomb-detonate"]);
  assert.deepEqual(getConfirmedAudioEvents(playing, event("message.antiBomb", { board: [["X", "#"], ["#", "#"]] })), ["piece-destroy", "dirty-bomb"]);
  assert.deepEqual(getConfirmedAudioEvents(playing, event("message.pointDestroy", { board: [["X", ""], ["", ""]] })), ["piece-destroy", "shot-fire"]);
  assert.deepEqual(getConfirmedAudioEvents(playing, event("message.debris", { board: [["X", "O"], ["#", "#"]] })), ["dirty-bomb"]);
  assert.deepEqual(getConfirmedAudioEvents(playing, event("message.exchange", { inventory: { X: [], O: [] } })), ["exchange"]);

  const selectedTeleport = { ...playing, selectedAbility: 8, inventory: { X: [{ id: 8, type: "freePlacement" }], O: [] } };
  assert.deepEqual(getConfirmedAudioEvents(playing, selectedTeleport), []);
  assert.deepEqual(getConfirmedAudioEvents(selectedTeleport, event("message.freePlacementUsed", {
    board: [["X", "O"], ["", "X"]], selectedAbility: null
  })), ["piece-place", "teleport"]);
});

test("ordinary piece deaths that create dead cells never play the dirty bomb sound", () => {
  const previous = {
    phase: "playing", currentPlayer: "X", board: [["X", "O"], ["O", ""]],
    eventItems: [], protections: [], inventory: { X: [], O: [] }, message: []
  };
  const afterChainReaction = {
    ...previous,
    board: [["X", "#"], ["#", ""]],
    message: [{ key: "message.destroyed", params: { count: 2 } }]
  };
  assert.deepEqual(getConfirmedAudioEvents(previous, afterChainReaction), ["piece-destroy"]);
});

test("an extra-turn bonus is silent when queued and sounds when the turn actually starts", () => {
  const before = {
    phase: "playing", currentPlayer: "X", piecesLeft: 1, board: [["X"]], eventItems: [], protections: [],
    inventory: { X: [], O: [] }, pendingExtraTurns: { X: [], O: [] }, message: []
  };
  const queued = { ...before, inventory: { X: [{ id: 1, type: "extraTurn" }], O: [] }, pendingExtraTurns: { X: [1], O: [] }, message: [{ key: "message.collected" }] };
  assert.deepEqual(getConfirmedAudioEvents(before, queued), []);
  const started = { ...queued, piecesLeft: 3, message: [{ key: "message.extraTurn" }] };
  assert.deepEqual(getConfirmedAudioEvents(queued, started), ["extra-turn"]);
});

test("shield cues reflect protection installation and removal, including the permanent variant", () => {
  const before = { phase: "playing", board: [["X"]], eventItems: [], protections: [], inventory: { X: [], O: [] } };
  const shield = { row: 0, col: 0, owner: "X", permanent: false };
  const gangster = { ...shield, permanent: true };
  assert.deepEqual(getConfirmedAudioEvents(before, { ...before, protections: [shield] }), ["shield-place"]);
  assert.deepEqual(getConfirmedAudioEvents(before, { ...before, protections: [gangster] }), ["gangsta-shield"]);
  assert.deepEqual(getConfirmedAudioEvents({ ...before, protections: [shield] }, before), ["shield-break"]);
});

test("wormhole cue requires a successful remote-chain placement through an active pair", () => {
  const previous = {
    phase: "playing", currentPlayer: "X", piecesLeft: 2, eventItems: [], protections: [], inventory: { X: [], O: [] },
    board: Array.from({ length: 5 }, () => Array(7).fill("")),
    wormholePair: { endpoints: { orange: { row: 1, col: 1 }, blue: { row: 3, col: 5 } } }
  };
  previous.board[1][0] = "X";
  previous.board[1][3] = "X";
  const nextBoard = previous.board.map((row) => row.slice());
  nextBoard[3][4] = "X";
  assert.deepEqual(getConfirmedAudioEvents(previous, { ...previous, board: nextBoard }), ["piece-place", "wormhole"]);

  const cancelledOrRejected = { ...previous, selectedAbility: 3, inventory: { X: [{ id: 3, type: "freePlacement" }], O: [] } };
  assert.deepEqual(getConfirmedAudioEvents(cancelledOrRejected, { ...cancelledOrRejected }), []);
  const ordinaryBoard = previous.board.map((row) => row.slice());
  ordinaryBoard[1][4] = "X";
  assert.deepEqual(getConfirmedAudioEvents(previous, { ...previous, board: ordinaryBoard }), ["piece-place"]);
});

test("match start cue fires only on transition into play, and duplicate snapshots stay silent", () => {
  const setup = { phase: "setup-o", board: [["", ""]], eventItems: [], protections: [] };
  const playing = { ...setup, phase: "playing" };
  assert.deepEqual(getConfirmedAudioEvents(setup, playing), ["game-start"]);
  assert.deepEqual(getConfirmedAudioEvents(playing, structuredClone(playing)), []);
});

test("global settings entry points and both persistent audio controls exist across site screens", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.equal((html.match(/data-open-general-settings/g) || []).length, 4);
  assert.match(html, /id="sound-effects-volume"/);
  assert.match(html, /id="background-music-volume"/);
  assert.match(html, /aria-controls="menu-settings-modal"/);
  assert.match(html, /id="menu-settings-modal"[\s\S]*?id="language-select"/);
  assert.doesNotMatch(html, /class="language-picker"/);
  assert.ok(html.indexOf('id="account-action"') < html.indexOf('id="menu-settings-button"'));
  assert.ok(html.indexOf('id="active-games-refresh"') < html.indexOf('id="active-games-settings-button"'));
  assert.ok(html.indexOf('id="return-menu-button"') < html.indexOf('id="game-global-settings-button"'));
  assert.match(html, /id="wormhole-lifetime-modal"[\s\S]*?id="wormhole-lifetime-input"/);
  const russian = await readFile(new URL("./locale-ru.js", import.meta.url), "utf8");
  const english = await readFile(new URL("./locale-en.js", import.meta.url), "utf8");
  assert.match(russian, /"admin\.addWormholes": "Червоточина"/);
  assert.match(english, /"admin\.addWormholes": "Wormhole"/);
});

test("audio effects reuse prepared players, overlap with independent voices, and respect mute and volume", () => {
  FakeAudio.instances = [];
  const manager = createAudioManager({ AudioCtor: FakeAudio, storage: new MemoryStorage() });
  assert.equal(FakeAudio.instances.length, Object.keys(SOUND_EFFECTS).length + 1);
  assert.equal(manager.play("piece-place"), true);
  assert.equal(manager.play("piece-place"), true);
  assert.equal(manager.play("piece-destroy"), true);
  const placeAudio = FakeAudio.instances.find((audio) => audio.src.endsWith("piece-place.mp3"));
  assert.equal(placeAudio.playCount, 1);
  const concurrentPlaceAudio = FakeAudio.instances.filter((audio) => audio.src.endsWith("piece-place.mp3"))[1];
  assert.equal(concurrentPlaceAudio.playCount, 1);
  assert.ok(placeAudio.volume < 0.35);
  manager.setVolume(0.2);
  assert.equal(placeAudio.volume, 0.2 * 0.48);
  assert.equal(concurrentPlaceAudio.volume, 0.2 * 0.48);
  manager.setEnabled(false);
  assert.equal(placeAudio.paused, true);
  assert.equal(concurrentPlaceAudio.paused, true);
});

test("effect mute and volume preferences persist and are respected", () => {
  FakeAudio.instances = [];
  const storage = new MemoryStorage();
  const manager = createAudioManager({ AudioCtor: FakeAudio, storage });
  manager.setVolume(0.6);
  manager.setMusicVolume(0.3);
  manager.setEnabled(false);
  assert.equal(manager.play("item-spawn"), false);
  const restored = createAudioManager({ AudioCtor: FakeAudio, storage });
  assert.deepEqual(restored.getPreferences(), { enabled: false, volume: 0.6, musicVolume: 0.3 });
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

test("critical timer cue also fires once for a clock snapshot first observed inside the warning zone", () => {
  FakeAudio.instances = [];
  const manager = createAudioManager({ AudioCtor: FakeAudio, storage: new MemoryStorage() });
  manager.observeTimer("reconnect", "O", 8_500, true);
  manager.observeTimer("reconnect", "O", 8_400, true);
  const warningAudio = FakeAudio.instances.find((audio) => audio.src.endsWith("timer-warning.mp3"));
  assert.equal(warningAudio.playCount, 1);
});

test("win and loss cues follow the local player perspective and ignore spectator results", () => {
  const playing = { phase: "playing" };
  const won = { phase: "finished", winner: "X" };
  const lost = { phase: "finished", winner: "O" };
  assert.equal(getGameResultSound(playing, won, { computerOpponent: true }), "game-win");
  assert.equal(getGameResultSound(playing, lost, { computerOpponent: true }), "game-loss");
  assert.equal(getGameResultSound(playing, lost, { onlineMode: true, onlineSide: "O" }), "game-win");
  assert.equal(getGameResultSound(playing, won, { onlineMode: true, onlineSide: "O" }), "game-loss");
  assert.equal(getGameResultSound(playing, won, { observerMode: true }), null);
  assert.equal(getGameResultSound(won, won, { computerOpponent: true }), null);
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
  manager.setMusicVolume(0.42);
  assert.equal(music.volume, 0.42);
  const firstTrack = music.src;
  music.end();
  assert.equal(music.playCount, 2);
  assert.notEqual(music.src, firstTrack);
  manager.setMusicActive(false);
  assert.equal(music.paused, true);
});

test("music autoplay is attempted on page activation and resumes the same track after a browser block", async () => {
  FakeAudio.instances = [];
  class AutoplayBlockedAudio extends FakeAudio {
    play() {
      this.paused = true;
      this.playCount += 1;
      return Promise.reject(new Error("NotAllowedError"));
    }
  }
  const manager = createAudioManager({ AudioCtor: AutoplayBlockedAudio, storage: new MemoryStorage(), random: () => 0 });
  manager.setMusicActive(true);
  const music = FakeAudio.instances.at(-1);
  const selectedTrack = music.src;
  assert.equal(music.playCount, 1);
  await Promise.resolve();
  await Promise.resolve();
  manager.unlock();
  assert.equal(music.playCount, 2);
  assert.equal(music.src, selectedTrack);
});

test("music keeps the same track and playback position across a document navigation", () => {
  FakeAudio.instances = [];
  const session = new MemoryStorage();
  const firstPage = createAudioManager({ AudioCtor: FakeAudio, storage: new MemoryStorage(), sessionStorage: session, random: () => 0 });
  firstPage.setMusicActive(true);
  firstPage.unlock();
  const firstMusic = FakeAudio.instances.at(-1);
  firstMusic.currentTime = 37.5;
  firstPage.persistMusicSession();

  FakeAudio.instances = [];
  const nextPage = createAudioManager({ AudioCtor: FakeAudio, storage: new MemoryStorage(), sessionStorage: session, random: () => 0.99 });
  nextPage.setMusicActive(true);
  const resumedMusic = FakeAudio.instances.at(-1);
  assert.equal(resumedMusic.src, firstMusic.src);
  assert.equal(resumedMusic.currentTime, 37.5);
  assert.equal(resumedMusic.playCount, 1);
});

test("first-party page links use client-side routing while music stays active", async () => {
  const script = await readFile(new URL("./script.js", import.meta.url), "utf8");
  assert.match(script, /audioManager\.setMusicActive\(true\)/);
  assert.match(script, /window\.history\.pushState\(null, "", destination\.pathname\)/);
  assert.match(script, /window\.addEventListener\("popstate"/);
});
