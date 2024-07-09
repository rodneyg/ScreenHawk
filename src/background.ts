// background.ts

import { sendToOpenAI } from './api';

console.log("Background script initializing...");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated");
});

chrome.commands.onCommand.addListener((command) => {
  console.log("Command received in background script:", command);
  if (command === "capture-screenshot") {
    console.log("Capture screenshot command received");
    captureAndSendScreenshot();
  }
});

function captureAndSendScreenshot() {
  console.log("Attempting to capture screenshot...");
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (chrome.runtime.lastError) {
      console.error("Error querying tabs:", chrome.runtime.lastError.message);
      return;
    }
    
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) {
      console.error("No active tab found");
      return;
    }

    chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error capturing screenshot:", chrome.runtime.lastError.message);
        return;
      }
      
      console.log("Screenshot captured successfully");
      sendMessageToContentScript(activeTab.id, dataUrl);
    });
  });
}

function sendMessageToContentScript(tabId: number, screenshot: string) {
  console.log(`Attempting to send message to content script in tab ${tabId}...`);
  chrome.tabs.sendMessage(
    tabId,
    { action: "showPromptDialog", screenshot: screenshot },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message to content script:", chrome.runtime.lastError.message);
        // Attempt to inject content script if it's not already there
        injectContentScript(tabId);
      } else {
        console.log("Message sent to content script, response:", response);
      }
    }
  );
}

function injectContentScript(tabId: number) {
  console.log(`Attempting to inject content script into tab ${tabId}...`);
  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      files: ['content.js']
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("Error injecting content script:", chrome.runtime.lastError.message);
      } else {
        console.log("Content script injected successfully");
        // Retry sending the message after injection
        chrome.tabs.captureVisibleTab(null, {format: 'png'}, (dataUrl) => {
          sendMessageToContentScript(tabId, dataUrl);
        });
      }
    }
  );
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background script received message:", request);

  if (request.action === "sendToOpenAI") {
    console.log("Background: Received sendToOpenAI request");
    console.log("Prompt:", request.prompt);
    console.log("Screenshot data:", request.screenshot ? "Available" : "Not available");
    console.log("Sending to OpenAI...");
    sendToOpenAI(request.prompt, request.screenshot)
      .then(response => {
        console.log("Received response from OpenAI:", response);
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {action: "openAIResponse", response}, (response) => {
              if (chrome.runtime.lastError) {
                console.error("Error sending response to content script:", chrome.runtime.lastError.message);
              } else {
                console.log("Response sent to content script");
              }
            });
          } else {
            console.error("No active tab found");
          }
        });
      })
      .catch(error => {
        console.error('Error in sendToOpenAI:', error);
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {action: "displayError", error: error.message});
          }
        });
      });
  } else {
    console.warn("Unknown action received:", request.action);
  }

  return true;
});

console.log("Background script loaded and ready.");          chrome.tabs.sendMessage(activeTab.id, {action: "showPromptDialog", screenshot: dataUrl}, (response) => {
            if (chrome.runtime.lastError) {
              console.error("Error sending message to content script:", chrome.runtime.lastError);
            } else {
              console.log("Message sent to content script, response:", response);
            }
          });
        } else {
          console.error("No active tab found");
        }
      });
    });
  } else {
    console.warn("Unknown command received:", command);
  }
});

console.log("Background script loaded and ready.");