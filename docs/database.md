# Database & CSV/Excel Import — รายละเอียดเต็ม

> เอกสารนี้แยกออกมาจาก `CLAUDE.md` (root) เพื่อลด context ที่โหลดทุกเซสชัน — อ่านไฟล์นี้เมื่อแตะโค้ดที่เกี่ยวกับตาราง `products` / `product_category` / `stock` / `customer_history`, ฟีเจอร์ "เลือกตามหมวด", หรือการอัปโหลด CSV/XLSX ใดๆ ก็ตาม ส่วนกฎย่อ + คำเตือนสำคัญที่สุดยังอยู่ใน root `CLAUDE.md` หัวข้อ "Database (Supabase)" เหมือนเดิม

## Products (`products` table)

**Table: `products`** (barcode, sku, name, unit, price, category, updated_at)
- RLS: `public read` (SELECT) + `public write` (ALL)
- Search: queries Supabase directly — NOT client-side filter
- On mount: fetches only latest `updated_at` for timestamp display
- Admin upload: CSV (R05.106) → PapaParse → **เช็คหัวคอลัมน์** → confirm → delete all → insert in 500-row chunks
- ⚠️ ยังเป็น **delete-all + insert** (ไม่ atomic) — ถ้า insert พังกลางทางตารางจะว่าง ต้องอัปโหลดซ้ำ · ต่างจาก `product_category` ที่ใช้ upsert + sweep

### Products CSV — รูปแบบไฟล์ R05.106

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

### Products — อัปโหลดอัตโนมัติต่อท้ายบอท export (เพิ่ม 2569-09-04)

