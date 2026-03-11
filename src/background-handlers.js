import { pickLeftCandidate } from "./tab-focus-policy.js";

export function registerBackgroundHandlers({ chromeApi, tabState, runSafely, runWindowTask }) {
  chromeApi.runtime.onInstalled.addListener(() => {
    runSafely(async () => {
      await tabState.syncAllTabs();
    });
  });

  chromeApi.runtime.onStartup.addListener(() => {
    runSafely(async () => {
      await tabState.syncAllTabs();
    });
  });

  chromeApi.tabs.onCreated.addListener((tab) => {
    runWindowTask(tab.windowId, async () => {
      await tabState.refreshWindowTabs(tab.windowId);
      await tabState.persistCache();
    });
  });

  chromeApi.tabs.onActivated.addListener((activeInfo) => {
    runWindowTask(activeInfo.windowId, async () => {
      tabState.rememberActivation(activeInfo.windowId, activeInfo.tabId);
      tabState.markActiveTab(activeInfo.windowId, activeInfo.tabId);
      await tabState.persistCache();
    });
  });

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.index === undefined && changeInfo.pinned === undefined && changeInfo.status !== "complete") {
      return;
    }

    runWindowTask(tab.windowId, async () => {
      tabState.upsertTabInCache(tab);
      await tabState.persistCache();
    });
  });

  chromeApi.tabs.onMoved.addListener((tabId, moveInfo) => {
    runWindowTask(moveInfo.windowId, async () => {
      await tabState.refreshWindowTabs(moveInfo.windowId);
      await tabState.persistCache();
    });
  });

  chromeApi.tabs.onAttached.addListener((tabId, attachInfo) => {
    runWindowTask(attachInfo.newWindowId, async () => {
      await tabState.refreshWindowTabs(attachInfo.newWindowId);
      await tabState.persistCache();
    });
  });

  chromeApi.tabs.onDetached.addListener((tabId, detachInfo) => {
    runWindowTask(detachInfo.oldWindowId, async () => {
      await tabState.refreshWindowTabs(detachInfo.oldWindowId);
      await tabState.persistCache();
    });
  });

  chromeApi.tabs.onRemoved.addListener((tabId, removeInfo) => {
    runWindowTask(removeInfo.windowId, async () => {
      const { closedTab, wasActive } = tabState.getClosedTabInfo(removeInfo.windowId, tabId);
      tabState.removeTab(tabId);

      if (removeInfo.isWindowClosing) {
        tabState.removeWindowFromCache(removeInfo.windowId);
        await tabState.persistCache();
        return;
      }

      if (!closedTab || !wasActive) {
        await tabState.refreshWindowTabs(removeInfo.windowId);
        await tabState.persistCache();
        return;
      }

      const remainingTabs = await chromeApi.tabs.query({ windowId: removeInfo.windowId });
      const candidate = pickLeftCandidate(remainingTabs, closedTab.index);
      if (candidate?.id !== undefined) {
        try {
          await chromeApi.tabs.update(candidate.id, { active: true });
        } catch (error) {
          console.warn("Activate tab failed:", error);
        }
      }

      await tabState.refreshWindowTabs(removeInfo.windowId);
      await tabState.persistCache();
    });
  });

  chromeApi.windows.onRemoved.addListener((windowId) => {
    runWindowTask(windowId, async () => {
      tabState.removeWindowFromCache(windowId);
      await tabState.persistCache();
    });
  });
}
