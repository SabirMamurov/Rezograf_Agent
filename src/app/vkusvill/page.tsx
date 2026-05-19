"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LabelPreview from "@/components/LabelPreview";
import {
  VKUSVILL_PRODUCTS,
  buildVkusvillBarcode,
  buildVkusvillRenderProduct,
  addMonthsClamped,
  formatLabelDate,
} from "@/lib/vkusvill";

const LABEL_WIDTH_MM = 70;
const LABEL_HEIGHT_MM = 90;

// There's a single hardcoded ВкусВилл product. If more SKUs are added
// later, switch this page back to a picker — until then a fixed const
// is simpler than a one-item dropdown.
const PRODUCT = VKUSVILL_PRODUCTS[0];

function toInputFormat(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function VkusvillPage() {
  const [mfgDateStr, setMfgDateStr] = useState<string>(() => toInputFormat(new Date()));
  const [barcodeSvg, setBarcodeSvg] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const mfgDate = useMemo(() => new Date(mfgDateStr + "T00:00:00"), [mfgDateStr]);
  const expDate = useMemo(
    () => addMonthsClamped(mfgDate, PRODUCT.shelfLifeMonths),
    [mfgDate],
  );
  const barcode = useMemo(
    () => buildVkusvillBarcode(mfgDate, PRODUCT.prefix),
    [mfgDate],
  );
  const renderProduct = useMemo(
    () => buildVkusvillRenderProduct(PRODUCT, mfgDate),
    [mfgDate],
  );
  const mfgDateFormatted = useMemo(() => formatLabelDate(mfgDate), [mfgDate]);
  const expDateFormatted = useMemo(() => formatLabelDate(expDate), [expDate]);

  // Fetch the CODE128 SVG. The ВкусВилл barcode is always 14 digits, and
  // LabelPreview already renders the digits as bold HTML below the bars
  // for any 14-digit code (for thermal-wear resilience). So we MUST pass
  // separateText=1 — otherwise bwip-js embeds the digits inside the SVG
  // and we get the same number printed twice (operator-reported bug).
  useEffect(() => {
    let cancelled = false;
    const url = `/api/barcode?code=${encodeURIComponent(barcode)}&separateText=1`;
    fetch(url)
      .then((r) => r.text())
      .then((svg) => {
        if (!cancelled) setBarcodeSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setBarcodeSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  /**
   * Print path — copies /print's handlePrint nearly verbatim. The route
   * is the same /api/render (image format → 1-bit PNG at 203 DPI) and
   * the print iframe is the same setup with image-rendering: pixelated.
   * Only difference: we pass `productOverride` instead of `productId`
   * so the renderer skips the DB lookup.
   *
   * ⚠ Do NOT "optimise" this back to the PDF path — the thermal printer
   * driver antialiases PDFs and produces wavy text. See CLAUDE.md and
   * the commentary in /print's handlePrint for the full story.
   */
  const handlePrint = useCallback(async () => {
    setRendering(true);
    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productOverride: renderProduct,
          mfgDate: mfgDateFormatted,
          expDate: expDateFormatted,
          format: "image",
        }),
      });
      if (!response.ok) throw new Error("Ошибка генерации изображения для печати");

      const blob = await response.blob();
      const imgUrl = window.URL.createObjectURL(blob);

      const printIframe = document.createElement("iframe");
      printIframe.style.position = "fixed";
      printIframe.style.right = "0";
      printIframe.style.bottom = "0";
      printIframe.style.width = "0";
      printIframe.style.height = "0";
      printIframe.style.border = "0";
      document.body.appendChild(printIframe);

      const cleanup = () => {
        window.URL.revokeObjectURL(imgUrl);
        if (document.body.contains(printIframe)) {
          document.body.removeChild(printIframe);
        }
      };

      const doc = printIframe.contentWindow?.document;
      if (!doc) {
        cleanup();
        throw new Error("Не удалось открыть окно печати");
      }
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Печать этикетки ВкусВилл</title>
            <style>
              @page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }
              * { margin: 0; padding: 0; }
              body {
                margin: 0;
                padding: 0;
                background: white;
                overflow: hidden;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              img {
                width: ${LABEL_WIDTH_MM}mm;
                height: ${LABEL_HEIGHT_MM}mm;
                display: block;
                image-rendering: pixelated;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
              }
            </style>
          </head>
          <body>
            <img src="${imgUrl}" />
          </body>
        </html>
      `);
      doc.close();

      const imgEl = doc.querySelector("img");
      const triggerPrint = () => {
        setTimeout(() => {
          try {
            printIframe.contentWindow?.focus();
            printIframe.contentWindow?.print();
          } catch {
            window.open(imgUrl, "_blank");
          }
          setRendering(false);
          setTimeout(cleanup, 5000);
        }, 150);
      };
      if (imgEl && !imgEl.complete) {
        imgEl.addEventListener("load", triggerPrint, { once: true });
        imgEl.addEventListener(
          "error",
          () => {
            cleanup();
            setRendering(false);
            setToast({ type: "error", message: "Ошибка загрузки изображения" });
          },
          { once: true },
        );
      } else {
        triggerPrint();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка печати.";
      setToast({ type: "error", message: msg });
      setRendering(false);
    }
  }, [renderProduct, mfgDateFormatted, expDateFormatted]);

  const handleRenderPdf = useCallback(async () => {
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productOverride: renderProduct,
          mfgDate: mfgDateFormatted,
          expDate: expDateFormatted,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Ошибка генерации PDF" }));
        throw new Error(errorData.error || "Render failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `VkusVill_${barcode}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setToast({ type: "success", message: "PDF сохранён" });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка генерации";
      setToast({ type: "error", message: msg });
    } finally {
      setRendering(false);
    }
  }, [renderProduct, mfgDateFormatted, expDateFormatted, barcode]);

  const handleSavePng = useCallback(async () => {
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productOverride: renderProduct,
          mfgDate: mfgDateFormatted,
          expDate: expDateFormatted,
          format: "image",
        }),
      });
      if (!res.ok) throw new Error("Ошибка генерации PNG");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `VkusVill_${barcode}_70x90mm_203dpi.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setToast({ type: "success", message: "PNG сохранён" });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка генерации";
      setToast({ type: "error", message: msg });
    } finally {
      setRendering(false);
    }
  }, [renderProduct, mfgDateFormatted, expDateFormatted, barcode]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">ВкусВилл</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {PRODUCT.name} · {PRODUCT.weight} · артикул {PRODUCT.sku}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* Left: just the date and the action buttons. Nothing else —
            the product never changes, so there's no picker. */}
        <div className="flex flex-col gap-4 bg-[var(--theme-overlay)] backdrop-blur-md p-5 rounded-2xl border border-[var(--theme-border)] shadow-[0_4px_12px_rgba(0,0,0,0.1)] h-fit">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--color-text-muted)]">Дата производства</span>
            <input
              type="date"
              value={mfgDateStr}
              onChange={(e) => setMfgDateStr(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-[var(--theme-input-bg)] border border-[var(--theme-border)] text-[var(--theme-text)] text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition"
            />
          </label>

          <div className="text-xs text-[var(--color-text-muted)] space-y-1.5 pt-3 border-t border-[var(--theme-border)]">
            <div className="flex justify-between gap-3">
              <span>Штрихкод</span>
              <code className="text-[var(--theme-text)] font-mono tracking-tight">{barcode}</code>
            </div>
            <div className="flex justify-between gap-3">
              <span>Годен до</span>
              <span className="text-[var(--theme-text)]">{expDateFormatted}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-3 border-t border-[var(--theme-border)]">
            <button
              onClick={handlePrint}
              disabled={rendering}
              className="py-2.5 px-4 text-[12px] font-bold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-400 hover:to-purple-400 rounded-xl shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all cursor-pointer border border-transparent disabled:opacity-50 flex items-center justify-center gap-2"
            >
              🖨 {rendering ? "Подготовка..." : "Печать"}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleRenderPdf}
                disabled={rendering}
                className="py-2 px-3 text-[11px] font-bold uppercase tracking-wide bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                ⬇ PDF
              </button>
              <button
                onClick={handleSavePng}
                disabled={rendering}
                className="py-2 px-3 text-[11px] font-bold uppercase tracking-wide bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                ⬇ PNG
              </button>
            </div>
          </div>
        </div>

        <div className="bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[var(--theme-overlay)] to-[var(--theme-input-bg)] p-6 rounded-2xl flex items-center justify-center border border-[var(--theme-border)] shadow-inner overflow-auto relative min-h-[400px]">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay pointer-events-none"></div>
          <div className="scale-[0.85] sm:scale-100 origin-center transform-gpu transition-all z-10 p-4 bg-white rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
            <div className="ring-1 ring-black/10 rounded overflow-hidden">
              <LabelPreview
                product={renderProduct}
                barcodeSvg={barcodeSvg}
                widthMm={LABEL_WIDTH_MM}
                heightMm={LABEL_HEIGHT_MM}
                scale={3}
                mfgDate={mfgDateFormatted}
                expDate={expDateFormatted}
              />
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-lg shadow-2xl z-50 text-white font-medium flex items-center gap-3 animate-fade-in ${toast.type === "error" ? "bg-red-500" : "bg-green-600"}`}>
          {toast.type === "success" ? "✅" : "⚠️"} {toast.message}
        </div>
      )}
    </div>
  );
}
