const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const { background } = require('../dist/manifest.json');
const filename = path.join(__dirname, '../dist', background.service_worker);
const bundle = readFileSync(filename, 'utf8');
const popupUrl = 'chrome-extension://screenhawk/popup.html';
const popupSender = { id: 'screenhawk', url: popupUrl };
const tab = { id: 42, windowId: 7, active: true, url: 'https://example.test/' };
const contentSender = { id: 'screenhawk', tab, frameId: 0, documentId: 'capture-document' };
const question = { action: 'ask', id: '1', prompt: 'What is the total?', image: 'data:image/png;base64,AAAA' };
const captureError = 'ScreenHawk could not capture this tab. Try a regular web page and keep it active.';
const stopped = { ok: false, message: 'The request stopped. Try again.' };

function loadWorker(t, { activeTab = tab, screenshot, fetch } = {}) {
  const listeners = new Set();
  const register = t.mock.fn();
  const readSettings = t.mock.fn(async (defaults) => ({ ...defaults, apiKey: 'fixture' }));
  const writeHistory = t.mock.fn(async () => {});
  const fetchAnswer = t.mock.fn(fetch ?? (() => assert.fail('unexpected API request')));
  const schedule = t.mock.fn(setTimeout);
  const clear = t.mock.fn(clearTimeout);
  const chrome = {
    commands: { onCommand: { addListener() {} } },
    runtime: {
      id: 'screenhawk',
      getURL: () => popupUrl,
      onMessage: { addListener: register },
    },
    storage: { local: { setAccessLevel: async () => {}, get: readSettings, set: writeHistory } },
    scripting: { executeScript: t.mock.fn(async () => [{ documentId: contentSender.documentId }]) },
    tabs: {
      query: t.mock.fn(async () => [activeTab]),
      sendMessage: t.mock.fn(async () => ({ ok: true })),
      captureVisibleTab: t.mock.fn(screenshot ?? (async () => question.image)),
      onActivated: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => assert.ok(listeners.delete(listener), 'remove the registered listener'),
      },
      onUpdated: { addListener() {} },
    },
    action: { setBadgeText: async () => {} },
  };

  runInNewContext(bundle, {
    chrome,
    fetch: fetchAnswer,
    AbortController,
    atob,
    Blob,
    btoa,
    crypto: webcrypto,
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
    OffscreenCanvas: class {
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return new Blob(['thumbnail'], { type: 'image/jpeg' }); }
    },
    setTimeout: schedule,
    clearTimeout: clear,
  }, { filename });
  assert.equal(register.mock.callCount(), 1);
  const [listener] = register.mock.calls[0].arguments;

  function dispatch(message, sender) {
    const { promise: reply, resolve } = Promise.withResolvers();
    const respond = t.mock.fn(resolve);
    const keptOpen = listener(message, sender, respond);
    return { reply, respond, keptOpen };
  }

  return {
    chrome, listeners, readSettings, writeHistory, fetchAnswer, schedule, clear, dispatch,
    async capture() {
      const { keptOpen, reply } = dispatch({ action: 'startCapture' }, popupSender);
      assert.equal(keptOpen, true);
      return structuredClone(await reply);
    },
  };
}

test('restricted URLs stop capture before script injection', { timeout: 2000 }, async (t) => {
  for (const url of ['chrome://settings/', 'file:///fixture.html']) {
    const worker = loadWorker(t, { activeTab: { ...tab, url } });
    const { scripting, tabs } = worker.chrome;
    assert.deepEqual(await worker.capture(), { ok: false, message: 'Open a regular web page to start a capture.' });
    assert.equal(scripting.executeScript.mock.callCount(), 0);
    assert.equal(tabs.sendMessage.mock.callCount(), 0);
    assert.equal(tabs.captureVisibleTab.mock.callCount(), 0);
    assert.equal(worker.listeners.size, 0);
    assert.equal(worker.fetchAnswer.mock.callCount(), 0);
  }
});

test('switching away and back during a screenshot discards it and permits a new capture', { timeout: 2000 }, async (t) => {
  const screenshotStarted = Promise.withResolvers();
  const screenshot = Promise.withResolvers();
  const worker = loadWorker(t, {
    screenshot: () => {
      screenshotStarted.resolve();
      return screenshot.promise;
    },
  });
  const capture = worker.capture();
  await screenshotStarted.promise;

  assert.equal(worker.listeners.size, 1);
  for (const listener of worker.listeners) {
    listener({ windowId: tab.windowId, tabId: tab.id + 1 });
    listener({ windowId: tab.windowId, tabId: tab.id });
  }
  screenshot.resolve(question.image);
  assert.deepEqual(await capture, { ok: false, message: captureError });
  assert.equal(worker.listeners.size, 0);
  const messages = worker.chrome.tabs.sendMessage.mock;
  assert.deepEqual(messages.calls.map(({ arguments: [, message] }) => message.action), ['resetCapture']);

  assert.deepEqual(await worker.capture(), { ok: true });
  const sent = messages.calls;
  assert.deepEqual(sent.map(({ arguments: [, message] }) => message.action), ['resetCapture', 'resetCapture', 'startSelection']);
  const [tabId, message, target] = sent[2].arguments;
  assert.equal(tabId, tab.id);
  assert.equal(message.image, question.image);
  assert.equal(target.documentId, contentSender.documentId);
  assert.equal(worker.listeners.size, 0);
  assert.equal(worker.fetchAnswer.mock.callCount(), 0);
});

