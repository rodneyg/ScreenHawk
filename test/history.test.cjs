const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '../src/history.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

test('concurrent saves keep the newest 50; deletion and clearing use the same write queue', async () => {
  const stored = {};
  const exports = {};
  let nextId = 0;
  runInNewContext(outputText, {
    exports, atob, btoa, Blob,
    crypto: { randomUUID: () => String(nextId++) },
    createImageBitmap: async () => ({ width: 320, height: 200, close() {} }),
    OffscreenCanvas: class {
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return new Blob(['jpeg fixture']); }
    },
    chrome: { storage: { local: {
      get: async (defaults) => structuredClone({ ...defaults, ...stored }),
      set: async (values) => Object.assign(stored, structuredClone(values)),
    } } },
  });
  const { saveInteraction, readHistory, deleteInteraction, clearHistory } = exports;
  const signal = new AbortController().signal;
  const sourcePage = { url: 'https://example.test/', title: 'Example' };
  await Promise.all(Array.from({ length: 51 }, (_, i) =>
    saveInteraction(String(i), 'Answer', 'data:image/png;base64,AA==', signal, sourcePage)));
  const history = await readHistory();
  assert.deepEqual(Array.from(history, ({ prompt }) => prompt),
    Array.from({ length: 50 }, (_, i) => String(50 - i)));
  assert.equal(history[0].url, sourcePage.url);
  await deleteInteraction(history[0].id);
  assert.equal((await readHistory()).length, 49);
  await clearHistory();
  assert.equal((await readHistory()).length, 0);
});
