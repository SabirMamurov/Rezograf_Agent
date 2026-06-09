import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateBarcodeSvg, generateBarcodeBitmap } from "@/lib/barcodes";
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
  const { productId, mfgDate, expDate, format, productOverride } = body;

  // productOverride path — used by /vkusvill (and any future "synthetic"
  // products that don't live in the catalogue DB). The caller hands the
  // route a fully-formed Product-shaped object and we render it as if it
  // had come from prisma.product.findUnique. No DB write, no DB read.
  //
  // Trade-off: this is an internal LAN tool with no auth, so accepting
  // arbitrary product data here is acceptable. Don't reuse this path for
  // anything Internet-facing without sanitising input first.
  // The "with template" findUnique payload is wider than the bare
  // findUnique return type — type the variable as `any` here to avoid
  // a noisy Prisma generic. The fields actually read below (name,
  // template?.widthMm, barcodeEan13, …) are runtime-checked by their
  // own callsites or by buildLabelHtml, so we don't lose safety.
  let product: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

  if (productOverride && typeof productOverride === "object") {
    product = productOverride;
  } else {
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    product = await prisma.product.findUnique({
      where: { id: productId },
      include: { template: true },
    });
  }

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // ITF-14 → bars-only SVG; the digits are added below as plain HTML
  // (see buildLabelHtml). Bigger, letter-spaced digits survive thermal
  // wear better than the tight bwip-js glyphs. EAN-13/EAN-8/Code128
  // keep their embedded text. Mirrored in print/page.tsx and
  // components/LabelPreview.tsx.
  const digitOnly = (product.barcodeEan13 || "").replace(/\D/g, "");
  // ШК-template products always render the barcode digits as a separate
  // HTML block below the bars — both halves of the doubled layout get a
  // uniform big-digit caption regardless of the underlying barcode type,
  // and the SVG stretches via preserveAspectRatio="none" to fill the
  // fixed barcode rectangle without dragging the embedded glyphs along.
  const isShkLabelEarly = !!product?.isShkLabel ||
    (typeof product?.btwFilePath === "string" && /\\Единичный ШК\\/i.test(product.btwFilePath));
  const useSeparateBarcodeDigits = isShkLabelEarly || digitOnly.length === 14;

  let barcodeSvg = "";
  if (product.barcodeEan13) {
    try {
      barcodeSvg = await generateBarcodeSvg(product.barcodeEan13, {
        separateText: useSeparateBarcodeDigits,
      });
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

  // The pixel-perfect barcode overlay (image path, below) AND the
  // wide-digits HTML styling are applied to ALL labels site-wide as of
  // v1.4.12 — the «Цех ПЦО» trial confirmed reliable scanning, so the
  // folder gate was dropped. (Old gate variable kept as constant `true`
  // to leave the conditional wiring inside buildLabelHtml untouched.)
  const labelHtml = buildLabelHtml(
    product,
    barcodeSvg,
    widthMm,
    heightMm,
    mfgDate,
    expDate,
    iconDataUris,
    fontCss,
    useSeparateBarcodeDigits ? digitOnly : null,
    true,
  );

  // Viewport sized to just fit the label area (widthMm * 10 virtual px wide)
  // + a small slack for vertical overflow before scaling kicks in.
  // Old code used 800×1200 which at dsf=12 captured ~138M unused pixels.
  const vpWidth = widthMm * 10;
  const vpHeight = Math.max(heightMm * 10 * 2, 2000);

  // Image path needs a super-sampled raster; PDF path is vector so dsf=3 is fine.
  //
  // ⚠ DO NOT lower this below 12 for the image path. The pipeline is
  // screenshot → grayscale → threshold(120) → resize(target, nearest). After
  // the threshold the image is binary, so the nearest-neighbor downsample
  // picks ONE source pixel per destination pixel. With dsf=12 every output
  // pixel maps to ~144 source samples, and the picked one is statistically
  // representative — text edges look clean. With dsf=6 the window collapses
  // to ~36 samples and the picked pixel flips back-and-forth across glyph
  // edges at oblique angles, producing visibly wavy / aliased text on the
  // thermal printer (operators reported "не читаемый текст" twice now —
  // once with the original implementation and again after a perf "fix"
  // dropped this to 6 in 64c8985). If a future perf pass wants to reduce
  // CPU here, the right move is to swap the order to lanczos-downsample →
  // threshold (smooth grayscale resample, then 1-bit cutoff), not to
  // shrink dsf.
  const dsf = format === "image" ? 12 : 3;

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
    // Measure real content height and pick a uniform scale `s`:
    //   • s < 1 — content overflows, shrink to fit (preserves legibility on
    //     dense labels)
    //   • s = 1 — content fits in roughly 85-100% of the label height
    //   • s > 1 — significant free space at the bottom, grow text so the
    //     customer can read it from further away (capped at MAX_GROW)
    //
    // The DOM-side application is identical for both directions: set
    // inner.style.width = vw/s (narrows for grow, widens for shrink) and
    // inner.style.transform = scale(s). For grow we do a second
    // measurement *at the narrowed width* and clamp s, because narrower
    // width = more text wrapping = larger scrollHeight, which could
    // otherwise push us past the label edge.
    const vWidth = widthMm * 10;
    const vHeight = heightMm * 10;
    const BASE_SCALE = ((widthMm / 25.4) * 96) / vWidth; // ≈ 0.37795
    const MAX_GROW = 1.25;       // never blow up text by more than 25%
    const GROW_TRIGGER = 0.85;   // grow only if content uses < 85% of height
    const SAFETY_MARGIN = 0.97;  // target 97% of label height after grow

    const applyScaleInDom = async (s: number) => {
      await page.evaluate(
        (sc: number, bs: number, vw: number) => {
          const inner = document.querySelector(".inner") as HTMLElement;
          const canvas = document.querySelector(".canvas") as HTMLElement;
          if (inner) {
            inner.style.width = vw / sc + "px";
            inner.style.transform = `scale(${sc})`;
            inner.style.transformOrigin = "top left";
          }
          if (canvas) {
            canvas.style.transform = `scale(${bs})`;
            canvas.style.transformOrigin = "top left";
          }
        },
        s,
        BASE_SCALE,
        vWidth
      );
    };

    const measureContentHeight = (): Promise<number> =>
      page.evaluate((h: number) => {
        const inner = document.querySelector(".inner") as HTMLElement;
        return inner ? inner.scrollHeight : h;
      }, vHeight);

    const contentHeight = await measureContentHeight();

    // ШК (two-up sticker) layout has a fixed bar height per half and must
    // keep that envelope stable — grow-scaling here would inflate the bars
    // back up to the old size and undo the operator's «не громоздкие»
    // request. So for ШК we only ever shrink or fit, never grow.
    const isShkForScale =
      !!product?.isShkLabel ||
      (typeof product?.btwFilePath === "string" && /\\Единичный ШК\\/i.test(product.btwFilePath));

    if (contentHeight > vHeight) {
      // Existing shrink-to-fit path
      const shrink = vHeight / contentHeight;
      await applyScaleInDom(shrink);
    } else if (!isShkForScale && contentHeight < vHeight * GROW_TRIGGER) {
      // Grow path: enough free space to reasonably enlarge text
      const proposed = Math.min(MAX_GROW, (vHeight * SAFETY_MARGIN) / contentHeight);
      // Step 1: narrow + scale (this re-wraps text and may shift heights)
      await applyScaleInDom(proposed);
      // Step 2: re-measure at the new width, clamp scale so the (re-wrapped)
      // visible height never exceeds the label.
      const reMeasured = await measureContentHeight();
      const visible = reMeasured * proposed;
      let finalScale = proposed;
      if (visible > vHeight) {
        finalScale = Math.max(1, vHeight / reMeasured);
        await applyScaleInDom(finalScale);
      }
    } else {
      // Content fits naturally — no scaling, just the CSS→mm base.
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
      // Measure the barcode area(s) in clip CSS px BEFORE the screenshot so we
      // can replace them with a pixel-perfect bitmap afterwards. ×(targetW/clipW)
      // converts to final-bitmap px. Covers the normal label (.barcode-fill)
      // and the ШК double layout (.shk-barcode-fill, two boxes).
      const barcodeBoxes = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll(".barcode-fill, .shk-barcode-fill"),
        ).map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
      });

      const screenshotBuffer = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: clipW, height: clipH },
        omitBackground: false,
      });

      // Single-pass binary pipeline (v1.2.5 and earlier). Watermark is
      // a CSS halftone (each dot pure black) so it survives threshold
      // and gets read by the thermal head as discrete dots. Body text
      // stays pixel-perfect. The v1.3.0 grayscale composite tried to
      // ship smooth gray watermark too, but lanczos resize spilled
      // antialiased edges around the body text and the thermal driver
      // dithered them as fuzzy halos. CLAUDE.md predicted exactly this.
      let monoPngBuffer = await sharp(screenshotBuffer)
        .grayscale()
        .threshold(120)
        .resize(targetW, targetH, { kernel: "nearest", fit: "fill" })
        .png({ compressionLevel: 9 })
        .toBuffer();

      // ── Pixel-perfect barcode overlay ──
      // The screenshot+downscale renders the barcode with a fractional module
      // (~2.4px) → bars come out at uneven widths (1–6px), the narrowest merge
      // or drop, and warehouse scanners struggle. Re-render each barcode with
      // an INTEGER module (generateBarcodeBitmap) and composite it over its
      // measured box — erasing the fractional original underneath with white
      // first — so the printed bars are perfectly uniform.
      //
      // Pixel-perfect overlay is now applied to every label that has a
      // barcode — the Цех ПЦО trial proved reliable scanning, so the
      // folder gate was lifted in v1.4.12.
      if (product.barcodeEan13 && barcodeBoxes.length > 0) {
        const sx = targetW / clipW;
        const sy = targetH / clipH;
        const overlays: sharp.OverlayOptions[] = [];
        for (const box of barcodeBoxes) {
          const xf = Math.round(box.x * sx);
          const yf = Math.round(box.y * sy);
          const wf = Math.round(box.w * sx);
          const hf = Math.round(box.h * sy);
          if (wf < 40 || hf < 10 || xf < 0 || yf < 0 || xf + wf > targetW || yf + hf > targetH) continue;
          const bmp = await generateBarcodeBitmap(product.barcodeEan13, wf, hf, !useSeparateBarcodeDigits);
          if (!bmp) continue;
          const whiteRect = await sharp({
            create: { width: wf, height: hf, channels: 3, background: "#ffffff" },
          }).png().toBuffer();
          overlays.push({ input: whiteRect, left: xf, top: yf });
          overlays.push({ input: bmp.buffer, left: xf, top: yf });
        }
        if (overlays.length > 0) {
          monoPngBuffer = await sharp(monoPngBuffer)
            .composite(overlays)
            .png({ compressionLevel: 9 })
            .toBuffer();
        }
      }

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
 * Stripped-down "ШК" template — used only for products under
 * \ШБ ТУЛА\ШК\. Layout matches operators' physical sticker:
 *   - underlined product name (title)
 *   - subtitle in parens (taken from product.weight, re-purposed)
 *   - large EAN-13 barcode centered below
 * No manufacturer block, no icons, no dates. Same 70×90mm physical size.
 *
 * Visuals must mirror LabelPreview.tsx ШК branch.
 */
