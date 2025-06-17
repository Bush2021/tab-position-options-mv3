let lastActiveTab = null

/**
 * keep-alive related code are kanged from 
 * https://github.com/AdguardTeam/AdguardBrowserExtension/blob/8ad5a8963fe31c3144641ab96036bb1a03e70b5a/Extension/src/background/keep-alive.ts#L179
 */
const KEEP_ALIVE_PORT_NAME = 'keep-alive'

function setupKeepAlive() {
    setInterval(() => {
        chrome.runtime.getPlatformInfo(() => { })
    }, 20000)
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === KEEP_ALIVE_PORT_NAME) {
    }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        try {
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    if (window.keepAliveActive) {
                        return
                    }

                    function connect() {
                        chrome.runtime.connect({ name: 'keep-alive' })
                            .onDisconnect
                            .addListener(() => {
                                connect()
                            })
                    }

                    window.addEventListener('pageshow', (event) => {
                        if (event.persisted) {
                            connect()
                        }
                    })

                    connect()
                    window.keepAliveActive = true
                }
            })
        } catch (e) {
        }
    }
})

setupKeepAlive()

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