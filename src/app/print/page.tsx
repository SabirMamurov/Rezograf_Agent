"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import LabelPreview from "@/components/LabelPreview";
import { useAdmin } from "@/components/AdminProvider";

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
  extraText: string | null;
  isExport: boolean | null;
  isShkLabel: boolean | null;
  manufacturer: string | null;
  manufacturerType: string | null;
  showCedarLogo: boolean | null;
  showLabelDates: boolean | null;
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

// «6» → «месяцев», «1» → «месяц», «22» → «месяца», …
function pluralMonths(n: number): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = Math.abs(n) % 10;
  if (mod100 >= 11 && mod100 <= 14) return "месяцев";
  if (mod10 === 1) return "месяц";
  if (mod10 >= 2 && mod10 <= 4) return "месяца";
  return "месяцев";
}

// Заменить в тексте условий хранения число месяцев на новое: «Срок годности 6
// месяцев» → «Срок годности 9 месяцев». Меняем ПЕРВОЕ вхождение «\d+ месяц…»,
// само слово «месяц/месяца/месяцев» тоже правим под новое число (иначе будет
// «9 месяц» вместо «9 месяцев»). Если совпадений нет — возвращаем исходную
// строку без изменений (не пытаемся угадать где вставить срок).
function applyShelfLifeToStorageCond(cond: string | null, months: number): string | null {
  if (!cond) return cond;
  return cond.replace(/(\d+)\s*месяц(?:ев|а)?/i, `${months} ${pluralMonths(months)}`);
}

// ── Right-pane block ordering ──────────────────────────────────────────
// Three blocks in the inspector pane that the user can drag-reorder.
// Order is persisted per browser in localStorage; not synced across users.
type BlockId = "inspector" | "data" | "print";
const DEFAULT_BLOCK_ORDER: BlockId[] = ["inspector", "data", "print"];
const BLOCK_ORDER_KEY = "rezograf-print-block-order";

// Drag handle: 6 dots in 2 columns. The whole handle element is the
// HTML5 drag source — onDragStart fires from here, the rest of the block
// is the drop target. Cursor changes to "grab/grabbing" so the affordance
// is obvious.
function DragHandle({
  onDragStart,
  onDragEnd,
  dragging,
  className = "",
}: {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  dragging: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title="Перетащите, чтобы поменять порядок блоков"
      className={`shrink-0 p-1 rounded text-[var(--theme-text-muted)] hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors ${
        dragging ? "cursor-grabbing opacity-60" : "cursor-grab"
      } ${className}`}
      onClick={(e) => e.preventDefault()}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="3" r="1.4" />
        <circle cx="5" cy="8" r="1.4" />
        <circle cx="5" cy="13" r="1.4" />
        <circle cx="11" cy="3" r="1.4" />
        <circle cx="11" cy="8" r="1.4" />
        <circle cx="11" cy="13" r="1.4" />
      </svg>
    </button>
  );
}

