# วิธีติดตั้ง Agent หน้า "ตรวจสอบเอกสารค้าง"

หน้าเว็บ **ตรวจสอบเอกสารค้าง** แสดงใบโอนสินค้าออกที่สาขายังไม่กดปุ่ม **"ส่ง"** ใน SeniorSoft ProMaxx
(เทียบได้กับรายงาน R16.150 ตรงแถวที่ช่อง "ใบแจ้งโอน" ยังว่าง)

เว็บต่อ MSSQL ตรงไม่ได้ จึงต้องมีโปรแกรมเล็กๆ ชื่อ **Agent** (`pending-docs-agent.mjs`) รันค้างไว้ในเครื่องที่ร้าน:

```
เปิดหน้าเว็บ / กด 🔄 → ขอข้อมูลสดผ่าน Supabase → Agent ในร้านได้ยิน (ต่อออกอย่างเดียว)
            → SELECT จาก MSSQL → เทียบกับชุดที่อยู่บน Supabase
               - มีอะไรเปลี่ยน → ส่งชุดใหม่ขึ้น Supabase → หน้าเว็บอัปเดตเอง (~2-3 วิ)
               - เหมือนเดิม    → บันทึกแค่เวลาที่ตรวจ (หน้าเว็บไม่ต้องโหลดตารางใหม่)
Agent ตรวจ ProMaxx เองทุก 5 นาที · เปิดหน้าค้างไว้ หน้าเว็บไม่ได้ไปถาม ProMaxx เอง — รอให้ Agent ส่งของใหม่มา
```

> ทำไมไม่ให้ ProMaxx "บอก" เองตอนข้อมูลเปลี่ยน: ต้องเปิด Change Tracking หรือสร้าง Trigger ใน MSSQL = เขียนฐานข้อมูล ซึ่งห้าม
> Agent จึงต้อง "ไปถาม" ตามรอบ แต่ส่งข้อมูลขึ้นเว็บเฉพาะตอนมีการเปลี่ยนแปลง

> 🚨 **ห้ามเพิ่ม/แก้ไข/เปลี่ยนแปลงอะไรในฐานข้อมูล MSSQL ของ ProMaxx เด็ดขาด** — ข้อมูลต้องเปลี่ยนผ่านโปรแกรม ProMaxx เท่านั้น
> Agent ส่งได้แค่คำสั่ง `SELECT` (มีด่าน `assertReadOnlySql()` ในโค้ดกันไว้) และตอนรันจริงใช้ login ที่อ่านได้อย่างเดียว

---

## สิ่งที่ต้องมี

- **เครื่อง Windows ที่เปิด 24 ชม.** ในวงแลนเดียวกับเซิร์ฟเวอร์ ProMaxx — ต่อ MSSQL ได้ และออกอินเทอร์เน็ตได้ (ไปหา Supabase)
- **Node.js 20 ขึ้นไป** — เช็คด้วย `node -v` (วิธีติดตั้งดู `วิธีติดตั้ง-task-scheduler.md` ขั้นที่ 1)
- **โฟลเดอร์ repo นี้แบบ `git clone`** — ⚠️ ห้ามก๊อปไฟล์ `.mjs` ไปวางเดี่ยวๆ ที่อื่น อัปเดตด้วย `git pull` เท่านั้น
  (เคยมีบทเรียน: `upload-customer-history.mjs` มี 3 สำเนาที่โค้ดไม่ตรงกัน และตัวที่รันจริงคือตัวเก่า)
- **SSMS** (SQL Server Management Studio) สำหรับขั้นที่ 1 และ 5

> SQL Server เป็นรุ่น **Express** ใช้ได้ครบทุกขั้น · Express ไม่มี SQL Server Agent แต่เราไม่ได้ใช้ (ใช้ Task Scheduler ของ Windows แทน)
> ⚠️ Express มี CPU ≤ 4 core / RAM สำหรับ cache ~1.4 GB และใช้ร่วมกับ POS ทุกสาขา — จึงต้องจับเวลา query ในขั้นที่ 1.4

---

## ขั้นที่ 1 — สำรวจฐานข้อมูลใน SSMS (อ่านอย่างเดียว ไม่เปลี่ยนอะไร)

> ขั้นนี้ใช้แค่ SSMS ทำได้ทันที — **ยังไม่ต้องใช้ git / npm / node** (ติดตั้ง Agent ทีหลังในขั้นที่ 4)

เปิด SSMS → Connect:
- **Server name:** ตัวเดียวกับที่ ProMaxx ใช้ (เช่น `ชื่อเครื่อง\SQLEXPRESS`)
- **Authentication:** SQL Server Authentication → ใส่ login/รหัสเดิมที่ SeniorSoft ให้มา

ทุกคำสั่งในขั้นนี้รันแบบเดียวกัน: แถบซ้าย **Databases** → คลิกขวาฐานข้อมูลของ ProMaxx → **New Query** → วางคำสั่ง → กด **F5**

**1.1 รุ่นของ SQL Server**
```sql
SELECT @@VERSION;
```
ถ้าเป็น 2008 / 2012 ให้จดไว้ — อาจต้องตั้ง `MSSQL_ENCRYPT=false` (ดูตารางแก้ปัญหา)

