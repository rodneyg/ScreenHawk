export const DEFAULT_MODEL = 'gpt-6-luna';

export async function readSettings() {
  const { apiKey, model } = await chrome.storage.local.get({ apiKey: '', model: DEFAULT_MODEL });
  const savedModel = String(model).trim();
  const retiredDefault = savedModel === 'gpt-4.1-nano' || savedModel === 'gpt-4.1-nano-2025-04-14';
  return { apiKey: String(apiKey).trim(), model: retiredDefault ? DEFAULT_MODEL : savedModel || DEFAULT_MODEL };
}
