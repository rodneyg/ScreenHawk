import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngjs from 'pngjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const png = new pngjs.PNG({ width: 256, height: 192 });
const snapshot = `data:image/png;base64,${pngjs.PNG.sync.write(png).toString('base64')}`;
const settingsOrigin = 'http://screenhawk.test';
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

let page;
beforeEach(async (t) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  t.after(() => context.close());
  page = await context.newPage();
  page.setDefaultTimeout(3000);
});

test('a tiny selection keeps the overlay in selection mode', async () => {
  const overlay = await openOverlay();
  await drag(5);
  assert.equal(await overlay.locator('#area').isVisible(), true);
  assert.equal(await overlay.locator('#box').isVisible(), false);
  assert.equal(await overlay.getByRole('textbox').isVisible(), false);
  assert.deepEqual(await messages(), []);

  await drag(120);
  assert.equal(await overlay.getByRole('button', { name: 'Ask' }).isEnabled(), true);
  assert.deepEqual(await messages(), []);
});

test('crop failure shows how to recover and leaves Ask disabled', async () => {
  const overlay = await openOverlay({ failCrop: true });
  await drag(120);
  const error = overlay.getByRole('alert');
  assert.equal(await error.innerText(), 'Could not prepare this area. Close this window and try a new capture.');
  assert.equal(await overlay.getByRole('button', { name: 'Ask' }).isDisabled(), true);
  assert.deepEqual(await messages(), []);

  await overlay.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await overlay.count(), 0);
  assert.deepEqual(await messages(), []);
});

test('a rejected Ask message restores the question and lets the user retry', async () => {
  const overlay = await openOverlay();
  await ask(overlay);
  const submit = overlay.locator('button[type=submit]');
  const question = overlay.getByRole('textbox');
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await question.getAttribute('readonly'), '');
  await replyTo('ask', { reject: true });

  const error = overlay.getByRole('alert');
  await error.waitFor();
  assert.equal(await error.innerText(), 'Could not send your question. Try again.');
  assert.equal(await submit.isEnabled(), true);
  assert.equal(await question.isEditable(), true);
  assert.equal(await question.inputValue(), 'What is the total?');

  await submit.click();
  assert.equal(await error.isVisible(), false);
  const asked = await messages();
  assert.deepEqual(asked.map(({ action }) => action), ['ask', 'ask']);
  assert.notEqual(asked[0].id, asked[1].id);
  assert.equal(asked[0].prompt, asked[1].prompt);
  assert.equal(asked[0].image, asked[1].image);
  await replyTo('ask', { value: { ok: true, answer: 'Fixture answer' } });
  await overlay.getByText('Fixture answer', { exact: true }).waitFor();
});

test('closing an in-flight question cancels its ID and ignores a late answer', async () => {
  const overlay = await openOverlay();
  await ask(overlay);
  const answer = await overlay.locator('#answer').elementHandle();
  const [request] = await messages();

  await overlay.getByRole('button', { name: 'Cancel' }).click();
  await overlay.waitFor({ state: 'detached' });
  assert.deepEqual(await messages(), [request, { action: 'cancelQuestion', id: request.id }]);
  await replyTo('ask', { value: { ok: true, answer: 'Late fixture answer' } });

  assert.equal(await answer.textContent(), '', 'the detached overlay must ignore the reply');
  assert.equal(await overlay.count(), 0);
});

test('an overlay settings failure directs the user to the toolbar menu', async () => {
  const overlay = await openOverlay();
  await ask(overlay);
  await replyTo('ask', { value: { ok: false, message: 'Add a key.', showOptions: true } });
  const settings = overlay.getByRole('link', { name: 'Open ScreenHawk settings' });
  await settings.click();
  await replyTo('openOptions', { value: { ok: false } });

  const error = overlay.getByRole('alert');
  assert.equal(await error.innerText(), 'Open settings from the ScreenHawk toolbar menu.');
  assert.equal(await settings.isVisible(), true);
  assert.equal(await overlay.getByRole('button', { name: 'Ask' }).isEnabled(), true);
  assert.deepEqual((await messages()).map(({ action }) => action), ['ask', 'openOptions']);
});

