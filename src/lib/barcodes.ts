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

  // 13 digits → verify/fix check digit → EAN-13
  if (/^\d{13}$/.test(clean)) {
    const base12 = clean.substring(0, 12);
    const correctCheck = calcEan13CheckDigit(base12);
    return { code: base12 + correctCheck, type: "ean13" };
  }

  // Anything else → Code128 fallback
  return { code: clean, type: "code128" };
}

/**
 * Generate barcode as SVG. Auto-detects format:
 * - EAN-13 for 13-digit individual product codes
 * - ITF-14 for 14-digit packaging codes (prefix "2")
 */
export async function generateBarcodeSvg(code: string): Promise<string> {
  const { code: normalizedCode, type } = normalizeBarcode(code);

  const baseOpts: Record<string, unknown> = {
    text: normalizedCode,
    includetext: true,
    textxalign: "center",
  };

  switch (type) {
    case "itf14":
      Object.assign(baseOpts, { bcid: "interleaved2of5", scale: 2, height: 14, bearers: 0 });
      break;
    case "ean13":
      Object.assign(baseOpts, { bcid: "ean13", scale: 3, height: 12 });
      break;
    case "ean8":
      Object.assign(baseOpts, { bcid: "ean8", scale: 3, height: 12 });
      break;
    default:
      Object.assign(baseOpts, { bcid: "code128", scale: 3, height: 12 });
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
