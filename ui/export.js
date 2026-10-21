import { EVENT_ITEMS } from "./game.js?v=game-history1";

export const MAP_EXPORT_FORMAT = "viruses-infection-strategy-map";
export const MAP_EXPORT_VERSION = 1;

const SETTINGS_FIELDS = [
  "width", "height", "piecesPerTurn", "clockMinutes", "incrementSeconds",
  "unlimitedTime", "randomEvents", "wormholesEnabled", "freeStartingPositions", "disabledItems"
];
const FALLBACK_GLYPHS = Object.freeze({
  bomb: "B", freePlacement: "↗", extraTurn: "+1", antiBomb: "A", pointDestroy: "◎",
  debris: "×3", shield: "1", gangstaShield: "∞", randomArtifact: "?", exchange: "⇄"
});
const BOARD_COLORS = Object.freeze({
  background: "#10191c", frame: "#243438", empty: "#1a292c", blocked: "#293638",
  x: "#c6f36b", o: "#ff947f", border: "rgba(176,205,190,.22)", text: "#eff7f3",
  muted: "#829796", shield: "#7df0ce", permanentShield: "#c6a2ff",
  wormholeOrange: "#ff9c42", wormholeBlue: "#46c9ff"
});

function assertFinishedState(state) {
  if (!state || state.phase !== "finished" || !Array.isArray(state.board) || !state.board.length
    || !state.board.every((row) => Array.isArray(row) && row.length === state.board[0].length)) {
    throw new Error("export-unavailable");
  }
}

function safeSettings(settings = {}, width, height) {
  const result = {};
  for (const field of SETTINGS_FIELDS) {
    if (field === "width") result.width = width;
    else if (field === "height") result.height = height;
    else if (field === "disabledItems") {
      result.disabledItems = Array.isArray(settings.disabledItems)
        ? [...new Set(settings.disabledItems.filter((item) => EVENT_ITEMS.includes(item)))].sort()
        : [];
    } else {
      const value = settings[field];
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) result[field] = value;
    }
  }
  return result;
}

