"use client";

import React, { useState } from "react";
import { computeSkuLayout } from "@/lib/sku-layout";

interface Product {
  name: string;
  sku?: string | null;
  sku2?: string | null;
  composition?: string | null;
  weight?: string | null;
  nutritionalInfo?: string | null;
  storageCond?: string | null;
  barcodeEan13?: string | null;
  certCode?: string | null;
  quantity?: string | null;
  boxWeight?: string | null;
  sponsorText?: string | null;
  extraText?: string | null;
  btwFilePath?: string | null;
  isExport?: boolean | null;
  isShkLabel?: boolean | null;
  manufacturerType?: string | null;
  showCedarLogo?: boolean | null;
  showLabelDates?: boolean | null;
}

interface LabelPreviewProps {
  product: Product;
  barcodeSvg?: string;
  widthMm?: number;
  heightMm?: number;
  scale?: number;
  mfgDate?: string;
  expDate?: string;
}

/**
 * Check if composition is a duplicate of the product name.
 * If so, we skip showing it to avoid duplication on the label.
 */
function isCompositionDuplicate(name: string, composition: string | null | undefined): boolean {
  if (!composition) return true; // nothing to show
  const a = name.toLowerCase().replace(/[/\\]/g, "").trim();
  const b = composition.toLowerCase().replace(/[/\\]/g, "").trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

// Spreads barcode digits evenly to the container width by putting each
// glyph in its own span inside a flex space-between row. CSS `text-align:
// justify` only distributes by whitespace, so a no-space digit string
// stays clumped — this is the reliable way. Mirrored in route.ts as
// `spreadDigitsHtml`.
function SpreadDigits({
  digits,
  fontSize,
  style,
}: {
  digits: string;
  fontSize: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontFamily: "'Roboto Condensed', sans-serif",
        fontVariantNumeric: "tabular-nums",
        fontSize: `${fontSize}px`,
        fontWeight: 900,
        lineHeight: 1,
        ...style,
      }}
    >
      {Array.from(digits).map((d, i) => (
        <span key={i}>{d}</span>
      ))}
    </div>
  );
}

/**
 * WYSIWYG label preview — 70×90mm portrait orientation.
 * Fixed 700×900 virtual canvas scaled via CSS transform.
 * 
 * Changes from original:
 * - Increased font sizes for better readability after printing
 * - Removed composition duplication when it matches product name
 */
