# โครงสร้างการ Upload CSV ขึ้น Supabase

เอกสารนี้สรุปว่าโปรเจกต์นี้มี **ตารางอะไรบ้าง** ใน Supabase, ใช้ **ไฟล์ CSV อะไร**, และ **อัพโหลดอย่างไร**

Supabase Project URL: `https://eogqnedbdpjuptwlqudn.supabase.co`

---

## ภาพรวม — มี 4 ตารางหลัก

| ตาราง | ข้อมูล | วิธี Upload | ไฟล์ CSV |
|---|---|---|---|
| `products` | สินค้า/ราคา (ป้ายราคา) | ผ่านเว็บ (Admin) | Products CSV |
| `stock` | สต๊อกแยกสาขา | Node script + Task Scheduler | `All_stock.csv` |
| `customer_history` | ประวัติการซื้อของลูกค้า | Node script (มือ/Task Scheduler) | `customer_history.csv` |
| `label.*` | ฉลากยา (หลายตาราง) | กรอกผ่านเว็บ (ไม่ใช้ CSV) | — |

---

## การเชื่อมต่อสำหรับโปรแกรมอื่น

ถ้าจะให้โปรแกรมอื่นเชื่อมต่อเข้ามาอ่าน/เขียนข้อมูล ต้องใช้ข้อมูลต่อไปนี้

### Credentials — มี 2 แบบ

| Key | บทบาท | ใช้ที่ไหน | ความลับ? |
|---|---|---|---|
| **anon key** | public — อ่านได้, เขียนได้เฉพาะตารางที่เปิด write policy | เว็บแอป (browser), อ่านในสคริปต์ | ไม่ลับ (ฝังใน JS อยู่แล้ว) |
| **service_role key** | bypass RLS ทั้งหมด — เขียน/ลบได้ทุกตาราง | สคริปต์ Node อัพโหลดเท่านั้น | **ลับสุด — ห้าม commit / ห้ามใส่ browser** |

URL: `https://eogqnedbdpjuptwlqudn.supabase.co`

เว็บแอป (Vite) อ่านจาก env:
```
VITE_SUPABASE_URL=https://eogqnedbdpjuptwlqudn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

สคริปต์อัพโหลด (`upload-stock.mjs`, `upload-customer-history.mjs`) ใช้ **service_role key** อ่านจาก env `SUPABASE_SERVICE_KEY` หรือไฟล์ `.env` (gitignore แล้ว):
```
SUPABASE_SERVICE_KEY=<service_role key>
```
> เอา key มาจาก: Supabase Dashboard → Settings → API → `service_role`
> `.env` ถูก gitignore — ต้องใส่ key เองในทุกเครื่อง (Arm + BigYa-spare)

### RLS Policies — สิทธิ์ของ anon key แต่ละตาราง

| ตาราง | anon อ่าน | anon เขียน | การเขียนจริงทำผ่าน |
|---|---|---|---|
| `products` | ✅ | ⚠️ **ได้** (public write) | เว็บ admin (anon key) |
| `stock` | ✅ | ❌ ตัดแล้ว | สคริปต์ (service_role) |
| `customer_history` | ✅ | ❌ ตัดแล้ว | สคริปต์ (service_role) |

ดู SQL ได้ใน `stock-setup.sql`, `customer-history-setup.sql`, `supabase-setup.sql`
ตัด write policy ด้วย `lock-rls-readonly.sql`

> ⚠️ **ความเสี่ยงที่ยังเหลือ:** `products` ยังเปิด public write เพราะหน้าเว็บ admin อัพโหลดด้วย anon key (ตามที่เลือกไว้ว่าจะคงอัพโหลดผ่านเว็บ) — ใครมี anon key ยังเขียน/ลบ products ได้ ถ้าจะปิดช่องนี้ต้องย้าย products upload ไปเป็นสคริปต์ service_role หรือ Edge Function

### ขั้นตอนตั้งค่าความปลอดภัย (ทำครั้งเดียว, ลำดับสำคัญ)

1. เอา **service_role key** จาก Supabase Dashboard → Settings → API
2. ใส่ `SUPABASE_SERVICE_KEY=...` ใน `.env` ของ **ทุกเครื่อง** (Arm + BigYa-spare)
3. ทดสอบรัน `node upload-stock.mjs` ให้ผ่านก่อน (service_role ใช้ได้แม้ยังไม่ตัด policy)
4. รัน `lock-rls-readonly.sql` ใน Supabase SQL Editor เพื่อตัด write policy
5. ตรวจว่า upload + หน้าเว็บยังทำงานปกติ

### Schema — public vs label

- `products`, `stock`, `customer_history` → อยู่ใน schema **`public`** เรียกชื่อตารางตรงๆ ได้เลย
- ฉลากยา → อยู่ใน schema **`label`**
  - **อ่าน:** ผ่าน public views `dl_medicines`, `dl_medicine_translations`, `dl_settings`
  - **เขียน:** ต้องตั้ง `db: { schema: 'label' }` ตอน `createClient` และต้องได้ `GRANT INSERT/UPDATE/DELETE` บนตาราง `label.*` ให้ role `anon`

### ตัวอย่างโค้ดเชื่อมต่อ (Node.js)

```js
import { createClient } from '@supabase/supabase-js';

