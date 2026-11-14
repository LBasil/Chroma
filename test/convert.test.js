// Tests du moteur de conversion. Le code du navigateur est chargé tel quel, sans modification.
// Lancer : node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
for (const file of ['names.js', 'convert.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
}
const Color = vm.runInContext('Color', context);

const close = (actual, expected, eps = 1e-3) =>
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < eps, `${actual} ≠ ${expected}`));

const srgb = input => Color.fromXyz('srgb', Color.parse(input).xyz);

test('hex à 6 chiffres', () => close(srgb('#ff0000'), [1, 0, 0]));
test('hex abrégé', () => close(srgb('#0f0'), [0, 1, 0]));
test('hex avec alpha', () => assert.equal(Color.parse('#ff000080').alpha.toFixed(2), '0.50'));
test('rgb()', () => close(srgb('rgb(0 0 255)'), [0, 0, 1]));
test('hsl()', () => close(srgb('hsl(120 100% 50%)'), [0, 1, 0]));
test('hwb()', () => close(srgb('hwb(0 0% 0%)'), [1, 0, 0]));
test('entier décimal 24 bits', () => close(srgb('16711680'), [1, 0, 0]));
test('transparent', () => assert.equal(Color.parse('transparent').alpha, 0));
test('entrée vide', () => assert.equal(Color.parse('   '), null));

test('aller-retour sRGB → XYZ → sRGB', () => {
  for (const rgb of [[0.2, 0.4, 0.6], [1, 1, 1], [0, 0, 0], [0.9, 0.1, 0.5]]) {
    close(Color.fromXyz('srgb', Color.toXyz('srgb', rgb)), rgb, 1e-6);
  }
});

test('rgb → hsl → rgb', () => {
  for (const rgb of [[1, 0, 0], [0.2, 0.4, 0.6], [0.9, 0.9, 0.1]]) {
    close(Color.hslToRgb(Color.rgbToHsl(rgb)), rgb, 1e-6);
  }
});

test('noir et blanc en CIE Lab', () => {
  assert.ok(Math.abs(Color.xyzToLab(Color.toXyz('srgb', [1, 1, 1]))[0] - 100) < 0.5);
  assert.ok(Math.abs(Color.xyzToLab(Color.toXyz('srgb', [0, 0, 0]))[0]) < 0.5);
});

test('noms de couleurs CSS : 148 entrées, formes hexadécimales valides', () => {
  const names = vm.runInContext('NAMES', context);
  assert.equal(Object.keys(names).length, 148);
  for (const hex of Object.values(names)) assert.match(hex, /^[0-9a-f]{6}$/);
});
