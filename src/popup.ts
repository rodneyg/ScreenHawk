// popup.ts

/// <reference types="chrome"/>

document.addEventListener('DOMContentLoaded', () => {
  const captureButton = document.getElementById('captureButton');
  if (captureButton) {
    captureButton.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.id) {
          chrome.scripting.executeScript(
            {
              target: { tabId: activeTab.id },
              files: ['content.js']
            },
            () => {
              if (chrome.runtime.lastError) {
                console.error('Script injection failed:', chrome.runtime.lastError);
                return;
              }
              chrome.tabs.sendMessage(activeTab.id!, { action: "prepareCapture" }, (response) => {
                if (chrome.runtime.lastError) {
                  console.error('Error:', JSON.stringify(chrome.runtime.lastError));
                  alert(`Error: ${chrome.runtime.lastError.message}`);
                } else {
                  console.log('Message sent successfully');
                  console.log('Response:', JSON.stringify(response));
                  window.close();
                }
              });
            }
          );
        } else {
          console.error('No active tab found');
          alert('No active tab found');
        }
      });
    });
  } else {
    console.error('Capture button not found');
  }
});

chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  const activeTab = tabs[0];
  if (activeTab && activeTab.id) {
    chrome.tabs.sendMessage(activeTab.id, {action: "prepareCapture"}, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message:", chrome.runtime.lastError);
      } else {
        console.log("Message sent successfully, response:", response);
      }
    });
  } else {
    console.error("No active tab found");
  }
});