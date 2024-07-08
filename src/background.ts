// background.ts

import { sendToOpenAI } from './api';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background script received message:", request);

  if (request.action === "captureScreenshot") {
    console.log("Capturing screenshot...");
    chrome.tabs.captureVisibleTab({format: 'png'}, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error capturing screenshot:", chrome.runtime.lastError);
        return;
      }
      console.log("Screenshot captured successfully");
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, {action: "showPromptDialog", screenshot: dataUrl}, (response) => {
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
  } else if (request.action === "sendToOpenAI") {
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
                console.error("Error sending response to content script:", chrome.runtime.lastError);
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
        // Send error message to the current tab
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {action: "displayError", error: error.message});
          }
        });
      });
  } else {
    console.warn("Unknown action received:", request.action);
  }

  // Return true to indicate that we will respond asynchronously
  return true;
});

console.log("Background script loaded");