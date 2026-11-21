const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const dist = path.resolve(__dirname, '../dist');
const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));

function checkIcons(field, icons, sizes) {
  for (const size of sizes) {
    const file = icons?.[size];
    if (typeof file !== 'string' || !file.endsWith('.png')) {
      throw new Error(`${field}[${size}] must reference a PNG in the built extension`);
    }
    const image = PNG.sync.read(readFileSync(path.join(dist, file)));
    if (image.width !== size || image.height !== size) {
      throw new Error(`${file}: expected ${size}x${size}, found ${image.width}x${image.height}`);
    }
  }
}

try {
  checkIcons('icons', manifest.icons, [16, 32, 48, 128]);
  checkIcons('action.default_icon', manifest.action?.default_icon, [16, 32]);
  console.log('Validated ScreenHawk extension and toolbar icons.');
} catch (error) {
  console.error(`Icon check failed: ${error.message}`);
  process.exitCode = 1;
}
