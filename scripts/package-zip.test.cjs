const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const npm = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
const zip = execFileSync('which', ['zip'], { encoding: 'utf8' }).trim();

function packageExtension(t, { zipMode = 'real', priorArchive = false, buildFails = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'screenhawk-package-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const bin = path.join(root, 'bin');
  const output = path.join(root, 'build');
  const archive = path.join(output, 'screenhawk-unpacked.zip');
  mkdirSync(bin);
  mkdirSync(path.join(root, 'scripts'));
  symlinkSync(process.execPath, path.join(bin, 'node'));
  symlinkSync(npm, path.join(bin, 'npm'));
  if (zipMode === 'real') {
    symlinkSync(zip, path.join(bin, 'zip'));
  } else if (zipMode === 'fail') {
    writeFileSync(path.join(bin, 'zip'), [
      '#!/bin/sh',
      'printf "partial archive" > "$3"',
      'printf "fixture zip failed\\n" >&2',
      'exit 7',
      '',
    ].join('\n'), { mode: 0o755 });
  }

  const packageJson = require('../package.json');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      'package:zip': packageJson.scripts['package:zip'],
      build: 'node build.cjs',
    },
  }));
  writeFileSync(path.join(root, 'scripts', 'package-zip.cjs'),
    readFileSync(path.join(__dirname, 'package-zip.cjs')));
  writeFileSync(path.join(root, 'build.cjs'), `
    const fs = require('node:fs');
    fs.writeFileSync('archive-during-build.txt', String(fs.existsSync('build/screenhawk-unpacked.zip')));
    if (${buildFails}) {
      console.error('fixture build failed');
      process.exit(3);
    }
    fs.mkdirSync('dist');
    fs.writeFileSync('dist/manifest.json', '{"name":"fresh build"}');
  `);
  if (priorArchive) {
    mkdirSync(output);
    writeFileSync(archive, 'old archive');
  }

  const run = spawnSync(npm, ['run', 'package:zip'], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin,
      npm_config_cache: path.join(root, 'npm-cache'),
      npm_config_script_shell: '/bin/sh',
    },
    encoding: 'utf8',
  });
  assert.ifError(run.error);
  return { archive, output, root, run };
}

function assertFreshArchive({ archive, output, run }) {
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readdirSync(output), ['screenhawk-unpacked.zip']);
  assert.equal(execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim(), 'manifest.json');
  assert.equal(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' }),
    '{"name":"fresh build"}');
}

test('packages a successful build with the manifest at the root', (t) => {
  assertFreshArchive(packageExtension(t));
});

test('removes the prior archive before building and replaces it on success', (t) => {
  const result = packageExtension(t, { priorArchive: true });
  assert.equal(readFileSync(path.join(result.root, 'archive-during-build.txt'), 'utf8'), 'false');
  assertFreshArchive(result);
});

test('leaves no archive when zip is missing', (t) => {
  const { output, run } = packageExtension(t, { priorArchive: true, zipMode: 'missing' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /spawnSync zip ENOENT/);
  assert.deepEqual(readdirSync(output), []);
});

test('removes the prior archive and partial output when zip fails', (t) => {
  const { output, run } = packageExtension(t, { priorArchive: true, zipMode: 'fail' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /fixture zip failed/);
  assert.deepEqual(readdirSync(output), []);
});

test('leaves no archive when the build fails', (t) => {
  const { output, run } = packageExtension(t, { priorArchive: true, buildFails: true });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /fixture build failed/);
  assert.deepEqual(readdirSync(output), []);
});
