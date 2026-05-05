import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Rezograf — Платформа генерации этикеток",
  description:
    "Внутренняя веб-платформа для динамической генерации производственных этикеток и резографов",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800&family=Roboto+Condensed:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="overflow-x-hidden" suppressHydrationWarning>
        {/*
          Theme flash prevention. Reads the saved theme from localStorage and
          applies the `light` class on <html> BEFORE first paint, so the page
          doesn't briefly render in the wrong theme.
          Next.js 16 dev overlay flagged a raw <script> in a React tree —
          per node_modules/next/dist/docs/01-app/02-guides/scripts.md the
          right way is <Script> from next/script with an id and the
          beforeInteractive strategy (runs before any Next.js code or
          hydration; valid only inside root layout).
        */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('rezograf-theme');if(t==='dark'){document.documentElement.classList.remove('light');}else{document.documentElement.classList.add('light');}}catch(e){}})();`}
        </Script>
        <div className="fixed inset-0 pointer-events-none z-[-1]">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/10 blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-600/10 blur-[100px]" />
        </div>
        <Sidebar />
        <main className="ml-64 min-h-screen p-8 relative z-10">{children}</main>
      </body>
    </html>
  );
}
