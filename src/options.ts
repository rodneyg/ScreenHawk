import { DEFAULT_MODEL, readSettings } from './settings';

const form = document.querySelector<HTMLFormElement>('form')!;
const key = document.querySelector<HTMLInputElement>('#api-key')!;
const model = document.querySelector<HTMLInputElement>('#model')!;
const status = document.querySelector<HTMLElement>('#status')!;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const inputs = form.querySelector<HTMLFieldSetElement>('fieldset')!;
  inputs.disabled = true;
  try {
    await chrome.storage.local.set({ apiKey: key.value.trim(), model: model.value.trim() || DEFAULT_MODEL });
    status.textContent = 'Settings saved on this device.';
  } catch {
    status.textContent = 'Could not save settings. Try again.';
  } finally {
    inputs.disabled = false;
  }
});

async function load() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const saved = await readSettings();
    key.value = saved.apiKey;
    model.value = saved.model;
    form.querySelector<HTMLFieldSetElement>('fieldset')!.disabled = false;
  } catch {
    status.textContent = 'Could not read settings. Reopen this page to try again.';
  }
}

void load();
