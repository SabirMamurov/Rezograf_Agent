"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import PrintHistoryModal from "@/components/PrintHistoryModal";

type AdminContextValue = {
  isAdmin: boolean;
  loading: boolean;
  openPrompt: () => void;
  lock: () => Promise<void>;
  openPrintHistory: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within <AdminProvider>");
  return ctx;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const [promptOpen, setPromptOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Модалка «История печати» — открывается из Sidebar (кнопка над
  // «Только просмотр»/«Редактирование»), доступна с любой страницы.
  const [historyOpen, setHistoryOpen] = useState(false);
  const openPrintHistory = useCallback(() => setHistoryOpen(true), []);

  // On mount ask the server whether this browser already carries a valid
  // admin cookie (the operator may have unlocked earlier — it persists ~90d).
  useEffect(() => {
    let alive = true;
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setIsAdmin(!!d.isAdmin);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const openPrompt = useCallback(() => {
    setPassword("");
    setError("");
    setPromptOpen(true);
  }, []);

  const lock = useCallback(async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lock" }),
      });
    } catch {
      /* ignore network error — UI will reflect locked state regardless */
    }
    setIsAdmin(false);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        setIsAdmin(true);
        setPromptOpen(false);
        setPassword("");
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Неверный пароль");
      }
    } catch {
      setError("Ошибка соединения с сервером");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminContext.Provider value={{ isAdmin, loading, openPrompt, lock, openPrintHistory }}>
      {children}

      <PrintHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        isAdmin={isAdmin}
      />

      {promptOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setPromptOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface-panel)] border border-[var(--theme-border)] rounded-2xl shadow-2xl p-6 w-[400px]"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-xl">
                🔒
              </div>
              <div>
                <h2 className="text-lg font-bold text-[var(--theme-text)] leading-tight">
                  Режим редактирования
                </h2>
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Доступ к изменению данных
                </p>
              </div>
            </div>
            <p className="text-sm text-[var(--theme-text-muted)] mb-3">
              Введите пароль, чтобы разблокировать создание и изменение этикеток
              и папок. Достаточно ввести один раз на этом устройстве.
            </p>
            <input
              autoFocus
              type="password"
              className="input-field w-full mb-2"
              placeholder="Пароль"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
            />
            {error && (
              <div className="text-sm text-red-500 mb-2 font-medium">{error}</div>
            )}
            <div className="flex gap-3 justify-end mt-4">
              <button
                type="button"
                onClick={() => setPromptOpen(false)}
                className="px-4 py-2 text-sm font-bold text-[var(--theme-text-muted)] hover:text-[var(--theme-text)] transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={submitting || !password}
                className="btn-glow px-4 py-2 text-sm disabled:opacity-50"
              >
                {submitting ? "Проверка..." : "Разблокировать"}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminContext.Provider>
  );
}
