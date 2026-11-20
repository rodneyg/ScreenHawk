const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEntry, draft, renderEntry } = require('./changelog.js');

const published = `---
date: 2026-11-20
title: ScreenHawk 1.0.0
status: published
prs: 11, 10
---
## New
- Select part of a tab.
`;

test('parseEntry reads published frontmatter and bullets', () => {
  const entry = parseEntry(published);
  assert.equal(entry.date, '2026-11-20');
  assert.equal(entry.title, 'ScreenHawk 1.0.0');
  assert.equal(entry.status, 'published');
  assert.deepEqual(entry.prs, [11, 10]);
  assert.deepEqual(entry.sections.New, ['Select part of a tab.']);
});

test('parseEntry rejects em dashes, bad dates, and empty published entries', () => {
  assert.throws(() => parseEntry(published.replace('Select part of a tab.', 'Select part of a tab\u2014now')), /em or en dashes/);
  assert.throws(() => parseEntry(published.replace('2026-11-20', '2026-13-40')), /Invalid changelog metadata/);
  assert.throws(() => parseEntry(`---\ndate: 2026-11-20\ntitle: Empty\nstatus: published\nprs: 1\n---\n`), /Published entries need bullets/);
});

test('draft uses the Changelog section and replaces em dashes', () => {
  const text = draft({
    number: 12,
    title: 'Internal update',
    merged_at: '2026-11-20T15:00:00Z',
    body: 'Intro\n## Changelog\n### Fixed\n- Restore setup\u2014retry\n## Testing\nPrivate details',
  });
  assert.match(text, /status: draft/);
  assert.match(text, /## Fixed\n- Restore setup, retry/);
  assert.doesNotMatch(text, /Private details/);
  assert.match(text, /title: Internal update/);
  assert.match(draft({ number: 13, title: 'Fix setup\u2014retry', merged_at: '2026-11-20T15:00:00Z', body: '' }), /Fix setup, retry/);
});

test('renderEntry escapes HTML and formats the date', () => {
  const html = renderEntry({
    date: '2026-11-20',
    title: 'A <title> & more',
    sections: { New: ['Use <select> carefully'], Improved: [], Fixed: [] },
  });
  assert.match(html, /<time datetime="2026-11-20">November 20, 2026<\/time>/);
  assert.match(html, /A &lt;title&gt; &amp; more/);
  assert.match(html, /Use &lt;select&gt; carefully/);
  assert.doesNotMatch(html, /<title>/);
});

test('build writes only published entries into the site page', () => {
  const script = path.join(__dirname, 'changelog.js');
  const originalRoot = fs.readFileSync(script, 'utf8');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'screenhawk-changelog-'));
  fs.mkdirSync(path.join(work, 'changelog'));
  fs.mkdirSync(path.join(work, 'site'));
  fs.writeFileSync(path.join(work, 'site/changelog.template.html'), '<div class="changelog">\n<!-- CHANGELOG_ENTRIES -->\n</div>\n');
  fs.writeFileSync(path.join(work, 'changelog/2026-11-20-published.md'), published);
  fs.writeFileSync(path.join(work, 'changelog/2026-11-21-draft.md'), published.replace('published', 'draft').replace('ScreenHawk 1.0.0', 'Hidden draft').replace('11, 10', '12'));
  const isolated = originalRoot.replace(
    'const root = path.resolve(__dirname, \'..\');',
    `const root = ${JSON.stringify(work)};`,
  );
  const isolatedPath = path.join(work, 'changelog.js');
  fs.writeFileSync(isolatedPath, isolated);
  const isolatedModule = require(isolatedPath);
  isolatedModule.build();
  const html = fs.readFileSync(path.join(work, 'site/changelog.html'), 'utf8');
  assert.match(html, /ScreenHawk 1\.0\.0/);
  assert.match(html, /Select part of a tab\./);
  assert.doesNotMatch(html, /Hidden draft/);
  fs.rmSync(work, { recursive: true, force: true });
});
