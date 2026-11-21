const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const script = ts.transpileModule(
  readFileSync(path.join(__dirname, '../src/onboarding.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function loadOnboarding(saved) {
  const exports = {};
  const local = {
    async get(defaults) {
      return { ...defaults, ...saved };
    },
    async set(values) {
      Object.assign(saved, values);
    },
  };
  runInNewContext(script, { chrome: { storage: { local } }, exports }, { filename: 'onboarding.ts' });
  return exports;
}

test('a fresh profile shows onboarding until acknowledged', async () => {
  const saved = {};
  const { shouldShowOnboarding, acknowledgeOnboarding } = loadOnboarding(saved);

  assert.equal(await shouldShowOnboarding(), true);
  assert.equal(await shouldShowOnboarding(), true);
  assert.deepEqual(saved, {});
  await acknowledgeOnboarding();
  assert.equal(await shouldShowOnboarding(), false);
});

test('a new instance keeps onboarding dismissed using saved storage', async () => {
  const saved = { model: 'custom-model' };
  await loadOnboarding(saved).acknowledgeOnboarding();

  const reopened = loadOnboarding(saved);
  assert.equal(await reopened.shouldShowOnboarding(), false);
  assert.deepEqual(saved, { model: 'custom-model', onboardingAcknowledged: true });
  assert.equal(await loadOnboarding({}).shouldShowOnboarding(), true);
});
