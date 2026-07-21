export const LOBBY_STATUS_SETUP = "setup";
export const LOBBY_STATUS_INVITED = "invited";
export const LOBBY_STATUS_PLAYING = "playing";
export const LOBBY_STATUS_FINISHED = "finished";

export const LOBBY_MATCH_MODES = Object.freeze([
  "friend",
  "human-ai",
  "ai-ai",
  "local",
]);

export const LOBBY_ENTRY_TTL_MS = 25 * 60 * 60 * 1_000;
export const MAX_LOBBY_ROOMS = 500;

const VALID_STATUSES = new Set([
  LOBBY_STATUS_SETUP,
  LOBBY_STATUS_INVITED,
  LOBBY_STATUS_PLAYING,
  LOBBY_STATUS_FINISHED,
]);
const VALID_MODES = new Set(LOBBY_MATCH_MODES);

function finiteTimestamp(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function publicPlayer(player) {
  return {
    name: String(player?.name ?? "").slice(0, 20),
    color: player?.color === "white" ? "white" : "black",
    controller: player?.controller === "ai" || player?.automated === true || player?.role === "ai"
      ? "ai"
      : player?.controller === "local"
        ? "local"
        : "human",
    online: player?.online !== false,
  };
}

function humanRoomPlayer(room, operatorId) {
  const players = room?.players ?? [];
  return typeof operatorId === "string" && operatorId
    ? players.find((player) =>
        player?.id === operatorId &&
        player?.automated !== true &&
        player?.role !== "ai"
      ) ?? null
    : null;
}

function controllerPlayer(room, color, value, mode) {
  if (!value || (value.kind !== "human" && value.kind !== "ai")) return null;
  const operator = humanRoomPlayer(room, value.operatorId);
  if (value.kind === "ai") {
    const modelId = typeof value.modelId === "string" && value.modelId
      ? value.modelId.slice(0, 16)
      : "b10";
    return {
      name: `KataGo ${modelId} AI`,
      color,
      controller: "ai",
      online: operator?.online === true,
    };
  }
  if (!operator) return null;
  return {
    name: String(operator.name ?? "").slice(0, 20),
    color,
    controller: mode === "local" ? "local" : "human",
    online: operator.online !== false,
  };
}

function matchControllers(match, status) {
  if (
    status === LOBBY_STATUS_INVITED &&
    match?.request?.controllers &&
    typeof match.request.controllers === "object"
  ) {
    return match.request.controllers;
  }
  return match?.controllers && typeof match.controllers === "object"
    ? match.controllers
    : null;
}

function playersFromControllers(room, controllers, mode) {
  if (!controllers) return null;
  return ["black", "white"]
    .map((color) => controllerPlayer(room, color, controllers[color], mode))
    .filter(Boolean);
}

function hasHumanWhiteController(room, controllers) {
  const white = controllers?.white;
  return Boolean(
    white?.kind === "human" &&
    humanRoomPlayer(room, white.operatorId),
  );
}

function fallbackStatus(room) {
  if (room?.game?.phase === "finished" || room?.timeControl?.outcome) {
    return LOBBY_STATUS_FINISHED;
  }
  const colors = new Set((room?.players ?? []).map((player) => player?.color));
  return colors.has("black") && colors.has("white")
    ? LOBBY_STATUS_PLAYING
    : LOBBY_STATUS_SETUP;
}

function fallbackMode(room) {
  const players = room?.players ?? [];
  const automated = players.filter((player) =>
    player?.automated === true || player?.role === "ai" || player?.controller === "ai"
  );
  if (automated.length >= 2) return "ai-ai";
  if (automated.length === 1) return "human-ai";
  return "friend";
}

export function lobbySummaryFromRoom(room, now = Date.now()) {
  if (
    !room ||
    typeof room !== "object" ||
    typeof room.code !== "string" ||
    !room.game ||
    typeof room.game !== "object" ||
    !Array.isArray(room.players)
  ) {
    throw new TypeError("A public room snapshot is required.");
  }
  const match = room.match && typeof room.match === "object" ? room.match : {};
  const status = VALID_STATUSES.has(match.status)
    ? match.status
    : fallbackStatus(room);
  const requestedMode = status === LOBBY_STATUS_INVITED
    ? match.request?.mode
    : null;
  const mode = VALID_MODES.has(requestedMode)
    ? requestedMode
    : VALID_MODES.has(match.mode)
      ? match.mode
      : fallbackMode(room);
  const controllers = matchControllers(match, status);
  const width = Number.isInteger(room.game?.width)
    ? room.game.width
    : Number.isInteger(room.game?.size)
      ? room.game.size
      : 19;
  const height = Number.isInteger(room.game?.height)
    ? room.game.height
    : Number.isInteger(room.game?.size)
      ? room.game.size
      : 19;
  const players = playersFromControllers(room, controllers, mode) ??
    (room.players ?? []).slice(0, 2).map(publicPlayer);
  const hasRemoteWhite = controllers
    ? hasHumanWhiteController(room, controllers)
    : players.some((player) =>
        player.color === "white" && player.controller === "human"
      );
  const updatedAt = finiteTimestamp(room.updatedAt, now);

  return {
    code: room.code,
    status,
    mode,
    roundNumber: Number.isSafeInteger(match.roundId)
      ? match.roundId
      : Number.isSafeInteger(match.roundNumber)
      ? match.roundNumber
        : Number.isSafeInteger(room.roundNumber)
          ? room.roundNumber
          : status === LOBBY_STATUS_SETUP ? 0 : 1,
    width,
    height,
    topology: ["cylinder", "torus", "mobius"].includes(room.game?.topology)
      ? room.game.topology
      : "cylinder",
    scoringRule: room.game?.scoringRule === "japanese" ? "japanese" : "chinese",
    komi: Number.isFinite(room.game?.komi) ? room.game.komi : 7.5,
    timed: Boolean(room.timeControl),
    moveCount: Number.isSafeInteger(room.moveCount) ? room.moveCount : 0,
    players,
    spectatorCount: (room.spectators ?? []).filter((spectator) => spectator?.online !== false).length,
    joinable: mode === "friend" &&
      [LOBBY_STATUS_SETUP, LOBBY_STATUS_INVITED].includes(status) &&
      !hasRemoteWhite,
    watchable: status !== LOBBY_STATUS_SETUP || players.length > 0,
    createdAt: finiteTimestamp(room.createdAt, updatedAt),
    updatedAt,
    startedAt: finiteTimestamp(match.startedAt, null),
    finishedAt: finiteTimestamp(match.finishedAt, null),
    expiresAt: finiteTimestamp(room.expiresAt, updatedAt + LOBBY_ENTRY_TTL_MS),
  };
}

export function isLobbySummary(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    VALID_STATUSES.has(value.status) &&
    VALID_MODES.has(value.mode) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    Number.isFinite(value.updatedAt),
  );
}

