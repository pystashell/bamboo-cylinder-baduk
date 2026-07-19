export const COORDINATE_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export const CHAT_TEXT_MAX_CODE_POINTS = 300;
export const CHAT_TEXT_MAX_BYTES = 1_500;
export const CHAT_TEXT_MAX_LINES = 4;
export const CHAT_POINT_LIMIT = 4;
export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_HISTORY_MAX_BYTES = 64 * 1024;

export const CHAT_STICKERS = Object.freeze([
  Object.freeze({ id: "good-move", emoji: "👏", label: "好棋！" }),
  Object.freeze({ id: "thinking", emoji: "🤔", label: "让我想想" }),
  Object.freeze({ id: "surprised", emoji: "😲", label: "居然下这里" }),
  Object.freeze({ id: "laugh", emoji: "😂", label: "笑死" }),
  Object.freeze({ id: "respect", emoji: "🤝", label: "承让" }),
  Object.freeze({ id: "tea", emoji: "🍵", label: "喝口茶" }),
  Object.freeze({ id: "bamboo", emoji: "🎋", label: "竹筒之力" }),
  Object.freeze({ id: "donut", emoji: "🍩", label: "甜甜圈时间" }),
]);

const CHAT_STICKER_IDS = new Set(CHAT_STICKERS.map(({ id }) => id));
const VALID_TOPOLOGIES = new Set(["cylinder", "torus", "mobius"]);
const textEncoder = new TextEncoder();

export class ChatValidationError extends Error {
  constructor(message, code = "INVALID_CHAT") {
    super(message);
    this.name = "ChatValidationError";
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoardSize(value) {
  return Number.isInteger(value) && value >= 3 && value <= 25;
}

function normalizedTopology(value) {
  return VALID_TOPOLOGIES.has(value) ? value : "cylinder";
}

export function formatBoardCoordinate(row, col, size) {
  if (
    !isBoardSize(size) ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= size ||
    col < 0 ||
    col >= size
  ) {
    return "";
  }
  const letter = COORDINATE_LETTERS[col];
  return letter ? `${letter}${size - row}` : "";
}

export function parseBoardCoordinate(value, size) {
  if (!isBoardSize(size) || typeof value !== "string") return null;
  const match = value.trim().toUpperCase().match(/^([A-HJ-Z])\s*(\d{1,2})$/u);
  if (!match) return null;
  const col = COORDINATE_LETTERS.indexOf(match[1]);
  const number = Number(match[2]);
  if (col < 0 || col >= size || number < 1 || number > size) return null;
  const row = size - number;
  return { row, col, label: formatBoardCoordinate(row, col, size) };
}

export function extractBoardCoordinates(text, size, limit = CHAT_POINT_LIMIT) {
  if (typeof text !== "string" || !isBoardSize(size) || limit < 1) return [];
  const points = [];
  const seen = new Set();
  // Chinese prose commonly attaches a coordinate directly to surrounding
  // characters ("看D4这里"). Only block ASCII word/number prefixes so
  // ordinary Latin tokens such as "BAD4" are not mistaken for board points.
  const pattern = /(^|[^A-Z0-9])([A-HJ-Z]\s*\d{1,2})(?![A-Z0-9])/giu;
  for (const match of text.matchAll(pattern)) {
    const point = parseBoardCoordinate(match[2], size);
    if (!point) continue;
    const key = `${point.row},${point.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
    if (points.length >= limit) break;
  }
  return points;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    throw new ChatValidationError("聊天内容格式不正确。");
  }
  const text = value.replace(/\r\n?/gu, "\n").trim();
  if (!text) throw new ChatValidationError("请输入聊天内容。", "EMPTY_CHAT");
  if ([...text].length > CHAT_TEXT_MAX_CODE_POINTS) {
    throw new ChatValidationError(
      `聊天内容最多 ${CHAT_TEXT_MAX_CODE_POINTS} 个字符。`,
      "CHAT_TOO_LONG",
    );
  }
  if (textEncoder.encode(text).byteLength > CHAT_TEXT_MAX_BYTES) {
    throw new ChatValidationError(
      "这条消息包含的字符过大，请缩短后再发送。",
      "CHAT_TOO_LARGE",
    );
  }
  if (text.split("\n").length > CHAT_TEXT_MAX_LINES) {
    throw new ChatValidationError(
      `聊天内容最多 ${CHAT_TEXT_MAX_LINES} 行。`,
      "CHAT_TOO_MANY_LINES",
    );
  }
  return text;
}

export function normalizeChatPayload(payload, board) {
  if (!isRecord(payload) || !isBoardSize(board?.size)) {
    throw new ChatValidationError("聊天消息格式不正确。");
  }
  const topology = normalizedTopology(board.topology);
  const kind = payload.kind === "sticker" ? "sticker" : "text";

  if (kind === "sticker") {
    if (typeof payload.stickerId !== "string" || !CHAT_STICKER_IDS.has(payload.stickerId)) {
      throw new ChatValidationError("这个表情包不存在。", "UNKNOWN_STICKER");
    }
    return {
      kind,
      stickerId: payload.stickerId,
      points: [],
      boardSize: board.size,
      boardTopology: topology,
    };
  }

  const text = normalizeText(payload.text);
  return {
    kind,
    text,
    points: extractBoardCoordinates(text, board.size),
    boardSize: board.size,
    boardTopology: topology,
  };
}

export function chatSticker(stickerId) {
  return CHAT_STICKERS.find(({ id }) => id === stickerId) ?? null;
}

export function isStoredChatMessage(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 300 ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.senderId !== "string" ||
    !value.senderId ||
    typeof value.senderName !== "string" ||
    !value.senderName ||
    value.senderName.length > 80 ||
    value.senderRole !== "player" ||
    !["black", "white"].includes(value.senderColor) ||
    !Number.isFinite(value.sentAt) ||
    !isBoardSize(value.boardSize) ||
    !VALID_TOPOLOGIES.has(value.boardTopology) ||
    !Number.isSafeInteger(value.moveCount) ||
    value.moveCount < 0 ||
    !Array.isArray(value.points) ||
    value.points.length > CHAT_POINT_LIMIT
  ) {
    return false;
  }
  if (
    value.points.some(
      (point) =>
        !isRecord(point) ||
        formatBoardCoordinate(point.row, point.col, value.boardSize) !== point.label,
    )
  ) {
    return false;
  }
  if (value.kind === "text") {
    try {
      return normalizeText(value.text) === value.text;
    } catch {
      return false;
    }
  }
  return value.kind === "sticker" && CHAT_STICKER_IDS.has(value.stickerId);
}

export function trimStoredChatHistory(messages) {
  const history = Array.isArray(messages)
    ? messages
        .filter(isStoredChatMessage)
        .slice(-CHAT_HISTORY_LIMIT)
        .map((message) => JSON.parse(JSON.stringify(message)))
    : [];
  while (
    history.length > 0 &&
    textEncoder.encode(JSON.stringify(history)).byteLength > CHAT_HISTORY_MAX_BYTES
  ) {
    history.shift();
  }
  return history;
}
