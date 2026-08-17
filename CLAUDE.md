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

**Table: `products`** (barcode, sku, name, unit, price, category, updated_at)
- RLS: `public read` (SELECT) + `public write` (ALL)
- Search: queries Supabase directly — NOT client-side filter
- On mount: fetches only latest `updated_at` for timestamp display
- Admin upload: CSV (R05.106) → PapaParse → **เช็คหัวคอลัมน์** → confirm → delete all → insert in 500-row chunks
- ⚠️ ยังเป็น **delete-all + insert** (ไม่ atomic) — ถ้า insert พังกลางทางตารางจะว่าง ต้องอัปโหลดซ้ำ · ต่างจาก `product_category` ที่ใช้ upsert + sweep

**Table: `product_category`** (sku, branch, category_no 1-9, category_name, location, uploaded_at) — **PK = (sku, branch)**
- `location` = ตำแหน่งชั้นวางจากคอลัมน์ A ของไฟล์ Location (เช่น `A14` / `1A12`) → แสดงมุมซ้ายบนของป้ายราคา (`.lbl-loc`)
- `branch` = **`SRC / KKL / SSS` เท่านั้น** (ดู `CATEGORY_BRANCHES` ใน `App.tsx`) — ⚠️ **ไม่มี `คลังสินค้า`** เพราะคลังไม่ได้ติดป้ายราคาที่ชั้นวาง จึงเป็นชุดที่**สั้นกว่า** `stock.branch` / `TABS` ใน `StockCheckPage` ที่มี 4 สาขา · เขียนสะกดเหมือนกันเป๊ะเพื่อให้เทียบข้ามตารางได้
- RLS: `public read` + `public write` (ALL) — **เว็บเป็นคนเขียนเอง** ด้วย anon key (ไม่ใช่ .mjs + service_role แบบ stock/customer_history) ถ้าไม่เปิด write policy ปุ่มอัปโหลดจะ 403 เงียบ ๆ · ข้อมูลนี้อ่อนไหวน้อยกว่า `products` ที่เปิด write อยู่แล้วพร้อมราคา
- สร้างด้วย `product-category-setup.sql` (รันซ้ำได้ ไม่ลบข้อมูล — มี migration ในตัวสำหรับตารางเวอร์ชันแรกที่ PK เป็น `sku` เดี่ยว)
- Upload: ไฟล์ Location (.xlsx) ผ่านปุ่มในเมนู "เลือกตามหมวด" หน้าป้ายราคา — **ไม่ต้องใส่รหัส admin**
- **สาขาปลายทาง = สาขาของโปรไฟล์ที่ล็อกอิน เลือกเองไม่ได้** — `guessBranchFromFileName()` ใช้แค่เตือนใน confirm ถ้าชื่อไฟล์ดูเป็นของสาขาอื่น
- **"แทนที่ทั้งสาขา" ด้วย mark-and-sweep** (ไม่ใช่ merge ล้วน และไม่ใช่ delete-all):
  1. upsert ทุกแถวด้วย `uploaded_at` ค่าเดียวกันทั้งชุด (`onConflict: 'sku,branch'`)
  2. `DELETE WHERE branch = X AND uploaded_at < <ชุดนี้>` → ลบ SKU ที่ไม่มีในไฟล์รอบนี้
  - ⚠️ **ลำดับสำคัญ** — sweep ต้องอยู่หลัง loop upsert สำเร็จครบทุก chunk (chunk ไหน error จะ `throw` ออกไปก่อน) ไม่งั้นจะลบข้อมูลทิ้งตอน upsert ยังไม่ครบ
  - แก้ปัญหาแถวค้าง: SKU ที่ถูกย้ายไปหมวด `DELETE` หรือเลิกขาย จะถูก parser ข้าม ถ้าใช้ merge ล้วนแถวเก่าจะค้างพร้อมหมวดเดิมตลอดไป
  - idempotent · ไม่กระทบสาขาอื่น (มี `.eq('branch', …)` คุมทั้ง upsert และ delete)
- **safety net กันไฟล์ export ไม่ครบ**: ก่อน confirm query จำนวนเดิมของสาขานั้นมาโชว์เทียบ (`เดิม X SKU → ไฟล์ใหม่ Y SKU`) และถ้าไฟล์ใหม่เล็กลงเกิน 20% จะขึ้นเตือน 🚨 ให้ตรวจก่อน
- ⚠️ มีไฟล์ Location แค่ 2 สาขา (WH→คลังสินค้า, SSS) — **SRC / KKL จะไม่มีหมวดจนกว่าจะมีไฟล์** ปุ่มหมวดของสาขาที่ไม่มีข้อมูลจะ disabled พร้อมข้อความบอก
- **ไม่มี FK ไป `products(sku)` โดยตั้งใจ:** (1) `products.sku` ไม่ unique (7,907 unique จาก 10,843 แถว) เป็น FK target ไม่ได้ (2) `handleFileUpload` ลบ `products` ทั้งตารางทุกครั้งที่อัปโหลด CSV สินค้า → FK จะพังหรือ cascade ลบหมวดทิ้ง · INNER JOIN ใน view ซ่อน SKU กำพร้าให้อยู่แล้ว
- View `v_products_by_category` — join `products` × `product_category` ดึงหมวดเดียวจบในคำขอเดียว
- View `v_product_category_counts` — จำนวนแถวต่อหมวด (badge ทั้ง 9 หมวดในคำขอเดียว)
- ⚠️ **สินค้าใหม่ใน `products` จะไม่มีหมวด** จนกว่าจะอัปโหลดไฟล์ Location ใหม่
- ⚠️ `WITH (security_invoker = true)` ต้องใช้ PG15+ — ถ้า error ให้ตัด clause ออก (ทั้ง 2 ตารางเป็น `SELECT USING (true)` อยู่แล้ว)

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
| `ss_backorders` | BackOrder | สินค้าค้างส่ง (ABC ≠ P) — `branch` มี CHECK `SRC/KKL/SSS` · เก็บ `unit` = **หน่วยของบาร์โค้ดที่สแกน** · `pending_qty` = **ค้างส่งลูกค้า** (สาขากรอกเอง) ส่วน **"คลังมีสินค้า" ไม่ได้เก็บ** ดึงสดจาก `stock` สาขาคลังสินค้า · 3 สถานะ chip default สะกดตรงกับ `ss_orders` เป๊ะ · migration `202608140001` → `202608140003` + `202608150001` |
| `ss_request_items` | Request Item | ขอสินค้าที่ไม่มีในสต๊อก + supplier, image_url, customer_name |
| `ss_new_products` | New Product | เสนอสินค้าใหม่เข้าร้าน + image_url, quoted_price, status |
| `ss_tickets` | Ticket | แจ้งปัญหา department: Purchase / Warehouse |
| `product_master` | Products | ฐานข้อมูลสินค้าหลักจากไฟล์ Product_Master — **unique constraint ที่ `sku`** (รองรับ upsert) — เมนู Products filter `abc = 'P'` เรียงตาม sku |
| `ss_suppliers` | (autocomplete) | ชื่อ supplier + `details` jsonb เก็บคอลัมน์อื่นทั้งหมดจาก Excel |

- **Storage bucket `salesupport`** (public) — เก็บรูปสินค้าแนบจากเมนู Request Item / New Product (โฟลเดอร์ `request-items/`, `new-products/`) — policy: anon insert + select
- อัปโหลด Excel ผ่านเว็บด้วยไลบรารี `xlsx`: ปุ่ม "อัปโหลด Supplier" (ล้างแล้ว insert ใหม่ทีละ 100 แถว) และ "📤 อัปโหลด Product Master" (จับคู่หัวคอลัมน์ด้วย `MASTER_HEADER_MAP` regex)
- Supplier autocomplete: พิมพ์ ≥ 2 ตัวอักษรใน field Supplier → ค้นจาก `ss_suppliers`
- SKU autocomplete (ฟอร์ม Order + BackOrder): ใช้ helper กลาง **`searchProductUnits(term, opts)`** ค้นจากตาราง `products` เติมชื่อ/หน่วยอัตโนมัติ — ดูหัวข้อ "ช่องค้นหา SKU" ด้านล่าง
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

## CSV / Excel Format

**Products CSV** — เรียกไฟล์นี้ว่า **R05.106** (Admin → Upload):  
27 คอลัมน์ · ตรวจกับ export จริง 11 ไฟล์ (พ.ค.–ส.ค. 2569) หัวคอลัมน์นิ่งทุกไฟล์

> 📌 **ชื่อเรียกกลาง = `R05.106`** (ตามเลขรายงานของ Promax) ใช้ชื่อนี้ในโค้ด เอกสาร และ UI ทุกที่
> **ไม่มีชื่อไฟล์บังคับ** — อัปโหลดผ่านหน้าเว็บ เลือกไฟล์เอง โค้ดรับ `.csv` อะไรก็ได้แล้วตรวจ *หัวคอลัมน์* แทน (ต่างจาก `upload-stock.mjs` / `upload-customer-history.mjs` ที่ล็อกชื่อไฟล์ใน `CSV_CANDIDATES` เพราะรันอัตโนมัติ ไม่มีคนเลือก)
> ชื่อที่ export กันมาจริงไม่นิ่ง — `05106.CSV`, `R05106.CSV`, `R05.106-26-5-2026.CSV`, `R05106-11082026.CSV` ฯลฯ จึงยึดหัวคอลัมน์เป็นตัวตัดสิน ไม่ใช่ชื่อไฟล์
> ป้ายใน UI: ปุ่ม **`Upload R05.106`** + subheader `© Data → R05.106 | Assignee : Inbound` ในหน้า Admin

| field | idx | คอลัมน์ | header |
|---|---|---|---|
| barcode | 0 | A | `CF_BARCODE` |
| price | 1 | B | `CF_FMLPRICE` |
| sku | 4 | E | `CF_ITEMID` |
| name | 5 | F | `CF_ITEMNAME` |
| unit | 6 | G | `CF_UNITNAME` |
| **base_multiple** | **7** | **H** | `CF_BASEMULTIPLE` |
| **category** | **16** | **Q** | `CF_ITEMGROUPL1_GROUPNAME` |

