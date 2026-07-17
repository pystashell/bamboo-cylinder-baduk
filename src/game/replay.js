import {
  BLACK,
  GoEngine,
  REPLAY_VERSION,
  WHITE,
} from "./goEngine.js";

const VALID_COLORS = new Set([BLACK, WHITE]);

function requireReplayObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function applyReplayEvent(game, event, index) {
  requireReplayObject(event, `replay.events[${index}]`);
  let result;

  if (event.type === "play") {
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`replay.events[${index}] has an invalid color`);
    }
    if (game.currentPlayer !== event.color) {
      throw new TypeError(
        `replay.events[${index}] color does not match the player to move`,
      );
    }
    result = game.play(event.row, event.col);
  } else if (event.type === "pass") {
    if (!VALID_COLORS.has(event.color)) {
      throw new TypeError(`replay.events[${index}] has an invalid color`);
    }
    if (game.currentPlayer !== event.color) {
      throw new TypeError(
        `replay.events[${index}] color does not match the player to move`,
      );
    }
    result = game.pass();
  } else if (event.type === "resume_play") {
    if (!VALID_COLORS.has(event.nextPlayer)) {
      throw new TypeError(`replay.events[${index}] has an invalid nextPlayer`);
    }
    result = game.resumePlay(event.nextPlayer);
  } else if (event.type === "toggle_dead") {
    result = game.toggleDead(event.row, event.col);
  } else if (event.type === "finish_scoring") {
    result = game.finishScoring(event.rule);
  } else {
    throw new TypeError(
      `Unknown replay event type at replay.events[${index}]: ${event.type}`,
    );
  }

  if (!result.ok) {
    throw new TypeError(
      `replay.events[${index}] is illegal: ${result.reason}`,
    );
  }
  return result;
}

/**
 * Expand a compact replay into render-ready positions.
 *
 * frames[0] is the starting position and every successful play/pass adds one
 * frame. Scoring and resume-play events update the current frame without
 * incrementing the move number, preserving the exact final result while the
 * transport remains expressed in ordinary Go hands.
 * `steps[index]` describes the move from frames[index] to frames[index + 1].
 */
export function buildReplayFrames(replay) {
  requireReplayObject(replay, "replay");
  if (replay.version !== REPLAY_VERSION) {
    throw new TypeError(`Unsupported replay version: ${replay.version}`);
  }
  if (typeof replay.complete !== "boolean") {
    throw new TypeError("replay.complete must be a boolean");
  }
  requireReplayObject(replay.base, "replay.base");
  if (Object.prototype.hasOwnProperty.call(replay.base, "replay")) {
    throw new TypeError("replay.base must not contain a nested replay");
  }
  if (!Array.isArray(replay.events)) {
    throw new TypeError("replay.events must be an array");
  }

  const game = GoEngine.fromState(replay.base);
  const frames = [game.getState()];
  const steps = [];

  replay.events.forEach((event, eventIndex) => {
    const result = applyReplayEvent(game, event, eventIndex);
    if (!["play", "pass"].includes(event.type)) {
      frames[frames.length - 1] = game.getState();
      return;
    }

    frames.push(game.getState());
    if (event.type === "play") {
      steps.push({
        type: "play",
        color: result.color,
        row: result.row,
        col: result.col,
        captured: result.captured.map(({ row, col }) => ({ row, col })),
      });
    } else {
      steps.push({ type: "pass", color: result.color });
    }
  });

  return { frames, steps, complete: replay.complete };
}

export default buildReplayFrames;
