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
          className="inner"
          style={{
            width: (V_WIDTH / shrinkScale) + "px",
            transform: `scale(${shrinkScale})`,
            transformOrigin: "top left",
            fontFamily: "'Arial Narrow', Arial, sans-serif",
            color: "black",
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
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
                <img src="/icons/alu41.png" alt="ALU 41" style={{ height: "56px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/eac.png" alt="EAC" style={{ height: "56px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/fork_glass.png" alt="Food safe" style={{ height: "56px", width: "auto", display: "block", objectFit: "contain" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pap20.png" alt="PAP 20" style={{ height: "56px", width: "auto", display: "block", objectFit: "contain" }} />
              </div>

              {/* SKU (directly under icons, centered, large) */}
              {product.sku && (
                <div style={{
                  fontSize: "77px",
                  fontFamily: "Arial",
                  fontWeight: "normal",
                  lineHeight: "0.8",
                  marginTop: "0",
                  marginBottom: "18px",
                  textAlign: "center",
                  letterSpacing: "-1px"
                }}>
                  {product.sku}
                </div>
              )}
            </div>
          </div>

          {/* ── Manufacturer info ── */}
          <div style={{ fontSize: "21px", textAlign: "center", lineHeight: "1.15", marginBottom: "3px", fontStretch: "condensed" }}>
            Изготовитель: ООО &quot;Эко-фабрика Сибирский Кедр&quot; тел. (3822) 311-175<br />
            Адрес: Россия, 634593, Томская область, Томский район,<br />
            д. Петрово, ул. Луговая, 11
          </div>

          {/* ── Product Name ── */}
          <div style={{
            fontSize: "30px",
            fontWeight: "bold",
            fontFamily: "Arial Narrow, sans-serif",
            fontStretch: "condensed",
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
            <div style={{ fontSize: "21px", lineHeight: "1.15", textAlign: "justify", marginBottom: "3px", fontStretch: "condensed" }}>
              {product.composition}
            </div>
          )}

          {/* ── Sponsor Text ── */}
          {product.sponsorText && (
            <div style={{ fontSize: "21px", fontWeight: "bold", textAlign: "center", marginBottom: "8px", fontStretch: "condensed", textDecoration: "underline" }}>
              {product.sponsorText}
            </div>
          )}

          {/* ── Mass / Quantity / BoxWeight / СТО ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: "21px", marginBottom: "4px", fontStretch: "condensed", gap: "10px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
              {product.weight && <div>{product.weight}</div>}
              {!product.weight && product.quantity && <div>{product.quantity}</div>}
              {product.boxWeight && <div>{product.boxWeight}</div>}
              {!product.weight && !product.quantity && !product.boxWeight && (
                <div>Масса нетто: —</div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", textAlign: "right", gap: "4px" }}>
              {product.weight && product.quantity && <div>{product.quantity}</div>}
              {product.certCode && <div>{product.certCode}</div>}
            </div>
          </div>

          {/* ── Nutritional & Storage (no dash when empty) ── */}
          {(product.nutritionalInfo || product.storageCond) && (
            <div style={{ fontSize: "21px", lineHeight: "1.15", marginBottom: "4px", textAlign: "justify", fontStretch: "condensed" }}>
              {product.nutritionalInfo && <span>{product.nutritionalInfo}</span>}
              {product.nutritionalInfo && product.storageCond && <br />}
              {product.storageCond && <span>{product.storageCond}</span>}
            </div>
          )}

          {/* ── Dates ── */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: "4px", gap: "2px", paddingLeft: "10px" }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ fontSize: "22px", width: "190px", color: "#333" }}>Дата изготовления:</div>
              <div style={{ fontSize: "44px", fontWeight: "900", fontFamily: "Arial", letterSpacing: "-1px" }}>{mfgDate || "—"}</div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ fontSize: "22px", width: "190px", color: "#333" }}>Годен до:</div>
              <div style={{ fontSize: "44px", fontWeight: "900", fontFamily: "Arial", letterSpacing: "-1px" }}>{expDate || "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
