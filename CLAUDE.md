# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (http://localhost:5200, LAN: http://192.168.x.x:5200)
npm run build     # TypeScript compile + Vite build
npm run preview   # Preview production build
npx vercel --prod # Deploy to Vercel
```

## Architecture

Six-page React app sharing the same `App.css` and Supabase project.  
`currentPage` state in `App.tsx`: `'pricetag' | 'druglabel' | 'stockcheck' | 'customerhistory' | 'outbound' | 'salesupport'`

**Key files — ป้ายราคา (Price Tag):**
- `App.tsx` — entire price-tag app: types, state, Supabase fetch, search, QR generation, print logic, JSX + page switcher
- `App.css` — all styles for all pages including `@media print` rules
- `AnimatedLogo.tsx` — `AnimatedLogoText` component: letter-by-letter blur-in logo animation (ใช้ในทุกหน้า)
- `supabase.ts` — shared Supabase client (root dir, not src/)
- `pageAccess.tsx` — `PageId`/`PAGE_NAV` config + `PageVisibilityContext` + `usePageVisibility` + `<PageNavRow>` (ปุ่มนำทางกลาง ใช้ทุกหน้า, รู้สถานะเปิด/ปิดหน้า)
- `page-settings-setup.sql` — SQL สร้างตาราง `app_page_settings` (เปิด/ปิดปุ่มแต่ละหน้า)
- `vite.config.ts` — Vite config with `host: '0.0.0.0'` + `port: 5200` for LAN access
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
- `customer-history-incremental-migration.sql` — migration ตารางเดิม: เพิ่ม/backfill `dedupe_key`, ยุบแถวซ้ำ และสร้าง unique index โดยไม่ drop table
- `customer-history-sync-status.sql` — สร้างตารางเก็บสถิติการรัน uploader (ไม่ได้ใช้เป็นแหล่งเวลาของ badge)
- `upload-customer-history.test.mjs` — unit tests สำหรับ parse วันที่, normalize, dedupe, incremental classification และ sync payload
- `deduplicate-customer.mjs` — script กรองแถวซ้ำระหว่าง 2 ไฟล์ CSV
- `วิธีใช้-deduplicate-customer.md` — คู่มือ deduplicate + delete/truncate + อัพเดทลูกค้าใหม่

**Key files — เบิกด่วน (Quick Outbound):**
- `OutboundPage.tsx` — ตารางแถวเบิกสินค้า: lookup SKU/Barcode จากตาราง `products`, อนุมัติด้วยรหัส admin, persist ลง localStorage

**Key files — ซัพพอร์ต (Sale Support):**
- `SaleSupportPage.tsx` — ศูนย์รวมงานซัพพอร์ตการขาย: sidebar 5 เมนู (Order / Request Item / New Product / Ticket / Products), ฟอร์มเพิ่มข้อมูล, popup รายละเอียด, อัปโหลด Excel (Supplier + Product Master), อัปโหลดรูปเข้า Storage
- `salesupport-setup.sql` — SQL สร้างตาราง `ss_*`, `product_master` + storage bucket `salesupport`

**Design galleries (public/*.html):** ไฟล์ HTML เลือกดีไซน์ (เปิดผ่าน dev server เช่น `/outbound-btn-designs.html`) — ใช้เทียบแบบก่อนใส่จริง ไม่ได้ import เข้าแอป

## Login / Auth (ล็อกอินแยกแผนก)

- Gate หน้าแรก: `App.tsx` ถ้ายังไม่ล็อกอิน (`authProfile == null`) → `return <LoginPage />` ก่อนถึง render หลัก (early-return อยู่หลัง hooks ทั้งหมด — อย่าย้ายขึ้นไปก่อน hooks)
- `auth.ts` — เก็บ `PROFILES` (id, label, group, password, icon) + helper `loadAuthProfile` / `saveAuthProfile` / `clearAuthProfile` (persist ผ่าน localStorage key `authProfileId`)
- `LoginPage.tsx` — ใส่รหัสผ่านช่องเดียว → กด "เข้าสู่ระบบ" (หรือ Enter) → ระบบจับคู่รหัสกับ `PROFILES` อัตโนมัติ ไม่ต้องเลือกแผนกก่อน (ไม่มีการ์ดเลือกโปรไฟล์แล้ว)
  - ดีไซน์: พื้นหลัง **Bubble Rise** (ฟองฟ้าลอยขึ้น — `.login-bubbles`/`.login-bubble` สุ่ม 14 ฟองด้วย `useMemo`) + entrance **Cascade** (โลโก้ blur-in → คำโปรย → ช่องรหัส → ปุ่ม ทยอยเข้าตาม `@keyframes loginRise` + `loginCardIn` ใน App.css) — ดีไซน์เลือกจาก `public/login-designs.html` (ผสมแบบ 15 + 17)
- โปรไฟล์ + รหัส (แก้ที่ `auth.ts`): **สาขา** SRC `1234` / KKL `4567` / SSS `9999` · **คลังสินค้า** `0000` · **จัดซื้อ** `1111`
- แถบผู้ใช้ + ปุ่มออกจากระบบ: `.app-userbar` fixed มุมขวาบน แสดงทุกหน้า (render ใน `App.tsx`)
- ⚠️ รหัสอยู่ฝั่ง client (เหมือน `VITE_ADMIN_PASSWORD`) — เป็น gate ใช้งานภายใน ไม่ใช่ security จริง
- ปัจจุบันเป็น **gate เข้าใช้งานอย่างเดียว** — ยังไม่จำกัดสิทธิ์/หน้าตามแผนก (โปรไฟล์เก็บไว้พร้อมต่อยอด role-based ภายหลัง)

## Database (Supabase)

**Table: `products`** (barcode, sku, name, unit, price, category, updated_at)
- RLS: `public read` (SELECT) + `public write` (ALL)
- Search: queries Supabase directly — NOT client-side filter
- On mount: fetches only latest `updated_at` for timestamp display
- Admin upload: CSV → PapaParse → delete all → insert in 500-row chunks

**Table: `stock`** (id, branch, sku, name, qty, unit, price, uploaded_at)
- RLS: `public read stock` (SELECT) เท่านั้น — **ไม่มี public write** (anon เขียนไม่ได้)
- สร้างด้วย `stock-setup.sql` · ตัด write policy ด้วย `lock-rls-readonly.sql`
- Upload: ผ่าน `upload-stock.mjs` (Node.js script) — ไม่ผ่านเว็บ — ใช้ **service_role key** (env `SUPABASE_SERVICE_KEY` หรือ `.env`)
- ไม่มี web upload UI — ใช้ Task Scheduler รัน script ทุก 5 นาทีแทน

**Table: `customer_history`** (id, purchase_date, phone, first_name, last_name, sku, product_name, dedupe_key, uploaded_at)
- RLS: `public read customer_history` (SELECT) เท่านั้น — **ไม่มี public write** (มี PII: เบอร์โทร/ชื่อลูกค้า)
- สร้างด้วย `customer-history-setup.sql` · ตัด write policy ด้วย `lock-rls-readonly.sql`
- Upload: ผ่าน `upload-customer-history.mjs` (Node.js script) — รันมือหรือ Task Scheduler — ใช้ **service_role key** (env `SUPABASE_SERVICE_KEY` หรือ `.env`)
- Upload เป็น incremental เสมอ: เก็บเฉพาะรายการล่าสุดต่อ ลูกค้า+SKU และไม่ลบข้อมูลเก่าทั้งตาราง
- `node upload-customer-history.mjs` ตรวจช่วงย้อนหลัง 7 วัน; `--full-scan` ตรวจทั้งไฟล์; `--append` เป็น alias ของโหมดปกติ
- ก่อนใช้ uploader รุ่น incremental กับตารางเดิม ต้องรัน `customer-history-incremental-migration.sql` หนึ่งครั้ง
- uploader บันทึกสถิติการรันลง `customer_history_sync_status`; ต้องรัน `customer-history-sync-status.sql` หนึ่งครั้ง
- badge หน้า Customer History อ่าน `uploaded_at` ล่าสุดจาก `customer_history` โดยตรง ไม่อ่านจาก sync status
- badge แสดงเฉพาะ `Last Updated : วันเวลา` และโหลดใหม่ทุก 60 วินาที รวมถึงเมื่อ window กลับมา focus/visible
- script เหลือเฉพาะตัวเลขในเบอร์โทร และเติม 0 เมื่อมี 8 หรือ 9 หลักแต่ยังไม่มี 0 นำหน้า
- `dedupe_key` มี unique index; uploader ยุบ CSV และ upsert เฉพาะแถวใหม่/ใหม่กว่าเป็นชุดละ 500
- **Multi-machine CSV path** — `CSV_CANDIDATES` array เช็คหลาย path ตามลำดับ ใช้ path แรกที่เจอ (รองรับเครื่อง Arm + BigYa-spare)

**SaleSupport tables** (สร้างด้วย `salesupport-setup.sql` — RLS: anon ทำได้ทุกอย่าง `for all`):

| Table | ใช้กับเมนู | หมายเหตุ |
|---|---|---|
| `ss_orders` | Order | งานสั่งจอง/สั่งซื้อของลูกค้า ~23 คอลัมน์ (sku, branch, qty, paid_date, customer_name, contact_channel, สถานะ chip: arrived_branch / customer_notified / delivered ฯลฯ) |
| `ss_request_items` | Request Item | ขอสินค้าที่ไม่มีในสต๊อก + supplier, image_url, customer_name |
| `ss_new_products` | New Product | เสนอสินค้าใหม่เข้าร้าน + image_url, quoted_price, status |
| `ss_tickets` | Ticket | แจ้งปัญหา department: Purchase / Warehouse |
| `product_master` | Products | ฐานข้อมูลสินค้าหลักจากไฟล์ Product_Master — **unique constraint ที่ `sku`** (รองรับ upsert) — เมนู Products filter `abc = 'P'` เรียงตาม sku |
| `ss_suppliers` | (autocomplete) | ชื่อ supplier + `details` jsonb เก็บคอลัมน์อื่นทั้งหมดจาก Excel |

- **Storage bucket `salesupport`** (public) — เก็บรูปสินค้าแนบจากเมนู Request Item / New Product (โฟลเดอร์ `request-items/`, `new-products/`) — policy: anon insert + select
- อัปโหลด Excel ผ่านเว็บด้วยไลบรารี `xlsx`: ปุ่ม "อัปโหลด Supplier" (ล้างแล้ว insert ใหม่ทีละ 100 แถว) และ "📤 อัปโหลด Product Master" (จับคู่หัวคอลัมน์ด้วย `MASTER_HEADER_MAP` regex)
- Supplier autocomplete: พิมพ์ ≥ 2 ตัวอักษรใน field Supplier → ค้นจาก `ss_suppliers`
- SKU autocomplete (ฟอร์ม Order): ค้นจากตาราง `products` เติมชื่อ/หน่วยอัตโนมัติ
- Popup Order มี 3 ตราประทับอนุมัติ (ของถึงสาขา / แจ้งลูกค้า / ส่งมอบสินค้า) — กดแล้วบันทึกลง Supabase ทันที

## Customer History — Search Behavior

- Debounce 200ms · ค้นหาแบบ search-first (ไม่โหลดตอน mount)
- 2 คำขึ้นไป → `first_name ILIKE %คำแรก%` **AND** `last_name ILIKE %คำที่สอง%`
- คำเดียว → `.or(first_name / last_name / phone ILIKE %q%)`
- เรียง `purchase_date` จากใหม่ไปเก่า · ดึงดิบสูงสุด `ROW_LIMIT = 1000` แถว
- **ยุบแถวซ้ำฝั่งเว็บ** — key = `phone|first_name|last_name|sku|product_name` เก็บแถวที่ `purchase_date` ล่าสุด
  - ต้องมี phone/ชื่อ ใน key ด้วย ไม่งั้นลูกค้าคนละคนที่ซื้อสินค้าเดียวกันจะถูกยุบรวมกัน
  - ข้อมูลจริง (ก.ค. 2569): 239,200 แถว / ลูกค้า 20,070 คน — ยุบแล้วเหลือ ~67%
  - ลูกค้าที่มีเกิน 1000 แถวมีแค่ `เงินสด` (24,276) กับ `Grab` (1,642) ซึ่งไม่ใช่ลูกค้าจริง → limit 1000 ครบสำหรับลูกค้าจริงทุกคน
- `truncated` state → แสดง "(จากข้อมูล 1,000 แถวล่าสุด)" เมื่อชนเพดาน
- ระหว่างค้นหาแสดง skeleton shimmer (`.ch-skeleton` ใน App.css) — `<thead>` แสดงตลอด สลับแค่ `<tbody>` ความกว้างคอลัมน์เลยไม่กระโดด

## CSV Format

**Products CSV** (Admin upload via web):  
Columns (zero-indexed): A=Barcode(0), B=Price(1), C=Category(2), E=SKU(4), F=Name(5), G=Unit(6). Row 0 = header.

**Stock CSV** (export จาก POS → `upload-stock.mjs`):  
Columns (zero-indexed): D=Branch(3), E=SKU(4), F=Name(5), G=จำนวน(6), H=หน่วย(7), I=ราคาต่อหน่วย(8). Row 0 = header.  
Branch mapping (case-insensitive): `Warehouse`→คลังสินค้า, `Front Store`→SRC, `Main KKL`→KKL, `Main SSS`→SSS  
ชื่อไฟล์: `All_stock.csv` — `CSV_CANDIDATES` ใน `upload-stock.mjs` เช็คหลาย path ใช้ path แรกที่เจอ (เครื่อง Server `C:\Users\AninMainPC\Desktop\run-upload-stock\` ก่อน → Arm → BigYa-spare)  

**Customer History CSV** (export รายงาน **R06.158** จาก Promax → `upload-customer-history.mjs`):  
Columns (zero-indexed): B=วันที่ซื้อ(1, format D/M/YYYY H:MM:SS), X=SKU(23), Y=ชื่อสินค้า(24), AJ=เบอร์โทร(35), AK=ชื่อ(36), AL=นามสกุล(37). Row 0 = header.  
> ⚠️ column layout ผูกกับรูปแบบรายงาน R06.158 — ถ้า Promax เปลี่ยนคอลัมน์ในรายงานนี้ ต้องแก้ index ใน `upload-customer-history.mjs` ตาม  
ชื่อไฟล์: `customer_history.csv` — script เช็คหลาย path ตามลำดับ ใช้ path แรกที่เจอ:
1. `C:\Users\AninMainPC\Desktop\run-upload-stock\customer_history.csv` (เครื่อง Server — ตัวหลักปัจจุบัน)
2. `C:\Users\AninMainPC\Desktop\run-upload-stock\customer_history.CSV` (เครื่อง Server, ตัวพิมพ์ใหญ่)
3. `C:\Users\Arm\Documents\update_stock\customer_history.csv` (เครื่อง Arm)
4. `C:\Users\BigYa-spare\Desktop\run-upload-stock\customer_history.csv` (เครื่อง BigYa-spare Bot)
5. `C:\Users\BigYa-spare\Desktop\run-upload-stock\customer_history.CSV` (เครื่อง BigYa-spare Bot, ตัวพิมพ์ใหญ่)
6. `C:\Users\BigYa-spare\Documents\update_stock\customer_history.csv` (เครื่อง BigYa-spare)
7. `C:\Users\BigYa-spare\Documents\update_stock\customer_history.CSV` (เครื่อง BigYa-spare, ตัวพิมพ์ใหญ่)

Phone: เหลือเฉพาะตัวเลข และเติม 0 อัตโนมัติเมื่อมี 8 หรือ 9 หลักแต่ยังไม่มี 0 นำหน้า
Parser: custom `parseCSV()` — `"` เริ่ม quoted mode เฉพาะตอน `field === ''` เพื่อรองรับ inch symbol `2"` กลางชื่อสินค้า

## Customer History — Recent Changes (2026-07-27 ถึง 2026-07-28)

- เปลี่ยน uploader จาก delete-all/insert-all เป็น incremental และ idempotent
- ยุบข้อมูลให้เหลือรายการซื้อล่าสุดต่อ ลูกค้า+SKU; ใช้เบอร์โทรเป็น customer identity และ fallback เป็นชื่อ+นามสกุล
- เพิ่ม strict date validation, phone normalization, fallback product key และสรุปจำนวนแถวทุกสถานะ
- เพิ่มช่วงตรวจย้อนหลัง 7 วัน, `--full-scan`, batch read/write และ unique `dedupe_key`
- เพิ่ม SQL migration แบบไม่ drop table พร้อม SQL สำหรับ sync status
- เพิ่ม unit tests และ npm script `test:customer-upload`
- เปลี่ยน badge จาก sync status มาอ่าน `customer_history.uploaded_at` โดยตรง เพื่อรองรับข้อมูลที่มาจาก uploader หลายโปรแกรม
- ตัดข้อความจำนวน “เพิ่ม/อัปเดต” ออกจาก badge เหลือเฉพาะเวลาล่าสุด

## Multi-Machine Sync — ข้อควรระวังเมื่อ pull โค้ดข้ามเครื่อง

โปรเจกต์นี้ใช้งานบน 2 เครื่อง: **Arm** (`C:\Users\Arm\Desktop\SaleSupport`) และ **BigYa-spare** (`c:\Users\BigYa-spare\Desktop\SaleSupport`) sync ผ่าน GitHub repo `it-anin/anin_sale_support`

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
  ┌ .lbl-mid (flex:1, justify-content:center) ──────┐
  │ ชื่อสินค้า | หน่วย                                │
  │ Price / ราคา | [price int, no decimal] | บาท     │
  └─────────────────────────────────────────────────┘
  วันที่ปริ้น + SKU (left) | barcode image (right)
  ```
