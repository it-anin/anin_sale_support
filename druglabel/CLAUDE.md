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

### 🚨 View `dl_*` เป็น snapshot ของคอลัมน์ ไม่ใช่ `SELECT *` ที่มีชีวิต (บั๊กจริง 2569-08-26)

ทั้ง 3 view สร้างด้วย `CREATE OR REPLACE VIEW public.dl_xxx AS SELECT * FROM label.xxx` ([`supabase-setup.sql:53-55`](../supabase-setup.sql)) ซึ่ง **หลอกตา** — Postgres **ขยาย `*` เป็นรายชื่อคอลัมน์จริงตั้งแต่ตอนสร้าง view แล้วเก็บรายชื่อนั้นไว้ถาวร** (`pg_rewrite`) ไม่ได้เก็บดอกจันไว้แล้วไปขยายใหม่ทุกครั้งที่ query · **เพิ่มคอลัมน์ในตารางทีหลัง view จะไม่มีวันเห็นคอลัมน์นั้นเอง**

**เคสที่เกิดจริง:** `dl_medicines` ถูกสร้างก่อน [`alter-medicines-v2.sql`](../alter-medicines-v2.sql) เพิ่ม `usage_ref` → ฟีเจอร์นำเข้า XLSX พังด้วย `❌ column dl_medicines.usage_ref does not exist` ทั้งที่คอลัมน์มีอยู่จริงในตาราง

**สถานะแต่ละ view (ตรวจกับ DB จริง 2569-08-26):**

| View | คอลัมน์ที่ view เห็น | ตรงกับตารางไหม |
|---|---|---|
| `dl_medicines` | id, sku, barcode | ❌ **ขาด `usage_ref`** |
| `dl_medicine_translations` | id, medicine_id, lang, trade_name, generic_name, usage, indication, warning, storage | ✅ ตรง |
| `dl_settings` | id, shop_name_th, shop_name_en, phone, line_id, logo_text, updated_at | ตรวจเทียบตรงๆ ไม่ได้ (ดูข้อ RLS ล่าง) |

**วิธีแก้เมื่อ view ตกคอลัมน์ — เลือก 1 ใน 2:**

1. **อ่านตารางตรงๆ ไม่ผ่าน view** (ทางที่ import ใช้อยู่) — `supabaseLabelWrite.from('medicines')` เพราะ client ตัวนั้นตั้ง `db: { schema: 'label' }` ไว้แล้ว · ข้อดี: ไม่ต้องรัน SQL ได้คอลัมน์ครบตามตารางเสมอ · **ข้อจำกัด: ใช้ได้เฉพาะตารางที่ RLS ยอม** (ดูล่าง)
2. **สร้าง view ใหม่หลัง migration ทุกครั้ง:**
   ```sql
   CREATE OR REPLACE VIEW public.dl_medicines AS SELECT * FROM label.medicines;
   ```
   - ✅ `CREATE OR REPLACE` **เพิ่มคอลัมน์ต่อท้ายได้** และ **รักษา GRANT เดิมไว้**
   - ❌ แต่ **ลบ / เปลี่ยนชื่อ / เปลี่ยนชนิด / สลับลำดับคอลัมน์เดิมไม่ได้** จะขึ้น `cannot change name of view column` → กรณีนั้นต้อง `DROP VIEW ... CASCADE` แล้วสร้างใหม่
   - 🚨 **ถ้า `DROP VIEW` ต้อง `GRANT SELECT ... TO anon, authenticated` ใหม่ด้วยเสมอ** — สิทธิ์ถูกลบไปพร้อม view เว็บจะอ่านไม่ได้ทันทีทั้งที่ view มีอยู่

**⚠️ RLS ทำให้ 2 ทางนี้ใช้แทนกันไม่ได้เสมอ** — view รันด้วยสิทธิ์ของ owner (`security_invoker` เป็น off โดย default) จึง **ข้าม RLS ของตารางต้นทาง** ผลคือ:
- `label.medicines` — anon อ่านตรงได้ (ทดสอบแล้วคืนข้อมูลจริง) → ทางที่ 1 ใช้ได้
- `label.settings` — **anon อ่านตรงได้ `[]` (ว่าง) ทั้งที่ผ่าน `dl_settings` เห็น 1 แถว** = RLS บล็อกอยู่ → **ถ้าย้าย `loadSettings` ไปอ่านตารางตรงๆ หน้าจะพังแบบเงียบๆ ไม่มี error แค่ไม่มีข้อมูลร้าน** ตัวนี้ต้องใช้ทางที่ 2 เท่านั้น

