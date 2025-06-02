// storage.ts - Interface and utilities for interaction history storage

export interface Interaction {
  id: string;
  timestamp: number;
  url: string;
  title: string;
  prompt: string;
  response: string;
  screenshot: string; // compressed base64
  thumbnail: string;  // small compressed thumbnail for display
}

export interface StorageData {
  interactions: Interaction[];
}

const STORAGE_KEY = 'screenhawk_interactions';
const MAX_INTERACTIONS = 50; // Limit storage to prevent excessive memory usage

/**
 * Save an interaction to chrome.storage.local
 */
export async function saveInteraction(interaction: Interaction): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data: StorageData = result[STORAGE_KEY] || { interactions: [] };
    
    // Add new interaction to the beginning of the array
    data.interactions.unshift(interaction);
    
    // Keep only the most recent MAX_INTERACTIONS
    if (data.interactions.length > MAX_INTERACTIONS) {
      data.interactions = data.interactions.slice(0, MAX_INTERACTIONS);
    }
    
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    console.log('Interaction saved successfully');
  } catch (error) {
    console.error('Error saving interaction:', error);
    throw error;
  }
}

/**
 * Load all interactions from chrome.storage.local
 */
export async function loadInteractions(): Promise<Interaction[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data: StorageData = result[STORAGE_KEY] || { interactions: [] };
    return data.interactions;
  } catch (error) {
    console.error('Error loading interactions:', error);
    return [];
  }
}

/**
 * Delete an interaction by ID
 */
export async function deleteInteraction(id: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data: StorageData = result[STORAGE_KEY] || { interactions: [] };
    
    data.interactions = data.interactions.filter(interaction => interaction.id !== id);
    
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    console.log('Interaction deleted successfully');
  } catch (error) {
    console.error('Error deleting interaction:', error);
    throw error;
  }
}

/**
 * Clear all interactions
 */
export async function clearAllInteractions(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: { interactions: [] } });
    console.log('All interactions cleared successfully');
  } catch (error) {
    console.error('Error clearing interactions:', error);
    throw error;
  }
}

/**
 * Get interaction by ID
 */
export async function getInteraction(id: string): Promise<Interaction | null> {
  try {
    const interactions = await loadInteractions();
    return interactions.find(interaction => interaction.id === id) || null;
  } catch (error) {
    console.error('Error getting interaction:', error);
    return null;
  }
}