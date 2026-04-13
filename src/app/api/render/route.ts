import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateBarcodeSvg } from "@/lib/barcodes";
import puppeteer from "puppeteer";
import * as fs from "fs";
import * as path from "path";

// Global cache to avoid launching a new browser per request
let globalBrowser: any = null;
let isDev = process.env.NODE_ENV !== "production";

async function getBrowser() {
  if (globalBrowser && globalBrowser.connected) {
    return globalBrowser;
  }
  globalBrowser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: true,
    args: [
      "--no-sandbox", 
      "--disable-setuid-sandbox", 
      "--disable-gpu", 
      "--disable-dev-shm-usage"
    ],
  });
  return globalBrowser;
}

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
  const { productId, mfgDate, expDate, format } = body;

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

  let page;
  try {
    const browser = await getBrowser();

    page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 3 });
    
    // Use domcontentloaded instead of networkidle0 for much faster loading
    await page.setContent(labelHtml, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    // Explicitly wait for fonts to load instead of arbitrary setTimeout
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    // ── ADAPTIVE WIDTH-PRESERVING SCALING ──
    const contentHeight = await page.evaluate((h: number) => {
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
      await page.evaluate((scale: number) => {
        const canvas = document.querySelector('.canvas') as HTMLElement;
        if (canvas) {
          canvas.style.transform = `scale(${scale})`;
          canvas.style.transformOrigin = 'top left';
        }
      }, BASE_SCALE);
    }



    // ── IMAGE FORMAT: Ultra-high-res monochrome bitmap for thermal printers ──
    if (format === 'image') {
      // Target printer DPI (203 is standard for most thermal label printers)
      const PRINTER_DPI = 203;
      const targetW = Math.round((widthMm / 25.4) * PRINTER_DPI);  // 559 px for 70mm
      const targetH = Math.round((heightMm / 25.4) * PRINTER_DPI); // 719 px for 90mm

      // Create a dedicated super-high-DPI page for maximum quality rendering
      const hiResPage = await browser.newPage();
      await hiResPage.setViewport({ width: 800, height: 1200, deviceScaleFactor: 12 });
      await hiResPage.setContent(labelHtml, { waitUntil: "domcontentloaded", timeout: 15000 });
      await hiResPage.evaluate(async () => {
        await document.fonts.ready;
      });

      // Apply the same adaptive scaling
      const hiContentHeight = await hiResPage.evaluate((h: number) => {
        const inner = document.querySelector('.inner') as HTMLElement;
        return inner ? inner.scrollHeight : h;
      }, heightMm * 10);

      if (hiContentHeight > vHeight) {
        const shrink = vHeight / hiContentHeight;
        await hiResPage.evaluate((s: number, bs: number, vw: number) => {
          const inner = document.querySelector('.inner') as HTMLElement;
          const canvas = document.querySelector('.canvas') as HTMLElement;
          if (inner) {
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
        await hiResPage.evaluate((scale: number) => {
          const canvas = document.querySelector('.canvas') as HTMLElement;
          if (canvas) {
            canvas.style.transform = `scale(${scale})`;
            canvas.style.transformOrigin = 'top left';
          }
        }, BASE_SCALE);
      }

      // Step 1: Take screenshot at ~1150 DPI (12× scale)
      const clipW = Math.round((widthMm / 25.4) * 96);
      const clipH = Math.round((heightMm / 25.4) * 96);

      const screenshotBuffer = await hiResPage.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: clipW, height: clipH },
      });

      // Step 2: Threshold to pure B&W + nearest-neighbor downsample to exact printer DPI
      const base64Screenshot = Buffer.from(screenshotBuffer).toString('base64');
      const monoBase64 = await hiResPage.evaluate(async (imgData: string, tW: number, tH: number) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + imgData;
        await new Promise(resolve => { img.onload = resolve; });

        // First: draw at original hi-res size and apply threshold
        const bigCanvas = document.createElement('canvas');
        bigCanvas.width = img.width;
        bigCanvas.height = img.height;
        const bigCtx = bigCanvas.getContext('2d')!;
        bigCtx.drawImage(img, 0, 0);

        const bigData = bigCtx.getImageData(0, 0, bigCanvas.width, bigCanvas.height);
        const px = bigData.data;
        for (let i = 0; i < px.length; i += 4) {
          const gray = px[i] * 0.299 + px[i+1] * 0.587 + px[i+2] * 0.114;
          const val = gray < 120 ? 0 : 255;
          px[i] = val;
          px[i+1] = val;
          px[i+2] = val;
          px[i+3] = 255;
        }
        bigCtx.putImageData(bigData, 0, 0);

        // Second: downsample to exact printer resolution using nearest-neighbor
        const outCanvas = document.createElement('canvas');
        outCanvas.width = tW;
        outCanvas.height = tH;
        const outCtx = outCanvas.getContext('2d')!;
        outCtx.imageSmoothingEnabled = false; // NEAREST NEIGHBOR — no interpolation!
        outCtx.drawImage(bigCanvas, 0, 0, tW, tH);

        return outCanvas.toDataURL('image/png').split(',')[1];
      }, base64Screenshot, targetW, targetH);

      await hiResPage.close();

      const monoPngBuffer = Buffer.from(monoBase64, 'base64');

      return new NextResponse(monoPngBuffer, {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `inline; filename="label-${product.sku || product.id}.png"`,
        },
      });
    }

    // ── PDF FORMAT (default) ──
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
    if (page) await page.close().catch(() => {});
    // We intentionally DO NOT close the browser here, keeping it warm for the next print job!
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;700;900&subset=cyrillic,cyrillic-ext,latin&display=swap" rel="stylesheet">
<style>
  @page {
    size: ${widthMm}mm ${heightMm}mm;
    margin: 0;
  }
  * { 
    margin: 0; 
    padding: 0; 
    box-sizing: border-box; 
    -webkit-font-smoothing: none !important;
    -moz-osx-font-smoothing: grayscale !important;
    text-rendering: geometricPrecision !important;
    font-smooth: never !important;
  }
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
  }
  .inner {
    width: ${widthMm * 10}px;
    font-family: 'Roboto Condensed', sans-serif;
    font-weight: 700;
    color: black;
    padding: 18px 20px 0px 20px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  img {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
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
            <img src="${alu41Src}" style="height: 68px; width: auto; display: block; object-fit: contain;" />
            <img src="${eacSrc}" style="height: 68px; width: auto; display: block; object-fit: contain;" />
            <img src="${forkGlassSrc}" style="height: 68px; width: auto; display: block; object-fit: contain;" />
            <img src="${pap20Src}" style="height: 68px; width: auto; display: block; object-fit: contain;" />
          </div>
          
          <!-- SKU -->
          ${product.sku ? `
          <div style="font-size: 88px; font-weight: 700; font-family: 'Roboto Condensed', sans-serif; line-height: 0.8; margin-top: 8px; margin-bottom: 12px; text-align: center; letter-spacing: -1px;">
            ${escapeHtml(product.sku)}
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Manufacturer info -->
      <div style="font-size: 24px; font-weight: 700; text-align: center; line-height: 1.15; margin-bottom: 3px;">
        Изготовитель: ООО &quot;Эко-фабрика Сибирский Кедр&quot;<br />
        тел. (3822) 311-175<br />
        Адрес: Россия, 634593, Томская область, Томский район,<br />
        д. Петрово, ул. Луговая, 11
      </div>

      <!-- Product Name -->
      <div style="font-size: 32px; font-family: 'Roboto Condensed', sans-serif; font-weight: 900; text-decoration: underline; text-align: center; line-height: 1.1; min-height: 30px; flex-shrink: 0; margin-bottom: 3px; text-underline-offset: 3px;">
        ${escapeHtml(product.name)}
      </div>

      <!-- Composition -->
      ${showComposition ? `
      <div style="font-size: 24px; font-weight: 700; line-height: 1.2; text-align: left; margin-bottom: 3px;">
        ${escapeHtml(product.composition || "")}
      </div>
      ` : ''}

      <!-- Sponsor Text -->
      ${product.sponsorText ? `
      <div style="font-size: 24px; font-weight: 900; text-align: center; margin-bottom: 8px; text-decoration: underline;">
        ${escapeHtml(product.sponsorText)}
      </div>
      ` : ''}

      <!-- Mass + СТО on one line -->
      <div style="display: flex; justify-content: flex-start; gap: 30px; font-size: 24px; font-weight: 700; margin-bottom: 2px;">
        <div>
          ${product.weight ? escapeHtml(product.weight) : ''}
          ${!product.weight && product.quantity ? escapeHtml(product.quantity) : ''}
          ${!product.weight && !product.quantity && !product.boxWeight ? 'Масса нетто: —' : ''}
        </div>
        ${product.certCode ? `<div>${escapeHtml(product.certCode)}</div>` : ''}
      </div>
      ${product.weight && product.quantity ? `<div style="font-size: 24px; font-weight: 700; margin-bottom: 2px;">${escapeHtml(product.quantity)}</div>` : ''}
      ${product.boxWeight ? `<div style="font-size: 24px; font-weight: 700; margin-bottom: 2px;">${escapeHtml(product.boxWeight)}</div>` : ''}

      <!-- Nutritional & Storage -->
      ${(product.nutritionalInfo || product.storageCond) ? `
      <div style="font-size: 24px; font-weight: 700; line-height: 1.2; margin-bottom: 4px; text-align: left;">
        ${product.nutritionalInfo ? `<span>${escapeHtml(product.nutritionalInfo)}</span>` : ''}
        ${(product.nutritionalInfo && product.storageCond) ? `<br />` : ''}
        ${product.storageCond ? `<span>${escapeHtml(product.storageCond)}</span>` : ''}
      </div>
      ` : ''}

      <!-- Dates — pushed to bottom to align with QR code sticker -->
      <div style="display: grid; grid-template-columns: max-content max-content; column-gap: 12px; row-gap: 15px; align-items: center; margin-top: auto; margin-bottom: -10px; padding-top: 15px;">
        <div style="font-size: 24px; color: #000; font-weight: 900; white-space: nowrap; font-family: 'Roboto Condensed', sans-serif;">Дата изготовления:</div>
        <div style="font-size: 36px; font-weight: 900; font-family: 'Roboto Condensed', sans-serif; letter-spacing: -1px; color: #000;">${escapeHtml(mfgDate || "—")}</div>
        
        <div style="font-size: 24px; color: #000; font-weight: 900; white-space: nowrap; font-family: 'Roboto Condensed', sans-serif;">Годен до:</div>
        <div style="font-size: 36px; font-weight: 900; font-family: 'Roboto Condensed', sans-serif; letter-spacing: -1px; color: #000;">${escapeHtml(expDate || "—")}</div>
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
