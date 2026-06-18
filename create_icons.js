const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 1x1 transparent png
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Minimal 1x1 ico file
const icoBase64 = 'AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

fs.writeFileSync(path.join(assetsDir, 'icon.png'), Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), Buffer.from(icoBase64, 'base64'));

console.log('Icons created in assets directory.');