- **ไม่มีแถว Member / ราคาสมาชิก แล้ว** — ตัดออก 2569-08-06 ตามคำสั่งผู้ใช้
- `.lbl-mid` ห่อชื่อสินค้า+ราคาไว้ด้วยกัน แล้วดันให้อยู่กึ่งกลางแนวตั้งในพื้นที่ที่ว่างจากการตัดแถว Member
- Bottom-left: print date (`toLocaleDateString('th-TH')`) + SKU
- No decimal shown on price

**3 จุดที่ต้องแก้พร้อมกันเสมอเมื่อเปลี่ยนโครงป้ายราคา** (JSX ซ้ำกัน 3 ชุดใน `App.tsx`):
1. Live Preview panel (`previewPriceProduct`) — scope CSS `.live-preview-panel`
2. Preview modal (`showPreview`) — scope CSS `.label-preview` (ค่าฐาน)
3. `.print-only` (พิมพ์จริง) — scope CSS `@media print .label-print`

> ⚠️ Live Preview ต้อง override ให้ตรงกับ `.label-print` **ทุก property ที่มีผลต่อ layout** ไม่ใช่แค่ `font-size`
> — `gap` ที่ไม่ตรงกันเคยทำให้ชื่อสินค้าตัดขึ้นบรรทัด 2 แล้วโดน `-webkit-line-clamp: 2` ตัดทิ้งเฉพาะใน preview
> — `font-family` ต้องเป็น `'Inter', 'Sarabun'` เหมือนกัน (เดิม preview ใช้ `'DB GILL SIAM X'` ที่ไม่ได้โหลด)

