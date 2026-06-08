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

Four-page React app sharing the same `App.css` and Supabase project.  
`currentPage` state in `App.tsx`: `'pricetag' | 'druglabel' | 'stockcheck' | 'customerhistory'`

**Key files — ป้ายราคา (Price Tag):**
- `App.tsx` — entire price-tag app: types, state, Supabase fetch, search, QR generation, print logic, JSX
- `App.css` — all styles for all pages including `@media print` rules
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

**Key files — เช็คสต๊อค (Stock Check):**
- `StockCheckPage.tsx` — stock check page: search-first query, branch tabs, table display
- `upload-stock.mjs` — Node.js script: reads CSV → uploads to Supabase `stock` table (ใช้กับ Task Scheduler)
- `run-upload-stock.bat` — batch wrapper สำหรับ Task Scheduler: แสดง progress บนหน้าจอ ปิดอัตโนมัติเมื่อเสร็จ
- `stock-setup.sql` — SQL สำหรับสร้างตาราง `stock` ใน Supabase
- `วิธีติดตั้ง-task-scheduler.md` — คู่มือตั้งค่า Task Scheduler แบบ step-by-step

**Key files — ประวัติลูกค้า (Customer History):**
- `CustomerHistoryPage.tsx` — customer history page: search by name/phone/product, table display
- `upload-customer-history.mjs` — Node.js script: reads CSV → uploads to Supabase `customer_history` table
- `run-upload-customer-history.bat` — batch wrapper สำหรับ Task Scheduler: แสดง progress บนหน้าจอ ปิดอัตโนมัติเมื่อเสร็จ
- `customer-history-setup.sql` — SQL สำหรับสร้างตาราง `customer_history` ใน Supabase
- `deduplicate-customer.mjs` — script กรองแถวซ้ำระหว่าง 2 ไฟล์ CSV
- `วิธีใช้-deduplicate-customer.md` — คู่มือ deduplicate + delete/truncate + อัพเดทลูกค้าใหม่

## Database (Supabase)

**Table: `products`** (barcode, sku, name, unit, price, category, updated_at)
- RLS: `public read` (SELECT) + `public write` (ALL)
- Search: queries Supabase directly — NOT client-side filter
- On mount: fetches only latest `updated_at` for timestamp display
- Admin upload: CSV → PapaParse → delete all → insert in 500-row chunks

**Table: `stock`** (id, branch, sku, name, qty, unit, price, uploaded_at)
- RLS: `public read stock` (SELECT) + `public write stock` (ALL)
- สร้างด้วย `stock-setup.sql`
- Upload: ผ่าน `upload-stock.mjs` (Node.js script) — ไม่ผ่านเว็บ
- ไม่มี web upload UI — ใช้ Task Scheduler รัน script ทุก 5 นาทีแทน

**Table: `customer_history`** (id, phone, first_name, last_name, sku, product_name, uploaded_at)
- RLS: `public read customer_history` (SELECT) + `public write customer_history` (ALL)
- สร้างด้วย `customer-history-setup.sql`
- Upload: ผ่าน `upload-customer-history.mjs` (Node.js script) — รันมือหรือ Task Scheduler
- **`--append` flag** — `node upload-customer-history.mjs --append` เพิ่มข้อมูลใหม่โดยไม่ลบของเก่า (ค่าเริ่มต้นคือลบทั้งหมดแล้ว insert ใหม่)
- script เติม 0 นำหน้าเบอร์โทรอัตโนมัติถ้า 8 หรือ 9 หลัก
- Deduplicate: ใช้ `deduplicate-customer.mjs` กรองแถวซ้ำก่อน import ข้อมูลย้อนหลัง
- **Chunked delete** — script ลบของเก่าทีละ 1000 แถวเพื่อเลี่ยง Supabase statement timeout (ตาราง 100K+ แถวลบในคำสั่งเดียวจะ timeout)
- **Multi-machine CSV path** — `CSV_CANDIDATES` array เช็คหลาย path ตามลำดับ ใช้ path แรกที่เจอ (รองรับเครื่อง Arm + BigYa-spare)

## CSV Format

**Products CSV** (Admin upload via web):  
Columns (zero-indexed): A=Barcode(0), B=Price(1), C=Category(2), E=SKU(4), F=Name(5), G=Unit(6). Row 0 = header.

**Stock CSV** (export จาก POS → `upload-stock.mjs`):  
Columns (zero-indexed): D=Branch(3), E=SKU(4), F=Name(5), G=จำนวน(6), H=หน่วย(7), I=ราคาต่อหน่วย(8). Row 0 = header.  
Branch mapping (case-insensitive): `Warehouse`→คลังสินค้า, `Front Store`→SRC, `Main KKL`→KKL, `Main SSS`→SSS  
ชื่อไฟล์: `All_stock.csv` — path กำหนดใน `upload-stock.mjs` บรรทัด `CSV_PATH`  

