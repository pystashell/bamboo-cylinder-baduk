import test from "node:test";
import assert from "node:assert/strict";

import { chooseMonteCarloMove } from "../src/ai/mcts.js";
import { BLACK, EMPTY, GoEngine, WHITE } from "../src/game/goEngine.js";

// These include seeds that made the old all-legal-moves MCTS choose a
// self-atari or fill its own eye, keeping the regressions meaningful.
const TACTICAL_SEEDS = Object.freeze([3, 11, 17, 106]);
const TACTICAL_BUDGET = Object.freeze({
  difficulty: "hard",
  iterations: 36,
  timeLimitMs: Infinity,
  rolloutLimit: 10,
});

function boardFromRows(rows) {
  return rows.map((row) =>
    [...row].map((point) =>
      point === "B" ? BLACK : point === "W" ? WHITE : EMPTY,
    ),
  );
}

function gameFromRows(rows, currentPlayer = BLACK) {
  return new GoEngine({
    size: rows.length,
    komi: 0,
    currentPlayer,
    initialBoard: boardFromRows(rows),
  });
}

function moveKey(move) {
  return move.type === "pass" ? "pass" : `${move.row},${move.col}`;
}

function search(game, seed, overrides = {}) {
  return chooseMonteCarloMove(game, {
    ...TACTICAL_BUDGET,
    ...overrides,
    seed,
  });
}

function assertMoveAcrossSeeds(makeGame, expected, message) {
  for (const seed of TACTICAL_SEEDS) {
    const result = search(makeGame(), seed);
    assert.equal(
      moveKey(result.move),
      expected,
      `${message} (seed ${seed}, got ${moveKey(result.move)})`,
    );
  }
}

test("small-budget AI always takes a forced capture across the seam", () => {
  assertMoveAcrossSeeds(
    () =>
      gameFromRows([
        ".....",
        "B....",
        "WB...",
        "B....",
        ".....",
      ]),
    "2,4",
    "black must capture the white stone whose final liberty wraps to column 4",
  );
});

test("small-budget AI saves its atari group through the seam", () => {
  assertMoveAcrossSeeds(
    () =>
      gameFromRows([
        ".....",
        "W....",
        "BW...",
        "W....",
        ".....",
      ]),
    "2,4",
    "black must extend through its only liberty instead of abandoning the group",
  );
});

test("saving a large atari group outranks an unrelated one-stone capture", () => {
  assertMoveAcrossSeeds(
    () =>
      gameFromRows([
        ".B.....",
        ".WB....",
        ".B.W...",
        "..WBBW.",
        "..WBBW.",
        "...WW..",
        ".......",
      ]),
    "2,4",
    "black must save its four-stone group instead of capturing one stone at 1,0",
  );
});

test("a one-liberty capture is searched instead of being forced into snapback", () => {
  for (const seed of TACTICAL_SEEDS) {
    const game = gameFromRows([
      ".....",
      "..BWW",
      "WBW.B",
      "..BWW",
      ".....",
    ]);
    const result = search(game, seed, {
      iterations: 200,
      rolloutLimit: 10,
    });

    assert.notEqual(
      moveKey(result.move),
      "2,3",
      `seed ${seed} must read the immediate two-stone snapback reply`,
    );
  }
});

test("capturing a multi-stone string uses exact post-capture liberties", () => {
  for (const seed of TACTICAL_SEEDS) {
    const game = gameFromRows([
      ".......",
      ".......",
      ".BBWW..",
      "BWW.BW.",
      ".BBWW..",
      ".......",
      ".......",
    ]);
    const result = search(game, seed, {
      iterations: 200,
      rolloutLimit: 10,
    });

    const candidate = result.stats.candidates.find(
      ({ move }) => moveKey(move) === "3,3",
    );
    assert.ok(candidate, `seed ${seed} should search the tactical capture`);
    assert.equal(
      candidate.resultingLiberties,
      1,
      `seed ${seed} must not count the remote captured point as a liberty`,
    );
    assert.equal(
      candidate.snapbackLoss,
      2,
      `seed ${seed} should read the exact immediate recapture`,
    );
  }
});

