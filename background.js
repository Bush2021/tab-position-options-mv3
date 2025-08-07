chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId)
        await chrome.storage.local.set({ 
            lastActiveTab: {
                id: tab.id,
                index: tab.index,
                windowId: tab.windowId
            }
        });
    } catch (e) {
        console.debug('Failed to get activated tab:', e.message)
    }
})

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const data = await chrome.storage.local.get('lastActiveTab');
    const lastActiveTab = data.lastActiveTab;
    if (!lastActiveTab || removeInfo.windowId !== lastActiveTab.windowId) {
        return;
    }
    if (tabId === lastActiveTab.id) {
        try {
            const tabs = await chrome.tabs.query({ windowId: removeInfo.windowId })
            if (tabs.length === 0) {
                await chrome.storage.local.remove('lastActiveTab');
                return
            }
            
            const targetIndex = Math.max(0, lastActiveTab.index - 1)
            const targetTab = tabs.find(tab => tab.index === targetIndex)
            if (!targetTab) {
                targetTab = tabs.find(tab => tab.index === lastActiveTab.index);
            }
            if (!targetTab && tabs.length > 0) {
                targetTab = tabs[0];
            }
            if (targetTab) {
                await chrome.tabs.update(targetTab.id, { active: true });
            }
        } catch (e) {
            console.debug('Failed to activate tab after removal:', e.message)
        }
    }
})