let tabsCache = new Map();
let isCacheInitialized = false;

async function initializeCache() {
  if (isCacheInitialized) return;

  try {
    const storage = await chrome.storage.session.get("tabsCache");
    if (storage.tabsCache) {
      tabsCache = new Map(storage.tabsCache);
      isCacheInitialized = true;
    } else {
      await syncAllTabs();
    }
  } catch (e) {
    console.error("Cache init failed:", e);
    await syncAllTabs();
  }
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  tabsCache.clear();
  tabs.forEach(tab => {
    tabsCache.set(tab.id, flattenTab(tab));
  });
  isCacheInitialized = true;
  persistCache();
}

function flattenTab(tab) {
  return {
    id: tab.id,
    index: tab.index,
    windowId: tab.windowId,
    active: tab.active,
    pinned: tab.pinned
  };
}

let saveTimeout;
function persistCache() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    chrome.storage.session.set({ tabsCache: Array.from(tabsCache.entries()) });
  }, 100);
}

function findLeftTabId(closedTab) {
  if (!closedTab) return null;

  const targetIndex = closedTab.index - 1;
  if (targetIndex < 0) return null;
  for (const tab of tabsCache.values()) {
    if (tab.windowId === closedTab.windowId && tab.index === targetIndex) {
      return tab.id;
    }
  }
  return null;
}

chrome.tabs.onCreated.addListener(async (tab) => {
  await initializeCache();
  tabsCache.set(tab.id, flattenTab(tab));
  persistCache();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.index !== undefined || changeInfo.pinned !== undefined) {
    await initializeCache();
    tabsCache.set(tab.id, flattenTab(tab));
    persistCache();
  }
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
  await initializeCache();
  const tabs = await chrome.tabs.query({ windowId: moveInfo.windowId });
  tabs.forEach(t => tabsCache.set(t.id, flattenTab(t)));
  persistCache();
});

chrome.tabs.onDetached.addListener(async (tabId, detachInfo) => {
    await initializeCache();
    const tabs = await chrome.tabs.query({ windowId: detachInfo.oldWindowId });
    tabs.forEach(t => tabsCache.set(t.id, flattenTab(t)));
    persistCache();
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await initializeCache();
  const closedTab = tabsCache.get(tabId);
  if (!closedTab || !closedTab.active) {
    tabsCache.delete(tabId);
    persistCache();
    return;
  }

  const nextTabId = findLeftTabId(closedTab);
  if (nextTabId) {
    try {
      await chrome.tabs.update(nextTabId, { active: true });
    } catch (e) {
      console.log("Fail to update tab:", e);
    }
  }
  tabsCache.delete(tabId);
  persistCache();
});

initializeCache();