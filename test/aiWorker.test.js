import test from "node:test";
import assert from "node:assert/strict";

import { attachMctsWorker } from "../src/ai/mctsWorker.js";
import { GoEngine } from "../src/game/goEngine.js";

class FakeWorkerScope {
  constructor() {
    this.listener = null;
    this.messages = [];
    this.waiters = [];
  }

  addEventListener(type, listener) {
    if (type === "message") this.listener = listener;
  }

  postMessage(message) {
    this.messages.push(message);
    this.waiters.splice(0).forEach((resolve) => resolve(message));
  }

  dispatch(data) {
    this.listener({ data });
  }

  nextMessage() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

test("module worker returns a serializable legal result", async () => {
  const scope = new FakeWorkerScope();
  attachMctsWorker(scope);
  const state = new GoEngine({ size: 3 }).exportState();
  const responsePromise = scope.nextMessage();

  scope.dispatch({
    type: "think",
    id: "job-1",
    state,
    options: {
      seed: 7,
      iterations: 3,
      timeLimitMs: Infinity,
      rolloutLimit: 3,
      yieldEveryIterations: 1,
    },
  });
  const response = await responsePromise;

  assert.equal(response.type, "result");
  assert.equal(response.id, "job-1");
  assert.equal(response.stats.iterations, 3);
  const verification = GoEngine.fromState(state);
  const moveResult =
    response.move.type === "pass"
      ? verification.pass()
      : verification.play(response.move.row, response.move.col);
  assert.equal(moveResult.ok, true);
});

test("module worker can cancel a running search", async () => {
  const scope = new FakeWorkerScope();
  attachMctsWorker(scope);
  const responsePromise = scope.nextMessage();

  scope.dispatch({
    type: "think",
    id: "job-cancel",
    state: new GoEngine({ size: 5 }).exportState(),
    options: {
      seed: 8,
      iterations: 10_000,
      timeLimitMs: Infinity,
      rolloutLimit: 15,
      yieldEveryIterations: 1,
    },
  });
  scope.dispatch({ type: "cancel", id: "job-cancel" });
  const response = await responsePromise;

  assert.equal(response.type, "error");
  assert.equal(response.id, "job-cancel");
  assert.equal(response.code, "AI_SEARCH_CANCELLED");
});