- **`CF_BASEMULTIPLE` (H) = ตัวคูณหน่วย** — `1` = หน่วยเล็กสุด, `>1` = หน่วยใหญ่ที่บรรจุหลายหน่วยเล็ก
  - ตัวอย่าง SKU 100098 Antacil: `1`=แผง ฿15 · `10`=10แผง ฿116 · `12`=โหล ฿139 · `50`=กล่อง ฿512
  - **เก็บทุกแถวลง DB ไม่กรองตอนอัปโหลด** — ไม่งั้นสแกนบาร์โค้ดกล่องแล้วค้นหาไม่เจอ
  - กรองเหลือ `=1` ที่ **view `v_products_by_category`** เท่านั้น (เฉพาะหน้าเลือกตามหมวด)
  - ข้อมูลจริง: 10,761 คู่ `sku-unit` → กรองแล้วเหลือ **7,905 = 1 ป้ายต่อ SKU พอดี** · ทุก SKU มีแถว `=1` เสมอ ไม่มีตัวไหนหาย
- ⚠️ **หมวดอยู่คอลัมน์ Q ไม่ใช่ C** — คอลัมน์ C คือ `CF_COMMENTS` (โน้ตอิสระ ว่าง 10,792/10,841 แถว ที่เหลือเป็นค่ามั่ว เช่น `บาร์เก่า`, `WEGO`) · โค้ดเดิมอ่าน C มาตลอดจน `products.category` เป็น `'ทั่วไป'` เกือบทั้งตาราง — แก้แล้ว 2569-08-11
- **ค้นคอลัมน์จากชื่อหัวเท่านั้น ไม่มี fallback ตำแหน่ง** — `PRODUCT_CSV_COLUMNS` + `resolveProductCsvColumns()` ใน `App.tsx` · ขาดคอลัมน์ไหน throw ก่อนแตะ DB
- ทดสอบแล้วว่ากันไฟล์ผิดได้ด้วยรายงาน Promax ตัวจริงที่หน้าตาใกล้เคียง: `R05.105` (ขาด `CF_BARCODE`), `R01.102` สต๊อค (ขาด `CF_BARCODE` + `CF_FMLPRICE`) — สองตัวนี้คือไฟล์ที่มีโอกาสหยิบผิดจริง
- UTF-8 BOM: ไฟล์จริงมี BOM แต่ **PapaParse ตัดให้เอง** ไม่ต้อง strip
- `DELETE` เป็นค่าหมวดที่พบมากสุด (4,818 แถว) — **ไม่กรองออก** เก็บตามไฟล์ เพื่อให้ยังค้นหาเจอ
- ⚠️ **ห้ามสร้างไฟล์ CSV ตัวอย่างสมมติขึ้นมาใหม่** — เดิมมี `sample-products.csv` ที่คอลัมน์ไม่ตรงกับ R05.106 (B เป็น `Brand`) แล้ว `README.md` / `QUICKSTART.md` ก็ไปลอก layout ของไฟล์สมมตินั้นมาเขียนเป็น "รูปแบบไฟล์ CSV" (ราคาอยู่ I) ทำให้เอกสารผิดตามกันทั้งชุด · ลบไฟล์และแก้เอกสารแล้ว 2569-08-11 — ถ้าต้องการไฟล์เทส ให้ใช้ export จริงจาก Promax

**Location XLSX** (export จาก Promax → อัปโหลดผ่านเว็บ ปุ่มในเมนู "เลือกตามหมวด"):  
มี **2 layout จริง** ที่ต้องรองรับพร้อมกัน — ตำแหน่งคอลัมน์ SKU ต่างกัน แต่ชื่อหัวคอลัมน์เหมือนกัน:

| ไฟล์ | SKU | หมวด | ตำแหน่งชั้นวาง |
|---|---|---|---|
| `Location-SSS*.xlsx` | **D**(3) `CF_ITEMID` | **F**(5) `CF_ITEMGROUPL1_GROUPNAME` | **A**(0) `Location` |
| `Location-SRC.xlsx` | **D**(3) `CF_ITEMID` | **F**(5) `CF_ITEMGROUPL1_GROUPNAME` | **A**(0) `Location` |
| `Location-WH.xlsx` | **A**(0) `CF_ITEMID` | **F**(5) `CF_ITEMGROUPL1_GROUPNAME` | **E**(4) `LOCATION` |

- ตำแหน่งชั้นวางก็ต้อง**หาโดยชื่อหัวคอลัมน์**เหมือนกัน — ไฟล์สาขาอยู่คอลัมน์ A แต่ไฟล์ WH อยู่คอลัมน์ E · ไม่บังคับ ถ้าไม่มีคอลัมน์นี้ก็ปล่อยว่าง ไม่ throw
- ค่า `-` (พบในไฟล์ WH) ถือเป็นว่าง ตัดทิ้งไม่ให้ไปโผล่บนป้าย
- ข้อมูลจริง: SSS 2,640 SKU · SRC 3,225 SKU · **มี location ครบ 100% ทั้งคู่**

- ⚠️ **หาคอลัมน์ด้วยชื่อหัวคอลัมน์เสมอ ไม่ใช่ตำแหน่ง** (`parseLocationSheet` ใน `App.tsx`) — fallback หมวด = index 5
- ⚠️ **key ที่เสถียรคือ "เลขนำหน้า" ไม่ใช่ข้อความไทย** — ข้อความต่างกันระหว่างไฟล์: SSS = `"6. เครื่องสำอาง"` แต่ WH = `"6. เวชสำอาง / เครื่องสำอาง"` · WH = `"7. เวชภัณฑ์ / เครื่องมือแพทย์ / ทำแผล"` (มีเว้นวรรครอบ `/`)
- parse ด้วย `/^\s*(\d{1,2})\s*\./` เก็บเฉพาะ **1–9** — regex เดียวคัด `DELETE` (3,460 แถวใน WH), `อุปกรณ์สำนักงาน / ค่าใช้จ่าย / ขนส่ง`, `12. ของใช้ประจำภายในร้าน`, ค่าว่าง ออกครบ ไม่ต้องทำ blocklist
- ⚠️ **อ่านชีทแรกเท่านั้น** (ชื่อ `Location`) — ชีท 2 (`R5.106` / `หน่วยสินค้า(R5.106)`) คอลัมน์คนละตำแหน่ง
- ใช้ `sheet_to_json(ws, { header: 1, ... })` (array-of-arrays) **ไม่ใช่ object mode** เพราะ (ก) ต้องรู้ตำแหน่งคอลัมน์เพื่อทำ fallback (ข) `Location-WH` มี `CF_UNITNAME` ซ้ำ 2 คอลัมน์ object mode จะเปลี่ยนชื่อตัวที่สองเงียบ ๆ
- ข้อมูลจริง (ส.ค. 2569): รวม 2 ไฟล์ = **4,018 SKU** ในหมวด 1–9 · ไม่มี SKU ชนคนละหมวด · 4,017/4,018 match `products`

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
- 6-digit exact → `.or('sku.eq.x,barcode.eq.x')` — **ค้นทั้ง 2 คอลัมน์แบบตรงตัว**
- Other queries → `.or('name.ilike.%x%,barcode.ilike.%x%')` (no sku in OR for non-6-digit)
- Limit 30 results
- Empty search → no results shown (shows scannedHistory instead)
- On new search → hiddenKeys reset automatically
- Barcode exact match → auto-add to cart + scannedHistory (scanner workflow)
- ⚠️ **auto-add จะทำงานเฉพาะตอนผลลัพธ์เหลือแถวเดียว** (`filteredProducts.length > 1` → `return`)

### ⚠️ เลข 6 หลักเป็นได้ทั้ง SKU และ barcode — แก้ 2569-08-16

ตาราง `products` มี barcode หลายความยาวปนกัน: **13 หลัก 7,267 แถว · 6 หลัก 1,308 · 8 หลัก 1,224 · มีตัวอักษรปน 602 · 12 หลัก 203 · 14 หลัก 172** (ที่เหลือหลักหน่วย) — เลขที่พิมพ์มา 6 ตัวจึงตัดสินไม่ได้ว่าเป็น SKU หรือ barcode ต้องค้นทั้งคู่

**บั๊ก 1 — ค้นเจอแค่หน่วยเดียวทั้งที่มีหลายหน่วย** (พบจากการค้น SKU `100074`)
- **647 SKU** (26% ของ SKU ที่มีหลายหน่วย) ใช้**เลข SKU เป็น barcode ของหน่วยเล็ก** เพราะไม่มี EAN จริง เช่น `100074` → `แผง` barcode `100074` · `กล่อง` barcode `8850239003882`
- พิมพ์ `100074` → query ได้ 2 แถวถูกต้อง → แต่ effect auto-add เจอ `barcode === search` เลยนึกว่าสแกนบาร์โค้ด → ใส่ตะกร้า + `setSearchTerm('')` → `visibleProducts` ตกไปโหมด scan → **เหลือโชว์แถวเดียว แถว `กล่อง` หายไป**
- แก้: ได้หลายแถว = คำค้นกำกวม → ไม่ auto-add ปล่อยให้เลือกเอง

**บั๊ก 2 — barcode 6 หลักบางตัวค้นไม่เจอเลย**
- barcode 6 หลัก 1,308 แถว ในนั้น **159 แถวไม่ตรงกับ `sku` ของตัวเอง** เช่น barcode `109331` เป็นของ sku `100056` · barcode `101014` เป็นของ sku `900572`
- ของเดิมค้นแค่ `sku.eq()` → เลขพวกนี้ได้ 0 แถวทั้งที่มีสินค้าอยู่จริง (ยิ่งเจอบ่อยกับ sku ที่ขึ้นต้นด้วยตัวอักษรอย่าง `X00313` / `S00014` ซึ่งไม่มีทางตรงกับเลข 6 หลักอยู่แล้ว)
- แก้: เปลี่ยนเป็น `.or('sku.eq.x,barcode.eq.x')` → เจอแถวเดียว → auto-add ทำงานตามปกติ

