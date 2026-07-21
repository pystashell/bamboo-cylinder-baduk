import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("same-room rematch keeps one settings surface and restores live view controls", () => {
  assert.match(mainSource, /function enterOnlineRematchSetup\(\)/);
  assert.match(
    mainSource,
    /if \(rematchStarted \|\| nextRoundStarted\) setViewMode\(activeViewMode\)/,
  );
  assert.match(mainSource, /elements\.startRoomRematch\?\.addEventListener/);
  assert.match(htmlSource, /id="room-rematch-setup"/);
  assert.match(htmlSource, /id="start-room-rematch"/);
  assert.doesNotMatch(htmlSource, /id="lobby-overlay"/);
});

test("finished games expose an immediate rematch without leaving the current opponent", () => {
  assert.match(htmlSource, /id="post-game-actions"/);
  assert.match(htmlSource, /id="direct-rematch"/);
  assert.match(htmlSource, />\s*直接进行下一局\s*</);
  assert.match(mainSource, /async function startImmediateRematch\(\)/);
  assert.match(
    mainSource,
    /await startNewGame\(getImmediateRematchOptions\(\)\)/,
  );
  assert.match(mainSource, /elements\.directRematch\.addEventListener/);
  assert.match(mainSource, /if \(isAIvsAI\(\)\) aiAutoplayPaused = false/);
  assert.match(mainSource, /moveInto\("game", \[[\s\S]*"#post-game-actions"/);
  assert.doesNotMatch(mainSource, /moveInto\("game", \[[\s\S]*"#return-to-lobby"/);
});
