# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (http://localhost:5173, LAN: http://192.168.x.x:5173)
npm run build     # TypeScript compile + Vite build
npm run preview   # Preview production build
npx vercel --prod # Deploy to Vercel
```

## Architecture

Single-file React app — all logic lives in `App.tsx`, all styles in `App.css`.

**Key files:**
- `App.tsx` — entire application: types, state, Supabase fetch, search, QR generation, print logic, JSX
- `App.css` — all styles including `@media print` rules
- `supabase.ts` — Supabase client (root dir, not src/)
- `vite.config.ts` — Vite config with `host: '0.0.0.0'` for LAN access
- `main.tsx` — React entry point
- `index.html` — HTML shell
- `.env` — VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ADMIN_PASSWORD

## Database (Supabase)

- Table: `products` (barcode, sku, name, unit, price, category, updated_at)
- RLS policies: `public read` (SELECT) + `public write` (ALL) — both enabled
- Search: queries Supabase directly with `.or('name.ilike.%x%,sku.eq.x,barcode.eq.x')` — NOT client-side filter
- On mount: fetches only latest `updated_at` for timestamp display
- Admin upload: CSV → PapaParse → delete all → insert in 500-row chunks

## CSV Format

Columns (zero-indexed): A=Barcode(0), B=Price(1), C=Category(2), E=SKU(4), F=Name(5), G=Unit(6). Row 0 is header, parsing starts from row 1.

## Search Behavior

- Numeric input (digits only): auto-search when ≥ 6 digits; < 6 digits → clear results, wait
- Non-numeric input: debounced 150ms auto-search
- Enter key forces search immediately
- 6-digit exact → `sku.eq(search)` (exact SKU match)
- Other queries → `.or('name.ilike.%x%,barcode.ilike.%x%')` (no sku in OR for non-6-digit)
- Limit 30 results
- Empty search → no results shown (shows scannedHistory instead)
- On new search → hiddenKeys reset automatically
- Barcode exact match → auto-add to cart + scannedHistory (scanner workflow)
- Manual search → must press 🛒 to add (no auto-add)
- Press − to qty=0 → row removed from table automatically
- Table always visible (opacity 0.5 during loading, never hidden)

## Print System

Two separate print modes:

1. **ป้ายราคา** — uses `@media print` in App.css, renders `.print-only` div, A4 landscape
2. **ป้ายบาร์โค้ด (Thermal/QR)** — opens `window.open()` with self-contained HTML+CSS blob

## Label Design — FROZEN ⚠️

Do NOT modify without explicit user instruction:

### ป้ายราคา (Price Label)
- **Size: `width: 4.5cm; height: 4cm; border: 1.5mm solid #1e3a6e`** — FROZEN
- Label structure:
  ```
  ·BIGYA logo (top-right)
  ชื่อสินค้า | หน่วย
  Price / ราคา | [price int, no decimal] | บาท
  Member / สมาชิก | [Math.ceil(price×0.95), no decimal] | บาท
  วันที่ปริ้น + SKU (left) | barcode image (right)
  ```
- Member price: `Math.ceil(price × 0.95)` — always round up, no decimals shown
- Bottom-left: print date (`toLocaleDateString('th-TH')`) + SKU
- No decimal shown on either price or member price

### ป้ายบาร์โค้ด (Thermal/QR Sticker)
- handlePrintThermal / handlePrintQr code — FROZEN (alignment confirmed correct)
- Sticker shows: QR image | ชื่อสินค้า / SKU / หน่วย (no barcode number)
- Font: Sarabun (Google Fonts loaded in blob HTML)
- Sheet/grid: HARDCODED via `FIXED_THERMAL` constant (do NOT expose settings modal)

## FIXED_THERMAL (hardcoded, do not change without explicit instruction)

```ts
const FIXED_THERMAL = { sheetW: 90, sheetH: 62, cols: 4, rows: 5, gapX: 2, gapY: 2, offsetTop: 0, offsetLeft: 1 };
```
Only `qrSize`, `fontSize`, `skuSize` are user-adjustable (via Live Preview sliders, persisted to localStorage).

## Scanner Workflow

- `scannedHistory: Map<string, Product>` — accumulates barcode-scanned products across searches
- `lastAutoAddedBarcode: useRef<string>` — prevents double auto-add
- `visibleProducts` = merge of scannedHistory + filteredProducts (deduplicated by sku-unit key)
- `clearAll` also resets scannedHistory

## UI — Button Styles — FROZEN ⚠️

All main action buttons use the same **Neon Gold** style (do NOT revert to plain styles):
- `.btn-premium` — พิมพ์ป้ายราคา
- `.btn-outline` — พิมพ์บาร์โค้ด
- `.btn-cart-toggle` — รายการที่เลือก / เลือกทั้งหมด / ลบทั้งหมด

Gold gradient: `linear-gradient(135deg, #d4af37, #f2d98d)`, border `1.5px solid #f2d98d`, hover neon glow.

## UI — Live Preview Cards

Two separate `.live-preview-panel` blocks, each rendered **conditionally**:
1. **ป้ายราคา** — shows only when `previewPriceProduct != null` (click 🔍 in ปริ้นป้ายราคา column)
2. **ป้ายบาร์โค้ด** — shows only when `previewBarcodeProduct != null` (click 🔍 in ปริ้นป้ายบาร์โค้ด column)

Each panel has a close (✕) button and includes product name in subheader.

## UI — Misc

- Hero header: `<h1 className="logo-premium">ANIN LABEL AND BARCODE</h1>` — single line, no split logo structure
- Admin panel shows R05.106 label, Enter key to verify password, Last Updated badge (no version badge)

## Backup Files

Backup created: `App.backup.20260411_135747.tsx` and `App.backup.20260411_135747.css`