> ⚠️ **ห้ามกลับไปใช้ `.eq('sku', …)` อย่างเดียว** จะทำให้ 159 แถวนั้นหายไปอีก
> ⚠️ การสแกน EAN-13 ไม่กระทบเลย เพราะยาวเกิน 6 หลักจึงไปเข้า branch `.or(name/barcode ilike)` คนละทาง
- Manual search → must press 🛒 to add (no auto-add)
- Press − to qty=0 → row removed from table automatically
- Table always visible (opacity 0.5 during loading, never hidden)
- **`visibleProducts` มี 3 branch ลำดับ `category > search > scan`** — ใช้ helper `strip()` ร่วมกัน (filter `hiddenKeys` ก่อน แล้วค่อย reindex)
- พิมพ์อะไรก็ตามในช่องค้นหา (รวมถึงลบจนว่าง) → ออกจาก category mode · `clearAll` ล้าง category ด้วย
- category mode ใช้ `categoryLoading` **แยกจาก `isLoading`** — search effect เรียก `setIsLoading(false)` ตอน early-return ซึ่งจะยิงตอน `loadCategory` เคลียร์ `searchTerm` แล้วฆ่า spinner กลางคัน

## Category Select — เลือกตามหมวด (หน้าป้ายราคา)

ปุ่ม "เลือกตามหมวด" ที่ `.selected-table-header` → dropdown **tab สาขา + 9 หมวด** → กดแล้วโหลดสินค้าของหมวดนั้นเฉพาะสาขาที่เลือกขึ้นตาราง (ไม่เข้าตะกร้าทันที) ผู้ใช้ตรวจ/ลบก่อน แล้วกด "เลือกทั้งหมด" → พิมพ์

- **label ปุ่มใช้คำของผู้ใช้ ไม่ใช่ข้อความในไฟล์ Excel** — `PRODUCT_CATEGORIES` ใน `App.tsx` · key คือเลขนำหน้า 1-9
- ⚠️ **สาขาล็อกตามโปรไฟล์ที่ล็อกอิน เลือกเองไม่ได้** — `Profile.branch` ใน `auth.ts` · ไม่มี tab ให้สลับ แสดงเป็นป้าย `🔒 สาขา X` · เจตนาคือกันปริ้นป้ายผิดสาขา
- **ฟีเจอร์นี้ใช้เฉพาะสาขาหน้าร้าน `SRC` / `KKL` / `SSS`** — โปรไฟล์ `WAREHOUSE` (คลังสินค้า) และ `PURCHASING` (จัดซื้อ) มี `branch: null` → **ซ่อนปุ่ม "เลือกตามหมวด" ทั้งปุ่ม** เพราะคลังไม่ได้ติดป้ายราคาที่ชั้นวาง และจัดซื้อไม่ใช่หน่วยหน้าร้าน
- `profileBranch` ตรวจว่าค่าใน `auth.ts` อยู่ใน `CATEGORY_BRANCHES` จริง — สะกดไม่ตรงจะ `console.error` + ซ่อนปุ่ม แทนที่จะได้ 0 แถวเงียบ ๆ (ชื่อสาขาอยู่คนละไฟล์กับที่ใช้ query)
- เปลี่ยนโปรไฟล์ (logout/login คนละคน) → `useEffect` บน `authProfile?.id` ล้าง category state ทิ้ง เพราะ component ไม่ได้ unmount ตอน logout
- ปุ่มอัปโหลดบันทึกลง**สาขาของโปรไฟล์เท่านั้น** — `guessBranchFromFileName()` ใช้แค่เตือนใน confirm ถ้าชื่อไฟล์ดูเป็นของสาขาอื่น
- ปุ่มหมวดของสาขาที่ยังไม่มีข้อมูลจะ disabled + ขึ้นข้อความให้อัปโหลดไฟล์สาขานั้นก่อน
- ดึงข้อมูลผ่าน view `v_products_by_category` + `.eq('branch', …)` + `.range()` ทีละ 1000 แถว วนจนได้ `< 1000` (**ไม่ใช้ two-step `.in()`** — `.in()` โดน cap 1000 เหมือนกันและตัดข้อมูลเงียบได้ · view ใช้ 2 requests แทน ~11 และ order ที่ server ทำให้ pagination ถูกต้อง)
- `categoryCounts` cache key = `` `${branch}|${category_no}` `` — 1 คำขอได้ครบทุกสาขาทุกหมวด (สูงสุด 4×9 = 36 แถว)
- **dedupe `sku-unit` ฝั่ง client** — `products` มีคู่ซ้ำ 80 คู่ (10,843 แถว / 10,763 คู่) ที่ 1,300 แถวชนแน่ → React duplicate key + cart ชนกัน
- `categoryReqRef` token กัน race — ปุ่ม 9 อันติดกัน fetch ~400ms กดรัวแล้วผลสลับหมวดได้ เช็ค token หลังทุก `await`
- badge จำนวนต่อหมวดยิงตอน**เปิด dropdown** ไม่ใช่ตอน mount · cache ทั้ง session · ล้างหลังอัปโหลด
- `เลือกทั้งหมด` เป็น **setState เดียว** (ของเดิมเรียก `handleAddToCart` ใน loop = O(n²)) + `window.confirm` เมื่อเกิน 200 รายการ
- CSS prefix `.cat-` ทุกตัว — `.selected-table-header` **ใช้ร่วมกับ StockCheck / CustomerHistory / Outbound ห้ามแตะ** · `.cat-dropdown` ต้อง `position: fixed` เลียนแบบ `.cart-dropdown` เพราะ `.product-table-wrap` มี `overflow: auto`
- **กรองเหลือหน่วยเล็กสุด** — view มี `WHERE COALESCE(p.base_multiple, 1) = 1` → 1 ป้ายต่อ SKU ไม่มีหน่วยใหญ่ (กล่อง/โหล) ปนมา · ดูรายละเอียด `CF_BASEMULTIPLE` ในหัวข้อ CSV / Excel Format
  - ⚠️ ตัวกรองจะทำงานจริง**หลังอัปโหลด R05.106 รอบใหม่**เท่านั้น — แถวเก่าที่ยังไม่มี `base_multiple` เป็น `NULL` ซึ่ง `COALESCE` ถือว่าเป็นหน่วยเล็กสุด (พฤติกรรมเท่าเดิม ไม่พังระหว่างรอ)
- จำนวนป้ายต่อหมวด **หลังกรอง** (คาดการณ์จากไฟล์จริง ส.ค. 2569):

| สาขา | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| SSS | 538 | 390 | 170 | 163 | 290 | 177 | 538 | 167 | 207 |
| SRC / KKL | — ยังไม่มีไฟล์ Location ของสาขานี้ — |

> ก่อนกรอง SSS หมวด 1 คือ 1,024 แถว → หลังกรองเหลือ 538 (**ลดลง ~47%**) เพราะตัดหน่วยกล่อง/โหล/แพ็กออก
> หมวดหนักสุดเหลือ ~540 แถว ปัญหา DOM หนักจึงหมดไป

- ⚠️ **`Location-WH.xlsx` ใช้กับฟีเจอร์นี้ไม่ได้แล้ว** — เป็นไฟล์ของคลังซึ่งถูกตัดออก · SRC และ KKL ต้อง export ไฟล์ Location ของสาขาตัวเองมาอัปโหลด ถึงจะใช้ปุ่มนี้ได้ (ระหว่างนี้ปุ่มหมวดจะ disabled พร้อมข้อความบอก)

- ไม่ทำ pagination ฝั่ง UI — โจทย์คือ "พิมพ์ทั้งหมดในหมวด"

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
| `outboundItems` | `OutboundRow[]` | แถวเบิกสินค้าในหน้าเบิกด่วน (รวมสถานะอนุมัติ) |

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
- หัวตารางป้ายราคามี 4 ปุ่ม เรียงซ้าย→ขวา: `เลือกตามหมวด │ รายการที่เลือก │ เลือกทั้งหมด │ ลบทั้งหมด` — 2 dropdown (หมวด / ตะกร้า) เปิดพร้อมกันไม่ได้
- อัปโหลดในโปรเจกต์มี 2 จุดแยกกัน status คนละตัว: **Admin panel → `Upload R05.106`** (CSV, delete-all + insert, `uploadStatus`) และ **เมนูเลือกตามหมวด → `📁 อัปโหลด Location → <สาขา>`** (XLSX, upsert + sweep, `locationStatus`, ไม่ต้องใส่รหัส)
- ปุ่มอัปโหลดทั้ง 2 จุด**บอกชื่อไฟล์ที่ต้องเลือกบนตัวปุ่ม** — ทั้งคู่รับไฟล์ชื่ออะไรก็ได้ ตัวตัดสินคือหัวคอลัมน์ ป้ายบนปุ่มจึงเป็นตัวช่วยเดียวที่กันหยิบผิดตั้งแต่ต้นทาง
- ทั้ง 2 จุดมีชุดกันพลาดเหมือนกัน: **เช็คหัวคอลัมน์ก่อนแตะ DB → confirm บอก `เดิม N → ใหม่ M` → เตือน 🚨 ถ้าไฟล์หดเกิน 20% → reset input ใน `finally`**
- กล่อง `uploadStatus` ต้องมี `whiteSpace: 'pre-line'` — ข้อความ error หัวคอลัมน์เป็นหลายบรรทัด

## Sale Support (หน้าซัพพอร์ต)

- Layout: `.ss-layout` = sidebar ซ้าย (`.ss-sidebar` เมนู 6 อัน) + panel ขวา (toolbar + ตาราง)
- เมนูขับเคลื่อนด้วย config `MENUS: MenuDef[]` — แต่ละเมนูกำหนด table, columns (`kind: 'date' | 'datetime' | 'chip'`), orderBy, filter, **`roles`**
- Chip สี: เขียว (`.ss-chip--green`) / แดง / ฟ้า / ส้ม ตามค่าสถานะ
- คลิกแถว → popup รายละเอียด (แก้ไข inline ได้) — Order/BackOrder popup มีตราประทับอนุมัติ 3 ขั้น บันทึกลง Supabase ทันที
- **หน้านี้แยกพฤติกรรมตามโปรไฟล์ 3 แบบ** ผ่าน props: `isPurchasing` (`authProfile.id === 'PURCHASING'`) · `isWarehouse` (`authProfile.group === 'คลังสินค้า'`) · `userBranch` (`authProfile.branch` → `isBranchUser` ในไฟล์)
- 3 อย่างนั้นยุบเป็น `currentRole: MenuRole` (`'branch' | 'warehouse' | 'purchasing'`) → `visibleMenus` กรอง `MENU_DISPLAY_ORDER` ด้วย `MenuDef.roles` (ไม่ใส่ `roles` = ทุกโปรไฟล์เห็น)
  - ⚠️ `visibleMenus` ยังเป็น **whitelist ตอนเปิดจากลิงก์แจ้งเตือน** (`openNotificationEvent`) ด้วย — ไม่งั้นลิงก์จะพาไปเมนูที่ถูกซ่อน แล้วออกไม่ได้เพราะไม่มีปุ่มใน sidebar

