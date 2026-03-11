import { registerBackgroundHandlers } from "./src/background-handlers.js";
import { createTabState } from "./src/tab-state.js";
import { createWindowTaskRunner } from "./src/window-task-queue.js";

const tabState = createTabState({ chromeApi: chrome });
const { runSafely, runWindowTask } = createWindowTaskRunner({
  ensureReady: tabState.initializeCache,
  isNormalWindowId: tabState.isNormalWindowId
});

registerBackgroundHandlers({
  chromeApi: chrome,
  tabState,
  runSafely,
  runWindowTask
});

runSafely(async () => {
  await tabState.initializeCache();
});