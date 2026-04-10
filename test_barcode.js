const bwipjs = require('bwip-js');

// Test the exact barcode that the user sees
const code = '2464020120526';
console.log('Testing code:', code, '(' + code.length + ' digits)');

// Check digit calculation
let sum = 0;
for (let i = 0; i < 12; i++) {
  sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
}
const expected = (10 - (sum % 10)) % 10;
const actual = parseInt(code[12]);
console.log('Check digit: actual=' + actual + ', expected=' + expected, actual === expected ? 'VALID' : 'INVALID');

// Fix check digit
const fixedCode = code.substring(0, 12) + expected;
console.log('Fixed code:', fixedCode);

// Now try rendering
try {
  const svg = bwipjs.toSVG({
    bcid: 'ean13',
    text: fixedCode,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
  });
  console.log('\nRendered OK, SVG length:', svg.length);
} catch (e) {
  console.log('\nRender ERROR:', e.message);
}

// Also test rendering the ORIGINAL code (without correction)
try {
  const svg = bwipjs.toSVG({
    bcid: 'ean13',
    text: code,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
  });
  console.log('Original code render OK');
} catch (e) {
  console.log('Original code render ERROR:', e.message);
}
