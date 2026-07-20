const fs = require('fs');
const path = require('path');

const frontendRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(frontendRoot, 'public', 'tesseract');
const workerRoot = path.dirname(require.resolve('tesseract.js'));
const tesseractRoot = path.resolve(workerRoot, '..');
const coreRoot = path.dirname(require.resolve('tesseract.js-core'));
const languageRoot = path.dirname(require.resolve('@tesseract.js-data/ita'));

const assets = [
  {
    source: path.join(tesseractRoot, 'dist', 'worker.min.js'),
    target: path.join(publicRoot, 'worker.min.js'),
  },
  {
    source: path.join(coreRoot, 'tesseract-core-lstm.wasm.js'),
    target: path.join(publicRoot, 'core', 'tesseract-core-lstm.wasm.js'),
  },
  {
    source: path.join(coreRoot, 'tesseract-core-simd-lstm.wasm.js'),
    target: path.join(publicRoot, 'core', 'tesseract-core-simd-lstm.wasm.js'),
  },
  {
    source: path.join(coreRoot, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    target: path.join(publicRoot, 'core', 'tesseract-core-relaxedsimd-lstm.wasm.js'),
  },
  {
    source: path.join(languageRoot, '4.0.0', 'ita.traineddata.gz'),
    target: path.join(publicRoot, 'lang', 'ita.traineddata.gz'),
  },
];

for (const asset of assets) {
  fs.mkdirSync(path.dirname(asset.target), { recursive: true });
  fs.copyFileSync(asset.source, asset.target);
}

console.log(`[ocr] ${assets.length} asset copiati in public/tesseract`);
