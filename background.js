const STORAGE_KEY = 'activeTabsByWindow';

async function updateStoredActiveTab(windowId) {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        return;
    }
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
        if (!activeTab) return;

        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};

        allWindowsState[windowId] = {
            id: activeTab.id,
            index: activeTab.index,
            windowId: activeTab.windowId
        };

        await chrome.storage.session.set({ [STORAGE_KEY]: allWindowsState });
    } catch (e) {
        console.debug('Failed to update stored active tab:', e.message);
    }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
    updateStoredActiveTab(activeInfo.windowId);
});

chrome.tabs.onMoved.addListener((_tabId, moveInfo) => {
    updateStoredActiveTab(moveInfo.windowId);
});

chrome.tabs.onAttached.addListener((_tabId, attachInfo) => {
    updateStoredActiveTab(attachInfo.newWindowId);
});

chrome.tabs.onDetached.addListener((_tabId, detachInfo) => {
    updateStoredActiveTab(detachInfo.oldWindowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    updateStoredActiveTab(windowId);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
    try {
        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};
        if (allWindowsState[windowId]) {
            delete allWindowsState[windowId];
            await chrome.storage.session.set({ [STORAGE_KEY]: allWindowsState });
        }
    } catch (e) {
        console.debug('Failed to clean up window state:', e.message);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) return;

    try {
        const data = await chrome.storage.session.get(STORAGE_KEY);
        const allWindowsState = data[STORAGE_KEY] || {};

        const lastActiveTab = allWindowsState[removeInfo.windowId];

        if (!lastActiveTab || tabId !== lastActiveTab.id) {
            return;
        }
    
        const tabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
        if (tabs.length === 0) return;
        
        const targetIndex = Math.max(0, lastActiveTab.index - 1);
        let targetTab = tabs.find(tab => tab.index === targetIndex);
        
        if (!targetTab) {
            targetTab = tabs.find(tab => tab.index === lastActiveTab.index);
        }
        if (!targetTab) {
            targetTab = tabs[0];
        }

        if (targetTab) {
            await chrome.tabs.update(targetTab.id, { active: true });
        }
    } catch (e) {
        console.debug('Failed to activate tab after removal:', e.message);
    }
});