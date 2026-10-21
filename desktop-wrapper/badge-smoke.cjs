const assert = require('node:assert/strict');
const { app, nativeImage } = require('electron');
const { badgeBitmap } = require('./attention.cjs');
try {
  const bitmap = badgeBitmap(1);
  const image = nativeImage.createFromBitmap(bitmap.buffer, { width: bitmap.width, height: bitmap.height });
  assert.equal(image.isEmpty(), false);
  assert.deepEqual(image.getSize(), { width: 32, height: 32 });
  assert.ok(image.toPNG().length > 0);
  console.log('Native Electron badge: non-empty 32x32 image and PNG encoding pass.');
  app.exit(0);
} catch (error) {
  console.error(error.message);
  app.exit(1);
}