**วิธีเช็คว่ามี view ไหนตกคอลัมน์บ้าง** (รันใน Supabase SQL Editor):
```sql
SELECT t.table_name AS tbl, t.column_name AS "คอลัมน์ที่ view มองไม่เห็น"
FROM information_schema.columns t
LEFT JOIN information_schema.columns v
  ON v.table_schema = 'public'
 AND v.table_name   = 'dl_' || t.table_name
 AND v.column_name  = t.column_name
WHERE t.table_schema = 'label' AND v.column_name IS NULL
ORDER BY 1, 2;
```

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

## Drug Label — นำเข้าจากไฟล์ XLSX/CSV (2569-08-26)

ปุ่ม **📤 อัปโหลดฉลากยา (XLSX/CSV)** ใน `.dl-upload-row` ข้างปุ่ม ➕ — **โผล่เฉพาะเมื่อปลดล็อกแอดมิน** (`isAdminUnlocked`) แล้ว
โค้ด: `parseLabelSheet()` (module-level, pure) + `handleLabelImport()` ใน `DrugLabelPage.tsx`

**Mapping ตามตำแหน่งคอลัมน์ ไม่ใช่ชื่อหัวคอลัมน์** (`IMPORT_COL`):
`A`=sku · `D`=indication · `E`=usage · `F`=warning · `G`=storage · `H`=generic_name · `I`+`J`=trade_name (คั่นด้วย `TRADE_NAME_SEP = ' / '`, ฝั่งไหนว่างใช้อีกฝั่งเดี่ยวๆ) · `B`/`C` ไม่ใช้ · `barcode` = `null` เสมอ

- ⚠️ positional mapping ขัดกับกฎ "match by header name only" ของ root CLAUDE.md **โดยตั้งใจ** — กฎนั้นมีไว้กับ uploader ที่ *delete-all + insert* (ไฟล์ผิด = ข้อมูลหายเกลี้ยง) ตัวนี้ **merge-only ไม่ลบไม่เขียนทับอะไรเลย** ไฟล์ผิดอย่างมากได้แถวขยะเพิ่ม · ตัวกันพลาดคือ **ตัวอย่าง 3 แถวแรกใน `window.confirm`** ให้ตาดูว่าคอลัมน์ลงถูกช่องก่อนกดตกลง — ห้ามถอดออก
- 🚨 **อ่านเฉพาะชีทชื่อ `Data_Static`** (`IMPORT_SHEET`) — ไฟล์ต้นทางมีหลายชีท **ห้าม fallback ไปชีทแรก** เด็ดขาด จะนำเข้าข้อมูลผิดชุดแบบเงียบๆ (mapping เป็นตำแหน่งคอลัมน์ ชีทอื่นก็ parse ผ่านได้เหมือนกัน แค่ได้ข้อมูลมั่ว) หาไม่เจอ = throw พร้อมลิสต์ชื่อชีทที่มีในไฟล์ · เทียบชื่อแบบ `trim().toLowerCase()`
  - **ยกเว้น CSV** ที่ไม่มีชีท (SheetJS ตั้งชื่อให้เองว่า `Sheet1`) → ใช้ชีทแรก