export function sortLobbyRooms(rooms) {
  const priority = {
    [LOBBY_STATUS_INVITED]: 0,
    [LOBBY_STATUS_SETUP]: 1,
    [LOBBY_STATUS_PLAYING]: 2,
    [LOBBY_STATUS_FINISHED]: 3,
  };
  return [...rooms].sort((left, right) =>
    (priority[left.status] ?? 9) - (priority[right.status] ?? 9) ||
    right.updatedAt - left.updatedAt ||
    left.code.localeCompare(right.code)
  );
}

export function pruneLobbyRooms(rooms, now = Date.now()) {
  return sortLobbyRooms(
    rooms.filter((room) =>
      isLobbySummary(room) &&
      room.expiresAt > now &&
      room.updatedAt + LOBBY_ENTRY_TTL_MS > now
    ),
  ).slice(0, MAX_LOBBY_ROOMS);
}

export function filterLobbyRooms(rooms, filters = {}) {
  return sortLobbyRooms(rooms.filter((room) => {
    if (filters.status && filters.status !== "all" && room.status !== filters.status) return false;
    if (filters.topology && filters.topology !== "all" && room.topology !== filters.topology) return false;
    if (filters.mode && filters.mode !== "all" && room.mode !== filters.mode) return false;
    if (filters.size && filters.size !== "all") {
      if (filters.size === "custom") {
        if ([9, 13, 19].includes(room.width) && room.width === room.height) return false;
      } else {
        const size = Number(filters.size);
        if (room.width !== size || room.height !== size) return false;
      }
    }
    return true;
  }));
}