`R05.106.CSV` มาจาก **บอท `BOTR05106`** (โปรเจกต์ Python + pywinauto คนละ repo, PyInstaller → `dist\promaxx-bot\promaxx-bot.exe`) ที่ automate ProMaxx แล้วเขียน `R05.106.part.CSV` → rename เป็น `R05.106.CSV` ลง `Desktop\run-upload-stock\` (atomic part-then-rename) · `upload-products.mjs` ถูกเรียก **ต่อท้ายบอทในงาน Task Scheduler เดียวกัน** ผ่าน `BOTR05106\tools\run_and_upload.ps1` · ปุ่มอัปโหลดหน้าเว็บยังอยู่เหมือนเดิมเป็นทางสำรอง

- ⚠️ **ห้ามตั้ง Task 08:30 แยกแบบที่วางแผนไว้ตอนแรก** — เวลาที่ไฟล์ออกไม่แน่นอน (วัดจริงได้ 15:14 และ 18:04) ตั้งเวลาตายตัวแล้ว guard "ไฟล์ต้องเป็นของวันนี้" จะข้ามทุกวัน
- ⚠️ task ที่ chain กับบอทต้องเป็น **`LogonType Interactive`** (บอทเป็น GUI automation, Session 0 ไม่มีเดสก์ท็อป) ต่างจาก uploader ตัวอื่นที่ตั้งเป็น "run whether user is logged on or not" ได้
- 🚫 **ห้ามก๊อป `upload-*.mjs` ไปวางในโปรเจกต์อื่น — เรียกด้วย path เต็มแทน** (`getServiceKey()` อ่าน `.env` ข้างตัวสคริปต์ และ Node หา `node_modules` จากโฟลเดอร์ของไฟล์สคริปต์ ไม่ใช่ cwd) · เหตุผลจากของจริง: `upload-customer-history.mjs` มี **3 สำเนาที่โค้ดไม่ตรงกัน** (SaleSupport + run-upload-stock ตัวใหม่ · Bot-Customer + Bot-R16 ตัวเก่า) และตัวที่ scheduled เรียกจริงคือ**ตัวเก่า**

**เขียนคนละกลไกกับหน้าเว็บโดยตั้งใจ** — หน้าเว็บ `delete-all → insert` พังกลางทางแล้วตารางว่าง ซึ่งยอมรับได้ตอนมีคนนั่งดู แต่ 08:30 ไม่มีใครเฝ้า สคริปต์จึง:
1. เขียนทุกแถวลง `products_import` (ตารางพัก) ทีละ 500
2. เรียก RPC `swap_products_from_import()` → `delete products` + `insert ... select` + ล้างตารางพัก **ใน transaction เดียว**
3. พังตรงไหนก็ rollback หมด → `products` ไม่มีทางว่างหรือมีแค่ครึ่งเดียว · ต้องรัน `products-import-swap.sql` ก่อนใช้ครั้งแรก
- RPC ใช้ `delete` ไม่ใช่ `truncate` — truncate จับ ACCESS EXCLUSIVE lock จะบล็อกคนที่กำลังค้นหาสินค้าอยู่
- RPC เขียน `updated_at = now()` ให้ทุกแถว → badge "Last Updated" หน้า Admin แสดงเวลาที่อัปโหลดเช้านั้น
- `grant execute` ให้ `service_role` เท่านั้น (anon เรียกทีเดียวลบทั้งตารางได้)

**guard 4 ชั้น เรียงตามลำดับที่เช็ค — ทุกชั้นหยุดก่อนแตะ DB:**
| ชั้น | เงื่อนไข | ผล |
|---|---|---|
| ไฟล์ไม่อัปเดต | mtime เก่ากว่าเที่ยงคืนวันนี้ | **exit 2** (ข้าม ไม่ใช่ error) — กันเคส export เช้านั้นไม่ออกแล้วอัปโหลดของเมื่อวานซ้ำ |
| ไฟล์ยังเขียนไม่เสร็จ | mtime ใหม่กว่า 60 วิ | รอ 20 วิ × 3 รอบให้ขนาดนิ่ง ไม่นิ่ง → exit 1 |
| หัวคอลัมน์ | ขาดคอลัมน์ใดใน 7 ตัว | exit 1 (ตรรกะเดียวกับ `resolveProductCsvColumns` หน้าเว็บ) |
| ไฟล์หด | น้อยกว่าของเดิมเกิน 20% | exit 1 — หน้าเว็บแค่เตือนแล้วให้คนกดยืนยัน สคริปต์ไม่มีคนกดจึงต้องหยุด (ข้ามด้วย `--force`) |

- exit code: `0` สำเร็จ · `1` ผิดพลาด · `2` ข้ามเพราะไฟล์ไม่อัปเดต — `run-upload-products.bat` ส่งค่ากลับด้วย `exit /b` ให้เห็นใน Task Scheduler (ต่างจาก .bat ตัวอื่นที่ไม่ส่ง เลยขึ้นสำเร็จตลอด)
- flag: `--dry-run` (ตรวจอย่างเดียว) · `--force` (ข้าม guard วันที่ + ไฟล์หด) · `--file <path>` (ชี้ไฟล์เอง ไม่ใช้ `CSV_CANDIDATES`)
- **เรียกข้ามโปรเจกต์ได้ด้วย path เต็ม** — `getServiceKey()` อ่าน `.env` และ Node หา `node_modules` จากโฟลเดอร์ของ**ไฟล์สคริปต์** ไม่ใช่ cwd ที่เรียก → โปรเจกต์บอทที่ export R05.106 เองสั่ง `node "C:\...\SaleSupport\upload-products.mjs" --file "<ไฟล์ที่เพิ่ง export>"` ต่อท้ายได้เลย ไม่ต้องก๊อปไฟล์ ไม่ต้องมี service key ของตัวเอง และไม่ต้องใช้ Task Scheduler
  - แบบนี้ guard "ไฟล์ต้องเป็นของวันนี้" ผ่านเองอัตโนมัติ (mtime = ตอนที่เพิ่ง export) · guard "ไฟล์ยังเขียนไม่เสร็จ" จะรอ 20 วิให้ขนาดนิ่งก่อนอ่าน ซึ่งเป็นสิ่งที่ต้องการพอดีเมื่อเรียกต่อท้าย export ทันที
- log ทุกบรรทัดถูก mirror ลง `upload-products.log` ข้างสคริปต์ (`.gitignore` มี `*.log`) — ไม่ redirect ใน .bat เพราะจะทำให้รันมือแล้วไม่เห็น progress
- ⚠️ **`parseCSV` ที่คัดลอกจาก `upload-stock.mjs` ไม่ตัด UTF-8 BOM** (ต่างจาก PapaParse ที่หน้าเว็บใช้) — ต้องอ่านผ่าน `readCsvText()` ซึ่ง strip BOM ตัวแรกทิ้งให้ ไม่งั้นหัวคอลัมน์แรกจะมี BOM ติดหน้า (`indexOf('CF_BARCODE')` หาไม่เจอ) แล้ว header check fail ทุกวัน · มีเทสกันไว้แล้วใน `upload-products.test.mjs`
- ⚠️ **ตั้ง Task Scheduler เครื่องเดียวเท่านั้น** — 2 เครื่องรันพร้อมกันจะแย่งกัน swap ตารางเดียวกัน (ข้อควรระวังเดียวกับ `upload-stock.mjs`)
- ทดสอบกับไฟล์จริง 2569-09-04: 10,858 แถว ผ่าน header check ครบ ข้าม 0 แถว หน่วยเล็กสุด 7,984 รายการ

### Products — เลข 6 หลักเป็นได้ทั้ง SKU และ barcode (แก้ 2569-08-16)

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

## product_category (`product_category` table) + Category Select feature

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

### Location XLSX — รูปแบบไฟล์ (2 layout)

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

### Category Select — เลือกตามหมวด (หน้าป้ายราคา) — deep-dive

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
- **กรองเหลือหน่วยเล็กสุด** — view มี `WHERE COALESCE(p.base_multiple, 1) = 1` → 1 ป้ายต่อ SKU ไม่มีหน่วยใหญ่ (กล่อง/โหล) ปนมา · ดูรายละเอียด `CF_BASEMULTIPLE` ในหัวข้อ "Products CSV — รูปแบบไฟล์ R05.106" ด้านบน
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

## stock (`stock` table)

**Table: `stock`** (id, branch, sku, name, qty, unit, price, uploaded_at)
- RLS: `public read stock` (SELECT) เท่านั้น — **ไม่มี public write** (anon เขียนไม่ได้)
- สร้างด้วย `stock-setup.sql` · ตัด write policy ด้วย `lock-rls-readonly.sql`
- Upload: ผ่าน `upload-stock.mjs` (Node.js script) — ไม่ผ่านเว็บ — ใช้ **service_role key** (env `SUPABASE_SERVICE_KEY` หรือ `.env`)
- ไม่มี web upload UI — ใช้ Task Scheduler รัน script ทุก 5 นาทีแทน

### Stock CSV — รูปแบบไฟล์

**Stock CSV** (export จาก POS → `upload-stock.mjs`):
Columns (zero-indexed): D=Branch(3), E=SKU(4), F=Name(5), G=จำนวน(6), H=หน่วย(7), I=ราคาต่อหน่วย(8). Row 0 = header.
Branch mapping (case-insensitive): `Warehouse`→คลังสินค้า, `Front Store`→SRC, `Main KKL`→KKL, `Main SSS`→SSS
ชื่อไฟล์: `All_stock.csv` — `CSV_CANDIDATES` ใน `upload-stock.mjs` เช็คหลาย path ใช้ path แรกที่เจอ (เครื่อง Server `C:\Users\AninMainPC\Desktop\run-upload-stock\` ก่อน → Arm → BigYa-spare)

## customer_history (`customer_history` table)

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

### Customer History CSV — รูปแบบไฟล์ R06.158

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

### Customer History — Recent Changes (2026-07-27 ถึง 2026-07-28)

- เปลี่ยน uploader จาก delete-all/insert-all เป็น incremental และ idempotent
- ยุบข้อมูลให้เหลือรายการซื้อล่าสุดต่อ ลูกค้า+SKU; ใช้เบอร์โทรเป็น customer identity และ fallback เป็นชื่อ+นามสกุล
- เพิ่ม strict date validation, phone normalization, fallback product key และสรุปจำนวนแถวทุกสถานะ
- เพิ่มช่วงตรวจย้อนหลัง 7 วัน, `--full-scan`, batch read/write และ unique `dedupe_key`
- เพิ่ม SQL migration แบบไม่ drop table พร้อม SQL สำหรับ sync status
- เพิ่ม unit tests และ npm script `test:customer-upload`
- เปลี่ยน badge จาก sync status มาอ่าน `customer_history.uploaded_at` โดยตรง เพื่อรองรับข้อมูลที่มาจาก uploader หลายโปรแกรม
- ตัดข้อความจำนวน "เพิ่ม/อัปเดต" ออกจาก badge เหลือเฉพาะเวลาล่าสุด
