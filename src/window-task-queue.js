export function createWindowTaskRunner({ ensureReady, isNormalWindowId }) {
  const windowQueues = new Map();

  function runSafely(task) {
    task().catch((error) => {
      console.error("Background handler failed:", error);
    });
  }

  function enqueueWindowTask(windowId, task) {
    const queueKey = String(windowId);
    const previous = windowQueues.get(queueKey) || Promise.resolve();
    const next = previous
      .catch((error) => {
        console.error("Previous queued task failed:", error);
      })
      .then(task);

    const tracked = next.finally(() => {
      if (windowQueues.get(queueKey) === tracked) {
        windowQueues.delete(queueKey);
      }
    });

    windowQueues.set(queueKey, tracked);
    return tracked;
  }

  function runWindowTask(windowId, task) {
    runSafely(async () => {
      await ensureReady();

      if (!isNormalWindowId(windowId)) {
        await task();
        return;
      }

      await enqueueWindowTask(windowId, task);
    });
  }

  return {
    runSafely,
    runWindowTask
  };
}
