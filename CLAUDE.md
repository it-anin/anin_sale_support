# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 📌 **เอกสารนี้ถูกย่อ (2569-08-18)** — รายละเอียด deep-dive ของบางฟีเจอร์ถูกย้ายออกไปเป็นไฟล์แยก อ่านเมื่อจำเป็นแทนที่จะโหลดทุกเซสชัน: [`docs/database.md`](docs/database.md) (ตาราง/CSV-XLSX format), [`docs/salesupport.md`](docs/salesupport.md) (หน้า Sale Support), [`druglabel/CLAUDE.md`](druglabel/CLAUDE.md) (หน้าฉลากยา — โหลดอัตโนมัติเมื่อทำงานในโฟลเดอร์นั้น) ไม่มีเนื้อหาใดถูกลบ แค่ย้ายที่เก็บ

## Commands

```bash
npm run dev       # Start dev server (http://localhost:5200, LAN: http://192.168.x.x:5200)
npm run build     # TypeScript compile + Vite build
npm run preview   # Preview production build
npx vercel --prod # Deploy to Vercel (ปกติไม่ต้องรัน — ดูด้านล่าง)
```

**Deploy: Vercel ต่อกับ GitHub ไว้แล้ว auto-deploy ทุกครั้งที่ push ขึ้น `master`** (ยืนยัน 2569-08-18: build เสร็จ ~90 วินาทีหลัง push) เว็บจริงคือ https://anin-label.vercel.app/ — ไม่ต้องรัน `npx vercel --prod` เอง (และเครื่อง BigYa-spare รันไม่ได้อยู่แล้วเพราะไม่มีโฟลเดอร์ `.vercel` CLI จะเด้งถาม login แบบโต้ตอบ)

> ⚠️ **ผู้ใช้ทดสอบงานจากเว็บจริง ไม่ใช่ localhost** — ถ้าผู้ใช้บอกว่า "แก้แล้วยังไม่เห็น" **อย่าเพิ่งไล่แก้โค้ดซ้ำ** ให้เช็คตามลำดับนี้ก่อน:
> 1. `curl -s https://anin-label.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)'` → เทียบ hash กับ `dist/assets/` ที่เพิ่ง build
> 2. CSS hash ตรง = deploy แล้ว · **JS hash ไม่ตรงไม่ได้แปลว่ายังไม่ deploy** — JS มีค่าจาก `.env` ฝังอยู่ Vercel ใช้ค่าของตัวเอง hash เลยต่างเสมอ → ให้ `curl` ไฟล์ JS มา grep หาข้อความใหม่ที่เพิ่งเขียนแทน
> 3. ยืนยันแล้วว่า deploy จริง → บอกผู้ใช้กด **Ctrl+Shift+R** (F5 เฉยๆ ได้ไฟล์เก่าจาก cache)

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
- `product-category-setup.sql` — SQL สร้างตาราง `product_category` + view `v_products_by_category` / `v_product_category_counts` (ปุ่ม "เลือกตามหมวด")
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

> รายละเอียด schema/languages/branches/print/delete/auto-translate/rate-limit เต็มอยู่ใน [`druglabel/CLAUDE.md`](druglabel/CLAUDE.md) (โหลดอัตโนมัติเมื่อทำงานในโฟลเดอร์นี้)

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

> **อ่าน [`docs/salesupport.md`](docs/salesupport.md) ก่อนแก้ `SaleSupportPage.tsx` เสมอ** — รายละเอียด schema/notification system/hazard ทั้งหมดอยู่ที่นั่น

