import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateBarcodeSvg } from "@/lib/barcodes";
import { computeSkuLayout } from "@/lib/sku-layout";
import puppeteer from "puppeteer";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

// Global cache to avoid launching a new browser per request
let globalBrowser: any = null;

// HTTP header values are ByteString (latin-1) — non-ASCII filenames blow up
// with "Cannot convert argument to a ByteString". Cyrillic SKUs like
// "МСС 50236" (where М/С are Cyrillic, not Latin) hit this immediately.
// RFC 6266: send an ASCII-safe `filename=` and a UTF-8 `filename*=` for
// browsers that support it.
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const utf8 = encodeURIComponent(filename);
  return `inline; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// ── FONT EMBEDDING ─────────────────────────────────────────────────────
// Fetch Roboto Condensed once and keep it as an inline @font-face CSS
// string. Every subsequent label render reuses the cached copy instead of
// hitting fonts.googleapis.com + fonts.gstatic.com on every page load.
// This removes the per-request DNS/TLS/HTTP round-trip that was a major
// chunk of the old latency.
let fontCssPromise: Promise<string> | null = null;

async function getEmbeddedFontCss(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      try {
        const cssUrl =
          "https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;700;900&subset=cyrillic,cyrillic-ext,latin&display=swap";
        // Modern Chrome UA → Google returns compressed woff2 URLs (~20-30KB
        // each) instead of raw ttf (~120KB). Cuts the embedded payload 4×.
        const chromeUa =
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
        const cssRes = await fetch(cssUrl, { headers: { "User-Agent": chromeUa } });
        let css = await cssRes.text();
        // Match any font binary URL on gstatic (woff2, ttf, otf, woff…)
        const urls = Array.from(
          css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/g)
        ).map((m) => m[1]);
        const uniqueUrls = Array.from(new Set(urls));
        await Promise.all(
          uniqueUrls.map(async (url) => {
            const buf = await fetch(url).then((r) => r.arrayBuffer());
            const mime = url.endsWith(".woff2")
              ? "font/woff2"
              : url.endsWith(".ttf")
              ? "font/ttf"
              : url.endsWith(".woff")
              ? "font/woff"
              : "application/octet-stream";
            const b64 = Buffer.from(buf).toString("base64");
            css = css.split(url).join(`data:${mime};base64,${b64}`);
          })
        );
        console.log(
          `[render] embedded ${uniqueUrls.length} font file(s), css size ${css.length} bytes`
        );
        return css;
      } catch (e) {
        console.warn("Font preload failed; falling back to CDN:", e);
        return "";
      }
    })();
  }
  return fontCssPromise;
}
// Kick off font preload at module init so the first real request doesn't
// pay for it.
getEmbeddedFontCss().catch(() => {});

/**
 * Resolve the Chromium executable:
 *  - PUPPETEER_EXECUTABLE_PATH env var always wins
 *  - On Linux prod we use the snap-installed chromium at /snap/bin/chromium
 *    (only if it exists — otherwise fall back to Puppeteer's bundled binary)
 *  - On macOS / Windows / dev we let puppeteer use its bundled Chromium
 *    (executablePath undefined → Puppeteer picks its own download)
 */
function resolveChromiumPath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.platform === "linux" && fs.existsSync("/snap/bin/chromium")) {
    return "/snap/bin/chromium";
  }
  return undefined;
}

function isBrowserAlive(b: any): boolean {
  if (!b) return false;
  try {
    const c = b.connected;
    return typeof c === "function" ? c.call(b) : !!c;
  } catch {
    return false;
  }
}

async function getBrowser() {
  if (isBrowserAlive(globalBrowser)) return globalBrowser;
  // Old instance is dead — drop both caches together.
  globalBrowser = null;
  warmPage = null;
  const executablePath = resolveChromiumPath();
  globalBrowser = await puppeteer.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage"
    ],
  });
  globalBrowser.on("disconnected", () => {
    globalBrowser = null;
    warmPage = null;
  });
  return globalBrowser;
}

// ── PAGE REUSE ─────────────────────────────────────────────────────────
// Creating a new Puppeteer target takes ~500-600ms on macOS. We keep a
// single long-lived page and serialize renders through a promise-chain
// mutex so every request after the first only pays for setContent +
// screenshot (~400ms), not newPage.
let warmPage: any = null;
let renderQueue: Promise<unknown> = Promise.resolve();

function isPageAlive(p: any): boolean {
  if (!p) return false;
  try {
    return typeof p.isClosed === "function" ? !p.isClosed() : true;
  } catch {
    return false;
  }
}

async function getWarmPage(browser: any) {
  if (isPageAlive(warmPage)) return warmPage;
  warmPage = await browser.newPage();
  return warmPage;
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = renderQueue.then(fn, fn);
  renderQueue = next.catch(() => {});
  return next as Promise<T>;
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
  const fontCss = await getEmbeddedFontCss();
  const labelHtml = buildLabelHtml(
    product,
    barcodeSvg,
    widthMm,
    heightMm,
    mfgDate,
    expDate,
    iconDataUris,
    fontCss
  );

  // Viewport sized to just fit the label area (widthMm * 10 virtual px wide)
  // + a small slack for vertical overflow before scaling kicks in.
  // Old code used 800×1200 which at dsf=12 captured ~138M unused pixels.
  const vpWidth = widthMm * 10;
  const vpHeight = Math.max(heightMm * 10 * 2, 2000);

  // Image path needs a super-sampled raster; PDF path is vector so dsf=3 is fine.
  // dsf=6 gives 36× supersample (plenty for threshold → 203 DPI output) and
  // renders ~4× faster than dsf=12 on CPU-bound hosts like the prod VM.
  const dsf = format === "image" ? 6 : 3;

  const doRender = async () => {
    const browser = await getBrowser();
    const page = await getWarmPage(browser);
    await page.setViewport({ width: vpWidth, height: vpHeight, deviceScaleFactor: dsf });

    // domcontentloaded + explicit fonts.ready is faster than networkidle0.
    // With fonts inlined as data: URIs above, fonts.ready resolves almost
    // instantly instead of waiting on fonts.gstatic.com.
    await page.setContent(labelHtml, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    // ── ADAPTIVE WIDTH-PRESERVING SCALING ──
    // Measure real content height and uniformly shrink if it overflows the
    // physical label area. Otherwise apply only the CSS→mm base scale.
    const vWidth = widthMm * 10;
    const vHeight = heightMm * 10;
    const BASE_SCALE = ((widthMm / 25.4) * 96) / vWidth; // ≈ 0.37795

    const contentHeight: number = await page.evaluate((h: number) => {
      const inner = document.querySelector(".inner") as HTMLElement;
      return inner ? inner.scrollHeight : h;
    }, vHeight);

    if (contentHeight > vHeight) {
      const shrink = vHeight / contentHeight;
      await page.evaluate(
        (s: number, bs: number, vw: number) => {
          const inner = document.querySelector(".inner") as HTMLElement;
          const canvas = document.querySelector(".canvas") as HTMLElement;
          if (inner) {
            inner.style.width = vw / s + "px";
            inner.style.transform = `scale(${s})`;
            inner.style.transformOrigin = "top left";
          }
          if (canvas) {
            canvas.style.transform = `scale(${bs})`;
            canvas.style.transformOrigin = "top left";
          }
        },
        shrink,
        BASE_SCALE,
        vWidth
      );
    } else {
      await page.evaluate((scale: number) => {
        const canvas = document.querySelector(".canvas") as HTMLElement;
        if (canvas) {
          canvas.style.transform = `scale(${scale})`;
          canvas.style.transformOrigin = "top left";
        }
      }, BASE_SCALE);
    }

    // ── IMAGE FORMAT: Monochrome bitmap for thermal printers ──
    if (format === "image") {
      const PRINTER_DPI = 203;
      const targetW = Math.round((widthMm / 25.4) * PRINTER_DPI); // 559 px for 70mm
      const targetH = Math.round((heightMm / 25.4) * PRINTER_DPI); // 719 px for 90mm
      const clipW = Math.round((widthMm / 25.4) * 96);
      const clipH = Math.round((heightMm / 25.4) * 96);

      // Single hi-res screenshot of just the label region. Puppeteer encodes
      // this as PNG over CDP; sharp takes the raw buffer and does the
      // threshold + nearest-neighbor downsample in native C++ (~30× faster
      // than the old JS pixel-loop round-trip via Canvas).
      const screenshotBuffer = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: clipW, height: clipH },
        omitBackground: false,
      });

      const monoPngBuffer = await sharp(screenshotBuffer)
        .grayscale()
        .threshold(120) // identical cutoff to the previous JS loop
        .resize(targetW, targetH, { kernel: "nearest", fit: "fill" })
        .png({ compressionLevel: 9 })
        .toBuffer();

      return new NextResponse(new Uint8Array(monoPngBuffer), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": contentDisposition(`label-${product.sku || product.id}.png`),
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
        "Content-Disposition": contentDisposition(`label-${product.sku || product.id}.pdf`),
      },
    });
  };

  // Errors like "Session closed", "Target closed" or a disconnected browser
  // mean our cached page/browser is dead. Drop both caches and retry once
  // with a fresh browser before surfacing the failure to the client.
  const isStaleSessionError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return /Session closed|Target closed|Target.*closed|TargetCloseError|ProtocolError|Connection closed|Browser.*disconnected/i.test(msg);
  };

  return serialize(async () => {
    try {
      return await doRender();
    } catch (err: unknown) {
      if (isStaleSessionError(err)) {
        console.warn("[render] stale puppeteer session, rebuilding:", err instanceof Error ? err.message : err);
        try { warmPage && !warmPage.isClosed?.() && await warmPage.close(); } catch {}
        warmPage = null;
        try { globalBrowser && await globalBrowser.close(); } catch {}
        globalBrowser = null;
        try {
          return await doRender();
        } catch (err2: unknown) {
          const message = err2 instanceof Error ? err2.message : "Render failed";
          console.error("Render error after retry:", err2);
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }
      const message = err instanceof Error ? err.message : "Render failed";
      console.error("Render error:", err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
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
  iconDataUris?: Record<string, string>,
  embeddedFontCss?: string
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

  // Prefer inlined (data:) font CSS when available; fall back to CDN link
  // so rendering still works if the initial Google fetch failed.
  const fontStyleBlock = embeddedFontCss && embeddedFontCss.length > 0
    ? `<style>${embeddedFontCss}</style>`
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;700;900&subset=cyrillic,cyrillic-ext,latin&display=swap" rel="stylesheet">`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
${fontStyleBlock}
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
          
          <!-- SKU(s) — adaptive size, stacks vertically when sku2 is present.
               Logic mirrored in components/LabelPreview.tsx via computeSkuLayout. -->
          ${(() => {
            const { fontSize, lines } = computeSkuLayout(product.sku, product.sku2);
            if (fontSize === 0) return '';
            const items = lines.map(l => `
              <div style="font-size: ${fontSize}px; font-weight: 700; font-family: 'Roboto Condensed', sans-serif; line-height: 0.85; text-align: center; letter-spacing: -1px; white-space: nowrap;">
                ${escapeHtml(l)}
              </div>`).join('');
            return `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${lines.length > 1 ? '2px' : '0'}; margin-top: 8px; margin-bottom: 12px; width: 100%;">
                ${items}
              </div>`;
          })()}
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
