let tabsCache = new Map();
let isCacheInitialized = false;
let cacheInitPromise = null;
let persistQueue = Promise.resolve();
const windowQueues = new Map();
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

function isNormalWindowId(windowId) {
  return windowId !== undefined && windowId !== null && windowId >= 0;
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

  return state.previous === tabId && Date.now() - state.ts <= 1500;
}

function upsertTabInCache(tab) {
  tabsCache.set(tab.id, flattenTab(tab));
  if (tab.active) {
    markActiveTab(tab.windowId, tab.id);
  }
}

function persistCache() {
  persistQueue = persistQueue
    .then(() => chrome.storage.session.set({ tabsCache: Array.from(tabsCache.entries()) }))
    .catch((error) => {
      console.error("Persist cache failed:", error);
    });
  return persistQueue;
}

async function refreshWindowTabs(windowId) {
  if (!isNormalWindowId(windowId)) {
    return;
  }

  const tabs = await chrome.tabs.query({ windowId });

  removeWindowFromCache(windowId);

  tabs.forEach((tab) => {
    upsertTabInCache(tab);
  });

  const activeTab = tabs.find((tab) => tab.active);
  if (activeTab) {
    rememberActivation(windowId, activeTab.id);
  }
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
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
      const storage = await chrome.storage.session.get("tabsCache");
      if (Array.isArray(storage.tabsCache) && storage.tabsCache.length > 0) {
        tabsCache = new Map(storage.tabsCache);
        windowActiveHistory.clear();
        for (const tab of tabsCache.values()) {
          if (tab.active) {
            rememberActivation(tab.windowId, tab.id);
          }
        }
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

function pickLeftCandidate(tabs, closedIndex) {
  const leftTabs = tabs.filter((tab) => tab.index < closedIndex);
  if (leftTabs.length > 0) {
    return leftTabs.reduce((best, current) => {
      return current.index > best.index ? current : best;
    });
  }

  return tabs.length > 0 ? tabs[0] : null;
}

function runWindowTask(windowId, task) {
  runSafely(async () => {
    await initializeCache();

    if (!isNormalWindowId(windowId)) {
      await task();
      return;
    }

    await enqueueWindowTask(windowId, task);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  runSafely(async () => {
    await syncAllTabs();
  });
});

chrome.runtime.onStartup.addListener(() => {
  runSafely(async () => {
    await syncAllTabs();
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  runWindowTask(tab.windowId, async () => {
    await refreshWindowTabs(tab.windowId);
    await persistCache();
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  runWindowTask(activeInfo.windowId, async () => {
    rememberActivation(activeInfo.windowId, activeInfo.tabId);
    markActiveTab(activeInfo.windowId, activeInfo.tabId);
    await persistCache();
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.index === undefined && changeInfo.pinned === undefined && changeInfo.status !== "complete") {
    return;
  }

  runWindowTask(tab.windowId, async () => {
    upsertTabInCache(tab);
    await persistCache();
  });
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  runWindowTask(moveInfo.windowId, async () => {
    await refreshWindowTabs(moveInfo.windowId);
    await persistCache();
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  runWindowTask(attachInfo.newWindowId, async () => {
    await refreshWindowTabs(attachInfo.newWindowId);
    await persistCache();
  });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  runWindowTask(detachInfo.oldWindowId, async () => {
    await refreshWindowTabs(detachInfo.oldWindowId);
    await persistCache();
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  runWindowTask(removeInfo.windowId, async () => {
    const closedTab = tabsCache.get(tabId);
    const closedByHistory = wasRecentlyActiveTab(removeInfo.windowId, tabId);
    const wasActive = Boolean(closedTab?.active) || closedByHistory;

    tabsCache.delete(tabId);

    if (removeInfo.isWindowClosing) {
      removeWindowFromCache(removeInfo.windowId);
      await persistCache();
      return;
    }

    if (!closedTab || !wasActive) {
      await refreshWindowTabs(removeInfo.windowId);
      await persistCache();
      return;
    }

    const remainingTabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
    const candidate = pickLeftCandidate(remainingTabs, closedTab.index);
    if (candidate?.id !== undefined) {
      try {
        await chrome.tabs.update(candidate.id, { active: true });
      } catch (error) {
        console.warn("Activate tab failed:", error);
      }
    }

    await refreshWindowTabs(removeInfo.windowId);
    await persistCache();
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  runWindowTask(windowId, async () => {
    removeWindowFromCache(windowId);
    await persistCache();
  });
});

runSafely(async () => {
  await initializeCache();
});