**1.2 รหัสสาขา + คลัง** — เติมไว้ใน `WAREHOUSE_MAP` (`pending-docs-agent.mjs`) แล้ว ใช้ query นี้เช็คซ้ำเมื่อมีสาขา/คลังใหม่ใน ProMaxx
```sql
SELECT SYSBRANCHID, SYSWAREHOUSEID, NAME FROM WAREHOUSE ORDER BY SYSBRANCHID, SYSWAREHOUSEID;
```
| สาขา : คลัง | คลังใน ProMaxx | สาขาใน ProMaxx | บนเว็บ |
|---|---|---|---|
| 0 : 0 | Warehouse | อนิน สาขาแยกชากค้อ | **คลังสินค้า** |
| 0 : 1 | Front Store | อนิน สาขาแยกชากค้อ | **SRC** |
| 4 : 0 | Main KKL | อนิน สาขาเก้ากิโล | **KKL** |
| 5 : 0 | Main SSS | อนิน สาขาสวนเสือศรีราชา | **SSS** |
| 1 : 0 / 2 : 0 / 3 : 0 | Main ONN / Main WRD / Main KTK | ออนนุช / ตลาดเวิลด์มาร์เก็ต / กรุงเทพกรีฑา | ไม่แสดงใบที่โอนออกจากคลังเหล่านี้ (ถ้าเป็นปลายทาง แสดงชื่อสาขา) |

> 🚨 **เลขคลังซ้ำข้ามสาขา** (ทุกสาขามีคลังเลข 0) — ต้องดู `SYSBRANCHID` คู่กับ `SYSWAREHOUSEID` เสมอ
> ต้นทางแยกจากคลังที่ตัดสต๊อค (`TRANS.SYSWAREHOUSEID`) — ล็อกอิน SRC เห็นเฉพาะใบที่ออกจาก Front Store
> ปลายทางดูจากคลังปลายทางของใบ (`REFTRANFERSYSWAREHOUSE`) ถ้าใบไม่ระบุ ใช้สาขาแทน: สาขาแยกชากค้อ = **คลังสินค้า** (KKL/SSS โอนเข้า Warehouse เท่านั้น) · ใบที่โอนผิดกฎแสดงตามจริง ไม่มีป้ายเตือน
> มีสาขา/คลังใหม่ → เพิ่มใน `WAREHOUSE_MAP` + โปรไฟล์ใน `auth.ts` (แก้ใน repo แล้ว `git pull` ห้ามแก้ไฟล์ในเครื่อง Agent ตรงๆ)

**ตรวจเส้นทางโอนจริง** (ทำตอนติดตั้ง หรือเมื่อสงสัยว่าใบไปขึ้นผิดคน) — นับใบโอนออกย้อนหลัง 90 วัน ทั้งที่ส่งแล้วและยังไม่ส่ง แยกตามคลัง (อ่านอย่างเดียว ใช้ login `web_readonly` ได้):
```sql
DECLARE @days int = 90;
SELECT SRCWH.NAME  AS from_warehouse,
       DESTWH.NAME AS to_warehouse,
       COUNT(*)    AS all_docs,
       SUM(CASE WHEN REF.SYSTRANNO IS NULL THEN 1 ELSE 0 END) AS pending_docs
FROM TRANS
JOIN VOUCHER       ON VOUCHER.SYSVOUCHERID = TRANS.SYSVOUCHERID
JOIN TRANEXTRAINFO ON TRANEXTRAINFO.SYSTRANNO = TRANS.SYSTRANNO
LEFT JOIN TRANS REF ON REF.SYSTRANNO = TRANEXTRAINFO.SYSREFERENCETRANNO
LEFT JOIN WAREHOUSE SRCWH  ON SRCWH.SYSBRANCHID = TRANS.SYSBRANCHID
                          AND SRCWH.SYSWAREHOUSEID = TRANS.SYSWAREHOUSEID
LEFT JOIN WAREHOUSE DESTWH ON DESTWH.SYSBRANCHID = TRANEXTRAINFO.REFTRANFERSYSBRANCH
                          AND DESTWH.SYSWAREHOUSEID = TRANEXTRAINFO.REFTRANFERSYSWAREHOUSE
WHERE VOUCHER.VOUCHERTYPE = 'TB' AND VOUCHER.VOUCHERINOUT = 'O' AND TRANS.FCANCEL = 0
  AND TRANS.TRANDATE >= DATEADD(day, -@days, CAST(GETDATE() AS date))
GROUP BY SRCWH.NAME, DESTWH.NAME
ORDER BY SRCWH.NAME, DESTWH.NAME;
```
ผลตอนติดตั้ง (2569-10-27): `Main KKL → Warehouse 46` · `Main SSS → Warehouse 58` · `Warehouse → Main KKL 321` · `Warehouse → Main SSS 324` — **ไม่มีใบจาก Front Store เลย** และร้านยืนยันว่าคลังเป็นคนทำใบโอนออกทั้งหมด

