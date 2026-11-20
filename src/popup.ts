const capture = document.querySelector<HTMLButtonElement>('#capture')!;
const draft = document.querySelector<HTMLButtonElement>('#draft')!;
const wand = document.querySelector<HTMLButtonElement>('#wand')!;
const status = document.querySelector<HTMLElement>('#status')!;

capture.addEventListener('click', () => void start('startCapture'));
draft.addEventListener('click', () => void start('startFormDraft'));

wand.addEventListener('click', () => void start('activateMagicWand'));

async function start(action: 'startCapture' | 'startFormDraft' | 'activateMagicWand') {
  capture.disabled = true;
  draft.disabled = true;
  wand.disabled = true;
  status.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action });
    if (result.ok) {
      window.close();
      return;
    }
    status.textContent = result.message;
  } catch {
    status.textContent = 'Could not start ScreenHawk. Try again.';
  } finally {
    capture.disabled = false;
    draft.disabled = false;
    wand.disabled = false;
  }
}

document.querySelector('#settings')!.addEventListener('click', async (event) => {
  event.preventDefault();
  await chrome.runtime.openOptionsPage();
  window.close();
});

export {};