### เมนู Order — สาขาเห็นเฉพาะของตัวเอง

`isBranchUser` → เติม `.eq('branch', userBranch)` ในทั้ง **2 query** ที่แตะ `ss_orders` · คลัง/จัดซื้อเห็นทุกสาขาเพราะดูแลให้ทั้งหมด

1. query ตาราง (effect หลัก) — กรองที่ server ไม่ใช่ฝั่ง client ไม่งั้น `limit 500` จะถูกกินโดยแถวของสาขาอื่น
2. query นับเมนูย่อย 3 ขั้น — ⚠️ **ต้องกรองให้ตรงกัน** ไม่งั้นเลขบน badge จะนับรวมสาขาที่ผู้ใช้มองไม่เห็น แล้วกดกรองแล้วตารางว่าง
- **ไม่มีป้ายบอกว่าถูกกรอง** — เคยใส่ `🔒 สาขา X` ใน toolbar แล้วผู้ใช้ให้เอาออกเพราะรก (2569-08-13) อย่าใส่กลับ
- เช็ค `row.branch === userBranch` ใน `showOutboundAlert()` ซ้ำซ้อนกับ query แล้ว — เก็บไว้เป็นกันชนโดยตั้งใจ
- ฟอร์ม ➕ New Order **ล็อกสาขาตามรหัสที่ล็อกอินแล้ว** (`.ss-branch-locked-value` ไอคอน 🔒 แก้ไม่ได้) — เดิม default เป็น `SRC` ทำให้ KKL/SSS สร้าง Order ผิดสาขาแล้วมองไม่เห็นทันที · คลัง/จัดซื้อยังเลือก dropdown ได้ตามปกติ
- ผู้รับ Order ตัดสิน**อัตโนมัติจาก `product_master.abc` ของ SKU ที่กรอก** ตอนกดบันทึก (`saveOrder`): `P` → `PURCHASING` · หา SKU ไม่เจอใน Product Master → `BOTH` (ไม่ทราบ ABC กันออเดอร์ไม่มีใครเห็นเลย) — ไม่มีช่องให้เลือกแผนกในฟอร์มแล้ว
- ⚠️ **New Order เฉพาะยา Pre (`ABC = P`) เท่านั้น — บังคับจริงตั้งแต่ 2569-08-17** ไม่ใช่แค่ข้อความหัวป็อปอัพ "(เฉพาะยา Pre เท่านั้น)" เฉยๆ (ก่อนหน้านี้ช่องค้นหายังเจอ SKU ทุก ABC และ `saveOrder` ยัง route ABC ที่ไม่ใช่ P ไป `WAREHOUSE` ได้ ขัดกับข้อความหัวป็อปอัพ) — ล็อก 2 ชั้น:
  1. ช่องค้นหา SKU (`lookupSku`/`handleSkuChange`) ใส่ `onlyP: true` ให้ `searchProductUnits()` — พิมพ์/กด Enter หา SKU ที่ไม่ใช่ P จะไม่มี suggestion ขึ้นเลย (ตรงข้ามกับ BackOrder ที่ใช้ `excludeP`)
  2. `saveOrder` เช็คซ้ำ `abc !== 'P'` (เมื่อพบใน Product Master) ก่อน insert เสมอ — กันพิมพ์ SKU เองตรงๆ โดยไม่ผ่านช่องค้นหาเลย ถ้าเจอว่าไม่ใช่ P จะไม่ insert และ error ชี้ไปเมนู BackOrder แทน (ข้อความเดียวกับที่ BackOrder ชี้กลับมา Order เวลาเจอ SKU เป็น P) · **SKU ที่หาไม่เจอใน Product Master ยังผ่านได้เป็น `BOTH` เหมือนเดิม** (ไม่บล็อกยาใหม่ที่ยังไม่มีในฐาน)
  - ผลคือ `recipient_department` ของ Order ใหม่ทุกใบมีได้แค่ `PURCHASING` หรือ `BOTH` เท่านั้น — ค่า `WAREHOUSE` เป็นได้แค่ข้อมูลเก่าก่อนวันที่นี้ (โค้ดอ่าน/แสดงผลค่านี้ได้ตามปกติ แค่ไม่มีทาง insert ใหม่แล้ว)

### ช่องค้นหา SKU ในฟอร์ม (Order + BackOrder) — `searchProductUnits()`

helper กลางตัวเดียวใช้ทั้ง 2 ฟอร์ม — `searchProductUnits(term, { exact?, excludeP?, onlyP? })`

- ⚠️ **ต้องอ่านจาก `products` ห้ามใช้ `product_master`** — `product_master` มี **unique ที่ `sku`** คือ 1 แถวต่อ SKU เก็บแค่ `base_unit` → SKU ที่มีหลายหน่วยจะเห็นแค่หน่วยเดียว (แก้ 2569-08-16: ฟอร์ม Order เคยใช้ `product_master` จึงพิมพ์ `100074` แล้วเจอแค่ `แผง` ไม่เห็น `กล่อง` ทั้งที่หน้าป้ายราคาเห็นครบ)
- `products` มี 1 แถวต่อ barcode = ครบทุกหน่วย และมีคอลัมน์ `barcode` ให้สแกนได้ ซึ่ง `product_master` ไม่มี
- ยุบผลลัพธ์ด้วย key `sku-unit` (ไม่ใช่ `sku`) — ไม่งั้นหน่วยที่ 2, 3 จะถูกตัดทิ้ง · **`key` ของ `<button>` ในลิสต์ก็ต้องเป็น `sku-unit`** ไม่งั้น React duplicate key
- ดึง `.limit(40)` แล้วค่อยเหลือ 8 เพราะโดนยุบหน่วยซ้ำ + อาจโดนกรอง ABC (excludeP/onlyP) อีกทอด
- **กด Enter (`exact: true`)** → `.or('sku.eq.x,barcode.eq.x')` · เจอ **1 หน่วย = เติมให้เลย** · เจอ **หลายหน่วย = โชว์รายการให้เลือกเอง** (ห้ามเดาหน่วยแทนผู้ใช้)
- **พิมพ์ไปเรื่อย ๆ (3 ตัวขึ้นไป)** → `.or('sku.ilike.x%,barcode.ilike.x%,name.ilike.%x%')` หน่วง 250ms + `suggestReqRef` token กัน race
- `excludeP: true` (BackOrder ใช้) → กรอง `ABC = P` ออก ฝั่ง client ผ่าน `findPurchasingSkus()`
- `onlyP: true` (Order ใช้ — เพิ่ม 2569-08-17) → เอาเฉพาะ `ABC = P` ผ่าน `findPurchasingSkus()` ตัวเดียวกัน กลับทิศกับ `excludeP` (2 ตัวใช้พร้อมกันไม่ได้)
- ทั้ง Order และ BackOrder กด Enter แล้วไม่เจอ (หลังกรอง ABC) จะเช็คซ้ำแบบไม่กรอง P เพื่อแยกข้อความ **"ไม่มีสินค้านี้"** ออกจาก **"มีแต่เป็นคนละฝั่ง"** — ไม่ปล่อยเงียบ: BackOrder เจอว่าเป็น P จะบอกให้ไปใช้เมนู Order · Order เจอว่าไม่ใช่ P จะบอกให้ไปใช้เมนู BackOrder (ข้อความสมมาตรกัน)

ตัวอย่างผลจริง (พิมพ์ในช่อง SKU):

| พิมพ์ | เดิม (product_master) | ใหม่ (products) |
|---|---|---|
| `100074` | 1 รายการ — `แผง` | **2 รายการ — `แผง` \| `กล่อง`** |
| `100034` | 1 รายการ — `แผง` | **3 รายการ — `แผง` \| `10แผง` \| `กล่อง`** |
| `109331` (barcode ของ sku `100056`) | **0 รายการ — หาไม่เจอ** | **1 รายการ — `100056 แผง`** |

### จุดแจ้งเตือน "🔔 Order ใหม่" ฝั่งคลัง/จัดซื้อ (`departmentCode`)

จุดแดงหน้า SaleSupport (เห็นจากทุกหน้าในแอปผ่าน `PageNotificationContext`) + ปุ่ม "🔔 Order ใหม่" ในตัวหน้า SaleSupport เอง — **มีเฉพาะ Order เท่านั้น ไม่มีของ Request Item/BackOrder/เมนูอื่น**

