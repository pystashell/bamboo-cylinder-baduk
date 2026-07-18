import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCommandMessage,
  ROOM_ACTIONS,
} from "../src/multiplayer/protocol.js";

test("undo room actions pass through the WebSocket command whitelist", () => {
  for (const action of ["request_undo", "respond_undo", "cancel_undo"]) {
    assert.ok(ROOM_ACTIONS.includes(action));
    assert.deepEqual(
      normalizeCommandMessage({
        v: 1,
        type: "command",
        id: `undo-${action}`,
        sequence: 1,
        action,
        payload: action === "respond_undo"
          ? { accept: true, targetMoveCount: 2 }
          : {},
      }),
      {
        id: `undo-${action}`,
        sequence: 1,
        action,
        payload: action === "respond_undo"
          ? { accept: true, targetMoveCount: 2 }
          : {},
      },
    );
  }
});

test("chat is whitelisted and requires a reconnect-safe command sequence", () => {
  assert.ok(ROOM_ACTIONS.includes("chat"));
  assert.deepEqual(
    normalizeCommandMessage({
      v: 1,
      type: "command",
      id: "chat-1",
      sequence: 7,
      action: "chat",
      payload: { kind: "text", text: "D4 这里怎么样？" },
    }),
    {
      id: "chat-1",
      sequence: 7,
      action: "chat",
      payload: { kind: "text", text: "D4 这里怎么样？" },
    },
  );
  assert.equal(
    normalizeCommandMessage({
      v: 1,
      type: "command",
      id: "chat-without-sequence",
      action: "chat",
      payload: { kind: "text", text: "不能重复入库" },
    }),
    null,
  );
});
