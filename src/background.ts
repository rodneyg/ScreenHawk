import { askOpenAI } from './api';

const restrictedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const starting = new Set<number>();
const pending = new Map<string, AbortController>();
const captureError = 'ScreenHawk could not capture this tab. Try a regular web page and keep it active.';

async function startCapture(tab?: chrome.tabs.Tab) {
  if (tab?.id === undefined || !tab.active || !/^https?:\/\//.test(tab.url ?? '')) {
    return { ok: false, message: 'Open a regular web page to start a capture.' };
  }
  const { id, windowId } = tab;
  if (starting.has(id)) return { ok: false, message: 'A capture is already starting.' };
  starting.add(id);
  let switchedTabs = false;
  const watchActiveTab = (event: { windowId: number; tabId: number }) => {
    if (event.windowId === windowId && event.tabId !== id) switchedTabs = true;
  };
  chrome.tabs.onActivated.addListener(watchActiveTab);
  try {
    const [page] = await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    const destination = { documentId: page.documentId };
    await chrome.tabs.sendMessage(id, { action: 'resetCapture' }, destination);
    const [activeBeforeCapture] = await chrome.tabs.query({ active: true, windowId });
    if (switchedTabs || activeBeforeCapture?.id !== id) {
      return { ok: false, message: captureError };
    }
    const image = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    const [activeAfterCapture] = await chrome.tabs.query({ active: true, windowId });
    if (switchedTabs || activeAfterCapture?.id !== id) {
      return { ok: false, message: captureError };
    }
    const result = await chrome.tabs.sendMessage(id, { action: 'startSelection', image }, destination);
    return result?.ok ? { ok: true } : { ok: false, message: captureError };
  } catch {
    return { ok: false, message: captureError };
  } finally {
    chrome.tabs.onActivated.removeListener(watchActiveTab);
    starting.delete(id);
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'capture-screenshot') return;
  void (async () => {
    const result = await startCapture(tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
    if (!result.ok && tab?.id !== undefined) {
      await chrome.action.setTitle({ tabId: tab.id, title: result.message ?? captureError });
    } else if (tab?.id !== undefined) {
      await chrome.action.setTitle({ tabId: tab.id, title: 'ScreenHawk' });
    }
  })().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.action === 'startCapture' && sender.url === chrome.runtime.getURL('popup.html')) {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => startCapture(tab)).then(respond, () => respond({ ok: false, message: captureError }));
    return true;
  }

  if (sender.tab?.id === undefined || sender.frameId !== 0 || !sender.documentId) return;

  if (message?.action === 'openOptions') {
    chrome.runtime.openOptionsPage().then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }

  const requestId = `${sender.documentId}:${message?.id}`;
  if (message?.action === 'cancelQuestion') {
    pending.get(requestId)?.abort();
    return;
  }
  if (message?.action !== 'ask' ||
      typeof message.id !== 'string' ||
      typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 2000 ||
      typeof message.image !== 'string' || !message.image.startsWith('data:image/png;base64,')) return;

  const controller = new AbortController();
  pending.set(requestId, controller);
  const timeout = setTimeout(() => controller.abort(), 27000);
  void restrictedStorage
    .then(() => askOpenAI(message.prompt, message.image, controller.signal))
    .then(respond, () => respond({
      ok: false,
      message: controller.signal.aborted
        ? 'The request stopped. Try again.'
        : 'Could not reach OpenAI. Check your connection and try again.',
    }))
    .finally(() => {
      clearTimeout(timeout);
      pending.delete(requestId);
    });
  return true;
});