- นับ+ subscribe ที่ `App.tsx` (effect เดียว ใช้ทั้งสาขาและแผนก แยกด้วย `isNotifiedBranch` ternary): สาขานับจาก `ss_branch_notification_events` (ดูหัวข้อ Sale Support ด้านล่าง) · คลัง/จัดซื้อนับจาก `ss_orders` โดยตรง — ไม่มีตารางเหตุการณ์แยก
- คลัง/จัดซื้อนับด้วย `.in('recipient_department', [departmentCode, 'BOTH']).is('recipient_read_at', null)` — ทั้ง initial query และ realtime channel filter (`recipient_department=in.(${departmentCode},BOTH)`) ต้องกรองแบบเดียวกันเป๊ะ
- มาร์คว่าอ่านแล้วที่ `SaleSupportPage.tsx` (คนละ effect กับตัวนับใน App.tsx): เปิดเมนู Order (`activeMenu === 'order'`) ขณะมี unread → `update recipient_read_at` ด้วย filter เดียวกัน (`.in([departmentCode, 'BOTH'])`)
- ⚠️ **บั๊ก 2569-08-17 (แก้แล้ว):** เดิมทั้ง 3 จุด (นับ, realtime filter, มาร์คอ่าน) ใช้ `.eq('recipient_department', departmentCode)` เฉยๆ — Order ที่ SKU หาไม่เจอใน Product Master ตอนบันทึก (`recipient_department = 'BOTH'`, ดูหัวข้อ "เมนู Order — สาขาเห็นเฉพาะของตัวเอง" ด้านบน) จึง **ไม่เคยขึ้นแจ้งเตือนให้ทั้งคลังและจัดซื้อเลยสักครั้ง** ทั้งที่มองเห็นในตารางปกติ (ตารางใช้ `.in()` อยู่แล้ว) — เจอจากเคสจริง (SKU `101369` ของสาขา SSS ค้างไม่แจ้งเตือน) ตอนตรวจสอบว่าทำไมสาขาลง Order/Request Item แล้วจัดซื้อไม่เห็นแจ้งเตือน
  - ถ้าพลาดจุดใดจุดหนึ่งจาก 3 จุดนี้ตอนแก้ต่อ: นับเห็นแต่มาร์คอ่านไม่ได้ (ค้างตลอดไป) หรือมาร์คอ่านได้แต่ realtime ไม่ sync (ต้องรอ poll 30s)
- **Request Item ไม่มีกลไกแจ้งเตือนแผนกแบบนี้เลย** — `saveRequest` ไม่มี concept ผู้รับแบบ `recipient_department`, `ss_request_items` ไม่มีคอลัมน์ทำนองนี้ และ query นับ badge ใน `App.tsx` แตะแค่ `ss_orders`/`ss_branch_notification_events` เท่านั้น ไม่แตะ `ss_request_items` — `notifyBranchUpdate()` ที่เรียกใน `saveRequest` เป็นทิศทาง **แผนก → สาขา** เท่านั้น (no-op ถ้าคนเรียกไม่ใช่คลัง/จัดซื้อ) จึงไม่ช่วยแจ้งจัดซื้อตอนสาขาสร้างรายการใหม่ · ไม่ใช่บั๊ก เป็นฟีเจอร์ที่ยังไม่เคยสร้าง — ถ้าต้องการต้องคุยขอบเขตแยก (เช่น จะนับยังไง จะมีปุ่มแบบ "🔔 Order ใหม่" ไหม)

### ตาราง Order — ดีไซน์ Two-line Row (ไม่ต้องเลื่อนแนวนอน)

24 คอลัมน์เดิมรวม `min` = **2,834px** ล้นทุกจอ (จอ 1920 มีที่ ~1,738px · แม้จอ 2560 ก็ยังเกิน 19%) → ยุบเหลือ **12 ช่อง** ด้วยดีไซน์ **"Two-line Row"** (แบบที่ 2 จาก `public/order-table-layout-designs.html`) ตามคำสั่งผู้ใช้ 2569-08-15

- **ข้อมูลยังครบ 24 ค่าเท่าเดิม ไม่ได้ตัดคอลัมน์ไหนทิ้ง** — ยัด 2 ค่าลงช่องเดียวคนละบรรทัด: บรรทัดบน = `label` · บรรทัดล่างตัวเล็กสีจาง = `sub.label`
- จับคู่ให้เป็น**เรื่องเดียวกัน**เพื่อให้อ่านคู่กันแล้วได้ความ: `เลขบิลขาย / เลขบิลสั่งซื้อ` · `วันชำระ / วันนัดรับ` · `Inbound / Outbound` · `ชื่อลูกค้า / เบอร์โทร`
- 3 ชิปสถานะยุบเป็นช่องเดียว (`kind: 'chips'` + `chipKeys: ORDER_STEP_KEYS`) เรียงลงมาตามลำดับงาน
- **วัดจริงด้วย `App.css` ตัวจริง + ฟอนต์จริง (Chrome headless):** ตารางต้องการ **1,500px** (ลดจากเดิม **47%**)

| จอ | ที่ว่าง | ผล |
|---|---|---|
| 1920 | 1,738px | ✅ พอดี เหลือ 238px |
| 1600 | 1,418px | ⚠️ ล้น 82px — ลากคอลัมน์ SKU (`--sku-name-width` default 320px) ให้แคบลงแล้วพอดี |
| 1366 | 1,184px | ⚠️ ล้น 316px |

**จุดที่ต้องระวังเวลาแก้ต่อ:**
- ⚠️ `ColumnDef.sub` เป็น **`ColumnDef` เต็ม ๆ ไม่ใช่แค่ key** — เพราะ `formatCell` ต้องใช้ `kind` ของบรรทัดล่างเอง (ไม่งั้นวันที่จะโชว์เป็น ISO ดิบ)
- ⚠️ `<td>` **ห่อด้วย `.ss-cell-main` เฉพาะคอลัมน์ที่มี `sub`** — เมนูอื่น (Products / Request / Ticket / BackOrder) ไม่มี `sub` จึง render โครงเดิมเป๊ะ ไม่ได้รับผลกระทบ
- ⚠️ `min` ในคอลัมน์คู่คือความกว้างของ**ทั้งช่อง** = ค่าที่กว้างกว่าใน 2 บรรทัด **ไม่ใช่ผลรวม**
- ⚠️ `ORDER_STEP_KEYS` ประกาศ**ก่อน** `MENUS` แล้ว `ORDER_STEPS` อ้างค่าจากตัวนี้ (`key: ORDER_STEP_KEYS[0]`) — แหล่งเดียว ห้ามพิมพ์ key ซ้ำอีกที่
- `ORDER_DETAIL_FIELDS` (popup) / `EDIT_FIELDS` (ฟอร์มแก้ไข) เป็นคนละลิสต์กับ `MENUS[order].columns` — เปลี่ยนคอลัมน์ตารางไม่กระทบ popup
- ป้าย `.ss-out-badge` / `stampStatusBadge` ยังผูกกับ `sku_name` ซึ่งยังเป็นคอลัมน์แรกเหมือนเดิม
- **BackOrder ไม่ได้เปลี่ยน** — ยังเป็นตารางคอลัมน์ละค่า (ยังไม่ได้ขอมา)

### เมนู Request Item — SKU/MOQ เป็นงานฝั่งจัดซื้อ แต่ทุกโปรไฟล์ดูได้ (2569-08-17)

`ss_request_items` ไม่มี `roles` ที่ระดับเมนู (ทุกโปรไฟล์เห็นเมนูนี้) — `sku` และ `moq` เป็นข้อมูลที่**จัดซื้อเป็นคนกรอก แต่สาขา/คลังต้องมองเห็นได้** (สาขาต้องรู้ว่าจัดซื้อลง SKU/MOQ ไว้แล้วหรือยัง) จึงกันแค่**สิทธิ์แก้ไข** ไม่ใช่การมองเห็น — ทั้งคู่ตอนนี้พฤติกรรมเหมือนกันทุกจุด:

| จุด | non-purchasing | purchasing |
|---|---|---|
| คอลัมน์ในตาราง (`MENUS['request'].columns`) | เห็นเป็นข้อความอ่านอย่างเดียว | เห็นเป็น `<input>` พิมพ์แก้ตรงๆ ได้ |
| ฟอร์มแก้ไข (`DetailEditForm`) | ไม่เห็นช่องนี้เลย (`hideKeys={!isPurchasing ? ['sku', 'moq'] : undefined}`) | เห็นแก้ได้ |
| ฟอร์ม ➕ Add Request Item | ไม่เห็นช่อง SKU เลย (สาขายังไม่รู้ SKU ตอนขอสินค้าใหม่) ไม่มีช่อง MOQ ให้ใครกรอกตอนสร้างอยู่แล้ว | เห็นช่อง `SKU *` บังคับกรอก |

- ⚠️ **`sku` เคยถูกซ่อนทั้งคอลัมน์ตารางสำหรับ non-purchasing มาก่อน** (ตัวแปร `hideRequestSku` กรอง `visibleColumns`) — **เอาออกแล้ว 2569-08-17** ตามคำสั่งผู้ใช้ "สาขาต้องเห็นคอลัมน์ SKU ด้วยเนื่องจากจัดซื้อจะลงข้อมูลมา (แต่สาขาแก้ไขไม่ได้)" — `visibleColumns` ตอนนี้คือ `menu.columns` ตรงๆ ไม่มีการกรองพิเศษของ Request Item อีกแล้ว
- `leadtime` / `exp` / `availability` / `status` เป็นฟิลด์ "จัดซื้อกรอกทีหลัง" แนวคิดเดียวกัน แต่**ยังไม่มีการกรองสิทธิ์แก้ไข** — ยังแก้ได้ทุกโปรไฟล์ผ่าน `DetailEditForm` (ไม่ได้ขอมา จึงยังไม่แตะ)

**คอลัมน์ MOQ + SKU กรอกตรง ๆ ในตารางได้สำหรับจัดซื้อ** — ไม่ต้องเปิด ✏️ แก้ไขทุกครั้ง เหมือนกับที่ `status`/`availability` มีอยู่แล้วในตาราง Request Item แต่ทั้งคู่เป็น **text ไม่มีชุดตัวเลือกตายตัว** จึงใช้ `<input>` แทน `<select>`:
- `updateRequestMoq(id, moq, branch, itemSku, itemName)` / `updateRequestSku(id, sku, branch, itemName)` — คู่กับ `updateStatus`/`updateRequestAvailability` เดิม เขียน Supabase ตรง ๆ แล้ว `setRows` อัปเดต state โดยไม่ refetch ทั้งตาราง (ค่าว่าง → `null` ไม่ใช่ `''`)
  - ⚠️ `updateRequestSku` **ไม่มีพารามิเตอร์ `itemSku`** แบบตัวอื่น — เพราะค่าที่กำลังแก้คือ SKU เอง จึงส่งค่าใหม่ (`value`) เป็น `itemSku` ใน `notifyBranchUpdate` ตรงๆ แทนที่จะรับ `row.sku` (ค่าเก่า) เข้ามาแล้วไม่ได้ใช้
