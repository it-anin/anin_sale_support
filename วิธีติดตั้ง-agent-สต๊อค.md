# Stock สดจาก ProMaxx — ใช้งานเหมือน Pending

เปิดหน้า Stock / กด **ดึงข้อมูลล่าสุด** → Supabase ส่งคำขอ → `stock-agent.mjs` ในร้านอ่าน ProMaxx ด้วย SELECT → บันทึก snapshot → หน้าเว็บอัปเดตผลค้นหาที่เปิดอยู่เอง ไม่ต้อง Export CSV จาก ProMaxxReport อีก

Agent ใช้สูตรจาก `R01.102.REP` (`d_01102_classic_p22112018`) และบัญชีอ่านอย่างเดียวชุดเดียวกับ Pending เครื่องในร้านเป็นฝ่ายเชื่อมต่อออกไป Supabase ไม่ต้องเปิดพอร์ตเข้าร้าน

## อัปเดตรุ่นแก้ statement timeout (เครื่องที่ติดตั้งแล้ว)

ใช้ไฟล์ใหม่เพียง `stock-sync-setup.sql` และ `stock-agent.mjs` ตามลำดับนี้:

1. **End Task Agent เดิมก่อน** และ Disable Task Stock แยกถ้าเคยสร้างไว้ ปิดหน้าต่าง CMD/PowerShell ที่เปิด `node stock-agent.mjs` หรือ `.bat` ค้างเองด้วย เพื่อหยุด Agent รุ่นเก่าที่ไม่มีตัวกันเปิดซ้ำ
2. ตรวจโปรเซสที่ยังค้างด้วย PowerShell:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match '(?:^|[\\/\s"])(?:stock-agent|pending-docs-agent|promaxx-agents)\.mjs(?:\s|"|$)' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

ถ้ายังพบ Agent หลัง End Task/ปิดหน้าต่าง ให้หยุดเฉพาะ PID ของ Agent นั้น เช่น `Stop-Process -Id 12345 -Force` โดยใช้เลขจริงที่ตรวจพบ แล้วตรวจซ้ำให้ไม่มี Agent ค้างก่อนทดสอบ

3. ใน Supabase โครงการของเว็บ รัน **`stock-sync-setup.sql` รุ่นใหม่ทั้งไฟล์** จะเปลี่ยน RPC เดิมเป็นการเทียบและเขียนเฉพาะรายการที่เปลี่ยน เพิ่ม unique index `(branch, sku)` และตั้ง `stock_sync.sync_version = 2` โดยคงข้อมูล/ID เดิม ถ้าพบ SKU ซ้ำในตารางเดิมจะหยุดและเก็บข้อมูลไว้ ให้ตรวจสาเหตุก่อนรันต่อ
4. วาง `stock-agent.mjs` ใหม่ทับในโฟลเดอร์ Pending เดิม ใช้ `.env`/แพ็กเกจ runtime เดิมได้ จากนั้นทดสอบหนึ่งรอบตอน Task ยังหยุดอยู่:

```powershell
node stock-agent.mjs --once
```

5. เมื่อสำเร็จ **Run Task Pending เดิมเพียง Task เดียว** (`run-pending-docs-agent.bat` → เปิด Pending + Stock) แล้วเปิดหน้า Stock/กดดึงข้อมูลล่าสุด

Agent รุ่นใหม่ใช้ named pipe ของ Windows (Linux ใช้ abstract socket) กันเปิดซ้ำบนเครื่องเดียวกัน แม้เปิดจากคนละโฟลเดอร์ OS ปล่อยตัวกันซ้ำเมื่อโปรเซสออกหรือถูกปิดกะทันหัน ไม่มีไฟล์ lock ค้าง ไม่มีพอร์ต TCP เพิ่ม หาก log ขึ้น `Stock Agent อีกตัวกำลังทำงานอยู่` แปลว่ายังมีตัวอื่นอยู่ ให้ตรวจ Task/โปรเซส ไม่ต้องเปิดเพิ่ม

Log รุ่นนี้มี `[PID …]` ทุกบรรทัด และแยกข้อความ timeout/งานชนกัน ช่วยแยกโปรเซสจริงจากบรรทัด log ที่ถูก redirect ซ้ำได้ Agent จะตรวจ `sync_version` ก่อนแตะ ProMaxx จึงต้องรัน SQL ใหม่ก่อนเริ่ม Agent ใหม่

## ล้าง Agent เก่าที่เปิดซ้ำหลังติดตั้งรุ่นแก้แล้ว

