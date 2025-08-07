chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await chrome.storage.session.set({
            lastActiveTab: {
                id: tab.id,
                index: tab.index,
                windowId: tab.windowId
            }
        });
    } catch (e) {
        console.debug('Failed to get activated tab:', e.message);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    const data = await chrome.storage.session.get('lastActiveTab');
    const lastActiveTab = data.lastActiveTab;

    if (!lastActiveTab || removeInfo.windowId !== lastActiveTab.windowId) {
        return;
    }

    if (tabId === lastActiveTab.id) {
        try {
            const tabs = await chrome.tabs.query({ windowId: removeInfo.windowId });
            if (tabs.length === 0) {
                await chrome.storage.session.remove('lastActiveTab');
                return;
            }

            const targetIndex = Math.max(0, lastActiveTab.index - 1);
            let targetTab = tabs.find(tab => tab.index === targetIndex);
            
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
            console.debug('Failed to activate tab after removal:', e.message);
        }
    }
});

chrome.tabs.onMoved.addListener(async (tabId, moveInfo) => {
    try {
        const data = await chrome.storage.session.get('lastActiveTab');
        const lastActiveTab = data.lastActiveTab;

        if (lastActiveTab && lastActiveTab.windowId === moveInfo.windowId) {
            const updatedTab = await chrome.tabs.get(lastActiveTab.id);
            await chrome.storage.session.set({ 
                lastActiveTab: {
                    id: updatedTab.id,
                    index: updatedTab.index,
                    windowId: updatedTab.windowId
                }
            });
        }
    } catch (e) {
        console.debug('Failed to update tab index after move:', e.message);
    }
});