### Barcode บนป้ายราคา — ห้ามลดขนาด ⚠️
- `generateBarcode()` ใน `App.tsx`: CODE128 `width: 3, height: 90` (อัตราส่วน 4:1)
  — `width` คือความละเอียด px ต่อ module ไม่ใช่ขนาดที่พิมพ์ ยิ่งสูงยิ่งคมตอนพิมพ์
  — ถ้าแก้ `width` ต้องแก้ `height` ตามให้อัตราส่วนคง 4:1 ไม่งั้น `object-fit: contain` จะย่อบาร์โค้ดลง
- ขนาดที่พิมพ์จริง: `height: 0.82cm` → บาร์โค้ด 3.28 × 0.82 cm, แท่งแคบสุด **0.273 มม.**
  (CODE128 ต้องการ ≥ 0.19 มม. — ค่าเดิม 0.7cm ให้แค่ 0.233 มม. สแกนไม่ค่อยติด)
- `.lbl-barcode` ต้องเป็น `flex-shrink: 0` — ถ้าเป็น `1` วันที่/SKU ที่ยาว (เช่น `31/12/2569`)
  จะแย่งความกว้างจนบาร์โค้ดถูกบีบ แท่งแคบลง แล้วสแกนไม่ติด
- ที่ว่างในแถวล่างเหลือ ~2px เท่านั้น — จะขยายกว่านี้ต้องย้ายวันที่/SKU ไปที่อื่นก่อน

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

