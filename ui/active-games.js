const SPAWN_MODES = new Set(["standard", "cascade", "adaptive", "hybrid"]);

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function translated(t, key) {
  const value = t(key);
  return value === key ? null : value;
}

function setting(groups, groupKey, labelKey, value) {
  if (value === null || value === undefined || value === "") return;
  groups[groupKey].push({ labelKey, value: String(value) });
}

export function buildActiveRoomView(room, t) {
  const settings = room?.settings && typeof room.settings === "object" ? room.settings : {};
  const groups = { field: [], time: [], rules: [], state: [] };
  const width = finiteNumber(settings.width) ? settings.width : null;
  const height = finiteNumber(settings.height) ? settings.height : null;
  const board = width !== null && height !== null ? `${width}×${height}` : translated(t, "activeGames.unknown");
  const statusKey = room?.status === "waiting" ? "activeGames.waiting"
    : room?.status === "active" ? "activeGames.inProgress" : "activeGames.unknown";
  const status = translated(t, statusKey) || translated(t, "activeGames.unknown");
  const visibilityKey = room?.visibility === "public" ? "activeGames.public"
    : room?.visibility === "private" ? "activeGames.private" : "activeGames.unknown";
  const visibility = translated(t, visibilityKey) || translated(t, "activeGames.unknown");
  const players = Number.isInteger(room?.players) && Number.isInteger(room?.maxPlayers)
    ? `${room.players}/${room.maxPlayers}` : translated(t, "activeGames.unknown");
  const roomId = typeof room?.id === "string" ? room.id.slice(0, 8).toUpperCase() : translated(t, "activeGames.unknown");
  const time = settings.unlimitedTime === true ? translated(t, "clock.unlimited")
    : finiteNumber(settings.clockMinutes) && finiteNumber(settings.incrementSeconds)
      ? `${settings.clockMinutes}+${settings.incrementSeconds}` : translated(t, "activeGames.unknown");
  const modeBoard = `${board}${finiteNumber(settings.piecesPerTurn)
    ? ` · ${t("activeGames.detail.piecesShort", { count: settings.piecesPerTurn })}` : ""}`;

  setting(groups, "field", "activeGames.detail.board", width !== null && height !== null ? board : null);
  setting(groups, "field", "activeGames.detail.pieces", finiteNumber(settings.piecesPerTurn)
    ? t("activeGames.detail.piecesValue", { count: settings.piecesPerTurn }) : null);
  if (typeof settings.freeStartingPositions === "boolean") {
    setting(groups, "field", "activeGames.detail.startingPositions", t(settings.freeStartingPositions
      ? "activeGames.detail.freeStart" : "activeGames.detail.fixedStart"));
  }

  if (settings.unlimitedTime === true) {
    setting(groups, "time", "activeGames.detail.timeControl", t("clock.unlimited"));
  } else if (finiteNumber(settings.clockMinutes) && finiteNumber(settings.incrementSeconds)) {
    setting(groups, "time", "activeGames.detail.timeControl", t("activeGames.detail.timeValue", {
      minutes: settings.clockMinutes,
      seconds: settings.incrementSeconds
    }));
  }

  if (typeof settings.randomEvents === "boolean") {
    setting(groups, "rules", "activeGames.detail.randomEvents", t(settings.randomEvents ? "activeGames.enabled" : "activeGames.disabled"));
  }
  if (typeof settings.itemSpawnMode === "string" && SPAWN_MODES.has(settings.itemSpawnMode)) {
    setting(groups, "rules", "activeGames.detail.spawnMode", t(`settings.spawnMode.${settings.itemSpawnMode}`));
  }
  if (Array.isArray(settings.disabledItems)) {
    const disabledNames = settings.disabledItems
      .filter((type) => typeof type === "string")
      .map((type) => translated(t, `item.${type}`))
      .filter(Boolean);
    setting(groups, "rules", "activeGames.detail.disabledItems", disabledNames.length
      ? disabledNames.join(", ") : t("activeGames.detail.noneDisabled"));
    setting(groups, "rules", "activeGames.detail.freePlacement", t(settings.disabledItems.includes("freePlacement")
      ? "activeGames.disabled" : "activeGames.enabled"));
  }
  if (typeof settings.wormholesEnabled === "boolean") {
    setting(groups, "rules", "activeGames.detail.wormholes", t(settings.wormholesEnabled ? "activeGames.enabled" : "activeGames.disabled"));
  }
  if (typeof settings.unlimitedItemLifetime === "boolean") {
    const lifetime = settings.unlimitedItemLifetime === true ? t("settings.itemsUnlimited")
      : finiteNumber(settings.itemLifetimeTurns)
        ? t("activeGames.detail.itemLifetimeValue", { count: settings.itemLifetimeTurns }) : null;
    setting(groups, "rules", "activeGames.detail.itemLifetime", lifetime);
  }
  if (typeof settings.animationsEnabled === "boolean") {
    setting(groups, "rules", "activeGames.detail.animations", t(settings.animationsEnabled ? "activeGames.enabled" : "activeGames.disabled"));
  }

  if (status) setting(groups, "state", "activeGames.detail.status", status);
  if (players) setting(groups, "state", "activeGames.detail.players", players);
  if (Number.isInteger(room?.observers)) {
    setting(groups, "state", "activeGames.detail.observers", String(room.observers));
  }
  if (visibility) setting(groups, "state", "activeGames.detail.access", visibility);
  if (Number.isInteger(room?.maxPlayers) && Number.isInteger(room?.players)) {
    setting(groups, "state", "activeGames.detail.openSeats", String(Math.max(0, room.maxPlayers - room.players)));
  }

  return {
    id: typeof room?.id === "string" ? room.id : "",
    roomId,
    status,
    players,
    observerCount: Number.isInteger(room?.observers) ? room.observers : null,
    board,
    modeBoard,
    time,
    visibility,
    isWaiting: room?.status === "waiting",
    actionKey: room?.visibility !== "public" ? "manage" : room?.status === "waiting" ? "join" : "observe",
    groups
  };
}
