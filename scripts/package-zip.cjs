const { execFileSync, execSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, renameSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build');
const dist = path.join(root, 'dist');
const archive = 'screenhawk-unpacked.zip';
const destination = path.join(output, archive);

mkdirSync(output, { recursive: true });
rmSync(destination, { force: true });
execSync('npm run build', { cwd: root, stdio: 'inherit' });

const temp = mkdtempSync(path.join(output, 'zip-'));
try {
  const staged = path.join(temp, archive);
  execFileSync('zip', ['-q', '-r', staged, '.'], { cwd: dist, stdio: 'inherit' });
  renameSync(staged, destination);
  console.log(`Created build/${archive}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
