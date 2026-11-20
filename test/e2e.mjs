import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, selectors } from 'playwright';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const repo = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(repo, 'dist');
const real = process.argv.includes('--real');
const { OPENAI_API_KEY: liveKey, ...browserEnv } = process.env;
const evidence = path.resolve(process.env.SCREENHAWK_EVIDENCE || path.join(repo, 'evidence', real ? 'real' : 'mock'));
const endpoint = 'https://api.openai.com/v1/chat/completions';
const defaultModel = 'gpt-4.1-nano';
const mockKey = 'screenhawk-local-fixture-token';
const question = 'What is the invoice total?';
const receipt = await readFile(new URL('./demo.html', import.meta.url));
const size = { width: 1280, height: 800 };

if (real && !liveKey?.trim()) {
  console.error('Set OPENAI_API_KEY before running the live browser test.');
  process.exit(2);
}

await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(path.join(repo, '.screenhawk-e2e-'));
let context;
let video;
let server;
let stage = 'start local server';
const requests = [];

function assertCrop(image, area, dpr) {
  assert.ok(image.startsWith('data:image/png;base64,'), 'vision image is a PNG data URL');
  const png = PNG.sync.read(Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
  assert.ok(Math.abs(png.width - area.width * dpr) <= 2, `upload width ${png.width} vs selection ${area.width} at ${dpr}x`);
  assert.ok(Math.abs(png.height - area.height * dpr) <= 2, `upload height ${png.height} vs selection ${area.height} at ${dpr}x`);
  const index = (10 * png.width + 10) * 4;
  assert.deepEqual([...png.data.subarray(index, index + 3)], [213, 245, 235], 'crop starts inside green invoice total');
  assert.ok(png.data.some((value, index) => index % 4 === 0 && value < 32), 'crop contains dark invoice text');
}

try {
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'nonce-screenhawk-fixture'",
      }).end(receipt);
      return;
    }
    if (real || req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      requests.push({ body, authorization: req.headers.authorization });
      const rejected = req.headers.authorization !== `Bearer ${mockKey}`;
      await delay(350);
      res.writeHead(rejected ? 401 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(
        rejected ? { error: { message: 'Rejected by test server' } } :
          { choices: [{ message: { content: 'The invoice total is $73.19.' } }] },
      ));
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  stage = 'launch unpacked headless Chromium';
  await selectors.register('screenhawk', () => ({
    query: (_root, selector) => globalThis.screenHawkTestRoot?.querySelector(selector) ?? null,
    queryAll: (_root, selector) => Array.from(globalThis.screenHawkTestRoot?.querySelectorAll(selector) ?? []),
  }));
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    env: { ...browserEnv, TMPDIR: temp },
    viewport: null,
    recordVideo: { dir: path.join(temp, 'videos'), size },
    args: [
      '--enable-unsafe-extension-debugging',
      '--window-size=1280,920',
      `--force-device-scale-factor=${real ? 1 : 2}`,
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
  context.setDefaultTimeout(7000);
  if (real) {
    context.on('response', (response) => {
      if (response.url() === endpoint) console.log(`OpenAI HTTP ${response.status()}`);
    });
  } else {
    await context.route('https://api.openai.com/**', async (route) => {
      // The built worker always requests OpenAI. Only this test sends that request to loopback.
      assert.equal(route.request().url(), endpoint);
      assert.ok(route.request().serviceWorker(), 'OpenAI request must come from the extension worker');
      const response = await route.fetch({ url: `${origin}/v1/chat/completions`, maxRedirects: 0 });
      await route.fulfill({ response });
    });
  }

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const base = `chrome-extension://${id}`;
  const page = context.pages()[0];
  video = page.video();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Invoice HAWK-4821' }).waitFor();
  const browserCDP = await context.browser().newBrowserCDPSession();
  const pageCDP = await context.newCDPSession(page);
  const { targetInfo } = await pageCDP.send('Target.getTargetInfo');
  const { windowId, bounds } = await browserCDP.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await browserCDP.send('Browser.setWindowBounds', { windowId, bounds: {
    width: bounds.width + size.width - viewport.width,
    height: bounds.height + size.height - viewport.height,
  } });
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, size);
  const dpr = await page.evaluate(() => devicePixelRatio);
  const total = await page.locator('.total').boundingBox();
  const selection = {
    x: Math.ceil(total.x + 7), y: Math.ceil(total.y + 6),
    width: Math.floor(total.width - 14), height: Math.floor(total.height - 12),
  };

  const { targetInfos } = await browserCDP.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const target = targetInfos.find((candidate) => candidate.url === page.url());
  assert.ok(target, 'Chromium did not return a tab target');
  const overlay = page.locator('#screenhawk-overlay');
  const control = (selector) => page.locator(`screenhawk=${selector}`);

  async function clickToolbarPopup(selector) {
    await page.bringToFront();
    await browserCDP.send('Extensions.triggerAction', { id, targetId: target.targetId });
    // Playwright does not surface Chrome's toolbar bubble as a context page.
    // Browser CDP can attach to the bubble and activate its actual controls.
    let popup;
    for (let attempt = 0; attempt < 40 && !popup; attempt++) {
      const { targetInfos } = await browserCDP.send('Target.getTargets', { filter: [{ type: 'page' }] });
      popup = targetInfos.find((candidate) => candidate.url === `${base}/popup.html`);
      if (!popup) await delay(50);
    }
    assert.ok(popup, 'native toolbar popup did not open');
    const { sessionId } = await browserCDP.send('Target.attachToTarget', { targetId: popup.targetId, flatten: false });
    const activate = `const click = () => document.querySelector(${JSON.stringify(selector)}).click();
      if (document.readyState === 'complete') click(); else addEventListener('load', click, { once: true });`;
    await browserCDP.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: activate, userGesture: true } }),
    });
    return sessionId;
  }

  async function capture() {
    const sessionId = await clickToolbarPopup('#capture');
    try {
      await overlay.waitFor({ state: 'attached' });
    } finally {
      await browserCDP.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }

    // Make the closed shadow tree readable only on this controlled demo page.
    const { root } = await pageCDP.send('DOM.getDocument');
    const { nodeId } = await pageCDP.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#screenhawk-overlay' });
    const { node } = await pageCDP.send('DOM.describeNode', { nodeId });
    const { object } = await pageCDP.send('DOM.resolveNode', { backendNodeId: node.shadowRoots[0].backendNodeId });
    await pageCDP.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { globalThis.screenHawkTestRoot = this; }',
    });
    await pageCDP.send('Runtime.releaseObject', { objectId: object.objectId });
    await control('#area').waitFor();
  }

  async function selectArea(screenshot) {
    const { x, y, width, height } = selection;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + width, y + height, { steps: 14 });
    if (screenshot) {
      await page.screenshot({ scale: 'css', path: screenshot });
      await delay(550);
    }
    await page.mouse.up();
    await control('#question').fill(question);
  }

  async function optionsFromError() {
    const opened = context.waitForEvent('page');
    await control('#options').click();
    const options = await opened;
    await options.waitForURL(`${base}/options.html`);
    await options.getByRole('button', { name: 'Save settings' }).waitFor();
    return options;
  }

  async function saveSettings(options, key, model) {
    const field = options.getByLabel('OpenAI API key');
    assert.equal(await field.getAttribute('type'), 'password');
    // Keep the credential out of Playwright's action logs and password keystroke rendering.
    await field.evaluate((input, value) => { input.value = value; }, key);
    await options.getByLabel('Vision model').fill(model);
    await options.getByRole('button', { name: 'Save settings' }).click();
    await options.getByText('Settings saved on this device.').waitFor();
    await options.reload();
    await options.waitForFunction(() => !document.querySelector('fieldset').disabled);
    assert.ok(await field.evaluate((input, value) => input.value === value, key), 'local key did not persist');
    assert.equal(await options.getByLabel('Vision model').inputValue(), model);
    assert.deepEqual(await worker.evaluate(async () => Object.keys(await chrome.storage.sync.get())), []);
  }

  stage = 'verify missing-key handling and options';
  await capture();
  await selectArea();
  await control('button[type=submit]').click();
  await control('#error').waitFor();
  assert.match(await control('#error').innerText(), /Add your OpenAI API key/);
  assert.equal(requests.length, 0);
  let options = await optionsFromError();
  await options.waitForFunction(() => !document.querySelector('fieldset').disabled);
  assert.equal(await options.getByLabel('Vision model').inputValue(), defaultModel);
  if (!real) {
    stage = 'verify rejected key and custom model';
    const customModel = 'gpt-4.1-mini';
    await saveSettings(options, 'screenhawk-rejected-fixture-token', customModel);
    await options.close();
    await page.bringToFront();
    await control('button[type=submit]').click();
    await control('#error').waitFor();
    assert.match(await control('#error').innerText(), /OpenAI rejected the key/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.model, customModel);
    options = await optionsFromError();
  }

  stage = 'save key and default model';
  await saveSettings(options, real ? liveKey.trim() : mockKey, defaultModel);
  await options.screenshot({ scale: 'css', path: path.join(evidence, '04-options.png') });
  await options.close();
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached' });

  stage = 'verify Escape cancels area selection and sends no request';
  await capture();
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached' });
  assert.equal(requests.length, real ? 0 : 1);
  await delay(550);

  stage = 'verify capture and selected image';
  await capture();
  await selectArea(path.join(evidence, '01-area-select.png'));
  await page.screenshot({ scale: 'css', path: path.join(evidence, '02-prompt.png') });
  await delay(550);

  stage = 'verify the glass Ask button and submit';
  const ask = control('button[type=submit]');
  const askBackground = () => ask.evaluate((button) => getComputedStyle(button).backgroundColor);
  assert.equal(await askBackground(), 'rgba(119, 241, 207, 0.15)', 'Ask uses a translucent fill');
  await control('#cancel').focus();
  await page.keyboard.press('Tab');
  assert.ok(await ask.evaluate((button) => button.matches(':focus-visible')), 'Ask has visible keyboard focus');
  await ask.hover();
  assert.equal(await askBackground(), 'rgba(119, 241, 207, 0.24)', 'Ask stays translucent on hover');
  const { height } = await ask.boundingBox();
  await ask.click({ position: { x: 4, y: height / 2 } });
  if (!real) {
    // The answer must follow the initiating document, even if another tab becomes active.
    const anotherTab = await context.newPage();
    await anotherTab.goto(`${origin}/another-tab`);
    await control('#answer').waitFor({ state: 'visible' });
    assert.equal(await anotherTab.locator('#screenhawk-overlay').count(), 0);
    await anotherTab.close();
    await page.bringToFront();
  }

  stage = 'assert that answer contains 73.19';
  await control('section:not([hidden]) #answer, #error:not([hidden])').waitFor({ timeout: 30000 });
  if (await control('#error').isVisible()) throw new Error(await control('#error').innerText());
  assert.ok((await control('#answer').innerText()).includes('73.19'), 'invoice total missing from answer');
  await page.screenshot({ scale: 'css', path: path.join(evidence, '03-answer.png') });
  await delay(850);

  if (!real) {
    stage = 'check mock API request contract and crop bounds';
    assert.equal(requests.length, 2);
    const [{ body: rejected }, { body, authorization }] = requests;
    assert.ok(authorization === `Bearer ${mockKey}`, 'mock authorization mismatch');
    assert.equal(body.model, defaultModel);
    assert.equal(body.store, false);
    assert.equal(body.messages[0].content[0].text, question);
    const image = body.messages[0].content[1].image_url.url;
    assertCrop(image, selection, dpr);
    assertCrop(rejected.messages[0].content[1].image_url.url, selection, dpr);
  }

  if (!real) {
    stage = 'verify Settings link in toolbar popup';
    const opened = context.waitForEvent('page');
    const sessionId = await clickToolbarPopup('#settings');
    const settingsPage = await opened;
    await settingsPage.waitForURL(`${base}/options.html`);
    await settingsPage.getByRole('heading', { name: 'Settings' }).waitFor();
    await settingsPage.close();
    await browserCDP.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }

  stage = 'verify keyboard command registration';
  const commands = await worker.evaluate(() => chrome.commands.getAll());
  const shortcut = commands.find(({ name }) => name === 'capture-screenshot');
  assert.ok(shortcut?.shortcut.includes('S'), 'Chrome did not register the capture shortcut');
  const shortcutsPage = await context.newPage();
  await shortcutsPage.goto('chrome://extensions/shortcuts');
  await shortcutsPage.getByRole('heading', { name: 'ScreenHawk', exact: true, level: 2 }).waitFor();
  await shortcutsPage.screenshot({ scale: 'css', path: path.join(evidence, '05-shortcut.png') });
  await shortcutsPage.close();

  console.log(`PASS ${real ? 'real OpenAI' : 'local mock'} | ${defaultModel} | 73.19 in the on-page answer | shortcut ${shortcut.shortcut}`);
  if (!real) console.log('PASS missing and rejected key, local settings, custom model, Escape, original tab, cropped PNG');
} catch (error) {
  // Error messages from Playwright protocol calls can contain evaluation arguments.
  const message = String(error.message).split(liveKey || '\u0000').join('[redacted]');
  console.error(`FAIL ${stage}: ${message}`);
  process.exitCode = 1;
} finally {
  try {
    const videoPath = await video?.path();
    if (context) await context.close();
    if (videoPath) await copyFile(videoPath, path.join(evidence, 'capture-flow.webm'));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
}
