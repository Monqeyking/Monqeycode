const digits = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
};

function badgeBitmap(count) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const value = Math.min(99, Math.trunc(count));
  if (!value) return null;
  const label = value > 9 ? '9+' : String(value);
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15 ** 2) buffer.set([65, 65, 226, 255], (y * size + x) * 4);
  }
  const scale = 3;
  const left = Math.floor((size - (label.length * 4 - 1) * scale) / 2);
  for (let i = 0; i < label.length; i++) for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (digits[label[i]][y][x] !== '1') continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      buffer.set([255, 255, 255, 255], ((8 + y * scale + dy) * size + left + i * 4 * scale + x * scale + dx) * 4);
    }
  }
  return { buffer, width: size, height: size };
}

module.exports = { badgeBitmap };