- render เงื่อนไข `activeMenu === 'request' && col.key === 'moq'/'sku' && isPurchasing` (แถวคู่กับ status/availability ในตัวจัดการเซลล์) — ไม่ผ่านเงื่อนไขตกไป render เป็นข้อความอ่านอย่างเดียวเหมือนคอลัมน์ทั่วไป (path เดียวกับที่ `formatCell` ใช้)
- **`<input>` เป็น uncontrolled + คอมมิตตอน `onBlur`** (Enter = trigger blur ผ่าน `e.currentTarget.blur()`) ไม่ใช่ controlled เขียนทุก keystroke เหมือน `<select>` เพราะข้อความยาวกว่า พิมพ์ทีละตัวแล้วยิง Supabase ทุกตัวอักษรจะช้าและไม่จำเป็น
- ⚠️ **`key` ของ `<input>` ผูกกับค่าปัจจุบันของฟิลด์นั้นด้วย** (`` `${row.id}-${currentMoq}` `` / `` `${row.id}-${currentSku}` `` ไม่ใช่แค่ `row.id`) — บังคับ React remount ช่อง uncontrolled นี้ทุกครั้งที่ค่าจาก DB เปลี่ยน (คอมมิตเอง หรือ refetch จากเมนูอื่นกลับมา) ไม่งั้น `defaultValue` จะค้างค่าตอน mount ครั้งแรกไม่ยอมอัปเดตตามข้อมูลจริง — ทดสอบแล้วว่าจำเป็นจริง (ยืนยันด้วย DB round-trip ผ่าน headless Chrome ทั้ง MOQ และ SKU)
- CSS `.ss-status-input` ลอก property จาก `.ss-status-select` ทุกตัวเพื่อให้แถวเดียวกันดูเป็นชุดเดียวกัน + คอลัมน์ `th.ss-col-moq`/`th.ss-col-sku` ขยายเป็น 100px (จาก `min: 80` ใน `MENUS`) ให้พิมพ์สบายขึ้น

**ฟอร์ม ➕ Add Request Item ล็อกสาขาตามรหัสที่ล็อกอินแล้ว** (`.ss-branch-locked-value` ไอคอน 🔒 แก้ไม่ได้ — แบบเดียวกับ New Order/Add BackOrder) — เดิม `emptyRequestForm()` default เป็น `SRC` เฉยๆ ทำให้ KKL/SSS สร้าง Request Item ผิดสาขาได้ (สร้างของ KKL ไปตกอยู่สาขา SRC โดยไม่รู้ตัว) · แก้ 2569-08-17 ตามแบบเดียวกับ `openAddOrder`/`openAddBackOrder`:
- `openAddRequest` ตั้ง `branch: isBranchUser ? (userBranch ?? 'SRC') : initialRequest.branch` ตอนเปิดฟอร์ม
- `saveRequest` **คำนวณสาขาซ้ำอีกทีตอนบันทึก** (`requestBranch = isBranchUser ? (userBranch ?? 'SRC') : requestForm.branch`) ไม่ได้เชื่อ `requestForm.branch` ตรงๆ — กันเหนียวสองชั้นแบบเดียวกับ Order/BackOrder
- คลัง/จัดซื้อยังเลือก dropdown ได้ตามปกติ (ตัวเลือกยังมี `Warehouse` เป็นตัวที่ 4 จาก `ORDER_BRANCHES` — ต่างจาก BackOrder ที่ใช้ `BACKORDER_BRANCHES` แค่ 3 สาขา)
- ⚠️ **New Product / Ticket มีช่อง "สาขา \*" แบบ dropdown เปล่าเหมือนกัน ยังไม่ได้ล็อก** — บั๊กคลาสเดียวกัน แต่โจทย์นี้ระบุเฉพาะ Request Item จึงยังไม่แตะ 2 เมนูนั้น

### เมนู BackOrder — สินค้าค้างส่ง (ABC ≠ P)

ตาราง `ss_backorders` แยกจาก `ss_orders` · **เห็นเฉพาะสาขา + คลังสินค้า** ผ่าน `roles: ['branch', 'warehouse']` ใน `MENUS` — จัดซื้อไม่เห็นเพราะดูแลเฉพาะ `ABC = P`

- สาขาเห็นเฉพาะของตัวเอง (`.eq('branch', userBranch)` ใน query) · คลังเห็นทุกสาขา จึงมีคอลัมน์ `Branch` ในตารางไว้แยกว่าแถวไหนของใคร

**⚠️ มี 2 คอลัมน์ตัวเลขคนละที่มา อย่าสลับกัน** (ตั้งชื่อตามคำสั่งผู้ใช้ 2569-08-15):

| คอลัมน์ | key | ที่มา | เก็บในตาราง? |
|---|---|---|---|
| **คลังมีสินค้า** | `stock_qty` | ยอดสดจาก `stock` สาขา `คลังสินค้า` | ✕ เติมหลัง fetch |
| **ค้างส่งลูกค้า** | `pending_qty` | สาขาพิมพ์เองในฟอร์ม ➕ Add BackOrder | ✓ `numeric` |

- **"คลังมีสินค้า" ทุกโปรไฟล์เห็นยอดของ `คลังสินค้า` เหมือนกัน** — สาขาต้องรู้ว่า**คลัง**มีของพอส่งไหม ไม่ใช่ว่าตัวเองเหลือเท่าไหร่ (เคยลองเปลี่ยนเป็นสต๊อกของสาขาเองแล้วผู้ใช้ยืนยันให้กลับมาเป็นของคลัง 2569-08-15)
- **"ค้างส่งลูกค้า" เป็นช่องบังคับ** ในฟอร์ม (`ค้างส่งลูกค้า *`, ต้อง > 0) เหมือน `จำนวน *` ของ New Order — แถวค้างส่งที่ไม่รู้จำนวนคลังเอาไปทำงานต่อไม่ได้
- **คอลัมน์ `unit` = หน่วยของบาร์โค้ดที่สแกน/เลือก** — ใน `products` **1 barcode ผูกกับ 1 หน่วยเสมอ** (ตรวจแล้วไม่ชนกันเลย) เช่น SKU 100098 มี 4 บาร์โค้ด: `แผง ×1` / `10แผง ×10` / `โหล ×12` / `กล่อง ×50`
  - ⚠️ **ตัวเลขในคอลัมน์ "คลังมีสินค้า" นับด้วยหน่วยของ `stock` ซึ่งเป็นหน่วยเล็กสุดเสมอ** (ตรวจกับข้อมูลจริงแล้ว `stock.unit` = แถวที่ `base_multiple = 1` ทุกตัวอย่าง) จึงอาจเป็นคนละหน่วยกับคอลัมน์ "หน่วย" — เช่น คลังมี `530` (แผง) แต่หน่วยที่บันทึกไว้คือ `กล่อง`
  - ตามคำสั่งผู้ใช้ (2569-08-14) **คอลัมน์จำนวนแสดงแค่ตัวเลข ไม่ต่อท้ายหน่วย** — หน่วยที่คลังนับย้ายไปอยู่ใน `title` (hover แล้วขึ้น `คลังนับเป็น แผง`) อย่าเอากลับมาต่อท้ายตัวเลข
- **"คลังมีสินค้า" + หน่วยที่คลังนับ ไม่ได้เก็บในตาราง** — `loadWarehouseStock()` ดึงสดจาก `stock` ที่ `branch = 'คลังสินค้า'` จับคู่ด้วย `sku` แล้วเติมเป็น `stock_qty` / `stock_unit` หลัง fetch (แบบเดียวกับที่เมนู Products เติม Distributor ด้วย `loadSupplierMap`)
  - ⚠️ **ไม่มีแถวใน `stock` = ไม่มีของจริง → แสดง `0` ไม่ใช่ช่องว่าง** — ตรวจข้อมูลจริงแล้ว **ไม่มีแถว `qty = 0` เลยสักสาขา** (มีแต่ค่าติดลบ) แปลว่าไฟล์ export ตัดของหมดสต๊อกออก
  - ⚠️ `loadWarehouseStock` คืน **`null` เมื่อ query error** (ไม่ใช่ map ว่าง) แล้วผู้เรียกปล่อยช่องว่างแทน `0` — ถ้าคืน map ว่างทุกแถวจะกลายเป็น `0` = "ไม่มีของ" ทั้งที่จริงคือ "อ่านไม่ได้"
  - ⚠️ **ไม่ cache** ต่างจาก `loadSupplierMap` เพราะสต๊อกถูกเขียนทับใหม่ทุก 5 นาทีจาก Task Scheduler
  - `stock.qty` เป็น `text` ค่าจริงหน้าตา `"13.0000"` → ต้อง `Math.floor(Number(...))` เหมือน `StockCheckPage` · ค่าที่ไม่ใช่ตัวเลขคงไว้ตามเดิม
  - ⚠️ ใช้ค่าคงที่ `WAREHOUSE_STOCK_BRANCH = 'คลังสินค้า'` **ห้ามใช้ `Profile.branch`** เพราะโปรไฟล์คลังมีค่าเป็น `null` (ตรงกับ `WAREHOUSE_BRANCH` ใน `OutboundPage.tsx`)
  - ดึงเฉพาะ SKU ที่อยู่บนหน้าจอด้วย `.in()` — cap 1000 แต่ตารางนี้ `limit 500` จึงพอเสมอ
- ช่อง SKU ในฟอร์ม ➕ Add BackOrder **กรอง `ABC = P` ออกฝั่ง client ไม่ใช่ `.neq('abc','P')`** — SQL จะตัดแถวที่ `abc` เป็น `null` ทิ้งไปด้วย (`null <> 'P'` คืน `null`) · ดึง `.limit(40)` แล้วค่อยกรองเหลือ 8 กันกรณีผลลัพธ์ต้น ๆ เป็น P ทั้งชุดแล้วรายการว่างเปล่า (ดูหัวข้อ "ช่องค้นหา SKU" ด้านล่าง)
  - ค่า ABC จริงในฐานข้อมูล (ส.ค. 2569): `C` 1,160 · `A` 916 · `B` 857 · `P` 685 · `D` 426 · `REVIEW` 45 — **ไม่มีค่าว่างเลย**
