# วิธีตั้งค่า Task Scheduler — ANIN Stock Auto Upload

อัพโหลดสต๊อคจาก CSV ไปยัง Supabase อัตโนมัติทุก 5 นาที  
โดยไม่ต้องเปิดเว็บเบราว์เซอร์

---

## ไฟล์ที่ต้องมี

```
📁 โฟลเดอร์ที่วางไฟล์ (เช่น C:\stock-uploader\)
  ├── upload-stock.mjs       ← script หลัก
  └── run-upload-stock.bat   ← ไฟล์สำหรับ Task Scheduler
```

---

## ขั้นตอนที่ 1 — ติดตั้ง Node.js

1. เปิดเบราว์เซอร์ไปที่ https://nodejs.org
2. คลิก **Download LTS**
3. ติดตั้งตามปกติ Next → Next → Finish
4. ตรวจสอบโดยเปิด Command Prompt แล้วพิมพ์:
   ```
   node -v
   ```
   ถ้าขึ้นเลขเวอร์ชัน เช่น `v20.11.0` แปลว่าติดตั้งสำเร็จ

---

## ขั้นตอนที่ 2 — ติดตั้ง Package

1. เปิด Command Prompt (กด `Win + R` พิมพ์ `cmd` กด Enter)
2. รันคำสั่ง (เปลี่ยน path ให้ตรงกับโฟลเดอร์ที่วางไฟล์):
   ```
   cd C:\stock-uploader
   npm install @supabase/supabase-js
   ```
3. รอจนเสร็จ จะมีโฟลเดอร์ `node_modules` เกิดขึ้น

---

## ขั้นตอนที่ 3 — แก้ค่า Network Path ในไฟล์ upload-stock.mjs

เปิดไฟล์ `upload-stock.mjs` แก้บรรทัดนี้:

```js
const CSV_PATH = '\\\\PCNAME\\Users\\Username\\Documents\\update_stock\\All_stock.csv';
```

เปลี่ยน `PCNAME` และ `Username` ให้ตรงกับเครื่อง POS  
- ดู **PCNAME** ได้จาก: คลิกขวา This PC → Properties → Device name  
- ดู **Username** ได้จาก: เปิด File Explorer → C:\Users\ จะเห็นชื่อโฟลเดอร์

**ตัวอย่าง:**
```js
const CSV_PATH = '\\\\POS-CASHIER\\Users\\BigYa\\Documents\\update_stock\\All_stock.csv';
```

---

## ขั้นตอนที่ 4 — ทดสอบ Script ก่อน

เปิด Command Prompt แล้วรัน:

```
cd C:\stock-uploader
node upload-stock.mjs
```

ถ้าสำเร็จจะขึ้น:
```
✅ อัพโหลดสำเร็จ XXXX รายการ
```

---

## ขั้นตอนที่ 5 — ตั้งค่า Task Scheduler

1. กด `Win` ค้นหา **Task Scheduler** แล้วเปิด

2. คลิก **Create Basic Task...** (ด้านขวา)

3. **Name:** `ANIN Stock Upload`  
   **Description:** อัพโหลดสต๊อคจาก POS ทุก 5 นาที  
   คลิก **Next**

4. **Trigger:** เลือก **Daily** → คลิก **Next**  
   ตั้งเวลาเริ่มต้น เช่น 07:00:00  
   คลิก **Next**

5. **Action:** เลือก **Start a program** → คลิก **Next**  
   - **Program/script:**
     ```
     C:\stock-uploader\run-upload-stock.bat
     ```
   - **Start in (optional):**
     ```
     C:\stock-uploader
     ```
   คลิก **Next** → **Finish**

6. หลัง Finish จะถามว่าต้องการเปิด Properties ไหม → คลิก **Open the Properties dialog**

7. ใน Properties → แท็บ **Triggers** → ดับเบิลคลิก Trigger ที่สร้างไว้

8. ติ๊ก ✅ **Repeat task every:** `5 minutes`  
   **for a duration of:** `Indefinitely`  
   คลิก **OK**

9. แท็บ **General** → เลือก **Run whether user is logged on or not**  
   คลิก **OK** → ใส่ Password Windows แล้วกด OK

---

## ตรวจสอบการทำงาน

- Log บันทึกไว้ที่: `C:\stock-uploader\upload-stock.log`  
- เปิดดูได้ตลอดเวลาเพื่อตรวจสอบว่าทำงานปกติ

