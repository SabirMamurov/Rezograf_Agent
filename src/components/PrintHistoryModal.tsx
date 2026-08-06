"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = {
  id: string; createdAt: string; ip: string | null;
  productId: string | null; productName: string | null; barcode: string | null;
  format: string; copies: number; sizeBytes: number | null; renderTimeMs: number | null;
};

export default function PrintHistoryModal({
  open, onClose, isAdmin,
}: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(200);
  const [editingIp, setEditingIp] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");

  const load = useCallback(async (l: number = limit) => {
    setLoading(true);
    try {
      const [h, a] = await Promise.all([
        fetch(`/api/print-history?limit=${l}`).then(r => r.json()),
        fetch("/api/ip-aliases").then(r => r.json()),
      ]);
      setEntries(h.entries || []);
      setAliases(a.aliases || {});
    } catch (e) {
      console.error("PrintHistory load:", e);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open) load(limit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  if (!open) return null;

  const cleanIp = (raw: string | null): string => (raw || "").replace(/^::ffff:/, "").trim();

  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  const filtered = q ? entries.filter(e => {
    const alias = aliases[cleanIp(e.ip)] || "";
    const hay = [e.productName, e.barcode, e.productId, alias, e.ip].filter(Boolean).join(" ").toLowerCase().replace(/ё/g, "е");
    return hay.includes(q);
  }) : entries;
  const totalCopies = filtered.reduce((s, e) => s + (e.copies || 1), 0);

  const saveAlias = async (ip: string) => {
    const name = aliasDraft.trim();
    if (!name) {
      // пустое имя = удалить alias
      await fetch(`/api/ip-aliases?ip=${encodeURIComponent(ip)}`, { method: "DELETE" });
      const copy = { ...aliases }; delete copy[ip]; setAliases(copy);
    } else {
      const r = await fetch("/api/ip-aliases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, name }),
      });
      if (r.ok) setAliases({ ...aliases, [ip]: name });
      else alert("Не удалось сохранить (нужен режим редактирования)");
    }
    setEditingIp(null); setAliasDraft("");
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in"
      style={{ paddingLeft: "calc(16rem + 16px)" }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--theme-border)] shrink-0">
          <h2 className="text-lg font-bold text-[var(--theme-text)] flex items-center gap-2">
            <span>📊</span> История печати
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-overlay)] transition-colors text-lg"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 flex gap-2 items-stretch flex-wrap shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-overlay)]/30">
          <input
            className="input-field flex-1 min-w-[240px] h-[44px] text-sm"
            placeholder="Поиск: имя, товар, артикул, штрихкод, IP…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select
            className="input-field h-[44px] w-[140px] text-sm cursor-pointer"
            value={limit}
            onChange={e => { setLimit(Number(e.target.value)); load(Number(e.target.value)); }}
          >
            <option value={50}>50 записей</option>
            <option value={200}>200 записей</option>
            <option value={500}>500 записей</option>
            <option value={1000}>1000 записей</option>
          </select>
          <button
            onClick={() => load(limit)}
            className="h-[44px] px-4 text-xs font-bold uppercase tracking-wide bg-[var(--theme-overlay)] hover:bg-[var(--theme-overlay-hover)] rounded-lg border border-[var(--theme-border)] text-[var(--theme-text)] transition-colors flex items-center gap-1.5"
          >
            <span>↻</span> Обновить
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-[var(--color-surface-panel)] z-10">
              <tr className="border-b border-[var(--theme-border)]">
                <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold whitespace-nowrap">Когда</th>
                <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold whitespace-nowrap">Кто</th>
                <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold">Товар</th>
                <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold whitespace-nowrap">Штрихкод</th>
                <th className="text-center px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold whitespace-nowrap">Копий</th>
                <th className="text-center px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold whitespace-nowrap">Формат</th>
                <th className="text-right px-5 py-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)] font-bold whitespace-nowrap">Время</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-[var(--theme-text-muted)] text-sm">Загрузка…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-[var(--theme-text-muted)] text-sm">
                  {entries.length === 0 ? "Пока пусто — распечатайте что-нибудь через инспектор" : "Ничего не найдено"}
                </td></tr>
              ) : (
                filtered.map(e => {
                  const dt = new Date(e.createdAt);
                  const when = isNaN(+dt) ? e.createdAt :
                    `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth()+1).padStart(2, "0")}.${String(dt.getFullYear()).slice(2)} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
                  const ip = cleanIp(e.ip);
                  const alias = aliases[ip];
                  const isPdf = e.format === "pdf";
                  const editing = editingIp === ip;
                  return (
                    <tr key={e.id} className="border-b border-[var(--theme-border)]/40 hover:bg-[var(--theme-overlay)]/40 transition-colors">
                      <td className="px-5 py-3 text-[13px] font-mono text-[var(--theme-text)] whitespace-nowrap">{when}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {editing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={aliasDraft}
                              onChange={ev => setAliasDraft(ev.target.value)}
                              onKeyDown={ev => {
                                if (ev.key === "Enter") saveAlias(ip);
                                if (ev.key === "Escape") { setEditingIp(null); setAliasDraft(""); }
                              }}
                              placeholder={ip}
                              className="input-field h-[28px] text-xs w-[160px]"
                            />
                            <button
                              onClick={() => saveAlias(ip)}
                              className="h-[28px] px-2 text-[10px] font-bold uppercase bg-emerald-500 text-white rounded hover:bg-emerald-400"
                              title="Сохранить (Enter)"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => { setEditingIp(null); setAliasDraft(""); }}
                              className="h-[28px] px-2 text-[10px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                              title="Отмена (Esc)"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div
                            className={`group flex items-center gap-1.5 ${isAdmin ? "cursor-pointer" : ""}`}
                            onClick={() => {
                              if (!isAdmin || !ip) return;
                              setEditingIp(ip);
                              setAliasDraft(alias || "");
                            }}
                            title={isAdmin ? `Кликни, чтобы подписать ${ip}` : ip}
                          >
                            {alias ? (
                              <>
                                <span className="text-[13px] font-semibold text-[var(--theme-text)]">{alias}</span>
                                <span className="text-[10px] font-mono text-[var(--theme-text-muted)] opacity-60">{ip}</span>
                              </>
                            ) : (
                              <span className="text-[13px] font-mono text-[var(--theme-text-muted)]">{ip || "—"}</span>
                            )}
                            {isAdmin && ip && (
                              <span className="opacity-0 group-hover:opacity-100 text-[10px] text-indigo-500 transition-opacity">✎</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[14px] text-[var(--theme-text)] font-semibold" title={e.productName || ""}>
                        {e.productName || "—"}
                        {e.productId && <div className="text-[11px] font-mono text-[var(--theme-text-muted)] mt-0.5">арт. {e.productId.slice(0, 8)}</div>}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-mono text-[var(--theme-text)] whitespace-nowrap">{e.barcode || "—"}</td>
                      <td className="px-5 py-3 text-center text-[15px] font-bold text-[var(--theme-text)]">{e.copies || 1}</td>
                      <td className="px-5 py-3 text-center whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide ${
                          isPdf
                            ? "bg-rose-500/10 text-rose-500 border border-rose-500/30"
                            : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30"
                        }`}>
                          {isPdf ? "PDF" : "PNG"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[13px] font-mono text-[var(--theme-text-muted)] text-right whitespace-nowrap">{e.renderTimeMs ? `${e.renderTimeMs} мс` : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--theme-border)] text-xs text-[var(--theme-text-muted)] shrink-0 flex items-center justify-between bg-[var(--theme-overlay)]/30">
          <span>Показано: <b className="text-[var(--theme-text)]">{filtered.length}</b> записей · Всего копий: <b className="text-[var(--theme-text)]">{totalCopies}</b></span>
          {isAdmin && <span className="opacity-60">Клик по IP → задать имя оператора</span>}
        </div>
      </div>
    </div>
  );
}
