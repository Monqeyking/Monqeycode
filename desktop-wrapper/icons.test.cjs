const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { createHash } = require('node:crypto');

test('Windows taskbar frames use 32-bit bitmap icons and preserve the original Monqey pixels', () => {
  const ico = fs.readFileSync(path.join(__dirname, 'assets/monqey.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const at = 6 + i * 16, width = ico[at] || 256, height = ico[at + 1] || 256;
    sizes.push(width);
    assert.equal(height, width);
    const start = ico.readUInt32LE(at + 12), length = ico.readUInt32LE(at + 8);
    assert.ok(start + length <= ico.length);
    const frame = ico.subarray(start, start + length);
    if (width === 256) { assert.equal(PNG.sync.read(frame).width, 256); continue; }
    // Windows shell extraction needs bitmap frames at taskbar sizes, even when Electron accepts PNG.
    assert.equal(frame.readUInt32LE(0), 40);
    assert.equal(frame.readInt32LE(4), width);
    assert.equal(frame.readInt32LE(8), height * 2);
    assert.equal(frame.readUInt16LE(14), 32);
    assert.equal(frame.readUInt32LE(16), 0);
    assert.equal(length, 40 + width * height * 4 + Math.ceil(width / 32) * 4 * height);
    if (width === 32) {
      const actual = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const from = 40 + ((height - 1 - y) * width + x) * 4, to = (y * width + x) * 4;
        actual[to] = frame[from + 2]; actual[to + 1] = frame[from + 1]; actual[to + 2] = frame[from]; actual[to + 3] = frame[from + 3];
      }
      assert.equal(createHash('sha256').update(actual).digest('hex'), 'ff3dcd8e1ffd29ebc28f5850b351215fa7dbd9cc33df83820af21033fb0084d7', 'The original 32px Monqey mark must stay unchanged');
    }
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
});