export function createMapExport(state, exportedAt = new Date()) {
  assertFinishedState(state);
  const height = state.board.length;
  const width = state.board[0].length;
  const safeInventory = (side) => (Array.isArray(state.inventory?.[side]) ? state.inventory[side] : [])
    .filter((item) => EVENT_ITEMS.includes(item?.type))
    .map(({ type }) => ({ type }));
  const endpoints = state.wormholePair?.endpoints;
  const wormholes = endpoints?.orange && endpoints?.blue
    ? {
      endpoints: {
        orange: { row: endpoints.orange.row, col: endpoints.orange.col },
        blue: { row: endpoints.blue.row, col: endpoints.blue.col }
      },
      roundsRemaining: Number.isInteger(state.wormholePair.roundsRemaining) ? state.wormholePair.roundsRemaining : 0
    }
    : null;

  return {
    format: MAP_EXPORT_FORMAT,
    version: MAP_EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    settings: safeSettings(state.settings, width, height),
    result: { winner: state.winner === "X" || state.winner === "O" ? state.winner : null },
    roundNumber: Number.isInteger(state.roundNumber) ? state.roundNumber : null,
    turnNumber: Number.isInteger(state.turnNumber) ? state.turnNumber : null,
    board: state.board.map((row) => row.slice()),
    items: (Array.isArray(state.eventItems) ? state.eventItems : [])
      .filter((item) => EVENT_ITEMS.includes(item?.type))
      .map(({ type, row, col }) => ({ type, row, col })),
    inventory: { X: safeInventory("X"), O: safeInventory("O") },
    shields: (Array.isArray(state.protections) ? state.protections : [])
      .filter(({ row, col }) => Number.isInteger(row) && Number.isInteger(col))
      .map(({ row, col, permanent, owner }) => ({
        row, col, permanent: Boolean(permanent), ...(owner === "X" || owner === "O" ? { owner } : {})
      })),
    wormholes
  };
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(x, y, width, height, radius);
  else context.rect(x, y, width, height);
}

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function loadImage(src, ImageCtor) {
  if (!src || typeof ImageCtor !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new ImageCtor();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawItemFallback(context, type, x, y, size) {
  context.fillStyle = "#eaf7ed";
  context.font = `800 ${Math.max(10, size * .43)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(FALLBACK_GLYPHS[type] || "?", x + size / 2, y + size / 2);
}

export async function renderBoardCanvas(state, {
  documentRef = globalThis.document,
  ImageCtor = globalThis.Image,
  itemIconUrl = () => null,
  shieldIconUrl = () => null,
  yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0))
} = {}) {
  assertFinishedState(state);
  if (!documentRef?.createElement) throw new Error("export-unavailable");
  const height = state.board.length;
  const width = state.board[0].length;
  const cellSize = 42;
  const gap = 3;
  const left = 48;
  const top = 48;
  const padding = 16;
  const boardWidth = width * cellSize + (width - 1) * gap;
  const boardHeight = height * cellSize + (height - 1) * gap;
  const canvas = documentRef.createElement("canvas");
  canvas.width = left + boardWidth + padding * 2;
  canvas.height = top + boardHeight + padding * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("export-unavailable");

  const itemTypes = [...new Set((state.eventItems || []).map(({ type }) => type).filter((type) => EVENT_ITEMS.includes(type)))];
  const shieldKinds = [...new Set((state.protections || []).map(({ permanent }) => Boolean(permanent)))];
  const imageLoads = [
    ...itemTypes.map(async (type) => ["item", type, await loadImage(itemIconUrl(type), ImageCtor)]),
    ...shieldKinds.map(async (permanent) => ["shield", String(permanent), await loadImage(shieldIconUrl(permanent), ImageCtor)])
  ];
  const images = new Map((await Promise.all(imageLoads)).map(([kind, key, image]) => [`${kind}:${key}`, image]));

  context.fillStyle = BOARD_COLORS.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = BOARD_COLORS.frame;
  roundedRect(context, left - 8, top - 8, boardWidth + 16, boardHeight + 16, 12);
  context.fill();
  context.font = "700 11px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = BOARD_COLORS.muted;
  for (let col = 0; col < width; col += 1) {
    context.fillText(columnLabel(col), left + col * (cellSize + gap) + cellSize / 2, top - 25);
  }
  for (let row = 0; row < height; row += 1) {
    context.fillText(String(row + 1), left - 27, top + row * (cellSize + gap) + cellSize / 2);
  }

  const itemAt = new Map((state.eventItems || []).map((item) => [`${item.row},${item.col}`, item]));
  const shieldAt = new Map((state.protections || []).map((shield) => [`${shield.row},${shield.col}`, shield]));
  const endpoints = state.wormholePair?.endpoints;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const x = left + col * (cellSize + gap);
      const y = top + row * (cellSize + gap);
      const value = state.board[row][col];
      const wormholeColor = endpoints?.orange?.row === row && endpoints.orange.col === col
        ? BOARD_COLORS.wormholeOrange
        : endpoints?.blue?.row === row && endpoints.blue.col === col
          ? BOARD_COLORS.wormholeBlue
          : null;
      context.fillStyle = value === "X" ? BOARD_COLORS.x : value === "O" ? BOARD_COLORS.o
        : value === "#" ? BOARD_COLORS.blocked : wormholeColor ? "#111d22" : BOARD_COLORS.empty;
      roundedRect(context, x, y, cellSize, cellSize, 4);
      context.fill();
      context.strokeStyle = wormholeColor || BOARD_COLORS.border;
      context.lineWidth = wormholeColor ? 2 : 1;
      context.stroke();

      if (value === "X" || value === "O") {
        context.fillStyle = value === "X" ? "#172012" : "#301916";
        context.font = `850 ${cellSize * .56}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(value, x + cellSize / 2, y + cellSize / 2 + 1);
      } else if (value === "#") {
        context.fillStyle = "#83918e";
        context.font = `800 ${cellSize * .52}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("×", x + cellSize / 2, y + cellSize / 2);
      }

      if (wormholeColor) {
        context.beginPath();
        context.arc(x + cellSize / 2, y + cellSize / 2, cellSize * .29, 0, Math.PI * 2);
        context.strokeStyle = wormholeColor;
        context.lineWidth = 3;
        context.stroke();
        context.beginPath();
        context.arc(x + cellSize / 2, y + cellSize / 2, cellSize * .12, 0, Math.PI * 2);
        context.fillStyle = wormholeColor;
        context.fill();
        context.fillStyle = BOARD_COLORS.text;
        context.font = "800 10px system-ui, sans-serif";
        context.textAlign = "right";
        context.textBaseline = "bottom";
        context.fillText(String(state.wormholePair.roundsRemaining), x + cellSize - 3, y + cellSize - 2);
      }

      const item = itemAt.get(`${row},${col}`);
      if (item) {
        const image = images.get(`item:${item.type}`);
        if (image) context.drawImage(image, x + cellSize * .18, y + cellSize * .18, cellSize * .64, cellSize * .64);
        else drawItemFallback(context, item.type, x, y, cellSize);
      }
      const shield = shieldAt.get(`${row},${col}`);
      if (shield) {
        const color = shield.permanent ? BOARD_COLORS.permanentShield : BOARD_COLORS.shield;
        context.strokeStyle = color;
        context.lineWidth = 2.5;
        roundedRect(context, x + 2, y + 2, cellSize - 4, cellSize - 4, 4);
        context.stroke();
        const shieldImage = images.get(`shield:${String(Boolean(shield.permanent))}`);
        if (shieldImage) {
          context.drawImage(shieldImage, x + cellSize * .14, y + cellSize * .14, cellSize * .72, cellSize * .72);
        } else {
          context.fillStyle = color;
          context.font = "900 18px system-ui, sans-serif";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(shield.permanent ? "∞" : "1", x + cellSize / 2, y + cellSize / 2);
        }
      }
    }
    if ((row + 1) % 5 === 0) await yieldControl();
  }
  return canvas;
}

function makeDownload(filename, blob, { documentRef, URLRef, setTimeoutRef }) {
  if (!documentRef?.createElement || !URLRef?.createObjectURL) throw new Error("export-download-failed");
  const url = URLRef.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  documentRef.body?.appendChild(link);
  link.click();
  link.remove?.();
  (setTimeoutRef || globalThis.setTimeout)(() => URLRef.revokeObjectURL?.(url), 1000);
}

function timestampName(extension, now = new Date()) {
  return `viruses-map-${now.toISOString().replace(/[:.]/g, "-")}.${extension}`;
}

export function downloadMapJson(state, {
  documentRef = globalThis.document,
  URLRef = globalThis.URL,
  BlobCtor = globalThis.Blob,
  now = new Date(),
  setTimeoutRef
} = {}) {
  const data = createMapExport(state, now);
  makeDownload(timestampName("json", now), new BlobCtor([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), {
    documentRef, URLRef, setTimeoutRef
  });
}

export async function downloadBoardPng(state, {
  documentRef = globalThis.document,
  URLRef = globalThis.URL,
  BlobCtor = globalThis.Blob,
  ImageCtor = globalThis.Image,
  itemIconUrl,
  shieldIconUrl,
  yieldControl,
  now = new Date(),
  setTimeoutRef
} = {}) {
  const canvas = await renderBoardCanvas(state, { documentRef, ImageCtor, itemIconUrl, shieldIconUrl, yieldControl });
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("export-png-failed")), "image/png");
    } catch {
      reject(new Error("export-png-failed"));
    }
  });
  makeDownload(timestampName("png", now), blob, { documentRef, URLRef, setTimeoutRef });
}