ถ้า log ยังมีทั้งบรรทัดรุ่นใหม่ `[PID …]` และรุ่นเก่าที่ไม่มี PID หรือพบ `promaxx-agents.mjs` หลายตัว แม้ Task `ANIN Pending Docs Agent` ตั้ง `IgnoreNew` แล้ว ให้ใช้ [repair-promaxx-agents.mjs](repair-promaxx-agents.mjs) ล้างโปรเซสที่ค้างหนึ่งครั้ง ไฟล์นี้ไม่ต้องติดตั้งแพ็กเกจเพิ่ม

วางไฟล์ใน `C:\Users\AninMainPC\Automation\anin_sale_support` เปิด **PowerShell → Run as administrator** แล้วรันบรรทัดเดียว:

```powershell
node "C:\Users\AninMainPC\Automation\anin_sale_support\repair-promaxx-agents.mjs" --apply
```

ตัวช่วยตรวจ Task/สิทธิ์และโปรเซสก่อน หยุด Task เดิมชั่วคราว ปิดตัว Agent และ CMD ที่เปิด Agent ซ้ำ แล้วเริ่ม Task เดิมครั้งเดียว ไม่แก้ Task settings, `.env`, MSSQL หรือข้อมูล Supabase ไม่ปิด Node ของแอปอื่น หากตรวจพบโปรแกรมอื่นอยู่ใน CMD เดียวกันจะหยุดขั้นตอนให้ตรวจเองก่อน

รอประมาณ 15–30 วินาที ผลท้ายควรเป็น `OK: one launcher + one Pending + one Stock.` ถ้าเป็น `ERROR` ให้เก็บผลลัพธ์ทั้งหมดไว้ตรวจ ไม่ต้องเปิด `.bat` หรือ Agent เพิ่มเอง ทดสอบแบบอ่านอย่างเดียวได้โดยเอา `--apply` ออก

หลังล้างสำเร็จใช้ Task เดิมตามปกติ ไม่ต้องรันตัวช่วยนี้ทุกวัน และไม่เปิด `node stock-agent.mjs` หรือ `.bat` เพิ่มคู่กับ Task

## 1. ตรวจสูตรและสิทธิ์อ่าน ProMaxx

ใช้ Node.js 22.13 ขึ้นไป (แนะนำ LTS) ในโฟลเดอร์ repo ที่เครื่อง Pending Agent ใช้งานอยู่:

```powershell
npm ci
node stock-agent.mjs --print-sql
```

นำ SQL ที่พิมพ์ออกมาทดลองใน SSMS แล้วเทียบกับรายงาน R01.102 ที่เลือก 4 คลังเดียวกัน ทดสอบตอน POS ไม่เปลี่ยนยอดหรือเทียบ SKU ตัวอย่างในเวลาใกล้กัน:

| ข้อมูล | กฎจากรายงาน |
| --- | --- |
| จำนวน | `SUM(TRANDETAILITEM.BASEQUANTITY * VOUCHER.FSTOCKMAIN)` สะสมทั้งหมด **ไม่จำกัดวันที่** |
| รายการที่นับ | `FTaxInvoiceReplacement = 0`, `FVoidTaxInvoice = 0`, `FSTOCKMAIN <> 0`, `FPROCESS = 1`, `FCANCEL = 0`, `FAPPROVE = 1` |
| สินค้าที่นับ | `FEFFECTSTOCK = 1`, `FSHOWONREPORT = 1`, `FUSED = 1`; ยกเว้น `DEPOSIT`, `DEPOSIT-NV` |
| ศูนย์/ติดลบ | รวมตามรายงาน; ข้ามเฉพาะยอด `NULL` |
| หน่วย | `ITEMUNIT.MULTIPLE = 1` → `UNITNAME` |
| ราคา | `CF_PRICE`: `FONEPRICEALLBRANCH = 1` ใช้ `ITEMPRICELEVEL` ระดับ 0; ค่า 0 ใช้ `ITEMPRICELEVELONBRANCH` ของ `COMPANY.WORKSYSBRANCHID` ตามรายงาน |
| คลัง | `0:0 → คลังสินค้า`, `0:1 → SRC`, `4:0 → KKL`, `5:0 → SSS` (ใช้เลขสาขาคู่กับเลขคลัง) |

