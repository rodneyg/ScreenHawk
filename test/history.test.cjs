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

function loadHistory(createImageBitmap = async () => ({ width: 320, height: 200, close() {} })) {
  const stored = {};
  const exports = {};
  let nextId = 0;
  runInNewContext(outputText, {
    exports, atob, btoa, Blob,
    crypto: { randomUUID: () => String(nextId++) },
    createImageBitmap,
    OffscreenCanvas: class {
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return new Blob(['jpeg fixture']); }
    },
    chrome: { storage: { local: {
      get: async (defaults) => structuredClone({ ...defaults, ...stored }),
      set: async (values) => Object.assign(stored, structuredClone(values)),
    } } },
  });
  return exports;
}

test('concurrent saves keep the newest 50; deletion and clearing use the same write queue', async () => {
  const { saveInteraction, readHistory, deleteInteraction, clearHistory } = loadHistory();
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

test('clearing history removes captures already being compressed', async () => {
  const compressionStarted = Promise.withResolvers();
  const releaseCompression = Promise.withResolvers();
  const { saveInteraction, readHistory, clearHistory } = loadHistory(async () => {
    compressionStarted.resolve();
    await releaseCompression.promise;
    return { width: 320, height: 200, close() {} };
  });
  const signal = new AbortController().signal;
  const image = 'data:image/png;base64,AA==';

  const earlierSave = saveInteraction('Earlier capture', 'Answer', image, signal, {});
  await compressionStarted.promise;
  const clear = clearHistory();
  releaseCompression.resolve();

  await Promise.all([earlierSave, clear]);
  assert.equal((await readHistory()).length, 0, 'the earlier capture must stay deleted');

  await saveInteraction('Later capture', 'Answer', image, signal, {});
  assert.deepEqual(Array.from(await readHistory(), ({ prompt }) => prompt), ['Later capture']);
});
