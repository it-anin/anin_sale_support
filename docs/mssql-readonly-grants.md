# สิทธิ์ SQL Server ของบัญชีอ่านอย่างเดียว (`web_readonly`) — Agent Price / Stock / Pending

> เพิ่ม 2026-11-18 (Asia/Bangkok) หลังเหตุ Price Agent อ่าน ProMaxx ไม่ได้เพราะสิทธิ์ถูกถอน — ดู [บันทึกเหตุการณ์](#บันทึกเหตุการณ์-2026-11-18)

## สรุปสั้น

- Agent ทั้ง 3 ตัวบนเครื่องร้าน (**Pending, Stock, Price**) ใช้ login เดียวกันจากไฟล์ `.env` (`MSSQL_USER` — ตามคู่มือคือ `web_readonly`) และรวมกันต้องอ่าน **14 ตาราง**
- ใครแก้ `GRANT` / `REVOKE` / สร้าง user ใหม่ของ login นี้ (เช่น เอาไปใช้กับโปรเจ็คอื่น) จะกระทบ Agent ทั้ง 3 ตัวโดยไม่มีสัญญาณ: Pending/Stock ถาม ProMaxx เฉพาะตอนมีคนเปิดหน้า ส่วน Price ถามวันละครั้ง 08:00 น. และไม่ลองซ้ำเมื่อล้ม
- **หลังแก้สิทธิ์ของ login นี้ทุกครั้ง ให้รัน [query ตรวจสิทธิ์](#ตรวจสิทธิ์-อ่านอย่างเดียว) ก่อนปิดงาน**

## ตารางที่แต่ละ Agent ต้องอ่าน

อ้างอิงจาก SQL ในโค้ดจริง: `PRICE_SQL` ใน `price-agent.mjs`, `STOCK_SQL` ใน `stock-agent.mjs`, `TRANSFER_SQL` ใน `pending-docs-agent.mjs` — **แก้ SQL ของ Agent ตัวไหน ต้องแก้ตารางนี้ด้วย**

| ตาราง | Pending | Stock | Price | หมายเหตุ |
| --- | :---: | :---: | :---: | --- |
| `TRANS` | ✓ | ✓ | | |
| `VOUCHER` | ✓ | ✓ | | |
| `TRANDETAILITEM` | ✓ | ✓ | | |
| `WAREHOUSE` | ✓ | ✓ | | |
| `ITEMS` | ✓ | ✓ | ✓ | |
| `TRANEXTRAINFO` | ✓ | | | |
| `BRANCH` | ✓ | | | |
| `ITEMUNIT` | | ✓ | ✓ | |
| `UNITNAME` | | ✓ | ✓ | |
| `ITEMPRICELEVEL` | | ✓ | | Agent อ่านเฉพาะระดับ 0 แต่ `GRANT` ได้ทั้งตารางเท่านั้น (จำกัดแถวต้องสร้าง view ซึ่งห้ามทำใน ProMaxx) ตามหน้า Edit Price ระดับ 4 คือทุน ตารางนี้จึงน่าจะมีราคาทุนด้วย (ยังไม่ได้ตรวจเนื้อหาตาราง) |
| `ITEMPRICELEVELONBRANCH` | | ✓ | | เช่นเดียวกับ `ITEMPRICELEVEL` |
| `COMPANY` | | ✓ | | Stock อ่านคอลัมน์เดียวคือ `WORKSYSBRANCHID` (`stock-agent.mjs:82`) จึงให้สิทธิ์ระดับคอลัมน์ได้ |
| `ITEMBARCODE` | | | ✓ | |
| `ITEMGROUPL1` | | | ✓ | ใช้ดึงชื่อหมวด (`GROUPNAME`) |

รวม: Pending 7 · Stock 10 · Price 5 · ไม่ซ้ำกัน **14 ตาราง**

## ตรวจสิทธิ์ (อ่านอย่างเดียว)

เข้า SSMS ด้วยบัญชีเดียวกับที่อยู่ใน `.env` (`MSSQL_USER`) เลือกฐานข้อมูลของ ProMaxx แล้วรัน — เป็นการถามว่ามีสิทธิ์อะไร ไม่ได้ลองเขียน:

```sql
SELECT t.name AS table_name, t.used_by,
       HAS_PERMS_BY_NAME('dbo.' + t.name, 'OBJECT', 'SELECT') AS can_select
FROM (VALUES
  ('TRANS','Pending, Stock'),   ('VOUCHER','Pending, Stock'),
  ('TRANDETAILITEM','Pending, Stock'), ('WAREHOUSE','Pending, Stock'),
  ('ITEMS','Pending, Stock, Price'),   ('TRANEXTRAINFO','Pending'),
  ('BRANCH','Pending'),                ('ITEMUNIT','Stock, Price'),
  ('UNITNAME','Stock, Price'),         ('ITEMPRICELEVEL','Stock'),
  ('ITEMPRICELEVELONBRANCH','Stock'),  ('COMPANY','Stock'),
  ('ITEMBARCODE','Price'),             ('ITEMGROUPL1','Price')
) AS t(name, used_by)
ORDER BY can_select, t.name;
```

- ตารางที่ไม่ใช่ `1` จะอยู่บนสุด · `0` หรือ `NULL` = ยังไม่มีสิทธิ์ (หรือตารางไม่ได้อยู่ใน schema `dbo` — เช็กด้วย `SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '<ชื่อตาราง>';`)
- **`COMPANY` ขึ้น `0` เป็นเรื่องปกติ** เมื่อให้สิทธิ์ระดับคอลัมน์ เพราะตัวเช็กนี้ดูระดับตาราง ให้ยืนยันด้วย log ของ Stock Agent แทน (ดู [ทดสอบ Stock](#ทดสอบแต่ละ-agent))
- ⚠️ **ห้ามทดสอบสิทธิ์ด้วยการลองเขียนข้อมูลจริง**

## ให้สิทธิ์ (GRANT)

รันใน SSMS ด้วยบัญชี admin **ช่วงร้านปิดหรือคนน้อย** `GRANT` ซ้ำได้ไม่ error จึงรันทั้งชุดได้ทุกครั้ง แก้ `web_readonly` ให้ตรงกับ database user ของ `MSSQL_USER` (ไม่แน่ใจให้รัน `SELECT USER_NAME();` ในหน้าต่างที่ล็อกอินด้วยบัญชีนั้น):

```sql
SET LOCK_TIMEOUT 3000;
USE [<ชื่อฐานข้อมูลของ ProMaxx>];   -- ค่าเดียวกับ MSSQL_DATABASE ใน .env
GO
GRANT SELECT ON dbo.TRANS                     TO web_readonly;
GRANT SELECT ON dbo.VOUCHER                   TO web_readonly;
GRANT SELECT ON dbo.TRANDETAILITEM            TO web_readonly;
GRANT SELECT ON dbo.WAREHOUSE                 TO web_readonly;
GRANT SELECT ON dbo.ITEMS                     TO web_readonly;
GRANT SELECT ON dbo.TRANEXTRAINFO             TO web_readonly;
GRANT SELECT ON dbo.BRANCH                    TO web_readonly;
GRANT SELECT ON dbo.ITEMUNIT                  TO web_readonly;
GRANT SELECT ON dbo.UNITNAME                  TO web_readonly;
GRANT SELECT ON dbo.ITEMPRICELEVEL            TO web_readonly;
GRANT SELECT ON dbo.ITEMPRICELEVELONBRANCH    TO web_readonly;
GRANT SELECT ON dbo.COMPANY (WORKSYSBRANCHID) TO web_readonly;
GRANT SELECT ON dbo.ITEMBARCODE               TO web_readonly;
GRANT SELECT ON dbo.ITEMGROUPL1               TO web_readonly;
```

- `SET LOCK_TIMEOUT 3000` — `GRANT` ต้องขอล็อกตารางแป๊บเดียว ถ้าตารางกำลังถูกรายงานหนักอ่านอยู่ คำสั่งจะยกเลิกตัวเองหลัง 3 วินาที แทนที่จะรอจนคำสั่งของ POS ต้องต่อคิว · ขึ้น `Lock request time out period exceeded` → รอจังหวะแล้วรันเฉพาะบรรทัดที่ยังไม่ผ่านซ้ำ
- เป็นการให้สิทธิ์ "ผู้ใช้" อ่านอย่างเดียว ไม่ได้สร้างหรือแก้ตาราง ข้อมูล หรือ view ใน ProMaxx
- ถ้าถูก `DENY` ไว้ด้วย `GRANT` จะไม่ช่วย (`DENY` ชนะ) ให้ตรวจ `sys.database_permissions` ของตารางนั้น

## ทดสอบแต่ละ Agent

| Agent | วิธีทดสอบที่ใช้ได้จริง | สัญญาณผ่าน |
| --- | --- | --- |
| **Price** | `node price-agent.mjs --dry-run` (อ่านอย่างเดียว ไม่เขียน Supabase) แล้วกด Admin → **ดึงข้อมูลล่าสุด** | `Dry run: N products ...` และใน `price-agent.log` มีบรรทัด `Admin request ... — ...` |
| **Stock** | เปิดหน้า Stock บนเว็บหรือกดรีเฟรช แล้วดู `stock-agent.log` | `อ่านได้ N รายการ (… วิ) · คลังสินค้า … · SRC … · KKL … · SSS …` ตามด้วย `✅ ส่งชุดใหม่` หรือ `✓ ข้อมูลเหมือนเดิม ไม่ส่งซ้ำ` |
| **Pending** | เปิดหน้า Pending บนเว็บแล้วกด 🔄 | ตารางโหลดและไม่มีข้อความผิดพลาด |

⚠️ **`node stock-agent.mjs --dry-run` อาจไม่ได้ทดสอบอะไร:** Stock Agent ขอ lock ก่อนทุกโหมด (`acquireStockAgentLock` ใน `main()`) ถ้า Agent ตัวจริงเปิดค้างอยู่บนเครื่องเดียวกัน (ปกติเปิดพร้อม Pending) คำสั่งจะพิมพ์ `Stock Agent อีกตัวกำลังทำงานอยู่บนเครื่องนี้ — ไม่เปิดตัวซ้ำ` แล้วออกทันที **ข้อความนี้ไม่ได้แปลว่าผ่าน** — ให้ทดสอบผ่านหน้าเว็บ + `stock-agent.log` ตามตาราง (Price ไม่มี lock จึง `--dry-run` ได้เสมอ)

## อาการเมื่อสิทธิ์หาย (จะเห็นอะไร)

| ที่เห็น | แปลว่า |
| --- | --- |
| หน้า Price มีแถบแดง **"ตรวจราคาล้มเหลว"** | รอบล่าสุดของ Price Agent ล้ม หรือไม่ได้ตรวจสำเร็จเกิน 25 ชั่วโมง (รายละเอียดอยู่ใน tooltip ของแถบ) · popup 💰 Update Price จะไม่มีสินค้าที่ราคาเปลี่ยนของรอบนั้น |
| `price-agent.log` มี `RequestError EREQUEST: The SELECT permission was denied on the object '<ตาราง>', database '<ฐาน>', schema 'dbo'.` | ตารางที่ชื่อในข้อความนั้นยังไม่มีสิทธิ์ (SQL Server รายงานตารางแรกที่เจอเท่านั้น — แก้แล้วให้รันตรวจ 14 ตารางซ้ำ) |
| `stock-agent.log` มีบรรทัด `❌ ...` ที่มี `permission was denied` | Stock Agent อ่านไม่ได้ · หน้า Stock จะค้างที่ข้อมูลชุดล่าสุดที่ซิงค์สำเร็จ |
| หน้า Pending/Stock ขึ้นข้อความเครื่องในร้านผิดพลาด | ดู log ของ Agent นั้นบนเครื่องร้าน |

แบนเนอร์ **ไม่ใช่เครื่องมือตรวจสุขภาพของ Agent ทั้งหมด:** ถ้าหลัง Agent ล้มมีคนอัปโหลด R05.106 ผ่าน Admin (CSV) สำเร็จ ฐานข้อมูลจะถือว่าตรวจข้อมูลสดแล้ว (`last_checked_at` ใหม่ และล้าง `last_error`) แถบจะหายทั้งที่ Agent ยังอ่าน SQL Server ไม่ได้ — ปัญหาจะโผล่อีกครั้งตอนรอบ 08:00 ถัดไป หรือดูได้จาก `price-agent.log` เสมอ

## ความเสี่ยงของการใช้บัญชีเดียวร่วมกันหลายโปรเจ็ค

| ทางเลือก | ข้อดี | ข้อเสีย |
| --- | --- | --- |
| ใช้ `web_readonly` ร่วมกัน (ปัจจุบัน) | จัดการง่าย ไม่ต้องสร้างบัญชีเพิ่ม | แก้ของโปรเจ็คหนึ่งกระทบอีกโปรเจ็คแบบเงียบ ๆ และทุกโปรเจ็คที่ใช้บัญชีนี้อ่านได้ครบทั้ง 14 ตาราง รวมใบโอน ข้อมูลบริษัท และราคาทุกระดับ |
| **แยกบัญชีต่อโปรเจ็ค (แนะนำระยะยาว)** | แก้ฝั่งหนึ่งไม่ชนอีกฝั่ง และแต่ละโปรเจ็คอ่านได้เฉพาะตารางของตัวเอง | มีบัญชีและรหัสให้ดูแลเพิ่ม ต้องเปลี่ยนค่าเชื่อมต่อของโปรเจ็คที่ย้าย |

Agent ทั้ง 3 ตัวอ่านค่าเชื่อมต่อจาก `.env` ไฟล์เดียว (`buildMssqlConfig` ใน `mssql-readonly.mjs`) การคง `web_readonly` ไว้กับ Agent แล้วสร้างบัญชีใหม่ให้โปรเจ็คอื่น จึงไม่ต้องแก้ `.env` ที่เครื่องร้าน · สร้างบัญชีด้วยรูปแบบเดียวกับ [คู่มือ Pending](../วิธีติดตั้ง-agent-เอกสารค้าง.md) (`CREATE LOGIN` → `CREATE USER` → `GRANT SELECT` เฉพาะตารางที่โปรเจ็คนั้นใช้)

## บันทึกเหตุการณ์ 2026-11-18

- **อาการ:** popup 💰 Update Price ไม่มีสินค้าที่ราคาเปลี่ยนของวันนั้น
- **สาเหตุ:** วันที่ 17 พ.ย. มีการแก้ `GRANT` ของ `web_readonly` เพื่อใช้กับโปรเจ็คอื่น ทำให้ Agent เสียสิทธิ์ 4 ตาราง คือ `ITEMGROUPL1` (Price) กับ `COMPANY`, `ITEMPRICELEVEL`, `ITEMPRICELEVELONBRANCH` (Stock) ส่วนอีก 10 ตารางยังมีสิทธิ์ (ตารางทั้ง 5 ของ Price สร้างพร้อมกันเมื่อปี 2023 ไม่ได้ถูกสร้างใหม่) รอบ 08:00 ของ Price วันที่ 18 พ.ย. ได้ `The SELECT permission was denied on the object 'ITEMGROUPL1'` จึงไม่มีข้อมูลเข้า Supabase ไม่มีการเทียบราคา และไม่มี log ราคาเปลี่ยน
- **ทำไมไม่มีใครรู้:** Agent ไม่ลองซ้ำเมื่ออ่านล้ม (ตั้งใจ เพื่อไม่ถาม MSSQL ของ POS ซ้ำ) และหน้าเว็บไม่แสดงอะไร จนพนักงานเห็นว่า popup ว่าง
- **ตรวจพบจาก:** `price-agent.log` บรรทัดเดียว + query ตรวจสิทธิ์ 14 ตาราง (ตรวจฝั่ง DB แล้วพบว่าฟังก์ชันและ log ถูกต้อง สาเหตุไม่ได้อยู่ที่โค้ดหรือการเขียน log)
- **แก้:** `GRANT SELECT` 4 ตารางข้างต้น (`COMPANY` ระดับคอลัมน์ `WORKSYSBRANCHID`)
- **ยืนยัน:** Price `--dry-run` อ่านได้ 10,908 รายการ · Stock อ่านได้ 19,544 รายการแล้ว `✅ ส่งชุดใหม่` · Pending ตรวจสิทธิ์ครบทั้ง 7 ตาราง
- **มาตรการที่เพิ่ม:** แบนเนอร์ "ตรวจราคาล้มเหลว" ในหน้า Price (ดู [คู่มือ Price](../วิธีติดตั้ง-agent-ราคา.md)) · เอกสารนี้ · ข้อควรระวังเรื่อง `--dry-run` ของ Stock