test('a storage read error keeps options disabled and explains recovery', async () => {
  await openOptions({ failRead: true });
  const status = page.getByRole('status');
  await status.getByText('Could not read settings. Reopen this page to try again.').waitFor();
  assert.equal(await page.getByLabel('OpenAI API key').isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Save settings' }).isDisabled(), true);
});

test('a failed storage write re-enables options and allows a successful retry', async () => {
  await openOptions();
  const model = page.getByLabel('Vision model');
  const save = page.getByRole('button', { name: 'Save settings' });
  const status = page.getByRole('status');
  await model.fill('fixture-model');
  await save.click();
  assert.equal(await save.isDisabled(), true);
  await page.evaluate(() => window.failSave(new Error('fixture write failure')));

  await status.getByText('Could not save settings. Try again.').waitFor();
  assert.equal(await save.isEnabled(), true);
  assert.equal(await model.inputValue(), 'fixture-model');
  await save.click();
  await status.getByText('Settings saved on this device.').waitFor();
  assert.equal(await save.isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => window.writes), [
    { apiKey: '', model: 'fixture-model' },
    { apiKey: '', model: 'fixture-model' },
  ]);
});

async function openOverlay({ failCrop = false } = {}) {
  await page.evaluate((failCrop) => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      // Expose only the test overlay to Playwright's locators.
      return attachShadow.call(this, this.id === 'screenhawk-overlay' ? { ...options, mode: 'open' } : options);
    };
    if (failCrop) {
      HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('fixture crop failure'); };
    }
    const pending = new Map();
    window.fixture = { messages: [], pending };
    window.chrome = {
      runtime: {
        id: 'screenhawk',
        onMessage: { addListener(listener) { window.fixture.receive = listener; } },
        sendMessage(message) {
          window.fixture.messages.push(message);
          if (message.action === 'cancelQuestion') return Promise.resolve();
          return new Promise((resolve, reject) => pending.set(message.action, { resolve, reject }));
        },
      },
    };
  }, failCrop);
  await page.addScriptTag({ path: path.join(dist, 'content.js') });
  const started = await page.evaluate((image) => new Promise((resolve) => {
    window.fixture.receive({ action: 'startSelection', image }, { id: 'screenhawk' }, resolve);
  }), snapshot);
  assert.deepEqual(started, { ok: true });
  const overlay = page.locator('#screenhawk-overlay');
  await overlay.locator('#area').waitFor();
  return overlay;
}

async function drag(size) {
  await page.mouse.move(100, 110);
  await page.mouse.down();
  await page.mouse.move(100 + size, 110 + size);
  await page.mouse.up();
}

async function ask(overlay) {
  await drag(120);
  await overlay.getByRole('textbox').fill('What is the total?');
  await overlay.getByRole('button', { name: 'Ask' }).click();
}

async function replyTo(action, reply) {
  await page.evaluate(({ action, reply }) => {
    const { resolve, reject } = window.fixture.pending.get(action);
    window.fixture.pending.delete(action);
    if (reply.reject) reject(new Error('fixture messaging failure'));
    else resolve(reply.value);
  }, { action, reply });
}

function messages() {
  return page.evaluate(() => window.fixture.messages);
}

async function openOptions({ failRead = false } = {}) {
  await page.route(`${settingsOrigin}/**`, async (route) => {
    const filename = new URL(route.request().url()).pathname.slice(1);
    if (['options.html', 'options.js', 'ui.css', 'icons/icon-48.png'].includes(filename)) {
      await route.fulfill({ path: path.join(dist, filename) });
    } else {
      await route.abort();
    }
  });
  await page.addInitScript((failRead) => {
    window.writes = [];
    window.chrome = {
      storage: {
        local: {
          setAccessLevel: async () => {},
          get: async (defaults) => {
            if (failRead) throw new Error('fixture read failure');
            return defaults;
          },
          set(values) {
            window.writes.push(values);
            if (window.writes.length > 1) return Promise.resolve();
            return new Promise((_resolve, reject) => { window.failSave = reject; });
          },
        },
      },
    };
  }, failRead);
  await page.goto(`${settingsOrigin}/options.html`);
}
