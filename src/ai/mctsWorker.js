import {
  chooseMonteCarloMoveAsync,
  SearchCancelledError,
} from "./mcts.js";

/**
 * Worker protocol:
 *   { type: "think", id, state, options }
 *   { type: "cancel", id }
 *
 * Results:
 *   { type: "result", id, move, stats }
 *   { type: "error", id, message, code? }
 */
export function attachMctsWorker(scope) {
  const jobs = new Map();

  scope.addEventListener("message", async (event) => {
    const message = event.data ?? {};
    if (message.type === "cancel") {
      jobs.get(message.id)?.abort();
      return;
    }
    if (message.type !== "think") return;

    jobs.get(message.id)?.abort();
    const controller = new AbortController();
    jobs.set(message.id, controller);

    try {
      const { move, stats } = await chooseMonteCarloMoveAsync(message.state, {
        ...(message.options ?? {}),
        signal: controller.signal,
      });
      if (jobs.get(message.id) !== controller) return;
      scope.postMessage({ type: "result", id: message.id, move, stats });
    } catch (error) {
      if (jobs.get(message.id) !== controller) return;
      const cancelled =
        error instanceof SearchCancelledError || error?.name === "AbortError";
      scope.postMessage({
        type: "error",
        id: message.id,
        message: cancelled ? "AI search was cancelled" : String(error?.message ?? error),
        ...(cancelled ? { code: "AI_SEARCH_CANCELLED" } : {}),
      });
    } finally {
      if (jobs.get(message.id) === controller) jobs.delete(message.id);
    }
  });

  return {
    cancelAll() {
      for (const controller of jobs.values()) controller.abort();
    },
  };
}

if (typeof self !== "undefined" && typeof self.addEventListener === "function") {
  attachMctsWorker(self);
}