> ล็อกอิน SRC จึงเห็นหน้าเอกสารค้าง**ว่างเป็นปกติ ไม่ใช่บั๊ก** · ถ้าวันหน้า Front Store โอนออกเอง ใบจะขึ้นเป็น SRC ให้เอง (`0:1 → SRC` อยู่ใน map แล้ว)

**1.3 หาคอลัมน์หน่วยสินค้า** (รายงาน R16.150 ไม่มีหน่วย — ถ้าเจอคอลัมน์ที่ใช่ ส่งชื่อให้ Claude เพิ่มใน popup)
```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('TRANDETAILITEM', 'ITEMS')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

**1.4 ทดลอง SQL ตัวจริง + จับเวลา** — SQL ตัวเดียวกับที่ Agent จะใช้ ก๊อปไปวางได้เลย:

<!-- sql-for-ssms: ต้องตรงกับ sqlForSsms(90) ใน pending-docs-agent.mjs ทุกตัวอักษร (npm run test:pending-docs เช็คให้) -->
```sql
SET STATISTICS TIME ON;
DECLARE @days int = 90;
SELECT TRANS.SYSTRANNO AS sys_tran_no,
       TRANS.TRANNO AS doc_no,
       CONVERT(char(10), TRANS.TRANDATE, 23) AS doc_date,
       TRANS.SYSBRANCHID AS from_branch_id,
       BRANCH.NAME AS from_branch_name,
       TRANS.SYSWAREHOUSEID AS from_warehouse_id,
       SRCWH.NAME AS from_warehouse_name,
       TRANEXTRAINFO.REFTRANFERSYSBRANCH AS to_branch_id,
       DEST.NAME AS to_branch_name,
       TRANEXTRAINFO.REFTRANFERSYSWAREHOUSE AS to_warehouse_id,
       DESTWH.NAME AS to_warehouse_name,
       TRANDETAILITEM.ORDINARY AS line_no,
       TRANDETAILITEM.SCANCODE AS item_code,
       TRANDETAILITEM.ITEMNAME AS item_name,
       TRANDETAILITEM.SERIALNO AS serial_no,
       TRANDETAILITEM.QUANTITY AS qty
FROM TRANS
JOIN VOUCHER ON VOUCHER.SYSVOUCHERID = TRANS.SYSVOUCHERID
JOIN TRANEXTRAINFO ON TRANEXTRAINFO.SYSTRANNO = TRANS.SYSTRANNO
JOIN BRANCH ON BRANCH.SYSBRANCHID = TRANS.SYSBRANCHID
JOIN TRANDETAILITEM ON TRANDETAILITEM.SYSTRANNO = TRANS.SYSTRANNO
JOIN ITEMS ON ITEMS.SYSITEMID = TRANDETAILITEM.SYSITEMID
LEFT JOIN BRANCH DEST ON DEST.SYSBRANCHID = TRANEXTRAINFO.REFTRANFERSYSBRANCH
LEFT JOIN WAREHOUSE SRCWH ON SRCWH.SYSBRANCHID = TRANS.SYSBRANCHID
                         AND SRCWH.SYSWAREHOUSEID = TRANS.SYSWAREHOUSEID
LEFT JOIN WAREHOUSE DESTWH ON DESTWH.SYSBRANCHID = TRANEXTRAINFO.REFTRANFERSYSBRANCH
                          AND DESTWH.SYSWAREHOUSEID = TRANEXTRAINFO.REFTRANFERSYSWAREHOUSE
WHERE VOUCHER.VOUCHERTYPE = 'TB'
  AND VOUCHER.VOUCHERINOUT = 'O'
  AND TRANS.FCANCEL = 0
  AND TRANS.TRANDATE >= DATEADD(day, -@days, CAST(GETDATE() AS date))
  AND NOT EXISTS (SELECT 1 FROM TRANS REF WHERE REF.SYSTRANNO = TRANEXTRAINFO.SYSREFERENCETRANNO)
