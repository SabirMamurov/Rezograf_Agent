# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> `AGENTS.md` warns that this is **Next.js 16.2.2** — App Router APIs, file-system conventions and route-handler signatures may differ from older versions that dominate training data. Before writing route handlers, layouts, or config, check `node_modules/next/dist/docs/` for the current surface.

## Commands

```bash
npm run dev          # Next.js dev server (Turbopack). Falls back to :3001 if :3000 is busy.
npm run build        # Production build
npm run start        # Production server (after build)
npm run lint         # ESLint (flat config in eslint.config.mjs)

# Database — SQLite at prisma/dev.db (gitignored; must be provisioned)
npx prisma migrate deploy     # Apply migrations (creates empty dev.db if missing)
npx prisma generate           # Regenerate client after schema.prisma changes
npx tsx prisma/seed.ts                 # Seed 2 demo products
npx tsx prisma/import-catalog.ts       # Import from products_catalog.csv (repo-root)
npx tsx prisma/import-classified.ts    # Import from classified_products.json (repo-root)
```

The dev DB is **not** committed. If the catalog is empty, either copy a populated `prisma/dev.db` from another checkout or run one of the import scripts above. Source CSV/JSON are gitignored — they travel out-of-band.

There is no test suite.

## Architecture

### Data model (`prisma/schema.prisma`)

Two tables: `Template` (dimensions only) and `Product` (flat fields: `name`, `sku`, `composition`, `weight`, `storageCond`, `nutritionalInfo`, `barcodeEan13`, `btwFilePath`, `certCode`, `quantity`, `boxWeight`, `sponsorText`, optional `templateId`). No relations beyond Product → Template.

### Virtual folder tree (important)

