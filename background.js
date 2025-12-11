const STORAGE_KEY = 'activeTabsByWindow';
const DEBUG_MODE = false;

// Stores the activation delay timer IDs for each window.
// In the MV3 Service Worker environment, global variables may be reset when the Service Worker goes idle;
// however, this is the desired behavior, as an SW restart guarantees that any prior timers are invalidated, preventing side effects.
let activationDelayTimers = {}; 

function debugLog(message, data = null) {
    if (DEBUG_MODE) {
        console.log(`[TabPositionOptions] ${message}`, data || '');
    }
}

async function updateStoredActiveTab(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        return;
    }
    
    try {
        const [activeTab] = await chrome.tabs.query({ 
            active: true, 
            windowId: windowId 
        });
        
        if (!activeTab) {
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
    const windowId = activeInfo.windowId;
    debugLog(`Tab activated: ${activeInfo.tabId} (Queueing delayed update)`);

    // If there are already pending updates for this window, cancel them 
    // (to prevent quick switching from causing an overwrite error)
    if (activationDelayTimers[windowId]) {
        clearTimeout(activationDelayTimers[windowId]);
    }

    // Set a 150ms delay.
    // If this activation is triggered by a "tab close", onRemoved will fire within these 150ms,
    // at which point the Storage still holds the "closed tab" as LastActive,
    // allowing the logic in onRemoved to succeed.
    activationDelayTimers[windowId] = setTimeout(() => {
        updateStoredActiveTab(windowId);
        delete activationDelayTimers[windowId];
    }, 150);
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    updateStoredActiveTab(moveInfo.windowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    updateStoredActiveTab(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
    updateStoredActiveTab(detachInfo.oldWindowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        // Window focus change does not need delay, update directly
        updateStoredActiveTab(windowId);
    }
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    chrome.tabs.get(addedTabId).then(tab => {
        updateStoredActiveTab(tab.windowId);
    }).catch(e => {
        debugLog('Failed to handle tab replacement:', e.message);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active && changeInfo.pinned !== undefined) {
        updateStoredActiveTab(tab.windowId);
    }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    // When a window is closed, clear any pending timers
    if (activationDelayTimers[windowId]) {
        clearTimeout(activationDelayTimers[windowId]);
        delete activationDelayTimers[windowId];
    }

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
        return;
    }

    try {
        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};
        const lastActiveTab = allWindowsState[removeInfo.windowId];

        // This is the core logic: if tabId == lastActiveTab.id, it means the user just closed the "currently active tab".
        // Because onActivated is delayed by 150ms, the data in storage hasn't changed yet,
        // so this should successfully match.
        if (!lastActiveTab || tabId !== lastActiveTab.id) {
            debugLog(`Tab ${tabId} was not the last active tab (or storage updated too fast)`);
            return;
        }
    
        const tabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
        if (tabs.length === 0) {
            return;
        }

        tabs.sort((a, b) => a.index - b.index);
        
        // Find the target tab: prefer the one to the left (index less than lastActiveTab.index)
        let targetTab = null;
        const leftTabs = tabs.filter(tab => tab.index < lastActiveTab.index);
        
        if (leftTabs.length > 0) {
            targetTab = leftTabs[leftTabs.length - 1]; // The closest one on the left
            debugLog(`Found tab to the left at index ${targetTab.index}`);
        } else {
            targetTab = tabs[0]; // If no tabs to the left, fall back to the leftmost tab (or you can change to the rightmost, based on preference)
            debugLog(`No tab to the left found, selecting leftmost tab at index ${targetTab.index}`);
        }

        // Only switch if the tab automatically selected by Chrome (usually the one on the right) is not the one we want
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
        // Clean up data for windows that no longer exist
        for (const windowId in allWindowsState) {
            if (!validWindowIds.has(windowId)) {
                delete allWindowsState[windowId];
                hasChanges = true;
            }
        }
        
        // Also clean up any potential zombie timer IDs (although memory is reset, just to keep logic tidy)
        activationDelayTimers = {};

        if (hasChanges) {
            await chrome.storage.session.set({ [STORAGE_KEY]: allWindowsState });
        }
    } catch (e) {
        debugLog('Failed to clean up stale data:', e.message);
    }
}
