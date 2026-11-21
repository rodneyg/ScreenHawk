import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const fixtureOrigin = 'http://screenhawk.test';
const readError = 'Could not read settings. Reopen this page to try again.';
const saveError = 'Could not save settings. Try again.';
const startupError = 'Could not start ScreenHawk. Try again.';
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

async function openPage(t, name, mock, initialValue) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== fixtureOrigin) return route.abort();
    const asset = fileURLToPath(new URL(`../dist${url.pathname}`, import.meta.url));
    return route.fulfill({ path: asset });
  });
  await context.addInitScript(mock, initialValue);
  const page = await context.newPage();
  page.setDefaultTimeout(2000);
  await page.goto(`${fixtureOrigin}/${name}.html`);
  return page;
}

async function expectStatus(page, message) {
  const status = page.getByRole('status').and(page.locator('#status'));
  await status.getByText(message, { exact: true }).waitFor();
  assert.equal(await status.innerText(), message);
}

function mockOptions(rejectedMethod) {
  const calls = [];
  let save;
  const saved = { apiKey: 'fixture-key', model: 'fixture-model' };
  window.fixture = { calls, finishSave: (ok) => save(ok) };
  window.chrome = {
    storage: {
      local: {
        async setAccessLevel({ accessLevel }) {
          calls.push({ accessLevel });
          if (rejectedMethod === 'setAccessLevel') throw new Error('Fixture access setup failed');
        },
        async get() {
          calls.push('get');
          if (rejectedMethod === 'get' && !sessionStorage.getItem('read-failed')) {
            sessionStorage.setItem('read-failed', 'true');
            throw new Error('Fixture read failed');
          }
          return saved;
        },
        set(values) {
          calls.push({ values });
          return new Promise((resolve, reject) => {
            save = (ok) => ok ? resolve() : reject(new Error('Fixture write failed'));
          });
        },
      },
    },
  };
}

test('options never reads the key when trusted storage setup fails', async (t) => {
  const page = await openPage(t, 'options', mockOptions, 'setAccessLevel');
  await expectStatus(page, readError);
  assert.equal(await page.getByLabel('OpenAI API key').isDisabled(), true);
  assert.equal(await page.getByLabel('Vision model').isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), [{ accessLevel: 'TRUSTED_CONTEXTS' }]);
});

test('reopening options after a read failure loads settings and unlocks the form', async (t) => {
  const page = await openPage(t, 'options', mockOptions, 'get');
  const key = page.getByLabel('OpenAI API key');
  const model = page.getByLabel('Vision model');
  const save = page.getByRole('button', { name: 'Save settings' });

  await expectStatus(page, readError);
  assert.equal(await key.isDisabled(), true);
  assert.equal(await model.isDisabled(), true);
  assert.equal(await save.isDisabled(), true);

  await page.reload();
  await page.locator('fieldset:not([disabled])').waitFor();
  assert.equal(await key.inputValue(), 'fixture-key');
  assert.equal(await model.inputValue(), 'fixture-model');
  assert.equal(await save.isEnabled(), true);
  assert.equal(await page.getByRole('status', { includeHidden: true }).textContent(), '');
});

test('a failed save unlocks the entire form and saves corrected settings on retry', async (t) => {
  const page = await openPage(t, 'options', mockOptions, null);
  const key = page.getByLabel('OpenAI API key');
  const model = page.getByLabel('Vision model');
  const save = page.getByRole('button', { name: 'Save settings' });

  await key.fill('replacement-fixture-key');
  await save.click();
  assert.equal(await key.isDisabled(), true);
  assert.equal(await model.isDisabled(), true);
  assert.equal(await save.isDisabled(), true);
  await page.evaluate(() => window.fixture.finishSave(false));

  await expectStatus(page, saveError);
  assert.equal(await key.inputValue(), 'replacement-fixture-key');
  assert.equal(await key.isEnabled(), true);
  assert.equal(await model.isEnabled(), true);
  assert.equal(await save.isEnabled(), true);

  await model.fill('corrected-fixture-model');
  await save.click();
  await page.evaluate(() => window.fixture.finishSave(true));
  await expectStatus(page, 'Settings saved on this device.');
  assert.equal(await save.isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), [
    { accessLevel: 'TRUSTED_CONTEXTS' },
    'get',
    { values: { apiKey: 'replacement-fixture-key', model: 'fixture-model' } },
    { values: { apiKey: 'replacement-fixture-key', model: 'corrected-fixture-model' } },
  ]);
});

function mockPopup() {
  const fixture = { messages: [], closeCalls: 0 };
  window.fixture = fixture;
  window.close = () => { fixture.closeCalls += 1; };
  window.chrome = {
    storage: { local: { get: async (defaults) => defaults } },
    runtime: {
      sendMessage(message) {
        fixture.messages.push(message);
        return new Promise((resolve, reject) => {
          fixture.reject = () => reject(new Error('Fixture message failed'));
          fixture.reply = resolve;
        });
      },
    },
  };
}

for (const failure of ['rejected message', 'missing reply']) {
  test(`popup recovers from a ${failure} and closes after a successful retry`, async (t) => {
    const page = await openPage(t, 'popup', mockPopup, null);
    const capture = page.getByRole('button', { name: 'Select area' });
    const status = page.getByRole('status', { includeHidden: true }).and(page.locator('#status'));

    await capture.click();
    assert.equal(await capture.isDisabled(), true);
    // A native click on a disabled button must not start a second request.
    await capture.evaluate((button) => button.click());
    assert.deepEqual(await page.evaluate(() => window.fixture.messages), [{ action: 'startCapture' }]);

    await page.evaluate((failure) => {
      if (failure === 'rejected message') window.fixture.reject();
      else window.fixture.reply(undefined);
    }, failure);
    await expectStatus(page, startupError);
    assert.equal(await capture.isEnabled(), true);
    assert.equal(await page.evaluate(() => window.fixture.closeCalls), 0);

    await capture.click();
    assert.equal(await capture.isDisabled(), true);
    assert.equal(await status.textContent(), '');
    await page.evaluate(() => window.fixture.reply({ ok: true }));
    await page.waitForFunction(() => window.fixture.closeCalls === 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.messages), [
      { action: 'startCapture' },
      { action: 'startCapture' },
    ]);
  });
}
