// background.ts

import { sendToOpenAI } from './api';
import { saveInteraction, type Interaction } from './storage';
import { compressImage, createThumbnail, generateId } from './imageUtils';

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
    if (!activeTab || typeof activeTab.id !== 'number') {
      console.error("No active tab found or tab ID is not a number");
      return;
    }

    chrome.tabs.captureVisibleTab(
      activeTab.windowId,
      {format: 'png'},
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error("Error capturing screenshot:", chrome.runtime.lastError.message);
          return;
        }
        
        console.log("Screenshot captured successfully");
        sendMessageToContentScript(activeTab.id ?? 0, dataUrl);
      }
    );
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
        chrome.tabs.captureVisibleTab(
          tabId,
          {format: 'png'},
          (dataUrl) => {
            sendMessageToContentScript(tabId, dataUrl);
          }
        );
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
    
    // Get current tab info for storing in interaction
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const activeTab = tabs[0];
      const tabUrl = activeTab?.url || '';
      const tabTitle = activeTab?.title || '';
      
      sendToOpenAI(request.prompt, request.screenshot)
        .then(async response => {
          console.log("Received response from OpenAI:", response);
          
          // Save interaction to storage
          try {
            const [compressedScreenshot, thumbnail] = await Promise.all([
              compressImage(request.screenshot, 0.6, 1200),
              createThumbnail(request.screenshot, 120)
            ]);
            
            const interaction: Interaction = {
              id: generateId(),
              timestamp: Date.now(),
              url: tabUrl,
              title: tabTitle,
              prompt: request.prompt,
              response: response,
              screenshot: compressedScreenshot,
              thumbnail: thumbnail
            };
            
            await saveInteraction(interaction);
            console.log("Interaction saved to storage");
          } catch (error) {
            console.error("Error saving interaction:", error);
          }
          
          // Send response to content script
          if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, {action: "openAIResponse", response}, (response) => {
              if (chrome.runtime.lastError) {
                console.error("Error sending response to content script:", chrome.runtime.lastError.message);
              } else {
                console.log("Response sent to content script");
              }
            });
          } else {
            console.error("No active tab found");
          }
        })
        .catch(error => {
          console.error('Error in sendToOpenAI:', error);
          if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, {action: "displayError", error: error.message});
          }
        });
    });
  } else {
    console.warn("Unknown action received:", request.action);
  }

  return true;
});