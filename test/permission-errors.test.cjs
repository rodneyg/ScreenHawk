const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const dist = path.join(__dirname, '../dist');
const manifest = require('../dist/manifest.json');
const popupUrl = 'chrome-extension://screenhawk/popup.html';
const tab = { id: 42, windowId: 7, active: true, url: 'https://example.test/' };
const captureError = 'ScreenHawk could not capture this tab. Try a regular web page and keep it active.';

function runBundle(name, globals) {
  const filename = path.join(dist, name);
  runInNewContext(readFileSync(filename, 'utf8'), globals, { filename });
}

function loadWorker(t, { executeScript, captureVisibleTab }) {
  const registerMessage = t.mock.fn();
  const chrome = {
    commands: { onCommand: { addListener: t.mock.fn() } },
    runtime: {
      id: 'screenhawk',
      getURL: () => popupUrl,
      onMessage: { addListener: registerMessage },
    },
    storage: { local: { setAccessLevel: async () => {} } },
    scripting: { executeScript: t.mock.fn(executeScript) },
    tabs: {
      query: async () => [tab],
      sendMessage: t.mock.fn(async () => ({ ok: true })),
      captureVisibleTab: t.mock.fn(captureVisibleTab),
      onActivated: { addListener: t.mock.fn(), removeListener: t.mock.fn() },
    },
  };

  runBundle(manifest.background.service_worker, { chrome });
  const [listener] = registerMessage.mock.calls[0].arguments;
  return {
    chrome,
    sendMessage(message) {
      return new Promise((resolve) => {
        assert.equal(listener(message, { id: chrome.runtime.id, url: popupUrl }, resolve), true);
      });
    },
  };
}

function loadPopup(t, sendMessage) {
  const registerClick = t.mock.fn();
  const capture = { disabled: false, addEventListener: registerClick };
  const draft = { disabled: false, addEventListener: t.mock.fn() };
  const wand = { disabled: false, addEventListener: t.mock.fn() };
  const status = { textContent: 'Previous error' };
  const settings = { addEventListener: t.mock.fn() };
  const close = t.mock.fn();
  const historyStatus = { textContent: '' };
  const elements = {
    '#capture': capture,
    '#draft': draft,
    '#wand': wand,
    '#status': status,
    '#settings': settings,
    '#history-list': { replaceChildren: t.mock.fn() },
    '#history-status': historyStatus,
  };
  runBundle('popup.js', {
    chrome: {
      runtime: { sendMessage },
      storage: { local: { get: async (defaults) => defaults } },
    },
    document: { querySelector: (selector) => elements[selector] },
    window: { close },
  });
  const [event, click] = registerClick.mock.calls[0].arguments;
  assert.equal(event, 'click');
  return { capture, draft, wand, status, close, click, historyStatus };
}

test('missing host permission stops capture before messaging the tab or taking a screenshot', async (t) => {
  const { chrome, sendMessage } = loadWorker(t, {
    executeScript: async () => { throw new Error('Cannot access contents of the page. Missing host permission.'); },
    captureVisibleTab: async () => {},
  });

  assert.deepEqual(structuredClone(await sendMessage({ action: 'startCapture' })), {
    ok: false,
    message: captureError,
  });
  assert.equal(chrome.scripting.executeScript.mock.callCount(), 1);
  assert.equal(chrome.tabs.sendMessage.mock.callCount(), 0);
  assert.equal(chrome.tabs.captureVisibleTab.mock.callCount(), 0);
});

test('a failed capture never starts selection and permits a retry on the same tab', async (t) => {
  const { chrome, sendMessage } = loadWorker(t, {
    executeScript: async () => [{ documentId: 'capture-document' }],
    captureVisibleTab: async () => { throw new Error('Capture failed'); },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.deepEqual(structuredClone(await sendMessage({ action: 'startCapture' })), {
      ok: false,
      message: captureError,
    });
  }
  assert.equal(chrome.tabs.captureVisibleTab.mock.callCount(), 2);
  assert.deepEqual(chrome.tabs.sendMessage.mock.calls.map(({ arguments: [, message] }) => message.action), [
    'resetCapture',
    'resetCapture',
  ]);
  const { addListener, removeListener } = chrome.tabs.onActivated;
  assert.equal(addListener.mock.callCount(), 2);
  assert.deepEqual(
    removeListener.mock.calls.map(({ arguments: [listener] }) => listener),
    addListener.mock.calls.map(({ arguments: [listener] }) => listener),
  );
});

test('the popup shows the worker error and lets the user retry', async (t) => {
  const { sendMessage } = loadWorker(t, {
    executeScript: async () => { throw new Error('Missing host permission'); },
    captureVisibleTab: async () => {},
  });
  const { capture, draft, wand, status, close, click, historyStatus } = loadPopup(t, sendMessage);

  click();
  assert.equal(capture.disabled, true);
  assert.equal(draft.disabled, true);
  assert.equal(wand.disabled, true);
  assert.equal(status.textContent, '');
  await new Promise(setImmediate);

  assert.equal(historyStatus.textContent, 'No saved interactions.');
  assert.equal(status.textContent, captureError);
  assert.equal(capture.disabled, false);
  assert.equal(draft.disabled, false);
  assert.equal(wand.disabled, false);
  assert.equal(close.mock.callCount(), 0);
});

test('the popup shows a fallback when runtime messaging fails', async (t) => {
  const { capture, status, close, click } = loadPopup(t, async () => {
    throw new Error('Could not establish connection');
  });

  click();
  await new Promise(setImmediate);

  assert.equal(status.textContent, 'Could not start ScreenHawk. Try again.');
  assert.equal(capture.disabled, false);
  assert.equal(close.mock.callCount(), 0);
});