**Customer History CSV** (→ `upload-customer-history.mjs`):  
Columns (zero-indexed): B=Phone(1), C=ชื่อ(2), D=นามสกุล(3), I=SKU(8), J=ชื่อสินค้า(9). Row 0 = header.  
ชื่อไฟล์: `customer_history.csv` — script เช็คหลาย path ตามลำดับ ใช้ path แรกที่เจอ:
1. `C:\Users\Arm\Documents\update_stock\customer_history.csv` (เครื่อง Arm)
2. `C:\Users\BigYa-spare\Documents\update_stock\customer_history.csv` (เครื่อง BigYa-spare)
3. `C:\Users\BigYa-spare\Documents\update_stock\customer_history.CSV` (เครื่อง BigYa-spare, ตัวพิมพ์ใหญ่)

Phone: เติม 0 อัตโนมัติถ้า 8 หรือ 9 หลัก (Excel ตัด 0 นำหน้าออก)
Parser: custom `parseCSV()` — `"` เริ่ม quoted mode เฉพาะตอน `field === ''` เพื่อรองรับ inch symbol `2"` กลางชื่อสินค้า

## Multi-Machine Sync — ข้อควรระวังเมื่อ pull โค้ดข้ามเครื่อง

โปรเจกต์นี้ใช้งานบน 2 เครื่อง: **Arm** (`C:\Users\Arm\Desktop\anin-label 16-5-2026\anin_pricetag_qrcode`) และ **BigYa-spare** (`c:\Users\BigYa-spare\Desktop\SaleSupport`) sync ผ่าน GitHub repo `it-anin/anin_sale_support`

**ขั้นตอนแนะนำเวลา pull โค้ดใหม่:**
```bash
git status                  # เช็คของค้าง — ถ้ามี modified files ให้ commit/stash ก่อน
git pull origin master      # ดึงโค้ดใหม่
npm install                 # sync dependencies ให้ตรง package-lock.json ใหม่
```

**ข้อควรระวัง:**
1. **Working changes ค้าง** — ถ้า `git status` มี modified files → `git pull` จะติด conflict
   - ทางเลือก: `git stash` → `git pull` → `git stash pop`
2. **`package-lock.json` ที่ pull มาจะทับของเก่า** — ต้องรัน `npm install` หลัง pull เพื่อ sync `node_modules` ให้ตรง
3. **CSV path ไม่ต้องแก้** — `CSV_CANDIDATES` ใน `upload-customer-history.mjs` รองรับทั้ง 2 เครื่องอยู่แล้ว
4. **`package-lock.json` ต่างเครื่องอาจ diff กัน** จาก node/npm version ต่างกัน — best practice ให้ commit ลง git เสมอ ถ้า conflict ให้ฝั่งที่รัน `npm install` ล่าสุด commit ทับ

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
| `settings` | id, shop_name_th, shop_name_en, phone, line_id, logo_text |

> ⚠️ ชื่อตารางจริงคือ `label.settings` (ไม่ใช่ `shop_settings`)  
> ข้อมูลร้าน เช่น ชื่อร้าน, เบอร์โทร, LINE ID (`@anin`) — ทั้งหมดเก็บใน Supabase ไม่ได้ hardcode ในโค้ด  
> แก้ไขผ่าน SQL: `UPDATE label.settings SET line_id = '@anin' WHERE id = 1;`

Public views (read via anon key, public schema):
- `dl_medicines` → `label.medicines`
- `dl_medicine_translations` → `label.medicine_translations`
- `dl_settings` → `label.settings`

Supabase permissions required:
- SELECT: via public views (anon)
- INSERT/UPSERT: `GRANT INSERT, UPDATE ON label.medicines, label.medicine_translations TO anon`
- DELETE: `GRANT DELETE ON label.medicines, label.medicine_translations TO anon` + RLS policy "public delete"

## Drug Label — Languages

7 ภาษา: `th` ไทย · `en` อังกฤษ · `zh` จีน · `ja` ญี่ปุ่น · `my` พม่า · `km` กัมพูชา · `ko` เกาหลี

เพิ่มภาษาใหม่ต้องแก้ 3 จุด:
1. `druglabel/types.ts` — เพิ่ม lang code ใน `LANGS` array และ `Lang` type
2. `druglabel/Label.tsx` — เพิ่ม `FIELD_LABELS` mapping ของภาษาใหม่
3. SQL migration — เพิ่ม lang code ใน `CHECK` constraint ของ `label.medicine_translations`

