import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from 'playwright';

const site = new URL('../site/', import.meta.url);
const pages = ['index', 'privacy', 'support', 'terms', 'changelog'];
const analyticsPath = '/_vercel/insights/script.js';
const storeListing = 'https://chromewebstore.google.com/detail/screenhawk/leppimoaddibhnikopkcooeaehcifbin';

test('marketing analytics keeps tracking data minimal and the Store link usable', async (t) => {
  const assets = new Map(await Promise.all(
    [...pages.map((name) => name + '.html'), 'store.js', 'styles.css', 'assets/icon.png']
      .map(async (file) => [file, await readFile(new URL(file, site))]),
  ));
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    const asset = assets.get(file);
    const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' };
    if (asset) {
      res.writeHead(200, { 'Content-Type': types[file.split('.').pop()] }).end(asset);
    } else {
      res.writeHead(pathname === analyticsPath ? 404 : 204).end();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Chromium reports failed script requests separately from JavaScript errors.
    if (message.type() === 'error' && message.location().url !== origin + analyticsPath) {
      errors.push(message.text());
    }
  });
  for (const name of pages) {
    const failedScript = page.waitForResponse(origin + analyticsPath);
    await page.goto(origin + '/' + name + '.html');
    assert.equal((await failedScript).status(), 404);
    assert.equal(await page.locator('script[defer][src="' + analyticsPath + '"]').count(), 1);
    const redacted = await page.evaluate(() => {
      const [command, redact] = window.vaq[0];
      return [command, redact({ type: 'pageview', url: location.href + '?email=private#private' })];
    });
    assert.deepEqual(redacted, ['beforeSend', { type: 'pageview', url: page.url() }]);
  }

  const storePattern = 'https://chromewebstore.google.com/**';
  await page.route(storePattern, (route) => route.fulfill({ body: 'Chrome Web Store fixture' }));
  for (const [failure, query, source] of [
    ['404', '?utm_source=private%40example.test', 'direct'],
    ['blocked', '?ref=producthunt&email=private%40example.test', 'producthunt'],
  ]) {
    if (failure === 'blocked') {
      await page.route(origin + analyticsPath, (route) => route.abort('blockedbyclient'));
    }
    const unavailable = failure === 'blocked'
      ? page.waitForEvent('requestfailed', (request) => request.url() === origin + analyticsPath)
      : page.waitForResponse(origin + analyticsPath);
    await page.goto(origin + '/' + query);
    await unavailable;
    const link = page.getByRole('link', { name: 'Add to Chrome' });
    await link.evaluate((element) => element.addEventListener('click', (event) => {
      window.queuedEvents = window.vaq.filter(([command]) => command === 'event')
        .map((args) => Array.from(args));
      sessionStorage.setItem('queuedEvents', JSON.stringify(window.queuedEvents));
    }, { once: true }));
    const destination = new URL(storeListing);
    if (source !== 'direct') destination.searchParams.set('utm_source', source);
    assert.equal(await link.getAttribute('href'), destination.href);
    await Promise.all([page.waitForURL(destination.href), link.click()]);
    await page.goBack();

    const queued = await page.evaluate(() => JSON.parse(sessionStorage.getItem('queuedEvents')));
    assert.deepEqual(queued, [['event', { name: 'cws_install_click', data: { source } }]]);
    const forwarded = await link.evaluate((element) => {
      window.vaq = [];
      for (const source of ['awesome_chrome', 'private@example.test']) {
        element.dispatchEvent(new CustomEvent('cws_install_click', {
          detail: { source, email: 'private@example.test' },
        }));
      }
      return window.vaq.map((args) => Array.from(args));
    });
    assert.deepEqual(forwarded, ['awesome_chrome', 'direct']
      .map((source) => ['event', { name: 'cws_install_click', data: { source } }]));
  }

  assert.deepEqual(errors, []);
});
