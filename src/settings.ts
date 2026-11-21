export const DEFAULT_MODEL = 'gpt-6-luna';

export async function readSettings() {
  const { apiKey, model } = await chrome.storage.local.get({ apiKey: '', model: DEFAULT_MODEL });
  const savedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const savedModel = typeof model === 'string' ? model.trim() : '';
  const retiredDefault = savedModel === 'gpt-4.1-nano' || savedModel === 'gpt-4.1-nano-2025-04-14';
  return { apiKey: savedKey, model: retiredDefault ? DEFAULT_MODEL : savedModel || DEFAULT_MODEL };
}