There is no `Folder` table. The folder hierarchy on `/print` is **synthesized on every request** from `Product.btwFilePath`, which is a Windows path string always prefixed with `C:\Users\Пользователь\Desktop\extracted_labels\`. `GET /api/folders?prefix=...`:

1. Strips the base prefix
2. Splits remaining path on `\`
3. Treats the first segment as a folder name (if more slashes follow) or a file (if not)

Empty folders are preserved via a sentinel product whose `name === "_folder_marker"`. Folder deletes (`DELETE /api/folders?path=...`) cascade as `prisma.product.deleteMany({ where: { btwFilePath: { startsWith: ... } } })`. When editing catalog features, keep the `btwFilePath` convention intact — dropping or reformatting it will orphan every product from the tree.

### Label rendering pipeline (`POST /api/render`)

The most delicate part of the codebase. It produces pixel-accurate thermal-printer output at a fixed physical size (default 70×90 mm, forced portrait).

Flow:
1. Loads icons from `public/icons/` as base64 data URIs (embedded inline so Puppeteer doesn't network-fetch).
2. Generates a barcode SVG via `src/lib/barcodes.ts` — `normalizeBarcode` dispatches by digit count: 14+`2`→ITF-14, 13→EAN-13 (recomputes check digit), 12→pads to EAN-13, 8→EAN-8, else Code128.
3. `getEmbeddedFontCss()` fetches Roboto Condensed from Google Fonts **once per process** (module-level `fontCssPromise` cache) and inlines every woff2 file as a `data:` URI. The HTML then contains the font binaries directly — `document.fonts.ready` resolves in ~5 ms instead of ~700 ms per request.
4. Builds a self-contained HTML document at a **700 px virtual width with no height limit** (`buildLabelHtml`).
5. Puppeteer measures `.inner.scrollHeight`. If content overflows the target mm, a single uniform `transform: scale()` shrinks `.inner`; then `.canvas` is scaled by `BASE_SCALE ≈ 0.378` to convert CSS px to physical mm.
6. **PDF path** (`format` omitted): `page.setViewport({ dsf: 3 })` → `page.pdf()` at exact mm.
7. **Image path** (`format: "image"`): `page.setViewport({ dsf: 12 })` → `page.screenshot()` of just the label region → **`sharp`** does `.grayscale().threshold(120).resize(559, 719, { kernel: "nearest" })` in native C++ (libvips). Output is pure 1-bit-equivalent B&W at exactly the printer's 203 DPI (Zebra/Xprinter). Any antialiasing here would produce grey pixels that thermal heads render as black blobs. **`dsf=12` is load-bearing.** It has been silently dropped to 6 once in the name of "perf" (commit `64c8985`) and the result was visibly wavy/aliased text on the thermal head — operators reported "не читаемый текст". The pipeline thresholds *before* the nearest-neighbor resize, so each output pixel is one sample picked from a `dsf×dsf` window of an already-binary image. Only `dsf=12` (≈144 source samples per output pixel) gives nearest-neighbor enough centring to produce stable glyph edges; `dsf=6` (~36 samples) flips back-and-forth across oblique edges → moiré. If you ever need to reduce CPU here, swap the order to lanczos-downsample → threshold (smooth grayscale resample, then 1-bit cutoff). Do **not** lower `dsf`.

Three levels of caching keep per-request work minimal:
- **`globalBrowser`** — Puppeteer instance launched once, reused for the lifetime of the process.
- **`warmPage`** — a single page object kept alive across requests. `page.setContent()` resets DOM without paying the ~600 ms CDP `newPage` tax on macOS.
- **`renderQueue` mutex** — serializes access to `warmPage` via a promise chain so two concurrent requests don't clobber each other's viewport/content.

Stale-session recovery: the cached `globalBrowser`/`warmPage` can die between requests (laptop sleep, Chromium crash). The route detects stale-session errors (`Session closed`, `Target closed`, `ProtocolError`, etc. — see `isStaleSessionError`), tears down both caches, and retries the render once. A `browser.on("disconnected")` listener also nulls the cache proactively. Don't add new render paths that bypass `serialize(...)` or skip the retry — the warm caches **will** go stale and a one-shot failure will reach the user as "Ошибка генерации PDF".

`resolveChromiumPath()` picks the executable at runtime: `PUPPETEER_EXECUTABLE_PATH` env var first, else `/snap/bin/chromium` if it exists on Linux, else Puppeteer's bundled Chromium (macOS/Windows/dev). Do **not** hardcode `executablePath` again.

Warm-request budget (macOS, Apple Silicon): PDF ~200 ms, Image ~500 ms. The first request after module init is slower (~2-3 s) because it downloads font files.

**`src/components/LabelPreview.tsx` and the HTML string inside `route.ts` must stay visually identical.** Pixel values, font sizes, margin values, and the duplicate-composition heuristic (`isCompositionDuplicate`) are duplicated across them because the preview is React and the print target is a standalone HTML document rendered by Puppeteer. Change one → change the other.

`isCompositionDuplicate` hides `composition` when `name.includes(comp) || comp.includes(name)` (case-insensitive, slashes stripped). This is intentional — many imported products have `composition` that literally restates the `name`, and printing both wastes 70×90 mm of label area. Real-world impact: ~48% of products with non-empty composition currently fall into this bucket and don't get the composition block on the printed label. When operators report "состав не печатается", check this filter before assuming a data problem.

### Prisma client

`src/lib/prisma.ts` instantiates a singleton with the **`PrismaBetterSqlite3` driver adapter** (`previewFeatures = ["driverAdapters"]` in schema). The DB path is resolved as `path.join(process.cwd(), "prisma", "dev.db")` — keep this in mind when the script's cwd is not the project root.

### Catalog search (`GET /api/products?q=…`)

SQLite's `LOWER()` and `LIKE` are **ASCII-only** — `LOWER('Кедровая')` returns `'Кедровая'` unchanged, so any SQL substring filter silently fails on mixed-case Cyrillic. The route therefore fetches the full filtered set with Prisma and does the substring filter, ranking, and pagination **in JavaScript** using `String.prototype.toLowerCase()` (which is Unicode-aware). The query is whitespace-tokenized and tokens are AND-matched, so word order is irrelevant. With ~3k products this is a few ms; if the catalog grows past tens of thousands, register a custom Unicode collation via the better-sqlite3 driver adapter rather than reverting to in-SQL `LIKE`.

### UI shell

- `src/app/layout.tsx` runs a blocking inline `<script>` before hydration that reads `localStorage.rezograf-theme` and sets/removes `.light` on `<html>`. Default is light theme. Prevents theme flash; do not move theme setup into a React effect.
- `/` redirects to `/print`. Two user-facing routes: `/print` (folder tree + label generation) and `/catalog` (flat editable table). `/changelog` is a static in-code list.
- Tailwind 4 via `@tailwindcss/postcss`. Theme colors come from CSS custom properties (`--theme-*`, `--color-*`) defined in `globals.css`.
- **The `/print` inspector has two states — read-only ("Данные") and edit ("Режим редактирования") — and they list different fields.** When you add an editable field to the edit form, mirror it in the read-only view, otherwise operators conclude the data was wiped. v1.0.3 fixed exactly this: `composition` was editable but never displayed in the inspector, so users opened products and saw no Состав row → reported "составы пропали" even though the DB was untouched.

### Production deploy

The system runs in production on a LAN VM (auth/IP details live in your user MEMORY under `reference_prod_vm.md`). Two relevant facts for code work:

- The VM has a **kernel-level NAT redirect from `:80` to `:3000`** (no nginx/reverse proxy). Operators browse `http://<vm-ip>/` directly. `ss -tlnp` will *not* show anything on 80 — the rule is in `iptables -t nat PREROUTING`. Don't try to "fix" the missing 80 listener.
- The repo has **two `dev.db` copies** on the VM: the authoritative one in `~/rezograf/prisma/dev.db` and a working copy in `~/Rezograf_Agent/prisma/dev.db` that the running app reads. The working copy occasionally goes to 0 bytes (Prisma auto-creates an empty file when something resolves cwd wrong). If `/api/products` starts returning HTTP 500, restore from the authoritative copy. Don't run `prisma migrate` against the working DB without a backup — there are no migrations to apply, and the import scripts will overwrite the catalog.

