// Pre-build script: writes a fresh version.json with the current timestamp.
// The running app polls this file and prompts users to reload when it changes.
const fs = require('fs');
const path = require('path');

const version = Date.now().toString();
const outDir = path.join(__dirname, '..', 'public');
const outFile = path.join(outDir, 'version.json');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ version }, null, 2));
console.log(`[build] version.json generated: ${version}`);