function buildShkLabelHtml(
  product: any,
  barcodeSvg: string,
  widthMm: number,
  heightMm: number,
  embeddedFontCss?: string,
  // For ITF-14 (14-digit codes) the SVG is fetched WITHOUT embedded
  // text, and the digits are drawn below the bars as plain HTML so they
  // print bigger / bolder / wear-resistant on the thermal head. When
  // this string is non-null we have to render that block under EACH of
  // the two stacked barcode copies — otherwise the operator gets bars
  // with no human-readable digits.
  separateBarcodeDigits?: string | null,
  // TEST-ROLLOUT flag — see buildLabelHtml for context. When true the
  // digits block is stretched to full barcode width and the glyphs are
  // justified so they breathe like on the new EAN-13 layout.
  wideBarcodeDigits?: boolean,
): string {
  const fontStyleBlock = embeddedFontCss && embeddedFontCss.length > 0
    ? `<style>${embeddedFontCss}</style>`
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;500;700;900&subset=cyrillic,cyrillic-ext,latin&display=swap" rel="stylesheet">`;

  const rawSubtitle = (product?.weight || "").trim();
  const title = product?.name || "";
  // Adaptive title font sizing — long names wrap to 3+ lines and push
  // the barcode + digits over the bottom edge of the half. Step down
  // by character count so the whole content block fits in ~408px
  // (450px half height minus 42px padding). Kept aligned with the same
  // helper in LabelPreview.tsx (ШК branch).
  const titleLen = title.length;
  const titleFontPx =
    titleLen <= 30 ? 38 :
    titleLen <= 50 ? 32 :
    titleLen <= 70 ? 26 :
    22;
  const subtitleFontPx = titleFontPx >= 32 ? 24 : 20;
  // ШК labels conventionally encode the weight inside the title (e.g.
  // "...МП/200г") so the separate `weight` subtitle ended up showing
  // the same number twice on the printed sticker. Suppress the subtitle
  // when the weight is already inside the name. Normalisation collapses
  // whitespace and lowercases so "200 г" matches "200г" and "200 Г".
  // Keep aligned with the same heuristic in LabelPreview.tsx ШК branch.
  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, "").replace(/ё/g, "е");
  const weightInTitle =
    rawSubtitle.length > 0 && norm(title).includes(norm(rawSubtitle));
  const subtitle = weightInTitle ? "" : rawSubtitle;
  const isExport = !!product?.isExport;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