export default function PrintPage() {
  const [query, setQuery] = useState("");
  const { isAdmin, openPrompt } = useAdmin();
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

  // Multi-select для админа: список id отмеченных товаров для массового
  // дубля. Видны только когда isAdmin === true. Сбрасываются при смене
  // папки. После массового дубля диалог выбора целевой папки появляется
  // тот же, что и для одиночного — handleBulkDuplicate переиспользует
  // существующий openDuplicateFolder/handleDuplicateFile путь.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Лёгкое переименование «имя файла» — единственная операция, разрешённая
  // без режима редактирования (без пароля). Эндпоинт /api/products/[id]/rename
  // принимает только новое имя файла и сам же чистит слэши. Доступно всем
  // ролям: операторам удобно поправлять опечатку, и это не открывает им
  // полный редактор товара.
  const [isRenamingFile, setIsRenamingFile] = useState(false);
  const [renameFileName, setRenameFileName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const toggleBulkSelected = (id: string) => {
    setBulkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearBulkSelected = () => setBulkSelectedIds(new Set());

  const [mfgDateStr, setMfgDateStr] = useState("");
  // «Свежесть» даты изготовления. Флаг равен true, если mfgDateStr
  // выставили автоматически (на маунте или при выборе товара). После
  // ручной правки инпута оператор становится «владельцем» даты, и мы
  // больше её не трогаем, пока он не сбросит фокус выбором другого
  // товара. Флаг нужен для сценария «вкладка открыта через полночь»:
  // оператор пришёл утром 18-го, а mfgDateStr всё ещё «2026-07-17» —
  // при фокусе окна автоматом подтянем сегодня, но только если он даты
  // не менял вручную (иначе перезаписали бы его 15-е в 17-е).
  const [mfgDateAuto, setMfgDateAuto] = useState(true);
  // Optional manual override for the "годен до" (use-by) date.
  // Default behaviour: auto-compute from mfgDateStr + shelf-life months in
  // selected.storageCond. Operators sometimes need a different value (custom
  // shelf life, special batch, fix mistakes in storageCond) — when they pick
  // any date, it overrides the auto value. ↺ Авто in the UI clears the
  // override and goes back to auto. Reset to null whenever the operator
  // switches to a different product.
  const [expDateOverrideStr, setExpDateOverrideStr] = useState<string | null>(null);
  // Shelf-life quick-switch (в месяцах). Оператор может нажать 6 / 9 / 12
  // в блоке печати — тогда используется это число вместо автоматически
  // распарсенного из storageCond. Живёт только в рамках сессии печати
  // текущего товара, сбрасывается на новый товар. Не пишется в БД.
  const [shelfLifeOverride, setShelfLifeOverride] = useState<number | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  // editFileName is the LAST segment of btwFilePath (just the filename with .btw),
  // edited separately because btwFilePath is a Windows-style path and the user
  // should only rename the file, not move it. On save we glue the parent path
  // back together: parentDir + "\\" + editFileName.
  const [editFileName, setEditFileName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Per-browser draggable block order for the right inspector pane ──
  // Stored in localStorage so each operator's machine remembers its own
  // layout independently. Multiple users on multiple computers do NOT sync.
  const [blockOrder, setBlockOrder] = useState<BlockId[]>(DEFAULT_BLOCK_ORDER);
  const [draggingBlock, setDraggingBlock] = useState<BlockId | null>(null);
  const [dragOverBlock, setDragOverBlock] = useState<BlockId | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(BLOCK_ORDER_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_BLOCK_ORDER.length &&
        DEFAULT_BLOCK_ORDER.every((id) => parsed.includes(id))
      ) {
        setBlockOrder(parsed as BlockId[]);
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const reorderBlocks = useCallback((from: BlockId, to: BlockId) => {
    if (from === to) return;
    setBlockOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(from);
      next.splice(fromIdx, 1);
      const toIdx = next.indexOf(to);
      next.splice(toIdx, 0, from);
      try {
        localStorage.setItem(BLOCK_ORDER_KEY, JSON.stringify(next));
      } catch {
        /* localStorage may be full / disabled in private mode */
      }
      return next;
    });
  }, []);

  const handleBlockDragStart = (id: BlockId) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setDraggingBlock(id);
  };
  const handleBlockDragOver = (id: BlockId) => (e: React.DragEvent) => {
    if (!draggingBlock || draggingBlock === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverBlock !== id) setDragOverBlock(id);
  };
  const handleBlockDrop = (id: BlockId) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingBlock) reorderBlocks(draggingBlock, id);
    setDraggingBlock(null);
    setDragOverBlock(null);
  };
  const handleBlockDragEnd = () => {
    setDraggingBlock(null);
    setDragOverBlock(null);
  };

  // Creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  // Модалка «История печати» переехала в AdminProvider — открывается из Sidebar.
  const [createForm, setCreateForm] = useState<Partial<Product>>({});
  const [creatingItem, setCreatingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);
  // Confirmation modal for irreversible deletes (label + folder).
  // Opening: any "Delete X" button sets this; the actual API call only fires
  // when the operator clicks the red "Удалить" inside the modal. null = no
  // modal open. The whole shape is captured at open time so the modal stays
  // semantically tied to the click that opened it.
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "file" | "folder";
    title: string;
    subtitle?: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

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

  // Move-folder state — relocates the *entire* current folder (with all its
  // products and subfolders) under a different parent. Distinct from
  // isMovingFile (which moves a single product). Backend: PATCH /api/folders.
  const [isMovingFolder, setIsMovingFolder] = useState(false);
  const [moveFolderSearchQuery, setMoveFolderSearchQuery] = useState("");
  const [movingFolderInProgress, setMovingFolderInProgress] = useState(false);

  // Rename-folder state — single-input modal that changes the leaf segment
  // of the currently-open folder. Reuses PATCH /api/folders with `newName`.
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [renameFolderInput, setRenameFolderInput] = useState("");
  const [renamingFolderInProgress, setRenamingFolderInProgress] = useState(false);

  const basePrefix = 'C:\\Users\\Пользователь\\Desktop\\extracted_labels\\';

  // Derive the FULL hierarchical folder path of a product from its
  // btwFilePath. The Product.category column only holds the leaf folder name
  // (e.g. "ВЕСОВЫЕ конфеты 1 кг"), but the virtual folder tree on the left
  // expects the full path ("Цех ПЦО\\ВЕСОВЫЕ конфеты 1 кг") — see
  // CLAUDE.md > Virtual folder tree. Using just .category for navigation
  // jumped to a non-existent leaf and the API returned no folders/files.
  const getProductFolderPath = useCallback((p: Product): string => {
    if (p.btwFilePath) {
      let rel = p.btwFilePath;
      if (rel.startsWith(basePrefix)) rel = rel.slice(basePrefix.length);
      const parts = rel.split(/[\\/]/);
      parts.pop(); // drop the filename, keep the folder chain
      return parts.join('\\');
    }
    return p.category ?? "";
  }, [basePrefix]);

  useEffect(() => {
    setMfgDateStr(toInputDate(new Date()));
    setMfgDateAuto(true);
  }, []);

  // Если вкладка открыта через полночь, тихо подтягиваем дату к сегодня
  // при возврате фокуса — но только пока оператор её не менял вручную.
  // Иначе сохранится «17.07» с прошлой сессии и печать пойдёт с
  // прошлой датой (обнаружено: оператор жаловался на «то 17, то 18 в
  // течение дня»).
  useEffect(() => {
    const refresh = () => {
      if (!mfgDateAuto) return;
      const today = toInputDate(new Date());
      setMfgDateStr((prev) => (prev !== today ? today : prev));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mfgDateAuto]);

  const autoShelfMonths = parseShelfLifeMonths(selected?.storageCond ?? null);
  const effectiveShelfMonths = shelfLifeOverride ?? autoShelfMonths;
  // Если оператор нажал 6/9/12 — подменяем число в самом тексте
  // storageCond («Срок годности 6 месяцев» → «Срок годности 9 месяцев»).
  // Иначе печатаемое условие противоречит дате «Годен до» — оператор
  // видит «Срок годности 6 мес» и «Годен до 06.08.2027 (+12 мес)».
  // Только в оверрайд-режиме — при auto шлём как есть, чтобы не задевать
  // товары с нестандартной формулировкой storageCond.
  const effectiveStorageCond = shelfLifeOverride !== null
    ? applyShelfLifeToStorageCond(selected?.storageCond ?? null, shelfLifeOverride)
    : (selected?.storageCond ?? null);
  const previewProduct = useMemo(
    () => (selected && shelfLifeOverride !== null
      ? { ...selected, storageCond: effectiveStorageCond }
      : selected),
    [selected, shelfLifeOverride, effectiveStorageCond],
  );

  const { mfgDateFormatted, expDateFormatted, autoExpDateStr } = useMemo(() => {
    if (!mfgDateStr) {
      return { mfgDateFormatted: "...", expDateFormatted: "...", autoExpDateStr: "" };
    }
    const mfg = new Date(mfgDateStr + "T00:00:00");
    const auto = new Date(mfg);
    // Treat 1 month as a fixed 30 days. The previous setMonth() approach
    // followed the calendar (May→Sep keeps the same day-of-month), but real
    // months are 28-31 days, so the actual elapsed time varied by ±2 days
    // depending on which months the shelf life crossed. Operators expect
    // "4 месяца" = exactly 120 days regardless of mfg date.
    auto.setDate(auto.getDate() + effectiveShelfMonths * 30);
    // If the operator manually overrode the use-by date, that wins; otherwise
    // we use the auto-computed one.
    const exp = expDateOverrideStr
      ? new Date(expDateOverrideStr + "T00:00:00")
      : auto;
    return {
      mfgDateFormatted: formatDate(mfg),
      expDateFormatted: formatDate(exp),
      autoExpDateStr: toInputDate(auto),
    };
  }, [mfgDateStr, effectiveShelfMonths, expDateOverrideStr]);

  const isExpDateManual = expDateOverrideStr !== null;
  // Value for <input type="date">. When override is active show that, otherwise
  // pre-populate with the auto value so the operator can tweak from a sensible
  // starting point with one click on the date picker.
  const expDateInputStr = expDateOverrideStr ?? autoExpDateStr;

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
    // При смене папки сбрасываем выбор для массового дубля — иначе ids
    // отмеченные в одной папке будут "висеть" в другой и пользователь
    // случайно скопирует не то, что видит на экране.
    clearBulkSelected();
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

  // Load barcode when product selected. For ITF-14 (14-digit) barcodes we
  // ask the API for a bars-only SVG and the LabelPreview renders the
  // digits as separate HTML below — bigger, bold, with letter-spacing —
  // because the tight default bwip-js glyphs get rubbed off by the
  // thermal head and the scanner misreads. EAN-13/EAN-8/Code128 keep
  // their embedded text (the warehouse trial passed only for ITF-14).
  useEffect(() => {
    if (!selected?.barcodeEan13) {
      setBarcodeSvg("");
      return;
    }
    const digitOnly = (selected.barcodeEan13 || "").replace(/\D/g, "");
    // ШК-template products force separateText=1 regardless of barcode
    // length — LabelPreview's ШК branch always renders digits as a big
    // HTML block below the bars and stretches the SVG with
    // preserveAspectRatio="none". If we fetched the SVG with embedded
    // text for those, the embedded glyphs would stretch too. Keep
    // aligned with the same decision in /api/render/route.ts.
    const isShkProduct = !!selected.isShkLabel ||
      (typeof selected.btwFilePath === "string" && /\\Единичный ШК\\/i.test(selected.btwFilePath));
    const useSeparateDigits = isShkProduct || digitOnly.length === 14;
    const url = `/api/barcode?code=${selected.barcodeEan13}${useSeparateDigits ? "&separateText=1" : ""}`;
    fetch(url)
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
    // Reset manufacturing date to today on every product switch — operators
    // don't expect a date typed for one label to carry over to the next.
    setMfgDateStr(toInputDate(new Date()));
    setMfgDateAuto(true);
    // Same logic for the use-by override: don't carry a one-off override
    // from one label onto the next.
    setExpDateOverrideStr(null);
    setShelfLifeOverride(null);
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

    // Second line of defence against the «17/18 date drift»: если
    // оператор не менял дату вручную (mfgDateAuto=true), берём сегодня
    // ПРЯМО СЕЙЧАС и подставляем в fetch. Не полагаемся на пересчёт
    // useMemo — он произойдёт только в следующем рендере, а печатать
    // надо сейчас с актуальной датой. Заодно обновляем state, чтобы
    // на превью тоже отобразилось правильное число.
    let mfgToPrint = mfgDateFormatted;
    let expToPrint = expDateFormatted;
    if (mfgDateAuto) {
      const todayInput = toInputDate(new Date());
      if (todayInput !== mfgDateStr) {
        const today = new Date(todayInput + "T00:00:00");
        mfgToPrint = formatDate(today);
        if (expDateOverrideStr === null) {
          const auto = new Date(today);
          // Тот же 30-дней/мес алгоритм что и в useMemo — иначе превью и
          // печать разошлись бы. Календарный setMonth здесь давал ±3
          // дня разницы против 30-дневного расчёта наверху.
          // effectiveShelfMonths учитывает быстрый переключатель 6/9/12.
          auto.setDate(auto.getDate() + effectiveShelfMonths * 30);
          expToPrint = formatDate(auto);
        }
        setMfgDateStr(todayInput);
      }
    }

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
          mfgDate: mfgToPrint,
          expDate: expToPrint,
          format: "image",
          ...(shelfLifeOverride !== null && effectiveStorageCond != null
            ? { storageCondOverride: effectiveStorageCond }
            : {}),
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
  }, [selected, mfgDateFormatted, expDateFormatted, mfgDateAuto, mfgDateStr, expDateOverrideStr, shelfLifeOverride, effectiveStorageCond, effectiveShelfMonths]);

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
          ...(shelfLifeOverride !== null && effectiveStorageCond != null
            ? { storageCondOverride: effectiveStorageCond }
            : {}),
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
    // Pre-fill EVERY label-data field, not just the 8 we used historically.
    // Without `quantity`/`certCode`/`boxWeight`/`sponsorText`/`manufacturer`,
    // those inputs opened blank even when the underlying product had data —
    // operators thought the data was gone and re-typed it from scratch (the
    // PATCH endpoint just-omits-unsent-fields so they weren't actually lost,
    // but the experience was broken).
    setEditForm({
      name: selected.name,
      sku: selected.sku || "",
      sku2: selected.sku2 || "",
      weight: selected.weight || "",
      barcodeEan13: selected.barcodeEan13 || "",
      nutritionalInfo: selected.nutritionalInfo || "",
      storageCond: selected.storageCond || "",
      composition: selected.composition || "",
      quantity: selected.quantity || "",
      certCode: selected.certCode || "",
      boxWeight: selected.boxWeight || "",
      sponsorText: selected.sponsorText || "",
      manufacturer: selected.manufacturer || "",
      // Initialise the manufacturer radio. If the product has no explicit
      // value, fall back to the same auto-detection rule used by the render
      // route so that opening an Абдуалиев-folder product shows «ИП Абдуалиев»
      // as pre-selected — otherwise saving would silently flip it to
      // Эко-фабрика (because that's the default radio bucket).
      manufacturerType: selected.manufacturerType === "abdualiev" || selected.manufacturerType === "ekofabrika"
        ? selected.manufacturerType
        : (typeof selected.btwFilePath === "string" &&
            /(\\Цех ПЦО\\Орехи\\ИП Абдуалиев\\|\\МП\\ПЦПО\\)/i.test(selected.btwFilePath))
          ? "abdualiev"
          : "ekofabrika",
      extraText: selected.extraText || "",
      isExport: !!selected.isExport,
      isShkLabel: !!selected.isShkLabel,
      showCedarLogo: !!selected.showCedarLogo,
      // showLabelDates: null = авто, true = показать, false = скрыть.
      showLabelDates:
        selected.showLabelDates === true
          ? true
          : selected.showLabelDates === false
            ? false
            : null,
    });
    // Pull the file name (last segment) out of btwFilePath so the user
    // can rename the .btw file without manipulating the full Windows path.
    const lastSegment = selected.btwFilePath
      ? selected.btwFilePath.split(/[\\/]/).pop() || ""
      : "";
    setEditFileName(lastSegment);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSavingEdit(true);
    try {
      // Rebuild btwFilePath if the user changed the file name. Take everything
      // up to and including the last separator and append the new file name.
      // If the file name is empty, leave btwFilePath alone (don't accidentally
      // detach the product from the folder tree).
      //
      // CRITICAL: strip path separators (\ and /) from the user-entered file
      // name BEFORE concatenating with the parent path — otherwise a slash
      // in the name turns into a folder boundary, splits the file into
      // nested folders and the operator sees their label "disappear" into
      // a phantom subfolder. Same rule as in handleCreateLabel.
      const payload: Record<string, unknown> = { id: selected.id, ...editForm };
      const safeFileName = editFileName.trim().replace(/[\\/]/g, " ").replace(/\s+/g, " ").trim();
      if (selected.btwFilePath && safeFileName) {
        const parts = selected.btwFilePath.split(/[\\/]/);
        const parent = parts.slice(0, -1).join("\\");
        payload.btwFilePath = parent ? `${parent}\\${safeFileName}` : safeFileName;
      }
      const res = await fetch(`/api/products`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  const openRenameFileModal = () => {
    if (!selected) return;
    const last = selected.btwFilePath
      ? selected.btwFilePath.split(/[\\/]/).pop() || ""
      : "";
    setRenameFileName(last);
    setIsRenamingFile(true);
  };

  const saveRenameFile = async () => {
    if (!selected) return;
    const cleaned = renameFileName.trim().replace(/[\\/]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) {
      setToast({ message: "Имя файла не может быть пустым", type: "error" });
      return;
    }
    setSavingRename(true);
    try {
      const res = await fetch(`/api/products/${selected.id}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: cleaned }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      setSelected(updated);
      setFolderProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
      setIsRenamingFile(false);
      setToast({ message: "Имя файла обновлено", type: "success" });
    } catch (err) {
      setToast({ message: "Ошибка переименования", type: "error" });
    } finally {
      setSavingRename(false);
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

  // Массовый перенос: для каждого id формируем новый btwFilePath из
  // текущего файла + новой папки, через PATCH /api/products. Имя файла
  // берём из folderProducts (там лежат все товары текущей папки — те же,
  // что доступны для выделения). Если товар не найден (например пользо-
  // ватель быстро перешёл по папкам), пропускаем — лучше тихо пропустить
  // одну строку, чем сломать всю операцию.
  const openBulkMoveFolder = async () => {
    if (bulkSelectedIds.size === 0) return;
    setBulkMoving(true);
    setIsMovingFile(true);
    setMoveSearchQuery("");
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

  const handleBulkMoveToFolder = async (targetPath: string) => {
    if (bulkSelectedIds.size === 0) return;
    setMovingItemUrl(true);
    const ids = Array.from(bulkSelectedIds);
    let okCount = 0;
    let failCount = 0;
    for (const id of ids) {
      const prod = folderProducts.find(p => p.id === id);
      if (!prod) { failCount += 1; continue; }
      let fileName = prod.name + ".btw";
      if (prod.btwFilePath) {
        const parts = prod.btwFilePath.split(/[/\\]/);
        fileName = parts[parts.length - 1] || fileName;
      }
      const newPath = targetPath ? `${targetPath}\\${fileName}` : fileName;
      const newBtwFilePath = `${basePrefix}${newPath}`;
      try {
        const res = await fetch("/api/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            category: targetPath,
            btwFilePath: newBtwFilePath,
          }),
        });
        if (res.ok) okCount += 1;
        else failCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setMovingItemUrl(false);
    setIsMovingFile(false);
    setBulkMoving(false);
    clearBulkSelected();
    if (failCount === 0) {
      setToast({ message: `Перемещено: ${okCount}`, type: "success" });
    } else {
      setToast({ message: `Перемещено ${okCount} из ${ids.length}`, type: failCount === ids.length ? "error" : "success" });
    }
    setCurrentPath(targetPath);
  };

  // Массовое удаление: проходим по ids и DELETE'аем каждый. Подтверждение
  // запрашивается через тот же модальный confirmDelete, что у одиночного
  // удаления — onConfirm зашивает handleBulkDelete с уже зафиксированным
  // списком.
  const handleBulkDelete = async () => {
    if (bulkSelectedIds.size === 0) return;
    setBulkDeleting(true);
    setDeletingItem(true);
    const ids = Array.from(bulkSelectedIds);
    let okCount = 0;
    let failCount = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/products?id=${id}`, { method: "DELETE" });
        if (res.ok) okCount += 1;
        else failCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setDeletingItem(false);
    setBulkDeleting(false);
    clearBulkSelected();
    if (failCount === 0) {
      setToast({ message: `Удалено: ${okCount}`, type: "success" });
    } else {
      setToast({ message: `Удалено ${okCount} из ${ids.length}`, type: failCount === ids.length ? "error" : "success" });
    }
    // Если был открыт товар из удалённых — сбрасываем инспектор.
    if (selected && ids.includes(selected.id)) setSelected(null);
    loadFolderData();
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
      // Pre-fill the file-name input from the new copy's btwFilePath. Without
      // this the field keeps the previously-selected product's filename (or
      // is empty) — operators kept thinking the duplicate inherited the wrong
      // file name. Mirrors the same extraction startEdit() does.
      const lastSegment = created.btwFilePath
        ? created.btwFilePath.split(/[\\/]/).pop() || ""
        : "";
      setEditFileName(lastSegment);
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

  const openMoveFolderModal = async () => {
    if (!currentPath) return;
    setIsMovingFolder(true);
    setMoveFolderSearchQuery("");
    setAllFoldersList([]);
    try {
      const res = await fetch("/api/folders?fetchAllPaths=true");
      if (res.ok) {
        const data = await res.json();
        setAllFoldersList(data.folders || []);
      }
    } catch {
      setToast({ message: "Ошибка загрузки папок", type: "error" });
    }
  };

  const handleMoveCurrentFolder = async (target: string) => {
    if (!currentPath) return;
    setMovingFolderInProgress(true);
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: currentPath, target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to move folder");
      }
      setToast({
        message: `Папка перенесена (${data.moved} товар${data.moved === 1 ? "" : "ов"})`,
        type: "success",
      });
      setIsMovingFolder(false);
      // Navigate to the new location so the operator immediately sees the
      // moved folder under its new parent.
      setCurrentPath(data.newFolderPath || target);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка переноса папки";
      setToast({ message: msg, type: "error" });
    } finally {
      setMovingFolderInProgress(false);
    }
  };

  const openRenameFolderModal = () => {
    if (!currentPath) return;
    const leaf = currentPath.split(/[\\/]/).pop() || "";
    setRenameFolderInput(leaf);
    setIsRenamingFolder(true);
  };

  const handleRenameCurrentFolder = async () => {
    if (!currentPath) return;
    const newName = renameFolderInput.trim();
    if (!newName) {
      setToast({ message: "Имя папки не может быть пустым", type: "error" });
      return;
    }
    setRenamingFolderInProgress(true);
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: currentPath, newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to rename folder");
      setToast({
        message: `Папка переименована (${data.moved} товар${data.moved === 1 ? "" : "ов"})`,
        type: "success",
      });
      setIsRenamingFolder(false);
      // Navigate to the new path so the operator stays inside the same
      // (now-renamed) folder.
      setCurrentPath(data.newFolderPath || currentPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка переименования";
      setToast({ message: msg, type: "error" });
    } finally {
      setRenamingFolderInProgress(false);
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
                    // Show the full last segment of btwFilePath, only stripping a
                    // trailing ".btw" extension. Operators rely on the appended
                    // notes (e.g. "...gr.btw\nНовый не брать !!!") to distinguish
                    // duplicate products in the dropdown — do NOT collapse them.
                    const fileName = (p.btwFilePath?.split(/[/\\]/).pop() || "")
                      .replace(/\.btw$/i, "");
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
                          {fileName && <span className="opacity-70 whitespace-pre-wrap break-words">{fileName}</span>}
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
            {/* Creation actions are admin-only. Operators see a hint that opens
                the password prompt. Keep SOMETHING here so the toolbar keeps its
                ~53px height — the thead below is `sticky top-[53px]`. */}
            {isAdmin ? (
              <>
                <button onClick={() => { setIsCreatingLabel(true); setCreateForm({}); }} className="py-2 px-4 shadow-[0_0_15px_rgba(99,102,241,0.2)] text-[11.5px] font-bold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:from-indigo-400 hover:to-indigo-500 rounded-xl transition-all border border-indigo-400/50 cursor-pointer flex items-center gap-2">
                  ➕ Создать этикетку
                </button>
                <button onClick={() => setIsCreatingFolder(true)} className="py-2 px-4 text-[11px] font-bold uppercase tracking-wide bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] rounded-xl shadow-sm transition-all border border-[var(--theme-border)] cursor-pointer flex items-center gap-2">
                  <FolderIcon className="w-3.5 h-3.5 mr-1" /> Создать папку
                </button>
                {/* Rename — visible only when the operator is INSIDE a folder
                    (currentPath non-empty). Targets the currently-opened folder
                    leaf. Lives next to «Создать папку» rather than in the
                    inspector because it's a folder-level action, not a
                    product-level one. */}
                {currentPath && (
                  <button
                    onClick={openRenameFolderModal}
                    title={`Переименовать «${currentPath.split(/[\\/]/).pop()}»`}
                    className="py-2 px-4 text-[11px] font-bold uppercase tracking-wide bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 rounded-xl shadow-sm transition-all border border-amber-500/30 cursor-pointer flex items-center gap-2"
                  >
                    ✎ Переименовать папку
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={openPrompt}
                title="Ввести пароль, чтобы редактировать"
                className="py-2 px-4 text-[11px] font-semibold tracking-wide bg-[var(--theme-overlay)] text-[var(--theme-text-muted)] hover:bg-indigo-500/10 hover:text-indigo-500 rounded-xl border border-[var(--theme-border)] hover:border-indigo-500/30 transition-all cursor-pointer flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Режим просмотра — нажмите, чтобы редактировать
              </button>
            )}
          </div>
          <table className="w-full table-fixed divide-y divide-[var(--theme-border)] text-sm">
            <thead className="bg-[var(--color-surface-panel)]/95 sticky top-[53px] z-10 backdrop-blur-xl border-b border-[var(--theme-border)]">
              <tr>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-[var(--theme-text-muted)] uppercase tracking-widest w-[70%]">Имя</th>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-[var(--theme-text-muted)] uppercase tracking-widest w-[30%] truncate">Артикул</th>
              </tr>
              {/* «На уровень вверх» lives in <thead> (not tbody) so it stays
                  pinned with the column header when the list scrolls — the
                  whole thead is sticky. Keeps drag-drop-to-parent + dbl-click. */}
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
                  <td colSpan={2} className="px-5 py-2 font-semibold text-indigo-400 group-hover:text-indigo-300 border-t border-[var(--theme-border)]">
                    <span className="mr-3 opacity-80 inline-flex items-center"><BackFolderIcon className="w-5 h-5"/></span> На уровень вверх
                  </td>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-[var(--theme-border)]">

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
                  className={`hover:bg-[var(--theme-overlay)] cursor-pointer transition-colors select-none ${selected?.id === fp.id ? 'bg-indigo-500/10 border-l-[3px] border-indigo-400 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]' : 'border-l-[3px] border-transparent'} ${bulkSelectedIds.has(fp.id) ? 'bg-cyan-500/5' : ''}`}
                >
                  <td className="px-5 py-2 overflow-hidden">
                    <div className="flex items-center gap-3">
                      {/* Чекбокс множественного выбора — только для админа.
                          stopPropagation чтобы клик по чекбоксу не открыл
                          инспектор/редактор и не двигал outer dnd. */}
                      {isAdmin && (
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-cyan-500 cursor-pointer shrink-0"
                          checked={bulkSelectedIds.has(fp.id)}
                          onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); toggleBulkSelected(fp.id); }}
                          title="Выбрать для массового действия"
                        />
                      )}
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
          {/* BULK-режим — приоритет над обычным инспектором/заглушкой. Активен
              когда оператор отметил товары галочками в списке слева. Показ
              действия и список выбранных, чтобы убрать ошибочно отмеченный
              можно прямо отсюда. Дублирование сюда специально не вынесено:
              при переносе или удалении замена данных не требуется, а при
              массовом дублировании пришлось бы редактировать поля каждой
              копии (артикул, штрихкод) — это уже точечная работа, а не
              массовая, и должна делаться через одиночное «Дублировать» из
              инспектора одного товара. */}
          {isAdmin && bulkSelectedIds.size > 0 ? (
            <div className="animate-fade-in p-5 xl:p-6 max-w-full flex flex-col">
              <div className="flex flex-col gap-3.5 bg-[var(--theme-overlay)] backdrop-blur-md px-4 py-4 rounded-xl border border-cyan-500/40 shadow-[0_4px_12px_rgba(6,182,212,0.15)]">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold tracking-wider text-cyan-600 dark:text-cyan-300 uppercase flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    Массовое действие
                  </div>
                  <button
                    onClick={clearBulkSelected}
                    className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] px-2 py-1 rounded-md hover:bg-[var(--theme-overlay)] transition-colors cursor-pointer"
                    title="Снять выделение"
                  >
                    Сбросить
                  </button>
                </div>
                <div className="h-px bg-gradient-to-r from-transparent via-[var(--theme-border)] to-transparent"></div>
                <div className="text-sm text-[var(--theme-text)]">
                  Выбрано товаров: <span className="font-bold text-cyan-600 dark:text-cyan-300">{bulkSelectedIds.size}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={openBulkMoveFolder}
                    disabled={bulkMoving || movingItemUrl}
                    className="py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>
                    Перенести
                  </button>
                  <button
                    onClick={() => setConfirmDelete({
                      kind: "file",
                      title: `Удалить ${bulkSelectedIds.size} ${bulkSelectedIds.size === 1 ? "этикетку" : "товар(а/ов)"}?`,
                      subtitle: "Действие необратимо — товары будут удалены из каталога безвозвратно.",
                      onConfirm: handleBulkDelete,
                    })}
                    disabled={bulkDeleting || deletingItem}
                    className="py-2.5 px-3 text-[11px] font-bold uppercase tracking-wide bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Удалить
                  </button>
                </div>
              </div>

              {/* Список выбранных товаров: оператор видит, что именно сейчас
                  попадёт в массовое действие, и может отдельно убрать
                  ошибочно отмеченный — без необходимости искать его в
                  большом списке слева. */}
              <div className="mt-4 bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-[var(--theme-overlay)] border-b border-[var(--theme-border)] text-[10px] font-bold uppercase tracking-widest text-[var(--theme-text-muted)]">Список выбранных</div>
                <div className="max-h-[480px] overflow-y-auto custom-scrollbar">
                  {Array.from(bulkSelectedIds).map(id => {
                    const prod = folderProducts.find(p => p.id === id);
                    const title = prod
                      ? (prod.btwFilePath ? prod.btwFilePath.split(/[/\\]/).pop()?.replace('.btw', '') : prod.name)
                      : `(не найден: ${id.slice(0,8)}…)`;
                    return (
                      <div key={id} className="flex items-center justify-between px-4 py-2 border-b border-[var(--theme-border)] last:border-b-0 hover:bg-[var(--theme-overlay)] transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <LabelItemIcon className="w-4 h-4 text-emerald-500 shrink-0"/>
                          <span className="text-xs text-[var(--theme-text)] truncate">{title}</span>
                          {prod?.sku && <span className="ml-1 text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">{prod.sku}</span>}
                        </div>
                        <button
                          onClick={() => toggleBulkSelected(id)}
                          className="ml-2 shrink-0 w-6 h-6 rounded-md text-[var(--theme-text-muted)] hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center justify-center"
                          title="Убрать из выбранных"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="animate-fade-in p-5 xl:p-6 max-w-full flex flex-col">

              {/* Toolbar */}
              <div
                style={{ order: blockOrder.indexOf("inspector") }}
                onDragOver={handleBlockDragOver("inspector")}
                onDragLeave={() => dragOverBlock === "inspector" && setDragOverBlock(null)}
                onDrop={handleBlockDrop("inspector")}
                className={`flex flex-col gap-3.5 mb-6 bg-[var(--theme-overlay)] backdrop-blur-md px-4 py-4 rounded-xl border shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all ${
                  draggingBlock === "inspector" ? "opacity-40" : ""
                } ${
                  dragOverBlock === "inspector" && draggingBlock !== "inspector"
                    ? "border-indigo-500 ring-2 ring-indigo-500/40 bg-indigo-500/10"
                    : "border-[var(--theme-border)]"
                }`}
              >
                {/* Header row: back-arrow + title + drag handle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Close inspector → returns to empty state where folder
                        operations (Переместить / Удалить папку) are visible.
                        Without this, operators have no way to leave the label
                        view to act on the surrounding folder. */}
                    <button
                      onClick={() => { setSelected(null); setIsEditing(false); }}
                      title="Закрыть этикетку и вернуться к папке"
                      className="w-7 h-7 rounded-lg bg-[var(--theme-overlay)] hover:bg-indigo-500/10 border border-[var(--theme-border)] hover:border-indigo-500/30 text-[var(--theme-text-muted)] hover:text-indigo-500 transition-all cursor-pointer flex items-center justify-center"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <div className="text-[11px] font-bold tracking-wider text-indigo-500 uppercase flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      Инспектор
                    </div>
                  </div>
                  <DragHandle
                    onDragStart={handleBlockDragStart("inspector")}
                    onDragEnd={handleBlockDragEnd}
                    dragging={draggingBlock === "inspector"}
                  />
                </div>

                {/* Divider */}
                <div className="h-px bg-gradient-to-r from-transparent via-[var(--theme-border)] to-transparent"></div>

                {/* Action buttons */}
                {!isEditing ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(() => {
                      // Use the full hierarchical path, not just the leaf
                      // segment in selected.category (which the previous
                      // version used and which broke navigation by jumping
                      // to a non-existent root-level leaf).
                      const productFolder = getProductFolderPath(selected);
                      if (!productFolder || productFolder === currentPath) return null;
                      return (
                        <button
                          onClick={() => setCurrentPath(productFolder)}
                          className="col-span-2 py-2 px-3 text-[11px] font-bold tracking-wide uppercase bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-lg shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          title={`Перейти к папке: ${productFolder}`}
                        >
                          📂 К товару
                        </button>
                      );
                    })()}
                    {/* Имя файла — единственная мутирующая операция,
                        доступная без пароля. Бэк-эндпоинт rename не
                        требует isAdminRequest. Кнопка показывается всегда
                        (и в редакторском режиме тоже — удобно править имя
                        не открывая полную форму). */}
                    {selected?.btwFilePath && (
                      <button
                        onClick={openRenameFileModal}
                        className="py-2 px-3 text-[11px] font-bold tracking-wide uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        title="Изменить только имя файла этикетки"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Имя файла
                      </button>
                    )}
                    {/* Mutating actions — admin only. «К товару» above is just
                        navigation, so it stays available to operators. */}
                    {isAdmin && (
                      <>
                        <button onClick={openMoveFolder} className="py-2 px-3 text-[11px] font-bold tracking-wide uppercase bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-indigo-500/20 cursor-pointer flex items-center justify-center gap-1.5">
                          📦 Переместить
                        </button>
                        <button onClick={openDuplicateFolder} className="py-2 px-3 text-[11px] font-bold tracking-wide uppercase bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-cyan-500/20 cursor-pointer flex items-center justify-center gap-1.5">
                          📋 Дублировать
                        </button>
                        <button
                          onClick={() => {
                            if (!selected) return;
                            setConfirmDelete({
                              kind: "file",
                              title: selected.name || "(без названия)",
                              subtitle: selected.btwFilePath
                                ? `Файл: ${selected.btwFilePath.split(/[\\/]/).pop()}`
                                : undefined,
                              onConfirm: handleDeleteFile,
                            });
                          }}
                          disabled={deletingItem}
                          className="py-2 px-3 text-[11px] font-bold tracking-wide uppercase bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 rounded-lg shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          🗑️ Удалить
                        </button>
                        <button onClick={startEdit} className="py-2 px-3 text-[11px] font-bold tracking-wide uppercase bg-[var(--theme-overlay)] text-[var(--theme-text)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg shadow-sm transition-all focus:ring-2 focus:ring-indigo-500/20 cursor-pointer flex items-center justify-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          Редактировать
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setIsEditing(false)} className="py-2 px-3 text-[11px] font-bold uppercase tracking-wide text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] bg-[var(--theme-overlay)] hover:bg-[var(--theme-overlay-hover)] border border-[var(--theme-border)] rounded-lg transition-colors cursor-pointer flex items-center justify-center">Отмена</button>
                    <button onClick={saveEdit} disabled={savingEdit} className="py-2 px-3 text-[11px] font-bold uppercase tracking-wide bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-400 hover:to-purple-400 rounded-lg shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-all cursor-pointer border border-transparent disabled:opacity-50 flex items-center justify-center gap-1">
                      {savingEdit ? "Сохранение..." : "💾 Сохранить"}
                    </button>
                  </div>
                )}
              </div>

              {/* Edit / Details Form */}
              <div
                style={{ order: blockOrder.indexOf("data") }}
                onDragOver={handleBlockDragOver("data")}
                onDragLeave={() => dragOverBlock === "data" && setDragOverBlock(null)}
                onDrop={handleBlockDrop("data")}
                className={`glass-card overflow-hidden mb-6 transition-all ${
                  draggingBlock === "data" ? "opacity-40" : ""
                } ${
                  dragOverBlock === "data" && draggingBlock !== "data"
                    ? "ring-2 ring-indigo-500/50 shadow-[0_0_24px_rgba(99,102,241,0.25)]"
                    : ""
                }`}
              >
                <div className="bg-[var(--theme-overlay)] border-b border-[var(--theme-border)] px-5 py-3 font-bold text-[10px] text-[var(--theme-text-muted)] uppercase tracking-widest flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div> Данные {isEditing && <span className="text-indigo-500">(Режим редактирования)</span>}
                  </div>
                  <DragHandle
                    onDragStart={handleBlockDragStart("data")}
                    onDragEnd={handleBlockDragEnd}
                    dragging={draggingBlock === "data"}
                  />
                </div>
                <div className="p-5 flex flex-col gap-4 text-sm text-[var(--theme-text)]">
                  {isEditing ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs text-gray-400 font-bold uppercase tracking-wider">Название</label>
                          {editForm.name && (/\.btw\b|\r|\n/.test(editForm.name)) && (
                            <button
                              type="button"
                              onClick={() => {
                                const cleaned = (editForm.name || "")
                                  .replace(/\r\n?|\n/g, " ")
                                  .replace(/\.btw\b/gi, "")
                                  .replace(/\s+/g, " ")
                                  .trim();
                                setEditForm({ ...editForm, name: cleaned });
                              }}
                              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors cursor-pointer"
                              title="Убрать .btw, переносы строк и лишние пробелы"
                            >
                              ✨ Очистить
                            </button>
                          )}
                        </div>
                        <textarea
                          className="input-field min-h-[60px] whitespace-pre-wrap"
                          value={editForm.name || ""}
                          onChange={e => setEditForm({...editForm, name: e.target.value})}
                          rows={2}
                        />
                      </div>
                      {selected.btwFilePath && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs text-gray-400 font-bold uppercase tracking-wider">
                              Имя файла <span className="text-[10px] font-normal opacity-60">(.btw)</span>
                            </label>
                            {(/\.btw[\s\S]+|\r|\n/.test(editFileName) || /\s\.btw$/i.test(editFileName)) && (
                              <button
                                type="button"
                                onClick={() => {
                                  // Strip everything after the first ".btw" (incl. that .btw),
                                  // collapse whitespace, then put a single ".btw" at the end.
                                  const base = editFileName
                                    .replace(/\r\n?|\n/g, " ")
                                    .replace(/\.btw[\s\S]*$/i, "")
                                    .replace(/\s+/g, " ")
                                    .trim();
                                  setEditFileName(base + ".btw");
                                }}
                                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-500 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors cursor-pointer"
                                title="Убрать всё после .btw, переносы строк и лишние пробелы"
                              >
                                ✨ Очистить
                              </button>
                            )}
                          </div>
                          <textarea
                            className="input-field min-h-[44px] whitespace-pre-wrap font-mono text-[12px]"
                            value={editFileName}
                            onChange={e => setEditFileName(e.target.value)}
                            rows={2}
                            placeholder="название.btw"
                          />
                          <p className="text-[10px] text-[var(--theme-text-muted)] mt-1">
                            Папка остаётся прежней — меняется только имя самого файла.
                          </p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Артикул</label><input type="text" className="input-field" value={editForm.sku || ""} onChange={e => setEditForm({...editForm, sku: e.target.value})} /></div>
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Артикул 2 <span className="text-[10px] font-normal opacity-60">(для сетей)</span></label><input type="text" className="input-field" value={editForm.sku2 || ""} onChange={e => setEditForm({...editForm, sku2: e.target.value})} /></div>
                      </div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Штрихкод</label><input type="text" className="input-field" value={editForm.barcodeEan13 || ""} onChange={e => setEditForm({...editForm, barcodeEan13: e.target.value})} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Масса (в тексте)</label><input type="text" className="input-field" value={editForm.weight || ""} onChange={e => setEditForm({...editForm, weight: e.target.value})} /></div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider" title="Печатается на этикетке (вместо массы или рядом с ней). Например: «1 шт» или «9 шт».">Количество</label>
                          <input
                            type="text"
                            placeholder="напр., 1 шт"
                            className="input-field"
                            value={editForm.quantity || ""}
                            onChange={e => setEditForm({ ...editForm, quantity: e.target.value })}
                          />
                        </div>
                      </div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Хранение</label><input type="text" className="input-field" value={editForm.storageCond || ""} onChange={e => setEditForm({...editForm, storageCond: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Стандарт (СТО/ГОСТ)</label><input type="text" className="input-field" value={editForm.certCode || ""} onChange={e => setEditForm({...editForm, certCode: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">КБЖУ</label><textarea className="input-field min-h-[60px]" value={editForm.nutritionalInfo || ""} onChange={e => setEditForm({...editForm, nutritionalInfo: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Состав</label><textarea className="input-field min-h-[80px]" value={editForm.composition || ""} onChange={e => setEditForm({...editForm, composition: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Вес места <span className="text-[10px] font-normal opacity-60">(нетто / брутто гофрокороба)</span></label><input type="text" className="input-field" value={editForm.boxWeight || ""} onChange={e => setEditForm({...editForm, boxWeight: e.target.value})} placeholder="напр. Вес места - нетто: 7 кг, брутто: 7,6 кг" /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Спонсор / доп. строка</label><input type="text" className="input-field" value={editForm.sponsorText || ""} onChange={e => setEditForm({...editForm, sponsorText: e.target.value})} /></div>
                      <div><label className="block text-xs text-gray-400 mb-1.5 font-bold uppercase tracking-wider">Доп. текст <span className="text-[10px] font-normal opacity-60">(обечайка, маркетплейс, БИО и т.п.)</span></label><input type="text" className="input-field" value={editForm.extraText || ""} onChange={e => setEditForm({...editForm, extraText: e.target.value})} placeholder="напр. Обечайка 8 Марта, OZON, RU-BIO-112" /></div>
                      <div>
                        <label className="flex items-center gap-3 cursor-pointer select-none p-2.5 rounded-xl bg-[var(--theme-input-bg)] border border-[var(--theme-border)] hover:border-indigo-500/40 transition-colors">
                          <input
                            type="checkbox"
                            className="w-5 h-5 accent-indigo-500 cursor-pointer"
                            checked={!!editForm.isExport}
                            onChange={e => setEditForm({...editForm, isExport: e.target.checked})}
                          />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text)]">Маркетплейс <span className="text-[10px] font-normal opacity-60">(метка «МП» на печати)</span></span>
                            <span className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">На фоне этикетки будет напечатана крупная серая «МП» — складу видно, что товар для маркетплейса</span>
                          </div>
                        </label>
                      </div>
                      <div>
                        <label className="flex items-center gap-3 cursor-pointer select-none p-2.5 rounded-xl bg-[var(--theme-input-bg)] border border-[var(--theme-border)] hover:border-cyan-500/40 transition-colors">
                          <input
                            type="checkbox"
                            className="w-5 h-5 accent-cyan-500 cursor-pointer"
                            checked={!!editForm.isShkLabel}
                            onChange={e => setEditForm({...editForm, isShkLabel: e.target.checked})}
                          />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text)]">Этикетка ШК <span className="text-[10px] font-normal opacity-60">(только штрихкод и название, две на одной)</span></span>
                            <span className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">Применяется упрощённый шаблон: только название и штрихкод, без производителя/состава/иконок. На каждой 70×90 мм печатаются ДВЕ одинаковые копии с линией реза посередине — оператор разрезает ножницами и получает две 70×45 мм этикетки.</span>
                          </div>
                        </label>
                      </div>
                      <div>
                        <label className="flex items-center gap-3 cursor-pointer select-none p-2.5 rounded-xl bg-[var(--theme-input-bg)] border border-[var(--theme-border)] hover:border-emerald-500/40 transition-colors">
                          <input
                            type="checkbox"
                            className="w-5 h-5 accent-emerald-500 cursor-pointer"
                            checked={!!editForm.showCedarLogo}
                            onChange={e => setEditForm({...editForm, showCedarLogo: e.target.checked})}
                          />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text)]">Логотип «Сибирский Кедр» <span className="text-[10px] font-normal opacity-60">(отдельные позиции)</span></span>
                            <span className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">Когда включено — слева от блока с производителем печатается корпоративный логотип. Шрифт контактов сжимается с 24 px до 20 px, чтобы 4 строки адреса уместились в ту же высоту. На ШК-этикетках флаг не действует (там отдельный шаблон без блока изготовителя).</span>
                          </div>
                        </label>
                      </div>
                      <div>
                        <div className="p-2.5 rounded-xl bg-[var(--theme-input-bg)] border border-[var(--theme-border)]">
                          <div className="flex flex-col mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text)]">Даты изготовления/годен до</span>
                            <span className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">В режиме «Авто» даты скрываются на этикетках из папок «Весовые» (готовим место под «Честный знак») и показываются на всех остальных. Переключатель позволяет принудительно скрыть или показать даты независимо от папки.</span>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {([
                              { v: null, label: "Авто" },
                              { v: true, label: "Показать" },
                              { v: false, label: "Скрыть" },
                            ] as const).map((opt, i) => {
                              const current = editForm.showLabelDates ?? null;
                              const active = current === opt.v;
                              return (
                                <label
                                  key={i}
                                  className={`flex-1 min-w-[100px] flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border transition-colors ${active ? "bg-emerald-500/10 border-emerald-500/40 text-[var(--theme-text)]" : "bg-transparent border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-emerald-500/40"}`}
                                >
                                  <input
                                    type="radio"
                                    name="showLabelDates"
                                    className="w-4 h-4 accent-emerald-500 cursor-pointer"
                                    checked={active}
                                    onChange={() => setEditForm({ ...editForm, showLabelDates: opt.v })}
                                  />
                                  <span className="text-xs font-semibold">{opt.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="p-2.5 rounded-xl bg-[var(--theme-input-bg)] border border-[var(--theme-border)]">
                          <div className="flex flex-col mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text)]">Производитель</span>
                            <span className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">Какой блок «Изготовитель» печатается на этикетке. По умолчанию — Эко-фабрика. Переключите, если товар выпускается под ИП Абдуалиев.</span>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <label className={`flex-1 min-w-[140px] flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border transition-colors ${(!editForm.manufacturerType || editForm.manufacturerType === "ekofabrika") ? "bg-cyan-500/10 border-cyan-500/40 text-[var(--theme-text)]" : "bg-transparent border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-cyan-500/40"}`}>
                              <input
                                type="radio"
                                name="manufacturerType"
                                value="ekofabrika"
                                className="w-4 h-4 accent-cyan-500 cursor-pointer"
                                checked={!editForm.manufacturerType || editForm.manufacturerType === "ekofabrika"}
                                onChange={() => setEditForm({...editForm, manufacturerType: "ekofabrika"})}
                              />
                              <span className="text-xs font-semibold">Эко-фабрика</span>
                            </label>
                            <label className={`flex-1 min-w-[140px] flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border transition-colors ${editForm.manufacturerType === "abdualiev" ? "bg-cyan-500/10 border-cyan-500/40 text-[var(--theme-text)]" : "bg-transparent border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-cyan-500/40"}`}>
                              <input
                                type="radio"
                                name="manufacturerType"
                                value="abdualiev"
                                className="w-4 h-4 accent-cyan-500 cursor-pointer"
                                checked={editForm.manufacturerType === "abdualiev"}
                                onChange={() => setEditForm({...editForm, manufacturerType: "abdualiev"})}
                              />
                              <span className="text-xs font-semibold">ИП Абдуалиев</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col border-b border-[var(--theme-border)] pb-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[var(--theme-text-muted)] text-xs">Название</span>
                          {selected.name && /\.btw\b|\r|\n/.test(selected.name) && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20" title="В названии есть .btw или перенос строки — нужно почистить через «Редактировать»">⚠ Нечистое</span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-[var(--theme-text)] leading-snug whitespace-pre-wrap break-words">{selected.name || "—"}</span>
                      </div>
                      {selected.btwFilePath && (() => {
                        const seg = selected.btwFilePath.split(/[\\/]/).pop() || "";
                        const dirty = /\.btw[\s\S]+/i.test(seg) || /[\r\n]/.test(seg);
                        return (
                          <div className="flex flex-col border-b border-[var(--theme-border)] pb-2.5">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[var(--theme-text-muted)] text-xs">Имя файла</span>
                              {dirty && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20" title="В имени файла есть .btw в середине или перенос строки — почистите через «Редактировать»">⚠ Нечистое</span>
                              )}
                            </div>
                            <span className="text-xs font-mono text-[var(--theme-text)] bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)] whitespace-pre-wrap break-all">{seg}</span>
                          </div>
                        );
                      })()}
                      {/* Read-only inspector shows ONLY fields that have a
                          value. Empty ones (would render "—") are hidden so the
                          operator sees just the real data. The EDIT form still
                          lists every field so they can be filled in. */}
                      {(selected.sku || selected.sku2) && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mt-1">Артикул{selected.sku2 ? " / Артикул 2" : ""}</span><span className="font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded tracking-widest text-[11px]">{[selected.sku, selected.sku2].filter(Boolean).join(" / ")}</span></div>
                      )}
                      {selected.barcodeEan13 && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mt-1">Штрихкод</span><span className="font-mono text-[var(--theme-text)] bg-[var(--theme-overlay)] border border-[var(--theme-border)] px-2 py-0.5 rounded tracking-wider text-[11px]">{selected.barcodeEan13}</span></div>
                      )}
                      {selected.weight && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">Масса</span><span className="font-semibold text-[var(--theme-text)]">{selected.weight}</span></div>
                      )}
                      {selected.quantity && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs" title="Печатается на этикетке вместо или рядом с массой (например, «9 шт»)">Количество</span><span className="font-semibold text-[var(--theme-text)]">{selected.quantity}</span></div>
                      )}
                      {selected.certCode && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">Стандарт</span><span className="font-semibold text-[var(--theme-text)] leading-none mt-0.5">{selected.certCode}</span></div>
                      )}
                      {selected.boxWeight && (
                        <div className="flex flex-col border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1">Вес места</span><span className="text-xs text-[var(--theme-text)]">{selected.boxWeight}</span></div>
                      )}
                      {selected.sponsorText && (
                        <div className="flex flex-col border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1">Спонсор</span><span className="text-xs text-[var(--theme-text)]">{selected.sponsorText}</span></div>
                      )}
                      {selected.storageCond && (
                        <div className="flex flex-col border-b border-[var(--theme-border)] pb-3 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">Срок и условия </span><span className="text-xs text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)]">{selected.storageCond}</span></div>
                      )}
                      {selected.composition && (
                        <div className="flex flex-col border-b border-[var(--theme-border)] pb-3 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">Состав</span><span className="text-xs text-justify text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)] whitespace-pre-wrap">{selected.composition}</span></div>
                      )}
                      {selected.extraText && (
                        <div className="flex flex-col border-b border-[var(--theme-border)] pb-3 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">Доп. текст</span><span className="text-xs text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)] italic">{selected.extraText}</span></div>
                      )}
                      {selected.isExport && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">Маркетплейс</span><span className="font-bold text-[10px] tracking-wider px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400">МП • на этикетке</span></div>
                      )}
                      {selected.isShkLabel && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">ШК этикетка</span><span className="font-bold text-[10px] tracking-wider px-2 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/40 text-cyan-600 dark:text-cyan-400">Только ШК + 2 копии</span></div>
                      )}
                      {selected.showCedarLogo && (
                        <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1"><span className="text-[var(--theme-text-muted)] text-xs">Логотип</span><span className="font-bold text-[10px] tracking-wider px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400">«Сибирский Кедр» — печатается</span></div>
                      )}
                      {(() => {
                        // Mirror /api/render/route.ts showLabelDates logic.
                        const isWeightFolder =
                          typeof selected.btwFilePath === "string" &&
                          /\\[^\\]*[Ее]совые?[^\\]*\\/i.test(selected.btwFilePath);
                        const explicit = selected.showLabelDates === true || selected.showLabelDates === false;
                        const showDates = selected.showLabelDates === true
                          ? true
                          : selected.showLabelDates === false
                            ? false
                            : !isWeightFolder;
                        return (
                          <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1">
                            <span className="text-[var(--theme-text-muted)] text-xs">Даты</span>
                            <span className={`font-bold text-[10px] tracking-wider px-2 py-1 rounded-md ${showDates ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400"}`}>
                              {showDates ? "Печатаются" : "Скрыты"}{!explicit && <span className="ml-1 opacity-60 font-normal">(авто)</span>}
                            </span>
                          </div>
                        );
                      })()}
                      {(() => {
                        // Mirror /api/render/route.ts isAbdualievProduct logic.
                        const isAbd = selected.manufacturerType === "abdualiev"
                          ? true
                          : selected.manufacturerType === "ekofabrika"
                            ? false
                            : typeof selected.btwFilePath === "string" &&
                              /(\\Цех ПЦО\\Орехи\\ИП Абдуалиев\\|\\МП\\ПЦПО\\)/i.test(selected.btwFilePath);
                        const isExplicit = selected.manufacturerType === "abdualiev" || selected.manufacturerType === "ekofabrika";
                        return (
                          <div className="flex justify-between border-b border-[var(--theme-border)] pb-2.5 pt-1">
                            <span className="text-[var(--theme-text-muted)] text-xs">Производитель</span>
                            <span className={`font-bold text-[10px] tracking-wider px-2 py-1 rounded-md ${isAbd ? "bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400" : "bg-emerald-500/15 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400"}`}>
                              {isAbd ? "ИП Абдуалиев" : "Эко-фабрика"}{!isExplicit && <span className="ml-1 opacity-60 font-normal">(авто)</span>}
                            </span>
                          </div>
                        );
                      })()}
                      {selected.nutritionalInfo && (
                        <div className="flex flex-col pb-1 pt-1"><span className="text-[var(--theme-text-muted)] text-xs mb-1.5">КБЖУ</span><span className="text-xs text-justify text-[var(--theme-text)] leading-relaxed bg-[var(--theme-input-bg)] p-2 rounded-lg border border-[var(--theme-border)]">{selected.nutritionalInfo}</span></div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Action Board (Print Prep) */}
              <div
                style={{ order: blockOrder.indexOf("print") }}
                onDragOver={handleBlockDragOver("print")}
                onDragLeave={() => dragOverBlock === "print" && setDragOverBlock(null)}
                onDrop={handleBlockDrop("print")}
                className={`glass-card overflow-hidden mb-6 transition-all ${
                  draggingBlock === "print" ? "opacity-40" : ""
                } ${
                  dragOverBlock === "print" && draggingBlock !== "print"
                    ? "ring-2 ring-indigo-500/50 shadow-[0_0_24px_rgba(99,102,241,0.25)]"
                    : ""
                }`}
              >
                <div className="bg-[var(--theme-overlay)] border-b border-[var(--theme-border)] px-5 py-3 font-bold text-[10px] text-[var(--theme-text-muted)] uppercase tracking-widest flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div> Подготовка к печати</div>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] font-bold text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">70×90 мм</div>
                    <DragHandle
                      onDragStart={handleBlockDragStart("print")}
                      onDragEnd={handleBlockDragEnd}
                      dragging={draggingBlock === "print"}
                    />
                  </div>
                </div>
                <div className="p-5 flex flex-col gap-5">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1.5 min-h-[18px]">
                        <label className="block text-[10px] font-bold text-[var(--theme-text-muted)] tracking-wider">ДАТА ИЗГОТОВЛЕНИЯ</label>
                      </div>
                      <input type="date" value={mfgDateStr} onChange={e => { setMfgDateStr(e.target.value); setMfgDateAuto(false); }} className="w-full bg-[var(--theme-input-bg)] text-[var(--theme-text)] border border-[var(--theme-border)] p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none font-mono cursor-pointer transition-all" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1.5 min-h-[18px] gap-2">
                        <label className="block text-[10px] font-bold text-[var(--theme-text-muted)] tracking-wider">ГОДЕН ДО</label>
                        <div className="flex items-center gap-1.5">
                          {/* Quick-switch срока хранения 6/9/12 мес. Активная —
                              та что совпадает с effectiveShelfMonths. Клик
                              переключает; клик по уже-активной override → сброс
                              к авто (парсеру из storageCond). Ручной override
                              даты (expDateOverrideStr) сбрасывается заодно —
                              иначе он бы победил и пересчёт не поменял бы дату. */}
                          {[6, 9, 12].map((m) => {
                            const isActive = effectiveShelfMonths === m;
                            const isOverrideOnThis = shelfLifeOverride === m;
                            return (
                              <button
                                key={m}
                                type="button"
                                onClick={() => {
                                  if (isOverrideOnThis || m === autoShelfMonths) {
                                    // Клик на override той же цифры — снимаем.
                                    // Клик на цифру, совпадающую с auto, тоже
                                    // просто снимаем override (иначе визуально
                                    // ничего не меняется, а бейдж становится
                                    // амберным, что путает оператора).
                                    setShelfLifeOverride(null);
                                  } else {
                                    setShelfLifeOverride(m);
                                    setExpDateOverrideStr(null);
                                  }
                                }}
                                title={isOverrideOnThis ? "Клик — вернуть автоматический срок" : `Поставить срок ${m} мес`}
                                className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded border transition-all cursor-pointer ${
                                  isActive
                                    ? isOverrideOnThis
                                      ? "bg-amber-500/15 text-amber-500 border-amber-500/40"
                                      : "bg-indigo-500/15 text-indigo-500 border-indigo-500/40"
                                    : "bg-[var(--theme-overlay)] text-[var(--theme-text-muted)] border-[var(--theme-border)] hover:bg-indigo-500/10 hover:text-indigo-500 hover:border-indigo-500/30"
                                }`}
                              >
                                {m}
                              </button>
                            );
                          })}
                          {/* Показываем текущий срок из storageCond если он не 6/9/12 —
                              чтобы оператор видел что было изначально */}
                          {![6, 9, 12].includes(autoShelfMonths) && shelfLifeOverride === null && (
                            <span
                              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--theme-overlay)] text-[var(--theme-text-muted)] border border-[var(--theme-border)]"
                              title="Срок из поля «Срок и условия» — не совпадает с быстрыми кнопками"
                            >
                              {autoShelfMonths}
                            </span>
                          )}
                          {isExpDateManual && (
                            <button
                              type="button"
                              onClick={() => setExpDateOverrideStr(null)}
                              title="Сбросить ручную дату к автоматическому расчёту"
                              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20 cursor-pointer transition-all"
                            >
                              ↺ Авто
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="date"
                        value={expDateInputStr}
                        onChange={(e) => {
                          const v = e.target.value;
                          // If the picked date matches the auto value (or is
                          // empty), drop the override so we go back to auto and
                          // future shelf-life changes take effect.
                          if (!v || v === autoExpDateStr) {
                            setExpDateOverrideStr(null);
                          } else {
                            setExpDateOverrideStr(v);
                          }
                        }}
                        title={isExpDateManual ? "Ручная дата — клик «↺ Авто», чтобы вернуть автоматический расчёт" : "Авто-дата от изготовления + срока хранения; смените, чтобы переопределить"}
                        className={`w-full bg-[var(--theme-input-bg)] p-2.5 rounded-xl text-sm font-mono outline-none cursor-pointer transition-all border ${
                          isExpDateManual
                            ? "border-amber-500/50 text-amber-600 focus:ring-2 focus:ring-amber-500/40"
                            : "border-[var(--theme-border)] text-cyan-500 focus:ring-2 focus:ring-cyan-500/40"
                        }`}
                      />
                    </div>
                  </div>
                  
                  <div className="bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[var(--theme-overlay)] to-[var(--theme-input-bg)] p-6 rounded-2xl flex items-center justify-center border border-[var(--theme-border)] shadow-inner mt-2 overflow-hidden overflow-x-auto relative min-h-[300px]">
                     <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>
                     <div ref={labelRef} className="scale-[0.8] sm:scale-90 origin-center transform-gpu transition-all z-10 p-4 bg-white rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
                      <div className="ring-1 ring-black/10 rounded overflow-hidden">
                        <LabelPreview
                          product={previewProduct}
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
              {currentPath !== "" && isAdmin && (
                <div className="flex gap-2">
                  <button onClick={openMoveFolderModal} className="py-2.5 px-4 shadow-[0_4px_15px_rgba(99,102,241,0.1)] text-[11px] font-bold uppercase tracking-wide bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border border-indigo-500/30 rounded-xl transition-all cursor-pointer flex items-center gap-2">
                    📦 Переместить папку
                  </button>
                  <button
                    onClick={() => {
                      if (!currentPath) return;
                      setConfirmDelete({
                        kind: "folder",
                        title: currentPath,
                        subtitle: "Удалятся ВСЕ этикетки внутри этой папки и её подпапок (без возможности восстановить).",
                        onConfirm: handleDeleteFolder,
                      });
                    }}
                    disabled={deletingItem}
                    className="py-2.5 px-4 shadow-[0_4px_15px_rgba(239,68,68,0.1)] text-[11px] font-bold uppercase tracking-wide bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30 rounded-xl transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                  >
                     🗑️ {deletingItem ? "Удаление..." : "Удалить текущую папку"}
                  </button>
                </div>
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

      {/* Модалка «История печати» переехала в AdminProvider —
          доступна с любой страницы через Sidebar. */}

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

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Доп. текст <span className="text-[10px] font-normal opacity-60">(обечайка / маркетплейс / БИО)</span></label>
                  <input type="text" className="input-field w-full" placeholder="напр. Обечайка 8 Марта, OZON, RU-BIO-112" value={createForm.extraText || ""} onChange={e => setCreateForm({...createForm, extraText: e.target.value})} />
                </div>

                {/* ШК — упрощённый шаблон + двойная копия. Совпадает с
                    чекбоксом в режиме редактирования. */}
                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 cursor-pointer select-none p-2.5 rounded-xl bg-[var(--theme-input-bg)] border border-[var(--theme-border)] hover:border-cyan-500/40 transition-colors">
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-cyan-500 cursor-pointer"
                      checked={!!createForm.isShkLabel}
                      onChange={e => setCreateForm({...createForm, isShkLabel: e.target.checked})}
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text)]">Этикетка ШК <span className="text-[10px] font-normal opacity-60">(только штрихкод и название, две на одной)</span></span>
                      <span className="text-[11px] text-[var(--theme-text-muted)] mt-0.5">Применяется упрощённый шаблон: только название и штрихкод, без производителя/состава/иконок. На каждой 70×90 мм печатаются ДВЕ одинаковые копии с линией реза посередине — оператор разрезает ножницами и получает две 70×45 мм этикетки.</span>
                    </div>
                  </label>
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
      {/* RENAME FILE MODAL — единственная операция, доступная без админ-
          пароля. Меняет только последний сегмент btwFilePath, сервер
          сам чистит слэши и логирует diff. */}
      {isRenamingFile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsRenamingFile(false)}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[500px] flex flex-col" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-1">Имя файла</h2>
            <div className="text-xs text-[var(--theme-text-muted)] mb-4">Меняется только название этикетки в дереве папок. Все остальные данные товара остаются без изменений.</div>
            <input
              type="text"
              className="input-field w-full mb-4"
              value={renameFileName}
              onChange={e => setRenameFileName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveRenameFile(); if (e.key === "Escape") setIsRenamingFile(false); }}
              placeholder="Например: Финики мазафати 200 г.btw"
              autoFocus
              disabled={savingRename}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsRenamingFile(false)} disabled={savingRename} className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors disabled:opacity-50">Отмена</button>
              <button onClick={saveRenameFile} disabled={savingRename || !renameFileName.trim()} className="px-5 py-2 text-sm font-bold bg-amber-500 text-white hover:bg-amber-400 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                {savingRename ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isMovingFile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => { setIsMovingFile(false); setBulkMoving(false); }}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[500px] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-4">Переместить {bulkMoving ? "выбранные товары" : "этикетку"}</h2>
            <div className="text-sm font-semibold text-indigo-500 mb-4 truncate">
              {bulkMoving ? `Выбрано товаров: ${bulkSelectedIds.size}` : selected?.name}
            </div>
            
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
                onClick={() => bulkMoving ? handleBulkMoveToFolder("") : handleMoveFile("")}
                disabled={movingItemUrl}
              >
                 🏠 Корневая директория (без папки)
              </button>

              {allFoldersList.filter(f => f.toLowerCase().includes(moveSearchQuery.toLowerCase())).map(f => (
                <button
                  key={f}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer text-[var(--theme-text)]"
                  onClick={() => bulkMoving ? handleBulkMoveToFolder(f) : handleMoveFile(f)}
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
              <button onClick={() => { setIsMovingFile(false); setBulkMoving(false); }} className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">Отмена</button>
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

      {/* DELETE CONFIRMATION MODAL — guards both the per-label and per-folder
          delete buttons. Operators reported accidental deletes (and one
          phantom-delete scare with «ШБ ТУЛА») — the modal forces a second,
          intentional click before the API fires. Backdrop or Esc closes
          without deleting. */}
      {confirmDelete && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-[var(--color-surface-panel)] border-2 border-red-500/40 rounded-2xl shadow-[0_20px_60px_rgba(239,68,68,0.3)] p-6 w-[480px] max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">⚠️</span>
              <h2 className="text-lg font-bold text-[var(--theme-text)]">
                Удалить {confirmDelete.kind === "file" ? "этикетку" : "папку"}?
              </h2>
            </div>
            <p className="text-xs text-[var(--theme-text-muted)] uppercase tracking-wider mb-2">Точно удалить:</p>
            <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-3 mb-3 text-[var(--theme-text)] font-bold break-words text-sm leading-snug">
              {confirmDelete.title}
            </div>
            {confirmDelete.subtitle && (
              <p className="text-xs text-[var(--theme-text-muted)] mb-3 leading-relaxed">{confirmDelete.subtitle}</p>
            )}
            <p className="text-xs text-rose-500 font-semibold mb-5 flex items-center gap-1.5">
              <span>⚠</span>
              <span>Действие необратимо. Восстановить можно только из бэкапа БД.</span>
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deletingItem}
                className="px-5 py-2 text-sm font-bold tracking-wide text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-overlay)] border border-[var(--theme-border)] rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  const fn = confirmDelete.onConfirm;
                  setConfirmDelete(null);
                  await fn();
                }}
                disabled={deletingItem}
                className="px-5 py-2 text-sm font-bold uppercase tracking-wider bg-red-500 text-white hover:bg-red-600 border-2 border-red-500 rounded-lg shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                🗑️ Да, удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENAME FOLDER MODAL — single-input modal that changes the leaf
          segment of the currently-open folder. Backend reuses PATCH
          /api/folders with `newName` (same code path as move, just leaves
          the parent untouched). */}
      {isRenamingFolder && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => !renamingFolderInProgress && setIsRenamingFolder(false)}
        >
          <div
            className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[460px] max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-1">Переименовать папку</h2>
            <div className="text-sm text-[var(--theme-text-muted)] mb-1">Текущий путь:</div>
            <div className="text-xs font-mono text-indigo-500 mb-4 truncate" title={currentPath}>{currentPath}</div>

            <label className="block text-[10px] font-bold text-[var(--theme-text-muted)] mb-1.5 tracking-wider">НОВОЕ ИМЯ ПАПКИ</label>
            <input
              type="text"
              className="input-field w-full mb-4"
              value={renameFolderInput}
              onChange={(e) => setRenameFolderInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !renamingFolderInProgress) handleRenameCurrentFolder();
                if (e.key === "Escape") setIsRenamingFolder(false);
              }}
              autoFocus
              placeholder="Например: ПЦО (новое имя)"
            />
            <p className="text-[11px] text-[var(--theme-text-muted)] mb-5 leading-relaxed">
              Папка останется в том же родителе, изменится только её имя.
              Все вложенные подпапки и этикетки переедут вместе.
              Слеши (<code>\</code> и <code>/</code>) автоматически заменятся
              на пробел.
            </p>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setIsRenamingFolder(false)}
                disabled={renamingFolderInProgress}
                className="px-4 py-2 text-sm font-bold tracking-wide text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-overlay)] border border-[var(--theme-border)] rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={handleRenameCurrentFolder}
                disabled={renamingFolderInProgress || !renameFolderInput.trim()}
                className="px-5 py-2 text-sm font-bold uppercase tracking-wider bg-amber-500 text-white hover:bg-amber-600 border-2 border-amber-500 rounded-lg shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-all cursor-pointer disabled:opacity-50"
              >
                {renamingFolderInProgress ? "Переименование..." : "✎ Переименовать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOVE FOLDER MODAL — relocates the entire current folder (with all
          its products and subfolders) under a different parent. The list
          excludes the source itself and any descendant of the source so
          the operator can't accidentally create a loop. */}
      {isMovingFolder && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in" onClick={() => setIsMovingFolder(false)}>
          <div className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[500px] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--theme-text)] mb-1">Переместить папку</h2>
            <div className="text-sm text-[var(--theme-text-muted)] mb-1">Куда перенести</div>
            <div className="text-sm font-semibold text-indigo-500 mb-4 truncate" title={currentPath}>📁 {currentPath}</div>

            <input
              type="text"
              className="input-field w-full mb-4"
              placeholder="Поиск папки-приёмника..."
              value={moveFolderSearchQuery}
              onChange={e => setMoveFolderSearchQuery(e.target.value)}
              autoFocus
            />

            <div className="flex-1 overflow-y-auto min-h-[50px] bg-[var(--theme-overlay)] border border-[var(--theme-border)] rounded-xl py-2 px-1 mb-4 custom-scrollbar">
              <button
                className="w-full text-left px-4 py-3 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer border-b border-transparent hover:border-[var(--theme-border)] font-bold mb-1 disabled:opacity-50"
                onClick={() => handleMoveCurrentFolder("")}
                disabled={movingFolderInProgress}
              >
                🏠 Корневая директория (без папки)
              </button>

              {allFoldersList
                .filter((f) => {
                  // Hide the source itself + any descendant (would create a loop)
                  const lower = f.toLowerCase();
                  const srcLower = currentPath.toLowerCase();
                  if (lower === srcLower) return false;
                  if (lower.startsWith(srcLower + "\\")) return false;
                  return f.toLowerCase().includes(moveFolderSearchQuery.toLowerCase());
                })
                .map((f) => (
                  <button
                    key={f}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--theme-input-bg)] rounded-lg transition-colors cursor-pointer text-[var(--theme-text)] disabled:opacity-50"
                    onClick={() => handleMoveCurrentFolder(f)}
                    disabled={movingFolderInProgress}
                  >
                    📁 {f}
                  </button>
                ))}
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={() => setIsMovingFolder(false)} className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

