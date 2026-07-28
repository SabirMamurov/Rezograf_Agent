/**
 * Render route для нового шаблона «этикетка на упаковку».
 *
 * Отделён от /api/render намеренно: тот route оптимизирован под 70×90 мм
 * горизонтальные этикетки на коробку (warm browser + warm page + сложный
 * SKU + штрихкод-composite). Здесь — упрощённый одностраничный шаблон,
 * другой формат, другой layout. Делить общий код будем после того, как
 * этот макет стабилизируется и пройдёт визуальное сравнение с
 * референсом.
 *
 * Источник макета: фото от заказчика «Кедровая фисташка», 22.06.2026.
 * Каждое изменение здесь должно проверяться отдельно — текстовый layout
 * чувствителен к шрифтам и переносам строк.
 */
import { NextRequest, NextResponse } from "next/server";
import { PACKAGE_PRODUCTS, PackageProductConfig } from "@/lib/package-label";
import bwipjs from "bwip-js";
import puppeteer from "puppeteer";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

const LABEL_W_MM = 70;
const LABEL_H_MM = 90;
const DPI = 203;
const PX_PER_MM = DPI / 25.4;
const FINAL_W_PX = Math.round(LABEL_W_MM * PX_PER_MM);
const FINAL_H_PX = Math.round(LABEL_H_MM * PX_PER_MM);
// 700 px виртуальная ширина → коэффициент перевода в физические мм
// для CSS-блока: 1 mm ≈ 700 / 70 = 10 виртуальных пикселей.
const VIRTUAL_W_PX = 700;

function resolveChromiumPath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === "linux" && fs.existsSync("/snap/bin/chromium")) return "/snap/bin/chromium";
  return undefined;
}

