// Expose a function that Puppeteer can call
chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    if (request.action === "duplicateTab") {
      chrome.tabs.query(
        { active: true, currentWindow: true },
        (tabs) => {
          const currentTab = tabs[0];
          chrome.tabs.duplicate(currentTab.id, (newTab) => {
            sendResponse({
              success: true,
              newTabId: newTab.id,
            });
          });
        },
      );
      return true; // Keep the message channel open for async response
    }
  },
);
