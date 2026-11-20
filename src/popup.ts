const capture = document.querySelector<HTMLButtonElement>('#capture')!;
const status = document.querySelector<HTMLElement>('#status')!;

capture.addEventListener('click', async () => {
  capture.disabled = true;
  status.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({ action: 'startCapture' });
    if (result.ok) {
      window.close();
      return;
    }
    status.textContent = result.message;
  } catch {
    status.textContent = 'Could not start ScreenHawk. Try again.';
  } finally {
    capture.disabled = false;
  }
});

document.querySelector('#settings')!.addEventListener('click', async (event) => {
  event.preventDefault();
  await chrome.runtime.openOptionsPage();
  window.close();
});

export {};
