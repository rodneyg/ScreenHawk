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
const defaultModel = 'gpt-6-luna';
const mockKey = 'screenhawk-local-fixture-token';
const question = 'What is the invoice total?';
const receipt = await readFile(new URL('./demo.html', import.meta.url));
const formPage = await readFile(new URL('./form.html', import.meta.url));
const draftAnswer = 'I coordinated a studio print run and delivered the work on time.';
const size = { width: 1280, height: 800 };

if (real && !liveKey?.trim()) {
  console.error('Set OPENAI_API_KEY before running the live browser test.');
  process.exit(2);
}

await mkdir(evidence, { recursive: true });
const temp = await mkdtemp(path.join(repo, '.screenhawk-e2e-'));
let context;
let video;
let historyVideo;
let server;
let stage = 'start local server';
const requests = [];
const mockRequestReceived = Promise.withResolvers();
const mockAnswerRelease = Promise.withResolvers();
let mockAnswerSent = false;

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
      }).end(req.url === '/form' ? formPage : receipt);
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
      const hasImage = body.messages[0].content.some(({ type }) => type === 'image_url');
      const answer = hasImage ? 'The invoice total is $73.19.' : draftAnswer;
      if (hasImage && !rejected) {
        mockRequestReceived.resolve();
        await mockAnswerRelease.promise;
        mockAnswerSent = true;
      }
      res.writeHead(rejected ? 401 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify(
        rejected ? { error: { message: 'Rejected by test server' } } :
          { choices: [{ message: { content: answer } }] },
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
    context.on('response', async (response) => {
      if (response.url() !== endpoint) return;
      console.log(`OpenAI HTTP ${response.status()}`);
      if (response.ok()) return;
      const body = await response.json().catch(() => null);
      const code = body?.error?.code;
      if (['invalid_api_key', 'insufficient_quota', 'model_not_found', 'rate_limit_exceeded'].includes(code)) {
        console.log(`OpenAI error code: ${code}`);
      }
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

    await inspectOverlay();
    await control('#area').waitFor();
  }

  async function inspectOverlay(selector = '#screenhawk-overlay') {
    // Make the closed shadow tree readable only on this controlled fixture page.
    const { root } = await pageCDP.send('DOM.getDocument');
    const { nodeId } = await pageCDP.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { node } = await pageCDP.send('DOM.describeNode', { nodeId });
    const { object } = await pageCDP.send('DOM.resolveNode', { backendNodeId: node.shadowRoots[0].backendNodeId });
    await pageCDP.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { globalThis.screenHawkTestRoot = this; }',
    });
    await pageCDP.send('Runtime.releaseObject', { objectId: object.objectId });
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

  async function openHistory() {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 302, height: 380 });
    await popup.goto(`${base}/popup.html`);
    await popup.getByRole('heading', { name: 'History' }).waitFor();
    return popup;
  }

  async function assertAnswer() {
    await control('#answer:not(:empty), #error:not([hidden])').waitFor({ timeout: 30000 });
    if (await control('#error').isVisible()) throw new Error(await control('#error').innerText());
    assert.match(await control('#answer').innerText(), /73\.19/, 'invoice total missing from answer');
  }

  stage = 'verify Ask visibility and click target';
  await capture();
  const askButton = control('button[type=submit]');
  assert.equal(await askButton.count(), 1, 'overlay has one Ask button');
  assert.equal(await askButton.isVisible(), false, 'Ask is hidden while selecting an area');
  await selectArea();
  await askButton.waitFor({ state: 'visible' });
  assert.equal(await askButton.innerText(), 'Ask');
  assert.ok(await askButton.isEnabled(), 'Ask is enabled once the area is selected');
  const askBounds = await askButton.boundingBox();
  assert.ok(askBounds && askBounds.width > 4, 'Ask has a clickable right edge');
  await askButton.click({ position: { x: askBounds.width - 4, y: askBounds.height / 2 } });

  stage = 'verify missing-key handling and options';
  await control('#error').waitFor();
  assert.match(await control('#error').innerText(), /Add your OpenAI API key/);
  assert.ok(await askButton.isVisible(), 'Ask stays visible so the user can retry');
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
  if (!real) {
    stage = 'verify saved retired models use the new default';
    for (const model of ['gpt-4.1-nano-2025-04-14', 'gpt-4.1-nano']) {
      await worker.evaluate((model) => chrome.storage.local.set({ model }), model);
      await options.reload();
      await options.waitForFunction(() => !document.querySelector('fieldset').disabled);
      assert.equal(await options.getByLabel('Vision model').inputValue(), defaultModel);
    }
  }
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
  const askAppearance = () => ask.evaluate((button) => {
    const { backgroundColor, backdropFilter, borderTopColor, opacity } = getComputedStyle(button);
    return { backgroundColor, backdropFilter, borderTopColor, opacity };
  });
  const idle = {
    backgroundColor: 'rgba(119, 241, 207, 0.14)',
    backdropFilter: 'blur(8px)',
    borderTopColor: 'rgba(119, 241, 207, 0.34)',
    opacity: '0.78',
  };
  const active = { ...idle, backgroundColor: 'rgba(119, 241, 207, 0.24)', opacity: '1' };
  await page.mouse.move(0, 0);
  assert.deepEqual(await askAppearance(), idle, 'Ask uses dimmed, translucent glass at rest');
  const { height, width } = await ask.boundingBox();
  assert.ok(width >= 24 && height >= 24, 'Ask has at least a 24 by 24 CSS pixel hit target');
  await control('#cancel').focus();
  await page.keyboard.press('Tab');
  assert.ok(await ask.evaluate((button) => {
    const { outlineStyle, outlineWidth } = getComputedStyle(button);
    return button.matches(':focus-visible') && outlineStyle === 'solid' && outlineWidth === '2px';
  }), 'Ask has a visible outline when reached by keyboard');
  assert.deepEqual(await askAppearance(), active, 'keyboard focus restores full opacity');
  await page.keyboard.press('Shift+Tab');
  assert.deepEqual(await askAppearance(), idle, 'Ask dims when keyboard focus leaves');
  await ask.hover();
  assert.deepEqual(await askAppearance(), active, 'hover restores full opacity and stays translucent');
  const initiatingTab = !real && await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return { id: tab.id, windowId: tab.windowId, url: tab.url };
  });
  await ask.click({ position: { x: 4, y: height / 2 } });
  if (!real) {
    stage = 'verify delivery while the second tab is active';
    assert.equal(initiatingTab.url, page.url(), 'the initiating page must start as the active tab');
    await Promise.race([
      mockRequestReceived.promise,
      delay(7000, undefined, { ref: false }).then(() => assert.fail('the mock API did not receive the question')),
    ]);
    const secondTab = await context.newPage();
    await secondTab.goto(`${origin}/another-tab`);
    await secondTab.bringToFront();
    const tabs = await worker.evaluate((windowId) => chrome.tabs.query({ windowId }), initiatingTab.windowId);
    assert.equal(tabs.length, 2);
    const other = tabs.find(({ id }) => id !== initiatingTab.id);
    assert.equal(other?.active, true, 'Chromium must report the second tab as active');
    assert.equal(mockAnswerSent, false, 'mock response was sent before the second tab became active');
    assert.equal(await control('#answer').isVisible(), false, 'answer is hidden before release');
    mockAnswerRelease.resolve();

    await assertAnswer();
    const [activeTab] = await worker.evaluate((windowId) => chrome.tabs.query({ active: true, windowId }), initiatingTab.windowId);
    assert.equal(activeTab?.id, other.id, 'the second tab must stay active through answer delivery');
    assert.equal(await secondTab.locator('#screenhawk-overlay').count(), 0, 'the second tab must not receive an overlay');
    console.log('PASS two-tab timing | response held until second tab active | answer reached initiating tab only');
    await secondTab.close();
    await page.bringToFront();
  } else {
    stage = 'assert that answer contains 73.19';
    await assertAnswer();
  }

  stage = 'verify Ask visibility and answer focus';
  assert.equal(await askButton.isVisible(), false, 'Ask is hidden once the answer is shown');
  console.log('PASS Ask render, right-edge click, and visibility before selection, after an error, and after an answer');
  assert.ok(await control('#answer-title').evaluate((heading) => heading.matches(':focus')),
    'answer heading should receive focus');
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

    stage = 'check persisted history and reopen the saved answer';
    const { interactionHistory } = await worker.evaluate(() => chrome.storage.local.get('interactionHistory'));
    assert.equal(interactionHistory.length, 1, 'only the successful request is saved');
    const [entry] = interactionHistory;
    assert.deepEqual(Object.keys(entry).sort(), ['answer', 'id', 'prompt', 'thumbnail', 'timestamp']);
    assert.equal(entry.prompt, question);
    assert.equal(entry.answer, 'The invoice total is $73.19.');
    assert.ok(Math.abs(Date.now() - entry.timestamp) < 60000);
    assert.ok(entry.thumbnail.startsWith('data:image/jpeg;base64,'));
    assert.ok(entry.thumbnail.length < image.length, 'fixture thumbnail should be smaller than its upload');
    assert.deepEqual(await worker.evaluate(async () => Object.keys(await chrome.storage.sync.get())), []);

    const history = await openHistory();
    historyVideo = history.video();
    const saved = history.locator('#history-list li');
    await saved.locator('time').waitFor();
    assert.equal(await saved.locator('time').getAttribute('datetime'), new Date(entry.timestamp).toISOString());
    const thumbnail = await saved.getByRole('img', { name: 'Selected area' }).evaluate(async (image) => {
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    });
    assert.ok(thumbnail.width > 0 && thumbnail.width <= 320);
    assert.ok(thumbnail.height > 0 && thumbnail.height <= 200);
    await delay(500);
    await saved.getByText(question, { exact: true }).click();
    await saved.getByText(entry.answer, { exact: true }).waitFor();
    await history.screenshot({ scale: 'css', path: path.join(evidence, 'history-answer.png') });
    await delay(800);

    stage = 'delete an entry and confirm that it stays deleted';
    await saved.getByRole('button', { name: 'Delete entry' }).click();
    await history.getByText('No saved interactions.').waitFor();
    await history.screenshot({ scale: 'css', path: path.join(evidence, 'history-empty.png') });
    await delay(650);
    await history.close();
    const reopened = await openHistory();
    await reopened.getByText('No saved interactions.').waitFor();
    assert.equal(await reopened.locator('#history-list li').count(), 0);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('interactionHistory')).interactionHistory), []);
    await reopened.close();
    console.log('PASS saved success only, local JPEG thumbnail and time, reopened answer, persistent deletion');
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

    stage = 'verify Settings touch target at 320 CSS pixels';
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 320, height: 400 });
    await popupPage.goto(`${base}/popup.html`);
    const settingsLink = popupPage.getByRole('link', { name: 'Settings', exact: true });
    const box = await settingsLink.boundingBox();
    assert.ok(box && box.height >= 44, 'Settings link should be at least 44 CSS pixels tall');
    await popupPage.close();
  }

  if (!real) {
    const narrow = { width: 320, height: 480 };
    const invoiceActions = page.getByRole('button', { name: 'Invoice actions' });

    async function assertFocused(locator) {
      assert.ok(await locator.evaluate((element) => element === element.getRootNode().activeElement),
        `expected focus on ${locator}`);
    }

    async function assertInViewport(locator, viewport) {
      const box = await locator.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0 &&
        box.x >= 0 && box.y >= 0 &&
        box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
      `expected ${locator} within ${viewport.width}x${viewport.height}, got ${JSON.stringify(box)}`);
    }

    stage = 'verify selection focus and Escape restoration at 320x480';
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });
    // Selection mode closes on resize. Let the new viewport finish laying out before capture.
    await page.setViewportSize(narrow);
    await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, narrow);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await invoiceActions.focus();
    await assertFocused(invoiceActions);
    await capture();
    await assertFocused(control('dialog'));
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });
    await assertFocused(invoiceActions);

    stage = 'verify touch drag and cancellation at 320x480';
    const priorRequests = requests.length;
    await worker.evaluate(() => chrome.storage.local.remove('apiKey'));
    await capture();
    const dispatchTouch = (type, touchPoints = []) =>
      pageCDP.send('Input.dispatchTouchEvent', { type, touchPoints });

    await dispatchTouch('touchStart', [{ x: 30, y: 110 }]);
    await dispatchTouch('touchEnd');
    await control('#area').waitFor({ state: 'visible' });
    assert.equal(await control('#question').isVisible(), false);

    await dispatchTouch('touchStart', [{ x: 30, y: 110 }]);
    await dispatchTouch('touchMove', [{ x: 100, y: 160 }]);
    await control('#box').waitFor({ state: 'visible' });
    await dispatchTouch('touchCancel');
    await control('#box').waitFor({ state: 'hidden' });
    await control('#area').waitFor({ state: 'visible' });
    assert.equal(await control('#question').isVisible(), false);

    await dispatchTouch('touchStart', [{ x: 30, y: 110 }]);
    await dispatchTouch('touchMove', [{ x: 100, y: 160 }]);
    await dispatchTouch('touchEnd');
    await control('#question').waitFor({ state: 'visible' });
    assert.equal(requests.length, priorRequests);

    stage = 'verify narrow prompt and error controls by keyboard';
    const prompt = control('#question');
    const cancel = control('#cancel');
    const ask = control('button[type=submit]');
    await assertFocused(prompt);
    for (const locator of [control('form h2'), prompt, cancel, ask]) {
      await assertInViewport(locator, narrow);
    }
    await page.keyboard.type(question);
    await page.keyboard.press('Tab');
    await assertFocused(cancel);
    await page.keyboard.press('Tab');
    await assertFocused(ask);
    await page.keyboard.press('Shift+Tab');
    await assertFocused(cancel);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await control('#error').waitFor({ state: 'visible' });
    assert.match(await control('#error').innerText(), /Add your OpenAI API key/);
    assert.equal(requests.length, priorRequests);
    await assertInViewport(control('#error'), narrow);
    await assertInViewport(control('#options'), narrow);
    await assertInViewport(cancel, narrow);
    await assertInViewport(ask, narrow);
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });
    await assertFocused(invoiceActions);

    stage = 'verify keyboard order and viewport fit in narrow settings and popup documents';
    const settings = await context.newPage();
    await settings.setViewportSize(narrow);
    await settings.goto(`${base}/options.html`);
    await settings.waitForFunction(() => !document.querySelector('fieldset').disabled);
    for (const locator of [
      settings.getByLabel('OpenAI API key'),
      settings.getByLabel('Vision model'),
      settings.getByRole('button', { name: 'Save settings' }),
    ]) {
      await settings.keyboard.press('Tab');
      await assertFocused(locator);
      await assertInViewport(locator, narrow);
    }
    await settings.close();

    // A tab lets us size the popup document independently of the native toolbar bubble.
    const popup = await context.newPage();
    await popup.setViewportSize(narrow);
    await popup.goto(`${base}/popup.html`);
    for (const locator of [
      popup.getByRole('button', { name: 'Select area' }),
      popup.getByRole('button', { name: 'Draft for field' }),
      popup.getByRole('link', { name: 'Settings' }),
    ]) {
      await popup.keyboard.press('Tab');
      await assertFocused(locator);
      await assertInViewport(locator, narrow);
    }
    await popup.close();

    console.log('PASS 320x480 selection focus and Escape restoration, tiny touch, touch cancel and drag, prompt and error controls, Settings and popup keyboard order');
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

  if (!real) {
    stage = 'verify text-only form draft on the original page';
    await page.setViewportSize(size);
    await worker.evaluate((apiKey) => chrome.storage.local.set({ apiKey }), mockKey);
    await page.goto(`${origin}/form`);
    const field = page.locator('#experience');
    const value = 'fixture-current-value';
    await field.fill(value);
    await page.evaluate(() => {
      document.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        document.body.dataset.submitted = 'yes';
      });
      document.querySelector('#experience').addEventListener('input', () => {
        document.body.dataset.input = 'yes';
      });
    });

    async function openDraft(record = false) {
      const sessionId = await clickToolbarPopup('#draft');
      const launcher = page.locator('#screenhawk-draft-launcher');
      try {
        await launcher.waitFor({ state: 'attached' });
      } finally {
        await browserCDP.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      }
      await inspectOverlay('#screenhawk-draft-launcher');
      const button = control('button');
      assert.equal(await button.innerText(), 'Help me write');
      const buttonBox = await button.boundingBox();
      const fieldBox = await field.boundingBox();
      assert.ok(Math.abs(buttonBox.x + buttonBox.width + 4 - fieldBox.x - fieldBox.width) <= 1);
      assert.ok(Math.abs(buttonBox.y - fieldBox.y - 4) <= 1);
      if (record) {
        await page.screenshot({ scale: 'css', path: path.join(evidence, 'form-launcher.png') });
        await delay(1000);
      }
      await button.click();
      await overlay.waitFor({ state: 'attached' });
      await inspectOverlay();
    }

    const label = 'Describe your best job experience';
    const instructions = 'Describe my studio print run in one sentence.';
    const requestCount = requests.length;
    await openDraft();
    assert.equal(await control('#field-label').inputValue(), label);
    assert.equal(requests.length, requestCount, 'opening the dialog sent no request');
    await control('#field-label').clear();
    assert.equal(await control('#field-label').inputValue(), '');
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });
    assert.equal(requests.length, requestCount, 'canceling the dialog sent no request');

    await field.focus();
    await openDraft();
    await control('#question').evaluate((input, key) => { input.value = key; }, mockKey);
    await control('button[type=submit]').click();
    await control('#error').waitFor();
    assert.match(await control('#error').innerText(), /Remove your OpenAI API key/);
    assert.equal(requests.length, requestCount, 'an instruction containing the saved key was not sent');

    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });
    await field.focus();
    await openDraft();
    await control('#question').fill(instructions);
    await control('button[type=submit]').click();
    await control('#answer').waitFor();
    assert.equal(await control('#answer').innerText(), draftAnswer);

    assert.equal(requests.length, requestCount + 1);
    const { body } = requests.at(-1);
    assert.equal(body.store, false);
    const [message] = body.messages;
    assert.equal(message.content.length, 1);
    assert.equal(message.content[0].type, 'text');
    const [modelInstruction, contextLine, extra] = message.content[0].text.split('\n');
    assert.match(modelInstruction, /^Write only a draft/);
    assert.deepEqual(JSON.parse(contextLine), { fieldLabel: label, instructions });
    assert.equal(extra, undefined);
    const draftHistory = await worker.evaluate(() => chrome.storage.local.get('interactionHistory'));
    assert.deepEqual(draftHistory.interactionHistory, [], 'text drafts are not saved to capture history');
    assert.equal(await field.inputValue(), value);
    assert.equal(await control('#insert').innerText(), 'Replace field text');
    await field.evaluate((input) => { input.value = 'updated by the website'; });
    await control('#insert').click();
    assert.match(await control('#insert-error').innerText(), /text area changed/);
    assert.equal(await field.inputValue(), 'updated by the website');
    assert.equal(await page.locator('body').getAttribute('data-input'), null);
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'detached' });

    await field.clear();
    await page.evaluate(() => { delete document.body.dataset.input; });
    await openDraft(true);
    await control('#question').fill(instructions);
    await page.screenshot({ scale: 'css', path: path.join(evidence, 'form-instructions.png') });
    await delay(1000);
    await control('button[type=submit]').click();
    await control('#answer').waitFor();
    assert.equal(await field.inputValue(), '', 'generating a draft leaves the field untouched');
    assert.equal(await control('#insert').innerText(), 'Use draft');
    await page.screenshot({ scale: 'css', path: path.join(evidence, 'form-draft.png') });
    await delay(1000);
    await control('#insert').click();
    await overlay.waitFor({ state: 'detached' });
    assert.equal(await field.inputValue(), draftAnswer);
    assert.equal(await field.evaluate((input) => document.activeElement === input), true);
    assert.equal(await page.locator('body').getAttribute('data-input'), 'yes');
    assert.equal(await page.locator('#role').inputValue(), 'fixture-other-field');
    assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
    assert.equal(page.url(), `${origin}/form`);
    await delay(1000);
    console.log('PASS text area button, text-only draft, key guard, stale value guard, and explicit insertion without form submission');
  }

  console.log(`PASS ${real ? 'real OpenAI' : 'local mock'} | ${defaultModel} | 73.19 in the on-page answer | shortcut ${shortcut.shortcut}`);
  if (!real) console.log('PASS missing and rejected key, local settings, custom model, retired default, Escape, original tab, cropped PNG');
} catch (error) {
  // Error messages from Playwright protocol calls can contain evaluation arguments.
  const message = String(error.message).split(liveKey || '\u0000').join('[redacted]');
  console.error(`FAIL ${stage}: ${message}`);
  process.exitCode = 1;
} finally {
  mockAnswerRelease.resolve();
  try {
    const videoPath = await video?.path();
    const historyPath = await historyVideo?.path();
    if (context) await context.close();
    if (videoPath) await copyFile(videoPath, path.join(evidence, 'capture-flow.webm'));
    if (historyPath) await copyFile(historyPath, path.join(evidence, 'history-flow.webm'));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
}
