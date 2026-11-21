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

function loadAskOpenAI({ apiKey = 'local-fixture-token', model = 'gpt-6-luna' } = {}) {
  const requests = [];
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require(id) {
      assert.equal(id, './settings');
      return { readSettings: async () => ({ apiKey, model }) };
    },
    async fetch(url, { body }) {
      requests.push({ url, body: JSON.parse(body) });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Fixture answer' } }] }),
      };
    },
  }, { filename: 'src/api.ts' });
  return { askOpenAI: exports.askOpenAI, requests };
}

for (const { name, prompt, model } of [
  { name: 'a question about the selected crop', prompt: 'What is the invoice total?', model: 'gpt-6-luna' },
  {
    name: 'multiline user text with quotes and non-ASCII characters',
    prompt: 'Explain the “Café” line.\nUse the literal label "<total>".',
    model: 'fixture-vision-model',
  },
]) {
  test(`builds one multimodal user message for ${name}`, async () => {
    const { askOpenAI, requests } = loadAskOpenAI({ model });
    const answer = await askOpenAI(prompt, image, new AbortController().signal);

    assert.equal(answer.ok, true);
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

test('sends no prompt or crop when settings have no API key', async () => {
  const { askOpenAI, requests } = loadAskOpenAI({ apiKey: '' });
  const answer = await askOpenAI('What is the invoice total?', image, new AbortController().signal);

  assert.equal(answer.ok, false);
  assert.equal(answer.showOptions, true);
  assert.deepEqual(requests, []);
});
