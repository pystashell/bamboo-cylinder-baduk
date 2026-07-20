import assert from "node:assert/strict";
import test from "node:test";

import { BadukRoom } from "../worker/BadukRoom.js";

function socketFor(identity) {
  const messages = [];
  return {
    readyState: 1,
    messages,
    deserializeAttachment() {
      return {
        connectionId: "viewer-socket",
        identity,
        connectedAt: 1_000,
      };
    },
    send(raw) {
      messages.push(JSON.parse(raw));
    },
  };
}

test("stale spectator commands persist their rate-limit token before replying", async () => {
  const writes = [];
  const rateLimitCalls = [];
  const identity = {
    playerId: "viewer",
    playerName: "Viewer",
    role: "spectator",
    color: null,
  };
  const socket = socketFor(identity);
  const durableObject = Object.create(BadukRoom.prototype);
  durableObject.ctx = {
    storage: {
      async put(key, value) {
        writes.push({ key, value });
      },
    },
  };
  durableObject.engine = {
    inspectCommand() {
      return { kind: "stale", previousSequence: 7 };
    },
    enforceSpectatorCommandRateLimit(request) {
      rateLimitCalls.push(request);
    },
    serialize() {
      return { persistedRateLimit: true };
    },
    snapshot() {
      return {
        code: "ABC123",
        revision: 9,
        players: [],
        spectators: [],
        game: {},
      };
    },
  };

  await durableObject.handleCommand(socket, { identity }, {
    id: "stale-1",
    sequence: 7,
    action: "sync",
    payload: {},
  });

  assert.deepEqual(rateLimitCalls, [
    { playerId: "viewer", action: "sync" },
  ]);
  assert.deepEqual(writes, [
    { key: "room", value: { persistedRateLimit: true } },
  ]);
  assert.equal(socket.messages[0].type, "error");
  assert.equal(socket.messages[0].code, "STALE_COMMAND");
  assert.equal(socket.messages[1].type, "state");
});

test("stale player commands do not add an unnecessary persistence write", async () => {
  let writes = 0;
  const identity = {
    playerId: "black-player",
    playerName: "Black",
    role: "player",
    color: "black",
  };
  const socket = socketFor(identity);
  const durableObject = Object.create(BadukRoom.prototype);
  durableObject.ctx = {
    storage: {
      async put() {
        writes += 1;
      },
    },
  };
  durableObject.engine = {
    inspectCommand() {
      return { kind: "stale", previousSequence: 3 };
    },
    enforceSpectatorCommandRateLimit() {},
    snapshot() {
      return {
        code: "ABC123",
        revision: 4,
        players: [],
        spectators: [],
        game: {},
      };
    },
  };

  await durableObject.handleCommand(socket, { identity }, {
    id: "stale-player",
    sequence: 3,
    action: "sync",
    payload: {},
  });

  assert.equal(writes, 0);
  assert.equal(socket.messages[0].code, "STALE_COMMAND");
  assert.equal(socket.messages[1].type, "state");
});