**Design galleries (public/*.html):** ไฟล์ HTML เลือกดีไซน์ (เปิดผ่าน dev server เช่น `/outbound-btn-designs.html`) — ใช้เทียบแบบก่อนใส่จริง ไม่ได้ import เข้าแอป

## Login / Auth (ล็อกอินแยกแผนก)

- Gate หน้าแรก: `App.tsx` ถ้ายังไม่ล็อกอิน (`authProfile == null`) → `return <LoginPage />` ก่อนถึง render หลัก (early-return อยู่หลัง hooks ทั้งหมด — อย่าย้ายขึ้นไปก่อน hooks)
- `auth.ts` — เก็บ `PROFILES` (id, label, group, password, icon, **branch**) + helper `loadAuthProfile` / `saveAuthProfile` / `clearAuthProfile` (persist ผ่าน localStorage key `authProfileId`)
- ⚠️ `Profile.branch` = สาขาสำหรับปุ่ม "เลือกตามหมวด" เท่านั้น ต้องสะกดตรงกับ `CATEGORY_BRANCHES` ใน `App.tsx` และ `product_category.branch` เป๊ะ ๆ — `SRC`/`KKL`/`SSS` ตรงตัว · **`WAREHOUSE` และ `PURCHASING` เป็น `null`** = ซ่อนปุ่มนั้น (ไม่กระทบหน้าอื่น ยังใช้งานได้ครบ)
- `LoginPage.tsx` — ใส่รหัสผ่านช่องเดียว → กด "เข้าสู่ระบบ" (หรือ Enter) → ระบบจับคู่รหัสกับ `PROFILES` อัตโนมัติ ไม่ต้องเลือกแผนกก่อน (ไม่มีการ์ดเลือกโปรไฟล์แล้ว)
  - ดีไซน์: พื้นหลัง **Bubble Rise** (ฟองฟ้าลอยขึ้น — `.login-bubbles`/`.login-bubble` สุ่ม 14 ฟองด้วย `useMemo`) + entrance **Cascade** (โลโก้ blur-in → คำโปรย → ช่องรหัส → ปุ่ม ทยอยเข้าตาม `@keyframes loginRise` + `loginCardIn` ใน App.css) — ดีไซน์เลือกจาก `public/login-designs.html` (ผสมแบบ 15 + 17)
- โปรไฟล์ + รหัส (แก้ที่ `auth.ts`): **สาขา** SRC `1234` / KKL `4567` / SSS `9999` · **คลังสินค้า** `0000` · **จัดซื้อ** `1111`
- แถบผู้ใช้ + ปุ่มออกจากระบบ: `.app-userbar` fixed มุมขวาบน แสดงทุกหน้า (render ใน `App.tsx`)
- ⚠️ รหัสอยู่ฝั่ง client (เหมือน `VITE_ADMIN_PASSWORD`) — เป็น gate ใช้งานภายใน ไม่ใช่ security จริง
- ส่วนใหญ่ยังเป็น **gate เข้าใช้งาน** — ยังไม่จำกัดหน้าตามแผนก (การเปิด/ปิดหน้าใช้ `app_page_settings` ไม่ใช่โปรไฟล์)
- **ข้อยกเว้นเดียวที่ผูกกับโปรไฟล์จริง:** ปุ่ม "เลือกตามหมวด" หน้าป้ายราคา — ล็อกสาขาตาม `Profile.branch` และซ่อนทั้งปุ่มถ้า `branch === null`

## Database (Supabase)

> รายละเอียดเต็ม (mark-and-sweep, CSV/XLSX column mapping, สถิติข้อมูลจริง, bug narrative ต่างๆ) อยู่ที่ [`docs/database.md`](docs/database.md) — **อ่านก่อนแก้โค้ด parse/upload หรือ schema ของตารางด้านล่างเสมอ**

| Table | RLS | จุดเสี่ยงสูงสุด |
|---|---|---|
| `products` (barcode, sku, name, unit, price, category, updated_at) | public read + write | Admin upload = **delete-all + insert** (ไม่ atomic) — ถ้า insert พังกลางทางตารางจะว่าง ต้องอัปโหลดซ้ำ |
| `product_category` (sku, branch, category_no, category_name, location, uploaded_at) — PK `(sku, branch)` | public read + write | Upload ใช้ **mark-and-sweep** (upsert ทุกแถวก่อน แล้วค่อย sweep แถวเก่า) — sweep ต้องรันหลัง upsert ครบทุก chunk เสมอ ไม่งั้นข้อมูลหายกลางทาง · `branch` มีแค่ `SRC/KKL/SSS` (ไม่มีคลังสินค้า) |
| `stock` (id, branch, sku, name, qty, unit, price, uploaded_at) | read-only (ไม่มี public write) | อัปโหลดผ่าน `upload-stock.mjs` + service_role key เท่านั้น ไม่มีเว็บ UI |
| `outbound_requests` (branch, sku, barcode, name, unit, qty, requested/requested_at, approved/approved_at, out_of_stock, request_date, document_no, location, entered_at) | public read + write | สาขา/คลังสินค้า/จัดซื้อใช้ร่วมกัน (ดูหัวข้อ "Quick Outbound" ด้านล่าง) — `stock_qty` **ไม่เก็บในตาราง** ดึงสดจาก `stock` แบบเดียวกับ BackOrder |
| `customer_history` (id, purchase_date, phone, first_name, last_name, sku, product_name, dedupe_key, uploaded_at) | read-only (ไม่มี public write) | มี PII (เบอร์โทร/ชื่อลูกค้า) · upload เป็น incremental ผ่าน `upload-customer-history.mjs` |
| SaleSupport tables (`ss_orders`, `ss_backorders`, `ss_request_items`, `ss_new_products`, `ss_tickets`, `product_master`, `ss_suppliers`) | anon `for all` | ดูรายละเอียดที่ [`docs/salesupport.md`](docs/salesupport.md) |

### 🚨 `void supabase.from(...)` = คำสั่งไม่เคยถูกส่ง (บั๊กจริง 2569-08-18)

query builder ของ supabase-js เป็น **thenable ไม่ใช่ Promise** — HTTP request จะวิ่งก็ต่อเมื่อมีคนเรียก `.then()` (คือตอน `await` หรือต่อ `.then()` เอง) การเขียน `void supabase.from('t').delete().eq('id', x)` เฉย ๆ จึงสร้าง object ทิ้งไว้แล้วจบ **ไม่มี request ออกไปเลย ไม่มี error ไม่มีอะไรเตือน**

- เคยทำให้ปุ่มลบหน้า Outbound "ลบสำเร็จ" บนหน้าจอแต่แถวไม่เคยหายจาก DB — refresh แล้วกลับมาทุกครั้ง (ยืนยันด้วยการทดสอบจริง: `void ...delete()` → แถวยังอยู่ · `await ...delete()` → หายจริง)
- ✅ ใช้ `await supabase...` เสมอสำหรับคำสั่งที่เปลี่ยนข้อมูล และเช็ค `error` ทุกครั้ง
- ✅ `void supabase.removeChannel(ch)` ปลอดภัย (คืน Promise จริง) · `void supabase.from(...)....then(cb)` ปลอดภัย (มี `.then` เรียกให้แล้ว — ดูตัวอย่างที่ `SaleSupportPage.tsx` มาร์ค read_at)
- ⚠️ **ห้ามลบแถวออกจาก state ก่อนที่ DB จะยืนยันสำเร็จ** (optimistic delete) — ถ้าคำสั่งพัง หน้าจอจะโกหกผู้ใช้ กว่าจะรู้ตัวคือตอน refresh

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
- 6-digit exact → `.or('sku.eq.x,barcode.eq.x')` — **ค้นทั้ง 2 คอลัมน์แบบตรงตัว**
- Other queries → `.or('name.ilike.%x%,barcode.ilike.%x%')` (no sku in OR for non-6-digit)
- Limit 30 results
- Empty search → no results shown (shows scannedHistory instead)
- On new search → hiddenKeys reset automatically
- Barcode exact match → auto-add to cart + scannedHistory (scanner workflow)
- ⚠️ **auto-add จะทำงานเฉพาะตอนผลลัพธ์เหลือแถวเดียว** (`filteredProducts.length > 1` → `return`)

### ⚠️ เลข 6 หลักเป็นได้ทั้ง SKU และ barcode

`products.barcode` มีหลายความยาวปนกัน (6/8/12/13/14 หลัก + มีตัวอักษรปน) — เลขที่พิมพ์มา 6 ตัวจึงตัดสินไม่ได้ว่าเป็น SKU หรือ barcode ต้องค้นทั้งคู่ด้วย `.or('sku.eq.x,barcode.eq.x')` เสมอ

> ⚠️ **ห้ามกลับไปใช้ `.eq('sku', …)` อย่างเดียว** — เคยทำให้ barcode 6 หลักที่ไม่ตรงกับ sku ของตัวเอง (159 แถวจากข้อมูลจริง) ค้นไม่เจอทั้งที่มีสินค้าอยู่จริง และทำให้สินค้าหลายหน่วยบางตัวโดน auto-add ผิดจังหวะจนหน่วยอื่นหายจากตาราง — รายละเอียดเต็ม + เคสบั๊กที่เจอจริงอยู่ที่ [`docs/database.md`](docs/database.md) หัวข้อ Products
> ⚠️ การสแกน EAN-13 ไม่กระทบเลย เพราะยาวเกิน 6 หลักจึงไปเข้า branch `.or(name/barcode ilike)` คนละทาง
- Manual search → must press 🛒 to add (no auto-add)
- Press − to qty=0 → row removed from table automatically
- Table always visible (opacity 0.5 during loading, never hidden)
- **`visibleProducts` มี 3 branch ลำดับ `category > search > scan`** — ใช้ helper `strip()` ร่วมกัน (filter `hiddenKeys` ก่อน แล้วค่อย reindex)
- พิมพ์อะไรก็ตามในช่องค้นหา (รวมถึงลบจนว่าง) → ออกจาก category mode · `clearAll` ล้าง category ด้วย
- category mode ใช้ `categoryLoading` **แยกจาก `isLoading`** — search effect เรียก `setIsLoading(false)` ตอน early-return ซึ่งจะยิงตอน `loadCategory` เคลียร์ `searchTerm` แล้วฆ่า spinner กลางคัน

## Category Select — เลือกตามหมวด (หน้าป้ายราคา)

ปุ่ม "เลือกตามหมวด" ที่ `.selected-table-header` → dropdown **tab สาขา + 9 หมวด** → กดแล้วโหลดสินค้าของหมวดนั้นเฉพาะสาขาที่เลือกขึ้นตาราง (ไม่เข้าตะกร้าทันที) ผู้ใช้ตรวจ/ลบก่อน แล้วกด "เลือกทั้งหมด" → พิมพ์

- ⚠️ **สาขาล็อกตามโปรไฟล์ที่ล็อกอิน เลือกเองไม่ได้** (`Profile.branch` ใน `auth.ts`) — ไม่มี tab ให้สลับ แสดงเป็นป้าย `🔒 สาขา X` · เจตนาคือกันปริ้นป้ายผิดสาขา
- **ใช้เฉพาะสาขาหน้าร้าน `SRC`/`KKL`/`SSS`** — โปรไฟล์ `WAREHOUSE`/`PURCHASING` (`branch: null`) ไม่เห็นปุ่มนี้เลย
- ใช้ได้เฉพาะสาขาที่มีไฟล์ Location อัปโหลดแล้ว (ปัจจุบัน: SSS — SRC/KKL ยังไม่มีไฟล์ ปุ่มหมวดของสาขานั้น disabled พร้อมข้อความบอก)
- อัปโหลดไฟล์ Location ใช้ **mark-and-sweep** ไม่ใช่ delete-all/merge ล้วน — เพื่อลบ SKU ที่ย้ายหมวด/เลิกขายออกโดยไม่กระทบสาขาอื่น
- รายละเอียดเต็ม (ลำดับ upsert/sweep, dedupe sku-unit, view filter `base_multiple`, cache, สถิติจำนวนป้ายต่อหมวด) อยู่ที่ [`docs/database.md`](docs/database.md)

## Print System

Two separate print modes:

1. **ป้ายราคา** — uses `@media print` in App.css, renders `.print-only` div, A4 landscape
2. **ป้ายบาร์โค้ด (Thermal/QR)** — opens `window.open()` with self-contained HTML+CSS blob

⚠️ **`generateBarcode` มี module-level cache (`barcodeCache: Map<barcode, dataURL>`) — ห้ามเอาออก**  
`.print-only` render ตลอดเวลา (ซ่อนด้วย CSS `display: none` เท่านั้น) และ `flatMap` ขยายตาม `quantity` → ถ้าไม่ cache จะเรียก `JsBarcode` + `canvas.toDataURL()` ทีละป้าย **ทุกครั้งที่ App re-render** ที่ 1,300 รายการ = แอปค้างทุกครั้งที่พิมพ์ตัวอักษร/hover/กดปุ่ม  
input เดิม → output เดิมทุกพิกเซล **ไม่ขัดกฎ FROZEN** (`width: 3, height: 90` ไม่ถูกแตะ)

## Label Design — FROZEN ⚠️

Do NOT modify without explicit user instruction:

### ป้ายราคา (Price Label)
- **Size: `width: 4.5cm; height: 4cm; border: 1.5mm solid #1e3a6e`** — FROZEN
- Label structure:
  ```
  .lbl-loc (top-left) ·············· BIGYA logo (top-right)
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

#### `.lbl-loc` — ตำแหน่งชั้นวาง มุมซ้ายบน (เพิ่ม 2569-08-11)
- แสดง `product.location` (เช่น `A14` / `1A12`) คู่กับโลโก้ · **มีเฉพาะสินค้าที่โหลดมาจากปุ่ม "เลือกตามหมวด"** เพราะข้อมูลอยู่ใน `product_category` ไม่ได้อยู่ใน `products` · ค้นหาปกติ/สแกนบาร์โค้ด → ไม่มี แสดงว่างไว้
- ⚠️ **ใช้ `margin-right: auto` บน `.lbl-loc` ห้ามเปลี่ยน `.lbl-header` เป็น `space-between`** — ป้ายที่ไม่มี location จะมีลูกเดียว `space-between` จะดันโลโก้ไปซ้าย
- ⚠️ **ห้ามย้ายไปต่อท้ายวันที่แถวล่าง** — วัดแล้วแถวล่างเหลือที่ว่าง **~0.7mm (≈2px)**:
  ป้าย 4.5cm − ขอบ 0.2 − padding 0.24 = **4.06cm** · บาร์โค้ด **3.28cm** (`flex-shrink: 0`) → เหลือ **7.8mm** ให้วันที่/SKU · วันที่ยาวสุด `31/12/2569` ที่ 4pt ≈ **7.1mm**
  เอา location ไปต่อ (+~3mm) จะดันบาร์โค้ดให้แคบลงจนแท่งต่ำกว่า 0.19mm ที่ CODE128 ต้องการ → **สแกนไม่ติด**
- แนวตั้งของ `.lbl-codes` เหลือเยอะ (~5.6mm) ถ้าต้องเพิ่มข้อมูลอีกในอนาคต ให้เพิ่มเป็น**บรรทัด**ใน stack ไม่ใช่ต่อความกว้าง

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

> ⚠️ **`outboundItems` เลิกใช้แล้ว** (2569-08-18) — หน้าเบิกด่วนย้ายไปเก็บ Supabase ตาราง `outbound_requests` แทน (ดูหัวข้อ "Quick Outbound" ด้านล่าง) เพราะ localStorage ผูกกับเบราว์เซอร์เดียว ทำให้คลังสินค้า/จัดซื้อไม่เห็นข้อมูลที่สาขาลง

**Load:** `loadCartFromStorage()` / `loadHistoryFromStorage()` — called as `useState` initializer (runs once on mount).  
**Save:** `useEffect` on each state change → `localStorage.setItem(...)`.  
**Clear:** `clearCart` removes `cartItems`; `clearAll` removes both `cartItems` + `scannedHistory`.  
**Serialize:** Map ↔ `Array.from(map.entries())` / `new Map(entries)` — JSON cannot stringify Map directly.

> `cartItems` อาจโตถึง ~1,300 entries (~160 KB) หลังใช้ "เลือกตามหมวด" + "เลือกทั้งหมด" — ยังต่ำกว่า quota แต่ `JSON.stringify` รันทุกครั้งที่ตะกร้าเปลี่ยน (~5-15 ms)

## Scanner Workflow

- `scannedHistory: Map<string, Product>` — accumulates barcode-scanned products across searches, **persisted to localStorage**
- `lastAutoAddedBarcode: useRef<string>` — prevents double auto-add
- `visibleProducts` = merge of scannedHistory + filteredProducts (deduplicated by sku-unit key)
- `clearAll` also resets scannedHistory and removes its localStorage entry

## Quick Outbound (หน้าเบิกด่วน)

เก็บลง Supabase ตาราง **`outbound_requests`** (ไม่ใช่ localStorage แล้ว — แก้บั๊ก 2569-08-18 ที่คลังสินค้า/จัดซื้อไม่เห็นข้อมูลที่สาขาลง เพราะของเดิมเก็บแค่ในเบราว์เซอร์ของสาขาเอง) sync ข้ามโปรไฟล์ด้วย Supabase Realtime (`postgres_changes`) + fallback polling ทุก 30 วิ + refetch ตอน window focus/visible — pattern เดียวกับที่ระบบแจ้งเตือน Sale Support ใช้

**3 โปรไฟล์ 3 สิทธิ์ต่างกัน** (`isWarehouse` / `isPurchasing` / `userBranch`):

| | สาขา | คลังสินค้า | จัดซื้อ |
|---|---|---|---|
| เห็นข้อมูล | เฉพาะสาขาตัวเอง (`.eq('branch', userBranch)`) | ทุกสาขา (สลับแท็บ) **แต่เฉพาะที่กด "บันทึกรายการ" แล้ว** (`.eq('requested', true)`) | ทุกสาขา (สลับแท็บ) — เห็นแม้ยังไม่กดส่ง |
| แก้ไข/เพิ่มแถว | ✓ (เฉพาะแถวตัวเอง) | ✓ | **✕ — ดูอย่างเดียวทั้งหมด** |
| **ลบแถว** | ✓ **เฉพาะแถวที่ยังไม่กด "บันทึกรายการ"** (`!row.requested`) | ✓ | ✕ |
| **ล้างหมด (ลบทั้งสาขา)** | ✕ — กันเบิกซ้ำ (ดูด้านล่าง) | ✓ | ✕ |
| กดปุ่ม บันทึกรายการ (ส่งขออนุมัติ) | ✓ | — | ✕ |
| กดอนุมัติ / แจ้งของหมด / ลบทิ้งถาวร / Export | — | ✓ | ✕ |

- 🚨 **สาขาลบแถวได้เฉพาะก่อนกด "บันทึกรายการ" เท่านั้น** (`ob-col-del` เช็ค `!isWarehouse && !isPurchasing && !row.requested`, แก้ 2569-08-19 — เดิมห้ามลบเด็ดขาดทุกแถวตั้งแต่ 2569-08-18) — เจตนายังเป็น**กันเบิกซ้ำ**เหมือนเดิม: แถวที่ยังไม่กดส่งคือแถวที่คลังยังไม่เคยเห็น จึงไม่มีทางเป็นแถวที่คลังจ่ายของไปแล้ว ลบได้อย่างปลอดภัย (ไม่ต้องรหัส — เรียก `removeRow` ตรงๆ เหมือนเดิมก่อนบั๊ก) ส่วนแถวที่กดส่งแล้วปุ่มลบหายไปทันที เหลือแค่**แก้ค่าในแถวเดิม** (ช่องยังแก้ได้ตราบใดที่ยังไม่อนุมัติ) หรือแจ้งคลังให้ลบให้
  - ⚠️ ปุ่ม "ล้างหมด" (ลบทั้งสาขารวดเดียว) ยังปิดสำหรับสาขาเหมือนเดิม ไม่เกี่ยวกับข้อนี้ — เพราะล้างทั้งสาขารวมแถวที่ส่งไปแล้วด้วย ตัดสินใจแยกจากปุ่มลบรายแถวไม่ได้
  - สาขายังกด "เพิ่มแถว" ได้ตามปกติ (แถวว่างที่ไม่กรอกอะไรไม่ถูกบันทึกลง DB อยู่แล้ว — ดูหัวข้อแถวร่างด้านล่าง)
- 🚨 **คลังสินค้าเห็นเฉพาะแถว `requested=true`** (`fetchRows` เพิ่ม `.eq('requested', true)` เมื่อ `isWarehouse`, 2569-08-19) — กันพนักงานคลังเห็นข้อมูลที่สาขายังพิมพ์/แก้ไขอยู่ (ผ่าน realtime) แล้วเดินไปหยิบของจากชั้นวางล่วงหน้าก่อนสาขาตัดสินใจส่งจริง (ความเสี่ยงนี้อยู่นอกแอป ปุ่มซ่อนในแอปอย่างเดียวกันไม่ได้) ไม่กรอง `isPurchasing` เพราะจัดซื้อดูอย่างเดียวไม่มีการกระทำทางกายภาพ
  - ⚠️ **คลังต้องไม่มีแถวร่าง (local-only, `persisted:false`) ในเครื่องเลยสักแถว ไม่ว่าทางไหน** — ไม่งั้นแถวว่างที่**คลังพิมพ์ได้จริง** (ช่อง SKU/Barcode/Qty เป็น `<input>` ไม่ใช่ text) จะไปโผล่ในตารางและไปบวกในตัวเลขบนแท็บสาขา (`rows.filter(row => row.branch === branch).length` ไม่แยก persisted/requested) ทำให้ดูเหมือนสาขาส่งมาทั้งที่ยังไม่ได้กด — เจอมาแล้ว 4 จุดที่ต้องกันพร้อมกัน ตกจุดไหนจุดหนึ่งบั๊กกลับมาทันที:
    1. effect เติมแถวร่างว่างเมื่อแท็บไม่มีแถวเลย — gate `isWarehouse || isPurchasing`
    2. ปุ่ม "เพิ่มแถว" ที่หัวตาราง — เดิมกันแค่ `isPurchasing` ทำให้คลังกดได้ด้วย ต้อง `!isWarehouse && !isPurchasing`
    3. ปุ่ม "ล้างหมด" (`clearAll`, เห็นเฉพาะคลัง) — เดิมลบแล้วเติมแถวร่างกลับให้ `activeBranch` เสมอ ต้องลบแล้วปล่อยว่างจริงๆ
    4. `dropRowLocally` (ใช้ตอนลบแถว) — fallback เดิม "ถ้าลบแล้วไม่เหลือแถวเลยทั้งระบบ ให้เติมร่างว่าง" ต้องข้ามการเติมนี้เมื่อ `isWarehouse`
- ⚠️ **จัดซื้อ (`isPurchasing`) ดูอย่างเดียวล้วนๆ** — ไม่มีปุ่มเพิ่มแถว/ล้างหมด/Export/อนุมัติ/ของหมด/ลบแถวเลย และช่อง SKU/Barcode/Qty/วันที่เบิกเป็นข้อความอ่านอย่างเดียว ไม่ใช่ input — ตัดสินใจร่วมกับผู้ใช้ไว้แบบนี้เพราะจัดซื้อแค่ต้องการเห็นข้อมูล ไม่ได้ทำงานฟิสิคัลกับของในคลัง (คนละ role กับสาขา/คลังสินค้า)
- พิมพ์ SKU/Barcode แล้ว blur หรือกด Enter → `lookupProduct()` query ตาราง `products` (`.or('sku.eq.x,barcode.eq.x')`) เติมชื่อ/หน่วยอัตโนมัติ ไม่เจอ → แสดง "ไม่พบสินค้า" — ค่า `notFound` ถูก **persist ลงตาราง** (ไม่ใช่แค่ state ชั่วคราว) เพื่อให้คนอื่นที่มาดูทีหลังเห็นสถานะเดิม
- **`stock_qty` (คงเหลือคลัง) ไม่เก็บในตาราง** — ดึงสดแบบ batch (`.in('sku', […])`) หลังโหลดแถวทุกครั้ง เหมือน `loadWarehouseStock()` ของเมนู BackOrder หน้า Sale Support (docs/salesupport.md) เพราะคนที่มาดูอาจไม่ใช่คนพิมพ์ SKU เอง จะไม่มีเลขคงเหลือให้เห็นถ้าไม่ดึงใหม่
- ⚠️ **SKU/Barcode/Qty เป็น uncontrolled input** (`defaultValue` + `key` ผูกกับค่าปัจจุบัน คอมมิตตอน `onBlur`/Enter) — กัน 2 ปัญหาพร้อมกัน: (1) ไม่ยิง Supabase ทุกตัวอักษรเหมือนที่เคยแก้ไว้กับ MOQ/SKU ของ Request Item (2) กัน realtime refetch จากคนอื่นมาทับค่าที่กำลังพิมพ์อยู่กลางคัน (React ไม่ remount input จนกว่า `key` จะเปลี่ยนคือคอมมิตสำเร็จแล้วเท่านั้น)
- **แถวใหม่เป็น local-only (`persisted: false`) จนกว่าจะมีการกรอกจริงครั้งแรก** ถึงจะ insert ลง Supabase (กันแถวว่างเปล่าค้างฐานข้อมูลทุกครั้งที่กดเพิ่มแถวเฉยๆ) — insert สำเร็จแล้วสลับ `id` จาก client-generated เป็นของ DB
- ปุ่ม **Outbound** ต่อแถว (สาขากด) = ส่งขออนุมัติ: ต้องมี sku+name และ qty > 0 → คลังสินค้ากด "อนุมัติ" ใส่รหัส login คลังสินค้า (`WAREHOUSE_PASSWORD` อ่านจาก `auth.ts`, ครั้งแรกครั้งเดียว — unlock ทั้ง session 🔓) → แถวเปลี่ยนเป็น ✅ อนุมัติแล้ว + timestamp พื้นเขียว แก้ไขไม่ได้
- ⚠️ ตารางนี้เป็น `table-layout: fixed` — เพิ่มปุ่ม/ข้อความในเซลล์ไหนต้องขยาย `width` คอลัมน์นั้นด้วยเสมอ **อ่านหัวข้อ "UI — Table Layout" ก่อนแตะโครงตาราง** (ปุ่มถังขยะเคยหายไปทั้งที่โค้ดถูกเพราะข้อนี้)
- **แยกปุ่มตาม "ประเภทของการกระทำ" ไม่ใช่ตามความสะดวก** (แก้ 2569-08-18 เพราะพนักงานสับสน):
  - คอลัมน์ **Outbound** = *ตัดสินใจต่อคำขอของสาขา* → คลังสินค้าเห็นปุ่ม **[อนุมัติ]** กับ **[ของหมด]** วางคู่กัน (`.outbound-action-group`) ทรงตราประทับขอบประเหมือนกันแต่คนละสี (ฟ้า/แดง) · แจ้งของหมดแล้วขึ้นตราประทับ + ลิงก์เล็ก "ยกเลิกสถานะนี้"
  - คอลัมน์ **ท้ายแถว** = *จัดการแถว* → มีปุ่มเดียวคือ **ถังขยะ = ลบ** เหมือนกันทั้งสาขาและคลังสินค้า
  - 🚨 **ห้ามเอา `✕` กลับมาสื่อความหมายอื่นนอกจาก "ลบ" อีก** — ของเดิมสาขา `✕` = ลบแถว แต่คลังสินค้า `✕` = ของหมด (สัญลักษณ์เดียวกันคนละความหมายแล้วแต่ว่าใครล็อกอิน) พอวางติดกับถังขยะยิ่งแยกไม่ออกว่าอันไหนลบจริง
- ปุ่มลบ (ฝั่งคลังสินค้า) **ต้องใส่รหัสคลังสินค้าทุกครั้ง ไม่ใช้ shortcut `unlocked` ของ session เหมือนปุ่มอนุมัติ** เพราะลบแล้วกู้คืนไม่ได้ · **ลบได้แม้แถวจะ `approved` แล้ว** (2569-08-18 — เดิมห้ามลบแถวอนุมัติแล้ว ผู้ใช้ขอกลับกฎ ด่านกันพลาดที่เหลือคือรหัสผ่านทุกครั้ง ไม่มี guard สถานะแถวอีก) · `pwAction` state เป็นตัวบอก modal ว่าจะ approve หรือ delete — **ต้อง set ก่อน `setPwRowId` เสมอทั้ง 2 จุดเรียก** ไม่งั้นค่าค้างจากการกดครั้งก่อนจะทำผิด action
- `clearAll` มี `window.confirm` ก่อนล้าง — **ล้างเฉพาะแถวของสาขาที่กำลังดูอยู่ (`activeBranch`) เท่านั้น** ⚠️ ห้ามล้างทุกสาขาทีเดียว (คลังสินค้าเห็นได้หลายสาขาผ่านแท็บ ถ้าล้างแบบเดิมที่ล้างทั้ง state จะลบของสาขาอื่นที่ไม่ได้กำลังดูไปด้วย — คนละพฤติกรรมกับตอนเก็บ localStorage ที่แต่ละเบราว์เซอร์เห็นแค่สาขาตัวเองอยู่แล้ว)
- ปุ่ม เพิ่มแถว / ล้างทั้งหมด (`.outbound-3d-btn`) และ Outbound (`.outbound-approve-btn`) ใช้สไตล์ **Luxe Double Border** โทนฟ้า: พื้นขาว ขอบ `#4891db` 2 ชั้น (border + outline) → hover พื้น `#2d6cad` ตัวอักษรขาว
- สร้างตารางด้วย `outbound-setup.sql` — ต้องรันก่อน deploy เสมอ ไม่งั้น insert/select พังทันที (ตารางไม่มีอยู่จริง)

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

## UI — Table Layout ⚠️ (บทเรียนจากบั๊กจริง 2569-08-18)

**ตารางหลัก 4 หน้าเป็น `table-layout: fixed`** — ป้ายราคา / เช็คสต๊อค / ประวัติลูกค้า / เบิกด่วน ทั้งหมดใช้ class `.product-table` ซึ่งตั้ง `table-layout: fixed` ไว้ที่ [App.css](App.css) (`.stock-table` ตั้งซ้ำอีกชั้น) · **ยกเว้น `.ss-table` ของหน้า Sale Support ที่เป็น auto ปกติ**

ผลที่ตามมา — `width: %` ที่ประกาศต่อคอลัมน์เป็น **ค่าบังคับ ไม่ขยายตามเนื้อหา**:
- เพิ่มปุ่ม/ข้อความในเซลล์ไหน **ต้องขยาย `width` ของคอลัมน์นั้นด้วยเสมอ** แล้วหั่นจากคอลัมน์อื่นให้ผลรวมเท่าเดิม
- เนื้อหาที่ล้นจะถูก `overflow: auto` ของ wrapper ตัดหาย **ทั้งที่ element อยู่ใน DOM ครบและ CSS ถูกต้องทุกบรรทัด** → เปิด DevTools เห็น element แต่ตาไม่เห็น
- `white-space: nowrap` **ไม่ช่วย** ให้คอลัมน์ขยาย (ต่างจาก auto layout ที่ browser จะเผื่อ min-content ให้)

> 🚨 **กับดักที่เคยพลาดจริง — ห้ามอนุมานซ้ำ:** ผลรวม `%` ของคอลัมน์ที่ประกาศไว้ **เกิน 100% (เช่น `.outbound-table` รวมได้ 109%) ไม่ได้แปลว่าตารางเป็น auto layout** — มันแค่เขียนไว้เกินแล้ว browser normalize ให้เอง · เคยอนุมานจากตรงนี้ว่า "ไม่ต้องแก้ความกว้างคอลัมน์" แล้วปุ่มถังขยะหน้า Outbound หายไปเลย (คอลัมน์ 3% ≈ 36px แต่ปุ่ม 2 อันต้องใช้ ~54px) เสียเวลาไล่หา 3 รอบเพราะทุกอย่างที่เช็ค "ผ่าน" หมด — JS มี, CSS มี, deploy แล้ว, ข้อมูลลง DB จริง
>
> **วิธีที่ถูก: `grep -n "table-layout" App.css` แล้วไล่ดูว่า base class ของตารางนั้นตั้งอะไรไว้ ก่อนสรุปพฤติกรรม layout ทุกครั้ง**

## UI — Misc

- Admin panel shows R05.106 label, Enter key to verify password, Last Updated badge (no version badge)
- หัวตารางป้ายราคามี 4 ปุ่ม เรียงซ้าย→ขวา: `เลือกตามหมวด │ รายการที่เลือก │ เลือกทั้งหมด │ ลบทั้งหมด` — 2 dropdown (หมวด / ตะกร้า) เปิดพร้อมกันไม่ได้
- อัปโหลดในโปรเจกต์มี 2 จุดแยกกัน status คนละตัว: **Admin panel → `Upload R05.106`** (CSV, delete-all + insert, `uploadStatus`) และ **เมนูเลือกตามหมวด → `📁 อัปโหลด Location → <สาขา>`** (XLSX, upsert + sweep, `locationStatus`, ไม่ต้องใส่รหัส)
- ปุ่มอัปโหลดทั้ง 2 จุด**บอกชื่อไฟล์ที่ต้องเลือกบนตัวปุ่ม** — ทั้งคู่รับไฟล์ชื่ออะไรก็ได้ ตัวตัดสินคือหัวคอลัมน์ ป้ายบนปุ่มจึงเป็นตัวช่วยเดียวที่กันหยิบผิดตั้งแต่ต้นทาง
- ทั้ง 2 จุดมีชุดกันพลาดเหมือนกัน: **เช็คหัวคอลัมน์ก่อนแตะ DB → confirm บอก `เดิม N → ใหม่ M` → เตือน 🚨 ถ้าไฟล์หดเกิน 20% → reset input ใน `finally`**
- กล่อง `uploadStatus` ต้องมี `whiteSpace: 'pre-line'` — ข้อความ error หัวคอลัมน์เป็นหลายบรรทัด

## Sale Support (หน้าซัพพอร์ต)

ศูนย์รวมงานซัพพอร์ตการขาย — sidebar 6 เมนู (Order / BackOrder / Request Item / New Product / Ticket / Products) + panel ขวา (toolbar + ตาราง) ขับเคลื่อนด้วย config `MENUS` แต่ละเมนูกำหนด table/columns/roles ของตัวเอง

**พฤติกรรมแยกตาม 3 โปรไฟล์** (`isPurchasing` / `isWarehouse` / `userBranch` → ยุบเป็น `currentRole`): สาขาเห็นเฉพาะ Order/BackOrder ของตัวเอง · คลังสินค้าเห็นทุกสาขาและ popup Order เป็นฟอร์มกรอกแทนตราประทับ 3 ขั้น · จัดซื้อดูแลเฉพาะ SKU ที่ ABC=P และไม่เห็นเมนู BackOrder

มีระบบแจ้งเตือนสองทิศทาง (แผนก↔สาขา) ผ่านตารางเหตุการณ์ `ss_branch_notification_events`, ระบบตราประทับ 3 ขั้นพร้อม toast/confirm dialog, และดีไซน์ตาราง Order แบบ Two-line Row

> **อ่าน [`docs/salesupport.md`](docs/salesupport.md) ก่อนแก้ `SaleSupportPage.tsx` เสมอ** — มี schema ตาราง SaleSupport ทั้งหมด, รายละเอียดระบบแจ้งเตือน, ดีไซน์ตาราง Order, และ hazard ที่บันทึกไว้จากบั๊กจริงที่เคยเกิด (ห้ามข้าม — มีจุดที่พังซ้ำได้ง่ายถ้าไม่รู้ guard ที่มีอยู่)

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