- **ข้ามแถวที่ 1 เสมอ** (ไฟล์มีหัวคอลัมน์แน่นอน) · `'-'` = ค่าว่าง · SKU ตัวเลข 1–5 หลัก → `padStart(6,'0')` (ของเดิมใน DB เป็น 6 หลักทุกแถว)
- **SKU ที่มีอยู่แล้ว → เขียนทับคำแปลไทย** (เปลี่ยนจากเดิมที่ข้าม 2569-08-26 ตามคำสั่งผู้ใช้) · ภาษาอื่นไม่ถูกแตะ เพราะ upsert เฉพาะแถว `lang = 'th'`
- 🚨 **unique key ของ `medicines` คือ `(sku, usage_ref)` ไม่ใช่ `sku` เดี่ยวๆ** — SKU เดียวมีได้หลายแถวถ้า "วิธีใช้" ต่างกัน (ข้อมูลจริง: 133 SKU มีแถวเดียว, 16 มี 2 แถว, 7 มี 3 แถว) ถ้า match ด้วย `(sku, usage_ref)` ตรงๆ อย่างเดียว **การแก้คำว่า "วิธีใช้" ในไฟล์จะกลายเป็นการเพิ่มแถวใหม่ซ้ำ SKU แทนที่จะทับของเดิม** — ผู้ใช้จะเห็นเป็น "อัปโหลดแล้วไม่ทับ" การจับคู่จึงแบ่ง 3 ทางใน `handleLabelImport`:
  1. `exact` — ตรงทั้ง `sku` + `usage_ref` → ทับคำแปลอย่างเดียว ไม่แตะตาราง `medicines`
  2. `reuse` — SKU นั้นมีแถวเดียวใน DB แต่ `usage_ref` เปลี่ยน → **แก้ `usage_ref` ของแถวเดิม** ด้วย `upsert(..., { onConflict: 'id' })`
  3. `new` — ไม่เคยมี SKU นี้ หรือ SKU มีหลายแถวแล้วหาที่ตรงไม่ได้ → เพิ่มเป็นวิธีใช้แบบใหม่
  - `claimed: Set<id>` กัน 2 แถวในไฟล์แย่งแถวเดิมใบเดียวกัน (ใบแรกได้ `reuse` ใบถัดไปตกเป็น `new`)
  - ⚠️ **ลำดับเขียนสำคัญ: `reuse` ต้องรันก่อน `new` เสมอ** — ไม่งั้นแถว `new` ที่บังเอิญใช้ `usage_ref` เดิมจะไปชนแถวที่ยังไม่ถูกแก้ แล้วคำแปล 2 แถวจะทับกัน
- 🚨 **ต้อง dedupe คู่ `(sku, usage_ref)` ภายในไฟล์ก่อน upsert** — ซ้ำในก้อนเดียวทำให้ Postgres error 21000 *"ON CONFLICT DO UPDATE command cannot affect row a second time"* ทั้ง chunk พัง
- ⚠️ **ห้ามใส่ `barcode` ใน payload ของ `medicines`** — upsert จะ `SET` ทุกคอลัมน์ที่อยู่ใน payload ใส่ `barcode: null` ไปด้วยจะล้าง barcode ที่คนกรอกมือไว้ทิ้ง (ไฟล์นำเข้าไม่มีคอลัมน์นี้) ไม่ใส่เลย = แถวใหม่ได้ `null` ตาม default แถวเดิมไม่ถูกแตะ
- ดึงข้อมูลเดิมด้วย `.range()` **ทีละ 1000 วนจนหมด** — Supabase คืน default 1000 แถว ดึงรอบเดียวจะเห็นไม่ครบแล้วเผลอสร้างแถวซ้ำ
- 🚨 **view `dl_medicines` ไม่มีคอลัมน์ `usage_ref`** — ดูหัวข้อ "🚨 View `dl_*` เป็น snapshot" ด้านล่าง · import จึงอ่านจาก **`supabaseLabelWrite.from('medicines')`** (schema `label`) ตรงๆ ไม่ผ่าน view
- confirm dialog บอกจำนวน "เขียนทับ / เพิ่มใหม่" แยกกัน + เตือนว่าคำแปลไทยเดิมจะถูกทับ · chunk ละ 500 ทุกขั้น
- **จงใจไม่แปลภาษาอื่นตอนอัปโหลด** — ลูปแปลหลายร้อยแถวชน Groq 8,000 TPM / 200K TPD แน่นอน (ดูหัวข้อ Rate Limit ข้างล่าง) ผู้ใช้เปิดทีละ SKU → ✏️ แก้ไข → ✨ แปลด้วย AI เอง
- CSV อ่านผ่าน `file.text()` (บังคับ UTF-8) ไม่ใช่ `arrayBuffer()` — ไฟล์ TIS-620 ภาษาไทยจะเพี้ยน ให้ผู้ใช้บันทึกเป็น .xlsx แทน

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

### 🚨 ห้ามให้ "แปลไม่สำเร็จ" กลายเป็นคำแปลว่างที่บันทึกได้ (บั๊กจริง 2569-08-19)

