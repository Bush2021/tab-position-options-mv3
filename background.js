let lastActiveTab = null;

// keep the extension alive
const keepAlive = () => setInterval(chrome.runtime.getPlatformInfo, 20e3);
chrome.runtime.onStartup.addListener(keepAlive);
keepAlive();

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        lastActiveTab = {
            id: tab.id,
            index: tab.index
        }
    })
})

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!lastActiveTab) return
    if (tabId === lastActiveTab.id) {
        chrome.tabs.query({ windowId: removeInfo.windowId }, (tabs) => {
            if (tabs.length === 0) {
                lastActiveTab = null
                return
            }
            const targetIndex = Math.max(0, lastActiveTab.index - 1)
            const targetTab = tabs.find(tab => tab.index === targetIndex)
            if (targetTab) {
                chrome.tabs.update(targetTab.id, { active: true })
            } else if (tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, { active: true })
            }
        })
    }
})