**ตัวอย่าง log ปกติ:**
```
[16/5/2569 14:00:01] เริ่มต้นอัพโหลดสต๊อค...
   อ่านได้ 1250 แถว (ไม่นับ header)
   พบสินค้า 1100 รายการ กำลังอัพโหลด...
✅ อัพโหลดสำเร็จ 1100 รายการ
```

---

## Task ที่ 2 — อัปโหลดสินค้า R05.106 (ต่อท้ายบอท BOTR05106) ⭐ วิธีหลัก

ไฟล์ `R05.106.CSV` มาจากบอท **BOTR05106** (โปรเจกต์ Python คนละ repo) ที่ export จาก ProMaxx แล้วเขียนลง `Desktop\run-upload-stock\` **จึงตั้งให้อัปโหลดต่อท้ายบอทเลย ไม่ตั้งเวลาแยก** — เวลาที่ไฟล์ออกไม่แน่นอน (เคยเห็นทั้ง 15:14 และ 18:04) ถ้าตั้ง task แยกไว้ 08:30 จะเจอแต่ไฟล์ของเมื่อวานแล้วข้ามทุกวัน

**ต้องทำก่อน 1 ครั้ง:** เปิด Supabase → SQL Editor → รัน `products-import-swap.sql` (สร้างตารางพัก + RPC) ไม่งั้นสคริปต์จะขึ้น error บอกให้รันไฟล์นี้

**ต้องมีบนเครื่องที่บอทรัน:**
- repo **SaleSupport** (clone มาเลย อย่าก๊อปเฉพาะไฟล์ `.mjs`) + `npm install` + `.env` ที่มี `SUPABASE_SERVICE_KEY`
- repo/โฟลเดอร์ **BOTR05106** พร้อม `dist\promaxx-bot\`
- Node ที่ `C:\Program Files\nodejs\node.exe`

**ตั้ง Task (สั่งจากโฟลเดอร์ BOTR05106):**
```powershell
.\tools\register_task.ps1 -Time 08:30 -Flows "flows/r05_106_export.yaml" -WithUpload
```
`-WithUpload` ทำให้ task เรียก `tools\run_and_upload.ps1` ซึ่ง **รันบอท → export สำเร็จค่อยเรียก `node upload-products.mjs --file ...`** ถ้า export พังจะไม่อัปโหลดเลย ข้อมูลเดิมใน Supabase อยู่ครบ

**ซ้อมก่อนของจริง** (export จริงแต่ไม่เขียน DB):
```powershell
.\tools\run_and_upload.ps1 -DryRunUpload
```

> 🚨 **task นี้ต้องเป็น "Run only when user is logged on"** (`register_task.ps1` ตั้ง `LogonType Interactive` ให้แล้ว) — บอทเป็น GUI automation ถ้าไปรันใน Session 0 จะหาหน้าต่างโปรแกรมไม่เจอ 100% · **ห้ามเปลี่ยนเป็น "whether user is logged on or not"**
> ⚠️ **ตั้งเครื่องเดียวเท่านั้น** — 2 เครื่องรันพร้อมกันจะแย่งกันเขียนตาราง `products`
> ⚠️ path เริ่มต้นของ wrapper อ้าง `$env:USERPROFILE\Desktop\...` ถ้าวางโฟลเดอร์ไว้ที่อื่นให้ส่ง `-Uploader` / `-Csv` / `-Node` เอง

**Last Run Result ที่จะเห็น:**

| ค่า | ความหมาย |
|---|---|
| `0x0` | export + อัปโหลดสำเร็จ |
| `0x2` | export สำเร็จ แต่ **อัปโหลดข้าม ไม่ใช่ error** — ไฟล์ไม่ได้ถูกอัปเดต ข้อมูลเดิมยังอยู่ครบ |
| `0x1` | export พัง (ดู `BOTR05106\logs\bot.log`) หรืออัปโหลดพัง (ดู `upload-products.log` ข้าง `upload-products.mjs`) |

### 🚫 ห้ามก๊อป `upload-products.mjs` ไปไว้ในโปรเจกต์บอท

โค้ดอัปโหลดอยู่ที่ **SaleSupport ที่เดียว** ส่วนโปรเจกต์บอทมีแค่ `tools\run_and_upload.ps1` ที่เป็นตัวสั่งงาน (ไม่มี logic อัปโหลดเลยสักบรรทัด) เรียกข้าม repo ได้เพราะ `getServiceKey()` อ่าน `.env` ข้าง**ตัวสคริปต์** และ Node หา `node_modules` จากโฟลเดอร์ของไฟล์สคริปต์ ไม่ใช่ cwd ที่เรียก

เหตุผลไม่ใช่แค่ความสวยงาม — `upload-customer-history.mjs` เคยถูกก๊อปจนมี **3 สำเนาที่โค้ดไม่ตรงกัน** (SaleSupport กับ run-upload-stock เป็นตัวใหม่ ส่วน Bot-Customer กับ Bot-R16 เป็นตัวเก่ากว่า) แล้วตัวที่ Task Scheduler เรียกจริงกลายเป็น**ตัวเก่า** → แก้บั๊กที่ repo แล้วของที่รันจริงไม่เปลี่ยน

---

## ทางสำรอง — ตั้ง Task อัปโหลดแยก (ใช้เมื่อไม่มีบอท)

ใช้เมื่อมีคนวางไฟล์ `R05.106.CSV` ให้เองในเวลาที่แน่นอน

**ต้องมีในโฟลเดอร์เดียวกัน:** `upload-products.mjs` · `run-upload-products.bat` · `.env` · `node_modules\@supabase\supabase-js`

**ทดสอบก่อนตั้งเวลา:** `node upload-products.mjs --dry-run --force` → ต้องขึ้นสรุปจำนวนแถวและ `✅ ตรวจผ่านทั้งหมด`

**ตั้ง Task:** Create Basic Task → ชื่อ `ANIN Products Upload (R05.106)` → **Daily** เวลาที่ต้องการ → **Start a program** → Program = path เต็มของ `run-upload-products.bat` · Start in = โฟลเดอร์นั้น → Finish → Properties → **General** → Run whether user is logged on or not

> ⚠️ ตั้งเวลาให้**หลัง**ไฟล์ออกจริงเสมอ ถ้าไฟล์ยังเป็นของเมื่อวานสคริปต์จะข้าม (exit 2)
> ⚠️ **ห้ามตั้งทางนี้พร้อมกับวิธีหลัก** — 2 ทางรันพร้อมกันจะแย่งกันเขียนตาราง `products`

---

## แก้ปัญหาเบื้องต้น

| ข้อความ Error | สาเหตุ | วิธีแก้ |
|---|---|---|
| `Cannot find package '@supabase/supabase-js'` | ยังไม่ได้รัน npm install | รัน `npm install @supabase/supabase-js` ในโฟลเดอร์ |
| `ไฟล์นี้ไม่ใช่รายงาน R05.106` | หยิบไฟล์ผิด (เช่น R05.105) | ตรวจว่าไฟล์ที่ export มามีคอลัมน์ `CF_BARCODE` / `CF_FMLPRICE` ครบ |
| `ไฟล์นี้น้อยกว่าข้อมูลเดิม NN%` | export มาไม่ครบ | export ใหม่ · ถ้าไฟล์ถูกต้องจริงให้รัน `node upload-products.mjs --force` |
| `กรุณารัน products-import-swap.sql` | ยังไม่ได้สร้างตารางพัก/RPC | รันไฟล์ SQL นั้นใน Supabase SQL Editor |
| `Could not find the function ... in the schema cache` | รัน SQL แล้วแต่ PostgREST ยังไม่รู้จัก | รอสักครู่แล้วรันใหม่ หรือ Supabase → Settings → API → Reload schema cache |
| `สลับข้อมูลไม่สำเร็จ: DELETE requires a WHERE clause` | ใช้ `products-import-swap.sql` เวอร์ชันเก่า (DELETE ไม่มี WHERE — Supabase เปิด safeupdate ไว้) | รันไฟล์ SQL เวอร์ชันล่าสุดทับอีกครั้ง (เป็น `create or replace`) แล้วสั่งอัปโหลดซ้ำด้วย `run_and_upload.ps1 -SkipExport` · `products` ไม่ถูกแตะตอนพัง ข้อมูลเดิมอยู่ครบ |
| `ไม่พบไฟล์: \\PCNAME\...` | Network path ผิด หรือเครื่อง POS ปิดอยู่ | ตรวจสอบ PCNAME และ sharing permission |
| `ไม่พบข้อมูล — ColD ที่พบใน CSV: ...` | ชื่อสาขาใน CSV ไม่ตรง | ตรวจสอบค่าที่แสดงและแก้ไขใน upload-stock.mjs |
| script ไม่รันอัตโนมัติ | Task Scheduler ไม่มี permission | ตั้ง "Run whether user is logged on or not" |
