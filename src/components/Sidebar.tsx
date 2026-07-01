"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdmin } from "@/components/AdminProvider";

const NAV_ITEMS = [
  {
    href: "/print",
    label: "Печать этикеток",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    ),
  },
  {
    href: "/catalog",
    label: "Каталог продукции",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    href: "/vkusvill",
    label: "ВкусВилл",
    // Barcode glyph — vertical bars of varying widths, evoking the
    // CODE128 strip that's the heart of the ВкусВилл label.
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 6v12M7 6v12M10 6v12M13 6v12M17 6v12M20 6v12" />
      </svg>
    ),
  },
  {
    href: "/package",
    label: "На упаковку",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l9-4 9 4M3 7v10l9 4 9-4V7M3 7l9 4M21 7l-9 4M12 11v10" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isLight, setIsLight] = useState(true);
  const { isAdmin, openPrompt, lock } = useAdmin();

  // `usePathname` на SSR и client может отличаться у Next.js App Router
  // (особенно во время dev/HMR). Сам Next.js на новый прокачанный pathname
  // рендерит правильную ссылку без мерцания, а warning безвреден —
  // подавляем suppressHydrationWarning на nav-контейнере, чтобы не пугать
  // оператора красным баннером в DevTools.
  const activePath = pathname;

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggleTheme = () => {
    const light = !isLight;
    
    // Create or reuse the fade overlay
    let overlay = document.getElementById("theme-fade");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "theme-fade";
      document.body.appendChild(overlay);
    }

    // Set overlay color to the TARGET theme's background
    overlay.style.background = light ? "#f8fafc" : "#0a0a0f";

    // Phase 1: Fade overlay in (covers the current theme)
    overlay.classList.add("active");

    // Phase 2: Switch theme while overlay is opaque, then fade out
    setTimeout(() => {
      setIsLight(light);
      if (light) {
        document.documentElement.classList.add("light");
        localStorage.setItem("rezograf-theme", "light");
      } else {
        document.documentElement.classList.remove("light");
        localStorage.setItem("rezograf-theme", "dark");
      }

      // Small delay to let the browser repaint with new variables
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay!.classList.remove("active");
        });
      });
    }, 300);
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 flex flex-col border-r border-[var(--theme-border)] bg-[var(--color-surface-panel)] backdrop-blur-3xl z-30 shadow-[4px_0_24px_rgba(0,0,0,0.1)] transition-colors duration-300">
      {/* Logo */}
      <div className="px-6 py-8 border-b border-[var(--theme-border)] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent pointer-events-none"></div>
        <Link href="/" className="flex items-center gap-3 no-underline relative z-10 group">
          <div className="w-10 h-10 rounded-xl bg-[var(--theme-workspace)] flex items-center justify-center shadow-lg shadow-indigo-500/10 border border-[var(--theme-border)] group-hover:shadow-indigo-500/30 group-hover:border-indigo-400 transition-all duration-300 overflow-hidden">
            <img src="/logo.png" alt="Rezograf Logo" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
          </div>
          <div>
            <span className="text-xl font-bold bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 bg-[length:200%_auto] animate-[gradient_4s_linear_infinite] bg-clip-text text-transparent drop-shadow-sm">
              Rezograf
            </span>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-[1px] tracking-widest font-medium uppercase">
              Label Platform
            </p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-4 py-6 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            suppressHydrationWarning
            className={`sidebar-link ${
              activePath === item.href || activePath?.startsWith(item.href + "/")
                ? "active"
                : ""
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Edit-mode gate. Locked = view-only (search + change date + print).
          Click to enter the password; once unlocked it stays for ~90 days on
          this device, so operators never re-type it. */}
      <div className="px-4 pb-1">
        {isAdmin ? (
          <button
            onClick={lock}
            title="Выйти из режима редактирования"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wide bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
            Редактирование
            <span className="ml-auto text-[10px] font-semibold opacity-70 normal-case">выйти</span>
          </button>
        ) : (
          <button
            onClick={openPrompt}
            title="Ввести пароль, чтобы редактировать"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wide bg-[var(--theme-input-bg)] text-[var(--theme-text-muted)] border border-[var(--theme-border)] hover:bg-indigo-500/10 hover:text-indigo-500 hover:border-indigo-500/30 transition-all cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Только просмотр
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--theme-border)] relative overflow-hidden flex items-center justify-between">
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-surface)] to-transparent pointer-events-none"></div>
        <Link href="/changelog" className={`text-[11px] font-medium tracking-wide relative z-10 flex items-center gap-2 no-underline transition-colors ${activePath === '/changelog' ? 'text-indigo-500' : 'text-[var(--theme-text-muted, var(--color-text-muted))] hover:text-[var(--theme-text)]'}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse"></span>
          v1.4.27
        </Link>
        
        {/* Theme Toggle */}
        <button 
          onClick={toggleTheme}
          title="Сменить тему"
          className="relative z-10 p-1.5 rounded-lg bg-[var(--theme-input-bg)] border border-[var(--theme-border)] hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-all text-[var(--color-text-muted)] hover:text-indigo-500 cursor-pointer flex items-center justify-center"
        >
          {isLight ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
      </div>
    </aside>
  );
}
