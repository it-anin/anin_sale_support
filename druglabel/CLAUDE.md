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

## Drug Label — Branches (สาขาตามรหัสล็อกอิน — เปลี่ยน 2569-10-13)

3 สาขา hardcoded ใน `BRANCH_PROFILES` (`DrugLabelPage.tsx`) — **สาขาของฉลาก = ตามรหัสที่ล็อกอิน** ผ่าน prop `userBranch` (`authProfile.branch` จาก `App.tsx`) จับคู่กับ `BRANCH_PROFILES[].code`:

| รหัสล็อกอิน | สาขา | EN | เบอร์ | เภสัชกร (พิมพ์ท้ายฉลาก) |
|---|---|---|---|---|
| `SRC` | สาขาชากค้อ | Chak Kho Branch | 082-0311590 | วัชรพันธ์ สุริยะคุปต์ (ภ. 45878) |
| `KKL` | สาขาเก้ากิโล | Kao Ki Lo Branch | 098-8201512 | เกียรติศักดิ์ ภาคี (ภ. 43609) |
| `SSS` | สาขาสวนเสือศรีราชา | Suan Suea SiRacha Branch | 092-2469002 | ภรัณยู เหลื่อมสิงขร (ภ. 50908) |

- **เลิกปุ่มเลือกสาขาแล้ว** — เดิมมีปุ่ม `.dl-branch-btn` 3 ปุ่มบน hero (state `selectedBranch`, id `hq` / `nine-kilo` / `suan-suea`) ตอนนี้เป็น chip อ่านอย่างเดียว `.dl-branch-chip` (🔒 + ชื่อสาขา) อยู่ที่ตำแหน่งเดิมใน `.tagline-row` (คงที่ว่างของ hero ไว้ ปุ่มนำทางไม่ขยับเทียบหน้าอื่น)
- 🚨 **รหัสที่ไม่ใช่ SRC/KKL/SSS (Sale Admin / คลังสินค้า / จัดซื้อ) ไม่มีสาขา** → `branch` = `undefined` → `activeSettings` = `null` → **ไม่ render ฉลากเลย (ทั้ง Preview และตัวพิมพ์) ไม่มีปุ่มพิมพ์** แสดงข้อความอธิบายแทน + chip `.dl-branch-chip--none` · ยังค้นหา / เพิ่ม / แก้ไข / ลบข้อมูลยาได้ตามปกติ (`editDeleteButtons` ใช้ร่วมทั้ง 2 กรณี)
  - **ห้าม fallback เป็นสาขาใดสาขาหนึ่ง** (เช่น `?? BRANCH_PROFILES[0]` แบบเดิม): ฉลากจะพิมพ์ชื่อร้าน/เบอร์/**ชื่อเภสัชกร**ของสาขานั้นทั้งที่ผู้พิมพ์ไม่ใช่ = ชื่อผู้จ่ายยาบนฉลากที่จ่ายจริงผิดคน · เดิมปุ่มเลือกสาขายังบอกผู้ใช้ว่ากำลังพิมพ์สาขาไหน เลิกปุ่มแล้วไม่มีอะไรบอก จึงต้องไม่เดา (แนวเดียวกับ `branchNotSupported` ใน `OutboundPage.tsx`)
  - ถ้าผู้ใช้อยากให้รหัสใดพิมพ์ได้ (เช่น Sale Admin) ต้องให้ผู้ใช้บอกว่าให้ใช้สาขา/เภสัชกรของที่ไหน แล้วจับคู่รหัสนั้นเข้า `BRANCH_PROFILES` — อย่าเดาเอง
- `Profile.branch` ใน `auth.ts` มีหน้าที่ที่ 3 แล้ว (ฉลากยา) — ถ้าเปลี่ยนค่า `SRC/KKL/SSS` ต้องแก้ `BRANCH_PROFILES[].code` ตามด้วย ไม่งั้นฉลากหายทั้งสาขานั้นแบบเงียบๆ (chip ขึ้น "ไม่ใช่รหัสสาขา")
- ชื่อเภสัชกรเก็บเป็นข้อความสำเร็จรูปรวมเลขใบอนุญาต (ไม่ได้อยู่ใน DB) — เปลี่ยนเภสัชกรประจำสาขาแก้ที่ `pharmacist` ใน `BRANCH_PROFILES` ที่เดียว

## Drug Label — เภสัชกรประจำสาขาท้ายฉลาก (2569-10-13)

ผู้ใช้ส่งรูปฉลากจากระบบเดิม (ProMaxx) ที่มีบรรทัด `เภสัชกร : วัชรพันธ์ สุริยะคุปต์ (ภ. 45878)` ท้ายฉลาก แล้วขอให้ฉลากหน้าเว็บมีบรรทัดนี้ **ยกเว้นรูปแบบตัวอักษรไม่ต้องตามรูป** — ตามรูปเฉพาะตำแหน่ง/ข้อความ: บรรทัดสุดท้ายของฉลาก ใต้เส้นคั่น ชิดล่าง · **ไม่ได้ตามรูปในส่วนอื่น** (ผู้ใช้ให้ข้อมูลมาแค่เภสัชกร): หัวฉลากในรูปเป็น "อนิน สาขาแยกชากค้อ + ที่อยู่" แต่เว็บใช้ชื่อสาขา+ชื่ออังกฤษ · วันที่ในรูปอยู่ท้ายบรรทัดชื่อลูกค้า (เว็บอยู่ใต้เบอร์โทรที่หัวฉลาก เพราะบรรทัดชื่อลูกค้าเป็นช่องไม่บังคับ — ย้ายแล้วฉลากที่ไม่มีชื่อจะไม่มีวันที่) · รูปแสดง "ชื่อยา:" แม้ว่าง (เว็บซ่อนบรรทัดว่าง ประหยัดความสูง)

- DOM: `.dl-label-bottom` (`margin-top: auto`) ห่อ `.dl-label-warn` (ข้อควรระวัง/การเก็บรักษา) + `.dl-label-pharmacist` · `Label` อ่านชื่อจาก `settings.pharmacist` — ชนิด `LabelShopInfo` ใน `types.ts` (= `ShopSettings` + `pharmacist`) · `activeSettings` ใน `DrugLabelPage` ประกอบจากแถว `dl_settings` ทับด้วยค่าใน `BRANCH_PROFILES`
- รูปแบบ `เภสัชกร : ชื่อ (ภ. เลข)` (เว้นวรรคหน้า `:` ตามรูป) · ป้าย "เภสัชกร" แปลตามภาษาใน `FIELD_LABELS.pharmacist` (ชื่อ+เลขใบอนุญาตเป็นภาษาไทยทุกภาษา) — ⚠️ ป้ายภาษาพม่า `ဆေးဝါးပညာရှင်` และเขมร `ឱសថការី` **ยังไม่มีเจ้าของภาษาตรวจ** (ค้นเว็บยืนยันไม่ได้)
- ตัวอักษร **8pt/700 ตายตัว** (เท่าชื่อร้านที่หัวฉลาก) **ไม่ผูกกับ `--dl-body-size`** — เป็นข้อมูลระบุผู้จ่ายยา ต้องอ่านชัดเสมอ ไม่ถูกลดตามเนื้อหา
- 🚨 **`.dl-label-bottom` ถือ `margin-top: auto` ที่เดียว** ห้ามใส่ซ้ำที่ `.dl-label-warn` — auto 2 ตัวใน flex column แบ่งพื้นที่ว่างครึ่งๆ ข้อควรระวังจะลอยกลางฉลาก
- เส้นหลังข้อควรระวังมีเฉพาะเมื่อมีการเก็บรักษาตามหลัง (เดิมวางทุกครั้งแม้ไม่มีอะไรตาม) — ส่วนเส้นเหนือเภสัชกรเป็น `border-top` ของบรรทัดเภสัชกรเอง
- 🚨 **เส้นคั่นเหนือเภสัชกรกระชับกว่า `.dl-label-divider` โดยตั้งใจ** (เหนือเส้น 0.4 / ใต้เส้น 0.3 มม. แทน 0.6 / 0.6 — ประหยัดราว 0.5 มม.) เพราะความสูงฉลากกระจุกอยู่ใกล้ขอบ: ฉลากที่ได้ 9.5pt (ไทย ไม่มีชื่อลูกค้า) = ใช้ divider ปกติ **190 ใบ** · แบบกระชับ **272 ใบ** · ก่อนมีบรรทัดนี้ 303 — คืนเป็น divider ปกติแล้วฉลากจะถูกลดขนาดเพิ่มทันที (ลองบีบเพิ่ม / ลดฟอนต์เภสัชกรเป็น 7.5pt / ตัดเส้นทิ้ง แล้ว ฉลากที่ได้ 9.5pt ไม่เพิ่ม — 272 เท่าเดิม)
- **ผลต่อการลดขนาดอัตโนมัติ** (วัดกับยาจริง 333 รายการ หัวฉลากสวนเสือ = ยาวสุด · ชื่อลูกค้าทดสอบ `สุพรรณี สัตถวิชชพิชญ์ / 0819498737`) — จำนวนฉลากที่ยังได้ 9.5pt (ก่อน → หลัง):

  | ภาษา | ไม่มีชื่อลูกค้า | มีชื่อลูกค้า |
  |---|---|---|
  | ไทย (333) | 303 → 272 | 272 → 189 |
  | อังกฤษ (322) | 258 → 151 | 151 → 68 |
  | ญี่ปุ่น (317) | 295 → 218 | 218 → 133 |
  | พม่า (319) | 191 → 115 | 115 → 54 |
  | เขมร (318) | 240 → 158 | 158 → 73 |
  | จีน (319) / เกาหลี (127) | 316 → 309 / 121 → 118 | 309 → 263 / 118 → 91 |

  ไทยไม่มีชื่อลูกค้า: ถูกตัดท้าย 0 → 2 (`100541` Mega Gogaz · `100543` Mega Naprofazt 250 mg — ข้อความยาวผิดปกติ เดิมแค่พอดีที่ 6.5pt) · มีชื่อลูกค้า: 2 → 2 (สองตัวเดิม)
- ⚠️ ล้นที่ 6.5pt แล้ว **ส่วนที่ถูกตัดก่อนคือบรรทัดเภสัชกร** (อยู่ล่างสุด หน้าต่างพิมพ์ `overflow: hidden`) → ข้อความเตือนแดงใต้ Preview บอกว่า "ส่วนท้าย (รวมชื่อเภสัชกร) จะถูกตัดตอนพิมพ์" · ทางแก้คือย่อข้อความยานั้น ไม่ใช่ปิดเตือน
- ทดสอบ: Playwright บนหน้า Label จริง 171/171 (ทุกสาขา × 4 รูปแบบท้ายฉลาก [มี/ไม่มีข้อควรระวัง × การเก็บรักษา] · 7 ภาษา · จำลองหน้าต่างพิมพ์ด้วย HTML ที่ `handlePrint` เขียนจริง 95×65 มม. บรรทัดเภสัชกรจบที่ 62.9 มม. ไม่ล้น ฟอนต์ Sarabun · รหัสที่ไม่ใช่สาขา 3 รหัส) + ตัววัดขนาดกับยาจริงตรงกับหน้าเว็บ 33/33 — วิธีวัดดูโน้ตใน memory `e2e-playwright-python`

## Drug Label — Print

- `handlePrint()` เปิด `window.open('', '_blank', 'width=800,height=600,left=-1000,top=-1000')` — popup นอกจอเพื่อไม่ให้กระพริบ
- Label size: `@page { size: 95mm 65mm; margin: 0; }`
- ดึง `<style>` และ `<link rel="stylesheet">` จาก parent head มาใส่ใน popup (รวม App.css)
- รอ `win.document.fonts.ready` ก่อน `print()` (2569-10-12) — ฟอนต์ Sarabun เป็นฟอนต์เว็บแล้ว พิมพ์ก่อนโหลดเสร็จจะออกเป็นฟอนต์สำรองที่กว้างไม่เท่ากัน

## Drug Label — ขนาดตัวอักษร + ปรับขนาดอัตโนมัติ (2569-10-12)

ผู้ใช้ขอให้ตัวอักษรที่พิมพ์ใหญ่ขึ้น: ชื่อร้านไทย/อังกฤษ 8pt · เบอร์โทร/LINE 8pt · **เนื้อหา 9.5pt ตัวหนา** · ชื่อลูกค้า 9pt ตัวหนา (เดิม 7 / 7 / 7.5 / 8 ปกติ / 8.5) · วันที่คง 7.5pt

- 🚨 **เนื้อหาตายตัวที่ 9.5pt ไม่ได้** — ฉลากสูง 65 มม. และหน้าต่างพิมพ์ `overflow: hidden` ตัดส่วนที่ล้นทิ้ง วัดกับยาจริง 332 รายการ (ภาษาไทย): 9.5pt ตัวหนาตายตัว**ล้น 265** (มีชื่อลูกค้า 320) จากเดิม 5 (70) · แม้ 8.5pt ปกติยังล้น 90 — ผู้ใช้เลือกแบบ "ขนาดตามที่ขอ + บีบระยะห่าง + ลดอัตโนมัติ"
- **บีบระยะห่างแนวตั้ง** (App.css): padding บน/ล่าง 3 → 2 มม. (ซ้าย/ขวาคงเดิม — อาจเผื่อการวางกระดาษในเครื่องพิมพ์) · เส้นคั่น `margin` 1.2 → 0.6 มม. · หัวฉลาก `margin-bottom` 1.5 → 0.8 มม. · `line-height` 1.35 → 1.25 (เช็คกับข้อความไทยจริงแล้ว สระ/วรรณยุกต์ไม่ชนกัน) · `.dl-label-warn` padding 1 → 0.5 มม.
- **ลดขนาดอัตโนมัติ** — `druglabel/fit.ts` `fitLabelBodySize(el)`: ตั้ง `--dl-body-size` บน `.dl-label` เริ่ม 9.5pt ลดทีละ 0.5pt จน `scrollHeight` ไม่เกิน `clientHeight` (ต่ำสุด 6.5pt) · `.dl-label-section { font-size: var(--dl-body-size, 9.5pt) }`
  - **วัดบนตัว Preview เท่านั้น** แล้วส่งขนาดเดียวกันให้ทั้ง 2 ตัวทาง prop `bodySize` (`Label` เขียนเป็น inline CSS var) — 🚨 ตัวพิมพ์ (`.dl-label-print-root`) เป็น `display:none` วัดไม่ได้ (`scrollHeight` = 0 → "พอดี" หลอกทุกฉลาก) · `handlePrint` ก๊อป innerHTML ของตัวพิมพ์ inline var จึงติดไปหน้าต่างพิมพ์เอง
  - `transform: scale(1.25)` ของ Preview ไม่กระทบการวัด (scrollHeight/clientHeight เป็นค่า layout)
  - `useLayoutEffect` (ไม่กระพริบ) deps = `selected, settings, branch, lang, patientName, fontsTick` (`branch` = แถวคงที่ใน `BRANCH_PROFILES` ตามรหัสล็อกอิน — เดิมเป็น `selectedBranch`) — 🚨 **ห้ามใส่ `activeSettings`** สร้าง object ใหม่ทุก render → effect รันทุก render → `setBodyFit` → วนไม่จบ · `setBodyFit` คืน `prev` เมื่อค่าเท่าเดิม
  - วัดซ้ำทุกครั้งที่ `document.fonts` ยิง `loadingdone` — ⚠️ ใช้ `fonts.ready` ตอน mount ไม่ได้ (ตอนนั้นฉลากยังไม่ render ฟอนต์ยังไม่ถูกขอ ready resolve ทันที)
  - ข้อความใต้ Preview: ลดแล้ว → "ลดขนาดตัวอักษรเนื้อหาเหลือ Xpt ให้พอดีฉลาก" · 6.5pt แล้วยังล้น → ⚠️ สีแดง "ส่วนท้ายจะถูกตัดตอนพิมพ์" (`.dl-fit-note`)
- ⚠️ **ตัวเลขข้างล่างวัดก่อนมีบรรทัดเภสัชกรท้ายฉลาก (2569-10-13)** — บรรทัดนั้นกินความสูงเพิ่ม ตัวเลขหลังเพิ่มดูหัวข้อ "เภสัชกรประจำสาขาท้ายฉลาก" ด้านล่าง
- **ผลวัดด้วยโค้ดจริง** (หัวฉลากยาวสุด = สวนเสือศรีราชา · ภาษาไทย 333 รายการ): ไม่มีชื่อลูกค้า 9.5pt 310 · 9pt 7 · 8.5pt 14 · เล็กกว่านั้น 2 · **ถูกตัด 0** (เดิม 5) · มีชื่อลูกค้า 9.5pt 274 · **ถูกตัด 2** (เดิม 70 — Mega Naprofazt / Mega Gogaz ข้อความยาวมาก หน้าเว็บเตือนแดง) · ภาษาอื่นดีขึ้นทั้งหมด (เช่น พม่า เดิม 54/197 → 2/3)
- 🚨 **ฟอนต์ Preview กับกระดาษเคยไม่ตรงกัน (แก้แล้ว)** — `.dl-page * { font-family: Noto Sans Thai }` (สำหรับ UI ของหน้า) กดลูกทุกตัวของฉลากใน Preview เป็น Noto Sans Thai ทั้งที่ `.dl-label` ตั้ง Sarabun · หน้าต่างพิมพ์ไม่มี `.dl-page` จึงพิมพ์ Sarabun (เฉพาะเครื่องที่ติดตั้งฟอนต์นี้ — เดิม Sarabun ไม่ได้โหลดจากเว็บเลย) → เพิ่ม `.dl-page .dl-label, .dl-page .dl-label * { font-family: Sarabun… }` (specificity สูงกว่า) + โหลด Sarabun จาก Google Fonts ใน `index.html` — ทุกเครื่องและทั้ง Preview/กระดาษเป็น Sarabun เหมือนกัน (ยืนยันด้วย CDP `CSS.getPlatformFontsForNode` ทั้ง 2 ฝั่ง)
- ทดสอบ: Playwright บนหน้า Label จริง 11/11 (ขนาด 9.5pt/8pt/9pt · ฉลากยาวลด + ข้อความแจ้ง · เปลี่ยนสาขาแล้ววัดใหม่ · เตือนแดง · ตัวพิมพ์ค่าเดียวกับ Preview) + จำลองหน้าต่างพิมพ์ด้วย HTML เดียวกับ `handlePrint` → ฟอนต์ Sarabun และไม่ล้น

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
- confirm dialog บอกจำนวน "เขียนทับ / เพิ่มใหม่ / ข้ามเพราะแปลแล้ว" แยกกัน · chunk ละ 500 ทุกขั้น

### 🚨 บทเรียนจากการนำเข้าผิดครั้งใหญ่ (2569-08-26) — guard 4 ชั้นที่ห้ามถอด

นำเข้า `ANIN LABEL MASTER.xlsx` ชีท `Data_Static` ครั้งเดียว → **เพิ่มแถวขยะ 2,695 แถว** (medicines 310 → 3,005) **และทับคำแปลไทยของ 204 แถวที่แปลครบ 6 ภาษาไว้แล้ว** · ต้นเหตุ: ชีทนั้นมีชื่อการค้าจริงอยู่ **คอลัมน์ B (`ITEMNAME`)** เช่น `Aerius 5 mg 10's` แต่ mapping ที่สั่งไว้ดึง **I+J** (`Itemshortname`+`Strength`) → ได้ `Desloratadine / 5 mg` · โค้ดทำถูกตามที่สั่ง — mapping ที่สั่งเองต่างหากที่ผิด

**กู้คืนด้วยสคริปต์ 3 ตัว** (รันตามลำดับ · ทุกตัว dry-run เป็น default ต้องใส่ `--confirm` ถึงเขียนจริง):
`label-backup.mjs` → `label-rollback-import.mjs` → `label-restore-th.mjs` (helper ร่วมอยู่ที่ `label-scripts-common.mjs`)
- ⚠️ สคริปต์เหล่านี้ **ต้องใช้ `VITE_SUPABASE_ANON_KEY`** — `SUPABASE_SERVICE_KEY` ได้ `permission denied for schema label` เพราะ `GRANT USAGE ON SCHEMA label` ให้แค่ `anon, authenticated` ไม่เคยให้ `service_role`
- `parseLabelWorkbook` ใน common **ต้องเหมือน `parseLabelSheet` ใน DrugLabelPage เป๊ะๆ** ถ้า key ต่างกันแม้นิดเดียว rollback จะชี้ผิดแถว
- ผลลัพธ์จริง: ลบ 2,695 · กู้ไทยเต็มรูปแบบ 101 แถวจาก `import-labels.sql` · กู้ **ชื่อการค้า** อีก 102 แถวจากคำแปลอังกฤษ (ตรวจแล้วชื่อการค้า th=en **167/167 = 100%** เพราะเป็นชื่อแบรนด์ไม่ได้แปล ส่วนชื่อยาตรงแค่ 86% จึงไม่กู้อัตโนมัติ) · เหลือ 103 แถวใน `label-restore-manual.csv`

**guard ที่ใส่ไว้ใน `handleLabelImport` แล้ว — ห้ามถอด:**
1. 🛡️ **ข้ามแถวที่มีคำแปลภาษาอื่น (`translatedIds`) โดยอัตโนมัติ** — แถวที่แปลแล้วคือของที่คนคัดและตรวจมาแล้ว ไฟล์นำเข้าห้ามทับ · ครั้งนั้นถ้ามี guard นี้จะกัน 204 แถวได้ทั้งหมด
2. 🔍 **preview "ของเดิม → ของใหม่" จริง 5 แถวแรกที่จะถูกทับ** (query ค่าปัจจุบันมาเทียบ) — ตัวอย่างที่อ่านจากไฟล์อย่างเดียว **ดู "ถูก" เสมอ** ต่อให้ mapping ผิดช่อง จึงจับบั๊กนี้ไม่ได้เลย
3. 💾 **ดาวน์โหลด `label-before-import-*.json` อัตโนมัติก่อนเริ่มเขียน** — ตารางไม่มี `created_at`/`updated_at` (ทั้งที่ `supabase-setup.sql` เขียนว่ามี) ย้อนด้วยเวลาไม่ได้ ไฟล์นี้คือทางเดียวที่กู้ค่าเดิมกลับได้
4. ⚠️ **แจ้งชัดว่าจะเปลี่ยน `usage_ref` ของแถวไหนบ้าง (เดิม→ใหม่)** — เส้นทาง `reuse` ที่แก้ `usage_ref` เงียบๆ คือสิ่งที่ทำลายคีย์เดิมจนกู้ยากที่สุด (ทำให้ `import-labels.sql` จับคู่ตรงๆ ได้แค่ 1/204 ต้องหันไปจับด้วย SKU แทน)
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
