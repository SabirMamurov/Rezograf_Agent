import bwipjs from "bwip-js";

/**
 * Calculate EAN-13 check digit from the first 12 digits.
 */
function calcEan13CheckDigit(code12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(code12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Calculate GTIN-14 / ITF-14 check digit from the first 13 digits.
 * Equivalent to: from RIGHT, odd positions ×3, even positions ×1.
 * From LEFT (used here): odd positions ×3, even positions ×1.
 */
function calcItf14CheckDigit(code13: string): number {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(code13[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Normalize a barcode value for STORAGE in the DB. Mirrors the company's
 * convention so the stored value matches what BarTender would print:
 *   - 13 digits with prefix "2" → ITF-14 (transport): append GTIN-14 check → 14 digits
 *   - 12 digits                 → EAN-13 (consumer): append check → 13 digits
 *   - empty / null              → null
 *   - anything else (8, 13 non-"2" prefix, 14, non-digit) → kept verbatim
 *
 * Operators type the user-input portion of the code (12 digits for EAN-13,
 * 13 digits for ITF-14); the print engine in BarTender used to add the
 * check digit at print time. Now that we own the rendering, we add it on
 * write so DB and printed barcode are always 1-to-1.
 */
export function normalizeStoredBarcode(input: string | null | undefined): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return v; // pass through anything non-numeric (rare/manual)
  if (v.length === 12) return v + calcEan13CheckDigit(v);
  if (v.length === 13 && v.startsWith("2")) return v + calcItf14CheckDigit(v);
  return v;
}

/**
 * Normalize barcode and determine its type.
 * 
 * Rules (per business logic):
 * - 14 digits starting with '2': ITF-14 (packaging/transport barcode)
 * - 13 digits: EAN-13 (individual product barcode), fix check digit
 * - 12 digits: add check digit → EAN-13
 * - 8 digits: EAN-8
 * - Other: Code128 fallback
 */
function normalizeBarcode(raw: string): { code: string; type: "ean13" | "ean8" | "itf14" | "code128" } {
  const clean = raw.replace(/[\s-]/g, "");

  // 14 digits starting with '2' → ITF-14 (packaging label)
  if (/^\d{14}$/.test(clean) && clean.startsWith("2")) {
    return { code: clean, type: "itf14" };
  }

  // EAN-8
  if (/^\d{8}$/.test(clean)) {
    return { code: clean, type: "ean8" };
  }

  // 12 digits → pad with check digit → EAN-13
  if (/^\d{12}$/.test(clean)) {
    const check = calcEan13CheckDigit(clean);
    return { code: clean + check, type: "ean13" };
  }

  // 13 digits → EAN-13. Whether the operator's check digit follows the standard
  // EAN-13 formula or not, render the exact 13 digits the operator stored. For
  // valid check digits we use bwip-js (visually identical to historical labels);
  // for non-standard check digits we hand-render the EAN-13 SVG since bwip-js
  // refuses to draw a "broken" code. See generateBarcodeSvg for the dispatch.
  if (/^\d{13}$/.test(clean)) {
    return { code: clean, type: "ean13" };
  }

  // Anything else → Code128 fallback
  return { code: clean, type: "code128" };
}

// EAN-13 module patterns. L = left odd parity, G = left even parity, R = right.
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
// Parity sequence for left 6 digits, indexed by the first (13th) digit.
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/**
 * Generate EAN-13 SVG by hand, bypassing bwip-js's check-digit validation.
 * Used only for 13-digit codes whose check digit doesn't match the standard
 * EAN-13 formula (internal company SKUs). Visual is calibrated to match the
 * bwip-js output (scale=3, height=12).
 */
function customEan13Svg(code13: string): string {
  const first = parseInt(code13[0]);
  const left6 = code13.slice(1, 7);
  const right6 = code13.slice(7, 13);
  const parity = EAN_PARITY[first];

  // Module pattern: 95 modules total (3 + 7*6 + 5 + 7*6 + 3).
  let pattern = "101";
  for (let i = 0; i < 6; i++) {
    pattern += parity[i] === "L" ? EAN_L[parseInt(left6[i])] : EAN_G[parseInt(left6[i])];
  }
  pattern += "01010";
  for (let i = 0; i < 6; i++) {
    pattern += EAN_R[parseInt(right6[i])];
  }
  pattern += "101";

  // Match bwip-js (scale=3, height=12mm) layout: 286×126 viewBox, 3 px per module,
  // 87 px regular bar height, 103 px guard bar height (16 px extension below the
  // body for the classic EAN-13 "tail" between digit groups). Digits sit at y≈121.
  const mw = 3;
  const barH = 87;
  const guardH = 103;
  const totalH = 126;
  const totalW = 286;
  // bwip-js places leading digit text in the left margin then bars start ~module 3.
  // Match that: first bar at x=9 (3 modules of left margin for the leading digit).
  const startX = 9;

  const guardSet = new Set<number>();
  for (let i = 0; i < 3; i++) guardSet.add(i);
  for (let i = 45; i < 50; i++) guardSet.add(i);
  for (let i = 92; i < 95; i++) guardSet.add(i);

  // Run-length-encode consecutive '1' modules into a single rect — matches the
  // visual look bwip-js produces (one path per stroke width) instead of one rect
  // per module, and keeps the SVG small.
  const rects: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "1") {
      let j = i;
      while (j < pattern.length && pattern[j] === "1") j++;
      const isGuard = guardSet.has(i);
      const h = isGuard ? guardH : barH;
      const w = (j - i) * mw;
      rects.push(`<rect x="${startX + i * mw}" y="0" width="${w}" height="${h}" fill="#000"/>`);
      i = j;
    } else {
      i++;
    }
  }

  // Digits: leading + 6 left + 6 right. Position y just above the bottom edge
  // of the guard bars so digits visually sit "between" the descending guards.
  // OCR-B is the EAN-13 standard typeface; fall back to Courier-style monospace.
  const digitY = 122;
  const fontStyle = `font-family="OCR-B,Consolas,'Courier New',monospace" font-size="18" fill="#000"`;
  const digits: string[] = [];
  // Leading digit, left of the bars (in the quiet zone)
  digits.push(`<text x="2" y="${digitY}" ${fontStyle}>${code13[0]}</text>`);
  // Left 6: centred under modules 3..44 (each digit = 7 modules)
  for (let k = 0; k < 6; k++) {
    const cx = startX + (3 + k * 7 + 3.5) * mw;
    digits.push(`<text x="${cx}" y="${digitY}" ${fontStyle} text-anchor="middle">${left6[k]}</text>`);
  }
  // Right 6: centred under modules 50..91
  for (let k = 0; k < 6; k++) {
    const cx = startX + (50 + k * 7 + 3.5) * mw;
    digits.push(`<text x="${cx}" y="${digitY}" ${fontStyle} text-anchor="middle">${right6[k]}</text>`);
  }

  return `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg">${rects.join("")}${digits.join("")}</svg>`;
}

/**
 * Generate barcode as SVG. Auto-detects format:
 * - EAN-13 for 13-digit individual product codes
 * - ITF-14 for 14-digit packaging codes (prefix "2")
 */
export async function generateBarcodeSvg(
  code: string,
  opts: { separateText?: boolean } = {},
): Promise<string> {
  const { code: normalizedCode, type } = normalizeBarcode(code);

  // EAN-13 with non-standard check digit: bwip-js refuses, hand-render instead.
  if (type === "ean13" && /^\d{13}$/.test(normalizedCode)) {
    const expectedCheck = calcEan13CheckDigit(normalizedCode.substring(0, 12));
    if (expectedCheck !== parseInt(normalizedCode[12])) {
      return customEan13Svg(normalizedCode);
    }
  }

  // separateText=true → bwip-js draws ONLY the bars; the digits are rendered
  // by the consumer as ordinary HTML below the SVG. Use this for ITF-14
  // labels that get printed on the thermal head and partly worn on the
  // warehouse — bigger HTML digits with letter-spacing are far more
  // resilient to wear than the default tight in-SVG glyphs.
  const baseOpts: Record<string, unknown> = {
    text: normalizedCode,
    includetext: !opts.separateText,
    textxalign: "center",
  };
  // Per-symbology text size — bwip-js doesn't widen the viewBox to fit a
  // larger textsize, so we have to be careful: ITF-14 (14 digits) must keep
  // the default ~10pt or text spills past the right edge and the leftmost
  // characters get clipped by the SVG's intrinsic overflow:hidden.
  // EAN-13/EAN-8/Code128 have fewer characters so they tolerate +1pt.

  // Taller bars improve scan reliability on the thermal printer (operators
  // reported intermittent miss-scans on the smaller height). bwip-js
  // `height` is in mm; SVG viewBox height grows proportionally so the
  // bars get visually taller without changing bar widths or text size.
  switch (type) {
    case "itf14":
      // No textsize bump — ITF-14 has 14 digits, the default barely fits.
      Object.assign(baseOpts, { bcid: "interleaved2of5", scale: 2, height: 20, bearers: 0 });
      break;
    case "ean13":
      Object.assign(baseOpts, { bcid: "ean13", scale: 3, height: 17, textsize: 12 });
      break;
    case "ean8":
      Object.assign(baseOpts, { bcid: "ean8", scale: 3, height: 17, textsize: 12 });
      break;
    default:
      Object.assign(baseOpts, { bcid: "code128", scale: 3, height: 17, textsize: 12 });
      break;
  }

  const svg = (bwipjs as unknown as { toSVG: (opts: Record<string, unknown>) => string }).toSVG(baseOpts);
  return svg;
}

export function detectBarcodeType(code: string): string {
  return normalizeBarcode(code).type;
}

export async function generateEan13Svg(ean13: string): Promise<string> {
  return generateBarcodeSvg(ean13);
}

export async function generateDataMatrixSvg(data: string): Promise<string> {
  const svg = (bwipjs as unknown as { toSVG: (opts: Record<string, unknown>) => string }).toSVG({
    bcid: "datamatrix",
    text: data,
    scale: 3,
    height: 12,
    width: 12,
  });
  return svg;
}

export { normalizeBarcode, calcEan13CheckDigit };
