import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("the public game UI does not expose the hidden lobby URL", () => {
  assert.doesNotMatch(htmlSource, /id="header-lobby-link"/u);
  assert.doesNotMatch(htmlSource, /id="return-lobby"/u);
  assert.match(htmlSource, /class="brand" href="\/single"/u);
  assert.match(htmlSource, /id="lobby-screen"[^>]*\bhidden\b/u);
});

test("lobby networking is dynamically activated only on the lobby screen", () => {
  assert.match(mainSource, /import\("\.\/multiplayer\/lobby\.js"\)/u);
  assert.match(mainSource, /import\("\.\/multiplayer\/lobbyClient\.js"\)/u);
  assert.doesNotMatch(
    mainSource,
    /^import .*from "\.\/multiplayer\/lobby(?:Client)?\.js";/mu,
  );
  assert.match(
    mainSource,
    /function showAppScreen[\s\S]*?if \(lobbyVisible\) \{[\s\S]*?startLobbyRefresh\(\);[\s\S]*?return;/u,
  );
});

test("root, standalone, and direct-room startup have separate route branches", () => {
  assert.match(mainSource, /initialRoute\.mode === "root"[\s\S]*?replaceAppPath\("\/single"\)/u);
  assert.match(mainSource, /initialRoute\.mode === "online"[\s\S]*?roomClient\.resumeRoom/u);
  assert.match(mainSource, /initialRoute\.mode === "single"[\s\S]*?showOnlineDialog\(\)/u);
});