ORDER BY TRANS.TRANDATE, TRANS.TRANNO, TRANDETAILITEM.ORDINARY
```
> อ่านอย่างเดียว — `SET STATISTICS TIME ON` แค่สั่งให้ SSMS บอกเวลา · `DECLARE @days` แค่ตั้งตัวแปร "ย้อนหลัง 90 วัน" ไม่มีอะไรถูกเขียนลงฐานข้อมูล

ดูผล 2 แท็บ:
- **Results** = ใบที่ยังไม่กด "ส่ง" · ⚠️ 1 ใบมีได้หลายแถว (1 แถว = สินค้า 1 รายการ) ดูเลขที่ใบที่คอลัมน์ `doc_no`
- **Messages** = เวลา บรรทัด `elapsed time = … ms` ควรไม่เกิน ~1000 ms ถ้าช้ากว่านี้ให้ลด `PENDING_TRANSFER_DAYS`

เทียบกับ R16.150 ใน ProMaxx (เลือกช่วงวันที่ให้ครอบคลุม 90 วันล่าสุด) แบบสุ่มตรวจ:
- ใบที่ช่อง **"ใบแจ้งโอน" ว่าง** 2-3 ใบ → ต้อง**เจอ**ในผล SQL
- ใบที่ช่อง "ใบแจ้งโอน" **มีเลขแล้ว** (เช่น ITFB…) 1-2 ใบ → ต้อง**ไม่เจอ**ในผล SQL
- ใบที่รู้ว่า **Front Store** เป็นคนทำ 1 ใบ → คอลัมน์ `from_warehouse_name` ต้องขึ้น `Front Store` (ใบของคลังต้องขึ้น `Warehouse`)
- `from_warehouse_name` ว่าง (NULL) = ใบนั้นไม่มีคลังต้นทาง → เว็บจะไม่แสดง ถ้าเจอให้แจ้ง Claude

> หลังทำขั้นที่ 4 แล้ว จะให้ Agent พิมพ์ SQL ชุดนี้ออกมาเองก็ได้: `node pending-docs-agent.mjs --print-sql` (ตัวเดียวกันทุกตัวอักษร)

**1.5 หาชื่อ instance / พอร์ต** — SQL Server Configuration Manager → SQL Server Network Configuration →
Protocols for `SQLEXPRESS` → TCP/IP → แท็บ IP Addresses → **IPAll** (หรือดูจากการตั้งค่าเชื่อมต่อของ ProMaxx)
- ติดตั้งแบบ named instance (เช่น `SQLEXPRESS`) → ใช้ `MSSQL_INSTANCE` และ service **SQL Server Browser** ต้องเปิดอยู่
- หรือใช้พอร์ตตายตัวจาก IPAll → ใช้ `MSSQL_PORT` แทน

---

## ขั้นที่ 2 — เตรียม Supabase

Supabase Dashboard → SQL Editor → วางไฟล์ **`pending-docs-setup.sql`** ทั้งไฟล์ → Run (รันซ้ำได้)

เช็คใน Table Editor: มีตาราง `pending_transfers` (ว่าง) และ `pending_docs_sync` (1 แถว)
> ปุ่ม **Pending** บนเว็บยังถูกซ่อน (`visible = false`) จนกว่าจะเปิดในขั้นที่ 8

---

## ขั้นที่ 3 — ตั้งค่า `.env` บนเครื่องที่จะรัน Agent

เปิดไฟล์ `.env` ในโฟลเดอร์ repo (ไฟล์เดียวกับที่ `upload-stock.mjs` ใช้ — ถูก gitignore แล้ว ไม่ขึ้น GitHub) แล้วเพิ่ม:

```
SUPABASE_SERVICE_KEY=<service_role key ตัวเดียวกับที่ upload-stock.mjs ใช้>
MSSQL_SERVER=<ชื่อเครื่องหรือ IP ของเซิร์ฟเวอร์ ProMaxx>
MSSQL_INSTANCE=SQLEXPRESS
MSSQL_DATABASE=<ชื่อฐานข้อมูลของ ProMaxx>
MSSQL_USER=<ช่วงทดสอบ: login เดิมจาก SeniorSoft>
MSSQL_PASSWORD=<รหัสของ login นั้น>
PENDING_TRANSFER_DAYS=90
```

- ไม่ได้ใช้ named instance → ลบบรรทัด `MSSQL_INSTANCE` แล้วใส่ `MSSQL_PORT=<เลขพอร์ตจาก IPAll>` แทน
- รหัสมีอักขระพิเศษ ใส่ในเครื่องหมายคำพูดได้ เช่น `MSSQL_PASSWORD="p@ss#1"`
- ⚠️ **ห้ามตั้งชื่อขึ้นต้นด้วย `VITE_`** — Vite จะฝังค่านั้นลงไฟล์ JS ของเว็บที่ใครก็เปิดอ่านได้

---

## ขั้นที่ 4 — ติดตั้งแพ็กเกจ + ทดสอบแบบอ่านอย่างเดียว

```
cd <โฟลเดอร์ repo>
git status
git pull origin master
npm ci
node pending-docs-agent.mjs --dry-run
```

- `git status` ต้องไม่มีไฟล์ `modified` — เครื่อง Agent ห้ามมีไฟล์ที่แก้เอง ไม่งั้น `git pull` ติด · ถ้าเจอ `package-lock.json` ค้าง (มักมาจาก `npm install` / `npm audit fix` รอบก่อน) คืนค่าด้วย `git checkout -- package-lock.json`
- ใช้ **`npm ci` ไม่ใช่ `npm install`** — `npm ci` ติดตั้งตาม `package-lock.json` เป๊ะและไม่แก้ไฟล์นั้น ส่วน `npm install` อาจเขียน `package-lock.json` ใหม่ตามรุ่น npm ของเครื่อง แล้ว `git pull` รอบหน้าจะติด
- `--dry-run` ใช้แค่ค่า `MSSQL_*` ใน `.env` (ยังไม่ต้องมี `SUPABASE_SERVICE_KEY`)

`--dry-run` อ่าน MSSQL อย่างเดียว **ไม่เขียน Supabase** แล้วสรุปให้ดู — เช็ค 4 อย่าง:
1. `รายการสินค้า N แถว` เท่ากับจำนวนแถวที่ SSMS ได้ในขั้นที่ 1.4 (บรรทัด `(N rows affected)` ในแท็บ Messages หรือมุมขวาล่าง `N rows`) — SQL ชุดเดียวกันจึงต้องเท่ากันเป๊ะ · ตัวเลขขยับได้ถ้ารันห่างกันแล้วสาขากด "ส่ง" ไปบางใบ ให้รันใน SSMS ซ้ำแล้วเทียบใหม่
2. ชื่อสินค้าภาษาไทยอ่านออก ไม่เป็น `???` หรือตัวอักษรเพี้ยน
3. วันที่ถูกต้อง ไม่เลื่อนวัน
4. ตาราง "คลังที่พบ" — `0:0 → คลังสินค้า` · `0:1 → SRC` · `4:0 → KKL` · `5:0 → SSS` · คลังของสาขา 1-3 ขึ้นว่าไม่อยู่ใน map (ใบที่โอนออกจากคลังพวกนี้ไม่แสดง ตามตั้งใจ) · บรรทัด "เส้นทาง" ต้องดูสมเหตุสมผล เช่น `KKL → คลังสินค้า` · ถ้าเจอคีย์ `0:?` = ใบของสาขาแยกชากค้อที่ไม่มีคลัง ให้แจ้ง Claude

---

## ขั้นที่ 5 — สลับเป็น login อ่านอย่างเดียว (ทำก่อนตั้งให้รันค้าง 24 ชม.)

ทำไมต้องสลับ: login เดิมจาก SeniorSoft มักแก้ข้อมูลได้ ถ้ารหัสใน `.env` หลุดไป คนที่ได้รหัสจะแก้ข้อมูล POS ได้
login ใหม่นี้ **อ่านได้แค่ 7 ตารางที่ Agent ใช้** (6 ตารางของ R16.150 + `WAREHOUSE` ไว้แยกคลัง) ฐานข้อมูลบล็อกการเขียนให้เองแม้โค้ดมีบั๊ก
และเป็นการเพิ่ม "ผู้ใช้" เท่านั้น ไม่ได้แตะตารางหรือข้อมูลของ ProMaxx (ถ้าไม่อยากทำเอง ขอ SeniorSoft ว่า "ขอ user อ่านอย่างเดียวสำหรับทำรายงาน")

> ไม่ใช้ Windows Authentication แทน: ตัวเชื่อม `tedious` ของ Agent ทำได้แค่แบบ NTLM ที่ต้องเก็บรหัส Windows ไว้ใน `.env` และ Agent จะได้สิทธิ์เท่าผู้ใช้ Windows นั้น ซึ่งถ้าใช้จัดการ SQL Server อยู่มักเป็น admin

รันใน SSMS ด้วยสิทธิ์ admin (login เดิมของ SeniorSoft มักทำได้ เช่น `sa`) **ช่วงร้านปิดหรือคนน้อย** และไม่มีใครเปิดรายงานใหญ่ใน ProMaxx:
```sql
SET LOCK_TIMEOUT 3000;
CREATE LOGIN web_readonly
  WITH PASSWORD = N'<ตั้งรหัสใหม่ยาวๆ>',
       DEFAULT_DATABASE = [<ชื่อฐานข้อมูลของ ProMaxx>],
       CHECK_POLICY = ON;