test('a duplicate start cannot take a second screenshot while capture is pending', { timeout: 2000 }, async (t) => {
  const screenshotStarted = Promise.withResolvers();
  const screenshot = Promise.withResolvers();
  const worker = loadWorker(t, {
    screenshot: () => {
      screenshotStarted.resolve();
      return screenshot.promise;
    },
  });
  const capture = worker.capture();
  await screenshotStarted.promise;
  const { chrome } = worker;

  assert.deepEqual(await worker.capture(), { ok: false, message: 'A capture is already starting.' });
  assert.equal(chrome.scripting.executeScript.mock.callCount(), 1);
  assert.equal(chrome.tabs.sendMessage.mock.callCount(), 1);
  assert.equal(chrome.tabs.captureVisibleTab.mock.callCount(), 1);
  assert.equal(worker.listeners.size, 1);

  screenshot.resolve(question.image);
  assert.deepEqual(await capture, { ok: true });
  assert.equal(chrome.tabs.sendMessage.mock.callCount(), 2);
  assert.equal(worker.listeners.size, 0);
  assert.deepEqual(await worker.capture(), { ok: true }, 'a completed capture releases the start guard');
  assert.equal(worker.listeners.size, 0);
  assert.equal(worker.fetchAnswer.mock.callCount(), 0);
});

test('invalid senders and malformed questions get no response or API request', { timeout: 2000 }, async (t) => {
  const worker = loadWorker(t);
  const attempts = [
    [question, { ...contentSender, id: 'other-extension' }],
    [question, { ...contentSender, tab: {} }],
    [question, { ...contentSender, frameId: 1 }],
    [question, { ...contentSender, documentId: undefined }],
    [{ ...question, id: 1 }, contentSender],
    [{ ...question, prompt: '  ' }, contentSender],
    [{ ...question, prompt: 'a'.repeat(2001) }, contentSender],
    [{ ...question, image: 'data:image/jpeg;base64,AAAA' }, contentSender],
    [{ action: 'startCapture' }, { ...popupSender, url: 'chrome-extension://screenhawk/options.html' }],
  ];
  const replies = attempts.map(([message, sender]) => worker.dispatch(message, sender));

  await new Promise(setImmediate);
  for (const { keptOpen, respond } of replies) {
    assert.equal(keptOpen, undefined);
    assert.equal(respond.mock.callCount(), 0);
  }
  assert.equal(worker.chrome.tabs.query.mock.callCount(), 0);
  assert.equal(worker.readSettings.mock.callCount(), 0);
  assert.equal(worker.fetchAnswer.mock.callCount(), 0);
  assert.equal(worker.schedule.mock.callCount(), 0);
});

test('the worker aborts an unanswered request at its deadline and clears the timer', { timeout: 2000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers();
  const worker = loadWorker(t, {
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started.resolve(signal);
    }),
  });
  const { keptOpen, reply, respond } = worker.dispatch(question, contentSender);
  assert.equal(keptOpen, true);
  const signal = await started.promise;
  t.mock.timers.tick(26999);
  assert.equal(signal.aborted, false);
  assert.equal(respond.mock.callCount(), 0);
  t.mock.timers.tick(1);

  assert.equal(signal.aborted, true);
  assert.deepEqual(structuredClone(await reply), stopped);
  await new Promise(setImmediate);
  const [timer] = worker.schedule.mock.calls;
  assert.equal(worker.clear.mock.callCount(), 1);
  assert.equal(worker.clear.mock.calls[0].arguments[0], timer.result);
  assert.equal(worker.fetchAnswer.mock.callCount(), 1);
});

test('canceling a shared question ID only stops the request from its own document', { timeout: 2000 }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const firstStarted = Promise.withResolvers();
  const secondStarted = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const worker = loadWorker(t, {
    fetch: (_url, { signal, body }) => {
      if (JSON.parse(body).messages[0].content[0].text === question.prompt) {
        firstStarted.resolve(signal);
        return answer.promise;
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        secondStarted.resolve(signal);
      });
    },
  });
  const otherSender = { ...contentSender, documentId: 'second-document' };
  const first = worker.dispatch(question, contentSender);
  const firstSignal = await firstStarted.promise;
  const second = worker.dispatch({ ...question, prompt: 'Second question' }, otherSender);
  const secondSignal = await secondStarted.promise;
  const cancel = { action: 'cancelQuestion', id: question.id };

  assert.equal(worker.dispatch(cancel, otherSender).keptOpen, undefined);
  assert.equal(secondSignal.aborted, true);
  assert.equal(firstSignal.aborted, false);
  assert.deepEqual(structuredClone(await second.reply), stopped);
  assert.equal(first.respond.mock.callCount(), 0);

  answer.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'Fixture answer' } }] })));
  assert.deepEqual(structuredClone(await first.reply), { ok: true, answer: 'Fixture answer' });
  await new Promise(setImmediate);
  assert.equal(worker.clear.mock.callCount(), 2);
  worker.dispatch(cancel, contentSender);
  assert.equal(firstSignal.aborted, false, 'completed requests are removed from the pending map');
  assert.equal(worker.fetchAnswer.mock.callCount(), 2);
  assert.equal(worker.writeHistory.mock.callCount(), 1);
  const [{ interactionHistory }] = worker.writeHistory.mock.calls[0].arguments;
  assert.equal(interactionHistory.length, 1);
  assert.equal(interactionHistory[0].prompt, question.prompt);
});
