const STORAGE_KEY = 'activeTabsByWindow';
const DEBUG_MODE = false;

function debugLog(message, data = null) {
    if (DEBUG_MODE) {
        console.log(`[TabPositionOptions] ${message}`, data || '');
    }
}

async function updateStoredActiveTab(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        debugLog('Skipping update for WINDOW_ID_NONE');
        return;
    }
    
    try {
        const [activeTab] = await chrome.tabs.query({ 
            active: true, 
            windowId: windowId 
        });
        
        if (!activeTab) {
            debugLog(`No active tab found for window ${windowId}`);
            return;
        }

        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};

        // Store minimal necessary metadata
        allWindowsState[windowId] = {
            id: activeTab.id,
            index: activeTab.index,
            windowId: activeTab.windowId,
            pinned: activeTab.pinned,
            timestamp: Date.now()
        };

        await chrome.storage.session.set({ [STORAGE_KEY]: allWindowsState });
        debugLog(`Updated active tab for window ${windowId}`, allWindowsState[windowId]);
    } catch (e) {
        debugLog(`Failed to update stored active tab for window ${windowId}:`, e.message);
    }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
    debugLog(`Tab activated: ${activeInfo.tabId} in window ${activeInfo.windowId}`);
    updateStoredActiveTab(activeInfo.windowId);
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    debugLog(`Tab ${tabId} moved in window ${moveInfo.windowId}`);
    updateStoredActiveTab(moveInfo.windowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    debugLog(`Tab ${tabId} attached to window ${attachInfo.newWindowId}`);
    updateStoredActiveTab(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
    debugLog(`Tab ${tabId} detached from window ${detachInfo.oldWindowId}`);
    updateStoredActiveTab(detachInfo.oldWindowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        debugLog(`Window focus changed to ${windowId}`);
        updateStoredActiveTab(windowId);
    }
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    debugLog(`Tab replaced: ${removedTabId} -> ${addedTabId}`);
    chrome.tabs.get(addedTabId).then(tab => {
        updateStoredActiveTab(tab.windowId);
    }).catch(e => {
        debugLog('Failed to handle tab replacement:', e.message);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && changeInfo.pinned !== undefined) {
        debugLog(`Active tab ${tabId} updated in window ${tab.windowId}`, changeInfo);
        updateStoredActiveTab(tab.windowId);
    }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    try {
        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};
        
        if (allWindowsState[windowId]) {
            delete allWindowsState[windowId];
            await chrome.storage.session.set({ [STORAGE_KEY]: allWindowsState });
            debugLog(`Cleaned up state for closed window ${windowId}`);
        }
    } catch (e) {
        debugLog(`Failed to clean up window state for ${windowId}:`, e.message);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) {
        debugLog(`Window ${removeInfo.windowId} is closing, skipping tab removal handling`);
        return;
    }

    try {
        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};
        const lastActiveTab = allWindowsState[removeInfo.windowId];

        if (!lastActiveTab || tabId !== lastActiveTab.id) {
            debugLog(`Tab ${tabId} was not the last active tab or no stored state found`);
            return;
        }
    
        const tabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
        if (tabs.length === 0) {
            debugLog(`No tabs remaining in window ${removeInfo.windowId}`);
            return;
        }

        tabs.sort((a, b) => a.index - b.index);
        
        // Find the rightmost tab to the left of the closed tab
        let targetTab = null;
        const leftTabs = tabs.filter(tab => tab.index < lastActiveTab.index);
        if (leftTabs.length > 0) {
            targetTab = leftTabs[leftTabs.length - 1];
            debugLog(`Found tab to the left at index ${targetTab.index}`);
        } else {
            targetTab = tabs[0]; // Fallback to leftmost tab
            debugLog(`No tab to the left found, selecting leftmost tab at index ${targetTab.index}`);
        }

        if (targetTab && !targetTab.active) {
            debugLog(`Activating target tab ${targetTab.id} at index ${targetTab.index}`);
            await chrome.tabs.update(targetTab.id, { active: true });
        }
        
    } catch (e) {
        debugLog(`Failed to activate tab after removal in window ${removeInfo.windowId}:`, e.message);
    }
});

chrome.runtime.onStartup.addListener(async () => {
    debugLog('Extension startup detected, cleaning up stale data');
    await cleanupStaleData();
});

chrome.runtime.onInstalled.addListener(async () => {
    debugLog('Extension installed/updated, initializing');
    await cleanupStaleData();
});

async function cleanupStaleData() {
    try {
        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};
        const allWindows = await chrome.windows.getAll();
        const validWindowIds = new Set(allWindows.map(w => w.id.toString()));
        
        let hasChanges = false;
        for (const windowId in allWindowsState) {
            if (!validWindowIds.has(windowId)) {
                delete allWindowsState[windowId];
                hasChanges = true;
                debugLog(`Removed stale data for window ${windowId}`);
            }
        }
        
        if (hasChanges) {
            await chrome.storage.session.set({ [STORAGE_KEY]: allWindowsState });
        }
    } catch (e) {
        debugLog('Failed to clean up stale data:', e.message);
    }
}
