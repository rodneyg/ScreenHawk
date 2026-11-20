export const DEFAULT_MODEL = 'gpt-4.1-nano';

export async function readSettings() {
  const { apiKey, model } = await chrome.storage.local.get({ apiKey: '', model: DEFAULT_MODEL });
  return { apiKey: String(apiKey).trim(), model: String(model).trim() || DEFAULT_MODEL };
}
