// Background script
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.url) return;
    const url = new URL(tab.url);
    // Enables the side panel on youtube.com
    if (url.origin === 'https://www.youtube.com') {
        chrome.sidePanel.setOptions({
            tabId,
            path: 'sidepanel.html',
            enabled: true
        });
    } else {
        // Disables the side panel on other sites
        chrome.sidePanel.setOptions({
            tabId,
            enabled: false
        });
    }
});
