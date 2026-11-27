const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const dist = path.join(__dirname, '../dist');
const { background } = require('../dist/manifest.json');
const filename = path.join(dist, background.service_worker);
const worker = readFileSync(filename, 'utf8');
const sender = {
  id: 'screenhawk',
  tab: { id: 42 },
  frameId: 0,
  documentId: 'test-document',
};
const question = {
  action: 'ask',
  id: 'question-1',
  prompt: 'What is the total?',
  image: 'data:image/png;base64,AAAA',
};

const thumbnailBytes = 'test-thumbnail';

function loadWorker(t, { apiKey = '', fetch } = {}) {
  const registerMessage = t.mock.fn();
  const registerTabUpdate = t.mock.fn();
  const setBadgeText = t.mock.fn(async () => {});
  const openOptions = t.mock.fn(async () => {});
  const fetchAnswer = t.mock.fn(fetch ?? (async () => {
    throw new Error('Unexpected fetch');
  }));
  const stored = { apiKey };
  const readStorage = t.mock.fn(async (defaults) => ({ ...defaults, ...stored }));
  const writeStorage = t.mock.fn(async (values) => { Object.assign(stored, values); });

  runInNewContext(worker, {
    AbortController,
    atob,
    Blob,
    btoa,
    clearTimeout,
    createImageBitmap: async () => ({ width: 640, height: 400, close() {} }),
    crypto: webcrypto,
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { drawImage() {} };
      }

      async convertToBlob({ type }) {
        return new Blob([thumbnailBytes], { type });
      }
    },
    setTimeout,
    fetch: fetchAnswer,
    chrome: {
      action: { setBadgeText },
      commands: { onCommand: { addListener() {} } },
      tabs: { onUpdated: { addListener: registerTabUpdate } },
      runtime: {
        id: sender.id,
        getURL: (file) => `chrome-extension://${sender.id}/${file}`,
        onMessage: { addListener: registerMessage },
        openOptionsPage: openOptions,
      },
      storage: {
        local: { setAccessLevel: async () => {}, get: readStorage, set: writeStorage },
      },
    },
  }, { filename });

  assert.equal(registerMessage.mock.callCount(), 1);
  assert.equal(registerTabUpdate.mock.callCount(), 1);
  const [listener] = registerMessage.mock.calls[0].arguments;
  return {
    openOptions,
    fetchAnswer,
    setBadgeText,
    updateTab(changeInfo) {
      const [listener] = registerTabUpdate.mock.calls[0].arguments;
      listener(42, changeInfo);
    },
    readStorage,
    writeStorage,
    sendMessage(message) {
      const { promise: reply, resolve } = Promise.withResolvers();
      const respond = t.mock.fn(resolve);
      const keepsChannelOpen = listener(message, sender, respond);
      return { keepsChannelOpen, reply, respond };
    },
  };
}

async function assertReply({ keepsChannelOpen, reply, respond }, expected) {
  assert.equal(keepsChannelOpen, true);
  assert.equal(respond.mock.callCount(), 0, 'the listener replies asynchronously');
  assert.deepEqual(structuredClone(await reply), expected);
  assert.equal(respond.mock.callCount(), 1);
}

test('navigation completion clears the shortcut badge', async (t) => {
  const worker = loadWorker(t);
  worker.updateTab({ status: 'complete' });
  await new Promise(setImmediate);
  assert.equal(worker.setBadgeText.mock.callCount(), 1);
  assert.deepEqual(structuredClone(worker.setBadgeText.mock.calls[0].arguments[0]), { tabId: 42, text: '' });
});

test('the worker ignores unknown content messages without a reply or side effects', async (t) => {
  const worker = loadWorker(t);
  const { keepsChannelOpen, respond } = worker.sendMessage({ ...question, action: 'unknown' });

  assert.equal(keepsChannelOpen, undefined);
  await new Promise(setImmediate);
  for (const mock of [respond, worker.openOptions, worker.fetchAnswer, worker.readStorage, worker.writeStorage]) {
    assert.equal(mock.mock.callCount(), 0);
  }
});

test('openOptions replies with the Chrome API outcome', { timeout: 2000 }, async (t) => {
  const worker = loadWorker(t);
  await assertReply(worker.sendMessage({ action: 'openOptions' }), { ok: true });
  assert.equal(worker.openOptions.mock.callCount(), 1);

  worker.openOptions.mock.mockImplementation(async () => { throw new Error('Could not open'); });
  await assertReply(worker.sendMessage({ action: 'openOptions' }), { ok: false });
  assert.equal(worker.openOptions.mock.callCount(), 2);
});

test('ask replies with the answer for the submitted prompt and image', { timeout: 2000 }, async (t) => {
  const worker = loadWorker(t, {
    apiKey: 'test-fixture',
    fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'The total is $42.' } }],
    })),
  });

  await assertReply(worker.sendMessage(question), { ok: true, answer: 'The total is $42.' });

  assert.equal(worker.fetchAnswer.mock.callCount(), 1);
  const [, request] = worker.fetchAnswer.mock.calls[0].arguments;
  assert.deepEqual(JSON.parse(request.body).messages, [{
    role: 'user',
    content: [
      { type: 'text', text: question.prompt },
      { type: 'image_url', image_url: { url: question.image } },
    ],
  }]);

  assert.equal(worker.writeStorage.mock.callCount(), 1);
  const [saved] = worker.writeStorage.mock.calls[0].arguments;
  assert.equal(saved.interactionHistory.length, 1);
  const [{ id, timestamp, prompt, answer, thumbnail }] = saved.interactionHistory;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(timestamp));
  assert.deepEqual({ prompt, answer, thumbnail }, {
    prompt: question.prompt,
    answer: 'The total is $42.',
    thumbnail: `data:image/jpeg;base64,${btoa(thumbnailBytes)}`,
  });
});

test('ask replies with a settings action when the key is missing', { timeout: 2000 }, async (t) => {
  const worker = loadWorker(t);

  await assertReply(worker.sendMessage(question), {
    ok: false,
    message: 'Add your OpenAI API key in ScreenHawk settings.',
    showOptions: true,
  });
  assert.equal(worker.fetchAnswer.mock.callCount(), 0);
});

test('cancelQuestion stops a pending ask and only the original message gets a reply', { timeout: 2000 }, async (t) => {
  let requestStarted;
  const started = new Promise((resolve) => { requestStarted = resolve; });
  const worker = loadWorker(t, {
    apiKey: 'test-fixture',
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      requestStarted();
    }),
  });

  const pending = worker.sendMessage(question);
  await started;
  const cancellation = worker.sendMessage({ action: 'cancelQuestion', id: question.id });

  assert.equal(cancellation.keepsChannelOpen, undefined);
  await assertReply(pending, { ok: false, message: 'The request stopped. Try again.' });
  assert.equal(cancellation.respond.mock.callCount(), 0);
});
