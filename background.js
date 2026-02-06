// Locked Out - Background Service Worker

const BLOCKED_PAGE_URL = chrome.runtime.getURL('popup/popup.html');
const SUPER_BLOCKED_PAGE_URL = chrome.runtime.getURL('popup/blocked.html');
const DEFAULT_API_KEY = '';

// Track allowed tabs temporarily
const allowedTabs = new Map();

// Time tracking - track per-tab, only when user is active
const tabTracking = new Map(); // tabId -> { hostname, startTime, lastActive }
let dailyUsage = {};

// Track user idle state
let isUserIdle = false;

// Get hostname from URL
function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

// Reset daily usage at midnight
function resetDailyUsage() {
  const today = new Date().toDateString();
  chrome.storage.local.get(['lastResetDate', 'dailyUsage'], (result) => {
    if (result.lastResetDate !== today) {
      dailyUsage = {};
      chrome.storage.local.set({
        lastResetDate: today,
        dailyUsage: {}
      });
    } else {
      dailyUsage = result.dailyUsage || {};
    }
  });
}

// Initialize
resetDailyUsage();
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.get(['apiKey', 'blocklist', 'superBlocklist'], (result) => {
    if (!result.apiKey) chrome.storage.local.set({ apiKey: DEFAULT_API_KEY });
    if (!result.blocklist) chrome.storage.local.set({ blocklist: [] });
    if (!result.superBlocklist) chrome.storage.local.set({ superBlocklist: [] });
  });
});

function isSuperBlocked(url, superBlocklist) {
  if (!superBlocklist || superBlocklist.length === 0) return false;
  const hostname = new URL(url).hostname;
  return superBlocklist.some(site => {
    const cleanSite = site.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const cleanHostname = hostname.replace(/^www\./, '');
    return cleanHostname === cleanSite || cleanHostname.endsWith('.' + cleanSite);
  });
}

function isBlocked(url, blocklist) {
  if (!blocklist || blocklist.length === 0) return false;
  const hostname = new URL(url).hostname;
  return blocklist.some(site => {
    const cleanSite = site.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const cleanHostname = hostname.replace(/^www\./, '');
    return cleanHostname === cleanSite || cleanHostname.endsWith('.' + cleanSite);
  });
}

function formatTime(ms) {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

// Save time for a tab
function saveTabTime(tabId) {
  if (tabTracking.has(tabId)) {
    const { hostname, startTime } = tabTracking.get(tabId);
    const elapsed = Date.now() - startTime;
    dailyUsage[hostname] = (dailyUsage[hostname] || 0) + elapsed;
    chrome.storage.local.set({ dailyUsage });
    tabTracking.delete(tabId);
  }
}

// Track user idle state
chrome.idle.onStateChanged.addListener(async (newState) => {
  const wasIdle = isUserIdle;
  isUserIdle = newState === 'idle' || newState === 'locked';

  // State changed: idle -> active OR active -> idle
  if (wasIdle && !isUserIdle) {
    // User came back - track the current active tab
    const [activeTab] = await chrome.tabs.query({ active: true });
    if (activeTab && activeTab.url) {
      const hostname = getHostname(activeTab.url);
      if (hostname && !activeTab.url.startsWith('chrome://') && !activeTab.url.startsWith('chrome-extension://')) {
        tabTracking.set(activeTab.id, { hostname, startTime: Date.now() });
      }
    }
  } else if (!wasIdle && isUserIdle) {
    // User went idle - save time for all tracked tabs
    for (const [tabId, data] of tabTracking.entries()) {
      const elapsed = Date.now() - data.startTime;
      dailyUsage[data.hostname] = (dailyUsage[data.hostname] || 0) + elapsed;
    }
    chrome.storage.local.set({ dailyUsage });
    tabTracking.clear();
  }
});

// Track tab activation (user switches to this tab)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
    const hostname = getHostname(tab.url);
    if (hostname && !isUserIdle) {
      // Start tracking this tab
      tabTracking.set(tab.id, { hostname, startTime: Date.now() });
    }
  }
});

// When a tab updates (navigation completes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.active && !isUserIdle) {
    const hostname = getHostname(tab.url);
    if (hostname) {
      tabTracking.set(tabId, { hostname, startTime: Date.now() });
    }
  }
});

// When tab is removed
chrome.tabs.onRemoved.addListener(saveTabTime);

// When tab is deactivated (user switches away)
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (activeInfo.previousTabId) {
    saveTabTime(activeInfo.previousTabId);
  }
});

// Focus changes (window focus)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Lost focus - save time
    for (const [tabId, data] of tabTracking.entries()) {
      const elapsed = Date.now() - data.startTime;
      dailyUsage[data.hostname] = (dailyUsage[data.hostname] || 0) + elapsed;
    }
    chrome.storage.local.set({ dailyUsage });
    tabTracking.clear();
  } else {
    // Gained focus - track active tab in this window
    chrome.tabs.query({ active: true, windowId }).then((tabs) => {
      if (tabs[0] && tabs[0].url) {
        const hostname = getHostname(tabs[0].url);
        if (hostname && !isUserIdle) {
          tabTracking.set(tabs[0].id, { hostname, startTime: Date.now() });
        }
      }
    });
  }
});

// Listen for navigation events
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.parentFrameId !== -1) return;
  if (details.url.startsWith('chrome://') ||
      details.url.startsWith('chrome-extension://') ||
      details.url.startsWith('about:')) {
    return;
  }

  // Check if this tab was just allowed through
  if (allowedTabs.has(details.tabId)) {
    allowedTabs.delete(details.tabId);
    return;
  }

  const result = await chrome.storage.local.get(['blocklist', 'superBlocklist']);
  const { blocklist = [], superBlocklist = [] } = result;

  // Check super-blocklist first
  if (isSuperBlocked(details.url, superBlocklist)) {
    const redirectUrl = `${SUPER_BLOCKED_PAGE_URL}?url=${encodeURIComponent(details.url)}&t=${Date.now()}`;
    chrome.tabs.update(details.tabId, { url: redirectUrl });
    return;
  }

  // Then check regular blocklist
  if (isBlocked(details.url, blocklist)) {
    const redirectUrl = `${BLOCKED_PAGE_URL}?url=${encodeURIComponent(details.url)}&tabId=${details.tabId}&t=${Date.now()}`;
    chrome.tabs.update(details.tabId, { url: redirectUrl });
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'allowSite') {
    if (sender.tab && sender.tab.id) {
      allowedTabs.set(sender.tab.id, true);
      chrome.tabs.update(sender.tab.id, { url: request.url });
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'getTimeSpent') {
    const hostname = request.hostname;

    // Get stored time plus any currently active time
    let timeSpent = dailyUsage[hostname] || 0;

    for (const [tabId, data] of tabTracking.entries()) {
      if (data.hostname === hostname && !isUserIdle) {
        const elapsed = Date.now() - data.startTime;
        timeSpent += elapsed;
      }
    }

    sendResponse({ timeSpent: formatTime(timeSpent), ms: timeSpent });
    return true;
  }

  if (request.action === 'closeTab') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
    sendResponse({ success: true });
    return true;
  }
});
