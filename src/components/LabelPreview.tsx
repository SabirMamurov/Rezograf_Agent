"use client";

import React, { useState } from "react";

interface Product {
  name: string;
  sku?: string | null;
  composition?: string | null;
  weight?: string | null;
  nutritionalInfo?: string | null;
  storageCond?: string | null;
  barcodeEan13?: string | null;
  certCode?: string | null;
  quantity?: string | null;
  boxWeight?: string | null;
  sponsorText?: string | null;
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

  const [shrinkScale, setShrinkScale] = useState(1);
  const innerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setShrinkScale(1);
  }, [product, mfgDate, expDate]);

  React.useEffect(() => {
    if (shrinkScale === 1 && innerRef.current) {
      const scrollH = innerRef.current.scrollHeight;
      if (scrollH > V_HEIGHT) {
        setShrinkScale(V_HEIGHT / scrollH);
      }
    }
  }, [shrinkScale, product, mfgDate, expDate]);

  const showComposition = !isCompositionDuplicate(product.name, product.composition);

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
        }}
      >
        <div
          ref={innerRef}
          className="inner label-print-crisp"
          style={{
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
          {/* TOP ROW: Barcode + Icons & SKU */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", marginTop: "2px" }}>
            {/* Barcode */}
            <div style={{ width: "340px", height: "160px" }}>
              {barcodeSvg && <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />}
            </div>

            {/* Right side: Icons + SKU */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", width: "320px", height: "160px", paddingTop: "2px" }}>
              
              <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/alu41.png" alt="ALU 41" style={{ height: "68px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/eac.png" alt="EAC" style={{ height: "68px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/fork_glass.png" alt="Food safe" style={{ height: "68px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pap20.png" alt="PAP 20" style={{ height: "68px", width: "auto", display: "block", objectFit: "contain" }} />
              </div>

              {/* SKU (directly under icons, centered, large) */}
              {product.sku && (
                <div style={{
                  fontSize: "88px",
                  fontFamily: "'Roboto Condensed', sans-serif",
                  fontWeight: 700,
                  lineHeight: "0.8",
                  marginTop: "8px",
                  marginBottom: "12px",
                  textAlign: "center",
                  letterSpacing: "-1px"
                }}>
                  {product.sku}
                </div>
              )}
            </div>
          </div>

          {/* ── Manufacturer info ── */}
          <div style={{ fontSize: "24px", fontWeight: 700, textAlign: "center", lineHeight: "1.15", marginBottom: "3px" }}>
            Изготовитель: ООО &quot;Эко-фабрика Сибирский Кедр&quot;<br />
            тел. (3822) 311-175<br />
            Адрес: Россия, 634593, Томская область, Томский район,<br />
            д. Петрово, ул. Луговая, 11
          </div>

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

          <div style={{ display: "grid", gridTemplateColumns: "max-content max-content", columnGap: "12px", rowGap: "15px", alignItems: "center", marginTop: "auto", marginBottom: "-10px", paddingTop: "15px" }}>
            <div style={{ fontSize: "24px", color: "#000", fontWeight: 900, whiteSpace: "nowrap", fontFamily: "'Roboto Condensed', sans-serif" }}>Дата изготовления:</div>
            <div style={{ fontSize: "36px", fontWeight: 900, fontFamily: "'Roboto Condensed', sans-serif", letterSpacing: "-1px", color: "#000" }}>{mfgDate || "—"}</div>
            
            <div style={{ fontSize: "24px", color: "#000", fontWeight: 900, whiteSpace: "nowrap", fontFamily: "'Roboto Condensed', sans-serif" }}>Годен до:</div>
            <div style={{ fontSize: "36px", fontWeight: 900, fontFamily: "'Roboto Condensed', sans-serif", letterSpacing: "-1px", color: "#000" }}>{expDate || "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