GO
USE [<ชื่อฐานข้อมูลของ ProMaxx>];
GO
CREATE USER web_readonly FOR LOGIN web_readonly;
GRANT SELECT ON dbo.TRANS          TO web_readonly;
GRANT SELECT ON dbo.VOUCHER        TO web_readonly;
GRANT SELECT ON dbo.TRANEXTRAINFO  TO web_readonly;
GRANT SELECT ON dbo.TRANDETAILITEM TO web_readonly;
GRANT SELECT ON dbo.BRANCH         TO web_readonly;
GRANT SELECT ON dbo.ITEMS          TO web_readonly;
GRANT SELECT ON dbo.WAREHOUSE      TO web_readonly;
```
- แทนที่ `<ตั้งรหัสใหม่ยาวๆ>` **รวม `< >`** ด้วยรหัสใหม่ คง `N'` กับ `'` ไว้ · 12 ตัวขึ้นไป ผสมพิมพ์ใหญ่/เล็ก/ตัวเลข/สัญลักษณ์ (`! @ # % _ -`) · **ห้ามมี `'` `"` หรือช่องว่าง** · อย่าใช้รหัสเดียวกับ admin
- แทนที่ `<ชื่อฐานข้อมูลของ ProMaxx>` 2 ที่ ด้วยค่าเดียวกับ `MSSQL_DATABASE` ใน `.env` (คงวงเล็บ `[ ]` ไว้)
- `SET LOCK_TIMEOUT 3000` — GRANT ต้องขอล็อกตารางแป๊บเดียว ถ้าตารางกำลังถูกรายงานหนักๆ อ่านอยู่ คำสั่งจะยกเลิกตัวเองหลัง 3 วิ แทนที่จะรอจนคำสั่งของ POS ต้องต่อคิว (มีผลแค่หน้าต่าง query นี้)
- ขึ้น `Lock request time out period exceeded` → รอจังหวะแล้วรัน**เฉพาะบรรทัด GRANT** ซ้ำ (GRANT ซ้ำได้ไม่ error · `CREATE LOGIN` / `CREATE USER` ห้ามรันซ้ำ)
- ไม่ได้เปิด `CHECK_EXPIRATION` → รหัสไม่หมดอายุ Agent ไม่หยุดทำงานกะทันหันเพราะรหัสหมดอายุ
- สร้าง login ไม่แตะข้อมูลหรือโครงสร้างตารางของ ProMaxx และไม่ต้องรีสตาร์ทอะไร · เสร็จแล้วปิดหน้าต่าง query แบบ **Don't Save** ไม่ให้รหัสค้างเป็นไฟล์ `.sql`

