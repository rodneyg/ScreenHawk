const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const manifest = require('../dist/manifest.json');
const workerPath = path.join(__dirname, '../dist', manifest.background.service_worker);
const tab = { id: 42, active: true, windowId: 7, url: 'https://example.test/' };

async function dispatchShortcut(activeTab) {
  const calls = [];
  let command;
  const chrome = {
    commands: { onCommand: { addListener(listener) { command = listener; } } },
    runtime: { onMessage: { addListener() {} } },
    storage: { local: { async setAccessLevel() {} } },
    tabs: {
      async query(query) {
        calls.push(['query', structuredClone(query)]);
        return [activeTab];
      },
      async sendMessage(tabId, message, destination) {
        calls.push(['send', tabId, structuredClone(message), structuredClone(destination)]);
        return { ok: true };
      },
      captureVisibleTab: () => calls.push(['unexpected screenshot']),
    },
    scripting: {
      async executeScript(options) {
        calls.push(['inject', structuredClone(options)]);
        return [{ documentId: 'document-1' }];
      },
    },
  };
  runInNewContext(readFileSync(workerPath, 'utf8'), { chrome }, { filename: workerPath });
  command('magic-wand');
  await new Promise(setImmediate);
  return calls;
}

const query = ['query', { active: true, currentWindow: true }];
test('magic wand injects and targets the active document without capturing a screenshot', async () => {
  assert.deepEqual(manifest.commands['magic-wand'].suggested_key, {
    default: 'Ctrl+Shift+Z',
    mac: 'Command+Shift+Z',
  });
  assert.deepEqual(await dispatchShortcut(tab), [
    query,
    ['inject', { target: { tabId: 42 }, files: ['content.js'] }],
    ['send', 42, { action: 'activateMagicWand' }, { documentId: 'document-1' }],
  ]);
});

test('magic wand skips restricted pages', async () => {
  assert.deepEqual(await dispatchShortcut({ ...tab, url: 'chrome://settings/' }), [query]);
});
