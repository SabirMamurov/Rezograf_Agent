"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";

/* ───────── Types ───────── */
interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  subcategory: string | null;
  composition: string | null;
  weight: string | null;
  nutritionalInfo: string | null;
  storageCond: string | null;
  manufacturer: string | null;
  barcodeEan13: string | null;
}

interface ApiResponse {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
  categories: string[];
}

/* ───────── Editable fields config ───────── */
const FIELDS: { key: keyof Product; label: string; type: "text" | "textarea"; placeholder: string }[] = [
  { key: "name", label: "Наименование", type: "text", placeholder: "Название продукта" },
  { key: "category", label: "Категория", type: "text", placeholder: "Например: Конфеты" },
  { key: "weight", label: "Масса", type: "text", placeholder: "Масса нетто: 1 кг" },
  { key: "composition", label: "Состав", type: "textarea", placeholder: "Ингредиенты через запятую…" },
  { key: "nutritionalInfo", label: "Пищевая ценность (КБЖУ)", type: "textarea", placeholder: "Белки — Х г, жиры — Х г, углеводы — Х г. Калорийность — ХХХ ккал" },
  { key: "storageCond", label: "Условия хранения / срок годности", type: "textarea", placeholder: "Хранить при t от +5 до +25 °С…" },
  { key: "manufacturer", label: "Производитель", type: "text", placeholder: "ООО «Название»" },
  { key: "barcodeEan13", label: "Штрихкод EAN-13", type: "text", placeholder: "4640201206410" },
  { key: "sku", label: "Артикул (SKU)", type: "text", placeholder: "12345" },
];

/* ───────── Helpers ───────── */
function truncate(s: string | null, max: number) {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function StatusDot({ filled }: { filled: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${filled ? "bg-emerald-400" : "bg-amber-400/60"}`}
      title={filled ? "Заполнено" : "Не заполнено"}
    />
  );
}

/* ═══════════════════════════════════════════════ */
export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  /* Close dropdown on outside click */
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsCategoryOpen(false);
      }
    }
    if (isCategoryOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCategoryOpen]);

  /* Edit modal */
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editData, setEditData] = useState<Partial<Product>>({});
  const [saving, setSaving] = useState(false);

  /* Toast */
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  /* ───── Fetch ───── */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (selectedCategory) params.set("category", selectedCategory);
      params.set("page", String(page));
      params.set("limit", "50");

      const res = await fetch(`/api/products?${params}`);
      const data: ApiResponse = await res.json();
      setProducts(data.products);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      if (data.categories && data.categories.length > 0) {
        setCategories(data.categories);
      }
    } catch {
      flash("Ошибка загрузки данных", false);
    } finally {
      setLoading(false);
    }
  }, [query, selectedCategory, page]);

  useEffect(() => {
    // Increase debounce tightly to 400ms for smooth typing
    const t = setTimeout(() => fetchProducts(), 400);
    return () => clearTimeout(t);
  }, [fetchProducts]);

  /* ───── Stable Callbacks for Memoized Rows ───── */
  const deleteProduct = async (id: string, name: string) => {
    if (!confirm(`Удалить «${name}»?`)) return;
    try {
      const res = await fetch(`/api/products?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setTotal((t) => t - 1);
      flash(`«${name}» удалён`, true);
    } catch {
      flash("Ошибка удаления", false);
    }
  };

  const actionsRef = useRef({ 
    openEdit: (p: Product) => { setEditProduct(p); setEditData({ ...p }); }, 
    deleteProduct, 
    setCategory: (c: string) => { setSelectedCategory(c); setPage(1); } 
  });
  
  actionsRef.current = { 
    openEdit: (p: Product) => { setEditProduct(p); setEditData({ ...p }); }, 
    deleteProduct, 
    setCategory: (c: string) => { setSelectedCategory(c); setPage(1); } 
  };

  const handleEditStable = useCallback((p: Product) => actionsRef.current.openEdit(p), []);
  const handleDeleteStable = useCallback((id: string, name: string) => actionsRef.current.deleteProduct(id, name), []);
  const handleSetCategoryStable = useCallback((c: string) => actionsRef.current.setCategory(c), []);

  /* ───── Edit ───── */
  const openEdit = (p: Product) => {
    setEditProduct(p);
    setEditData({ ...p });
  };

  const closeEdit = () => {
    setEditProduct(null);
    setEditData({});
  };

  const saveEdit = async () => {
    if (!editProduct) return;
    setSaving(true);
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editProduct.id, ...editData }),
      });
      if (!res.ok) throw new Error();
      setProducts((prev) =>
        prev.map((p) => (p.id === editProduct.id ? { ...p, ...editData } as Product : p))
      );
      closeEdit();
      flash("Сохранено", true);
    } catch {
      flash("Ошибка сохранения", false);
    } finally {
      setSaving(false);
    }
  };

