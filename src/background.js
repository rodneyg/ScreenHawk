"use strict";
// background.ts
Object.defineProperty(exports, "__esModule", { value: true });
var api_1 = require("./api");
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "captureScreenshot") {
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, function (dataUrl) {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                var activeTab = tabs[0];
                if (activeTab.id) {
                    chrome.tabs.sendMessage(activeTab.id, { action: "showPromptDialog", screenshot: dataUrl });
                }
            });
        });
    }
    else if (request.action === "sendToOpenAI") {
        (0, api_1.sendToOpenAI)(request.prompt, request.screenshot)
            .then(function (response) {
            chrome.tabs.create({ url: 'chat.html' }, function (tab) {
                if (tab.id) {
                    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                        if (tabId === tab.id && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            chrome.tabs.sendMessage(tabId, { action: "displayResponse", response: response });
                        }
                    });
                }
            });
        })
            .catch(function (error) {
            console.error('Error in sendToOpenAI:', error);
            // Handle error (e.g., show an error message to the user)
        });
    }
});
