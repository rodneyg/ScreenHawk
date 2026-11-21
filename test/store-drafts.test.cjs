const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const manifest = require('../public/manifest.json');
const listing = readFileSync(join(__dirname, '../docs/chrome-web-store-listing-draft.md'), 'utf8');
const policy = readFileSync(join(__dirname, '../docs/privacy-policy-draft.md'), 'utf8');

test('the listing is marked as a draft and includes all store fields', () => {
  assert.match(listing, /^\*\*Draft for review\*\*$/m);
  const fields = Object.fromEntries(listing.split('\n## ').slice(1).map(section => {
    const [heading, ...body] = section.split('\n');
    return [heading, body.join('\n').trim()];
  }));

  assert.equal(fields.Name, manifest.name);
  assert.ok(fields['Short description']?.length > 0 && fields['Short description'].length <= 132);
  assert.ok(fields['Long description']);
  assert.ok(fields.Category);
});

test('the draft privacy policy explains every manifest permission', () => {
  assert.match(policy, /^\*\*Draft for review\*\*$/m);
  const permissions = [...policy.matchAll(/^\| `([^`]+)` \| [^|]+ \|$/gm)].map(([, permission]) => permission);
  assert.deepEqual(permissions.sort(), [...manifest.permissions, ...manifest.host_permissions].sort());
});
