// Generates lib/client.js from lib/client.template.js, embedding sprite data and the pixel font.
const fs = require('node:fs');
const path = require('node:path');
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p));
const font = (name) => 'data:font/ttf;base64,' + read('assets', name).toString('base64');
const out = read('lib', 'client.template.js', ).toString('utf8')
  .replace('__SPRITES__', () => read('lib', 'sprites.json').toString('utf8'))
  .replace('__FONT400__', () => font('PixelifySans-400.ttf'))
  .replace('__FONT600__', () => font('PixelifySans-600.ttf'));
fs.writeFileSync(path.join(__dirname, 'lib', 'client.js'), out);