**Default values (current):** `qrSize: 7mm`, `fontSize: 3.5pt`, `skuSize: 3.5pt`

**Version-based reset:** `THERMAL_SETTINGS_VERSION = 2` — ถ้า localStorage มี version เก่ากว่า จะ reset เป็น default ใหม่อัตโนมัติ  
ต้องการ force reset ทุกเครื่องอีกรอบ → เพิ่ม `THERMAL_SETTINGS_VERSION` เป็น 3 (แล้วอัพเดท default ด้วย)

## localStorage Persistence

Cart and scan history survive browser close / power loss — no need to re-scan after reopening.

| Key | Type | Content |
|---|---|---|
| `cartItems` | `[string, SelectedProduct][]` | รายการที่เลือก (🛒) พร้อม quantity |
| `scannedHistory` | `[string, Product][]` | ประวัติสินค้าที่สแกนบาร์โค้ด |
| `thermalSettings` | object | qrSize / fontSize / skuSize |
| `qrSettings` | object | QR sheet settings |
| `outboundItems` | `OutboundRow[]` | แถวเบิกสินค้าในหน้าเบิกด่วน (รวมสถานะอนุมัติ) |

**Load:** `loadCartFromStorage()` / `loadHistoryFromStorage()` — called as `useState` initializer (runs once on mount).  
**Save:** `useEffect` on each state change → `localStorage.setItem(...)`.  
**Clear:** `clearCart` removes `cartItems`; `clearAll` removes both `cartItems` + `scannedHistory`.  
**Serialize:** Map ↔ `Array.from(map.entries())` / `new Map(entries)` — JSON cannot stringify Map directly.

