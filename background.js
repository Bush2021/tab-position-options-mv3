self.addEventListener('error', (event) => {
    console.debug('Service Worker error:', event.error)
})

self.addEventListener('unhandledrejection', (event) => {
    console.debug('Unhandled promise rejection:', event.reason)
    event.preventDefault()
})

let lastActiveTab = null

/**
 * keep-alive related code are kanged from 
 * https://github.com/AdguardTeam/AdguardBrowserExtension/blob/8ad5a8963fe31c3144641ab96036bb1a03e70b5a/Extension/src/background/keep-alive.ts#L179
 */
const KEEP_ALIVE_PORT_NAME = 'keep-alive'

function setupKeepAlive() {
    setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {
            if (chrome.runtime.lastError) {
                console.debug('Keep-alive ping failed:', chrome.runtime.lastError.message)
            }
        })
    }, 25000)
}

chrome.runtime.onStartup.addListener(() => {
    console.debug('Extension startup')
    lastActiveTab = null
})

chrome.runtime.onInstalled.addListener(() => {
    console.debug('Extension installed/updated')
    lastActiveTab = null
})

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === KEEP_ALIVE_PORT_NAME) {
        port.onDisconnect.addListener(() => {
            console.debug('Keep-alive port disconnected')
        })
    }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && isValidUrl(tab.url)) {
        injectKeepAliveScript(tabId)
    }
})

function isValidUrl(url) {
    if (!url) return false
    
    const invalidPatterns = [
        'chrome://',
        'chrome-extension://',
        'edge://',
        'moz-extension://',
        'about:',
        'data:',
        'file://',
        'chrome.google.com/webstore'
    ]
    
    return url.startsWith('http://') || url.startsWith('https://') && 
           !invalidPatterns.some(pattern => url.includes(pattern))
}

async function injectKeepAliveScript(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId)
        if (!tab) return
        
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                if (window.keepAliveActive) {
                    return
                }

                function connect() {
                    try {
                        const port = chrome.runtime.connect({ name: 'keep-alive' })
                        port.onDisconnect.addListener(() => {
                            setTimeout(connect, 1000)
                        })
                    } catch (e) {
                        setTimeout(connect, 2000)
                    }
                }

                window.addEventListener('pageshow', (event) => {
                    if (event.persisted) {
                        connect()
                    }
                })

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        connect()
                    }
                })

                connect()
                window.keepAliveActive = true
            }
        })
    } catch (e) {
        console.debug('Failed to inject keep-alive script:', e.message)
    }
}

setupKeepAlive()

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId)
        lastActiveTab = {
            id: tab.id,
            index: tab.index
        }
    } catch (e) {
        console.debug('Failed to get activated tab:', e.message)
    }
})

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    if (!lastActiveTab) return
    if (tabId === lastActiveTab.id) {
        try {
            const tabs = await chrome.tabs.query({ windowId: removeInfo.windowId })
            if (tabs.length === 0) {
                lastActiveTab = null
                return
            }
            
            const targetIndex = Math.max(0, lastActiveTab.index - 1)
            const targetTab = tabs.find(tab => tab.index === targetIndex)
            
            if (targetTab) {
                await chrome.tabs.update(targetTab.id, { active: true })
            } else if (tabs.length > 0) {
                await chrome.tabs.update(tabs[0].id, { active: true })
            }
        } catch (e) {
            console.debug('Failed to activate tab after removal:', e.message)
        }
    }
})