import { RoomClient } from "../src/multiplayer/roomClient.js";
import {
  BADUK_PROTOCOL_VERSION,
  BADUK_WS_PROTOCOL,
} from "../src/multiplayer/protocol.js";

const target = new URL(
  process.argv[2] ?? "http://127.0.0.1:8787/",
).toString();

function waitFor(client, type, predicate, label, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    const unsubscribe = client.on(type, (event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

function makeClient() {
  return new RoomClient({
    baseUrl: target,
    locationHref: target,
    storage: null,
    reconnect: { maxAttempts: 2 },
  });
}

function isRestoredAfterWhiteUndo({ room }) {
  return (
    room?.game?.topology === "mobius" &&
    room?.moveCount === 1 &&
    room?.game?.moveCount === 1 &&
    room?.game?.board?.[0]?.[0] === "black" &&
    room?.game?.board?.[0]?.[1] === null &&
    room?.game?.currentPlayer === "white" &&
    room?.undoRequest === null
  );
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function leaveQuietly(client) {
  if (!client.session) return;
  try {
    await client.leave({ timeoutMs: 5_000 });
  } catch {
    client.abandonRoom();
  }
}

const black = makeClient();
const white = makeClient();

try {
  const legacyResponse = await fetch(new URL("/api/rooms", target), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, name: "Stale Protocol Probe" }),
  });
  const legacyPayload = await legacyResponse.json();
  requireCondition(
    legacyResponse.status === 400 && /刷新页面/u.test(legacyPayload.error ?? ""),
    "Legacy HTTP clients were not rejected with a refresh instruction",
  );

  const blackConnected = waitFor(
    black,
    "connection",
    ({ status }) => status === "connected",
    "black WebSocket connection",
  );
  const created = await black.createRoom({
    name: "Smoke Black",
    size: 9,
    komi: 6.5,
    scoringRule: "japanese",
    topology: "mobius",
  });
  await blackConnected;

  const whiteConnected = waitFor(
    white,
    "connection",
    ({ status }) => status === "connected",
    "white WebSocket connection",
  );
  const joined = await white.joinRoom(created.roomCode, {
    name: "Smoke White",
  });
  await whiteConnected;

  requireCondition(
    black._socket?.protocol === BADUK_WS_PROTOCOL &&
      white._socket?.protocol === BADUK_WS_PROTOCOL,
    "Clients did not negotiate the v2 WebSocket subprotocol",
  );

  requireCondition(
    created.color === "black" && joined.color === "white",
    "Room seats were not assigned black then white",
  );
  requireCondition(
    created.room?.game?.topology === "mobius" &&
      joined.room?.game?.topology === "mobius",
    "Mobius topology was not preserved across room creation and join",
  );

  const uncensoredText = "讨论 D4：<script>alert('still text')</script> 👨‍👩‍👧‍👦";
  const blackSawOwnChat = waitFor(
    black,
    "chat",
    ({ message }) => message?.text === uncensoredText,
    "black text chat on sender client",
  );
  const whiteSawBlackChat = waitFor(
    white,
    "chat",
    ({ message }) => message?.text === uncensoredText,
    "black text chat on white client",
  );
  await black.sendChat({ kind: "text", text: uncensoredText });
  const [blackTextChat, whiteTextChat] = await Promise.all([
    blackSawOwnChat,
    whiteSawBlackChat,
  ]);
  requireCondition(
    blackTextChat.message.id === whiteTextChat.message.id &&
      blackTextChat.message.points?.length === 1 &&
      blackTextChat.message.points[0].row === 5 &&
      blackTextChat.message.points[0].col === 3 &&
      blackTextChat.message.points[0].label === "D4",
    "Text chat or its authoritative D4 coordinate was not synchronized",
  );

  const blackSawSticker = waitFor(
    black,
    "chat",
    ({ message }) => message?.kind === "sticker" && message?.stickerId === "donut",
    "white sticker chat on black client",
  );
  const whiteSawOwnSticker = waitFor(
    white,
    "chat",
    ({ message }) => message?.kind === "sticker" && message?.stickerId === "donut",
    "white sticker chat on sender client",
  );
  await white.sendChat({ kind: "sticker", stickerId: "donut" });
  const [blackStickerChat, whiteStickerChat] = await Promise.all([
    blackSawSticker,
    whiteSawOwnSticker,
  ]);
  requireCondition(
    blackStickerChat.message.id === whiteStickerChat.message.id,
    "Sticker chat was not synchronized to both clients",
  );

  const whiteSawBlackMove = waitFor(
    white,
    "state",
    ({ room }) => room?.game?.board?.[0]?.[0] === "black",
    "black move on white client",
  );
  await black.command("play", { row: 0, col: 0 });
  await whiteSawBlackMove;

  const blackSawWhiteMove = waitFor(
    black,
    "state",
    ({ room }) => room?.game?.board?.[0]?.[1] === "white",
    "white move on black client",
  );
  await white.command("play", { row: 0, col: 1 });
  const beforeUndo = await blackSawWhiteMove;

  requireCondition(
    beforeUndo.room.moveCount === 2 &&
      beforeUndo.room.game.moveCount === 2 &&
      beforeUndo.room.game.board[0][0] === "black" &&
      beforeUndo.room.game.board[0][1] === "white",
    "Both moves were not reflected in the authoritative room state",
  );

  const blackSawUndoRequest = waitFor(
    black,
    "state",
    ({ room }) =>
      room?.undoRequest?.requesterColor === "white" &&
      room.undoRequest.targetMoveCount === 2 &&
      Number.isSafeInteger(room.undoRequest.requestRevision) &&
      room.undoAvailable === true &&
      room.moveCount === 2,
    "white undo request on black client",
  );
  await white.command("request_undo", { expectedMoveCount: 2 });
  const requested = await blackSawUndoRequest;
  const targetMoveCount = requested.room.undoRequest.targetMoveCount;
  const requestRevision = requested.room.undoRequest.requestRevision;

  const blackRestored = waitFor(
    black,
    "state",
    isRestoredAfterWhiteUndo,
    "restored position on black client",
  );
  const whiteRestored = waitFor(
    white,
    "state",
    isRestoredAfterWhiteUndo,
    "restored position on white client",
  );
  await black.command("respond_undo", {
    accept: true,
    targetMoveCount,
    requestRevision,
  });
  const [blackFinal, whiteFinal] = await Promise.all([
    blackRestored,
    whiteRestored,
  ]);

  requireCondition(
    JSON.stringify(blackFinal.room.game.board) ===
      JSON.stringify(whiteFinal.room.game.board),
    "Black and white clients disagree about the board after undo",
  );
  requireCondition(
    blackFinal.room.revision === whiteFinal.room.revision,
    "Black and white clients disagree about the room revision after undo",
  );
  requireCondition(
    JSON.stringify(black.room.chat?.messages) ===
      JSON.stringify(white.room.chat?.messages) &&
      black.room.chat?.messages?.length === 2,
    "Black and white clients disagree about the chat history",
  );

  console.log(
    JSON.stringify({
      ok: true,
      target,
      roomCode: created.roomCode,
      black: created.color,
      white: joined.color,
      topology: blackFinal.room.game.topology,
      protocolVersion: BADUK_PROTOCOL_VERSION,
      webSocketProtocol: black._socket?.protocol,
      legacyClientRejected: true,
      moveCountBeforeUndo: beforeUndo.room.moveCount,
      moveCount: blackFinal.room.moveCount,
      undoRequestRevision: requestRevision,
      restoredCurrentPlayer: blackFinal.room.game.currentPlayer,
      restoredBlackStone: blackFinal.room.game.board[0][0],
      restoredWhitePoint: blackFinal.room.game.board[0][1],
      undoAccepted: true,
      chatMessages: black.room.chat.messages.length,
      textPreserved: black.room.chat.messages[0].text === uncensoredText,
      coordinate: black.room.chat.messages[0].points[0].label,
      sticker: black.room.chat.messages[1].stickerId,
      synchronized: true,
    }),
  );
} finally {
  await leaveQuietly(white);
  await leaveQuietly(black);
}
