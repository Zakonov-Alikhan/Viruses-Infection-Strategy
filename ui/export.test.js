import test from "node:test";
import assert from "node:assert/strict";
import { createMapExport, downloadBoardPng, downloadMapJson, MAP_EXPORT_FORMAT } from "./export.js";

function finishedState() {
  return {
    phase: "finished",
    winner: "X",
    roundNumber: 7,
    turnNumber: 12,
    board: [["X", "", "#"], ["", "O", ""]],
    settings: {
      width: 3, height: 2, piecesPerTurn: 1, clockMinutes: 5, incrementSeconds: 2,
      unlimitedTime: false, randomEvents: true, wormholesEnabled: true,
      freeStartingPositions: true, disabledItems: ["bomb"], adminMode: true, animationsEnabled: false
    },
    eventItems: [{ id: 91, type: "bomb", row: 0, col: 1 }, { id: 92, type: "not-an-item", row: 1, col: 2 }],
    inventory: { X: [{ id: "secret-inventory-key", type: "shield" }], O: [{ id: 8, type: "exchange" }] },
    protections: [{ row: 0, col: 0, permanent: false, owner: "X" }, { row: 1, col: 1, permanent: true, owner: "O" }],
    wormholePair: { id: 33, endpoints: { orange: { row: 0, col: 2 }, blue: { row: 1, col: 0 } }, roundsRemaining: 4 },
    playerRoles: { X: "admin", O: "player" },
    startChoices: { X: { row: 0, col: 0 }, O: { row: 1, col: 1 } },
    roomCode: "ABCDEFGH", reconnectToken: "token-not-for-export", adminSecret: "also-private"
  };
}

test("map JSON uses a versioned allow-list and contains final board objects but no server secrets", () => {
  const data = createMapExport(finishedState(), new Date("2026-10-21T12:00:00.000Z"));
  assert.equal(data.format, MAP_EXPORT_FORMAT);
  assert.equal(data.version, 1);
  assert.deepEqual(data.board, [["X", "", "#"], ["", "O", ""]]);
  assert.deepEqual(data.settings, {
    width: 3, height: 2, piecesPerTurn: 1, clockMinutes: 5, incrementSeconds: 2,
    unlimitedTime: false, randomEvents: true, wormholesEnabled: true,
    freeStartingPositions: true, disabledItems: ["bomb"]
  });
  assert.deepEqual(data.items, [{ type: "bomb", row: 0, col: 1 }]);
  assert.deepEqual(data.inventory, { X: [{ type: "shield" }], O: [{ type: "exchange" }] });
  assert.equal(data.shields.length, 2);
  assert.deepEqual(data.wormholes.endpoints.orange, { row: 0, col: 2 });
  assert.equal(data.wormholes.roundsRemaining, 4);
  const serialized = JSON.stringify(data);
  for (const secret of ["token-not-for-export", "ABCDEFGH", "adminSecret", "playerRoles", "startChoices", "secret-inventory-key"]) {
    assert.equal(serialized.includes(secret), false, `export leaked ${secret}`);
  }
});

test("JSON download clicks a generated file link with the serialized map", async () => {
  let downloadedBlob;
  let clicked = false;
  let revoked;
  const link = { style: {}, click() { clicked = true; }, remove() {} };
  const documentRef = { body: { appendChild() {} }, createElement(tag) { assert.equal(tag, "a"); return link; } };
  const URLRef = { createObjectURL(blob) { downloadedBlob = blob; return "blob:map"; }, revokeObjectURL(url) { revoked = url; } };
  let revokeLater;
  downloadMapJson(finishedState(), {
    documentRef, URLRef, now: new Date("2026-10-21T12:00:00.000Z"),
    setTimeoutRef(callback) { revokeLater = callback; }
  });
  assert.equal(clicked, true);
  assert.match(link.download, /\.json$/);
  assert.equal(JSON.parse(await downloadedBlob.text()).format, MAP_EXPORT_FORMAT);
  revokeLater();
  assert.equal(revoked, "blob:map");
});

test("PNG export draws the board incrementally and downloads an image/png blob", async () => {
  const state = finishedState();
  state.board = Array.from({ length: 12 }, () => Array(3).fill(""));
  let clicked = false;
  let mime;
  let yielded = 0;
  const context = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === "roundRect" || key === "rect" || key === "beginPath" || key === "fill" || key === "stroke" || key === "fillRect"
      || key === "arc" || key === "fillText" || key === "drawImage") return () => {};
    return target[key];
  }, set(target, key, value) { target[key] = value; return true; } });
  const canvas = {
    getContext(kind) { assert.equal(kind, "2d"); return context; },
    toBlob(callback, type) { mime = type; callback(new Blob(["png"] , { type })); }
  };
  const link = { style: {}, click() { clicked = true; }, remove() {} };
  const documentRef = { body: { appendChild() {} }, createElement(tag) { return tag === "canvas" ? canvas : link; } };
  await downloadBoardPng(state, {
    documentRef,
    URLRef: { createObjectURL(blob) { assert.equal(blob.type, "image/png"); return "blob:image"; }, revokeObjectURL() {} },
    ImageCtor: null,
    yieldControl: async () => { yielded += 1; },
    setTimeoutRef() {}
  });
  assert.equal(canvas.width, 48 + 3 * 42 + 2 * 3 + 32);
  assert.equal(canvas.height, 48 + 12 * 42 + 11 * 3 + 32);
  assert.equal(mime, "image/png");
  assert.equal(clicked, true);
  assert.equal(link.download.endsWith(".png"), true);
  assert.equal(yielded, 2, "render yields between batches of five rows");
});

test("exports are unavailable before a game is finished", () => {
  const state = finishedState();
  state.phase = "playing";
  assert.throws(() => createMapExport(state), /export-unavailable/);
});
