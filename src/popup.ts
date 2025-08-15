// popup.ts

/// <reference types="chrome"/>

document.addEventListener('DOMContentLoaded', () => {
  const captureButton = document.getElementById('captureButton');
  const magicWandButton = document.getElementById('magicWandButton');
  
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
  
  if (magicWandButton) {
    magicWandButton.addEventListener('click', () => {
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
              chrome.tabs.sendMessage(activeTab.id!, { action: "activateMagicWand" }, (response) => {
                if (chrome.runtime.lastError) {
                  console.error('Error:', JSON.stringify(chrome.runtime.lastError));
                  alert(`Error: ${chrome.runtime.lastError.message}`);
                } else {
                  console.log('Magic wand activated successfully');
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
    console.error('Magic wand button not found');
  }
});