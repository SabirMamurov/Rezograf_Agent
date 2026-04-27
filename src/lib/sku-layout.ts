/**
 * Adaptive SKU font sizing for the label's top-right slot.
 *
 * The slot sits under the row of certification icons inside the right column
 * of the top row. In the 700×900 virtual canvas it is ~320 px wide and ~84 px
 * tall (160 px column height − 68 px icon row − a few px of internal padding).
 *
 * One SKU renders centered. Two SKUs stack vertically (sku above sku2). The
 * font is computed from the longer of the two so both lines are the same size.
 *
 * Why a closed-form formula and not JS measurement: this code runs in two
 * places — the React preview AND the Puppeteer HTML in `/api/render`. Doing
 * `getBoundingClientRect()` would couple the latter to a layout pass we can
 * skip. The constants below are calibrated for Roboto Condensed Bold with
 * letter-spacing −1 px (numeric glyphs ≈ 0.42 em wide).
 */
const SLOT_WIDTH = 312;     // 320 − 8 px breathing room
const SLOT_HEIGHT = 80;     // 84 − 4 px breathing room
// Empirically calibrated by rendering a known SKU and measuring the resulting
// PNG: "12468" at 88 px ≈ 269 virtual px wide → per-char ≈ 0.62 em. Numeric
// glyphs in Roboto Condensed Bold are wider than the all-character average.
const CHAR_WIDTH_FACTOR = 0.62;
const LINE_HEIGHT_FACTOR = 0.85;
const FONT_CAP = 88;        // preserves current visual for short SKUs
const LETTER_SPACING_PX = 1;

export interface SkuLayout {
  /** Computed font-size in CSS px. 0 if no SKU is present. */
  fontSize: number;
  /** SKUs to render, in order, with empties stripped. */
  lines: string[];
}

export function computeSkuLayout(sku?: string | null, sku2?: string | null): SkuLayout {
  const lines = [sku, sku2]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);

  if (lines.length === 0) return { fontSize: 0, lines: [] };

  const longest = Math.max(...lines.map((s) => s.length));

  // text_width(N, fs) = N * (0.42 * fs − 1)  →  fs = (W + N) / (N * 0.42)
  const fontByWidth = (SLOT_WIDTH + longest * LETTER_SPACING_PX) / (longest * CHAR_WIDTH_FACTOR);
  const fontByHeight = SLOT_HEIGHT / lines.length / LINE_HEIGHT_FACTOR;

  return {
    fontSize: Math.floor(Math.min(FONT_CAP, fontByWidth, fontByHeight)),
    lines,
  };
}
