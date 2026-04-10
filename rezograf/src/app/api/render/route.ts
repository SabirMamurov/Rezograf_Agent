import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateBarcodeSvg } from "@/lib/barcodes";
import puppeteer from "puppeteer";
import * as fs from "fs";
import * as path from "path";

/**
 * POST /api/render
 * Body: { productId: string, mfgDate?: string, expDate?: string }
 * Returns: PDF file (application/pdf)
 *
 * Adaptive label PDF rendering:
 * 1. Builds HTML with 700px-wide content (no height limit)
 * 2. Puppeteer measures the actual content height
 * 3. Calculates uniform scale to fit 70×90mm
 * 4. Applies scale and renders PDF
 *
 * This ensures labels with any amount of content always fit perfectly.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, mfgDate, expDate } = body;

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { template: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let barcodeSvg = "";
  if (product.barcodeEan13) {
    try {
      barcodeSvg = await generateBarcodeSvg(product.barcodeEan13);
    } catch {
      // Continue without barcode
    }
  }

  let widthMm = product.template?.widthMm ?? 70;
  let heightMm = product.template?.heightMm ?? 90;

  if (widthMm > heightMm) {
    const temp = widthMm;
    widthMm = heightMm;
    heightMm = temp;
  }
  const iconDataUris = loadIconsAsBase64();
  const labelHtml = buildLabelHtml(product, barcodeSvg, widthMm, heightMm, mfgDate, expDate, iconDataUris);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 3 });
    await page.setContent(labelHtml, { waitUntil: "domcontentloaded", timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 500));

    // ── ADAPTIVE WIDTH-PRESERVING SCALING ──
    // Outer .canvas is always 700×900 with scale(0.37795) → exact 70×90mm.
    // If content in .inner overflows 900px, we shrink .inner proportionally:
    //   - widen it to 700/shrink px (so text reflows at wider width)
    //   - apply transform: scale(shrink) → after scaling it's 700px × 900px again
    // Result: content always fills exactly 70×90mm, no whitespace, no clipping.

    const contentHeight = await page.evaluate((h) => {
      const inner = document.querySelector('.inner') as HTMLElement;
      return inner ? inner.scrollHeight : h;
    }, heightMm * 10);

    const vWidth = widthMm * 10;
    const vHeight = heightMm * 10;
    const BASE_SCALE = ((widthMm / 25.4) * 96) / vWidth; // ≈ 0.37795

    if (contentHeight > vHeight) {
      const shrink = vHeight / contentHeight;
      await page.evaluate((s: number, bs: number, vw: number) => {
        const inner = document.querySelector('.inner') as HTMLElement;
        const canvas = document.querySelector('.canvas') as HTMLElement;
        if (inner) {
          // Widen inner so after scale(shrink) it maps back to original width
          inner.style.width = (vw / s) + 'px';
          inner.style.transform = `scale(${s})`;
          inner.style.transformOrigin = 'top left';
        }
        if (canvas) {
          canvas.style.transform = `scale(${bs})`;
          canvas.style.transformOrigin = 'top left';
        }
      }, shrink, BASE_SCALE, vWidth);
    } else {
      // Content fits — just apply the standard outer scale
      await page.evaluate((scale: number) => {
        const canvas = document.querySelector('.canvas') as HTMLElement;
        if (canvas) {
          canvas.style.transform = `scale(${scale})`;
          canvas.style.transformOrigin = 'top left';
        }
      }, BASE_SCALE);
    }

    // Brief pause for layout recalculation
    await new Promise(resolve => setTimeout(resolve, 200));

    const pdfBuffer = await page.pdf({
      width: `${widthMm}mm`,
      height: `${heightMm}mm`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      pageRanges: "1",
    });

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="label-${product.sku || product.id}.pdf"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "PDF render failed";
    console.error("PDF render error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Load label icons as base64 data URIs.
 */
function loadIconsAsBase64(): Record<string, string> {
  const iconsDir = path.join(process.cwd(), "public", "icons");
  const icons: Record<string, string> = {};
  const iconFiles: Record<string, string> = {
    alu41: "alu41.png",
    eac: "eac.png",
    fork_glass: "fork_glass.png",
    pap20: "pap20.png",
  };

  for (const [key, filename] of Object.entries(iconFiles)) {
    try {
      const filepath = path.join(iconsDir, filename);
      const data = fs.readFileSync(filepath);
      icons[key] = `data:image/png;base64,${data.toString("base64")}`;
    } catch {
      icons[key] = "";
    }
  }
  return icons;
}

/**
 * Builds label HTML with fixed width (700px) but NO fixed height.
 * Content flows naturally — Puppeteer will measure the real height and
 * compute the perfect scale factor to fit 70×90mm.
 *
 * All px values match LabelPreview.tsx exactly for visual consistency.
 */
