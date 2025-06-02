// interaction-viewer.ts

import { getInteraction, deleteInteraction, type Interaction } from './storage';
import { formatTimestamp } from './imageUtils';

document.addEventListener('DOMContentLoaded', () => {
  loadInteractionDetails();
});

async function loadInteractionDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const interactionId = urlParams.get('id');
  
  if (!interactionId) {
    showError('No interaction ID provided');
    return;
  }

  try {
    const interaction = await getInteraction(interactionId);
    
    if (!interaction) {
      showError('Interaction not found');
      return;
    }

    displayInteraction(interaction);
  } catch (error) {
    console.error('Error loading interaction:', error);
    showError('Error loading interaction details');
  }
}

function displayInteraction(interaction: Interaction) {
  const content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = `
    <div class="meta-info">
      <div class="meta-item">
        <span class="meta-label">Time:</span>
        <span class="meta-value">${formatTimestamp(interaction.timestamp)} (${new Date(interaction.timestamp).toLocaleString()})</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">URL:</span>
        <span class="meta-value">${interaction.url || 'Unknown'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Page:</span>
        <span class="meta-value">${interaction.title || 'Untitled'}</span>
      </div>
    </div>

    <div class="screenshot-section">
      <h2 class="section-title">Screenshot</h2>
      <img src="${interaction.screenshot}" alt="Screenshot" class="screenshot" onclick="openImageInNewTab('${interaction.screenshot}')">
    </div>

    <div class="prompt-section">
      <h2 class="section-title">Your Prompt</h2>
      <div class="prompt-text">${interaction.prompt}</div>
    </div>

    <div class="response-section">
      <h2 class="section-title">AI Response</h2>
      <div class="response-text">${interaction.response}</div>
    </div>

    <div class="actions">
      <button class="action-btn revisit-action" onclick="revisitPage('${interaction.url}')">Revisit Page</button>
      <button class="action-btn delete-action" onclick="deleteCurrentInteraction('${interaction.id}')">Delete Interaction</button>
    </div>
  `;
}

function showError(message: string) {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = `<div class="error">${message}</div>`;
  }
}

function openImageInNewTab(imageDataUrl: string) {
  const newWindow = window.open();
  if (newWindow) {
    newWindow.document.write(`
      <html>
        <head><title>Screenshot - ScreenHawk</title></head>
        <body style="margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000;">
          <img src="${imageDataUrl}" style="max-width: 100%; max-height: 100vh; object-fit: contain;">
        </body>
      </html>
    `);
  }
}

async function deleteCurrentInteraction(id: string) {
  if (confirm('Are you sure you want to delete this interaction?')) {
    try {
      await deleteInteraction(id);
      alert('Interaction deleted successfully');
      window.close();
    } catch (error) {
      console.error('Error deleting interaction:', error);
      alert('Error deleting interaction');
    }
  }
}

function revisitPage(url: string) {
  if (url && url !== 'Unknown') {
    chrome.tabs.create({ url: url });
  } else {
    alert('No URL available for this interaction');
  }
}

// Make functions globally available
(window as any).openImageInNewTab = openImageInNewTab;
(window as any).deleteCurrentInteraction = deleteCurrentInteraction;
(window as any).revisitPage = revisitPage;