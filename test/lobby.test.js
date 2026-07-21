import assert from "node:assert/strict";
import test from "node:test";

import {
  filterLobbyRooms,
  lobbySummaryFromRoom,
  pruneLobbyRooms,
} from "../src/multiplayer/lobby.js";

function room(overrides = {}) {
  return {
    code: "BAM234",
    revision: 4,
    moveCount: 12,
    game: {
      width: 13,
      height: 9,
      topology: "mobius",
      scoringRule: "chinese",
      komi: 7.5,
      phase: "play",
    },
    match: {
      status: "playing",
      mode: "human-ai",
      roundNumber: 2,
      startedAt: 1_500,
      finishedAt: null,
    },
    players: [
      { name: "黑方", color: "black", role: "player", online: true },
      { name: "KataGo", color: "white", role: "ai", automated: true, online: true },
    ],
    spectators: [{ online: true }, { online: false }],
    updatedAt: 2_000,
    expiresAt: 90_000_000,
    ...overrides,
  };
}

test("lobby summaries expose only public room metadata", () => {
  const summary = lobbySummaryFromRoom(room(), 2_100);
  assert.deepEqual(summary, {
    code: "BAM234",
    status: "playing",
    mode: "human-ai",
    roundNumber: 2,
    width: 13,
    height: 9,
    topology: "mobius",
    scoringRule: "chinese",
    komi: 7.5,
    timed: false,
    moveCount: 12,
    players: [
      { name: "黑方", color: "black", controller: "human", online: true },
      { name: "KataGo", color: "white", controller: "ai", online: true },
    ],
    spectatorCount: 1,
    joinable: false,
    watchable: true,
    createdAt: 2_000,
    updatedAt: 2_000,
    startedAt: 1_500,
    finishedAt: null,
    expiresAt: 90_000_000,
  });
  assert.equal("chat" in summary, false);
  assert.equal("positionToken" in summary, false);
});

test("waiting friend rooms are joinable and filters compose", () => {
  const waiting = lobbySummaryFromRoom(room({
    code: "WAIT23",
    moveCount: 0,
    match: { status: "invited", mode: "friend", roundNumber: 0 },
    players: [{ name: "房主", color: "black", role: "player", online: true }],
    game: {
      width: 19,
      height: 19,
      topology: "torus",
      scoringRule: "japanese",
      komi: 6.5,
      phase: "play",
    },
    updatedAt: 3_000,
  }));
  const playing = lobbySummaryFromRoom(room());
  assert.equal(waiting.joinable, true);
  assert.deepEqual(
    filterLobbyRooms([playing, waiting], { status: "invited", topology: "torus", size: "19" })
      .map(({ code }) => code),
    ["WAIT23"],
  );
  assert.deepEqual(
    filterLobbyRooms([playing, waiting], { size: "custom" }).map(({ code }) => code),
    ["BAM234"],
  );
});

test("v2 match controllers derive human, AI, and local seats", () => {
  const basePlayers = [
    { id: "host", name: "Host", color: "black", role: "player", online: true },
  ];
  const humanAI = lobbySummaryFromRoom(room({
    players: basePlayers,
    match: {
      status: "playing",
      mode: "human-ai",
      roundId: 3,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "ai", operatorId: "host", modelId: "b18" },
      },
    },
  }));
  assert.equal(humanAI.roundNumber, 3);
  assert.deepEqual(humanAI.players, [
    { name: "Host", color: "black", controller: "human", online: true },
    { name: "KataGo b18 AI", color: "white", controller: "ai", online: true },
  ]);

  const aiAI = lobbySummaryFromRoom(room({
    players: basePlayers,
    match: {
      status: "playing",
      mode: "ai-ai",
      roundId: 1,
      controllers: {
        black: { kind: "ai", operatorId: "host", modelId: "b10" },
        white: { kind: "ai", operatorId: "host", modelId: "b18" },
      },
    },
  }));
  assert.deepEqual(aiAI.players, [
    { name: "KataGo b10 AI", color: "black", controller: "ai", online: true },
    { name: "KataGo b18 AI", color: "white", controller: "ai", online: true },
  ]);

  const local = lobbySummaryFromRoom(room({
    players: basePlayers,
    match: {
      status: "playing",
      mode: "local",
      roundId: 1,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: "host" },
      },
    },
  }));
  assert.deepEqual(local.players, [
    { name: "Host", color: "black", controller: "local", online: true },
    { name: "Host", color: "white", controller: "local", online: true },
  ]);
});

test("only friend setup or invitation rooms without a real white controller are joinable", () => {
  const players = [
    { id: "host", name: "Host", color: "black", role: "player", online: true },
    { id: "friend", name: "Friend", color: "white", role: "player", online: true },
  ];
  const waiting = lobbySummaryFromRoom(room({
    players,
    match: {
      status: "setup",
      mode: "friend",
      roundId: 0,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: null },
      },
    },
  }));
  assert.equal(waiting.joinable, true, "a player list alone does not occupy a controller seat");

  const invited = lobbySummaryFromRoom(room({
    players,
    match: {
      status: "invited",
      mode: "human-ai",
      roundId: 4,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "ai", operatorId: "host", modelId: "b10" },
      },
      request: {
        mode: "friend",
        controllers: {
          black: { kind: "human", operatorId: "host" },
          white: { kind: "human", operatorId: "friend" },
        },
      },
    },
  }));
  assert.equal(invited.mode, "friend");
  assert.equal(invited.joinable, false);
  assert.deepEqual(invited.players.map(({ name, controller }) => ({ name, controller })), [
    { name: "Host", controller: "human" },
    { name: "Friend", controller: "human" },
  ]);

  const playingWithoutWhite = lobbySummaryFromRoom(room({
    players: players.slice(0, 1),
    match: {
      status: "playing",
      mode: "friend",
      roundId: 1,
      controllers: {
        black: { kind: "human", operatorId: "host" },
        white: { kind: "human", operatorId: null },
      },
    },
  }));
  assert.equal(playingWithoutWhite.joinable, false);
});

test("lobby pruning drops stale rooms and keeps the newest order", () => {
  const current = lobbySummaryFromRoom(room({ code: "CURR23", updatedAt: 10_000, expiresAt: 20_000 }));
  const older = lobbySummaryFromRoom(room({ code: "OLDER2", updatedAt: 8_000, expiresAt: 20_000 }));
  const expired = lobbySummaryFromRoom(room({ code: "OLD234", updatedAt: 1_000, expiresAt: 9_000 }));
  assert.deepEqual(
    pruneLobbyRooms([older, expired, current], 9_500).map(({ code }) => code),
    ["CURR23", "OLDER2"],
  );
});