> ตารางไม่ได้อยู่ใน schema `dbo` → เช็คด้วย `SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TRANS';` แล้วเปลี่ยน `dbo.` ตามนั้น

**ตรวจสิทธิ์** — Object Explorer → Connect → Database Engine… → SQL Server Authentication ด้วย `web_readonly` → คลิกขวาฐานข้อมูลของ ProMaxx → New Query → รัน (อ่านอย่างเดียว แค่ถามว่ามีสิทธิ์อะไร ไม่ได้ลองเขียน):
```sql
SELECT t.name AS table_name,
       HAS_PERMS_BY_NAME('dbo.' + t.name, 'OBJECT', 'SELECT') AS can_select,
       HAS_PERMS_BY_NAME('dbo.' + t.name, 'OBJECT', 'INSERT') AS can_insert,
       HAS_PERMS_BY_NAME('dbo.' + t.name, 'OBJECT', 'UPDATE') AS can_update,
       HAS_PERMS_BY_NAME('dbo.' + t.name, 'OBJECT', 'DELETE') AS can_delete
FROM (VALUES ('TRANS'), ('VOUCHER'), ('TRANEXTRAINFO'), ('TRANDETAILITEM'),
             ('BRANCH'), ('ITEMS'), ('WAREHOUSE')) AS t(name);
```
ต้องได้ `can_select = 1` ครบ 7 แถว และอีก 3 ช่องเป็น `0` · `can_select` เป็น `0` หรือ `NULL` = ตารางนั้นยังไม่ได้ GRANT · ⚠️ **ห้ามทดสอบด้วยการลองเขียนข้อมูลจริง**

จากนั้นแก้ `.env` 2 บรรทัด (แทนที่ของเดิม ไม่ต้องเก็บรหัส admin ไว้ในไฟล์ · ใน `.env` ไม่มี `N` และใช้ `"` ครอบแทน `'`):
```
MSSQL_USER=web_readonly
MSSQL_PASSWORD="<รหัสใหม่>"
```
แล้วรัน `node pending-docs-agent.mjs --dry-run` ซ้ำ ผลต้องเหมือนขั้นที่ 4

เลิกใช้เมื่อไรก็ได้ (ไม่กระทบ POS):
```sql
USE [<ชื่อฐานข้อมูลของ ProMaxx>];
DROP USER web_readonly;
GO
DROP LOGIN web_readonly;
```

---

## ขั้นที่ 6 — ซิงค์ขึ้น Supabase รอบแรก

```
node pending-docs-agent.mjs --once
```
ขึ้น `✅ ซิงค์รอบเดียว (--once) — ส่งชุดใหม่ขึ้นเว็บแล้ว · ใบโอนค้างส่ง N ใบ` → เปิด Supabase Table Editor ดูตาราง `pending_transfers` ต้องมีข้อมูล
> `--once` ส่งทั้งชุดขึ้นไปเสมอแม้ไม่มีอะไรเปลี่ยน — ใช้เป็นปุ่ม "บังคับส่งใหม่" ได้ ถ้าสงสัยว่าข้อมูลบนเว็บไม่ตรงกับ ProMaxx

---

## ขั้นที่ 7 — ตั้ง Task Scheduler ให้ Agent รันค้างตลอด

1. เปิด **Task Scheduler** → **Create Task...** (ไม่ใช่ Create Basic Task)
2. แท็บ **General** — Name: `ANIN Pending Docs Agent` · เลือก **Run whether user is logged on or not**
3. แท็บ **Triggers** → New → Begin the task: **At startup** (ติ๊ก Delay task for: 1 minute เผื่อเน็ตยังไม่พร้อม)
4. แท็บ **Actions** → New → Start a program
   - Program/script: `<โฟลเดอร์ repo>\run-pending-docs-agent.bat`
   - Start in: `<โฟลเดอร์ repo>`
5. แท็บ **Settings**
   - ❌ **เอาติ๊กออก: "Stop the task if it runs longer than 3 days"** — ค่าเริ่มต้นนี้จะฆ่า Agent ทุก 3 วัน
   - If the task is already running: **Do not start a new instance**
6. OK → ใส่รหัส Windows → คลิกขวาที่ Task → **Run** (เริ่มเลยไม่ต้องรีสตาร์ทเครื่อง)
7. เปิด `pending-docs-agent.log` ในโฟลเดอร์ repo ต้องเห็น `🔌 ต่อ Supabase Realtime แล้ว — รอคำขอจากหน้าเว็บ`
   - หลังจากนั้นทุก ~5 นาทีจะมีบรรทัด `✓ ตรวจตามรอบทุก 5 นาที — ไม่มีอะไรเปลี่ยน ไม่ได้ส่งซ้ำ` = ปกติ
   - `✅ … ข้อมูลเปลี่ยน ส่งชุดใหม่ขึ้นเว็บแล้ว` = มีใบใหม่ / สาขากด "ส่ง" / แก้รายการ → หน้าเว็บอัปเดตเอง

