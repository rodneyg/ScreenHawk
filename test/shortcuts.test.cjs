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

function loadWorker(t) {
  const calls = [];
  const event = () => ({ addListener: t.mock.fn(), removeListener: t.mock.fn() });
  const track = (name, result) => async (...args) => {
    calls.push([name, ...structuredClone(args)]);
    return result;
  };
  const chrome = {
    commands: { onCommand: event() },
    runtime: { onMessage: event() },
    storage: { local: { setAccessLevel: async () => {} } },
    scripting: {
      executeScript: track('inject', [destination]),
    },
    tabs: {
      onActivated: event(),
      query: track('query', [tab]),
      captureVisibleTab: track('capture', image),
      sendMessage: track('message', { ok: true }),
    },
    action: { setTitle: track('title') },
  };

  runInNewContext(worker, { chrome }, { filename: workerPath });
  const registration = chrome.commands.onCommand.addListener.mock.calls;
  assert.equal(registration.length, 1);
  const [listener] = registration[0].arguments;
  assert.equal(typeof listener, 'function');

  return {
    calls,
    async dispatch(...args) {
      listener(...args);
      // The Chrome listener returns void while its mocked API promises settle.
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
  ]);
});

test('the capture command finds the active tab when Chrome omits it', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch(captureCommand);
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ...captureCalls,
  ]);
});

test('the capture command gives feedback on a restricted tab without attempting capture', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch(captureCommand, { ...tab, url: 'chrome://settings/' });
  assert.deepEqual(calls, [
    ['title', { tabId: tab.id, title: 'Open a regular web page to start a capture.' }],
  ]);
});

test('an unknown command does not start a capture or change the toolbar title', async (t) => {
  const { calls, dispatch } = loadWorker(t);
  await dispatch('unknown-command', tab);
  assert.deepEqual(calls, []);
});