- **popup ใช้ตัวเดียวกับ Order** — `selectedOrderTable` state จำว่าแถวที่เปิดมาจากตารางไหน แล้ว `toggleOrderStep` / `saveWarehouseFields` ยิงไปตารางนั้น
  - ⚠️ อ่านจาก `activeMenu` แทนไม่ได้ — ฟังก์ชันบันทึกต้องผูกกับ**แถวที่เปิดอยู่** ไม่ใช่เมนูที่กำลังดู
  - คลังกรอกช่องเดียว (`BACKORDER_WAREHOUSE_FIELDS` = `outbound_date`) ต่างจาก Order ที่มี 3 ช่อง — เลือกด้วย `warehouseFieldsFor(table)`
  - ไม่มีฟอร์มจัดซื้อ (คอลัมน์ `order_type` ฯลฯ ไม่มีใน `ss_backorders`) — มี `!isBackOrderDetail` กันไว้ซ้ำแม้จัดซื้อจะเข้าเมนูนี้ไม่ได้
- ⚠️ **ค่า default ของ 3 สถานะใน SQL ต้องสะกดตรงกับ `ss_orders` เป๊ะ ๆ** เพราะ `stepDone()` ตัดสินด้วยการหาคำว่า `"แล้ว"` ในสตริง
- **ป้าย `.ss-out-badge` (Days Badge) ใช้ร่วมกับ Order** — `showOutboundAlert` / `stampStatusBadge` เช็คผ่านตัวแปร `isStampMenu` (`activeMenu === 'order' || 'backorder'`) · ใช้ได้เพราะ `ss_backorders` มี `outbound_date` + 3 คอลัมน์สถานะ ชื่อเดียวกับ `ss_orders`
- **ไม่มีเมนูย่อย 3 ขั้น** ใต้ปุ่ม BackOrder — `stepCounts` ยังนับจาก `ss_orders` อย่างเดียว (ยังไม่ได้ขอมา)

### Popup Order — โหมดคลังสินค้า

โปรไฟล์คลังสินค้า (รหัส `0000`) เห็น popup Order คนละแบบกับสาขา/จัดซื้อ:

| | สาขา | จัดซื้อ | คลังสินค้า |
|---|---|---|---|
| ปุ่ม ✏️ แก้ไข (ทั้งใบ) | ✕ | ✓ | **✕** |
| ตราประทับ 3 ขั้น | ✓ | ✓ | **✕ — แทนด้วยฟอร์ม 3 ช่อง** |

- ฟอร์มคลัง = `WAREHOUSE_FIELDS`: `inbound_date` (Inbound วันที่รับของ) · `outbound_date` (Outbound วันที่ส่งของ) · `transfer_no` (เลขโอนสินค้า/เลขจัดส่ง)
- **3 คอลัมน์นี้มีอยู่ใน `ss_orders` + `MENUS` ของ Order อยู่แล้ว** ไม่ต้องแก้ schema · กดบันทึกแล้ว `setRows` อัปเดตแถวในตารางทันทีโดยไม่ refetch
- ⚠️ **ช่องว่างต้องส่งเป็น `null` ไม่ใช่ `''`** — คอลัมน์ `date` ใน Postgres ตอบ `22007 invalid input syntax for type date` ถ้าได้สตริงว่าง (ทดสอบกับ DB จริงแล้ว)
- คลังไม่เห็น 3 ช่องนี้ในส่วนอ่านอย่างเดียวด้านบน (`orderDetailFields` กรอง `WAREHOUSE_KEYS` ออก) เพราะกรอกอยู่ในฟอร์มด้านล่างแล้ว
- ⚠️ `useEffect` ที่รีเซ็ตฟอร์ม **ผูกกับ `selectedOrder?.id` ไม่ใช่ทั้งอ็อบเจกต์** — `setSelectedOrder` ถูกเรียกทุกครั้งที่บันทึก ถ้าผูกทั้งอ็อบเจกต์จะล้างสิ่งที่พิมพ์ค้างไว้

### Toast แจ้งผลกดตราประทับ (Order / BackOrder)

pill กลางบนจอ โผล่ทุกครั้งที่กดตราใน popup — ดีไซน์ **"Top Center Drop"** (แบบที่ 2 จาก `public/stamp-toast-designs.html`) · เดิมกดแล้วสำเร็จ**เงียบสนิท** ไม่มีอะไรยืนยันนอกจากตราเปลี่ยนสี

- `pushStampToast(tone, title, detail)` ใน `SaleSupportPage.tsx` — 3 โทน: `ok` เขียว (อนุมัติแล้ว) · `cancel` ทอง (ยกเลิกสถานะแล้ว) · `error` แดง (อัปเดตไม่สำเร็จ)
- ข้อความ detail คือ `${step.label} → ${next}` = ค่าจริงที่เพิ่งเขียนลง DB (`ของถึงสาขา → ถึงแล้ว` / `→ ยังไม่ถึง`)
- ค้างพร้อมกันได้ `STAMP_TOAST_MAX = 2` ใบ (`.slice(-2)`) · อยู่บนจอ `STAMP_TOAST_MS = 3400` ms
- **ถอด toast ออกด้วย `onAnimationEnd` ไม่ใช่ timer ใบที่สอง** — timer แค่ตั้ง `leaving: true` แล้ว CSS animation จบเมื่อไหร่ค่อยถอดออกจาก state
- ⚠️ `.ss-toast-layer` **render อยู่ตลอดแม้ไม่มี toast** เพราะ `aria-live` ต้องมี live region อยู่ก่อนข้อความจะถูกใส่ → ต้องมี `pointer-events: none` ไม่งั้นเป็นแผ่นใสบังปุ่มกลางบนจอ
- ⚠️ `z-index: 1200` — ต้องสูงกว่า `.dl-modal-overlay` (1000) เพราะยิงตอน popup เปิดอยู่เสมอ และสูงกว่า `.ss-notification-overlay` (1100) ไม่งั้นโดน drawer ประวัติอัพเดททับ
- เคส error **ยิง toast คู่กับ `.ss-form-error` ใต้แถวตรา** (ไม่ได้แทนที่) — toast สะกิดให้รู้ทันที ส่วนข้อความใต้ตราค้างไว้ให้อ่านซ้ำได้หลัง toast หาย
- `toastTimersRef` เก็บ timer ไว้ `clearTimeout` ตอน unmount — กัน setState หลัง unmount ตอนออกจากหน้าระหว่าง toast ยังค้าง
- การยืนยันก่อนยกเลิกตราไม่ใช้ `window.confirm` แล้ว — ดูหัวข้อถัดไป

### กล่องยืนยัน "ยกเลิกสถานะ" — แทนที่ `window.confirm()`

pill/โมดัลกลางจอ โผล่เฉพาะตอนกดตราที่ **ประทับแล้ว** ซ้ำ (ยกเลิก) — ดีไซน์ **"Centered Icon Alert"** (แบบที่ 6 จาก `public/confirm-dialog-designs.html`) 2569-08-17 · เดิมใช้ `window.confirm()` ของเบราว์เซอร์ ขึ้นหัว "localhost:5200 บอกว่า" ไม่มีดีไซน์เลย