### `scripts/`

Contains ~35 one-off `.js`/`.ts` utilities (`fix_*`, `analyze_*`, `check_*`, `extract_*`, `import_*`) from prior data-cleanup campaigns. Most talk directly to `prisma/dev.db` via `better-sqlite3` raw SQL, bypassing Prisma. Treat them as historical artefacts — don't import from them, don't extend them in place for new work; copy out what's useful.

## Gotchas

- **Multi-lockfile warning**: this worktree and the repo root each have `package-lock.json`, so Turbopack complains about ambiguous workspace root. Harmless; silence with `turbopack.root` in `next.config.ts` if needed.
- **Native deps**: `better-sqlite3` is a native addon. Rebuild (`npm rebuild better-sqlite3`) after Node version changes or cross-arch moves.
- **Prisma 7 + Node**: `@prisma/streams-local` wants Node ≥ 22. Node 20 works in practice (EBADENGINE warning only).
- **`.gitignore` excludes** `*.db`, `*.csv`, `*.txt`, `*.zip`, `classified_products.json`. Data is out-of-band; never commit it back.
- **`allowedDevOrigins`** in `next.config.ts` pins a specific LAN IP — update when testing from a different device or it will reject the origin.
- **Version bump touches three files**: `package.json`, the badge string in `src/components/Sidebar.tsx`, and a new entry at the top of the `LOGS` array in `src/app/changelog/page.tsx`. Forgetting the sidebar leaves a stale version visible to operators.
- **Two deploy branches**: `claude/sweet-euler-550e72` is what the production VM pulls (see `pm2 cwd`); `main` is what GitHub shows on the repo landing page. Always push to both, otherwise the VM is current but the repo looks dead.
- **React 19 setState-in-render**: history navigation in `src/app/print/page.tsx` defers `history.pushState` via `queueMicrotask` because it sits inside a `setCurrentPath` updater. Doing it synchronously triggers React's "Cannot update a component (Router) while rendering a different component" warning. Apply the same pattern for any router/state side-effect you put in a setState callback.
- **Browser disk cache outlives `pm2 delete + start`**: the deploy recipe (`delete + start`, not `restart`) breaks the *server's* SSG ETag cache, but Next.js 16 still ships `Cache-Control: s-maxage=31536000` for prerendered pages, so operator browsers will happily reuse last week's HTML and 404 on chunks whose build-id no longer exists. Symptom: blank page after deploy, while `curl http://<vm-ip>/print` returns 200 with full HTML and every `/_next/static/chunks/*` returns 200. Tell the operator to hard-reload (`Cmd+Shift+R`) or open `/print` directly. Long-term fix would be sending `no-cache` for HTML responses in `next.config.ts`.
- **`sqlite3` CLI is not installed on the prod VM** — only the Node `better-sqlite3` module is available. To inspect the DB on the VM, drop a `.js` file inside `~/Rezograf_Agent/` (so `require('better-sqlite3')` resolves) and run `node script.js`; running it from `/tmp` will fail with `MODULE_NOT_FOUND`.
