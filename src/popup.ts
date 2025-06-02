// popup.ts

/// <reference types="chrome"/>

import { loadInteractions, deleteInteraction, clearAllInteractions, type Interaction } from './storage';
import { formatTimestamp, truncateText } from './imageUtils';

document.addEventListener('DOMContentLoaded', () => {
  initializePopup();
});

async function initializePopup() {
  // Set up capture button
  const captureButton = document.getElementById('captureButton');
  if (captureButton) {
    captureButton.addEventListener('click', handleCapture);
  } else {
    console.error('Capture button not found');
  }

  // Set up clear history button
  const clearHistoryButton = document.getElementById('clearHistoryButton');
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', handleClearHistory);
  }

  // Load and display history
  await loadHistory();
}

function handleCapture() {
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
}

async function handleClearHistory() {
  if (confirm('Are you sure you want to clear all interaction history?')) {
    try {
      await clearAllInteractions();
      await loadHistory();
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Error clearing history');
    }
  }
}

async function loadHistory() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  try {
    const interactions = await loadInteractions();
    
    if (interactions.length === 0) {
      historyList.innerHTML = '<div class="empty-history">No interactions yet. Capture your first screenshot!</div>';
      return;
    }

    historyList.innerHTML = '';
    
    interactions.forEach(interaction => {
      const historyItem = createHistoryItem(interaction);
      historyList.appendChild(historyItem);
    });
  } catch (error) {
    console.error('Error loading history:', error);
    historyList.innerHTML = '<div class="empty-history">Error loading history</div>';
  }
}

function createHistoryItem(interaction: Interaction): HTMLElement {
  const item = document.createElement('div');
  item.className = 'history-item';
  
  item.innerHTML = `
    <img src="${interaction.thumbnail}" alt="Screenshot thumbnail" class="thumbnail">
    <div class="item-content">
      <div class="item-prompt">${truncateText(interaction.prompt, 60)}</div>
      <div class="item-time">${formatTimestamp(interaction.timestamp)}</div>
    </div>
    <div class="item-actions">
      <button class="action-btn view-btn" data-id="${interaction.id}">View</button>
      <button class="action-btn delete-btn" data-id="${interaction.id}">Delete</button>
    </div>
  `;

  // Add event listeners
  const viewBtn = item.querySelector('.view-btn') as HTMLButtonElement;
  const deleteBtn = item.querySelector('.delete-btn') as HTMLButtonElement;

  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleViewInteraction(interaction.id);
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDeleteInteraction(interaction.id);
  });

  // Make the whole item clickable to view
  item.addEventListener('click', () => {
    handleViewInteraction(interaction.id);
  });

  return item;
}

async function handleViewInteraction(id: string) {
  try {
    const interactions = await loadInteractions();
    const interaction = interactions.find(i => i.id === id);
    
    if (!interaction) {
      alert('Interaction not found');
      return;
    }

    // Create a new tab to display the interaction details
    chrome.tabs.create({
      url: chrome.runtime.getURL('interaction-viewer.html') + '?id=' + id
    });
  } catch (error) {
    console.error('Error viewing interaction:', error);
    alert('Error viewing interaction');
  }
}

async function handleDeleteInteraction(id: string) {
  if (confirm('Are you sure you want to delete this interaction?')) {
    try {
      await deleteInteraction(id);
      await loadHistory();
    } catch (error) {
      console.error('Error deleting interaction:', error);
      alert('Error deleting interaction');
    }
  }
}