SKU 101248 ได้แถวคำแปล **null ครบทั้ง 5 ภาษา** ลง DB โดยไม่มี error ให้ใครเห็น — ป้ายพิมพ์ออกมาว่างเปล่าเหลือแต่ `Trade Name: (101248)` (ค่า fallback `(${sku})` ของ `flatMed`) เพราะ `Label.tsx` render แต่ละช่องแบบ `{medicine.usage && ...}` ไม่มีข้อมูลก็ไม่ขึ้นเลย ต้นเหตุคือแปลตอนที่ Groq ใช้ไม่ได้ แล้วค่าว่างถูกบันทึกตามไปด้วย

กันไว้ **2 ชั้น ต้องมีทั้งคู่** เพราะ edge function กับเว็บ **deploy คนละทาง** (Vercel auto-deploy ↔ `supabase functions deploy` ที่ต้องรันมือ) เวอร์ชันเก่าฝั่งใดฝั่งหนึ่งค้างอยู่ได้เสมอ:
1. `index.ts` — เช็ค `finish_reason === 'length'`, content ว่าง, และ**ทุกภาษาที่ขอต้องมีเนื้อหาจริง** ไม่งั้น throw (คืน 500) ห้ามคืน 200 พร้อมคำแปลเปล่า
2. `translate.ts` — เช็คซ้ำฝั่ง client ก่อนคืนค่า ถ้าภาษาไหนว่าง throw ทิ้งไปเลย **ไม่แตะฟอร์ม**

⚠️ จุดตายอยู่ที่ `normalize` ใน `index.ts`: `raw[lang]?.field ?? ''` แปลง "โมเดลตอบคนละรูปแบบ" (ห่อ object อีกชั้น / ใช้ชื่อภาษาเต็มเป็น key) ให้กลายเป็นค่าว่างเงียบๆ — เปลี่ยนโมเดลเมื่อไหร่ความเสี่ยงนี้กลับมาทันที ห้ามถอด guard ข้อ 1 ออก

## Drug Label — Translation Rate Limit

- ใช้ Groq API (`openai/gpt-oss-120b`) ผ่าน Edge Function `translate-medicine` — เดิมใช้ `llama-3.3-70b-versatile` แต่ Groq เลิกรองรับ (deprecated) 2569-08 เปลี่ยนเป็นโมเดลนี้ตามคำแนะนำของ Groq
- Free tier ของ org นี้: **8,000 TPM (tokens/min) ต่อ request** + 200K TPD (tokens/day) — TPM ใช้ร่วมกันทุกโมเดล chat ที่ Groq free tier มีตอนนี้ (`gpt-oss-120b`/`gpt-oss-20b`/`qwen3.6-27b` ล้วน 8K TPM เท่ากัน) เปลี่ยนโมเดลไม่ช่วยแก้ TPM
- 🚨 **TPM นับรวม prompt + max_tokens ที่ "ขอจอง" ไม่ใช่ token ที่ใช้จริง** — เคยตั้ง `max_tokens: 8192` แบบตายตัวแล้วชน "Request too large ... rate_limit_exceeded" ทันทีที่ prompt มีเนื้อหาเพิ่มเข้ามา (prompt 433 + max_tokens 8192 = 8625 > 8000) แก้แล้วโดยคำนวณ `max_tokens` จาก budget ที่เหลือหลังหัก prompt แบบไดนามิก (ดู `TPM_LIMIT`/`promptTokenEstimate` ใน `index.ts`) ถ้าจะแก้ตรงนี้อีกต้องคงหลักการนี้ไว้ ห้ามกลับไปใช้ค่าคงที่
- เมื่อถึง limit (RPM/RPD/TPD ไม่ใช่กรณี TPM เกินจาก request เดียวข้างบน) แสดง "ถึง rate limit — รอประมาณ xx นาที"
- Edge Function คืน `{ rate_limit: true, retry_minutes: N | null }` status 200 (ไม่ใช่ 500) — เดิมใช้ field ชื่อ `error` แต่ทำให้ Supabase SDK ตีความผิดว่าเป็น error จริง จึงเปลี่ยนมาใช้ `rate_limit`
- ⚠️ error อื่นที่ไม่ใช่ rate limit (เช่น GROQ_API_KEY หาย, โมเดลถูก deprecate, request ใหญ่เกิน TPM ต่อ request) จะมาเป็น status 500 — client (`druglabel/translate.ts`) จะ parse response body มาโชว์ข้อความจริง ไม่ใช่ข้อความ generic ของ Supabase SDK