ตารางที่ Agent ต้องอ่าน: `TRANS`, `TRANDETAILITEM`, `VOUCHER`, `ITEMS`, `WAREHOUSE`, `ITEMUNIT`, `UNITNAME`, `ITEMPRICELEVEL`, `ITEMPRICELEVELONBRANCH`, `COMPANY` บัญชี `web_readonly` ของ Pending อาจยังไม่มีสิทธิ์ SELECT ตารางสินค้าหรือราคา ให้ผู้ดูแลตรวจและเพิ่มเฉพาะสิทธิ์อ่านตารางที่ขาด

**ไม่สร้าง/แก้ไขตาราง, view, index, trigger หรือข้อมูลใน ProMaxx และไม่ทดลองเขียนเพื่อทดสอบสิทธิ์** Query ของ Agent เป็น SELECT เดียวและตรวจด้วย `assertReadOnlySql()` ก่อนส่งทุกครั้ง

ใช้ค่า `.env` เดิมของ Pending: `MSSQL_SERVER`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` และ `MSSQL_INSTANCE` หรือ `MSSQL_PORT` พร้อมค่า TLS/TDS เดิมหากมี แล้วตรวจแบบไม่เขียน Supabase:

```powershell
node stock-agent.mjs --dry-run
```

คำสั่งนี้บอกจำนวนสินค้าต่อคลังและเวลาที่ใช้ โดยไม่พิมพ์ข้อมูลสินค้าแต่ละรายการ ถ้าคำสั่งเกิน 60 วินาทีจะหยุดและเก็บ snapshot เดิมไว้ ไม่ตัดประวัติรายการเพื่อทำให้ query เร็วขึ้น เพราะจะทำให้ยอดคงเหลือผิด

## 2. เปลี่ยนผู้ส่งข้อมูลสต๊อคเป็น Agent

1. หยุด/Disable Task Export และ Upload **Stock CSV** เดิม รวมทั้งบอทอื่นที่เขียนตาราง `stock` (ไม่ต้องหยุด Pending หรืองาน CSV อื่น)
2. ใน Supabase **โครงการเดิมที่เว็บใช้** รัน [stock-sync-setup.sql](stock-sync-setup.sql) ทั้งไฟล์ใน SQL Editor รันซ้ำได้ ไม่ลบสต๊อคเดิมระหว่างติดตั้ง
3. ตรวจ `.env` ว่ามี `SUPABASE_SERVICE_KEY` เดิมของ Pending ห้ามใช้ชื่อขึ้นต้น `VITE_` และห้ามใส่ key นี้ในหน้าเว็บหรือ Git
4. ทดสอบส่งหนึ่งรอบ:

```powershell
node stock-agent.mjs --once
```

5. เปิดเว็บรุ่นที่มีปุ่ม **ดึงข้อมูลล่าสุด** ในหน้า Stock ค้นหา SKU/ชื่อ เลือกคลัง แล้วเทียบกับ R01.102
6. เริ่ม Agent ผ่าน Task เดิมตามขั้น 3 ด้านล่าง การทดสอบ `--once` จบเอง ไม่ต้องเปิด `node stock-agent.mjs` ค้างเพิ่มคู่กับ Task

เมื่อไม่มีคำขอจะขึ้น `💤 รอเปิดหน้า Stock / กดรีเฟรช` เป็นปกติ ไม่ได้หยุดทำงาน `upload-stock.mjs` รุ่นใหม่จะปฏิเสธการอัปโหลด CSV เมื่อตรวจพบ `stock_sync` แต่ **ตัวเก่าที่ติดตั้งอยู่อาจยังเขียนได้ จึงต้องหยุด Task เดิมจริง**

## 3. ใช้ Task Scheduler เดิมของ Pending

ใช้ Task เดิมที่เรียก `run-pending-docs-agent.bat` ได้เลย ไฟล์รุ่นใหม่นี้เรียก `promaxx-agents.mjs` เพื่อเปิดทั้ง Pending และ Stock แต่ละ Agent ล้มแล้วเปิดใหม่หลัง 10 วินาที โดยอีกตัวทำงานต่อ ทั้งคู่ใช้ `.env` และ `node_modules` ในโฟลเดอร์เดียวกัน

1. อัปเดต `run-pending-docs-agent.bat`, `promaxx-agents.mjs` และ `stock-agent.mjs` ในโฟลเดอร์ Pending เดิม (คง `pending-docs-agent.mjs`, `.env`, `node_modules` ไว้)
2. ทำขั้น 1–2 ข้างต้นให้พร้อม โดยเฉพาะ SQL ของ Stock และหยุดงาน Stock CSV เดิม
3. ใน Task Scheduler คลิกขวาที่ **Task Pending เดิม → End → Run** Task เดิมจะเปิดทั้งคู่ ไม่ต้องแก้ Action หรือชื่อ Task
4. ตรวจ `pending-docs-agent.log` และ `stock-agent.log` ว่าทั้งคู่พร้อมรอคำขอ

ใช้ **Run whether user is logged on or not**, **Do not start a new instance** และเอาติ๊ก **Stop the task if it runs longer than 3 days** ออกเช่นเดิม ตั้งเครื่องเดียวและ Task เดียวพอ หากเคยสร้าง Task แยกที่ใช้ `run-stock-agent.bat` ไว้ให้ Disable เพื่อไม่เปิด Stock ซ้ำ

Log Stock อยู่ที่ `stock-agent.log` หมุนเมื่อเกิน 5 MB `.bat` ต้องเป็น CRLF ตัวควบคุมมีหน้าที่เปิด/รีสตาร์ท Agent เท่านั้น การถาม ProMaxx ยังคงเกิดเฉพาะตอนหน้าเว็บขอ

## การทำงานและตรวจปัญหา

- เปิดหน้า/กดรีเฟรช: ขอข้อมูลได้ห่างกันอย่างน้อย 10 วินาทีทั้งระบบ กลับมาที่แท็บ: ขอเมื่อข้อมูลเก่ากว่า 2 นาที เปิดค้างไว้เฉย ๆ ไม่ถาม ProMaxx ตามรอบ
- Agent อ่านคำขอ **ใน Supabase** ทุก 30 วินาที เผื่อ Realtime หลุด เว็บอ่านสถานะทุก 1 นาที และทุก 3 วินาทีระหว่างรอ ทั้งหมดนี้ไม่ได้อ่าน ProMaxx ถ้าไม่มีคำขอใหม่
- ชุดข้อมูลเหมือนเดิม: เปลี่ยนแค่ `last_checked_at` ไม่ส่งสินค้าซ้ำ ไม่โหลดผลค้นหาใหม่ ชุดเปลี่ยน: ส่ง snapshot ครบให้ RPC เทียบกับ `(branch, sku)` แล้วเขียนเฉพาะแถวที่เปลี่ยน/เพิ่ม/หายไป พร้อมอัปเดตสถานะใน transaction เดียว แถวที่เหมือนเดิมรักษา `id` และ `uploaded_at` ไว้
- `--once` ข้ามการเทียบ hash ฝั่ง Agent แล้วส่งชุดเต็มให้ RPC ตรวจข้อมูลจริงเช่นกัน แต่ RPC จะเขียนเฉพาะแถวที่จำเป็น เมื่อ payload เดียวกันเข้าซ้ำไม่เกิดการลบ/ใส่ใหม่ทั้งชุด และ `last_success_at` ไม่ขยับหากข้อมูลจริงไม่เปลี่ยน
- หน้า Stock ยังค้นหาก่อนโหลด แยก 4 คลัง แสดงสูงสุด 300 รายการตามเดิม ตารางอื่นที่อ่าน `stock` ใช้ข้อมูลชุดนี้ต่อได้
- **เครื่องในร้านไม่ตอบ**: รอ 75 วินาทีแล้วยังไม่มีผล ตรวจ Task, อินเทอร์เน็ต และ log ข้อมูลชุดเดิมยังอยู่ เมื่อคำขอ/ผลส่งมาทาง polling อาจช้ากว่า Realtime
- **ไม่มีสิทธิ์อ่านตาราง**: ตรวจสิทธิ์ SELECT ด้วยบัญชีอ่านอย่างเดียวใน SSMS ดูรายละเอียดใน log ที่เครื่องร้าน ข้อความดิบของ driver ไม่ถูกส่งขึ้นสถานะสาธารณะ
- **ชุดว่าง/ข้อมูลผิด/ต่อไม่ได้**: Agent ไม่ลบ snapshot เดิม และไม่ลองถาม MSSQL ซ้ำตามรอบ ให้แก้สาเหตุแล้วกดรีเฟรชใหม่

ก่อนติดตั้ง SQL ใหม่ หน้าเว็บยังอ่าน Stock CSV เดิมได้ เวลาที่แสดงเป็นเวลาประเทศไทย ชุดข้อมูลใน `stock` ยังคงชนิดคอลัมน์เดิมเพื่อให้ Outbound และ Sale Support ใช้งานต่อได้
