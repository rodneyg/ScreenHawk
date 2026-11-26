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
    if (name === 'index') {
      await page.waitForFunction(() => window.vaq?.some(([command, event]) => command === 'event' && event?.name === 'landing_view'));
    }
    const redacted = await page.evaluate(() => {
      const [command, redact] = window.vaq[0];
      return [command, redact({ type: 'pageview', url: location.href + '?email=private#private' })];
    });
    assert.deepEqual(redacted, ['beforeSend', { type: 'pageview', url: page.url() }]);
    const landingEvents = await page.evaluate(() => window.vaq
      .filter(([command, event]) => command === 'event' && event?.name === 'landing_view')
      .map(([command, event]) => [command, event]));
    assert.deepEqual(landingEvents, name === 'index' ? [['event', { name: 'landing_view', data: { source: 'direct' } }]] : []);
  }

  const storePattern = 'https://chromewebstore.google.com/**';
  await page.route(storePattern, (route) => route.fulfill({ body: 'Chrome Web Store fixture' }));
  const scenarios = [
    { query: '?utm_source=private%40example.test', source: 'direct' },
    { query: '?ref=producthunt&email=private%40example.test', source: 'producthunt', campaign: 'producthunt' },
    { query: '?utm_source=awesome_chrome&ref=launch-2026', source: 'awesome_chrome', campaign: 'launch-2026' },
    ...['x', 'reddit', 'hn', 'newsletter', 'instagram', 'podcast', 'directory', 'community', 'partner', 'email']
      .map((source) => ({ query: '?utm_source=' + source, source })),
    { query: '?utm_source=unknown&ref=Bad_Code', source: 'direct' },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const query = scenario.query;
    if (index === 1) {
      await page.route(origin + analyticsPath, (route) => route.abort('blockedbyclient'));
    }
    const unavailable = index === 1
      ? page.waitForEvent('requestfailed', (request) => request.url() === origin + analyticsPath)
      : page.waitForResponse(origin + analyticsPath);
    await page.goto(origin + '/' + query);
    await unavailable;
    await page.waitForFunction(() => window.vaq?.some(([command, event]) => command === 'event' && event?.name === 'landing_view'));
    const link = page.getByRole('link', { name: 'Add to Chrome' });
    await link.evaluate((element) => element.addEventListener('click', () => {
      window.queuedEvents = window.vaq.filter(([command]) => command === 'event')
        .map((args) => Array.from(args));
      sessionStorage.setItem('queuedEvents', JSON.stringify(window.queuedEvents));
    }, { once: true }));
    const destination = new URL(storeListing);
    if (scenario.source !== 'direct') {
      destination.searchParams.set('utm_source', scenario.source);
      destination.searchParams.set('utm_medium', 'site');
    }
    if (scenario.campaign) destination.searchParams.set('utm_campaign', scenario.campaign);
    assert.equal(await link.getAttribute('href'), destination.href);
    const landingEvent = await page.evaluate(() => window.vaq
      .filter(([command, event]) => command === 'event' && event?.name === 'landing_view')
      .map(([, event]) => event));
    assert.deepEqual(landingEvent, [{ name: 'landing_view', data: { source: scenario.source } }]);
    assert.equal(JSON.stringify(landingEvent).includes('launch-2026'), false);
    await Promise.all([page.waitForURL(destination.href), link.click()]);
    await page.goBack();

    const queued = await page.evaluate(() => JSON.parse(sessionStorage.getItem('queuedEvents')));
    assert.deepEqual(queued, [
      ['event', { name: 'landing_view', data: { source: scenario.source } }],
      ['event', { name: 'cws_install_click', data: { source: scenario.source } }],
    ]);
  }

  const forwarded = await page.getByRole('link', { name: 'Add to Chrome' }).evaluate((element) => {
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

  assert.deepEqual(errors, []);
});