${fontStyleBlock}
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box;
      -webkit-font-smoothing: none !important;
      -moz-osx-font-smoothing: grayscale !important;
      text-rendering: geometricPrecision !important;
      font-smooth: never !important; }
  html, body { width: ${widthMm}mm; height: ${heightMm}mm; margin: 0; padding: 0; background: white; overflow: hidden; }
  .outer { width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; }
  /* Two stacked halves. Per operator request the prod-style layout
     should just appear twice on one 70×90 mm sticker — same content,
     no separator. flex-column distributes them 50/50. */
  .canvas { width: ${widthMm * 10}px; height: ${heightMm * 10}px; box-sizing: border-box; position: relative; display: flex; flex-direction: column; }
  .shk-half {
    flex: 1 1 0;
    min-height: 0;
    padding: 24px 24px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    position: relative;
    z-index: 1;
  }
  /* Bottom half needs extra padding underneath so the human-readable
     digits block (~36px tall) doesn't fall off the sticker edge — even
     with a tall title up top the content now centers higher in the half. */
  .shk-half:last-child {
    padding-bottom: 80px;
  }
  .export-mark {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Roboto Condensed', sans-serif;
    font-weight: 700;
    /* "МП" is two glyphs (was single "Э" at 800px) — reduce so the
       watermark fits horizontally within the label width. */
    font-size: 500px;
    letter-spacing: -20px;
    /* Halftone via background-clip:text. Each dot is pure black so it
       survives Sharp.threshold(120) binarization for the thermal printer
       (rgba(0,0,0,0.18) at luminance ~209 was wiped to white). 1px solid
       dot with sharp 0.2px edge on a 4px tile gives ~22% coverage —
       enough to read as a soft gray "stamp" (matches the BarTender
       reference) but light enough that body text printed on top stays
       readable. translateX(-2px) optically centers MP (П is heavier than
       М so geometric centering looked right-biased).
       NOTE: v1.3.0 tried solid rgba(0,0,0,0.3) + two-layer composite
       to ship smooth gray on the printer too, but the lanczos resize
       of the watermark layer leaked antialiased edges around body
       text → operators reported "размыто печатаются". CLAUDE.md
       warned about this. Reverted to halftone + binary pipeline. */
    color: transparent;
    background: radial-gradient(circle, #000 0 1px, transparent 1.2px) 0 0 / 4px 4px;
    -webkit-background-clip: text;
    background-clip: text;
    transform: translateX(-2px);
    line-height: 0.85;
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
  .shk-half { font-family: 'Roboto Condensed', sans-serif; font-weight: 700; color: black; }
  /* Title and subtitle sizes are emitted per-render via inline style
     (computed from title length above). Default values here just cover
     the case where the inline override is missing. */
  .shk-title {
    font-size: ${titleFontPx}px;
    font-weight: 700;
    text-align: center;
    line-height: 1.1;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
    margin-bottom: 8px;
  }
  .shk-subtitle {
    font-size: ${subtitleFontPx}px;
    font-weight: 500;
    text-align: center;
    line-height: 1.1;
    margin-bottom: 12px;
  }
  /* Fixed barcode height (140px per half) → every label type renders
     in the same vertical envelope regardless of natural aspect ratio.
     Combined with preserveAspectRatio="none" on the SVG (injected on
     the wire just below), EAN-13 / Code128 / ITF-14 / EAN-8 all fill
     the same rectangle. Bar-to-bar width ratios are preserved under
     uniform scaling, so scanners read all variants correctly. */
  .shk-barcode {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 30px;
  }
  .shk-barcode > div { width: 88%; height: 100%; display: flex; align-items: stretch; justify-content: center; }
  .shk-barcode svg { width: 100%; height: 100%; display: block; }
  /* Human-readable digits for 14-digit ITF-14 codes (the SVG was
     fetched with separateText=1 → bars only). Sized to roughly match
     the prod single-version look — big enough that the warehouse can
     scan the digits with eyes if the laser misses, and visually heavy
     so it survives thermal-print wear. Letter-spacing kept modest so
     the digits don't look stretched. */
  .shk-barcode-digits {
    font-family: 'Roboto Condensed', sans-serif;
    font-variant-numeric: tabular-nums;
    font-size: 36px;
    font-weight: 900;
    letter-spacing: 1px;
    text-align: center;
    line-height: 1;
    flex: 0 0 auto;
    margin-top: 8px;
  }
  img { -webkit-print-color-adjust: exact; print-color-adjust: exact;
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
        image-rendering: pixelated; }
</style>
</head>
<body>
  <div class="outer">
    <div class="canvas">
      ${isExport ? `<div class="export-mark">МП</div>` : ""}
      <!-- Top half — full title/subtitle/barcode copy. -->
      <div class="shk-half">
        <div class="shk-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="shk-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        <div class="shk-barcode">
          ${barcodeSvg ? `<div>${barcodeSvg.replace(/<svg\s/i, '<svg preserveAspectRatio="none" ')}</div>` : ""}
        </div>
        ${separateBarcodeDigits ? (wideBarcodeDigits ? spreadDigitsHtml(separateBarcodeDigits, 36, "width: 88%; align-self: center; margin-top: 8px; flex: 0 0 auto;") : `<div class="shk-barcode-digits">${escapeHtml(separateBarcodeDigits)}</div>`) : ""}
      </div>
      <!-- Bottom half — identical copy stacked directly below, no
           separator (operator request: just duplicate, no cut-line). -->
      <div class="shk-half">
        <div class="shk-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="shk-subtitle">${escapeHtml(subtitle)}</div>` : ""}
        <div class="shk-barcode">
          ${barcodeSvg ? `<div>${barcodeSvg.replace(/<svg\s/i, '<svg preserveAspectRatio="none" ')}</div>` : ""}
        </div>
        ${separateBarcodeDigits ? (wideBarcodeDigits ? spreadDigitsHtml(separateBarcodeDigits, 36, "width: 88%; align-self: center; margin-top: 8px; flex: 0 0 auto;") : `<div class="shk-barcode-digits">${escapeHtml(separateBarcodeDigits)}</div>`) : ""}
      </div>
    </div>
  </div>
</body>
</html>`;
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
  embeddedFontCss?: string,
  // When non-null, the SVG above contains only bars and these digits are
  // rendered as wear-resistant HTML below the SVG (test-folder ITF-14
  // wear-resistance experiment).
  separateBarcodeDigits?: string | null,
  // TEST-ROLLOUT flag: when true, the human-readable digits block under
  // the bars is stretched to the FULL width of the barcode container and
  // justified between glyphs (matches the look of the pixel-perfect EAN-13
  // digits — see generateBarcodeBitmap). Same gate as the bar overlay.
  wideBarcodeDigits?: boolean
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

  // Manufacturer block has two hardcoded variants (ИП Абдуалиев / ООО
  // «Эко-фабрика»). Priority:
  // 1) product.manufacturerType explicit value from the inspector editor
  //    ("abdualiev" | "ekofabrika") — wins over everything.
  // 2) Legacy auto-detect by btwFilePath for products imported before the
  //    explicit field existed ("Цех ПЦО\Орехи\ИП Абдуалиев" and
  //    "МП\ПЦПО" → ИП Абдуалиев; everything else → Эко-фабрика).
  // Keep aligned with src/components/LabelPreview.tsx.
  const isAbdualievProduct =
    product?.manufacturerType === "abdualiev"
      ? true
      : product?.manufacturerType === "ekofabrika"
        ? false
        : typeof product?.btwFilePath === "string" &&
          /(\\Цех ПЦО\\Орехи\\ИП Абдуалиев\\|\\МП\\ПЦПО\\)/i.test(product.btwFilePath);

  // ШК (showbox barcode-only) labels: either the product is explicitly
  // flagged via the `isShkLabel` column (set from the inspector edit
  // form / create form), or its btwFilePath sits under a folder literally
  // named «Единичный ШК» (legacy heuristic, kept for the ~55 products
  // imported under that path before the explicit flag existed).
  // The ШК template uses a stripped-down layout — just title + optional
  // subtitle + large barcode — and prints TWO stacked copies per sticker
  // with a dashed cut-line so the operator can scissors-split a single
  // 70×90 mm print into two 70×45 mm labels (saves tape).
  const isShkLabel =
    !!product?.isShkLabel ||
    (typeof product?.btwFilePath === "string" &&
      /\\Единичный ШК\\/i.test(product.btwFilePath));
  if (isShkLabel) {
    return buildShkLabelHtml(
      product,
      barcodeSvg,
      widthMm,
      heightMm,
      embeddedFontCss,
      separateBarcodeDigits,
      wideBarcodeDigits,
    );
  }

  // The "41 ALU" recyclable-code icon was removed entirely in v1.3.6 —
  // operator confirmed it shouldn't appear on any sticker because the
  // physical packaging in this product range doesn't contain aluminium
  // foil. With one fewer icon we also re-centre the remaining three.
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
    position: relative;
  }
  .export-mark {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Roboto Condensed', sans-serif;
    font-weight: 700;
    /* "МП" is two glyphs (was single "Э" at 800px) — reduce so the
       watermark fits horizontally within the label width. */
    font-size: 500px;
    letter-spacing: -20px;
    /* Halftone via background-clip:text. Each dot is pure black so it
       survives Sharp.threshold(120) binarization for the thermal printer
       (rgba(0,0,0,0.18) at luminance ~209 was wiped to white). 1px solid
       dot with sharp 0.2px edge on a 4px tile gives ~22% coverage —
       enough to read as a soft gray "stamp" (matches the BarTender
       reference) but light enough that body text printed on top stays
       readable. translateX(-2px) optically centers MP (П is heavier than
       М so geometric centering looked right-biased).
       NOTE: v1.3.0 tried solid rgba(0,0,0,0.3) + two-layer composite
       to ship smooth gray on the printer too, but the lanczos resize
       of the watermark layer leaked antialiased edges around body
       text → operators reported "размыто печатаются". CLAUDE.md
       warned about this. Reverted to halftone + binary pipeline. */
    color: transparent;
    background: radial-gradient(circle, #000 0 1px, transparent 1.2px) 0 0 / 4px 4px;
    -webkit-background-clip: text;
    background-clip: text;
    transform: translateX(-2px);
    line-height: 0.85;
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
  .inner {
    position: relative;
    z-index: 1;
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
      ${product?.isExport ? `<div class="export-mark">МП</div>` : ""}
      <div class="inner">
      <!-- TOP ROW: Barcode + Icons & SKU
           Proportional widths (flex-basis %) instead of fixed px so the row
           stays well-formed when the auto-fit pipeline narrows the inner
           during a grow pass. bwip-js SVGs have no width/height attrs so we
           force them to fill via the .barcode-fill > svg CSS rule below.
           Mirrored in components/LabelPreview.tsx. -->
      <style>.barcode-fill > svg { width: 100% !important; height: 100% !important; display: block; }</style>
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 10px; margin-top: 4px;">
        <!-- Barcode — locked at 50% of the label width so it dominates the
             layout and scans reliably. The right column adapts to the
             remaining space. 5 px top + 5 px bottom padding gives the bars
             breathing room without resizing the row. Mirrored in
             components/LabelPreview.tsx. When separateBarcodeDigits is set
             (test-folder ITF-14 wear-resistance experiment), the SVG holds
             only the bars and the digits are rendered as plain HTML below
             with bigger font + letter-spacing. -->
        <div style="flex: 0 0 calc(60% + 4px); height: 160px; overflow: hidden; padding: 5px 0; box-sizing: border-box; display: flex; flex-direction: column;${separateBarcodeDigits ? " gap: 4px;" : ""}">
           ${barcodeSvg ? `<div class="barcode-fill" style="flex: 1 1 auto; min-height: 0; width: 100%;">${barcodeSvg.replace(/<svg\s/i, '<svg shape-rendering="crispEdges" ')}</div>` : ''}
           ${separateBarcodeDigits ? (wideBarcodeDigits ? spreadDigitsHtml(separateBarcodeDigits, 26, "width: 100%; flex: 0 0 auto;") : `<div style="font-family: 'Roboto Condensed', sans-serif; font-variant-numeric: tabular-nums; font-weight: 900; line-height: 1; flex: 0 0 auto; font-size: 22px; letter-spacing: 2.5px; text-align: center;">${escapeHtml(separateBarcodeDigits)}</div>`) : ''}
        </div>

        <!-- Right side: Icons + SKU — flex:1 takes whatever the barcode's
             fixed 50% leaves. ~340 px in normal mode, ~270 px after an
             auto-grow narrow pass. flex-start + a small gap keeps the
             icons and SKU close together; space-between would stretch them
             apart now that the row is 200 px tall to fit the taller
             barcode. -->
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 7px; flex: 1 1 0; min-width: 0; height: 160px; padding-top: 2px;">
          <!-- Icons row — centered in the column so the three remaining
               icons (EAC, fork+glass, 20 PAP) line up directly above the
               centered SKU number. -->
          <div style="display: flex; gap: 10px; align-items: center; justify-content: center; width: 100%; padding-left: 7px; box-sizing: border-box;">
            <img src="${eacSrc}" style="height: 48px; width: auto; display: block; object-fit: contain;" />
            <img src="${forkGlassSrc}" style="height: 48px; width: auto; display: block; object-fit: contain;" />
            <img src="${pap20Src}" style="height: 48px; width: auto; display: block; object-fit: contain;" />
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
        ${isAbdualievProduct
          ? `Изготовитель: ИП Абдуалиев В.Г.<br />
        Тел.: + 7 913-851-49-49<br />
        Адрес: Россия, 634015, Томская область, гор. Томск,<br />
        ул. Айвазовского, д. 29 стр. 6`
          : `Изготовитель: ООО &quot;Эко-фабрика Сибирский Кедр&quot;<br />
        тел. (3822) 311-175<br />
        Адрес: Россия, 634593, Томская область, Томский район,<br />
        д. Петрово, ул. Луговая, 11`}
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

      <!-- Extra text (seasonal markers, marketplace tags, BIO certs, etc.).
           Sits between composition and quantity/weight, centered, italic-ish.
           Keep layout aligned with src/components/LabelPreview.tsx. -->
      ${product.extraText ? `
      <div style="font-size: 22px; font-weight: 700; font-style: italic; text-align: center; margin-bottom: 4px; line-height: 1.15;">
        ${escapeHtml(product.extraText)}
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

// Renders barcode digits spread evenly to the full container width via flex
// space-between (each glyph in its own span). CSS text-align: justify does
// NOT spread no-space strings like a 14-digit code, so we do it ourselves.
// `extraStyle` lets each caller pin width/align/margin to its container.
function spreadDigitsHtml(digits: string, fontSizePx: number, extraStyle: string): string {
  const spans = Array.from(digits).map((d) => `<span>${escapeHtml(d)}</span>`).join("");
  return `<div style="display: flex; justify-content: space-between; font-family: 'Roboto Condensed', sans-serif; font-variant-numeric: tabular-nums; font-size: ${fontSizePx}px; font-weight: 900; line-height: 1; ${extraStyle}">${spans}</div>`;
}
