import { askOpenAI } from './api';
import { clearHistory, deleteInteraction, saveInteraction } from './history';

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

const formError = 'Click an editable text area on the page, then choose Draft for field again.';

const pickerError = 'Open a regular web page to choose a field.';

async function startFormDraft(tab?: chrome.tabs.Tab, action: 'startFormDraft' | 'activateMagicWand' = 'startFormDraft') {
  const message = action === 'startFormDraft' ? formError : pickerError;
  if (tab?.id === undefined || !tab.active || !/^https?:\/\//.test(tab.url ?? '')) {
    return { ok: false, message };
  }
  const [page] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const result = await chrome.tabs.sendMessage(tab.id, { action }, { documentId: page.documentId });
  return result?.ok ? { ok: true } : { ok: false, message };
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'magic-wand') {
    void (async () => {
      const activeTab = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const result = await startFormDraft(activeTab, 'activateMagicWand').catch(() => ({ ok: false, message: pickerError }));
      if (activeTab?.id !== undefined) {
        await chrome.action.setTitle({ tabId: activeTab.id, title: result.ok ? 'ScreenHawk' : pickerError });
      }
    })().catch(() => {});
    return;
  }
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
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  if (fromPopup) {
    if (message?.action === 'startCapture') {
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => startCapture(tab)).then(respond, () => respond({ ok: false, message: captureError }));
      return true;
    }
    if (message?.action === 'startFormDraft') {
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => startFormDraft(tab)).then(respond, () => respond({ ok: false, message: formError }));
      return true;
    }
    if (message?.action === 'activateMagicWand') {
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => startFormDraft(tab, 'activateMagicWand'))
        .then(respond, () => respond({ ok: false, message: pickerError }));
      return true;
    }
    if (message?.action === 'clearHistory') {
      restrictedStorage.then(clearHistory)
        .then(() => respond({ ok: true }), () => respond({ ok: false }));
      return true;
    }
  }

  const fromViewer = sender.url?.split('?')[0] === chrome.runtime.getURL('interaction-viewer.html');
  if ((fromPopup || fromViewer) && message?.action === 'deleteInteraction' && typeof message.id === 'string') {
    restrictedStorage.then(() => deleteInteraction(message.id))
      .then(() => respond({ ok: true }), () => respond({ ok: false }));
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
  if (typeof message?.id !== 'string' ||
      typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 2000) return;
  let image: string | undefined;
  let prompt = message.prompt;
  if (message.action === 'ask') {
    if (typeof message.image !== 'string' || !message.image.startsWith('data:image/png;base64,')) return;
    image = message.image;
  } else if (message.action === 'draft') {
    if (typeof message.fieldLabel !== 'string' || message.fieldLabel.length > 200) return;
    const context = JSON.stringify({ fieldLabel: message.fieldLabel, instructions: message.prompt });
    prompt = `Write only a draft for the user's text field. Use the field label as context.\n${context}`;
  } else {
    return;
  }

  const controller = new AbortController();
  pending.set(requestId, controller);
  const timeout = setTimeout(() => controller.abort(), 27000);
  void restrictedStorage
    .then(() => askOpenAI(prompt, image, controller.signal))
    .then(async (result) => {
      if (image && result.ok && !controller.signal.aborted) {
        try {
          await saveInteraction(prompt, result.answer, image, controller.signal, {
            url: sender.url, title: sender.tab?.title,
          });
        } catch {
          return { ...result, historySaveFailed: true };
        }
      }
      return result;
    })
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
