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

## Task ที่ 2 — อัปโหลดสินค้า R05.106 (วันละครั้ง 08:30)

ไฟล์ `R05.106.CSV` ถูก export ใหม่ทุกเช้า วางไว้โฟลเดอร์เดียวกับ `All_stock.csv`

**ต้องทำก่อน 1 ครั้ง:** เปิด Supabase → SQL Editor → รัน `products-import-swap.sql` (สร้างตารางพัก + RPC) ไม่งั้นสคริปต์จะขึ้น error บอกให้รันไฟล์นี้

**ต้องมีในโฟลเดอร์เดียวกัน:** `upload-products.mjs` · `run-upload-products.bat` · `.env` (มี `SUPABASE_SERVICE_KEY`) · `node_modules\@supabase\supabase-js`

**ทดสอบก่อนตั้งเวลา:**
```cmd
node upload-products.mjs --dry-run --force
```
ต้องขึ้นสรุปจำนวนแถวและ `✅ ตรวจผ่านทั้งหมด` โดยไม่เขียนอะไรลง Supabase

**ตั้ง Task:** Create Basic Task → ชื่อ `ANIN Products Upload (R05.106)` → **Daily** เวลา `08:30:00` → **Start a program**
- **Program/script:** path เต็มของ `run-upload-products.bat`
- **Start in (optional):** โฟลเดอร์ที่ไฟล์นั้นอยู่

→ Finish → Properties → แท็บ **General** → **Run whether user is logged on or not**

> ⚠️ **ไม่ต้องตั้ง Repeat task** แบบ Task สต๊อค — ไฟล์อัปเดตวันละครั้ง รันซ้ำก็ได้ข้อมูลเดิม
> ⚠️ **ตั้งได้เครื่องเดียวเท่านั้น** — 2 เครื่องรันพร้อมกันจะแย่งกันเขียนตาราง `products`

**Last Run Result ที่จะเห็น:**

| ค่า | ความหมาย |
|---|---|
| `0x0` | อัปโหลดสำเร็จ |
| `0x2` | **ข้าม ไม่ใช่ error** — ไฟล์ R05.106.CSV ไม่ได้ถูกอัปเดตวันนี้ (เช้านั้น export ไม่ออก) ข้อมูลเดิมยังอยู่ครบ |
| `0x1` | ผิดพลาด — เปิด `upload-products.log` ดูสาเหตุ |

---

## แก้ปัญหาเบื้องต้น

| ข้อความ Error | สาเหตุ | วิธีแก้ |
|---|---|---|
| `Cannot find package '@supabase/supabase-js'` | ยังไม่ได้รัน npm install | รัน `npm install @supabase/supabase-js` ในโฟลเดอร์ |
| `ไฟล์นี้ไม่ใช่รายงาน R05.106` | หยิบไฟล์ผิด (เช่น R05.105) | ตรวจว่าไฟล์ที่ export มามีคอลัมน์ `CF_BARCODE` / `CF_FMLPRICE` ครบ |
| `ไฟล์นี้น้อยกว่าข้อมูลเดิม NN%` | export มาไม่ครบ | export ใหม่ · ถ้าไฟล์ถูกต้องจริงให้รัน `node upload-products.mjs --force` |
| `กรุณารัน products-import-swap.sql` | ยังไม่ได้สร้างตารางพัก/RPC | รันไฟล์ SQL นั้นใน Supabase SQL Editor |
| `Could not find the function ... in the schema cache` | รัน SQL แล้วแต่ PostgREST ยังไม่รู้จัก | รอสักครู่แล้วรันใหม่ หรือ Supabase → Settings → API → Reload schema cache |
| `ไม่พบไฟล์: \\PCNAME\...` | Network path ผิด หรือเครื่อง POS ปิดอยู่ | ตรวจสอบ PCNAME และ sharing permission |
| `ไม่พบข้อมูล — ColD ที่พบใน CSV: ...` | ชื่อสาขาใน CSV ไม่ตรง | ตรวจสอบค่าที่แสดงและแก้ไขใน upload-stock.mjs |
| script ไม่รันอัตโนมัติ | Task Scheduler ไม่มี permission | ตั้ง "Run whether user is logged on or not" |