> `run-pending-docs-agent.bat` เปิด Agent ใหม่เองภายใน 10 วิถ้าหยุดหรือล้ม · Agent เองก็ปิดตัวให้ .bat เปิดใหม่ถ้า Realtime หลุดเกิน 10 นาที
> ⚠️ ตั้ง Task นี้ **เครื่องเดียวพอ** — 2 เครื่องรันพร้อมกันจะถาม MSSQL ซ้ำเป็น 2 เท่าโดยไม่ได้อะไรเพิ่ม

---

## ขั้นที่ 8 — เปิดปุ่มบนหน้าเว็บ

หลังโค้ดเว็บขึ้น master แล้ว (Vercel deploy อัตโนมัติ ~90 วิ) รันใน Supabase SQL Editor:
```sql
update app_page_settings set visible = true, updated_at = now() where page_id = 'pendingdocs';
```

---

## เช็คว่าทำงานครบ

- [ ] เปิดหน้า Pending → ป้าย `กำลังดึงข้อมูลล่าสุด…` → ภายใน 2-3 วิ เปลี่ยนเป็น `ข้อมูล ณ ...`
- [ ] กด "ส่ง" ใบหนึ่งใน ProMaxx → เปิดหน้าใหม่/กด 🔄 → ใบนั้นหายภายใน 2-3 วิ
- [ ] เปิดหน้าค้างไว้ไม่แตะอะไร → ป้ายไม่หมุนเอง ตารางไม่กระพริบ (เวลาใน `ข้อมูล ณ` ขยับเงียบๆ ทุก ~5 นาที)
- [ ] เปิดหน้าค้างไว้ → สาขากด "ส่ง" อีกใบ → ใบนั้นหายเองภายใน ~5 นาที (อยากเห็นทันทีกด 🔄)
- [ ] ล็อกอิน SRC เห็นเฉพาะใบที่ออกจาก Front Store (**ปกติว่าง** — Front Store ไม่โอนออก ดูขั้น 1.2) · KKL/SSS เห็นเฉพาะของตัวเอง · คลังสินค้า/จัดซื้อเห็นทุกใบ (แท็บ คลังสินค้า / SRC / KKL / SSS) · Sale Admin เห็นข้อความว่าใช้ไม่ได้
- [ ] หยุด Task ใน Task Scheduler → กด 🔄 → ภายใน 15 วิ ป้ายขึ้น `⚠️ เครื่องในร้านไม่ตอบ` แต่ตารางเดิมยังอยู่ (เปิดค้างไว้เฉยๆ ป้ายนี้ขึ้นเองภายใน ~8 นาที) — เสร็จแล้วอย่าลืม Run กลับ

---

## อัปเดต Agent เมื่อมีโค้ดใหม่

1. ถ้า Claude บอกว่ารอบนี้ต้องรัน SQL → Supabase SQL Editor → วาง **`pending-docs-setup.sql`** ทั้งไฟล์ → Run **ก่อน** (รันซ้ำได้ ไม่ทับข้อมูล)
2. ที่เครื่อง Agent: `git status` (ต้องไม่มีไฟล์ modified) → `git pull origin master` → `npm ci`
3. รีสตาร์ท Agent ให้โหลดโค้ดใหม่: Task Scheduler → คลิกขวาที่ Task → **End** → คลิกขวาอีกครั้ง → **Run**
4. เปิด `pending-docs-agent.log` ต้องเห็น `▶ เริ่ม Agent เอกสารค้าง (รันค้าง)` เวลาล่าสุด ตามด้วย `🔌 ต่อ Supabase Realtime แล้ว`

> ⚠️ ถ้า `git pull` ก่อนรัน SQL แล้ว log ขึ้น `ตาราง pending_docs_sync ยังเป็นรุ่นเก่า` — ไม่ต้องแตะเครื่อง Agent แค่ไปรัน SQL ข้อ 1 Agent จะลองใหม่เองทุก 10 วิแล้วทำงานต่อ

---

## แก้ปัญหาเบื้องต้น

ดูรายละเอียดเต็มใน `pending-docs-agent.log` — บนหน้าเว็บจะโชว์แค่ข้อความสั้น (ตั้งใจไม่โชว์ชื่อเครื่อง/IP เพราะข้อมูลบน Supabase อ่านได้ด้วย anon key ที่เป็นสาธารณะ)