export default function LabelPreview({
  product,
  barcodeSvg,
  widthMm = 70,
  heightMm = 90,
  scale = 3,
  mfgDate,
  expDate,
}: LabelPreviewProps) {
  // Force portrait orientation in case the DB has width > height
  let finalWidthMm = widthMm;
  let finalHeightMm = heightMm;
  if (finalWidthMm > finalHeightMm) {
    finalWidthMm = heightMm;
    finalHeightMm = widthMm;
  }

  const widthPx = finalWidthMm * scale;
  const heightPx = finalHeightMm * scale;

  const V_WIDTH = finalWidthMm * 10; // e.g. 700
  const V_HEIGHT = finalHeightMm * 10; // e.g. 900
  const renderScale = widthPx / V_WIDTH;

  // Wide barcode digits + pixel-perfect rendering are applied site-wide
  // as of v1.4.12 — the «Цех ПЦО» trial confirmed reliable scanning, so
  // the folder gate was dropped.
  const inTestBarcodeFolder = true;

  // Bidirectional auto-fit. Mirror the logic in
  // src/app/api/render/route.ts: shrink when content overflows, GROW when
  // there's significant free space (so customers can read text from
  // further away). Two-pass for grow because narrowing the inner re-wraps
  // text and the visible height after scale could otherwise overflow.
  const [shrinkScale, setShrinkScale] = useState(1);
  const [autoFitDone, setAutoFitDone] = useState(false);
  const innerRef = React.useRef<HTMLDivElement>(null);
  const MAX_GROW = 1.25;
  const GROW_TRIGGER = 0.85;
  const SAFETY_MARGIN = 0.97;

  React.useEffect(() => {
    setShrinkScale(1);
    setAutoFitDone(false);
  }, [product, mfgDate, expDate]);

  React.useEffect(() => {
    if (autoFitDone || !innerRef.current) return;
    const h = innerRef.current.scrollHeight;
    if (shrinkScale === 1) {
      // First pass — decide direction.
      if (h > V_HEIGHT) {
        setShrinkScale(V_HEIGHT / h);
        setAutoFitDone(true); // shrink path doesn't need a re-measure
      } else if (h < V_HEIGHT * GROW_TRIGGER) {
        const proposed = Math.min(MAX_GROW, (V_HEIGHT * SAFETY_MARGIN) / h);
        setShrinkScale(proposed); // probe — re-measure on the next effect run
      } else {
        setAutoFitDone(true); // fits naturally, leave at 1
      }
    } else {
      // Second pass — `h` is scrollHeight at the narrowed width. Clamp the
      // grow scale if re-wrapping pushed the visible height past the label.
      const visible = h * shrinkScale;
      if (visible > V_HEIGHT) {
        setShrinkScale(Math.max(1, V_HEIGHT / h));
      }
      setAutoFitDone(true);
    }
  }, [shrinkScale, autoFitDone, product, mfgDate, expDate]);

  const showComposition = !isCompositionDuplicate(product.name, product.composition);

  // Manufacturer block has two hardcoded variants (ИП Абдуалиев / ООО
  // «Эко-фабрика»). Priority:
  // 1) product.manufacturerType explicit value from the inspector editor
  //    ("abdualiev" | "ekofabrika") — wins over everything.
  // 2) Legacy auto-detect by btwFilePath ("Цех ПЦО\Орехи\ИП Абдуалиев" and
  //    "МП\ПЦПО" → ИП Абдуалиев; everything else → Эко-фабрика).
  // Keep aligned with src/app/api/render/route.ts.
  const isAbdualievProduct =
    product?.manufacturerType === "abdualiev"
      ? true
      : product?.manufacturerType === "ekofabrika"
        ? false
        : typeof product?.btwFilePath === "string" &&
          /(\\Цех ПЦО\\Орехи\\ИП Абдуалиев\\|\\МП\\ПЦПО\\)/i.test(product.btwFilePath);

  // Показывать ли блок дат — зеркало логики в /api/render/route.ts.
  // null → авто по btwFilePath (весовые папки → компактный блок ≤40×16 мм,
  // значения показаны, снизу остаётся место под «Честный знак»);
  // true/false — явное переопределение.
  const isWeightFolder =
    typeof product?.btwFilePath === "string" &&
    /\\[^\\]*[Ее]совые?[^\\]*\\/i.test(product.btwFilePath);
  const showLabelDates = product?.showLabelDates !== false;
  const compactDates = isWeightFolder && product?.showLabelDates !== true;

  // ШК (showbox barcode-only) labels: either the product is explicitly
  // flagged via the inspector edit form, or its btwFilePath sits under
  // a folder named «Единичный ШК» (legacy heuristic). The ШК template
  // renders TWO stacked copies of (title + optional subtitle + barcode)
  // on one 70×90 mm sticker with a dashed cut-line at the midpoint —
  // operator scissors-splits it into two 70×45 mm labels to save tape.
  // Keep aligned with route.ts → isShkLabel.
  const isShkLabel =
    !!product?.isShkLabel ||
    (typeof product?.btwFilePath === "string" &&
      /\\Единичный ШК\\/i.test(product.btwFilePath));
  if (isShkLabel) {
    const rawSubtitle = (product?.weight || "").trim();
    const title = product?.name || "";
    // Adaptive title size — see the same heuristic in route.ts's
    // buildShkLabelHtml. Long names need to shrink so the barcode +
    // digits stay inside their half of the doubled canvas.
    const titleLen = title.length;
    const titleFontPx =
      titleLen <= 30 ? 38 :
      titleLen <= 50 ? 32 :
      titleLen <= 70 ? 26 :
      22;
    const subtitleFontPx = titleFontPx >= 32 ? 24 : 20;
    // For ШК labels we ALWAYS render the barcode digits as a separate
    // big-font HTML block below the bars regardless of code length. The
    // SVG is fetched with separateText=1 (bars only) by /print so the
    // embedded glyphs don't stretch when we apply preserveAspectRatio
    // ="none" to the SVG below. Same decision in route.ts and /print
    // page (search for isShkProduct).
    const shkDigitOnly = (product?.barcodeEan13 || "").replace(/\D/g, "");
    const shkUseSeparateDigits = shkDigitOnly.length > 0;
    // ШК labels — вес (product.weight) вообще не рендерится в превью
    // как подзаголовок (zeркало логики в /api/render/route.ts). Название
    // продукта уже содержит граммовку, а лишний subtitle съедал место
    // под названием и в длинных названиях наезжал на цифры штрихкода.
    void rawSubtitle;
    const subtitle = "";
    return (
      <div
        className="label-preview-frame"
        style={{
          width: widthPx + "px",
          height: heightPx + "px",
          position: "relative",
          boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          borderRadius: "2px",
          backgroundColor: "white",
          margin: "auto",
          overflow: "hidden",
        }}
      >
        <div
          className="canvas"
          style={{
            width: V_WIDTH + "px",
            height: V_HEIGHT + "px",
            transform: `scale(${renderScale})`,
            transformOrigin: "top left",
            overflow: "hidden",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          {product?.isExport && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Roboto Condensed', sans-serif",
                fontWeight: 700,
                // "МП" is two glyphs (was single "Э" at 800px) — reduced
                // so the watermark fits horizontally within label width.
                fontSize: "500px",
                letterSpacing: "-20px",
                // Screen preview only — solid translucent gray. The
                // CSS halftone-via-background-clip we used earlier
                // looked perfect on 2× retina but disappeared on
                // operators' 1080p monitors at sub-100% browser zoom:
                // the 1px dots ended up sub-pixel during rasterization
                // and the watermark fluttered in and out as the user
                // resized. The print path in /api/render keeps the
                // halftone because Sharp.threshold(120) wipes any
                // translucent fill on the bitmap thermal printer.
                color: "rgba(0, 0, 0, 0.3)",
                transform: "translateX(-2px)",
                lineHeight: 0.85,
                pointerEvents: "none",
                userSelect: "none",
                zIndex: 0,
              }}
            >
              МП
            </div>
          )}
          {/* Doubled ШК layout — two identical halves stacked vertically
              with a dashed cut-line between. Operator scissors along
              the dashes → two 70×45 mm labels per print. Mirrored in
              buildShkLabelHtml (route.ts). */}
          {(() => {
            const halfContent = (
              <>
                <div
                  style={{
                    fontSize: `${titleFontPx}px`,
                    fontWeight: 700,
                    textAlign: "center",
                    lineHeight: 1.1,
                    textDecoration: "underline",
                    textDecorationThickness: "2px",
                    textUnderlineOffset: "4px",
                    marginBottom: "8px",
                  }}
                >
                  {title}
                </div>
                {subtitle && (
                  <div
                    style={{
                      fontSize: `${subtitleFontPx}px`,
                      fontWeight: 500,
                      textAlign: "center",
                      lineHeight: 1.1,
                      marginBottom: "12px",
                    }}
                  >
                    {subtitle}
                  </div>
                )}
                {/* Fixed-height barcode container + preserveAspectRatio=none
                    injected into the bwip-js SVG so every barcode type (EAN-13,
                    Code128, ITF-14, EAN-8) renders into the same 140px tall ×
                    88%-wide rectangle. Bar-to-bar width ratios are preserved
                    under uniform scaling → scanners still read everything. */}
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 30px",
                  }}
                >
                  {barcodeSvg && (
                    <>
                      {/* Force the inserted bwip-js SVG to fill the 88%×140px
                          rect — bwip-js outputs viewBox-only SVGs without
                          width/height attrs, which default to ~300×150 CSS
                          px instead of filling the parent. */}
                      <style
                        dangerouslySetInnerHTML={{
                          __html: `.shk-barcode-fill > svg { width: 100% !important; height: 100% !important; display: block; }`,
                        }}
                      />
                      <div
                        className="shk-barcode-fill"
                        style={{
                          width: "88%",
                          height: "100%",
                          display: "flex",
                          alignItems: "stretch",
                          justifyContent: "center",
                        }}
                        dangerouslySetInnerHTML={{
                          __html: barcodeSvg.replace(
                            /<svg\s/i,
                            '<svg preserveAspectRatio="none" ',
                          ),
                        }}
                      />
                    </>
                  )}
                </div>
                {shkUseSeparateDigits && (
                  inTestBarcodeFolder ? (
                    <SpreadDigits
                      digits={shkDigitOnly}
                      fontSize={36}
                      style={{ width: "88%", alignSelf: "center", marginTop: "8px", flex: "0 0 auto" }}
                    />
                  ) : (
                    <div
                      style={{
                        fontFamily: "'Roboto Condensed', sans-serif",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: "36px",
                        fontWeight: 900,
                        letterSpacing: "1px",
                        textAlign: "center",
                        lineHeight: 1,
                        flex: "0 0 auto",
                        marginTop: "8px",
                      }}
                    >
                      {shkDigitOnly}
                    </div>
                  )
                )}
              </>
            );
            const halfStyle: React.CSSProperties = {
              position: "relative",
              zIndex: 1,
              flex: "1 1 0",
              minHeight: 0,
              fontFamily: "'Roboto Condensed', sans-serif",
              fontWeight: 700,
              color: "black",
              padding: "24px 24px 18px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
            };
            return (
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: V_WIDTH + "px",
                  height: V_HEIGHT + "px",
                  display: "flex",
                  flexDirection: "column",
                  boxSizing: "border-box",
                }}
              >
                <div style={halfStyle}>{halfContent}</div>
                {/* No separator — operator wants just the same prod-style
                    layout duplicated. They've decided to forgo the
                    cut-line marker. Bottom half gets extra padding-bottom
                    so the digits don't fall off the sticker edge. */}
                <div style={{ ...halfStyle, padding: "24px 24px 80px" }}>{halfContent}</div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  return (
    <div
      className="label-preview-frame"
      style={{
        width: widthPx + "px",
        height: heightPx + "px",
        position: "relative",
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
        borderRadius: "2px",
        backgroundColor: "white",
        margin: "auto",
        overflow: "hidden",
      }}
    >
      <div
        className="canvas"
        style={{
          width: V_WIDTH + "px",
          height: V_HEIGHT + "px",
          transform: `scale(${renderScale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        {product?.isExport && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Roboto Condensed', sans-serif",
              fontWeight: 700,
              // "МП" is two glyphs (was single "Э" at 800px) — reduced
              // so the watermark fits horizontally within label width.
              fontSize: "500px",
              letterSpacing: "-20px",
              // Screen preview only — solid translucent gray. The
              // CSS halftone-via-background-clip we used earlier
              // looked perfect on 2× retina but disappeared on
              // operators' 1080p monitors at sub-100% browser zoom:
              // the 1px dots ended up sub-pixel during rasterization
              // and the watermark fluttered in and out as the user
              // resized. The print path in /api/render keeps the
              // halftone because Sharp.threshold(120) wipes any
              // translucent fill on the bitmap thermal printer.
              color: "rgba(0, 0, 0, 0.3)",
              transform: "translateX(-2px)",
              lineHeight: 0.85,
              pointerEvents: "none",
              userSelect: "none",
              zIndex: 0,
            }}
          >
            МП
          </div>
        )}
        <div
          ref={innerRef}
          className="inner label-print-crisp"
          style={{
            position: "relative",
            zIndex: 1,
            width: (V_WIDTH / shrinkScale) + "px",
            transform: `scale(${shrinkScale})`,
            transformOrigin: "top left",
            fontFamily: "'Roboto Condensed', sans-serif",
            fontWeight: 700,
            color: "black",
            padding: "18px 20px 0px 20px",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
          <style dangerouslySetInnerHTML={{__html: `
            .label-print-crisp, .label-print-crisp * {
              -webkit-font-smoothing: none !important;
              -moz-osx-font-smoothing: grayscale !important;
              text-rendering: geometricPrecision !important;
              font-smooth: never !important;
            }
            .label-print-crisp img {
              image-rendering: -webkit-optimize-contrast;
              image-rendering: crisp-edges;
              image-rendering: pixelated;
            }
            .label-print-crisp svg {
              shape-rendering: crispEdges !important;
            }
          `}} />
          {/* TOP ROW: Barcode + Icons & SKU
              Proportional widths (flex-basis %) instead of fixed px so the
              row stays well-formed when the auto-fit pipeline narrows the
              inner during a grow pass. With fixed 340/320 px children, a
              narrowed inner (e.g. 560 px under MAX_GROW=1.25) would squish
              both columns and the barcode SVG ended up rendering at ~88 px
              wide. Mirrored in /api/render/route.ts. */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginBottom: "6px", marginTop: "2px" }}>
            {/* Barcode — locked at 50% of the label width so it dominates
                the layout and scans reliably. The right column adapts to
                the remaining space. 5 px top + 5 px bottom padding gives
                the bars breathing room without resizing the row.
                Mirrored in /api/render/route.ts. */}
            {(() => {
              // ITF-14 → digits rendered as ordinary HTML below the SVG
              // (the SVG itself is fetched without text). Bigger, bolder,
              // letter-spaced — survives thermal-print wear far better
              // than the tight bwip-js glyphs. EAN-13/EAN-8/Code128 keep
              // their embedded text. Mirrored in /api/render/route.ts and
              // src/app/print/page.tsx (barcode fetch).
              const digitOnly = (product?.barcodeEan13 || "").replace(/\D/g, "");
              const useSeparateDigits = digitOnly.length === 14;
              return (
                <div style={{ flex: "0 0 calc(60% + 4px)", height: "160px", overflow: "hidden", padding: "5px 0", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: useSeparateDigits ? "4px" : 0 }}>
                  {/*
                    bwip-js generates SVGs with only `viewBox`, no width/height
                    attrs. Without explicit dimensions, browsers default the SVG
                    to ~300×150 (CSS spec fallback) instead of filling the parent.
                    The .barcode-fill > svg CSS rule forces fill to 100%.
                  */}
                  <style dangerouslySetInnerHTML={{ __html: `.barcode-fill > svg { width: 100% !important; height: 100% !important; display: block; }` }} />
                  {barcodeSvg && (
                    <div className="barcode-fill" style={{ flex: "1 1 auto", minHeight: 0, width: "100%" }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
                  )}
                  {useSeparateDigits && (
                    inTestBarcodeFolder ? (
                      <SpreadDigits
                        digits={digitOnly}
                        fontSize={26}
                        style={{ width: "100%", flex: "0 0 auto" }}
                      />
                    ) : (
                      <div style={{
                        // Tabular-nums + bold + wide letter-spacing keeps the
                        // digits readable even after partial thermal-print
                        // erosion on the warehouse.
                        fontFamily: "'Roboto Condensed', sans-serif",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: "22px",
                        fontWeight: 900,
                        letterSpacing: "2.5px",
                        textAlign: "center",
                        lineHeight: 1,
                        flex: "0 0 auto",
                      }}>
                        {digitOnly}
                      </div>
                    )
                  )}
                </div>
              );
            })()}

            {/* Right side: Icons + SKU — flex:1 takes whatever the barcode's
                fixed 50% leaves. ~340 px in normal mode, ~270 px after an
                auto-grow narrow pass. flex-start + a small gap keeps the
                icons and SKU close together; space-between would stretch
                them apart now that the row is 200 px tall to fit the
                taller barcode. */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: "7px", flex: "1 1 0", minWidth: 0, height: "160px", paddingTop: "2px" }}>

              {/* Icons — width:100% + flex-end pushes them to the right edge
                  of the 320px container (previously centered with ~20px of
                  padding on each side). */}
              {/* Icons row — centered so the three remaining icons line
                  up directly above the centered SKU number below. The
                  «41 ALU» icon was removed entirely in v1.3.6 (operator
                  confirmed it shouldn't appear on any sticker). */}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "center", width: "100%", paddingLeft: "7px", boxSizing: "border-box" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/eac.png" alt="EAC" style={{ height: "48px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/fork_glass.png" alt="Food safe" style={{ height: "48px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pap20.png" alt="PAP 20" style={{ height: "48px", width: "auto", display: "block", objectFit: "contain" }} />
              </div>

              {/* SKU(s) — adaptive size, stacks vertically when sku2 is present.
                  Logic mirrored in /api/render/route.ts via computeSkuLayout. */}
              {(() => {
                const { fontSize, lines } = computeSkuLayout(product.sku, product.sku2);
                if (fontSize === 0) return null;
                return (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: lines.length > 1 ? "2px" : 0,
                    marginTop: "8px",
                    marginBottom: "12px",
                    width: "100%",
                  }}>
                    {lines.map((line, i) => (
                      <div key={i} style={{
                        fontSize: `${fontSize}px`,
                        fontFamily: "'Roboto Condensed', sans-serif",
                        fontWeight: 700,
                        lineHeight: "0.85",
                        textAlign: "center",
                        letterSpacing: "-1px",
                        whiteSpace: "nowrap",
                      }}>
                        {line}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Manufacturer info — лого слева + текст справа при
              showCedarLogo=true, иначе обычный центрированный текст.
              Зеркало /api/render/route.ts. ── */}
          {(() => {
            const manufacturerLines = isAbdualievProduct ? (
              <>
                Изготовитель: ИП Абдуалиев В.Г.<br />
                Тел.: + 7 913-851-49-49<br />
                Адрес: Россия, 634015, Томская область, гор. Томск,<br />
                ул. Айвазовского, д. 29 стр. 6
              </>
            ) : (
              <>
                Изготовитель: ООО &quot;Эко-фабрика Сибирский Кедр&quot;<br />
                тел. (3822) 311-175<br />
                Адрес: Россия, 634593, Томская область, Томский район,<br />
                д. Петрово, ул. Луговая, 11
              </>
            );
            if (product?.showCedarLogo) {
              return (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "3px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/cedar-logo.png" alt="Сибирский Кедр" style={{ height: "120px", width: "auto", flex: "0 0 auto", display: "block", objectFit: "contain" }} />
                  <div style={{ flex: "1 1 auto", fontSize: "20px", fontWeight: 700, textAlign: "center", lineHeight: "1.15" }}>
                    {manufacturerLines}
                  </div>
                </div>
              );
            }
            return (
              <div style={{ fontSize: "24px", fontWeight: 700, textAlign: "center", lineHeight: "1.15", marginBottom: "3px" }}>
                {manufacturerLines}
              </div>
            );
          })()}

          {/* ── Product Name ── */}
          <div style={{
            fontSize: "32px",
            fontWeight: 900,
            fontFamily: "'Roboto Condensed', sans-serif",
            textAlign: "center",
            lineHeight: "1.1",
            marginBottom: "3px",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            minHeight: "30px",
            flexShrink: 0
          }}>
            {product.name}
          </div>

          {/* ── Composition (ONLY if different from name) ── */}
          {showComposition && (
            <div style={{ fontSize: "24px", fontWeight: 700, lineHeight: "1.2", textAlign: "left", marginBottom: "3px" }}>
              {product.composition}
            </div>
          )}

          {/* ── Extra text (seasonal markers / marketplace / BIO / etc.) ──
              Keep aligned with src/app/api/render/route.ts. */}
          {product.extraText && (
            <div style={{ fontSize: "22px", fontWeight: 700, fontStyle: "italic", textAlign: "center", marginBottom: "4px", lineHeight: "1.15" }}>
              {product.extraText}
            </div>
          )}

          {/* ── Sponsor Text ── */}
          {product.sponsorText && (
            <div style={{ fontSize: "24px", fontWeight: 900, textAlign: "center", marginBottom: "8px", textDecoration: "underline" }}>
              {product.sponsorText}
            </div>
          )}

          {/* ── Mass + СТО on one line ── */}
          <div style={{ display: "flex", justifyContent: "flex-start", gap: "30px", fontSize: "24px", fontWeight: 700, marginBottom: "2px" }}>
            <div>
              {product.weight || (!product.weight && !product.quantity && !product.boxWeight && "Масса нетто: —")}
              {!product.weight && product.quantity && product.quantity}
            </div>
            {product.certCode && <div>{product.certCode}</div>}
          </div>
          {product.weight && product.quantity && (
            <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "2px" }}>{product.quantity}</div>
          )}
          {product.boxWeight && (
            <div style={{ fontSize: "24px", fontWeight: 700, marginBottom: "2px" }}>{product.boxWeight}</div>
          )}

          {/* ── Nutritional & Storage (no dash when empty) ── */}
          {(product.nutritionalInfo || product.storageCond) && (
            <div style={{ fontSize: "24px", fontWeight: 700, lineHeight: "1.2", marginBottom: "4px", textAlign: "left" }}>
              {product.nutritionalInfo && <span>{product.nutritionalInfo}</span>}
              {product.nutritionalInfo && product.storageCond && <br />}
              {product.storageCond && <span>{product.storageCond}</span>}
            </div>
          )}

          {/* Блок дат.
              • Обычный товар — крупный блок в углу.
              • Весовые (auto) — КОМПАКТНЫЙ блок ≤40×16 мм; снизу
                остаётся ~130 px пустого поля под стикер «Честного
                знака». Оператор форсирует полный размер showLabelDates=true.
              Mirror /api/render/route.ts. */}
          {compactDates ? (
            <div style={{ display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "12px", rowGap: "4px", alignItems: "center", marginTop: "auto", paddingTop: "12px", maxWidth: "400px", maxHeight: "160px" }}>
              <div style={{ fontSize: "24px", color: "#000", fontWeight: 900, whiteSpace: "nowrap", fontFamily: "'Roboto Condensed', sans-serif" }}>Дата изготовления:</div>
              <div style={{ fontSize: "18px", fontWeight: 900, fontFamily: "'Roboto Condensed', sans-serif", color: "#000", whiteSpace: "nowrap" }}>{showLabelDates ? (mfgDate || "—") : ""}</div>

              <div style={{ fontSize: "24px", color: "#000", fontWeight: 900, whiteSpace: "nowrap", fontFamily: "'Roboto Condensed', sans-serif" }}>Годен до:</div>
              <div style={{ fontSize: "18px", fontWeight: 900, fontFamily: "'Roboto Condensed', sans-serif", color: "#000", whiteSpace: "nowrap" }}>{showLabelDates ? (expDate || "—") : ""}</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "12px", rowGap: "15px", alignItems: "center", marginTop: "auto", marginBottom: "-10px", paddingTop: "15px" }}>
              <div style={{ fontSize: "24px", color: "#000", fontWeight: 900, whiteSpace: "nowrap", fontFamily: "'Roboto Condensed', sans-serif" }}>Дата изготовления:</div>
              <div style={{ fontSize: "36px", fontWeight: 900, fontFamily: "'Roboto Condensed', sans-serif", letterSpacing: "-1px", color: "#000" }}>{showLabelDates ? (mfgDate || "—") : ""}</div>

              <div style={{ fontSize: "24px", color: "#000", fontWeight: 900, whiteSpace: "nowrap", fontFamily: "'Roboto Condensed', sans-serif" }}>Годен до:</div>
              <div style={{ fontSize: "36px", fontWeight: 900, fontFamily: "'Roboto Condensed', sans-serif", letterSpacing: "-1px", color: "#000" }}>{showLabelDates ? (expDate || "—") : ""}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