## Scanner Workflow

- `scannedHistory: Map<string, Product>` — accumulates barcode-scanned products across searches, **persisted to localStorage**
- `lastAutoAddedBarcode: useRef<string>` — prevents double auto-add
- `visibleProducts` = merge of scannedHistory + filteredProducts (deduplicated by sku-unit key)
- `clearAll` also resets scannedHistory and removes its localStorage entry

## Quick Outbound (หน้าเบิกด่วน)

- แถวเบิกเป็น editable table — พิมพ์ SKU/Barcode แล้ว blur หรือกด Enter → `lookupRow()` query ตาราง `products` (`.or('sku.eq.x,barcode.eq.x')`) เติมชื่อ/หน่วยอัตโนมัติ ไม่เจอ → แสดง "ไม่พบสินค้า"
- Branch: dropdown SRC / KKL / SSS
- ปุ่ม **Outbound** ต่อแถว = อนุมัติ: ต้องมี sku+name และ qty > 0 → ใส่รหัส `VITE_ADMIN_PASSWORD` (ครั้งแรกครั้งเดียว — unlock ทั้ง session 🔓) → แถวเปลี่ยนเป็น ✅ อนุมัติแล้ว + timestamp พื้นเขียว แก้ไขไม่ได้
- แถวทั้งหมด (รวมสถานะอนุมัติ) persist ลง localStorage key `outboundItems`
- `clearAll` มี `window.confirm` ก่อนล้าง — ล้างแล้วเหลือ 1 แถวว่างเสมอ
- ปุ่ม เพิ่มแถว / ล้างทั้งหมด (`.outbound-3d-btn`) และ Outbound (`.outbound-approve-btn`) ใช้สไตล์ **Luxe Double Border** โทนฟ้า: พื้นขาว ขอบ `#4891db` 2 ชั้น (border + outline) → hover พื้น `#2d6cad` ตัวอักษรขาว

