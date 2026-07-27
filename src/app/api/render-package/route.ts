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
  body { margin: 0; padding: 0; font-family: 'Roboto Condensed', 'Arial', sans-serif; color: black; background: white; }
  @page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0; }
  .canvas {
    width: ${VIRTUAL_W_PX}px;
    /* высота фиксирована — auto-fit pipeline применит scale если контент выползает */
    background: white;
    box-sizing: border-box;
    padding: 26px 10px 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  /* Поджать пробел между блоком «Изготовитель» и строкой СТО+иконки —
     на референсе он минимальный, ещё меньше чем gap у canvas. */
  .cert-and-icons { margin-top: -4px; }
  .logo { display: flex; justify-content: center; align-items: center; }
  .logo img { width: 380px; height: auto; display: block; }
  .title {
    /* Roboto Black 900 — самый жирный гротеск из набора Google Fonts.
       Без отрицательного letter-spacing буквы дышат шире, как в макете
       заказчика (где буквы плотные, но не сжатые). */
    font-family: 'Roboto', 'Arial', sans-serif;
    font-weight: 900;
    font-size: 86px;
    line-height: 0.98;
    text-align: center;
    margin-top: -8px;
    letter-spacing: 0;
  }
  .subtitle {
    font-family: 'Roboto', 'Arial', sans-serif;
    font-weight: 900;
    font-size: 26px;
    line-height: 1.1;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 4px;
  }
  .body-text {
    font-family: 'Roboto', 'Arial', sans-serif;
    font-weight: 700;
    font-size: 20px;
    line-height: 1.25;
    text-align: justify;
  }
  .cert-and-icons {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 0;
    /* Сдвигаю иконки чуть левее от правого края — на референсе они не
       приклеены к самому краю этикетки, а имеют отступ ~10–12 мм. */
    padding-right: 36px;
  }
  .cert-and-icons .cert {
    font-family: 'Arial', sans-serif;
    font-weight: 700;
    font-size: 21px;
  }
  .icons {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .icons .ic { height: 60px; width: auto; display: block; object-fit: contain; }
  .icons .pet { display: block; height: 70px; }
  .icons .pet img { display: block; height: 100%; width: auto; }
  /* Нижняя секция: каждое поле в виде stack «маленький лейбл сверху →
     крупное значение снизу с отступом слева». Зеркало референсного
     макета: «Масса нетто:» на одной строке, «1000 г» — на следующей
     крупно; «Срок годности:» → «6 месяцев»; «Дата изготовления»
     → «(число.месяц.год)» → «00.00.00». */
  .field { font-family: 'Roboto', 'Arial', sans-serif; font-weight: 700; line-height: 1.1; }
  /* Split-вариант: лейбл в 2 строки слева («Масса / нетто:»), значение
     справа на одной строке («1000 г»), выровнены по вертикали. */
  .field.split { display: flex; align-items: center; gap: 10px; }
  .field.split .lbl-stack { display: flex; flex-direction: column; font-size: 18px; line-height: 1.0; }
  .field.split .lbl-stack > span { display: block; }
  .field.split .val { font-size: 30px; font-weight: 800; white-space: nowrap; }
  /* Stack-вариант: label сверху, value снизу прижато к левому краю без отступа. */
  .field.stack .lbl { font-size: 18px; display: block; }
  .field.stack .val { font-size: 30px; display: block; margin-top: 0; font-weight: 800; white-space: nowrap; }
  .field.stack .lbl-multi { font-size: 18px; display: block; line-height: 1.15; }
  /* Нижняя секция: слева текстовый блок (срок годности + дата), справа
     штрихкод EAN-13. На референсе штрихкод занимает примерно правую
     половину этикетки и сидит на одной строке с информацией. */
  .bottom-row {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    margin-top: 2px;
  }
  /* Левая колонка ~190 px: ровно столько, чтобы «Масса нетто: 1000 г»
     помещалось в одну строку, а «Срок годности:» + «6 месяцев» / «Дата
     изготовления (число.месяц.год)» + «23.06.2026» — в две строки
     (label сверху, значение снизу) без переноса самого значения. */
  .bottom-left {
    flex: 0 0 200px;
    width: 200px;
    display: flex;
    flex-direction: column;
    gap: 0;
    align-self: flex-start;
  }
  .barcode-block {
    flex: 0 0 412px;
    width: 412px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    overflow: hidden;
    /* Прижимаем штрихкод к правому краю bottom-row + поднимаем его вверх,
       чтобы был на уровне левой колонки с массой/сроком/датой. */
    margin-left: auto;
    align-self: flex-start;
    margin-top: 0;
  }
  .barcode-wrap { display: flex; align-items: center; justify-content: flex-end; width: 100%; padding-left: 7px; padding-top: 7px; box-sizing: border-box; }
  /* Сам SVG штрихкода: ширина и высота auto от внешнего контейнера. */
  .barcode-block svg, .barcode-block .barcode-wrap > svg {
    width: 100% !important;
    height: auto !important;
    max-width: 100%;
    display: block;
  }
</style>
</head>
<body>
<div class="canvas">
  <div class="logo">
    ${logoSrc ? `<img src="${logoSrc}" alt="Сибирский Кедр">` : ""}
  </div>
  <div class="title">${escapeHtml(product.name)}</div>
  <div class="subtitle">${escapeHtml(product.subtitle)}</div>
  <div class="body-text">${escapeHtml(product.nutritionalInfo)}</div>
  <div class="body-text">${escapeHtml(product.storageCond)}</div>
  <div class="body-text">${escapeHtml(product.manufacturer)}</div>
  <div class="cert-and-icons">
    <div class="cert">${escapeHtml(product.certCode)}</div>
    <div class="icons">
      ${eacSrc ? `<img class="ic" src="${eacSrc}" alt="EAC">` : ""}
      ${forkGlassSrc ? `<img class="ic" src="${forkGlassSrc}" alt="food-safe">` : ""}
      <div class="pet">${petHtml}</div>
    </div>
  </div>
  <!-- Нижняя секция: слева три строки (масса, срок, дата), справа штрихкод. -->
  <div class="bottom-row">
    <div class="bottom-left">
      <div class="field split">
        <div class="lbl-stack"><span>Масса</span><span>нетто:</span></div>
        <span class="val">${escapeHtml(product.netMass)}</span>
      </div>
      <div class="field stack">
        <span class="lbl">Срок годности:</span>
        <span class="val">${escapeHtml(product.shelfLife)}</span>
      </div>
      <div class="field stack">
        <span class="lbl-multi">Дата изготовления<br>(число.месяц.год)</span>
        <span class="val">${escapeHtml(mfgDate || "00.00.00")}</span>
      </div>
    </div>
    <div class="barcode-block">
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
