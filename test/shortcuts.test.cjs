const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');
const { runInNewContext } = require('node:vm');

const manifest = require('../dist/manifest.json');
const workerPath = path.join(__dirname, '../dist', manifest.background.service_worker);
const worker = readFileSync(workerPath, 'utf8');
const captureCommand = 'capture-screenshot';
const tab = { id: 42, windowId: 7, active: true, url: 'https://example.test/' };
const image = 'data:image/png;base64,fixture';
const destination = { documentId: 'capture-document' };

function loadWorker(t, activeTab = tab, rejectAction = false) {
  const calls = [];
  const event = () => ({ addListener: t.mock.fn(), removeListener: t.mock.fn() });
  const track = (name, result) => async (...args) => {
    calls.push([name, ...structuredClone(args)]);
    return result;
  };
  const actionCall = (name) => async (...args) => {
    calls.push([name, ...structuredClone(args)]);
    if (rejectAction) throw new Error('toolbar update rejected');
  };
  const chrome = {
    commands: { onCommand: event() },
    runtime: { id: 'test-extension', getURL: (file) => `chrome-extension://test/${file}`, onMessage: event() },
    storage: { local: { setAccessLevel: async () => {} } },
    scripting: {
      executeScript: track('inject', [destination]),
    },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      query: track('query', [activeTab]),
      captureVisibleTab: track('capture', image),
      sendMessage: track('message', { ok: true }),
    },
    action: { setTitle: actionCall('title'), setBadgeText: actionCall('badge') },
  };

  runInNewContext(worker, { chrome }, { filename: workerPath });
  const registration = chrome.commands.onCommand.addListener.mock.calls;
  assert.equal(registration.length, 1);
  const [listener] = registration[0].arguments;
  assert.equal(typeof listener, 'function');
  const [messageListener] = chrome.runtime.onMessage.addListener.mock.calls[0].arguments;
  const [updatedListener] = chrome.tabs.onUpdated.addListener.mock.calls[0].arguments;

  return {
    calls,
    async dispatch(...args) {
      listener(...args);
      // The Chrome listener returns void while its mocked API promises settle.
      await setImmediate();
    },
    async dispatchMessage(message) {
      let response;
      messageListener(message, { id: 'test-extension', url: 'chrome-extension://test/popup.html' }, (value) => { response = value; });
      await setImmediate();
      return response;
    },
    async dispatchUpdate(tabId, changeInfo) {
      updatedListener(tabId, changeInfo);
      await setImmediate();
    },
  };
}

const captureCalls = [
  ['inject', { target: { tabId: tab.id }, files: ['content.js'] }],
  ['message', tab.id, { action: 'resetCapture' }, destination],
  ['query', { active: true, windowId: tab.windowId }],
  ['capture', tab.windowId, { format: 'png' }],
  ['query', { active: true, windowId: tab.windowId }],
  ['message', tab.id, { action: 'startSelection', image }, destination],
];

test('the packaged manifest registers the capture shortcut for default and Mac keyboards', () => {
  assert.deepEqual(manifest.commands[captureCommand].suggested_key, {
    default: 'Ctrl+Shift+S',
    mac: 'Command+Shift+S',
  });
});

test('the capture command starts selection in the tab supplied by Chrome', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch(captureCommand, tab);
  assert.deepEqual(calls, [
    ...captureCalls,
    ['title', { tabId: tab.id, title: 'ScreenHawk' }],
    ['badge', { tabId: tab.id, text: '' }],
  ]);
});

test('the capture command finds the active tab when Chrome omits it', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch(captureCommand);
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ...captureCalls,
    ['title', { tabId: tab.id, title: 'ScreenHawk' }],
    ['badge', { tabId: tab.id, text: '' }],
  ]);
});

test('the capture command gives feedback on a restricted tab without attempting capture', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch(captureCommand, { ...tab, url: 'chrome://settings/' });
  assert.deepEqual(calls, [
    ['title', { tabId: tab.id, title: 'Open a regular web page to start a capture.' }],
    ['badge', { tabId: tab.id, text: '!' }],
  ]);
});

test('a successful shortcut with no tab looks up the active tab and clears its badge', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch(captureCommand);
  assert.deepEqual(calls.slice(-2), [
    ['title', { tabId: tab.id, title: 'ScreenHawk' }],
    ['badge', { tabId: tab.id, text: '' }],
  ]);
});

test('a failed shortcut with no supplied tab looks up the active restricted tab and shows a badge', async (t) => {
  const restrictedTab = { ...tab, url: 'chrome://settings/' };
  const { calls, dispatch } = loadWorker(t, restrictedTab);
  await dispatch(captureCommand);
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ['title', { tabId: tab.id, title: 'Open a regular web page to start a capture.' }],
    ['badge', { tabId: tab.id, text: '!' }],
  ]);
});

test('popup start clears a prior shortcut badge', async (t) => {
  const restrictedTab = { ...tab, url: 'chrome://settings/' };
  const { calls, dispatchMessage } = loadWorker(t, restrictedTab);
  const response = await dispatchMessage({ action: 'startCapture' });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: false, message: 'Open a regular web page to start a capture.' });
  assert.ok(calls.some(([name, ...args]) => name === 'badge' && args[0].text === ''));
});

test('a completed navigation clears the tab badge', async (t) => {
  const { calls, dispatchUpdate } = loadWorker(t);
  await dispatchUpdate(tab.id, { status: 'complete' });
  assert.deepEqual(calls, [['badge', { tabId: tab.id, text: '' }]]);
});

test('rejected toolbar updates do not escape the shortcut listener', async (t) => {
  const { calls, dispatch } = loadWorker(t, { ...tab, url: 'chrome://settings/' }, true);
  await assert.doesNotReject(dispatch(captureCommand, { ...tab, url: 'chrome://settings/' }));
  assert.equal(calls.filter(([name]) => name === 'title').length, 1);
  assert.equal(calls.filter(([name]) => name === 'badge').length, 1);
});

test('an unknown command does not start a capture or change the toolbar title', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch('unknown-command', tab);
  assert.deepEqual(calls, []);
});
