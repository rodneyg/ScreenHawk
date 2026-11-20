const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, renameSync, rmSync } = require('node:fs');
const path = require('node:path');

const output = path.resolve(__dirname, '../build');
const dist = path.resolve(__dirname, '../dist');
const archive = 'screenhawk-unpacked.zip';

mkdirSync(output, { recursive: true });
const temp = mkdtempSync(path.join(output, 'zip-'));
try {
  const staged = path.join(temp, archive);
  execFileSync('zip', ['-q', '-r', staged, '.'], { cwd: dist, stdio: 'inherit' });
  renameSync(staged, path.join(output, archive));
  console.log(`Created build/${archive}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
