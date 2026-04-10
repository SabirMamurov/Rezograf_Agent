const sizeOf = require('image-size');
const fs = require('fs');

const files = fs.readdirSync('public/icons').filter(f => f.startsWith('media__1775618'));
files.forEach(f => {
  const d = sizeOf('public/icons/' + f);
  console.log(f, d.width + 'x' + d.height, 'Size:', fs.statSync('public/icons/' + f).size);
});