- `toggleOrderStep(step)` **ไม่ใช่ async แล้ว** — แค่เช็ค `stepDone(current)`: ยังไม่ done → เรียก `applyStepChange(step, false)` (อนุมัติ) ทันทีไม่ถาม · done แล้ว (จะยกเลิก) → `setConfirmCancelStep(step)` เปิดกล่องแทนการ update ตรงๆ
- **`applyStepChange(step, isDone)`** แยกออกมาจาก `toggleOrderStep` เดิม — เก็บ logic เขียน Supabase + toast + `notifyBranchUpdate` ทั้งหมดไว้ที่เดียว เรียกได้ทั้งจากเส้นทางอนุมัติ (ตรงๆ) และเส้นทางยกเลิก (ผ่านกล่องยืนยัน)
- กดปุ่ม **"ยืนยัน"** ในกล่อง → `confirmCancelStepYes()` → ปิดกล่องก่อนแล้วค่อยเรียก `applyStepChange(step, true)` — ปิด state ก่อนเสมอกัน double-submit ถ้า Supabase ตอบช้า
- ข้อความในกล่องดึงจาก `ORDER_STEPS` จริง ไม่ hardcode: `"${step.label}" จะกลับไปเป็น "${step.pending}"` (เช่น `"ของถึงสาขา" จะกลับไปเป็น "ยังไม่ถึง"`)
- ⚠️ **ปุ่มยืนยันโทนเหลืองอำพัน (`#c9822e`) ไม่ใช่แดง** — ยกเลิกตราไม่ใช่การลบถาวร ยังกดประทับใหม่ได้ สีแดงเข้มเก็บไว้กับ `.dl-admin-danger`/ปุ่มลบข้อมูลจริงเท่านั้น
- ⚠️ **`z-index: 1150`** — สูงกว่า `.dl-modal-overlay` (1000) เพราะต้องลอยทับ popup Order ที่เปิดอยู่เสมอ แต่ต่ำกว่า `.ss-toast-layer` (1200) เพราะ toast ไม่เคยโผล่พร้อมกล่องนี้จริง (toast ยิงหลัง Supabase ตอบ ซึ่งกล่องนี้ปิดไปแล้วก่อนหน้านั้นเสมอ)
- คลิก backdrop หรือปุ่ม "ไม่ยกเลิก" → `confirmCancelStepNo()` ปิดกล่องเฉยๆ ไม่มีอะไรถูกเขียนลง DB (ตามแบบ `showClearHistory`/`deleteTarget` ที่มีอยู่แล้วในไฟล์เดียวกัน)
- ⚠️ **effect ที่รีเซ็ตฟอร์มตอนเปลี่ยน `selectedOrder?.id`** ([SaleSupportPage.tsx:2003](SaleSupportPage.tsx#L2003)) เคลียร์ `confirmCancelStep` ด้วย — กันกล่องค้างข้ามใบถ้าเผลอเปลี่ยน Order ที่เปิดอยู่ระหว่างกล่องเปิด (หรือปิด popup ไปเลย เพราะ `selectedOrder` กลายเป็น `null` ก็นับเป็นการเปลี่ยน id เหมือนกัน)
- `window.confirm()` ยังเหลืออยู่อีก **4 จุด** ในไฟล์เดียวกัน (ล้างประวัติอัพเดท, อัปโหลด Supplier, อัปโหลด Product Master, ลบข้อมูล) — ยังไม่ได้แทนที่ ถ้าจะทำต่อ pattern เดียวกันนี้ (state เก็บ "สิ่งที่รอยืนยัน" + ฟังก์ชัน yes/no) ใช้ซ้ำได้เลย
- ทดสอบผ่านจริงกับแอปที่รันอยู่ (ไม่ใช่แค่ build ผ่าน): เปิดใบ → กดตรา done → กล่องเปิดข้อความถูกต้อง → กด "ไม่ยกเลิก"/backdrop ไม่เขียน DB → เปิดใหม่กด "ยืนยัน" → DB อัปเดตจริง + toast ยิงถูกต้อง

### ป้าย "คลังส่งของแล้ว" ในตาราง Order / BackOrder (ฝั่งสาขา)

ป้ายเขียว `#1a9e8f` + ไอคอนรถ ต่อท้ายชื่อสินค้าในคอลัมน์ `sku_name` — ดีไซน์เลือกจาก `public/outbound-alert-designs.html` (แบบ 8 "Days Badge" แต่ตัดตัวเลขวันออกตามคำสั่งผู้ใช้ จึงไม่มีการไล่สีตามอายุ ใช้สีเดียว)

`showOutboundAlert(row)` — ต้องครบ 4 ข้อ:
1. `isBranchUser` (SRC / KKL / SSS เท่านั้น — คลังกับจัดซื้อไม่เห็น ไม่ใช่คนรับของ)
2. `isStampMenu` = `activeMenu === 'order' || 'backorder'` — ตัวแปรร่วมของทั้ง 2 ป้าย ใช้ได้เพราะ `ss_backorders` มี `outbound_date` + 3 คอลัมน์สถานะ ชื่อเดียวกับ `ss_orders`
3. `row.branch === userBranch` — **เฉพาะออเดอร์ของสาขาตัวเอง** เป็นกันชนซ้ำกับ query (ทั้ง Order และ BackOrder กรองสาขาที่ server ให้อยู่แล้ว) เก็บไว้เผื่อวันหลังเลิกกรอง
4. `outbound_date` มีค่า **และ** `arrived_branch` ยังไม่ done (`!stepDone(...)`)

- ⚠️ **ข้อ 4 ต้องมีทั้งสองส่วน** — ถ้าเช็คแค่ `outbound_date` ป้ายจะติดค้างตลอดไปไม่มีวันดับ · กดตรา "ของถึงสาขา" = ป้ายหายทันที (ตราอัปเดต `rows` อยู่แล้ว ไม่ต้อง refetch)

### ป้ายฝั่งคลังสินค้า — ขั้นล่าสุดที่สาขากดตรา

ตำแหน่ง/หน้าตาเดียวกับป้ายของสาขา (`.ss-out-badge` ตัวเดียวกัน) แต่ไอคอนเป็นเครื่องหมายถูก และข้อความคือ **ขั้นล่าสุดที่สาขากดตราไปแล้ว**

- `latestStampedStep(row)` ไล่ `ORDER_STEPS` **จากท้ายมาหน้า** เพราะ 3 ขั้นเรียงตามลำดับงาน (ถึงสาขา → แจ้งลูกค้า → ส่งมอบ) ขั้นท้ายสุดที่ผ่านแล้วคือความคืบหน้าล่าสุด
- ข้อความใช้ค่า `done` ของขั้นนั้น (`ถึงแล้ว` / `แจ้งแล้ว` / `ส่งมอบแล้ว`) = ค่าจริงในคอลัมน์ ตรงกับชิปที่แสดงในตาราง
- ยังไม่กดตราอะไรเลย → **ไม่มีป้าย** (`latestStampedStep` คืน `null`)
- เห็นเฉพาะ `isWarehouse` — สาขาเห็นป้าย "คลังส่งของแล้ว" แทน ทั้งสองใช้ `.ss-out-badge` ตัวเดียวกันแต่ไม่มีทางโผล่พร้อมกัน เพราะเงื่อนไขแยกตามโปรไฟล์
- ใช้กับเมนู BackOrder ด้วย (เงื่อนไข `isStampMenu` เดียวกับป้ายฝั่งสาขา)
- เหตุผลที่ต้องมีทั้งที่มีคอลัมน์ชิป 3 ตัวอยู่แล้ว: ชิปอยู่ขวาสุดของตาราง ต้องเลื่อนแนวนอนไปดู ส่วนป้ายนี้ติดกับชื่อสินค้าเห็นได้ทันที
- คอลัมน์ `.ss-col-sku_name` เป็น `white-space: nowrap` + `table-layout: auto` → คอลัมน์จะกว้างขึ้นเองเมื่อมีป้าย (ผู้ใช้ลากปรับความกว้างได้อยู่แล้ว)
- ฟอร์มเพิ่มข้อมูลต่อเมนู + แนบรูป (upload เข้า bucket `salesupport`)
- ฟอนต์หน้านี้: Noto Sans Thai

### เมนูย่อย 3 ขั้นใต้ปุ่ม Order (Accordion Sub-nav)

แทนที่ badge ตัวเลขรวมตัวเดียวแบบเดิม (`.ss-menu-badge` — ลบทิ้งแล้ว) ด้วยเมนูย่อย 3 อันที่กางใต้ปุ่ม Order — ดีไซน์เลือกจาก `public/order-step-badge-designs.html` (แบบที่ 12)

- 3 ขั้นมาจาก `ORDER_STEPS` ชุดเดียวกับตราประทับใน popup: `arrived_branch` / `customer_notified` / `delivered`
- ⚠️ **`ORDER_STEPS` มีชื่อ 2 ชุด อย่าสลับกัน** — `label` (`ของถึงสาขา`) ใช้บนตราประทับใน popup + confirm ตอนยกเลิกตรา · `navLabel` (`ยังไม่ถึงสาขา` / `ยังไม่ได้แจ้งลูกค้า` / `ยังไม่ได้ส่งมอบ`) ใช้ในเมนูย่อย sidebar + ป้ายตัวกรอง เพราะเลขข้าง ๆ คือ**จำนวนที่ยังค้าง** · tooltip ตอนขั้นนั้นครบแล้วกลับไปใช้ `label` (พูดว่า "ยังไม่..." ทั้งที่ครบแล้วจะสับสน) · หัวคอลัมน์ในตารางเป็นคนละชุด อยู่ใน `MENUS[].columns` ไม่ได้อ่านจาก `ORDER_STEPS`
- เลข = จำนวนที่**ยังไม่ผ่านขั้นนั้น** ตัดสินด้วย `stepDone()` (มีคำว่า "แล้ว" และไม่มี "ยังไม่") — **นับฝั่ง client ไม่กรองใน SQL** เพราะเกณฑ์เป็น string-contains ถ้าเขียนซ้ำใน SQL จะมี 2 แหล่งความจริงที่หลุดจากกันได้ · ค่า `null`/ว่าง นับว่ายังไม่ผ่าน
- **แถวเดียวนับเข้าได้หลายขั้นพร้อมกัน** — ผลรวม 3 ขั้นจึงมากกว่าจำนวน Order ที่ค้างจริงได้ (ตั้งใจ: แต่ละเลขตอบคำถาม "ขั้นนี้ต้องทำอีกกี่รายการ")
- กดเมนูย่อย → `setActiveMenu('order')` + กรองตารางเหลือเฉพาะที่ยังไม่ผ่านขั้นนั้น (กดซ้ำ = เลิกกรอง) · ตัวกรองค้างข้ามเมนู
- **ไม่มีป้ายบอกสถานะตัวกรองใน toolbar** — เคยมี `.ss-step-filter-tag` (บอกว่ากรองขั้นไหน + ปุ่ม ✕ เลิกกรอง) แล้วผู้ใช้ให้เอาออกเพราะรก (2569-08-13) อย่าใส่กลับ · ตัวบอกสถานะที่เหลือคือ `.is-active` บนเมนูย่อย และทางเลิกกรองคือกดเมนูย่อยอันเดิมซ้ำ
- กรองด้วย `visibleRows` (useMemo) **ไม่ใช่ query ใหม่** — ตารางกับเลขบน badge ใช้ `stepDone` ตัวเดียวกัน
- ⚠️ **นับจากทุกแถว (วน `.range()` ทีละ 1000) แต่ตารางดึงมาแค่ 500 แถวล่าสุด** — ถ้า `ss_orders` โตเกิน 500 เลขบน badge จะมากกว่าจำนวนแถวที่กรองได้
- `totalStepPending === 0` → ซ่อนทั้งหัวลูกศรและเมนูย่อย (พฤติกรรมเดิมของ badge) · มี `useEffect` เคลียร์ `stepFilter` ตามด้วย ไม่งั้นตัวกรองจะยังทำงานทั้งที่ปุ่มหายไปแล้ว → ตารางว่างโดยไม่มีอะไรบอก
- ขั้นที่ครบแล้ว (0) → `.is-zero` จางลง + `disabled` **ไม่ซ่อน** เพื่อไม่ให้เมนูขยับขึ้นลงเวลากดตรา
- สัญญาณ "เลยวันนัดรับ" (เดิมคือ `.ss-menu-badge--late` แดงกะพริบ) ย้ายมาอยู่ที่ `.ss-order-step-count.is-late` — กะพริบเฉพาะขั้นที่มีรายการเลยนัด ใช้ `@keyframes ssBadgePulse` ตัวเดิม
- หัวลูกศรพับ/กางเป็น `<span>` ใน `<button>` ต้องมี `stopPropagation` ไม่งั้นกดพับแล้วเด้งเปลี่ยนเมนูไปด้วย · พับอยู่ → มีจุดส้ม `.ss-menu-caret-dot` เตือนว่ายังมีของค้างซ่อนอยู่
- นับใหม่เมื่อ `refreshKey` หรือ `stampTick` เปลี่ยน (กดตราแล้วเลขอัปเดตทันทีโดยไม่ refetch ทั้งตาราง)

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
