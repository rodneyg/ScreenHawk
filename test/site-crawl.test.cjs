const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const site = join(__dirname, '../site');
const origin = 'https://screenhawk.rodneygainous.com';
const storeUrl = 'https://chromewebstore.google.com/detail/screenhawk/leppimoaddibhnikopkcooeaehcifbin';
const index = readFileSync(join(site, 'index.html'), 'utf8');

test('robots.txt allows crawling and points to the sitemap', () => {
  const robots = readFileSync(join(site, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${origin}/sitemap\\.xml$`, 'm'));
});

test('sitemap.xml lists the home page and every URL maps to a site page', () => {
  const xml = readFileSync(join(site, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes(`${origin}/`));
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${origin}/`), loc);
    const path = loc.slice(origin.length + 1) || 'index';
    assert.ok(existsSync(join(site, `${path}.html`)), `${loc} has no page`);
  }
});

test('landing page has the Web Store install link, canonical and og:image', () => {
  assert.match(index, new RegExp(`class="button button-primary"[^>]*href="${storeUrl}"`));
  assert.match(index, new RegExp(`<link rel="canonical" href="${origin}/">`));
  assert.match(index, new RegExp(`<meta property="og:image" content="${origin}/assets/social\\.png">`));
  assert.ok(existsSync(join(site, 'assets/social.png')));
});
