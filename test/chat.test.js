import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_HISTORY_LIMIT,
  CHAT_STICKERS,
  CHAT_TEXT_MAX_CODE_POINTS,
  ChatValidationError,
  extractBoardCoordinates,
  formatBoardCoordinate,
  normalizeChatPayload,
  parseBoardCoordinate,
  trimStoredChatHistory,
} from "../src/multiplayer/chat.js";

test("Go coordinates skip I and round-trip on supported board sizes", () => {
  assert.equal(formatBoardCoordinate(8, 0, 9), "A1");
  assert.equal(formatBoardCoordinate(0, 8, 9), "J9");
  assert.equal(formatBoardCoordinate(0, 12, 13), "N13");
  assert.equal(formatBoardCoordinate(0, 18, 19), "T19");
  assert.equal(formatBoardCoordinate(0, 24, 25), "Z25");
  assert.deepEqual(parseBoardCoordinate("k10", 19), {
    row: 9,
    col: 9,
    label: "K10",
  });
  for (const invalid of ["I9", "A0", "A20", "T20", "AA1"]) {
    assert.equal(parseBoardCoordinate(invalid, 19), null);
  }
});

test("text chat remains uncensored while legal coordinates become references", () => {
  const text = "你好 <script>alert('x')</script> 👨‍👩‍👧‍👦，看看 d4 和 T19";
  const normalized = normalizeChatPayload(
    { kind: "text", text },
    { size: 19, topology: "torus" },
  );
  assert.equal(normalized.text, text);
  assert.deepEqual(normalized.points, [
    { row: 15, col: 3, label: "D4" },
    { row: 0, col: 18, label: "T19" },
  ]);
  assert.deepEqual(extractBoardCoordinates("D4、D4、K10", 19), [
    { row: 15, col: 3, label: "D4" },
    { row: 9, col: 9, label: "K10" },
  ]);
  assert.deepEqual(extractBoardCoordinates("看D4这里，但 BAD4 和 D4A 不是坐标", 19), [
    { row: 15, col: 3, label: "D4" },
  ]);
  const mobius = normalizeChatPayload(
    { kind: "text", text: "看 D4" },
    { size: 19, topology: "mobius" },
  );
  assert.equal(mobius.boardTopology, "mobius");
  assert.deepEqual(mobius.points, [{ row: 15, col: 3, label: "D4" }]);
});

test("chat applies only structural limits and a fixed sticker id catalog", () => {
  assert.throws(
    () =>
      normalizeChatPayload(
        { kind: "text", text: "x".repeat(CHAT_TEXT_MAX_CODE_POINTS + 1) },
        { size: 9, topology: "cylinder" },
      ),
    (error) =>
      error instanceof ChatValidationError && error.code === "CHAT_TOO_LONG",
  );
  assert.throws(
    () =>
      normalizeChatPayload(
        { kind: "sticker", stickerId: "javascript:alert(1)" },
        { size: 9, topology: "cylinder" },
      ),
    (error) =>
      error instanceof ChatValidationError && error.code === "UNKNOWN_STICKER",
  );
  assert.equal(
    normalizeChatPayload(
      { kind: "sticker", stickerId: CHAT_STICKERS[0].id },
      { size: 9, topology: "cylinder" },
    ).stickerId,
    CHAT_STICKERS[0].id,
  );
});

test("persisted chat history is validated, bounded, and defensively copied", () => {
  const messages = Array.from({ length: CHAT_HISTORY_LIMIT + 2 }, (_, index) => ({
    id: `black:${index + 1}`,
    sequence: index + 1,
    senderId: "black",
    senderName: "黑方",
    senderRole: "player",
    senderColor: "black",
    kind: "sticker",
    stickerId: CHAT_STICKERS[0].id,
    points: [],
    boardSize: 9,
    boardTopology: "cylinder",
    moveCount: 0,
    sentAt: index + 1,
  }));
  const trimmed = trimStoredChatHistory(messages);
  assert.equal(trimmed.length, CHAT_HISTORY_LIMIT);
  assert.equal(trimmed[0].sequence, 3);
  messages.at(-1).stickerId = "unknown";
  assert.equal(trimmed.at(-1).stickerId, CHAT_STICKERS[0].id);
});
