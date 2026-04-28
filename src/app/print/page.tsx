"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import LabelPreview from "@/components/LabelPreview";

const FolderIcon = ({ className = "w-5 h-5 inline-block" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
    <defs>
      <linearGradient id="folderGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#FDE68A" />
        <stop offset="100%" stopColor="#F59E0B" />
      </linearGradient>
      <linearGradient id="folderBackGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#FBBF24" />
        <stop offset="100%" stopColor="#D97706" />
      </linearGradient>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.2"/>
      </filter>
    </defs>
    <path d="M4 4C2.89543 4 2 4.89543 2 6V18C2 19.1046 2.89543 20 4 20H20C21.1046 20 22 19.1046 22 18V8.5C22 7.39543 21.1046 6.5 20 6.5H11.5858C11.3206 6.5 11.0663 6.39464 10.8787 6.20711L9.12132 4.45005C8.93378 4.26251 8.67946 4.15715 8.41421 4.15715H4Z" fill="url(#folderBackGrad)" />
    <path filter="url(#shadow)" d="M2.5 9C2.22386 9 2 9.22386 2 9.5V18C2 19.1046 2.89543 20 4 20H20C21.1046 20 22 19.1046 22 18V10.5C22 10.2239 21.7761 10 21.5 10H10C9 10 9.5 9 8.5 9H2.5Z" fill="url(#folderGrad)" />
  </svg>
);

const LabelItemIcon = ({ className = "w-5 h-5 inline-block" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01" className="text-emerald-500" fill="currentColor" fillOpacity="0.1"/>
  </svg>
);

const BackFolderIcon = ({ className = "w-5 h-5 inline-block text-indigo-400" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
  </svg>
);

interface Product {
  id: string;
  sku: string | null;
  sku2: string | null;
  name: string;
  composition: string | null;
  weight: string | null;
  nutritionalInfo: string | null;
  storageCond: string | null;
  barcodeEan13: string | null;
  category: string | null;
  btwFilePath: string | null;
  certCode: string | null;
  quantity: string | null;
  boxWeight: string | null;
  sponsorText: string | null;
  manufacturer: string | null;
  updatedAt?: string;
  template?: {
    widthMm: number;
    heightMm: number;
  } | null;
}

/** Format Date to dd.MM.yyyy */
function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Format Date to yyyy-MM-dd for <input type="date"> */
function toInputDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function parseShelfLifeMonths(storageCond: string | null): number {
  if (!storageCond) return 12;
  const match = storageCond.match(/(\d+)\s*месяц/i);
  if (match) return parseInt(match[1], 10);
  return 12;
}

export default function PrintPage() {
  const [query, setQuery] = useState("");
  const [currentPath, _setCurrentPath] = useState<string>("");

  const setCurrentPath = useCallback((newPath: string | ((prev: string) => string)) => {
    _setCurrentPath((prev) => {
      const nextPath = typeof newPath === "function" ? newPath(prev) : newPath;
      if (typeof window !== "undefined") {
        const newHash = nextPath ? `#${encodeURIComponent(nextPath)}` : "";
        queueMicrotask(() => {
          if (window.location.hash === newHash) return;
          const url = newHash ? newHash : window.location.pathname + window.location.search;
          window.history.pushState(null, "", url);
        });
      }
      return nextPath;
    });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash.replace(/^#/, "");
      _setCurrentPath(decodeURIComponent(hash));
    };
    if (window.location.hash) {
      onPopState();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderProducts, setFolderProducts] = useState<Product[]>([]);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const activeResultRef = useRef<HTMLButtonElement>(null);

  const [selected, setSelected] = useState<Product | null>(null);
  const [barcodeSvg, setBarcodeSvg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [mfgDateStr, setMfgDateStr] = useState("");
  const labelRef = useRef<HTMLDivElement>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [createForm, setCreateForm] = useState<Partial<Product>>({});
  const [creatingItem, setCreatingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);

  // Move state
  const [isMovingFile, setIsMovingFile] = useState(false);
  const [allFoldersList, setAllFoldersList] = useState<string[]>([]);
  const [moveSearchQuery, setMoveSearchQuery] = useState("");
  const [movingItemUrl, setMovingItemUrl] = useState(false);

  // Duplicate state — same folder picker pattern as Move, but creates a copy
  // instead of mutating btwFilePath in place. Operators use this to seed the
  // same product into a different folder so they only have to change the SKU.
  const [isDuplicatingFile, setIsDuplicatingFile] = useState(false);
  const [duplicateSearchQuery, setDuplicateSearchQuery] = useState("");
  const [duplicatingItem, setDuplicatingItem] = useState(false);

  const basePrefix = 'C:\\Users\\Пользователь\\Desktop\\extracted_labels\\';

  useEffect(() => {
    setMfgDateStr(toInputDate(new Date()));
  }, []);

  const { mfgDateFormatted, expDateFormatted } = useMemo(() => {
    if (!mfgDateStr) return { mfgDateFormatted: "...", expDateFormatted: "..." };
    const mfg = new Date(mfgDateStr + "T00:00:00");
    const months = parseShelfLifeMonths(selected?.storageCond ?? null);
    const exp = new Date(mfg);
    exp.setMonth(exp.getMonth() + months);
    return {
      mfgDateFormatted: formatDate(mfg),
      expDateFormatted: formatDate(exp),
    };
  }, [mfgDateStr, selected?.storageCond]);

  const loadFolderData = () => {
    setLoading(true);
    fetch(`/api/folders?prefix=${encodeURIComponent(currentPath)}`)
      .then((r) => r.json())
      .then((data) => {
        setFolders(data.folders || []);
        setFolderProducts(data.files || []);
      })
      .finally(() => setLoading(false));
  };

  // Load folders and files based on current path
  useEffect(() => {
    loadFolderData();
  }, [currentPath]);

  // Handle Global Search — debounced, race-safe
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchTotal(0);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(trimmed)}&limit=20`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setSearchResults(data.products || []);
          setSearchTotal(data.total || 0);
          setSearchActiveIdx(0);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close search dropdown on outside click / Escape
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [searchOpen]);

  // Keep highlighted row in view
  useEffect(() => {
    if (searchOpen && activeResultRef.current) {
      activeResultRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [searchActiveIdx, searchOpen]);

  // Load barcode when product selected
  useEffect(() => {
    if (!selected?.barcodeEan13) {
      setBarcodeSvg("");
      return;
    }
    fetch(`/api/barcode?code=${selected.barcodeEan13}`)
      .then((r) => r.text())
      .then(setBarcodeSvg)
      .catch(() => setBarcodeSvg(""));
  }, [selected]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Select Item & Reset edit mode
  const handleSelect = (prod: Product) => {
    setSelected(prod);
    setIsEditing(false);
    setQuery("");
    setSearchOpen(false);
    setSearchResults([]);
    setSearchActiveIdx(0);
  };

  // Highlight matched substring in search results (case-insensitive)
  const highlight = (text: string | null, q: string): React.ReactNode => {
    if (!text) return text;
    const needle = q.trim();
    if (!needle) return text;
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-indigo-500/30 text-[var(--theme-text)] rounded px-0.5">
          {text.slice(idx, idx + needle.length)}
        </mark>
        {text.slice(idx + needle.length)}
      </>
    );
  };

  const handlePrint = useCallback(async () => {
    if (!selected) return;

    setRendering(true);

    try {
      // ⚠ PRINT MUST USE THE IMAGE PATH, NOT PDF.
      //
      // The image path returns a 1-bit-equivalent PNG sized to exactly
      // 559×720 (= 70×90 mm at 203 DPI), pre-thresholded by sharp so the
      // bitmap maps pixel-for-pixel onto the Zebra/Xprinter thermal head.
      // The browser's print dialog passes the PNG straight to the printer
      // driver, which sends it to the head with no resampling or
      // antialiasing.
      //
      // The PDF path was tried once (commit 64c8985) "because it's 3×
      // faster": the printer driver then rasterized the PDF on its own,
      // introduced antialiasing, and produced visibly wavy text and grey
      // dithered blocks on the thermal output ("волнистый и не читаемый
      // текст" — operators reported this twice). PDF is fine for download
      // / preview, NOT for the physical printer. Do not "optimise" this
      // back to the PDF path.
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selected.id,
          mfgDate: mfgDateFormatted,
          expDate: expDateFormatted,
          format: "image",
        }),
      });

      if (!response.ok) throw new Error("Ошибка генерации изображения для печати");

      const blob = await response.blob();
      const imgUrl = window.URL.createObjectURL(blob);

      // Physical label size in mm (template-defined; default 70×90).
      // Forced portrait — the print pipeline always renders portrait, so
      // we mirror that here for @page.
      let wMm = selected.template?.widthMm ?? 70;
      let hMm = selected.template?.heightMm ?? 90;
      if (wMm > hMm) { const t = wMm; wMm = hMm; hMm = t; }

      // Hidden iframe whose body is just the bitmap, sized in mm so the
      // print dialog has nothing to scale. image-rendering: pixelated
      // tells the browser NOT to interpolate the bitmap when displaying
      // it (CSS px ≠ device px on Hi-DPI screens) — without this the
      // print preview looks blurry, even though the bytes that go to
      // the printer are crisp.
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
            <title>Печать этикетки</title>
            <style>
              @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
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
                width: ${wMm}mm;
                height: ${hMm}mm;
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
        // Small delay so layout settles before the print dialog opens.
        setTimeout(() => {
          try {
            printIframe.contentWindow?.focus();
            printIframe.contentWindow?.print();
          } catch {
            window.open(imgUrl, "_blank");
          }
          setRendering(false);
          // Keep the blob alive long enough for the print dialog.
          setTimeout(cleanup, 5000);
        }, 150);
      };
      if (imgEl && !imgEl.complete) {
        imgEl.addEventListener("load", triggerPrint, { once: true });
        imgEl.addEventListener("error", () => {
          cleanup();
          setRendering(false);
          setToast({ type: "error", message: "Ошибка загрузки изображения" });
        }, { once: true });
      } else {
        triggerPrint();
      }
    } catch (e: any) {
      setToast({ type: "error", message: e.message || "Ошибка печати." });
      setRendering(false);
    }
  }, [selected, mfgDateFormatted, expDateFormatted]);

  const handleRenderPdf = async () => {
    if (!selected) return;
    setRendering(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selected.id,
          mfgDate: mfgDateFormatted,
          expDate: expDateFormatted,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Ошибка генерации PDF' }));
        throw new Error(errorData.error || 'Render failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement("a");
      a.href = url;
      a.download = `etiq-rezograf-${selected.sku || selected.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setToast({ message: "PDF сохранен!", type: "success" });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err: any) {
      setToast({ message: err.message || "Ошибка генерации", type: "error" });
    } finally {
      setRendering(false);
    }
  };

  const startEdit = () => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      sku: selected.sku || "",
      sku2: selected.sku2 || "",
      weight: selected.weight || "",
      barcodeEan13: selected.barcodeEan13 || "",
      nutritionalInfo: selected.nutritionalInfo || "",
      storageCond: selected.storageCond || "",
      composition: selected.composition || "",
    });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, ...editForm }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setSelected(updated);
      setIsEditing(false);
      setToast({ message: "Изменения сохранены", type: "success" });
      
      // Update list silently
      setFolderProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
    } catch (err: any) {
      setToast({ message: "Ошибка сохранения", type: "error" });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingItem(true);
    try {
      const safeName = newFolderName.trim().replace(/[\\/]/g, ""); // strip slashes
      const newPath = currentPath ? `${currentPath}\\${safeName}` : safeName;
      
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "_folder_marker",
          category: currentPath,
          btwFilePath: `${basePrefix}${newPath}\\.folder`
        })
      });
      if (!res.ok) throw new Error("Failed to create folder");
      
      setToast({ message: "Папка создана", type: "success" });
      setIsCreatingFolder(false);
      setNewFolderName("");
      loadFolderData(); // refresh explorer
    } catch (err) {
      setToast({ message: "Ошибка создания папки", type: "error" });
    } finally {
      setCreatingItem(false);
    }
  };

  const handleCreateLabel = async () => {
    if (!createForm.name) {
      setToast({ message: "Укажите название этикетки", type: "error" });
      return;
    }
    setCreatingItem(true);
    try {
      const safeName = createForm.name.trim().replace(/[\\/]/g, "_");
      const subPath = currentPath ? `${currentPath}\\${safeName}.btw` : `${safeName}.btw`;

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createForm,
          category: currentPath,
          btwFilePath: `${basePrefix}${subPath}`
        })
      });
      if (!res.ok) throw new Error("Failed to create label");
      const createdItem = await res.json();
      
      setToast({ message: "Этикетка создана", type: "success" });
      setIsCreatingLabel(false);
      setCreateForm({});
      loadFolderData(); // refresh explorer
      handleSelect(createdItem); // select the newly created label
    } catch (err) {
      setToast({ message: "Ошибка создания этикетки", type: "error" });
    } finally {
      setCreatingItem(false);
    }
  };

  const openMoveFolder = async () => {
    setIsMovingFile(true);
    setMoveSearchQuery("");
    setAllFoldersList([]);
    try {
      const res = await fetch("/api/folders?fetchAllPaths=true");
      if(res.ok) {
        const data = await res.json();
        setAllFoldersList(data.folders || []);
      }
    } catch(err) {
      setToast({ message: "Ошибка загрузки папок", type: "error" });
    }
  };

  const handleMoveFile = async (targetPath: string) => {
    if (!selected) return;
    setMovingItemUrl(true);
    try {
      // Find filename
      let fileName = selected.name + ".btw";
      if (selected.btwFilePath) {
        const parts = selected.btwFilePath.split(/[/\\]/);
        const lastPart = parts[parts.length - 1];
        if (lastPart) fileName = lastPart;
      }
      
      const newPath = targetPath ? `${targetPath}\\${fileName}` : fileName;
      const newBtwFilePath = `${basePrefix}${newPath}`;
      
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          category: targetPath, // update category too
          btwFilePath: newBtwFilePath
        })
      });
      if (!res.ok) throw new Error("Failed to move");
      
      const updated = await res.json();
      setSelected(updated);
      setToast({ message: "Файл успешно перемещён!", type: "success" });
      setIsMovingFile(false);
      loadFolderData(); // refresh explorer
    } catch (err) {
       setToast({ message: "Ошибка перемещения", type: "error" });
    } finally {
       setMovingItemUrl(false);
    }
  };

  const openDuplicateFolder = async () => {
    setIsDuplicatingFile(true);
    setDuplicateSearchQuery("");
    setAllFoldersList([]);
    try {
      const res = await fetch("/api/folders?fetchAllPaths=true");
      if (res.ok) {
        const data = await res.json();
        setAllFoldersList(data.folders || []);
      }
    } catch (err) {
      setToast({ message: "Ошибка загрузки папок", type: "error" });
    }
  };

  const handleDuplicateFile = async (targetPath: string) => {
    if (!selected) return;
    setDuplicatingItem(true);
    try {
      const res = await fetch("/api/products/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, targetFolder: targetPath }),
      });
      if (!res.ok) throw new Error("Failed to duplicate");
      const created = await res.json();

      setToast({ message: "Дубликат создан", type: "success" });
      setIsDuplicatingFile(false);

      // Jump to the destination folder so the operator immediately sees the
      // new copy in the file list, then select it for editing.
      setCurrentPath(targetPath);
      handleSelect(created);
      setIsEditing(true);
      setEditForm(created);
    } catch (err) {
      setToast({ message: "Ошибка дублирования", type: "error" });
    } finally {
      setDuplicatingItem(false);
    }
  };

  const handleDropMove = async (product: Product, targetPath: string) => {
    if (!product) return;
    setMovingItemUrl(true);
    try {
      let fileName = product.name + ".btw";
      if (product.btwFilePath) {
        const parts = product.btwFilePath.split(/[/\\]/);
        fileName = parts[parts.length - 1] || fileName;
      }
      
      const newPath = targetPath ? `${targetPath}\\${fileName}` : fileName;
      const newBtwFilePath = `${basePrefix}${newPath}`;
      
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: product.id,
          category: targetPath,
          btwFilePath: newBtwFilePath
        })
      });
      if (!res.ok) throw new Error("Failed to move");
      
      const updated = await res.json();
      if (selected?.id === updated.id) setSelected(updated);
      setToast({ message: "Файл успешно перемещён!", type: "success" });
      loadFolderData();
    } catch (err) {
       setToast({ message: "Ошибка перемещения", type: "error" });
    } finally {
       setMovingItemUrl(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!selected) return;
    
    setDeletingItem(true);
    try {
      const res = await fetch(`/api/products?id=${selected.id}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Failed to delete");
      
      setToast({ message: "Этикетка удалена", type: "success" });
      setSelected(null);
      loadFolderData();
    } catch (err) {
      setToast({ message: "Ошибка удаления", type: "error" });
    } finally {
      setDeletingItem(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!currentPath) return;
    setDeletingItem(true);
    try {
      const res = await fetch(`/api/folders?path=${encodeURIComponent(currentPath)}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Failed to delete folder");
      
      setToast({ message: "Папка успешно удалена", type: "success" });
      const parts = currentPath.split(/[/\\]/).filter(Boolean);
      parts.pop();
      setCurrentPath(parts.join('\\'));
      loadFolderData();
    } catch (err) {
      setToast({ message: "Ошибка удаления папки", type: "error" });
    } finally {
      setDeletingItem(false);
    }
  };

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col bg-[var(--theme-workspace)] text-[var(--theme-text)] rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden border border-[var(--theme-border)] relative">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] pointer-events-none"></div>
      
      {/* Top Bar Navigation & Search */}
      <div className="flex z-50 items-center justify-between px-6 py-5 bg-[var(--color-surface-panel)]/80 backdrop-blur-xl border-b border-[var(--theme-border)] shadow-[0_4px_24px_rgba(0,0,0,0.1)] relative shrink-0">
        <div className="flex items-center gap-4 flex-1">
          <div className="text-xl font-bold bg-gradient-to-r from-indigo-500 to-cyan-500 bg-clip-text text-transparent mr-4 cursor-pointer drop-shadow-sm" onClick={() => { setCurrentPath(""); setSelected(null); }}>
            Rezograf
          </div>
          
          {/* Breadcrumbs */}
          <div className="flex items-center text-sm font-medium text-[var(--theme-text)] bg-[var(--theme-input-bg)] rounded-xl px-5 py-2.5 border border-[var(--theme-border)] overflow-x-auto max-w-[500px] shadow-inner">
            <button className="hover:text-indigo-500 transition-colors whitespace-nowrap" onClick={() => setCurrentPath("")}>Все папки</button>
            {currentPath.split(/[/\\]/).filter(Boolean).map((part, idx, arr) => {
              const pathSoFar = arr.slice(0, idx + 1).join('\\');
              return (
                <span key={pathSoFar} className="flex items-center whitespace-nowrap">
                  <span className="mx-2 text-[var(--theme-text-muted)]">/</span>
                  <button 
                    className="hover:text-indigo-500 transition-colors cursor-pointer"
                    onClick={() => setCurrentPath(pathSoFar)}
                  >
                    {idx === arr.length - 1 ? <><FolderIcon className="w-3.5 h-3.5 inline mr-1"/>{part}</> : part}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        {/* Global Search Component */}
        <div ref={searchBoxRef} className="relative w-[400px]">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-indigo-400/70" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35" /><circle cx="11" cy="11" r="8" /></svg>
          </div>
          <input
            ref={searchInputRef}
            type="text"
            className="input-field pl-11 pr-10 py-2.5 sm:text-sm w-full"
            placeholder="Поиск по названию, артикулу, штрихкоду..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (query) { setQuery(""); }
                else { setSearchOpen(false); searchInputRef.current?.blur(); }
                return;
              }
              if (!searchOpen || searchResults.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSearchActiveIdx((i) => Math.min(i + 1, searchResults.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSearchActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const pick = searchResults[searchActiveIdx];
                if (pick) handleSelect(pick);
              }
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] transition-colors"
              aria-label="Очистить"
            >
              {searchLoading ? (
                <span className="spinner w-3.5 h-3.5 border-2 inline-block" />
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              )}
            </button>
          )}

          {/* Search Dropdown — solid fill, aligned to input */}
          {searchOpen && query.trim().length > 0 && (
            <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-[var(--color-surface-panel)] border border-[var(--theme-border)] shadow-2xl rounded-2xl overflow-hidden z-[100] max-h-[60vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-3 bg-[var(--theme-overlay)] border-b border-[var(--theme-border)] shrink-0">
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">Результаты поиска</span>
                {!searchLoading && searchResults.length > 0 && (
                  <span className="text-[10px] font-medium text-[var(--theme-text-muted)] tabular-nums">
                    {searchResults.length}{searchTotal > searchResults.length ? ` из ${searchTotal}` : ""}
                  </span>
                )}
              </div>
              <div className="overflow-y-auto w-full flex-1 min-h-0 custom-scrollbar">
                {searchLoading && searchResults.length === 0 ? (
                  <div className="p-6 text-center text-[var(--theme-text-muted)] text-sm">Поиск…</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-6 text-center text-[var(--theme-text-muted)] text-sm">Ничего не найдено</div>
                ) : (
                  searchResults.map((p, i) => {
                    const isActive = i === searchActiveIdx;
                    const fileName = p.btwFilePath?.split(/[/\\]/).pop()?.replace(/\.btw$/i, "") || "";
                    return (
                      <button
                        key={p.id}
                        ref={isActive ? activeResultRef : null}
                        onClick={() => handleSelect(p)}
                        onMouseEnter={() => setSearchActiveIdx(i)}
                        className={`w-full text-left px-5 py-3 border-b border-[var(--theme-border)] last:border-b-0 transition-colors flex flex-col gap-1 cursor-pointer ${isActive ? "bg-[var(--theme-overlay-hover)]" : "hover:bg-[var(--theme-overlay)]"}`}
                      >
                        <div className="font-semibold text-[var(--theme-text)] text-sm leading-snug">
                          {highlight(p.name, query)}
                        </div>
                        <div className="text-[11px] text-[var(--theme-text-muted)] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="flex items-center gap-1 text-indigo-500/90">
                            <FolderIcon className="w-3 h-3" /> {p.category || "Без папки"}
                          </span>
                          {fileName && <span className="opacity-70">{fileName}</span>}
                          {p.sku && <span>Арт: {highlight(p.sku, query)}</span>}
                          {p.barcodeEan13 && <span>ШК: {highlight(p.barcodeEan13, query)}</span>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {searchResults.length > 0 && (
                <div className="px-5 py-2 text-[10px] text-[var(--theme-text-muted)] border-t border-[var(--theme-border)] flex gap-4 bg-[var(--theme-overlay)] shrink-0">
                  <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--theme-overlay-hover)] font-mono">↑↓</kbd> навигация</span>
                  <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--theme-overlay-hover)] font-mono">Enter</kbd> выбрать</span>
                  <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--theme-overlay-hover)] font-mono">Esc</kbd> закрыть</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative z-10 w-full">
        
        {/* Left pane: Explorer Table */}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[var(--theme-overlay)] m-4 mr-2 rounded-2xl border border-[var(--theme-border)] flex flex-col relative backdrop-blur-md shadow-inner">
          <div className="px-5 py-3 border-b border-[var(--theme-border)] flex gap-3 text-sm bg-[var(--color-surface-panel)]/80 sticky top-0 z-20 backdrop-blur-xl">
            <button onClick={() => { setIsCreatingLabel(true); setCreateForm({}); }} className="py-2 px-4 shadow-[0_0_15px_rgba(99,102,241,0.2)] text-[11.5px] font-bold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-400 hover:to-indigo-500 rounded-xl transition-all border border-indigo-400/50 cursor-pointer flex items-center gap-2">
              ➕ Создать этикетку
            </button>
            <button onClick={() => setIsCreatingFolder(true)} className="py-2 px-4 text-[11px] font-bold uppercase tracking-wide bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] rounded-xl shadow-sm transition-all border border-[var(--theme-border)] cursor-pointer flex items-center gap-2">
              <FolderIcon className="w-3.5 h-3.5 mr-1" /> Создать папку
            </button>
          </div>
          <table className="w-full table-fixed divide-y divide-[var(--theme-border)] text-sm">
            <thead className="bg-[var(--color-surface-panel)]/95 sticky top-[53px] z-10 backdrop-blur-xl border-b border-[var(--theme-border)]">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-[var(--theme-text-muted)] uppercase tracking-widest w-[70%]">Имя</th>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-[var(--theme-text-muted)] uppercase tracking-widest w-[30%] truncate">Артикул</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--theme-border)]">
              
              {currentPath !== "" && (
                <tr 
                  onDoubleClick={() => {
                     const parts = currentPath.split(/[/\\]/).filter(Boolean);
                     parts.pop();
                     setCurrentPath(parts.join('\\'));
                  }} 
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-indigo-500/20"); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove("bg-indigo-500/20")}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("bg-indigo-500/20");
                    const data = e.dataTransfer.getData("application/json");
                    if (data) {
                      const parts = currentPath.split(/[/\\]/).filter(Boolean);
                      parts.pop();
                      handleDropMove(JSON.parse(data), parts.join('\\'));
                    }
                  }}
                  className="hover:bg-[var(--theme-overlay)] cursor-pointer transition-colors group select-none"
                >
                  <td colSpan={2} className="px-5 py-2 font-semibold text-indigo-400 group-hover:text-indigo-300">
                    <span className="mr-3 opacity-80 inline-flex items-center"><BackFolderIcon className="w-5 h-5"/></span> На уровень вверх
                  </td>
                </tr>
              )}

              {loading && (
                <tr><td colSpan={2} className="p-10 text-center"><div className="spinner mx-auto" /></td></tr>
              )}

              {/* Folders */}
              {!loading && folders.map(f => (
                <tr 
                  key={f} 
                  onDoubleClick={() => setCurrentPath(currentPath ? currentPath + '\\' + f : f)}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("bg-indigo-500/20"); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove("bg-indigo-500/20")}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("bg-indigo-500/20");
                    const data = e.dataTransfer.getData("application/json");
                    if (data) {
                      handleDropMove(JSON.parse(data), currentPath ? currentPath + '\\' + f : f);
                    }
                  }}
                  className="hover:bg-[var(--theme-overlay)] cursor-pointer transition-colors select-none"
                >
                  <td className="px-5 py-2 overflow-hidden">
                    <div className="flex items-center gap-3">
                      <FolderIcon className="w-[20px] h-[20px] shrink-0 filter drop-shadow opacity-90"/>
                      <span className="font-medium text-[var(--theme-text)] truncate block w-full leading-relaxed">
                        {f}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-2 text-[var(--theme-text-muted)]">—</td>
                </tr>
              ))}

              {/* Files */}
              {!loading && folderProducts.map(fp => (
                <tr 
                  key={fp.id} 
                  onDoubleClick={() => handleSelect(fp)} 
                  draggable={true}
                  onDragStart={(e) => {
                     e.dataTransfer.setData("application/json", JSON.stringify(fp));
                     e.dataTransfer.effectAllowed = "move";
                  }}
                  className={`hover:bg-[var(--theme-overlay)] cursor-pointer transition-colors select-none ${selected?.id === fp.id ? 'bg-indigo-500/10 border-l-[3px] border-indigo-400 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]' : 'border-l-[3px] border-transparent'}`}
                >
                  <td className="px-5 py-2 overflow-hidden">
                    <div className="flex items-center gap-3">
                      <LabelItemIcon className="w-[18px] h-[18px] text-emerald-500 shadow-sm shrink-0"/>
                      <span className="font-semibold text-[var(--theme-text)] truncate block w-full leading-relaxed">
                        {fp.btwFilePath ? fp.btwFilePath.split(/[/\\]/).pop()?.replace('.btw', '') : fp.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-2 whitespace-nowrap overflow-hidden text-ellipsis">
                    {fp.sku ? <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] font-bold tracking-widest">{fp.sku}</span> : <span className="text-[var(--theme-text-muted)]">—</span>}
                  </td>
                </tr>
              ))}
              
              {!loading && folders.length === 0 && folderProducts.length === 0 && (
                 <tr><td colSpan={2} className="p-10 text-center text-[var(--theme-text-muted)]">Папка пуста</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Right pane: Preview & Edit */}
        <div className="w-[340px] md:w-[400px] xl:w-[480px] overflow-y-auto bg-[var(--color-surface)] flex-none border-l border-[var(--theme-border)] flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.1)] shrink-0 relative bg-[radial-gradient(var(--theme-overlay)_1px,transparent_1px)] [background-size:16px_16px] backdrop-blur-xl z-20">
          {selected ? (
            <div className="animate-fade-in p-5 xl:p-6 max-w-full">
              
              {/* Toolbar */}
              <div className="flex justify-between items-center mb-6 bg-[var(--theme-overlay)] backdrop-blur-md p-3.5 rounded-xl border border-[var(--theme-border)] shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
                <div className="text-[11px] font-bold tracking-wider text-indigo-500 uppercase flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> 
                  Инспектор
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!isEditing ? (
                    <>
                      {selected.category && selected.category !== currentPath && (
                        <button 
                          onClick={() => {
                            setCurrentPath(selected.category!);
                          }}
                          className="py-1.5 px-3 text-[11px] font-bold tracking-wide uppercase bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                          title={`Перейти к списку файлов в папке: ${selected.category}`}
                        >
                          📂 К товару
                        </button>
                      )}
                      <button onClick={openMoveFolder} className="py-1.5 px-3 text-[11px] font-bold tracking-wide uppercase bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-indigo-500/20 cursor-pointer flex items-center gap-1.5">
                        📦 Переместить
                      </button>
                      <button onClick={openDuplicateFolder} className="py-1.5 px-3 text-[11px] font-bold tracking-wide uppercase bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-cyan-500/20 cursor-pointer flex items-center gap-1.5">
                        📋 Дублировать
                      </button>
                      <button onClick={handleDeleteFile} disabled={deletingItem} className="py-1.5 px-3 text-[11px] font-bold tracking-wide uppercase bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
                        🗑️ Удалить
                      </button>
                      <button onClick={startEdit} className="py-1.5 px-3 text-[11px] font-bold tracking-wide uppercase bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-indigo-500/20 cursor-pointer flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Редактировать
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-overlay)] rounded-lg transition-colors cursor-pointer border border-transparent">Отмена</button>
                      <button onClick={saveEdit} disabled={savingEdit} className="py-1.5 px-4 text-[11px] font-bold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-400 hover:to-purple-400 rounded-lg shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all cursor-pointer border border-transparent disabled:opacity-50 flex items-center gap-1">
                        {savingEdit ? "Сохранение..." : "💾 Сохранить"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Edit / Details Form */}
              <div className="glass-card overflow-hidden mb-6">
                <div className="bg-[var(--theme-overlay)] border-b border-[var(--theme-border)] px-5 py-3 font-bold text-[10px] text-[var(--theme-text-muted)] uppercase tracking-widest flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div> Данные {isEditing && <span className="text-indigo-500">(Режим редактирования)</span>}
                </div>
                <div className="p-5 flex flex-col gap-4 text-sm text-[var(--theme-text)]">
                  {isEditing ? (
                    <>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Название</label><input type="text" className="input-field" value={editForm.name || ""} onChange={e => setEditForm({...editForm, name: e.target.value})} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Артикул</label><input type="text" className="input-field" value={editForm.sku || ""} onChange={e => setEditForm({...editForm, sku: e.target.value})} /></div>
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Артикул 2 <span className="text-[10px] font-normal opacity-60">(для сетей)</span></label><input type="text" className="input-field" value={editForm.sku2 || ""} onChange={e => setEditForm({...editForm, sku2: e.target.value})} /></div>
                      </div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Штрихкод</label><input type="text" className="input-field" value={editForm.barcodeEan13 || ""} onChange={e => setEditForm({...editForm, barcodeEan13: e.target.value})} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Масса (в тексте)</label><input type="text" className="input-field" value={editForm.weight || ""} onChange={e => setEditForm({...editForm, weight: e.target.value})} /></div>
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Хранение</label><input type="text" className="input-field" value={editForm.storageCond || ""} onChange={e => setEditForm({...editForm, storageCond: e.target.value})} /></div>
                      </div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Стандарт (СТО/ГОСТ)</label><input type="text" className="input-field" value={editForm.certCode || ""} onChange={e => setEditForm({...editForm, certCode: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">КБЖУ</label><textarea className="input-field min-h-[60px]" value={editForm.nutritionalInfo || ""} onChange={e => setEditForm({...editForm, nutritionalInfo: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Состав</label><textarea className="input-field min-h-[80px]" value={editForm.composition || ""} onChange={e => setEditForm({...editForm, composition: e.target.value})} /></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5"><span className="text-[var(--theme-text-muted)] text-xs mt-1">Оригинал</span><span className="font-mono text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 text-[11px] truncate max-w-[250px]" title={selected.btwFilePath || ""}>{selected.btwFilePath || "—"}</span></div>
                      <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mt-1">Артикул{selected.sku2 ? " / Артикул 2" : ""}</span><span className="font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded tracking-widest text-[11px]">{[selected.sku, selected.sku2].filter(Boolean).join(" / ") || "—"}</span></div>
                      <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mt-1">Штрихкод</span><span className="font-mono text-[var(--theme-text)] bg-[var(--theme-overlay)] border border-[var(--theme-border)] px-2 py-0.5 rounded tracking-wider text-[11px]">{selected.barcodeEan13 || "—"}</span></div>
                      <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">Масса</span><span className="font-semibold text-[var(--theme-text)]">{selected.weight || "—"}</span></div>
                      <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">Стандарт</span><span className="font-semibold text-[var(--theme-text)] leading-none mt-0.5">{selected.certCode || "—"}</span></div>
                      <div className="flex flex-col border-b border-[var(--theme-border)] pb-3 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">Срок и условия </span><span className="text-xs text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)]">{selected.storageCond || "—"}</span></div>
                      <div className="flex flex-col border-b border-[var(--theme-border)] pb-3 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">Состав</span><span className="text-xs text-justify text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)] whitespace-pre-wrap">{selected.composition || "—"}</span></div>
                      <div className="flex flex-col pb-1 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">КБЖУ</span><span className="text-xs text-justify text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)]">{selected.nutritionalInfo || "—"}</span></div>
                    </>
                  )}
                </div>
              </div>

              {/* Action Board (Print Prep) */}
              <div className="glass-card overflow-hidden mb-6">
                <div className="bg-[var(--theme-overlay)] border-b border-[var(--theme-border)] px-5 py-3 font-bold text-[10px] text-[var(--theme-text-muted)] uppercase tracking-widest flex items-center justify-between">
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div> Подготовка к печати</div>
                  <div className="text-[10px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">70×90 мм</div>
                </div>
                <div className="p-5 flex flex-col gap-5">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-[var(--theme-text-muted)] mb-1.5 tracking-wider">ДАТА ИЗГОТОВЛЕНИЯ</label>
                      <input type="date" value={mfgDateStr} onChange={e => setMfgDateStr(e.target.value)} className="w-full bg-[var(--theme-input-bg)] text-[var(--theme-text)] border border-[var(--theme-border)] p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none font-mono cursor-pointer transition-all" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-[var(--theme-text-muted)] mb-1.5 tracking-wider">ГОДЕН ДО</label>
                      <div className="w-full bg-[var(--theme-input-bg)] border border-[var(--theme-border)] p-2.5 rounded-xl text-sm font-mono text-[var(--theme-text)] flex items-center shadow-inner">
                        <span className="text-cyan-500">{expDateFormatted}</span> <span className="ml-auto font-sans font-medium text-[11px] text-[var(--theme-text-muted)] bg-[var(--theme-overlay)] border border-[var(--theme-border)] px-2 rounded-md py-0.5">{parseShelfLifeMonths(selected.storageCond)} мес</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[var(--theme-overlay)] to-[var(--theme-input-bg)] p-6 rounded-2xl flex items-center justify-center border border-[var(--theme-border)] shadow-inner mt-2 overflow-hidden overflow-x-auto relative min-h-[300px]">
                     <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>
                     <div ref={labelRef} className="scale-[0.8] sm:scale-90 origin-center transform-gpu transition-all z-10 p-4 bg-white rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
                      <div className="ring-1 ring-black/10 rounded overflow-hidden">
                        <LabelPreview
                          product={selected}
                          barcodeSvg={barcodeSvg}
                          widthMm={70}
                          heightMm={90}
                          scale={3}
                          mfgDate={mfgDateFormatted}
                          expDate={expDateFormatted}
                        />
                      </div>
                     </div>
                  </div>

                  <div className="flex gap-3 mt-2">
                    <button 
                      onClick={handlePrint}
                      disabled={rendering}
                      className="flex-1 py-3.5 bg-[var(--theme-overlay)] text-[var(--theme-text)] border border-[var(--theme-border)] font-bold rounded-xl hover:bg-[var(--theme-overlay-hover)] transition-all outline-none cursor-pointer flex items-center justify-center gap-2 text-sm shadow-sm disabled:opacity-50"
                    >
                      {rendering ? <div className="spinner border-white" /> : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 opacity-80">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 7.5H5.25" />
                          </svg>
                          Печать
                        </>
                      )}
                    </button>
                    <button 
                      onClick={handleRenderPdf} 
                      disabled={rendering}
                      className="flex-1 py-3.5 btn-glow font-bold rounded-xl outline-none cursor-pointer border-none flex items-center justify-center gap-2 text-xs sm:text-[13px]"
                    >
                      {rendering ? <div className="spinner border-white" /> : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5 hidden xl:block opacity-90">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                          PDF для того чтобы открыть в BarTender
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-center p-10 flex-col animate-fade-in">
              <div className="flex items-center justify-center w-24 h-24 rounded-3xl bg-[var(--theme-overlay)] border border-[var(--theme-border)] shadow-[0_0_40px_rgba(139,92,246,0.1)] mb-6 text-5xl">🗂️</div>
              <h3 className="text-xl font-bold font-sans text-[var(--theme-text)] mb-2">{currentPath ? "Папка открыта" : "Ничего не выбрано"}</h3>
              <p className="text-[var(--theme-text-muted)] text-sm max-w-[280px] mx-auto leading-relaxed mb-6">
                Вы можете выбрать нужный артикул слева или удалить текущую открытую папку вместе со всем её содержимым.
              </p>
              {currentPath !== "" && (
                 <button onClick={handleDeleteFolder} disabled={deletingItem} className="py-2.5 px-4 shadow-[0_4px_15px_rgba(239,68,68,0.1)] text-[11px] font-bold uppercase tracking-wide bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 rounded-xl transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50">
                    🗑️ {deletingItem ? "Удаление..." : "Удалить текущую папку"}
                 </button>
              )}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-lg shadow-2xl z-50 text-white font-medium flex items-center gap-3 animate-fade-in ${toast.type === "error" ? "bg-red-500" : "bg-green-600"}`}>
          {toast.type === "success" ? "✅" : "⚠️"} {toast.message}
        </div>
      )}

      {/* CREATE FOLDER MODAL */}
      {isCreatingFolder && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsCreatingFolder(false)}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[400px]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-4">Создать папку</h2>
            <div className="text-sm text-[var(--theme-text-muted)] mb-2">Где создаем: <span className="font-bold">{currentPath || "Корень"}</span></div>
            <input 
              autoFocus
              type="text" 
              className="input-field w-full mb-6" 
              placeholder="Название папки" 
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setIsCreatingFolder(false)} className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">Отмена</button>
              <button 
                onClick={handleCreateFolder} 
                disabled={creatingItem || !newFolderName.trim()} 
                className="btn-glow px-4 py-2 text-sm disabled:opacity-50"
              >
                {creatingItem ? "Создание..." : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE LABEL MODAL */}
      {isCreatingLabel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsCreatingLabel(false)}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 md:px-8 pt-6 md:pt-8 pb-4 shrink-0">
              <h2 className="text-xl font-bold text-[var(--theme-text)]">Создать этикетку</h2>
              <button onClick={() => setIsCreatingLabel(false)} className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]">✕</button>
            </div>

            <div className="px-6 md:px-8 pb-4 overflow-y-auto flex-1 min-h-0 custom-scrollbar">
              <div className="mb-6 flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <span>Папка сохранения:</span>
                <span className="font-bold opacity-100">{currentPath ? currentPath : "Главная директория (без папки)"}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Название*</label>
                  <input type="text" className="input-field w-full" placeholder="Название товара..." value={createForm.name || ""} onChange={e => setCreateForm({...createForm, name: e.target.value})} autoFocus />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Артикул</label>
                  <input type="text" className="input-field w-full" placeholder="SKU001" value={createForm.sku || ""} onChange={e => setCreateForm({...createForm, sku: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Артикул 2 <span className="text-[10px] font-normal opacity-60">(для сетей)</span></label>
                  <input type="text" className="input-field w-full" placeholder="напр. 12345" value={createForm.sku2 || ""} onChange={e => setCreateForm({...createForm, sku2: e.target.value})} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Штрихкод (EAN-13)</label>
                  <input type="text" className="input-field w-full" placeholder="1234567890123" value={createForm.barcodeEan13 || ""} onChange={e => setCreateForm({...createForm, barcodeEan13: e.target.value})} />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Масса</label>
                  <input type="text" className="input-field w-full" placeholder="100 г" value={createForm.weight || ""} onChange={e => setCreateForm({...createForm, weight: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Сертификат (ГОСТ/СТО)</label>
                  <input type="text" className="input-field w-full" placeholder="СТО..." value={createForm.certCode || ""} onChange={e => setCreateForm({...createForm, certCode: e.target.value})} />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Срок и условия хранения</label>
                  <input type="text" className="input-field w-full" placeholder="6 месяцев при температуре 18C" value={createForm.storageCond || ""} onChange={e => setCreateForm({...createForm, storageCond: e.target.value})} />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">КБЖУ</label>
                  <textarea className="input-field w-full min-h-[60px]" placeholder="Белки: 1 г, Жиры: 2 г, Углеводы: 3 г" value={createForm.nutritionalInfo || ""} onChange={e => setCreateForm({...createForm, nutritionalInfo: e.target.value})} />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Состав</label>
                  <textarea className="input-field w-full min-h-[80px]" placeholder="Ингредиенты..." value={createForm.composition || ""} onChange={e => setCreateForm({...createForm, composition: e.target.value})} />
                </div>
              </div>
            </div>

            <div className="px-6 md:px-8 py-4 border-t border-[var(--theme-border)] flex gap-4 justify-end shrink-0">
              <button
                onClick={() => setIsCreatingLabel(false)}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-overlay)] transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleCreateLabel}
                disabled={creatingItem || !createForm.name}
                className="btn-glow px-8 py-2.5 text-sm disabled:opacity-50"
              >
                {creatingItem ? "Создание..." : "Создать этикетку"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOVE LABEL MODAL */}
      {isMovingFile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsMovingFile(false)}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[500px] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-4">Переместить этикетку</h2>
            <div className="text-sm font-semibold text-indigo-500 mb-4 truncate">{selected?.name}</div>
            
            <input 
              type="text" 
              className="input-field w-full mb-4" 
              placeholder="Поиск папки..." 
              value={moveSearchQuery}
              onChange={e => setMoveSearchQuery(e.target.value)}
              autoFocus
            />
            
            <div className="flex-1 overflow-y-auto min-h-[50px] bg-[var(--theme-overlay)] border border-[var(--theme-border)] rounded-xl py-2 px-1 mb-4 custom-scrollbar">
              <button 
                className="w-full text-left px-4 py-3 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer border-b border-transparent hover:border-[var(--theme-border)] font-bold mb-1"
                onClick={() => handleMoveFile("")}
                disabled={movingItemUrl}
              >
                 🏠 Корневая директория (без папки)
              </button>
              
              {allFoldersList.filter(f => f.toLowerCase().includes(moveSearchQuery.toLowerCase())).map(f => (
                <button 
                  key={f}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer text-[var(--theme-text)]"
                  onClick={() => handleMoveFile(f)}
                  disabled={movingItemUrl}
                >
                  📁 {f}
                </button>
              ))}
              
              {allFoldersList.filter(f => f.toLowerCase().includes(moveSearchQuery.toLowerCase())).length === 0 && (
                <div className="text-center py-4 text-[var(--theme-text-muted)] text-sm">Папки не найдены</div>
              )}
            </div>
            
            <div className="flex justify-end pt-2">
              <button onClick={() => setIsMovingFile(false)} className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {isDuplicatingFile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsDuplicatingFile(false)}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[500px] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-1">Дублировать в папку</h2>
            <div className="text-xs text-[var(--theme-text-muted)] mb-3">
              Создаст копию товара со всеми полями. После создания вы сразу попадёте в режим редактирования, чтобы поменять артикул.
            </div>
            <div className="text-sm font-semibold text-cyan-500 mb-4 truncate">{selected?.name}</div>

            <input
              type="text"
              className="input-field w-full mb-4"
              placeholder="Поиск папки..."
              value={duplicateSearchQuery}
              onChange={e => setDuplicateSearchQuery(e.target.value)}
              autoFocus
            />

            <div className="flex-1 overflow-y-auto min-h-[50px] bg-[var(--theme-overlay)] border border-[var(--theme-border)] rounded-xl py-2 px-1 mb-4 custom-scrollbar">
              <button
                className="w-full text-left px-4 py-3 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer border-b border-transparent hover:border-[var(--theme-border)] font-bold mb-1"
                onClick={() => handleDuplicateFile("")}
                disabled={duplicatingItem}
              >
                🏠 Корневая директория (без папки)
              </button>

              {allFoldersList.filter(f => f.toLowerCase().includes(duplicateSearchQuery.toLowerCase())).map(f => (
                <button
                  key={f}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer text-[var(--theme-text)]"
                  onClick={() => handleDuplicateFile(f)}
                  disabled={duplicatingItem}
                >
                  📁 {f}
                </button>
              ))}

              {allFoldersList.filter(f => f.toLowerCase().includes(duplicateSearchQuery.toLowerCase())).length === 0 && (
                <div className="text-center py-4 text-[var(--theme-text-muted)] text-sm">Папки не найдены</div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setIsDuplicatingFile(false)} className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
