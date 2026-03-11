export function createTabState({ chromeApi, storageKey = "tabsCache", activationGraceMs = 1500 }) {
  let tabsCache = new Map();
  let isCacheInitialized = false;
  let cacheInitPromise = null;
  let persistQueue = Promise.resolve();
  const windowActiveHistory = new Map();

  function flattenTab(tab) {
    return {
      id: tab.id,
      index: tab.index,
      windowId: tab.windowId,
      active: tab.active,
      pinned: tab.pinned
    };
  }

  function isNormalWindowId(windowId) {
    return windowId !== undefined && windowId !== null && windowId >= 0;
  }

  function rememberActivation(windowId, tabId) {
    if (!isNormalWindowId(windowId) || tabId === undefined || tabId === null) {
      return;
    }

    const previous = windowActiveHistory.get(windowId);
    windowActiveHistory.set(windowId, {
      current: tabId,
      previous: previous?.current ?? null,
      ts: Date.now()
    });
  }

  function wasRecentlyActiveTab(windowId, tabId) {
    const state = windowActiveHistory.get(windowId);
    if (!state) {
      return false;
    }

    if (state.current === tabId) {
      return true;
    }

    return state.previous === tabId && Date.now() - state.ts <= activationGraceMs;
  }

  function removeWindowFromCache(windowId) {
    for (const [id, tab] of tabsCache.entries()) {
      if (tab.windowId === windowId) {
        tabsCache.delete(id);
      }
    }

    windowActiveHistory.delete(windowId);
  }

  function markActiveTab(windowId, activeTabId) {
    for (const tab of tabsCache.values()) {
      if (tab.windowId === windowId) {
        tab.active = tab.id === activeTabId;
      }
    }
  }

  function upsertTabInCache(tab) {
    tabsCache.set(tab.id, flattenTab(tab));
    if (tab.active) {
      markActiveTab(tab.windowId, tab.id);
      rememberActivation(tab.windowId, tab.id);
    }
  }

  function rebuildActivationHistoryFromCache() {
    windowActiveHistory.clear();
    for (const tab of tabsCache.values()) {
      if (tab.active) {
        rememberActivation(tab.windowId, tab.id);
      }
    }
  }

  function persistCache() {
    persistQueue = persistQueue
      .then(() => chromeApi.storage.session.set({ [storageKey]: Array.from(tabsCache.entries()) }))
      .catch((error) => {
        console.error("Persist cache failed:", error);
      });
    return persistQueue;
  }

  async function refreshWindowTabs(windowId) {
    if (!isNormalWindowId(windowId)) {
      return;
    }

    const tabs = await chromeApi.tabs.query({ windowId });
    removeWindowFromCache(windowId);
    tabs.forEach((tab) => {
      upsertTabInCache(tab);
    });
  }

  async function syncAllTabs() {
    const tabs = await chromeApi.tabs.query({});
    tabsCache.clear();
    windowActiveHistory.clear();
    tabs.forEach((tab) => {
      tabsCache.set(tab.id, flattenTab(tab));
      if (tab.active) {
        rememberActivation(tab.windowId, tab.id);
      }
    });
    isCacheInitialized = true;
    await persistCache();
  }

  async function initializeCache() {
    if (isCacheInitialized) {
      return;
    }

    if (cacheInitPromise) {
      await cacheInitPromise;
      return;
    }

    cacheInitPromise = (async () => {
      try {
        const storage = await chromeApi.storage.session.get(storageKey);
        if (Array.isArray(storage[storageKey]) && storage[storageKey].length > 0) {
          tabsCache = new Map(storage[storageKey]);
          rebuildActivationHistoryFromCache();
          isCacheInitialized = true;
        } else {
          await syncAllTabs();
        }
      } catch (error) {
        console.error("Cache init failed:", error);
        await syncAllTabs();
      }
    })();

    try {
      await cacheInitPromise;
    } finally {
      cacheInitPromise = null;
    }
  }

  function getClosedTabInfo(windowId, tabId) {
    const closedTab = tabsCache.get(tabId);
    const wasActive = Boolean(closedTab?.active) || wasRecentlyActiveTab(windowId, tabId);
    return {
      closedTab,
      wasActive
    };
  }

  function removeTab(tabId) {
    tabsCache.delete(tabId);
  }

  return {
    initializeCache,
    syncAllTabs,
    refreshWindowTabs,
    persistCache,
    removeWindowFromCache,
    markActiveTab,
    rememberActivation,
    upsertTabInCache,
    getClosedTabInfo,
    removeTab,
    isNormalWindowId
  };
}
