const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWO4+vX1fwAJDQO18CWn0QAAAABJRU5ErkJggg==';
const fixtureKey = 'local-fixture-token';
const prompt = 'What is the invoice total?';

function answerResponse(content) {
  return Response.json({ choices: [{ message: { content } }] });
}

function loadAskOpenAI(t, {
  apiKey = fixtureKey,
  model = 'gpt-6-luna',
  fetch = async () => answerResponse('Fixture answer'),
} = {}) {
  const fetchMock = t.mock.fn(fetch);
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require(id) {
      assert.equal(id, './settings');
      return { readSettings: async () => ({ apiKey, model }) };
    },
    fetch: fetchMock,
  }, { filename: 'src/api.ts' });
  return { askOpenAI: exports.askOpenAI, fetchMock };
}

for (const { name, prompt, model } of [
  { name: 'a question about the selected crop', prompt: 'What is the invoice total?', model: 'gpt-6-luna' },
  {
    name: 'multiline user text with quotes and non-ASCII characters',
    prompt: 'Explain the “Café” line.\nUse the literal label "<total>".',
    model: 'fixture-vision-model',
  },
]) {
  test(`builds one multimodal user message for ${name}`, async (t) => {
    const { askOpenAI, fetchMock } = loadAskOpenAI(t, { model });
    const answer = await askOpenAI(prompt, image, new AbortController().signal);

    assert.equal(answer.ok, true);
    const requests = fetchMock.mock.calls.map(({ arguments: [url, options] }) => ({
      url,
      body: JSON.parse(options.body),
    }));
    assert.deepEqual(requests, [{
      url: 'https://api.openai.com/v1/chat/completions',
      body: {
        model,
        store: false,
        max_completion_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image } },
          ],
        }],
      },
    }]);
  });
}

test('sends no prompt or crop when settings have no API key', async (t) => {
  const { askOpenAI, fetchMock } = loadAskOpenAI(t, { apiKey: '' });
  const answer = await askOpenAI('What is the invoice total?', image, new AbortController().signal);

  assert.equal(answer.ok, false);
  assert.equal(answer.showOptions, true);
  assert.equal(fetchMock.mock.callCount(), 0);
});

const keyError = {
  message: 'OpenAI rejected the key or its permissions. Check your API key in settings.',
  showOptions: true,
};
const imageModelError = {
  message: 'OpenAI could not use this request. Check that your model supports image inputs.',
  showOptions: true,
};

for (const [status, expected] of [
  [401, keyError],
  [403, keyError],
  [429, { message: 'OpenAI reached a rate or quota limit. Check your API usage or try again later.' }],
  [400, imageModelError],
  [404, imageModelError],
  [500, { message: 'OpenAI could not answer right now. Try again.' }],
]) {
  test(`handles HTTP ${status} without exposing the provider error body`, async (t) => {
    const response = Response.json({ error: { message: `Rejected ${fixtureKey}` } }, { status });
    const { askOpenAI } = loadAskOpenAI(t, { fetch: async () => response });

    assert.deepEqual({ ...await askOpenAI(prompt, image, new AbortController().signal) }, {
      ok: false,
      ...expected,
    });
    assert.equal(response.bodyUsed, false);
  });
}

for (const [name, content] of [
  ['missing choices', {}],
  ['empty choices', { choices: [] }],
  ['non-text content', { choices: [{ message: { content: 42 } }] }],
  ['blank text', { choices: [{ message: { content: ' \n ' } }] }],
]) {
  test(`returns a no-answer message for ${name}`, async (t) => {
    const { askOpenAI } = loadAskOpenAI(t, { fetch: async () => Response.json(content) });

    assert.deepEqual({ ...await askOpenAI(prompt, image, new AbortController().signal) }, {
      ok: false,
      message: 'OpenAI returned no answer. Try a shorter question or choose another model.',
    });
  });
}

for (const [name, body] of [['empty', ''], ['malformed', '{"choices":']]) {
  test(`rejects a successful response with an ${name} JSON body`, async (t) => {
    const { askOpenAI } = loadAskOpenAI(t, { fetch: async () => new Response(body) });

    await assert.rejects(askOpenAI(prompt, image, new AbortController().signal), SyntaxError);
  });
}

test('passes the original abort signal and rejects when it is aborted', { timeout: 2000 }, async (t) => {
  const controller = new AbortController();
  const fetchStarted = Promise.withResolvers();
  const { askOpenAI } = loadAskOpenAI(t, {
    fetch: async (_url, { signal }) => {
      const aborted = new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
      });
      fetchStarted.resolve(signal);
      throw await aborted;
    },
  });

  const request = askOpenAI(prompt, image, controller.signal);
  const rejection = assert.rejects(request, { name: 'AbortError' });
  assert.equal(await fetchStarted.promise, controller.signal);
  controller.abort();
  await rejection;
});

test('propagates a network failure without retrying', async (t) => {
  const failure = new TypeError('Failed to fetch');
  const { askOpenAI, fetchMock } = loadAskOpenAI(t, {
    fetch: async () => { throw failure; },
  });

  await assert.rejects(askOpenAI(prompt, image, new AbortController().signal), (error) => error === failure);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('uses POST with JSON authorization and disables credentials, redirects, and caching', async (t) => {
  const { askOpenAI, fetchMock } = loadAskOpenAI(t);

  await askOpenAI(prompt, image, new AbortController().signal);

  assert.equal(fetchMock.mock.callCount(), 1);
  const [, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(options.method, 'POST');
  assert.deepEqual({ ...options.headers }, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${fixtureKey}`,
  });
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
});

test('redacts every echo of the saved key in a successful answer', async (t) => {
  const { askOpenAI } = loadAskOpenAI(t, {
    fetch: async () => answerResponse(`  First ${fixtureKey}, then ${fixtureKey}.  `),
  });

  assert.deepEqual({ ...await askOpenAI(prompt, image, new AbortController().signal) }, {
    ok: true,
    answer: 'First [API key removed], then [API key removed].',
  });
});