| ข้อความ / อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `ต่อ MSSQL ไม่ได้` / `ต่อ MSSQL ไม่ทัน` | ชื่อเครื่อง/พอร์ตผิด, เซิร์ฟเวอร์ปิด, firewall, TCP/IP ปิดอยู่ | เช็ค `MSSQL_SERVER` และ `MSSQL_INSTANCE`/`MSSQL_PORT` (ขั้นที่ 1.5) |
| `หา instance ของ SQL Server ไม่เจอ` | service SQL Server Browser ปิด หรือ UDP 1434 โดน firewall | เปิด SQL Server Browser หรือเลิกใช้ `MSSQL_INSTANCE` แล้วใส่ `MSSQL_PORT` จาก IPAll |
| `MSSQL ปฏิเสธการล็อกอิน` | ชื่อผู้ใช้/รหัสใน `.env` ผิด | เช็คการสะกด / เครื่องหมายคำพูดครอบรหัส |
| log มีคำว่า `ssl`, `tls`, `wrong version number` | SQL Server รุ่นเก่ารองรับแค่ TLS 1.0 | ใส่ `MSSQL_ENCRYPT=false` · ถ้าเป็น 2008 แล้วยังไม่ได้ ใส่ `MSSQL_TDS_VERSION=7_3_B` เพิ่ม |
| `login นี้ไม่มีสิทธิ์อ่านตารางที่ต้องใช้` | `GRANT SELECT` ไม่ครบ 7 ตาราง (ที่ลืมบ่อยคือ `WAREHOUSE`) | GRANT ให้ครบตามขั้นที่ 5 |
| `คำสั่ง SQL ผิดพลาด` + log มี `Invalid object name` | ชื่อฐานข้อมูลหรือ schema ไม่ตรง | เช็ค `MSSQL_DATABASE` / schema (ขั้นที่ 5) |
| ชื่อสินค้าเป็น `???` หรือตัวอักษรเพี้ยน | collation ของคอลัมน์ไม่ใช่ภาษาไทย | ส่งตัวอย่างให้ Claude แก้ใน SQL ฝั่ง Agent (ไม่แตะฐานข้อมูล) |
| `อ่านตาราง pending_docs_sync ไม่ได้` | ยังไม่ได้รัน `pending-docs-setup.sql` หรือเน็ตยังไม่พร้อม | ทำขั้นที่ 2 · ถ้าเป็นตอนเปิดเครื่อง .bat จะลองใหม่เองทุก 10 วิ |
| `ตาราง pending_docs_sync ยังเป็นรุ่นเก่า` (ขึ้นซ้ำทุก 10 วิ) | `git pull` โค้ด Agent รุ่นใหม่แล้ว แต่ยังไม่ได้รัน `pending-docs-setup.sql` รุ่นใหม่ | รัน `pending-docs-setup.sql` ใน Supabase อีกรอบ — Agent ทำงานต่อเองภายใน 10 วิ |
| query ช้ากว่า 1 วิ (`--dry-run` เตือน) | ใบเยอะ / Express ทรัพยากรจำกัด | ลด `PENDING_TRANSFER_DAYS` เช่น 30 |
| หน้าเว็บขึ้น "เครื่องในร้านไม่ตอบ" ตลอด | Agent ไม่ได้รัน หรือเน็ตร้านหลุด | ดูสถานะใน Task Scheduler + `pending-docs-agent.log` |
| log ขึ้น `⚠️ Realtime ...` / `🔁 ... ปิดตัวเอง` ซ้ำๆ | firewall/proxy ของร้านบล็อก websocket (`wss://` พอร์ต 443) ไป `*.supabase.co` | อนุญาต websocket ไป Supabase · ระหว่างนี้ข้อมูลยังอัปเดตจากรอบตรวจทุก 5 นาที แต่กด 🔄 แล้วจะไม่สดทันที |
| ใบของสาขา/คลังใหม่ไม่ขึ้นบนเว็บเลย | คลังนั้นไม่อยู่ใน `WAREHOUSE_MAP` (log ✅ บอก `ไม่แสดงคลังนอก WAREHOUSE_MAP N ใบ`) | เพิ่ม `สาขา:คลัง` ใน `WAREHOUSE_MAP` + โปรไฟล์ใน `auth.ts` (ขั้นที่ 1.2) |
| `Cannot find package 'mssql'` | ยังไม่ได้ติดตั้งแพ็กเกจหลัง `git pull` | `npm ci` (ขั้นที่ 4) |
| `git pull` ขึ้น `Your local changes … would be overwritten` | มีไฟล์ในเครื่อง Agent ถูกแก้ (มักเป็น `package-lock.json` จาก `npm install`) | `git checkout -- package-lock.json` แล้ว `git pull` ใหม่ · ต่อไปใช้ `npm ci` |

### หมายเหตุ `npm audit`
`npm audit` จะแจ้งช่องโหว่ระดับ high ใน `@azure/msal-node` ซึ่งติดมากับ `tedious` (ตัวขับ MSSQL ของ `mssql`)
ช่องโหว่นี้อยู่ในขั้นตอนล็อกอินแบบ Azure AD เท่านั้น Agent ใช้ SQL Server Authentication จึงไม่เคยเรียกส่วนนั้น
ตอนนี้ยังไม่มีเวอร์ชันแก้ในช่วงที่ `tedious` รองรับ — ⚠️ **ห้ามรัน `npm audit fix --force`** มันจะอัปเกรด `vite` ข้ามเวอร์ชันหลัก
(ทำให้ build เว็บพังได้) และก็ยังแก้ช่องโหว่ Azure นี้ไม่ได้อยู่ดี