## Drug Label — Branches

3 สาขา (hardcoded ใน `BRANCH_PROFILES`):
- `hq` — สาขาชากค้อ / Chak Kho Branch / 082-0311590
- `nine-kilo` — สาขาเก้ากิโล / Kao Ki Lo Branch / 098-8201512
- `suan-suea` — สาขาสวนเสือศรีราชา / Suan Suea SiRacha Branch / 092-2469002

## Drug Label — Print

- `handlePrint()` เปิด `window.open('', '_blank', 'width=800,height=600,left=-1000,top=-1000')` — popup นอกจอเพื่อไม่ให้กระพริบ
- Label size: `@page { size: 95mm 65mm; margin: 0; }`
- ดึง `<style>` และ `<link rel="stylesheet">` จาก parent head มาใส่ใน popup (รวม App.css)

## Drug Label — Delete SKU

- ปุ่ม 🔐 มุมขวาบน preview panel → ใส่ `VITE_ADMIN_PASSWORD` → unlock เป็น 🔓
- เมื่อ unlock แล้วจะเห็นปุ่ม 🗑️ ลบ ข้าง ✏️ แก้ไขข้อมูล
- ลบ `label.medicine_translations` ก่อน แล้วจึงลบ `label.medicines`
- Supabase ต้องมี: `GRANT DELETE ON label.medicine_translations TO anon` และ `GRANT DELETE ON label.medicines TO anon` + RLS policy "public delete" บน `label.medicines`

## Drug Label — Auto Translate

ทั้ง Add modal และ Edit modal มีปุ่ม "✨ แปลด้วย AI"

**Add modal:** แปลทุกภาษา (ยกเว้น source lang) จากแท็บที่เลือก

**Edit modal (`handleEditAutoTranslate`):**
- แปลเฉพาะภาษาที่ยังว่างอยู่ (ทุก field เป็น empty string) — ไม่เขียนทับภาษาที่มีข้อมูลแล้ว
- ถ้าทุกภาษามีข้อมูลแล้ว → แสดง error "ทุกภาษามีข้อมูลอยู่แล้ว"
- dot indicator บนแท็บ: สีเขียว = มีข้อมูล, สีส้ม (`.dl-lang-dot--missing`) = ยังว่าง

**Flow เพิ่มคำแปลภาษาใหม่ให้ SKU เดิม:**
1. ค้นหา SKU → เลือกรายการ → กด ✏️ แก้ไขข้อมูล
2. คลิกแท็บภาษาที่มีข้อมูลครบ (แนะนำ ไทย หรือ อังกฤษ)
3. กด "✨ แปลด้วย AI" → ระบบแปลเฉพาะแท็บ dot สีส้ม
4. กด 💾 บันทึกการแก้ไข

## Drug Label — Translation Rate Limit

- ใช้ Groq API (`llama-3.3-70b-versatile`) ผ่าน Edge Function `translate-medicine`
- Free tier limit: 100,000 tokens/day — เมื่อถึง limit แสดง "ถึง rate limit — รอประมาณ xx นาที"
- Edge Function คืน `{ error: { type: 'rate_limit', retry_minutes: N } }` status 200 (ไม่ใช่ 500)

## Stock Check — Search Behavior

- Search-first: ไม่โหลดข้อมูลทั้งหมดตอน mount — query Supabase เมื่อพิมพ์เท่านั้น
- Numeric input → `sku ILIKE 'term%'` (prefix match — ขึ้นต้นด้วย)
- Text input → `name ILIKE '%term%'` (contains)
- Filter by branch ผ่าน `.eq('branch', activeTab)`
- Limit 300 รายการต่อการค้นหา
- Tabs (คลังสินค้า / SRC / KKL / SSS) ซ่อนก่อนค้นหา แสดงหลังจาก `searched = true`
- จำนวน/ราคา แสดงโดยตัด decimal: `Math.floor(Number(value))`
- ราคาต่อหน่วยใช้ `.toLocaleString()` เพิ่ม comma

## Stock Check — Navigation

ปุ่ม 📦 สต๊อค ปรากฏในทุกหน้า:
- `App.tsx` hero header (pricetag page)
- `druglabel/DrugLabelPage.tsx` — props: `onGoPriceTag`, `onGoDrugLabel`, `onGoStockCheck`
- `StockCheckPage.tsx` — แสดง active state

## Backup Files

- `App.backup.20260507_110405.tsx` and `App.backup.20260507_110405.css`
- `supabase/functions/translate-medicine/index.backup.20260508_143950.ts` — ก่อนลอง Gemini (ใช้ Groq อยู่)
