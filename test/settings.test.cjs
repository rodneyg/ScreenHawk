const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function compile(name) {
  const source = readFileSync(path.join(__dirname, '..', 'src', name + '.ts'), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

const settingsScript = compile('settings');
const optionsScript = compile('options');
const defaultModel = 'gpt-6-luna';

function createStorage(initial = {}) {
  const saved = { ...initial };
  const chrome = {
    storage: {
      local: {
        async get(defaults) {
          return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
            key, Object.hasOwn(saved, key) ? saved[key] : fallback,
          ]));
        },
        async set(values) {
          Object.assign(saved, values);
        },
        async setAccessLevel() {},
      },
    },
  };
  return { chrome, saved };
}

function loadSettings(chrome) {
  const exports = {};
  runInNewContext(settingsScript, { chrome, exports }, { filename: 'settings.ts' });
  return exports;
}

async function openOptions(chrome) {
  const key = { value: '' };
  const model = { value: '' };
  const fieldset = { disabled: true };
  const status = { textContent: '' };
  let submit;
  const form = {
    addEventListener(type, listener) {
      assert.equal(type, 'submit');
      submit = listener;
    },
    querySelector: (selector) => selector === 'fieldset' ? fieldset : null,
  };
  const elements = { form, '#api-key': key, '#model': model, '#status': status };
  runInNewContext(optionsScript, {
    chrome,
    exports: {},
    document: { querySelector: (selector) => elements[selector] },
    require(specifier) {
      assert.equal(specifier, './settings');
      return loadSettings(chrome);
    },
  }, { filename: 'options.ts' });
  await setImmediate();
  assert.equal(fieldset.disabled, false, 'the settings page finished loading');
  return { key, model, status, submit };
}

test('saves trimmed settings locally and loads them on a fresh options page', async () => {
  const { chrome, saved } = createStorage();
  const options = await openOptions(chrome);
  options.key.value = '  fixture-api-key  ';
  options.model.value = '  custom-vision-model  ';
  await options.submit({ preventDefault() {} });
  assert.equal(options.status.textContent, 'Settings saved on this device.');
  assert.deepEqual(saved, { apiKey: 'fixture-api-key', model: 'custom-vision-model' });

  const reloaded = await openOptions(chrome);
  assert.equal(reloaded.key.value, 'fixture-api-key');
  assert.equal(reloaded.model.value, 'custom-vision-model');

  reloaded.model.value = '  ';
  await reloaded.submit({ preventDefault() {} });
  assert.equal(saved.model, defaultModel);
  assert.equal((await openOptions(chrome)).model.value, defaultModel);
});

test('defaults missing or blank stored settings', async () => {
  for (const values of [{}, { apiKey: '  ', model: '  ' }]) {
    const { chrome } = createStorage(values);
    assert.deepEqual({ ...await loadSettings(chrome).readSettings() }, {
      apiKey: '',
      model: defaultModel,
    });
  }
});

test('falls back from retired models while keeping the saved key', async () => {
  for (const model of ['gpt-4.1-nano', ' gpt-4.1-nano-2025-04-14 ']) {
    const { chrome } = createStorage({ apiKey: '  fixture-api-key  ', model });
    assert.deepEqual({ ...await loadSettings(chrome).readSettings() }, {
      apiKey: 'fixture-api-key',
      model: defaultModel,
    });
  }
});

test('falls back independently for malformed stored values', async () => {
  for (const [values, expected] of [
    [{ apiKey: null, model: 'custom-vision-model' }, { apiKey: '', model: 'custom-vision-model' }],
    [{ apiKey: 'fixture-api-key', model: {} }, { apiKey: 'fixture-api-key', model: defaultModel }],
    [{ apiKey: 42, model: ['custom-vision-model'] }, { apiKey: '', model: defaultModel }],
  ]) {
    const { chrome } = createStorage(values);
    assert.deepEqual({ ...await loadSettings(chrome).readSettings() }, expected);
  }
});