function loadLogoDataUri(): string {
  try {
    const filepath = path.join(process.cwd(), "public", "icons", "cedar-logo.png");
    const data = fs.readFileSync(filepath);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

function loadIconDataUri(file: string, mime: string): string {
  try {
    const filepath = path.join(process.cwd(), "public", "icons", file);
    const data = fs.readFileSync(filepath);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

function loadPetIcon(): string {
  return loadIconDataUri("pet-1.png", "image/png");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPackageLabelHtml(
  product: PackageProductConfig,
  barcodeSvg: string,
  mfgDate?: string,
  logoSrc?: string,
  eacSrc?: string,
  forkGlassSrc?: string,
  petSrc?: string,
): string {
  // Inline SVG для PET-знака (треугольник переработки с надписью PET).
  // Делаю как inline SVG, чтобы не плодить новых файлов в public/icons на
  // этом этапе прототипа — если останется в финале, вынесем в файл.
  // Знак переработки PET: треугольник Möbius (только контур), внутри
  // подпись PET. Толстый контур (stroke-width = 6) чтобы пережил
  // 1-битную бинаризацию.
  // Знак переработки PET — готовая PNG-картинка от заказчика (с цифрой
  // «1» внутри треугольника Möbius и подписью PET снизу). Лежит в
  // public/icons/pet-1.png, эмбедится в HTML через data:URI.
  const petHtml = petSrc
    ? `<img src="${petSrc}" alt="PET" style="height:70px; width:auto; display:block; object-fit:contain;">`
    : "";

  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<!-- Google Fonts external link убран намеренно: прод-VM не имеет
     IPv6-маршрута до fonts.gstatic.com, fetch висит на ENETUNREACH
     и Puppeteer падает при screenshot/PDF. До того, как встроим
     fonts inline через data:URI, headless Chromium использует
     системный sans-serif fallback. -->
<style>html, body { font-family: 'Arial', 'Helvetica', sans-serif; }</style>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 0; font-family: 'Arial', 'Helvetica', sans-serif; color: black; background: white; }
  @page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0; }
  .canvas {
    width: ${VIRTUAL_W_PX}px;
    background: white;
    box-sizing: border-box;
    padding: 12px 18px 12px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .logo { display: flex; justify-content: center; align-items: center; margin-bottom: -4px; }
  .logo img { width: 220px; height: auto; display: block; }
  /* Заголовок — прописные, крупный жирный гротеск. text-transform:
     uppercase преобразует name из БД («Орехи кедровые очищенные») в
     «ОРЕХИ КЕДРОВЫЕ ОЧИЩЕННЫЕ» без правки данных. */
  .title {
    font-family: 'Arial Black', 'Arial', sans-serif;
    font-weight: 900;
    font-size: 44px;
    line-height: 1.0;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0;
    margin: 4px 0 6px 0;
  }
  /* Опциональный подзаголовок (описание). Показывается только если
     product.subtitle не пустой. */
  .subtitle {
    font-family: 'Arial', sans-serif;
    font-weight: 700;
    font-size: 20px;
    line-height: 1.1;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 2px;
  }
  .body-text {
    font-family: 'Arial', sans-serif;
    font-weight: 400;
    font-size: 18px;
    line-height: 1.2;
    text-align: left;
  }
  /* Инлайн-строка «КБЖУ …. СТО …» — весь абзац как один текст, СТО
     сразу после точки в конце КБЖУ, чуть-чуть отступ пробелами. */
  .nutrition-line {
    font-family: 'Arial', sans-serif;
    font-weight: 400;
    font-size: 18px;
    line-height: 1.25;
    text-align: left;
  }
  .nutrition-line .cert {
    white-space: nowrap;
    margin-left: 8px;
  }
  /* Нижняя секция — три колонки в grid:
     [срок/дата слева] [иконки центр] [масса + штрихкод справа]
     grid-template-columns фиксирует ширину каждой колонки чтобы штрихкод
     не распирал flex; iconки прижаты к вертикальному центру, левая и
     правая колонки — к верхнему. */
  .bottom-row {
    display: grid;
    grid-template-columns: 220px 1fr 260px;
    align-items: start;
    gap: 8px;
    margin-top: 6px;
  }
  .bottom-left {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: 'Arial', sans-serif;
    font-weight: 400;
  }
  .bottom-left .lbl { font-size: 18px; line-height: 1.1; }
  .bottom-left .val { font-size: 26px; font-weight: 700; line-height: 1.1; margin-top: 2px; white-space: nowrap; }
  .bottom-left .lbl-multi { font-size: 18px; line-height: 1.15; }
  .bottom-icons {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    align-self: center;
    padding-top: 4px;
  }
  .bottom-icons .ic { height: 42px; width: auto; display: block; object-fit: contain; }
  .bottom-icons .pet { display: flex; flex-direction: column; align-items: center; }
  .bottom-icons .pet img { height: 46px; width: auto; display: block; }
  .bottom-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .mass-line {
    font-family: 'Arial', sans-serif;
    font-weight: 400;
    font-size: 18px;
    display: flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
  }
  .mass-line .lbl { font-size: 18px; line-height: 1.0; }
  .mass-line .val { font-size: 32px; font-weight: 700; line-height: 1.0; }
  .barcode-wrap { width: 100%; }
  .barcode-wrap svg { width: 100% !important; height: auto !important; display: block; }
</style>
</head>
<body>
<div class="canvas">
  <div class="logo">
    ${logoSrc ? `<img src="${logoSrc}" alt="Сибирский Кедр">` : ""}
  </div>
  <div class="title">${escapeHtml(product.name)}</div>
  ${product.subtitle ? `<div class="subtitle">${escapeHtml(product.subtitle)}</div>` : ""}
  <div class="body-text">${escapeHtml(product.manufacturer)}</div>
  <div class="nutrition-line">
    ${escapeHtml(product.nutritionalInfo)}
    ${product.certCode ? `<span class="cert">${escapeHtml(product.certCode)}</span>` : ""}
  </div>
  <div class="body-text">${escapeHtml(product.storageCond)}</div>
  <!-- Нижняя секция: 3 колонки {срок/дата | иконки | масса+штрихкод} -->
  <div class="bottom-row">
    <div class="bottom-left">
      <div>
        <div class="lbl">Срок годности:</div>
        <div class="val">${escapeHtml(product.shelfLife)}</div>
      </div>
      <div>
        <div class="lbl-multi">Дата изготовления<br>(число.месяц.год)</div>
        <div class="val">${escapeHtml(mfgDate || "00.00.0000")}</div>
      </div>
    </div>
    <div class="bottom-icons">
      ${eacSrc ? `<img class="ic" src="${eacSrc}" alt="EAC">` : ""}
      ${forkGlassSrc ? `<img class="ic" src="${forkGlassSrc}" alt="food-safe">` : ""}
      <div class="pet">${petHtml}</div>
    </div>
    <div class="bottom-right">
      <div class="mass-line">
        <span class="lbl">Масса нетто:</span>
        <span class="val">${escapeHtml(product.netMass)}</span>
      </div>
      <div class="barcode-wrap">${barcodeSvg}</div>
    </div>
  </div>
</div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, mfgDate, format } = body;
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }
  const product = PACKAGE_PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Прямой вызов bwip-js со специфичными для упаковочной этикетки
  // параметрами: крупный scale, высокие полосы, крупный текст под
  // штрихкодом — чтобы цифры выглядели как на референсе (тонкие, крупные,
  // с правильной EAN-13 группировкой 1+6+6). НЕ используем
  // preserveAspectRatio="none" — это сжимало бы и сами полосы, и цифры.
  // Стандартный EAN-13 как на референсе: первая цифра слева отдельно от
  // полос, потом 6 цифр под левой половиной + 6 под правой. bwip-js
  // делает эту разметку САМ если не переопределять textfont/textxalign
  // и оставить дефолтный textsize. Только подкручиваю scale и height
  // чтобы штрихкод занимал нужное место.
  const barcodeSvg = (bwipjs as unknown as { toSVG: (opts: Record<string, unknown>) => string }).toSVG({
    bcid: "ean13",
    text: product.barcodeEan13,
    scale: 4,
    height: 13,
    includetext: true,
    textsize: 9,
    paddingwidth: 4,
    paddingheight: 2,
  });
  const logoSrc = loadLogoDataUri();
  const eacSrc = loadIconDataUri("eac.png", "image/png");
  const forkGlassSrc = loadIconDataUri("fork_glass.png", "image/png");
  const petSrc = loadPetIcon();
  const html = buildPackageLabelHtml(product, barcodeSvg, mfgDate, logoSrc, eacSrc, forkGlassSrc, petSrc);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromiumPath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    if (format === "image") {
      // Высокий dsf 12 как в основном route — нужен чтобы после
      // bw-бинаризации nearest-neighbor не давал муар.
      await page.setViewport({ width: VIRTUAL_W_PX, height: 100, deviceScaleFactor: 12 });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      // Явно ждём сетевую загрузку — `domcontentloaded` не дожидается
      // подгрузки шрифтов из Google Fonts, а fonts.ready может разрешиться
      // с fallback-шрифтом, если @font-face ещё не загружен.
      await page.evaluate(() => document.fonts.ready);
      // измеряем фактическую высоту контента
      const innerHeight = await page.evaluate(() => {
        const c = document.querySelector(".canvas") as HTMLElement | null;
        return c ? c.scrollHeight : 0;
      });
      await page.setViewport({ width: VIRTUAL_W_PX, height: innerHeight, deviceScaleFactor: 12 });
      // Скрин области канваса
      const buf = await page.screenshot({ type: "png", omitBackground: false, clip: { x: 0, y: 0, width: VIRTUAL_W_PX, height: innerHeight } });
      const out = await sharp(buf)
        .grayscale()
        .threshold(120)
        .resize(FINAL_W_PX, FINAL_H_PX, { kernel: "nearest", fit: "fill" })
        .png()
        .toBuffer();
      return new NextResponse(out as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    } else {
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      // Явно ждём сетевую загрузку — `domcontentloaded` не дожидается
      // подгрузки шрифтов из Google Fonts, а fonts.ready может разрешиться
      // с fallback-шрифтом, если @font-face ещё не загружен.
      await page.evaluate(() => document.fonts.ready);
      // Canvas рендерится при виртуальной ширине 700 CSS px, чтобы шрифты
      // и иконки выглядели крупно. Физическая бумага 70 мм = 264.57 CSS px
      // (1 mm = 3.7795 CSS px при 96 DPI). Поэтому scale = 264.57 / 700 ≈
      // 0.378 — сжимаем контент в 2.65 раза, чтобы он умещался по ширине,
      // и одновременно одна страница покрывала всю высоту. pageRanges: "1"
      // гарантирует ровно один лист — если контент окажется чуть выше
      // 120 мм, вторая пустая страница не появится.
      const pdf = await page.pdf({
        width: `${LABEL_W_MM}mm`,
        height: `${LABEL_H_MM}mm`,
        printBackground: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        scale: (LABEL_W_MM * 3.7795) / VIRTUAL_W_PX,
        pageRanges: "1",
      });
      return new NextResponse(pdf as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
      });
    }
  } finally {
    await browser.close();
  }
}