/* deleteProduct was moved up */

  /* ───── Computed ───── */
  const withComp = products.filter((p) => p.composition).length;
  const withBarcode = products.filter((p) => p.barcodeEan13).length;

  /* ═══════════════════════════════════ JSX ═══════════════════════════════════ */
  return (
    <>
      <div className="animate-fade-in">
        {/* ── Header ── */}
      <header className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-[var(--color-primary-light)] to-[var(--color-accent)] bg-clip-text text-transparent">
              Каталог продукции
            </span>
          </h1>
          <p className="text-[var(--color-text-muted)] text-[13px] mt-1">
            {total} товаров&ensp;·&ensp;{withComp} с составом&ensp;·&ensp;{withBarcode} со штрихкодом
          </p>
        </div>
        <div className="flex gap-2">
          <span className="badge badge-success text-[11px]">{total} товаров</span>
          {selectedCategory && (
            <button className="badge badge-warning text-[11px] cursor-pointer" onClick={() => { setSelectedCategory(""); setPage(1); }}>
              ✕ {selectedCategory}
            </button>
          )}
        </div>
      </header>

      {/* ── Filters ── */}
      <div className="flex gap-3 mb-5 items-stretch flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            id="catalog-search"
            className="input-field pl-10 text-[13px]"
            placeholder="Искать по названию, штрихкоду…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="relative z-20 min-w-[200px]" ref={dropdownRef}>
          <div
            className="input-field text-[13px] flex items-center justify-between cursor-pointer select-none"
            onClick={() => setIsCategoryOpen(!isCategoryOpen)}
          >
            <span className={selectedCategory ? "text-[var(--theme-text)]" : "text-[var(--color-text-muted)]"}>
              {selectedCategory || "Все категории"}
            </span>
            <svg className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-300 ${isCategoryOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          
          {isCategoryOpen && (
            <div className="absolute top-[calc(100%+8px)] left-0 w-full bg-[var(--theme-glass)] backdrop-blur-xl border border-[var(--theme-border)] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.2)] overflow-hidden z-[100] animate-fade-in flex flex-col p-1.5">
              <div 
                className={`px-4 py-3 rounded-xl cursor-pointer text-sm shrink-0 transition-all duration-200 ${!selectedCategory ? "bg-indigo-500/20 text-indigo-500 font-bold" : "text-[var(--theme-text)] hover:bg-[var(--theme-overlay)]"}`}
                onClick={() => { setSelectedCategory(""); setPage(1); setIsCategoryOpen(false); }}
              >
                Все категории
              </div>
              <div className="h-px bg-[var(--theme-border)] my-1 mx-2 shrink-0"></div>
              <div className="overflow-y-auto max-h-[300px] flex flex-col gap-1 custom-scrollbar pb-1">
                {categories.map((c) => (
                  <div 
                    key={c} 
                    className={`px-4 py-3 rounded-xl cursor-pointer text-sm shrink-0 transition-all duration-200 truncate ${selectedCategory === c ? "bg-indigo-500/20 text-indigo-500 font-bold" : "text-[var(--theme-text)] hover:bg-[var(--theme-overlay)]"}`}
                    onClick={() => { setSelectedCategory(c); setPage(1); setIsCategoryOpen(false); }}
                    title={c}
                  >
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table w-full table-fixed">
            <thead>
              <tr>
                <th className="w-[30%] pl-4">Продукт</th>
                <th className="w-[38%] pr-4">Состав и Данные</th>
                <th className="w-[20%] pr-4">Характеристики</th>
                <th className="w-[12%] text-right pr-6">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="text-center py-16">
                    <div className="spinner mx-auto mb-3" />
                    <span className="text-[var(--color-text-muted)] text-sm">Загрузка…</span>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-16 text-[var(--color-text-muted)]">
                    Товары не найдены
                  </td>
                </tr>
              ) : (
                products.map((p, i) => (
                  <ProductRow
                    key={p.id}
                    p={p}
                    index={i}
                    page={page}
                    onEdit={handleEditStable}
                    onDelete={handleDeleteStable}
                    onSetCategory={handleSetCategoryStable}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-border)]">
            <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
              Стр.&nbsp;{page}&nbsp;из&nbsp;{totalPages}&ensp;·&ensp;{total}&nbsp;товаров
            </span>
            <div className="flex gap-1">
              <PgBtn label="←" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} />
              {paginationRange(page, totalPages).map((n, i) =>
                n === -1 ? (
                  <span key={`dot-${i}`} className="px-1 text-[var(--color-text-muted)] text-xs self-end">…</span>
                ) : (
                  <PgBtn key={n} label={String(n)} onClick={() => setPage(n)} active={n === page} />
                )
              )}
              <PgBtn label="→" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} />
            </div>
          </div>
        )}
      </div>

      </div>

      {/* ═══════ EDIT MODAL ═══════ */}
      {editProduct && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div
            className="modal-content max-w-2xl w-[95%]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-[var(--theme-text)] truncate">{editData.name || "Товар"}</h2>
                <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                  {editProduct.barcodeEan13 && <span className="font-mono">{editProduct.barcodeEan13}&ensp;·&ensp;</span>}
                  {editProduct.category || "Без категории"}
                </p>
              </div>
              <button
                className="ml-4 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--theme-overlay)] hover:text-[var(--theme-text)] transition-colors shrink-0"
                onClick={closeEdit}
              >
                ✕
              </button>
            </div>

            {/* Fields */}
            <div className="space-y-4">
              {FIELDS.map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-[12px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wide mb-1.5">
                    {label}
                  </label>
                  {type === "textarea" ? (
                    <textarea
                      className="input-field text-[13px] leading-relaxed"
                      rows={3}
                      value={(editData[key] as string) || ""}
                      onChange={(e) => setEditData((d) => ({ ...d, [key]: e.target.value }))}
                      placeholder={placeholder}
                    />
                  ) : (
                    <input
                      className="input-field text-[13px]"
                      value={(editData[key] as string) || ""}
                      onChange={(e) => setEditData((d) => ({ ...d, [key]: e.target.value }))}
                      placeholder={placeholder}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-8 pt-5 border-t border-[var(--color-border)] mb-4">
              <button
                className="text-[13px] text-red-400/80 hover:text-red-400 transition-colors cursor-pointer"
                onClick={() => { closeEdit(); deleteProduct(editProduct.id, editProduct.name); }}
              >
                Удалить товар
              </button>
              <div className="flex gap-3">
                <button
                  className="text-[13px] py-2 px-5 rounded-xl border border-[var(--theme-border)] text-[var(--color-text-dim)] hover:text-[var(--theme-text)] hover:border-[var(--theme-border)] hover:bg-[var(--theme-overlay)] transition-colors cursor-pointer"
                  onClick={closeEdit}
                >
                  Отмена
                </button>
                <button
                  className="btn-glow text-[13px] py-2 px-6"
                  onClick={saveEdit}
                  disabled={saving}
                >
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ TOAST ═══════ */}
      {toast && (
        <div className={`toast ${toast.ok ? "toast-success" : "toast-error"}`}>
          {toast.ok ? "✓" : "✕"}&ensp;{toast.msg}
        </div>
      )}
    </>
  );
}

/* ───── Memoized Row Component ───── */
const ProductRow = memo(
  function ProductRow({ p, index, page, onEdit, onDelete, onSetCategory }: any) {
    return (
      <tr
        className="group animate-fade-in cursor-pointer relative"
        style={{ animationDelay: `${index * 8}ms` }}
        onClick={() => onEdit(p)}
        title="Нажмите чтобы редактировать"
      >
        {/* КОЛОНКА 1: Продукт */}
        <td className="py-3 pl-4">
          <div className="flex flex-col gap-1.5 pr-4">
            <div className="font-semibold text-[14px] text-[var(--theme-text)] leading-snug break-words line-clamp-2" title={p.name}>
              {p.name}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {p.category && (
                <span 
                  className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 cursor-pointer hover:bg-indigo-500/20 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onSetCategory(p.category); }}
                >
                  {p.category}
                </span>
              )}
              {p.barcodeEan13 && (
                <span className="font-mono text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5 border border-[var(--theme-border)] bg-[var(--theme-input-bg)] px-2 py-0.5 rounded">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5v14M21 5v14M7 5v14M11 5v14M17 5v14M14 5v14" strokeDasharray="2 2"/></svg>
                  {p.barcodeEan13}
                </span>
              )}
            </div>
          </div>
        </td>

        {/* КОЛОНКА 2: Состав */}
        <td className="py-3 pr-4">
          <div className="flex flex-col justify-center h-full">
            <div className="flex items-start gap-2.5">
              <div className="mt-1 flex-shrink-0"><StatusDot filled={!!p.composition} /></div>
              {p.composition ? (
                <div className="text-[13px] text-[var(--color-text-dim)] leading-relaxed break-words line-clamp-2" title={p.composition}>
                  {p.composition}
                </div>
              ) : (
                <span className="text-[12px] text-amber-500/80 italic">Состав не указан</span>
              )}
            </div>
          </div>
        </td>

        {/* КОЛОНКА 3: Параметры (Масса/Срок) */}
        <td className="py-3 pr-4 align-top">
          <div className="flex flex-col justify-start mt-1 gap-2 text-[12px]">
            {p.weight && (
              <div className="flex items-start gap-1.5 min-w-0">
                <span className="text-[var(--color-text-muted)] shrink-0 w-8">Вес:</span>
                <span className="font-medium text-[var(--color-text-dim)] break-words line-clamp-2">{p.weight}</span>
              </div>
            )}
            {p.storageCond && (
              <div className="flex items-start gap-1.5 min-w-0">
                <span className="text-[var(--color-text-muted)] shrink-0 w-8">Срок:</span>
                <span className="text-[var(--color-text-dim)] break-words line-clamp-3" title={p.storageCond}>{p.storageCond}</span>
              </div>
            )}
          </div>
        </td>

        {/* КОЛОНКА 4: Действия */}
        <td className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-dim)] bg-[var(--theme-overlay)] border border-[var(--theme-border)] hover:bg-[var(--color-primary)] hover:text-white transition-all shadow-sm"
              onClick={() => onEdit(p)}
              title="Редактировать"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] bg-[var(--theme-overlay)] border border-[var(--theme-border)] hover:bg-red-500 hover:text-white border-transparent transition-all shadow-sm"
              onClick={() => onDelete(p.id, p.name)}
              title="Удалить"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    );
  },
  // Custom equality check: only re-render if product data changes
  (prev, next) => prev.p === next.p && prev.index === next.index
);

/* ───── Pagination Button ───── */
function PgBtn({ label, onClick, disabled, active }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      className={`text-[12px] min-w-[28px] h-7 px-1.5 rounded-md border transition-colors tabular-nums cursor-pointer
        ${active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
          : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-primary-light)] hover:text-[var(--theme-text)]"
        }
        ${disabled ? "opacity-25 pointer-events-none" : ""}
      `}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

/* ───── Pagination range with ellipsis ───── */
function paginationRange(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: number[] = [];
  pages.push(1);
  if (current > 3) pages.push(-1); // ellipsis
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push(-1); // ellipsis
  pages.push(total);
  return pages;
}
