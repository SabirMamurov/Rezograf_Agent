// Generate visual comparison: bwip-js EAN-13 vs custom EAN-13.
const bwipjs = require("bwip-js");
const fs = require("fs");
const path = require("path");

const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function customEan13(c13) {
  const first = parseInt(c13[0]);
  const left = c13.slice(1,7), right = c13.slice(7,13);
  const par = EAN_PARITY[first];
  let pat = "101";
  for (let i = 0; i < 6; i++) pat += par[i]==="L" ? EAN_L[parseInt(left[i])] : EAN_G[parseInt(left[i])];
  pat += "01010";
  for (let i = 0; i < 6; i++) pat += EAN_R[parseInt(right[i])];
  pat += "101";

  const mw = 3, barH = 87, guardH = 103;
  const totalW = 286, totalH = 126;
  const startX = 9;
  const guard = new Set();
  for (let i=0;i<3;i++) guard.add(i);
  for (let i=45;i<50;i++) guard.add(i);
  for (let i=92;i<95;i++) guard.add(i);

  let rects = "";
  let i = 0;
  while (i < pat.length) {
    if (pat[i] === "1") {
      let j = i;
      while (j < pat.length && pat[j] === "1") j++;
      const h = guard.has(i) ? guardH : barH;
      const w = (j - i) * mw;
      rects += `<rect x="${startX+i*mw}" y="0" width="${w}" height="${h}" fill="#000"/>`;
      i = j;
    } else { i++; }
  }
  const dy = 122;
  const fs = `font-family="OCR-B,Consolas,'Courier New',monospace" font-size="18" fill="#000"`;
  let texts = `<text x="2" y="${dy}" ${fs}>${c13[0]}</text>`;
  for (let k = 0; k < 6; k++) texts += `<text x="${startX + (3+k*7+3.5)*mw}" y="${dy}" ${fs} text-anchor="middle">${left[k]}</text>`;
  for (let k = 0; k < 6; k++) texts += `<text x="${startX + (50+k*7+3.5)*mw}" y="${dy}" ${fs} text-anchor="middle">${right[k]}</text>`;
  return `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg">${rects}${texts}</svg>`;
}

const validCode = "5901234123457";
const nonStdCode = "2463004933739";

const bwipValid = bwipjs.toSVG({ bcid: "ean13", text: validCode, includetext: true, scale: 3, height: 12 });
const myValid = customEan13(validCode);
const myNonStd = customEan13(nonStdCode);

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#f4f4f4;padding:20px">
<h2>Сравнение рендера штрих-кодов</h2>
<div style="background:#fff;padding:20px;margin:10px;display:inline-block">
  <h3>bwip-js EAN-13 (валидный 5901234123457)</h3>${bwipValid}
</div>
<div style="background:#fff;padding:20px;margin:10px;display:inline-block">
  <h3>Мой кастом EAN-13 (тот же 5901234123457)</h3>${myValid}
</div>
<div style="background:#fff;padding:20px;margin:10px;display:inline-block">
  <h3>Мой кастом EAN-13 (нестандартный 2463004933739 — девятка на месте)</h3>${myNonStd}
</div>
<div style="background:#fff8e6;padding:20px;margin:10px;border-left:4px solid #ddaa00">
<p>Слева — то, что рисует bwip-js (наш стандартный рендерер). В центре — то же значение моим кастомным рендерером. Должны выглядеть одинаково (одни и те же бары и цифры, шрифт может отличаться).</p>
<p>Справа — нестандартный код, который раньше рендерился как <code>2463004933732</code> (последняя цифра подменена). Теперь печатается <code>2463004933739</code> с той же визуальной структурой EAN-13.</p>
</div>
</body></html>`;

const outPath = path.join(__dirname, "..", "import_runs", "barcode_cmp.html");
fs.writeFileSync(outPath, html);
console.log("Written: " + outPath);
console.log("bwip-js valid SVG:", bwipValid.length, "chars");
console.log("custom valid SVG:", myValid.length, "chars");
console.log("custom non-std SVG:", myNonStd.length, "chars");
