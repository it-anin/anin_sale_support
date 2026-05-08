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

Two-page React app sharing the same `App.css` and Supabase project.

**Key files — ป้ายราคา (Price Tag):**
- `App.tsx` — entire price-tag app: types, state, Supabase fetch, search, QR generation, print logic, JSX
- `App.css` — all styles for both pages including `@media print` rules
- `supabase.ts` — shared Supabase client (root dir, not src/)
- `vite.config.ts` — Vite config with `host: '0.0.0.0'` for LAN access
- `main.tsx` — React entry point
- `index.html` — HTML shell
- `.env` — VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ADMIN_PASSWORD

**Key files — ฉลากยา (Drug Label):**
- `druglabel/DrugLabelPage.tsx` — main page: search, preview, add/edit/delete modals, print, admin unlock
- `druglabel/Label.tsx` — label render component (95×65 mm), supports 6 languages
- `druglabel/ResultList.tsx` — search result list
- `druglabel/SearchBar.tsx` — search bar component
- `druglabel/supabase.ts` — read client (public views) + write client (schema: `label`)
- `druglabel/types.ts` — `Lang`, `LANGS`, `Medicine`, `ShopSettings` types
- `druglabel/translate.ts` — calls Edge Function `translate-medicine` via Groq API
- `druglabel/format.ts` — `formatBeDate()` Thai Buddhist Era date formatter

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

## localStorage Persistence

Cart and scan history survive browser close / power loss — no need to re-scan after reopening.

| Key | Type | Content |
|---|---|---|
| `cartItems` | `[string, SelectedProduct][]` | รายการที่เลือก (🛒) พร้อม quantity |
| `scannedHistory` | `[string, Product][]` | ประวัติสินค้าที่สแกนบาร์โค้ด |
| `thermalSettings` | object | qrSize / fontSize / skuSize |
| `qrSettings` | object | QR sheet settings |

**Load:** `loadCartFromStorage()` / `loadHistoryFromStorage()` — called as `useState` initializer (runs once on mount).  
**Save:** `useEffect` on each state change → `localStorage.setItem(...)`.  
**Clear:** `clearCart` removes `cartItems`; `clearAll` removes both `cartItems` + `scannedHistory`.  
**Serialize:** Map ↔ `Array.from(map.entries())` / `new Map(entries)` — JSON cannot stringify Map directly.

## Scanner Workflow

- `scannedHistory: Map<string, Product>` — accumulates barcode-scanned products across searches, **persisted to localStorage**
- `lastAutoAddedBarcode: useRef<string>` — prevents double auto-add
- `visibleProducts` = merge of scannedHistory + filteredProducts (deduplicated by sku-unit key)
- `clearAll` also resets scannedHistory and removes its localStorage entry

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

## Drug Label — Database (Supabase)

Schema: `label`

| Table | Columns |
|---|---|
| `medicines` | id, sku, barcode, usage_ref |
| `medicine_translations` | medicine_id, lang, trade_name, generic_name, usage, indication, warning, storage |
| `shop_settings` | id, shop_name_th, shop_name_en, phone, line_id, logo_text |

Public views (read via anon key, public schema):
- `dl_medicines` → `label.medicines`
- `dl_medicine_translations` → `label.medicine_translations`
- `dl_settings` → `label.shop_settings`

Supabase permissions required:
- SELECT: via public views (anon)
- INSERT/UPSERT: `GRANT INSERT, UPDATE ON label.medicines, label.medicine_translations TO anon`
- DELETE: `GRANT DELETE ON label.medicines, label.medicine_translations TO anon` + RLS policy "public delete"

## Drug Label — Languages

6 ภาษา: `th` ไทย · `en` อังกฤษ · `zh` จีน · `ja` ญี่ปุ่น · `my` พม่า · `km` กัมพูชา

## Drug Label — Branches

3 สาขา (hardcoded ใน `BRANCH_PROFILES`):
- `hq` — สาขาชากค้อ / Chak Kho Branch / 082-0311590
- `nine-kilo` — สาขาเก้ากิโล / Kao Ki Lo Branch / 098-8201512
- `suan-suea` — สาขาสวนเสือศรีราชา / Suan Suea SiRacha Branch / 092-2469002

## Drug Label — Print

- `handlePrint()` เปิด `window.open('', '_blank', 'width=420,height=320,left=-1000,top=-1000')` — popup นอกจอเพื่อไม่ให้กระพริบ
- Label size: `@page { size: 95mm 65mm; margin: 0; }`
- ดึง `<style>` และ `<link rel="stylesheet">` จาก parent head มาใส่ใน popup (รวม App.css)

## Drug Label — Delete SKU

- ปุ่ม 🔐 มุมขวาบน preview panel → ใส่ `VITE_ADMIN_PASSWORD` → unlock เป็น 🔓
- เมื่อ unlock แล้วจะเห็นปุ่ม 🗑️ ลบ ข้าง ✏️ แก้ไขข้อมูล
- ลบ `label.medicine_translations` ก่อน แล้วจึงลบ `label.medicines`
- Supabase ต้องมี: `GRANT DELETE ON label.medicine_translations TO anon` และ `GRANT DELETE ON label.medicines TO anon` + RLS policy "public delete" บน `label.medicines`

## Drug Label — Translation Rate Limit

- ใช้ Groq API (`llama-3.3-70b-versatile`) ผ่าน Edge Function `translate-medicine`
- Free tier limit: 100,000 tokens/day — เมื่อถึง limit แสดง "ถึง rate limit — รอประมาณ xx นาที"
- Edge Function คืน `{ error: { type: 'rate_limit', retry_minutes: N } }` status 200 (ไม่ใช่ 500)

## Backup Files

Backup created: `App.backup.20260411_135747.tsx` and `App.backup.20260411_135747.css`