test("self-atari is downgraded when ordinary safe moves exist", () => {
  for (const seed of TACTICAL_SEEDS) {
    const game = gameFromRows([
      ".....",
      "..W..",
      ".W.W.",
      ".....",
      ".....",
    ]);
    const result = search(game, seed);

    assert.notEqual(
      moveKey(result.move),
      "2,2",
      `seed ${seed} must not choose the legal one-liberty self-atari`,
    );
  }
});

test("small-budget AI connects and rescues two groups across the seam", () => {
  assertMoveAcrossSeeds(
    () =>
      gameFromRows([
        ".....",
        ".W..W",
        ".BWWB",
        ".W..W",
        ".....",
      ]),
    "2,0",
    "column 0 is the shared seam liberty that connects both black groups",
  );
});

test("AI does not unnecessarily fill its own complete eye", () => {
  for (const seed of TACTICAL_SEEDS) {
    const game = gameFromRows([
      ".....",
      ".BBB.",
      ".B.B.",
      ".BBB.",
      ".....",
    ]);
    const result = search(game, seed);

    assert.notEqual(
      moveKey(result.move),
      "2,2",
      `seed ${seed} must preserve the enclosed one-point eye`,
    );
  }
});

test("an opening pass does not make the AI end an unsettled game", () => {
  const game = new GoEngine({ size: 5, komi: 0 });
  assert.equal(game.pass().ok, true);

  for (const seed of TACTICAL_SEEDS) {
    const result = search(game, seed, { iterations: 24, rolloutLimit: 6 });
    assert.equal(
      result.move.type,
      "play",
      `seed ${seed} should keep playing after an opening pass`,
    );
  }
});

test("AI passes instead of filling the final liberties of its own settled shape", () => {
  const game = gameFromRows([
    ".BBBB",
    "BBBBB",
    "BB.BB",
    "BBBBB",
    "BBBBB",
  ]);

  for (const seed of TACTICAL_SEEDS) {
    const result = search(game, seed, { iterations: 24, rolloutLimit: 6 });
    assert.deepEqual(
      result.move,
      { type: "pass" },
      `seed ${seed} should preserve its own settled liberties`,
    );
  }
});

test("candidate pruning lets the root revisit moves under a small 19x19 budget", () => {
  for (const seed of TACTICAL_SEEDS) {
    const result = search(new GoEngine({ size: 19 }), seed, {
      iterations: 80,
      rolloutLimit: 4,
    });
    const mostVisits = Math.max(
      0,
      ...result.stats.candidates.map((candidate) => candidate.visits),
    );

    assert.ok(
      mostVisits > 1,
      `seed ${seed} should revisit at least one root move, got ${mostVisits}`,
    );
    assert.ok(
      result.stats.candidates.length < result.stats.iterations,
      `seed ${seed} should prune the root below its ${result.stats.iterations}-iteration budget`,
    );
  }
});

test("tactical search returns a legal move without mutating its input state", () => {
  const game = gameFromRows([
    ".........",
    ".........",
    "....W....",
    "...WBW...",
    "...B.B...",
    "....B....",
    ".........",
    ".........",
    ".........",
  ]);
  const before = game.exportState();

  for (const seed of TACTICAL_SEEDS) {
    const result = search(game, seed, { iterations: 28, rolloutLimit: 8 });
    assert.deepEqual(
      game.exportState(),
      before,
      `seed ${seed} must leave the supplied game untouched`,
    );

    const verification = GoEngine.fromState(before);
    const played =
      result.move.type === "pass"
        ? verification.pass()
        : verification.play(result.move.row, result.move.col);
    assert.equal(
      played.ok,
      true,
      `seed ${seed} must return an exact GoEngine-legal move`,
    );
  }
});
