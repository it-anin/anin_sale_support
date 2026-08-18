# CLAUDE.md — ฉลากยา (Drug Label)

บริบทเฉพาะโฟลเดอร์นี้ (`druglabel/`) — Claude Code โหลดไฟล์นี้อัตโนมัติเมื่อทำงานกับไฟล์ในโฟลเดอร์นี้ เสริมจาก root `CLAUDE.md` (ดู "Architecture → Key files — ฉลากยา" สำหรับรายชื่อไฟล์)

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
