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

## อัปโหลดสินค้า R05.106 — อยู่คนละ repo แล้ว

**ไม่ได้ตั้งจากที่นี่** — งานนี้ย้ายไป repo **[it-anin/botr05106](https://github.com/it-anin/botr05106)** ทั้งชุดเมื่อ 2569-09-06 (โค้ดอัปโหลด + เทส + SQL + ตัวตั้ง Task) เพราะไฟล์ `R05.106.CSV` มาจากบอทตัวนั้นอยู่แล้ว จึงให้บอทอัปโหลดต่อท้ายตอน export เสร็จในงาน Task เดียว ไม่ต้องตั้งเวลาเดาว่าไฟล์ออกรึยัง

วิธีติดตั้งเต็ม ๆ อยู่ใน `README.md` ของ repo นั้น สรุปสั้น ๆ:
```powershell
cd <โฟลเดอร์ BOTR05106>
npm install                       # ครั้งแรกครั้งเดียว
.\tools\run_and_upload.ps1 -DryRunUpload      # ซ้อม
.\tools\register_task.ps1 -Time 08:30 -Flows "flows/r05_106_export.yaml" -WithUpload
```

> ⚠️ **ห้ามตั้ง Task อัปโหลด R05.106 จากเครื่อง/ทางอื่นซ้ำ** — 2 ทางรันพร้อมกันจะแย่งกันเขียนตาราง `products`
> 🚨 Task ของบอทต้องเป็น **"Run only when user is logged on"** (GUI automation รันใน Session 0 ไม่ได้) ต่างจาก Task สต๊อค/ลูกค้าในไฟล์นี้

---

## แก้ปัญหาเบื้องต้น

| ข้อความ Error | สาเหตุ | วิธีแก้ |
|---|---|---|
| `Cannot find package '@supabase/supabase-js'` | ยังไม่ได้รัน npm install | รัน `npm install @supabase/supabase-js` ในโฟลเดอร์ |
| `ไม่พบไฟล์: \\PCNAME\...` | Network path ผิด หรือเครื่อง POS ปิดอยู่ | ตรวจสอบ PCNAME และ sharing permission |
| `ไม่พบข้อมูล — ColD ที่พบใน CSV: ...` | ชื่อสาขาใน CSV ไม่ตรง | ตรวจสอบค่าที่แสดงและแก้ไขใน upload-stock.mjs |
| script ไม่รันอัตโนมัติ | Task Scheduler ไม่มี permission | ตั้ง "Run whether user is logged on or not" |
