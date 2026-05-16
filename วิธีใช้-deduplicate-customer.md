# วิธีใช้งาน Script ลบแถวซ้ำ (Customer History)

## เตรียมไฟล์

1. วางไฟล์ CSV ทั้งสองไว้ใน folder โปรเจกต์ `anin_pricetag_qrcode`
   - `customer2025.csv` — ข้อมูลที่ต้องการกรอง
   - `customer2026.csv` — ข้อมูลที่ใช้เปรียบเทียบ
2. Script เช็คซ้ำโดยใช้ **ColB (phone) + ColC (ชื่อ) + ColD (นามสกุล)** รวมกัน

---

## รัน Script

เปิด PowerShell แล้วรัน:

```
cd "C:\Users\Arm\Desktop\anin-label 16-5-2026\anin_pricetag_qrcode"
node deduplicate-customer.mjs
```

ผลลัพธ์ที่จะเห็น:
```
📂 2026: 1500 แถว
📂 2025: 2000 แถว
🗑️  ซ้ำกับ 2026: 300 แถว
✅ เหลือ: 1700 แถว
💾 บันทึกแล้วที่: customer2025_deduped.csv
```

ไฟล์ `customer2025_deduped.csv` จะถูกสร้างใน folder เดียวกัน — พร้อมนำไป upload

---

## อัพโหลดข้อมูลที่กรองแล้วเข้า Supabase

แก้ `CSV_PATH` ใน `upload-customer-history.mjs` ชั่วคราวให้ชี้ไปที่ไฟล์ที่ได้:

```js
const CSV_PATH = 'C:\\Users\\Arm\\Desktop\\anin-label 16-5-2026\\anin_pricetag_qrcode\\customer2025_deduped.csv';
```

แล้วรัน:
```
node upload-customer-history.mjs
```

> อย่าลืมเปลี่ยน `CSV_PATH` กลับเป็นค่าเดิมหลังจาก upload เสร็จ

---

## ลบข้อมูลทั้งหมดใน customer_history

ไปที่ **Supabase Dashboard → SQL Editor → New Query** แล้วรัน:

### ลบข้อมูลอย่างเดียว (id วิ่งต่อจากเดิม)
```sql
DELETE FROM customer_history;
```

### ลบข้อมูล + รีเซ็ต id กลับเป็น 1
```sql
TRUNCATE TABLE customer_history RESTART IDENTITY;
```

> **ความแตกต่าง:**
> - `DELETE` — ลบข้อมูล id ยังวิ่งต่อจากเลขเดิม เช่น เคยมี id ถึง 5000 แถวใหม่จะเริ่มที่ 5001
> - `TRUNCATE RESTART IDENTITY` — ลบข้อมูลและรีเซ็ต id กลับเป็น 1 ใหม่

ทั้งสองวิธีไม่มีผลต่อการใช้งานเว็บครับ

---

## การอัพเดทเมื่อมีลูกค้าใหม่

วิธีที่แนะนำ — **เก็บข้อมูลทุกปีไว้ในไฟล์เดียว**

1. เปิดไฟล์ `customer_history.csv` ที่ใช้อยู่
2. เพิ่มแถวลูกค้าใหม่ต่อท้าย (ไม่ต้องแก้ข้อมูลเก่า)
3. Save ไฟล์
4. รัน script อัพโหลดใหม่:

```
node "C:\Users\Arm\Desktop\anin-label 16-5-2026\anin_pricetag_qrcode\upload-customer-history.mjs"
```

script จะลบข้อมูลเก่าใน Supabase และ insert ทั้งหมดใหม่จากไฟล์ — รวมลูกค้าใหม่ที่เพิ่งเพิ่มเข้าไป

> **หมายเหตุ:** ถ้ามีข้อมูลหลายปี ให้รวมทุกปีไว้ในไฟล์เดียวกัน ไม่ต้องแยกไฟล์ตามปี