## UI — Theme

- **โทนสีหลักเปลี่ยนจากทองเป็นฟ้าแล้ว**: hero header พื้น `#4891db` + คลื่น SVG ด้านล่าง, น้ำเงินเข้ม `#2d6cad`, ฟ้าอ่อน `#eaf3fc`
- โลโก้ทุกหน้าใช้ `<AnimatedLogoText text="..." />` (font Lilita One) — ตัวอักษรทยอย blur-in ทีละตัว
- ปุ่มนำทางระหว่างหน้า: `.page-nav-card` การ์ดโปร่งขาว 72×66px มีไอคอน+ป้ายชื่อ อยู่ใน hero ของทุกหน้า (6 ปุ่ม: ป้ายราคา / ฉลากยา / สต๊อค / ประวัติ / เบิกด่วน / ซัพพอร์ต) — หน้าปัจจุบันใส่ `.page-nav-card--active`
- **ไอคอนปุ่มนำทางเป็น inline SVG แบบเส้น ไม่ใช่ emoji แล้ว** (2026-07-28, ดีไซน์ "Line Regular" จาก `public/nav-icon-designs.html`) — `PAGE_NAV[].icon` เป็น `ReactNode` (JSX `<svg>`) ไม่ใช่ string · สไตล์คุมจาก `.page-nav-icon svg` ใน App.css: `stroke: currentColor` + `stroke-width: 1.75` + 21×21px → **ไอคอนเปลี่ยนสีตามปุ่มเอง** (ขาวบนพื้นฟ้า → `#2d6cad` ตอน hover/active) ไม่ต้องเขียน CSS แยกต่อสถานะ
- ไอคอนชุดเดียวกันนี้ถูกใช้ซ้ำใน modal ตั้งค่าเปิด/ปิดหน้า (`.page-toggle-icon svg`, 18×18px สี `#4891db`) เพราะอ่านจาก `PAGE_NAV[].icon` ตัวเดียวกัน — แก้ไอคอนที่ `pageAccess.tsx` ที่เดียวเปลี่ยนทั้ง 2 จุด
- เปลี่ยนหน้า → panel เล่นอนิเมชั่น fadeIn
- **สีทองถูกยกเลิกทั้งหมดแล้ว** (2026-07-28) — ไม่มี `#d4af37` / `#f2d98d` เหลือใน `App.css` แล้ว ปุ่มหลักหน้าป้ายราคา (`.btn-premium`, `.btn-outline`, `.btn-cart-toggle`) เปลี่ยนจาก Neon Gold เป็น **Neon Blue**: `linear-gradient(135deg, #2d6cad, #4891db)` ขอบ `#a9d0f5` ตัวอักษรขาว hover เรืองแสง `rgba(72,145,219,...)`
- พาเลตต์มาตรฐาน: ฟ้าหลัก `#4891db` · น้ำเงินเข้ม `#2d6cad` · ฟ้าอ่อน (พื้นแถวที่เลือก/badge) `#eaf3fc` · ขอบอ่อน `#b8d3ee` / `#cfe0f2` · ขอบสว่างบนพื้นเข้ม `#a9d0f5`
- ⚠️ ไฟล์ที่ยัง**มีสีทองอยู่โดยตั้งใจ** (ไม่ได้ import เข้าแอป ไม่ต้องแก้): `App.backup.20260507_110405.css`, `design-template.css`, `animation-preview.html`, `README.md`, `QUICKSTART.md`