function buildLabelHtml(
  product: any,
  barcodeSvg: string,
  widthMm: number,
  heightMm: number,
  mfgDate?: string,
  expDate?: string,
  iconDataUris?: Record<string, string>
): string {
  const isCompositionDuplicate = (name: string, comp: string | null | undefined) => {
    if (!comp) return true;
    const a = name.toLowerCase().replace(/[/\\]/g, "").trim();
    const b = comp.toLowerCase().replace(/[/\\]/g, "").trim();
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    return false;
  };
  const showComposition = !isCompositionDuplicate(product.name, product.composition);

  const alu41Src = iconDataUris?.alu41 || "/icons/alu41.png";
  const eacSrc = iconDataUris?.eac || "/icons/eac.png";
  const forkGlassSrc = iconDataUris?.fork_glass || "/icons/fork_glass.png";
  const pap20Src = iconDataUris?.pap20 || "/icons/pap20.png";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page {
    size: ${widthMm}mm ${heightMm}mm;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    margin: 0;
    padding: 0;
    background-color: white;
    overflow: hidden;
  }
  .outer {
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    overflow: hidden;
  }
  .canvas {
    width: ${widthMm * 10}px;
    height: ${heightMm * 10}px;
    box-sizing: border-box;
    /* transform set by Puppeteer: scale(0.37795) → 70×90mm */
  }
  .inner {
    width: ${widthMm * 10}px;
    /* NO height limit — content flows freely for measurement */
    font-family: 'Arial Narrow', Arial, sans-serif;
    color: black;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    /* If content overflows 900px, Puppeteer applies shrink transform */
  }
  img {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
</style>
</head>
<body>
  <div class="outer">
    <div class="canvas">
      <div class="inner">
      <!-- TOP ROW: Barcode + Icons & SKU -->
      <div style="display: flex; justify-content: space-between; margin-bottom: 10px; margin-top: 4px;">
        <!-- Barcode -->
        <div style="width: 340px; height: 160px; overflow: hidden;">
           ${barcodeSvg ? `<div style="width: 100%; height: 100%;">${barcodeSvg}</div>` : ''}
        </div>

        <!-- Right side: Icons + SKU -->
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: space-between; width: 320px; height: 160px; padding-top: 2px;">
          <div style="display: flex; gap: 10px; align-items: center; justify-content: center;">
            <img src="${alu41Src}" style="height: 56px; width: auto; display: block; object-fit: contain;" />
            <img src="${eacSrc}" style="height: 56px; width: auto; display: block; object-fit: contain;" />
            <img src="${forkGlassSrc}" style="height: 56px; width: auto; display: block; object-fit: contain;" />
            <img src="${pap20Src}" style="height: 56px; width: auto; display: block; object-fit: contain;" />
          </div>
          
          <!-- SKU -->
          ${product.sku ? `
          <div style="font-size: 77px; font-weight: normal; font-family: Arial; line-height: 0.8; margin-top: 0; margin-bottom: 18px; text-align: center; letter-spacing: -1px;">
            ${escapeHtml(product.sku)}
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Manufacturer info -->
      <div style="font-size: 21px; text-align: center; line-height: 1.15; margin-bottom: 3px; font-stretch: condensed;">
        Изготовитель: ООО &quot;Эко-фабрика Сибирский Кедр&quot; тел. (3822) 311-175<br />
        Адрес: Россия, 634593, Томская область, Томский район,<br />
        д. Петрово, ул. Луговая, 11
      </div>

      <!-- Product Name -->
      <div style="font-size: 30px; font-family: 'Arial Narrow', Arial, sans-serif; font-weight: bold; font-stretch: condensed; text-decoration: underline; text-align: center; line-height: 1.1; min-height: 30px; flex-shrink: 0; margin-bottom: 3px; text-underline-offset: 3px;">
        ${escapeHtml(product.name)}
      </div>

      <!-- Composition -->
      ${showComposition ? `
      <div style="font-size: 21px; line-height: 1.15; text-align: justify; margin-bottom: 3px; font-stretch: condensed;">
        ${escapeHtml(product.composition || "")}
      </div>
      ` : ''}

      <!-- Sponsor Text -->
      ${product.sponsorText ? `
      <div style="font-size: 21px; font-weight: bold; text-align: center; margin-bottom: 8px; font-stretch: condensed; text-decoration: underline;">
        ${escapeHtml(product.sponsorText)}
      </div>
      ` : ''}

      <!-- Mass / Quantity / BoxWeight / СТО -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; font-size: 21px; margin-bottom: 4px; font-stretch: condensed; gap: 10px;">
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
          ${product.weight ? `<div>${escapeHtml(product.weight)}</div>` : ''}
          ${!product.weight && product.quantity ? `<div>${escapeHtml(product.quantity)}</div>` : ''}
          ${product.boxWeight ? `<div>${escapeHtml(product.boxWeight)}</div>` : ''}
          ${!product.weight && !product.quantity && !product.boxWeight ? `<div>Масса нетто: —</div>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; text-align: right; gap: 4px;">
          ${product.weight && product.quantity ? `<div>${escapeHtml(product.quantity)}</div>` : ''}
          ${product.certCode ? `<div>${escapeHtml(product.certCode)}</div>` : ''}
        </div>
      </div>

      <!-- Nutritional & Storage -->
      ${(product.nutritionalInfo || product.storageCond) ? `
      <div style="font-size: 21px; line-height: 1.15; margin-bottom: 4px; text-align: justify; font-stretch: condensed;">
        ${product.nutritionalInfo ? `<span>${escapeHtml(product.nutritionalInfo)}</span>` : ''}
        ${(product.nutritionalInfo && product.storageCond) ? `<br />` : ''}
        ${product.storageCond ? `<span>${escapeHtml(product.storageCond)}</span>` : ''}
      </div>
      ` : ''}

      <!-- Dates -->
      <div style="display: flex; flex-direction: column; margin-top: 4px; gap: 2px; padding-left: 10px;">
        <div style="display: flex; align-items: baseline;">
          <div style="font-size: 22px; width: 190px; color: #333;">Дата изготовления:</div>
          <div style="font-size: 44px; font-weight: 900; font-family: Arial; letter-spacing: -1px;">${escapeHtml(mfgDate || "—")}</div>
        </div>
        <div style="display: flex; align-items: baseline;">
          <div style="font-size: 22px; width: 190px; color: #333;">Годен до:</div>
          <div style="font-size: 44px; font-weight: 900; font-family: Arial; letter-spacing: -1px;">${escapeHtml(expDate || "—")}</div>
        </div>
      </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
