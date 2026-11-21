const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const manifest = require('../public/manifest.json');

test('every manifest permission has a reason in site/permissions.md', () => {
  const doc = readFileSync(join(__dirname, '../site/permissions.md'), 'utf8');
  const documented = Array.from(doc.matchAll(/^\| `([^`\r\n]+)` \| ([^|\r\n]+) \|\r?$/gm), ([, permission, reason]) => {
    assert.ok(reason.trim(), `Missing reason for ${permission}`);
    return permission;
  });

  const declared = [
    ...(manifest.permissions ?? []),
    ...(manifest.host_permissions ?? []),
    ...(manifest.optional_permissions ?? []),
    ...(manifest.optional_host_permissions ?? []),
  ];

  assert.deepEqual(documented.sort(), declared.sort(), 'Update the permission rows in site/permissions.md');
});