## UI — Live Preview Cards

Two separate `.live-preview-panel` blocks, each rendered **conditionally**:
1. **ป้ายราคา** — shows only when `previewPriceProduct != null` (click 🔍 in ปริ้นป้ายราคา column)
2. **ป้ายบาร์โค้ด** — shows only when `previewBarcodeProduct != null` (click 🔍 in ปริ้นป้ายบาร์โค้ด column)

Each panel has a close (✕) button and includes product name in subheader.

## UI — Misc

- Admin panel shows R05.106 label, Enter key to verify password, Last Updated badge (no version badge)

## Sale Support (หน้าซัพพอร์ต)

- Layout: `.ss-layout` = sidebar ซ้าย (`.ss-sidebar` เมนู 5 อัน) + panel ขวา (toolbar + ตาราง)
- เมนูขับเคลื่อนด้วย config `MENUS: MenuDef[]` — แต่ละเมนูกำหนด table, columns (`kind: 'date' | 'datetime' | 'chip'`), orderBy, filter
- Chip สี: เขียว (`.ss-chip--green`) / แดง / ฟ้า / ส้ม ตามค่าสถานะ
- คลิกแถว → popup รายละเอียด (แก้ไข inline ได้) — Order popup มีตราประทับอนุมัติ 3 ขั้น บันทึกลง Supabase ทันที
- ฟอร์มเพิ่มข้อมูลต่อเมนู + แนบรูป (upload เข้า bucket `salesupport`)
- ฟอนต์หน้านี้: Noto Sans Thai

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

