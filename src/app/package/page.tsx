"use client";

import { useEffect, useMemo, useState } from "react";
import { PACKAGE_PRODUCTS } from "@/lib/package-label";

const PRODUCT = PACKAGE_PRODUCTS[0];

function toInputFormat(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatLabelDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

export default function PackagePage() {
  const [mfgDateStr, setMfgDateStr] = useState<string>(() => toInputFormat(new Date()));
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const mfgDate = useMemo(() => new Date(mfgDateStr + "T00:00:00"), [mfgDateStr]);
  const mfgFormatted = formatLabelDate(mfgDate);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRendering(true);
      try {
        const res = await fetch("/api/render-package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: PRODUCT.id, mfgDate: mfgFormatted, format: "image" }),
        });
        if (!res.ok) throw new Error("render failed");
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      } catch (e) {
        if (!cancelled) setToast({ type: "error", message: "Ошибка рендера" });
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mfgFormatted]);

  const handlePrint = async () => {
    try {
      const res = await fetch("/api/render-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: PRODUCT.id, mfgDate: mfgFormatted, format: "image" }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "70mm";
      iframe.style.height = "90mm";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.srcdoc = `<!doctype html><html><head><style>@page{size:70mm 90mm;margin:0}body{margin:0}img{display:block;width:70mm;height:90mm;image-rendering:pixelated}</style></head><body><img src="${url}"></body></html>`;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => { document.body.removeChild(iframe); URL.revokeObjectURL(url); }, 60000);
      };
    } catch {
      setToast({ type: "error", message: "Ошибка печати" });
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const res = await fetch("/api/render-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: PRODUCT.id, mfgDate: mfgFormatted }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `package-${PRODUCT.id}-${mfgFormatted.replaceAll(".", "")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setToast({ type: "error", message: "Ошибка скачивания PDF" });
    }
  };

  return (
    <div className="min-h-screen p-6 lg:p-8 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="text-2xl font-bold text-[var(--theme-text)]">Этикетки на упаковку</div>
        <div className="text-[10px] font-bold tracking-widest px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/40 text-emerald-500">ПРОТОТИП • 70 × 90 мм</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <div className="flex flex-col gap-4 bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl p-5">
          <div className="text-[11px] font-bold tracking-wider text-[var(--theme-text-muted)] uppercase">Параметры</div>
          <div>
            <label className="text-xs text-[var(--theme-text-muted)] block mb-1">Товар</label>
            <div className="px-3 py-2 rounded-lg bg-[var(--theme-input-bg)] border border-[var(--theme-border)] text-sm font-semibold">{PRODUCT.name}</div>
          </div>
          <div>
            <label className="text-xs text-[var(--theme-text-muted)] block mb-1">Дата изготовления</label>
            <input
              type="date"
              className="input-field w-full"
              value={mfgDateStr}
              onChange={(e) => setMfgDateStr(e.target.value)}
            />
            <div className="text-[11px] text-[var(--theme-text-muted)] mt-1">На этикетке: {mfgFormatted}</div>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={handlePrint} disabled={rendering} className="flex-1 px-4 py-2 text-sm font-bold bg-indigo-500 text-white rounded-lg hover:bg-indigo-400 transition-colors disabled:opacity-50">Печать</button>
            <button onClick={handleDownloadPdf} disabled={rendering} className="flex-1 px-4 py-2 text-sm font-bold bg-cyan-500/10 text-cyan-500 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 transition-colors disabled:opacity-50">PDF</button>
          </div>
        </div>

        <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl p-5 flex flex-col gap-3">
          <div className="text-[11px] font-bold tracking-wider text-[var(--theme-text-muted)] uppercase">Превью</div>
          <div className="flex justify-center items-start bg-white border border-[var(--theme-border)] rounded-xl p-4" style={{ minHeight: 600 }}>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              // Aspect-ratio 70/90 = 0.778, фиксирую через CSS чтобы превью
              // не «вытягивалось» по высоте: img иногда отображает с
              // природной шириной 559 px и не уважает height:auto в flex.
              <img
                src={previewUrl}
                alt="package preview"
                style={{
                  width: "300px",
                  aspectRatio: `${70} / ${90}`,
                  height: "auto",
                  objectFit: "contain",
                  display: "block",
                  imageRendering: "pixelated",
                  border: "1px solid #ccc",
                }}
              />
            ) : (
              <div className="text-[var(--theme-text-muted)] text-sm">{rendering ? "Рендерим…" : "Нет данных"}</div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl text-sm font-bold shadow-lg ${toast.type === "success" ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}`}>{toast.message}</div>
      )}
    </div>
  );
}
