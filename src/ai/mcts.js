import {
  BLACK,
  GoEngine,
  PHASE_PLAY,
} from "../game/goEngine.js";

export const MCTS_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    iterations: 60,
    timeLimitMs: 200,
    rolloutFactor: 0.7,
  }),
  medium: Object.freeze({
    iterations: 240,
    timeLimitMs: 700,
    rolloutFactor: 1,
  }),
  hard: Object.freeze({
    iterations: 800,
    timeLimitMs: 1_800,
    rolloutFactor: 1.35,
  }),
});

const PASS_MOVE = Object.freeze({ type: "pass" });
const DEFAULT_EXPLORATION = Math.SQRT2;

export class SearchCancelledError extends Error {
  constructor(message = "AI search was cancelled") {
    super(message);
    this.name = "AbortError";
    this.code = "AI_SEARCH_CANCELLED";
  }
}

/**
 * Small deterministic PRNG for repeatable tests and reproducible AI games.
 * The returned function has the same contract as Math.random().
 */
export function createSeededRandom(seed = 0) {
  const text = String(seed);
  let state = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  state >>>= 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function copyMove(move) {
  return move.type === "pass"
    ? { type: "pass" }
    : { type: "play", row: move.row, col: move.col };
}

function normalizeState(gameOrState) {
  if (gameOrState instanceof GoEngine) return gameOrState.exportState();
  if (gameOrState && typeof gameOrState.exportState === "function") {
    return GoEngine.fromState(gameOrState.exportState()).exportState();
  }
  return GoEngine.fromState(gameOrState).exportState();
}

function normalizeDifficulty(value = "easy") {
  const key = value === "normal" ? "medium" : value;
  if (!Object.hasOwn(MCTS_DIFFICULTIES, key)) {
    throw new RangeError(`Unknown AI difficulty: ${value}`);
  }
  return key;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeOptions(options, size) {
  const difficulty = normalizeDifficulty(options.difficulty);
  const preset = MCTS_DIFFICULTIES[difficulty];
  const iterations = positiveInteger(
    options.iterations ?? options.maxIterations ?? preset.iterations,
    "iterations",
  );
  const timeLimitMs = options.timeLimitMs ?? preset.timeLimitMs;
  if (
    timeLimitMs !== Infinity &&
    (!Number.isFinite(timeLimitMs) || timeLimitMs < 0)
  ) {
    throw new RangeError("timeLimitMs must be a non-negative number or Infinity");
  }
  const rolloutLimit = positiveInteger(
    options.rolloutLimit ?? Math.ceil(size * size * preset.rolloutFactor),
    "rolloutLimit",
  );
  const exploration = options.exploration ?? DEFAULT_EXPLORATION;
  if (!Number.isFinite(exploration) || exploration < 0) {
    throw new RangeError("exploration must be a non-negative finite number");
  }
  const yieldEveryIterations = positiveInteger(
    options.yieldEveryIterations ?? 8,
    "yieldEveryIterations",
  );
  const clock = options.clock ?? (() => performance.now());
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const random = options.random ?? createSeededRandom(options.seed ?? Date.now());
  if (typeof random !== "function") {
    throw new TypeError("random must be a function");
  }

  return {
    difficulty,
    iterations,
    timeLimitMs,
    rolloutLimit,
    exploration,
    yieldEveryIterations,
    clock,
    random,
    signal: options.signal,
    shouldCancel: options.shouldCancel,
    onProgress: options.onProgress,
  };
}

function randomUnit(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random() must return a number in [0, 1)");
  }
  return value;
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(randomUnit(random) * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function emptyPointMoves(state) {
  const moves = [];
  for (let row = 0; row < state.size; row += 1) {
    for (let col = 0; col < state.size; col += 1) {
      if (state.board[row][col] === null) {
        moves.push({ type: "play", row, col });
      }
    }
  }
  return moves;
}

function candidateMoves(state, random) {
  if (state.phase !== PHASE_PLAY) return [];
  // pop() is used during expansion. Keeping pass at index zero means ordinary
  // placements are explored first, while pass remains available in every node.
  return [PASS_MOVE, ...shuffle(emptyPointMoves(state), random)];
}

function applyMove(game, move) {
  return move.type === "pass" ? game.pass() : game.play(move.row, move.col);
}

function cancellationCheck(settings) {
  if (settings.signal?.aborted || settings.shouldCancel?.()) {
    throw new SearchCancelledError();
  }
}

/** Return all exact GoEngine-legal moves without modifying the supplied game. */
export function listLegalMoves(gameOrState, { includePass = true } = {}) {
  const state = normalizeState(gameOrState);
  if (state.phase !== PHASE_PLAY) return [];
  const moves = [];

  for (const move of emptyPointMoves(state)) {
    const trial = GoEngine.fromState(state);
    if (applyMove(trial, move).ok) moves.push(copyMove(move));
  }
  if (includePass) {
    const trial = GoEngine.fromState(state);
    if (trial.pass().ok) moves.push({ type: "pass" });
  }
  return moves;
}

function createNode(state, move = null) {
  return {
    state,
    move,
    visits: 0,
    value: 0,
    children: [],
    untriedMoves: null,
  };
}

function expand(node, settings) {
  node.untriedMoves ??= candidateMoves(node.state, settings.random);
  if (node.untriedMoves.length === 0) return null;

  const game = GoEngine.fromState(node.state);
  while (node.untriedMoves.length > 0) {
    cancellationCheck(settings);
    const move = node.untriedMoves.pop();
    const result = applyMove(game, move);
    if (!result.ok) continue;

    const child = createNode(game.exportState(), copyMove(move));
    node.children.push(child);
    return child;
  }
  return null;
}

function selectChild(node, rootPlayer, exploration, random) {
  const actorIsRoot = node.state.currentPlayer === rootPlayer;
  const logVisits = Math.log(Math.max(1, node.visits));
  let bestScore = -Infinity;
  let best = [];

  for (const child of node.children) {
    const mean = child.visits === 0 ? 0.5 : child.value / child.visits;
    const exploitation = actorIsRoot ? mean : 1 - mean;
    const bonus =
      child.visits === 0
        ? Infinity
        : exploration * Math.sqrt(logVisits / child.visits);
    const score = exploitation + bonus;
    if (score > bestScore) {
      bestScore = score;
      best = [child];
    } else if (score === bestScore) {
      best.push(child);
    }
  }
  return best[Math.floor(randomUnit(random) * best.length)];
}

function rolloutPassProbability(game, emptyCount) {
  const filledRatio = 1 - emptyCount / (game.size * game.size);
  if (game.consecutivePasses === 1) return 0.08 + filledRatio * 0.55;
  return 0.002 + filledRatio * 0.08;
}

function playRandomMove(game, settings) {
  const moves = shuffle(emptyPointMoves(game), settings.random);
  if (
    randomUnit(settings.random) < rolloutPassProbability(game, moves.length)
  ) {
    game.pass();
    return;
  }

  // Illegal play() calls are transactional, so the same simulation can try a
  // shuffled sequence until it finds a legal move under suicide and superko.
  for (const move of moves) {
    cancellationCheck(settings);
    if (game.play(move.row, move.col).ok) return;
  }
  game.pass();
}

function evaluate(game, rootPlayer) {
  const score = game.score();
  const difference =
    rootPlayer === BLACK ? score.black - score.white : score.white - score.black;
  // A smooth value preserves useful information from unfinished rollouts while
  // remaining in the conventional MCTS [0, 1] reward range.
  const scale = Math.max(3, game.size * 0.8);
  return 0.5 + 0.5 * Math.tanh(difference / scale);
}

function rollout(state, rootPlayer, settings) {
  const game = GoEngine.fromState(state);
  for (let ply = 0; ply < settings.rolloutLimit; ply += 1) {
    cancellationCheck(settings);
    if (game.phase !== PHASE_PLAY) break;
    playRandomMove(game, settings);
  }
  return evaluate(game, rootPlayer);
}

function runIteration(root, rootPlayer, settings) {
  let node = root;
  const path = [root];

  while (node.state.phase === PHASE_PLAY) {
    cancellationCheck(settings);
    const child = expand(node, settings);
    if (child) {
      node = child;
      path.push(node);
      break;
    }
    if (node.children.length === 0) break;
    node = selectChild(
      node,
      rootPlayer,
      settings.exploration,
      settings.random,
    );
    path.push(node);
  }

  const reward = rollout(node.state, rootPlayer, settings);
  for (const visited of path) {
    visited.visits += 1;
    visited.value += reward;
  }
}

function fallbackMove(state, settings) {
  const game = GoEngine.fromState(state);
  for (const move of shuffle(emptyPointMoves(state), settings.random)) {
    cancellationCheck(settings);
    if (game.play(move.row, move.col).ok) return copyMove(move);
  }
  return { type: "pass" };
}

function chooseMostVisited(root, fallback) {
  if (root.children.length === 0) return { move: fallback, child: null };
  const children = [...root.children].sort((left, right) => {
    if (right.visits !== left.visits) return right.visits - left.visits;
    const leftMean = left.visits === 0 ? 0 : left.value / left.visits;
    const rightMean = right.visits === 0 ? 0 : right.value / right.visits;
    return rightMean - leftMean;
  });
  return { move: copyMove(children[0].move), child: children[0] };
}

function createSearch(gameOrState, options) {
  const state = normalizeState(gameOrState);
  if (state.phase !== PHASE_PLAY) {
    throw new RangeError("The AI can only choose a move while play is active");
  }
  const settings = normalizeOptions(options, state.size);
  cancellationCheck(settings);
  const fallback = fallbackMove(state, settings);
  return {
    state,
    root: createNode(state),
    rootPlayer: state.currentPlayer,
    settings,
    fallback,
    startedAt: settings.clock(),
    completed: 0,
  };
}

function canContinue(search) {
  if (search.completed >= search.settings.iterations) return false;
  // Always perform one iteration, even with a zero-millisecond budget, so a
  // tiny UI budget still returns a searched rather than arbitrary move.
  return (
    search.completed === 0 ||
    search.settings.timeLimitMs === Infinity ||
    search.settings.clock() - search.startedAt < search.settings.timeLimitMs
  );
}

function stepSearch(search) {
  cancellationCheck(search.settings);
  runIteration(search.root, search.rootPlayer, search.settings);
  search.completed += 1;
}

function finishSearch(search) {
  cancellationCheck(search.settings);
  const selected = chooseMostVisited(search.root, search.fallback);
  const elapsedMs = Math.max(0, search.settings.clock() - search.startedAt);
  const candidates = [...search.root.children]
    .sort((left, right) => right.visits - left.visits)
    .map((child) => ({
      move: copyMove(child.move),
      visits: child.visits,
      winRate: child.visits === 0 ? 0.5 : child.value / child.visits,
    }));

  return {
    move: selected.move,
    stats: {
      difficulty: search.settings.difficulty,
      iterations: search.completed,
      elapsedMs,
      rootPlayer: search.rootPlayer,
      visits: selected.child?.visits ?? 0,
      winRate:
        selected.child && selected.child.visits > 0
          ? selected.child.value / selected.child.visits
          : 0.5,
      candidates,
    },
  };
}

/**
 * Synchronous MCTS search. Use shouldCancel for cooperative cancellation.
 * Browser UI code should normally call the async version through mctsWorker.
 */
export function chooseMonteCarloMove(gameOrState, options = {}) {
  const search = createSearch(gameOrState, options);
  while (canContinue(search)) stepSearch(search);
  return finishSearch(search);
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Async MCTS search that yields so AbortSignal and Worker cancel messages work. */
export async function chooseMonteCarloMoveAsync(gameOrState, options = {}) {
  const search = createSearch(gameOrState, options);
  while (canContinue(search)) {
    stepSearch(search);
    if (search.completed % search.settings.yieldEveryIterations === 0) {
      search.settings.onProgress?.({
        iterations: search.completed,
        elapsedMs: search.settings.clock() - search.startedAt,
      });
      await yieldToEventLoop();
    }
  }
  return finishSearch(search);
}

export default chooseMonteCarloMove;