## Page Navigation

- ปุ่มนำทางทุกหน้าใช้ component กลาง `<PageNavRow current=... handlers=... />` จาก `pageAccess.tsx` (เดิม hardcode 6 ปุ่ม `.page-nav-card` ซ้ำทุกไฟล์ — ย้ายมารวมที่ `PAGE_NAV` config)
- ทุกหน้ารับ props ครบชุด: `onGoPriceTag`, `onGoDrugLabel`, `onGoStockCheck`, `onGoCustomerHistory`, `onGoOutbound`, `onGoSaleSupport` → ประกอบเป็น object `handlers` ส่งให้ `PageNavRow`
- `PageId` union + `currentPage` type import จาก `pageAccess.tsx` (ไม่ inline ใน App.tsx แล้ว)
- เพิ่มหน้าใหม่: เพิ่มใน `PageId` union + `PAGE_NAV` array (`pageAccess.tsx` — `icon` ต้องเป็น JSX `<svg>` ห่อด้วย `<Svg>` helper ไม่ใช่ emoji), เพิ่ม prop `onGoXxx` + ส่งใน `handlers` ทุกหน้า, เพิ่ม row ใน `app_page_settings` (SQL), และเพิ่มการ render หน้าใน `App.tsx`

## Page Visibility — เปิด/ปิดปุ่มแต่ละหน้า (admin)

- ปุ่มเฟือง ⚙️ (`.app-userbar-gear`) ในแถบผู้ใช้มุมขวาบน (ทุกหน้า) → ใส่ `VITE_ADMIN_PASSWORD` → toggle เปิด/ปิด 6 หน้า
- เก็บสถานะใน Supabase ตาราง **`app_page_settings`** (`page_id` pk, `visible` bool) — ซิงค์ทุกเครื่อง · สร้างด้วย `page-settings-setup.sql`
- `App.tsx`: fetch ตอน mount → `pageVisibility` state → `PageVisibilityContext.Provider` ครอบทั้งแอป · `togglePageVisible()` upsert ทันที (optimistic + revert ถ้า error)
- `PageNavRow` อ่าน `usePageVisibility()` → ซ่อนปุ่มหน้าที่ `visible=false` **ยกเว้นหน้าปัจจุบัน** (`|| p.id === current` กันปุ่ม active หาย)
- หน้าปัจจุบันถูกปิดตอนโหลด → เด้งไปหน้าแรกที่เปิดอยู่
- **fail-safe**: โหลดจาก Supabase ไม่ได้ → `DEFAULT_VISIBILITY` (เปิดทุกหน้า) — แอปใช้ได้ครบเสมอ
- ⚠️ ต้องรัน `page-settings-setup.sql` ใน Supabase ก่อน ไม่งั้น toggle บันทึกไม่ได้ (แต่แอปยังใช้ได้ครบทุกหน้า)
- ⚠️ รหัสอยู่ฝั่ง client (เหมือน admin panel อื่น) — เป็น gate ใช้งานภายใน ไม่ใช่ security จริง

## Backup Files

- `App.backup.20260507_110405.tsx` and `App.backup.20260507_110405.css`
- `supabase/functions/translate-medicine/index.backup.20260508_143950.ts` — ก่อนลอง Gemini (ใช้ Groq อยู่)