const url = 'https://eogqnedbdpjuptwlqudn.supabase.co';

// อ่าน — ใช้ anon key ได้
const reader = createClient(url, '<anon key>');
const { data } = await reader.from('stock').select('*').eq('branch', 'SRC');

// เขียน stock / customer_history — ต้องใช้ service_role key (anon เขียนไม่ได้แล้ว)
const writer = createClient(url, process.env.SUPABASE_SERVICE_KEY);
await writer.from('stock').insert({ branch: 'SRC', sku: '123', name: '...', qty: '5' });

// ฉลากยา — เขียนเข้า schema label
const labelWriter = createClient(url, process.env.SUPABASE_SERVICE_KEY, { db: { schema: 'label' } });
await labelWriter.from('medicines').insert({ sku: '123', barcode: '...' });
```

---

## 1. ตาราง `products` — สินค้า/ป้ายราคา

**คอลัมน์:** `barcode, sku, name, unit, price, category, updated_at`

**วิธี upload:** ผ่านหน้าเว็บ (Admin panel) — ไม่ใช้ script
1. กรอกรหัสผ่าน Admin (`VITE_ADMIN_PASSWORD`)
2. เลือกไฟล์ CSV → PapaParse อ่าน
3. **ลบข้อมูลเก่าทั้งหมด** แล้ว insert ใหม่ทีละ 500 แถว

**รูปแบบ Products CSV** (zero-indexed):

| คอลัมน์ | index | ความหมาย |
|---|---|---|
| A | 0 | Barcode |
| B | 1 | Price (ราคา) |
| C | 2 | Category (หมวดหมู่) |
| E | 4 | SKU |
| F | 5 | Name (ชื่อสินค้า) |
| G | 6 | Unit (หน่วย) |

> แถว 0 = header

---

## 2. ตาราง `stock` — สต๊อกแยกสาขา

**คอลัมน์:** `id, branch, sku, name, qty, unit, price, uploaded_at`

**วิธี upload:** Node.js script `upload-stock.mjs` + Task Scheduler (ทุก 5 นาที)
```bash
node upload-stock.mjs
```
หรือผ่าน batch wrapper `run-upload-stock.bat` (มี progress บนหน้าจอ)

**กระบวนการในสคริปต์:**
1. หาไฟล์ CSV จาก `CSV_CANDIDATES` (ใช้ path แรกที่เจอ)
2. parse CSV ด้วย `parseCSV()` เอง (รองรับ `"` กลางชื่อ เช่น `2"`)
3. แปลงชื่อสาขาด้วย `BRANCH_MAP`
4. **ลบข้อมูลเก่าทั้งหมด** (`delete().neq('id', 0)`) แล้ว insert ใหม่ทีละ 500 แถว

**ไฟล์ CSV:** `All_stock.csv` — เช็คตามลำดับ:
1. `C:\Users\Arm\Documents\update_stock\All_stock.csv`
2. `C:\Users\BigYa-spare\Documents\update_stock\All_stock.csv`
3. `C:\Users\BigYa-spare\Documents\update_stock\All_stock.CSV`

**รูปแบบ Stock CSV** (zero-indexed):

| คอลัมน์ | index | ความหมาย |
|---|---|---|
| D | 3 | Branch (สาขา) |
| E | 4 | SKU |
| F | 5 | Name (ชื่อสินค้า) |
| G | 6 | จำนวน (qty) |
| H | 7 | หน่วย (unit) |
| I | 8 | ราคาต่อหน่วย (price) |

**Branch mapping** (ไม่สนตัวพิมพ์เล็ก/ใหญ่):

| ค่าใน CSV | เก็บเป็น |
|---|---|
| `Warehouse` | คลังสินค้า |
| `Front Store` | SRC |
| `Main KKL` | KKL |
| `Main SSS` | SSS |

> แถวที่สาขาไม่ตรง map → ข้าม

---

## 3. ตาราง `customer_history` — ประวัติลูกค้า

**คอลัมน์:** `id, phone, first_name, last_name, sku, product_name, uploaded_at`

**วิธี upload:** Node.js script `upload-customer-history.mjs`
```bash
node upload-customer-history.mjs            # ลบเก่าทั้งหมด แล้ว insert ใหม่ (default)
node upload-customer-history.mjs --append   # เพิ่มข้อมูลใหม่ ไม่ลบของเก่า
```
หรือผ่าน batch wrapper `run-upload-customer-history.bat`

**กระบวนการในสคริปต์:**
1. หาไฟล์ CSV จาก `CSV_CANDIDATES` (ใช้ path แรกที่เจอ)
2. parse CSV เอง
3. เติม `0` นำหน้าเบอร์โทรอัตโนมัติถ้ายาว 8 หรือ 9 หลัก (Excel ตัด 0 หน้าออก)
4. โหมด default: **ลบเก่าแบบ chunked ทีละ 1000 แถว** (เลี่ยง Supabase statement timeout เมื่อตารางมี 100K+ แถว) แล้ว insert ทีละ 500 แถว
5. โหมด `--append`: ข้ามการลบ insert ต่อท้ายเลย

**ไฟล์ CSV:** `customer_history.csv` — เช็คตามลำดับ:
1. `C:\Users\Arm\Documents\update_stock\customer_history.csv`
2. `C:\Users\BigYa-spare\Documents\update_stock\customer_history.csv`
3. `C:\Users\BigYa-spare\Documents\update_stock\customer_history.CSV`

**รูปแบบ Customer History CSV** (zero-indexed):

| คอลัมน์ | index | ความหมาย |
|---|---|---|
| B | 1 | Phone (เบอร์โทร) |
| C | 2 | ชื่อ (first_name) |
| D | 3 | นามสกุล (last_name) |
| I | 8 | SKU |
| J | 9 | ชื่อสินค้า (product_name) |

> แถวที่ไม่มีทั้งชื่อและนามสกุล → ข้าม

**Deduplicate:** ก่อน import ข้อมูลย้อนหลังใช้ `deduplicate-customer.mjs` กรองแถวซ้ำระหว่าง 2 ไฟล์ CSV (ดู `วิธีใช้-deduplicate-customer.md`)

---

## 4. ตาราง `label.*` — ฉลากยา (ไม่ใช้ CSV)

ฉลากยาเก็บใน schema `label` กรอกข้อมูลผ่านหน้าเว็บ (Add/Edit modal) — **ไม่มีการ upload CSV**

| ตาราง | คอลัมน์ |
|---|---|
| `label.medicines` | id, sku, barcode, usage_ref |
| `label.medicine_translations` | medicine_id, lang, trade_name, generic_name, usage, indication, warning, storage |
| `label.settings` | id, shop_name_th, shop_name_en, phone, line_id, logo_text |

อ่านผ่าน public views: `dl_medicines`, `dl_medicine_translations`, `dl_settings`

---

## หมายเหตุ — Parser CSV (custom)

ทั้ง `upload-stock.mjs` และ `upload-customer-history.mjs` ใช้ `parseCSV()` ที่เขียนเอง:
- `"` จะเริ่ม quoted mode **เฉพาะตอนที่ field ยังว่าง** (`field === ''`) เพื่อรองรับสัญลักษณ์นิ้ว เช่น `2"` ที่อยู่กลางชื่อสินค้าโดยไม่พังการ parse
- `""` ภายใน quoted = อักขระ `"` ตัวเดียว

## หมายเหตุ — Multi-Machine

โปรเจกต์รันบน 2 เครื่อง (Arm และ BigYa-spare) ทั้งสองสคริปต์รองรับด้วย `CSV_CANDIDATES` array อยู่แล้ว — **ไม่ต้องแก้ path** เวลา pull โค้ดข้ามเครื่อง
