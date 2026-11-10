# Agent หน้า Price — MSSQL รายงาน R05.106

Agent อ่าน MSSQL ด้วย `SELECT` **วันละครั้งเวลา 08:00 น. ตามเวลาไทย (Asia/Bangkok)** หรือเมื่อกด Badge **ดึงข้อมูลล่าสุด** ใน Admin แล้วเทียบ hash กับ Supabase ถ้าเหมือนเดิมส่งเฉพาะ hash และเวลาตรวจ ถ้าต่างกันบันทึกใน transaction เดียว โดยเพิ่ม/แก้ไข/ลบเฉพาะแถวที่เปลี่ยน แถวเดิมคง ID และ `updated_at` ไว้ การแจ้งเตือนราคาเปลี่ยนยังใช้ระบบเดิม

ปุ่ม **Price เปลี่ยนหน้าเท่านั้น** ไม่สั่ง Agent ไม่เรียก MSSQL หน้าเว็บฟัง `price_sync` ผ่าน Realtime และอ่านแถวสถานะทุก 60 วินาที/เมื่อกลับมาที่แท็บเพื่อเก็บตกข้อมูล (ระหว่างรอคำขออ่านสถานะทุก 3 วินาที) ไม่โหลดรายการใหม่ถ้า `data_version` เท่าเดิม รองรับผลค้นหา หมวด/ชั้นวาง ตะกร้า ประวัติสแกน และตัวอย่างป้ายที่เปิดค้าง โดยคงจำนวนป้ายและตำแหน่งชั้นวาง

Agent รันค้างไว้เพื่อรอเวลาและคำขอ ตรวจเฉพาะคิวใน **Supabase** ทุก 10 วินาทีเพื่อเก็บตกกรณี Realtime หลุด ไม่มีรอบ SELECT MSSQL ทุกนาทีแล้ว และไม่ SELECT ตอนเริ่มโปรแกรมนอกเวลา เว้นแต่มีคำขอจาก Admin ค้างอยู่ ระบบบันทึกรอบรายวันและผลคำขอไว้ใน Supabase เพื่อกันดึงซ้ำเมื่อรีสตาร์ท

## 1. ตรวจ SQL กับรายงาน

นำไฟล์จากชุด ZIP ไปวางในโฟลเดอร์ `anin_sale_support` บนเครื่องร้านก่อน ไฟล์ `price-agent.mjs` และ `mssql-readonly.mjs` ต้องอยู่ชั้นเดียวกับ `package.json` และ `.env` เดิม อย่าให้ ZIP แตกเป็นโฟลเดอร์ซ้อนอีกชั้น ชุดนี้ไม่รวม `.env` และไม่ทับ Agent Stock/Pending

ใช้ Node.js 20 ขึ้นไป แล้วตรวจใน PowerShell:

```powershell
Test-Path .\price-agent.mjs
Test-Path .\mssql-readonly.mjs
```

ต้องได้ `True` ทั้งคู่ จึงสั่งพิมพ์ SQL ได้ (คำสั่งนี้ไม่ต้องมี credentials และยังไม่ต้อง `npm install`):

```bat
node price-agent.mjs --print-sql
```

หากขึ้น `Cannot find module '...\\price-agent.mjs'` แปลว่าไฟล์ Agent ยังไม่ได้อยู่ในโฟลเดอร์ที่รัน ตรวจตำแหน่งการแตก ZIP ก่อน คำสั่ง `git pull` จะนำไฟล์นี้มาได้ต่อเมื่อโค้ดถูก push/merge เข้า branch ที่เครื่องร้านใช้อยู่แล้วเท่านั้น

นำ SELECT ไปตรวจใน SSMS ด้วยบัญชีอ่านอย่างเดียวที่ Stock/Pending ใช้อยู่ ไม่ต้องเพิ่ม trigger, Change Tracking, view, index หรือ procedure ใน MSSQL

SQL ใช้ `ITEMS` + `ITEMBARCODE` + `ITEMUNIT` + `UNITNAME` + `ITEMGROUPL1` ตาม R05.106.REP: ราคา = `ITEMBARCODE.FMLPRICE`, หน่วย/ตัวคูณจับคู่ด้วย `SYSITEMID` และ `SYSUNITID`, หมวด = `ITEMGROUPL1.GROUPNAME`, ตัด `DEPOSIT`/`DEPOSIT-NV` และกรอง `FShowOnReport = 1` เก็บทุกหน่วยบรรจุและทุกบาร์โค้ด

## 2. ตั้งค่าเครื่องในร้าน

ใช้ค่า MSSQL และ `SUPABASE_SERVICE_KEY` จาก `.env` ของ Agent เดิมได้ รุ่นนี้เลิกใช้ `PRICE_POLL_SECONDS` ลบตัวแปรเดิมออกได้ เวลา 08:00 อ้างอิงเวลาไทยเสมอ แม้ timezone ของเครื่องจะเป็นค่าอื่น

```dotenv
MSSQL_SERVER=<เครื่อง SQL เดิม>
MSSQL_DATABASE=<ฐานข้อมูล ProMaxx>
MSSQL_USER=<บัญชีอ่านอย่างเดียว>
MSSQL_PASSWORD=<รหัสของบัญชีนี้>
SUPABASE_SERVICE_KEY=<server-only key ของโปรเจกต์เดิม>
```

ใช้ `MSSQL_INSTANCE` / `MSSQL_PORT` / `MSSQL_ENCRYPT` / `MSSQL_TDS_VERSION` ตาม Pending เดิม ห้ามใส่ service key หรือรหัส MSSQL ในตัวแปร `VITE_` และห้าม commit `.env`

ก่อนอ่าน MSSQL จริง ให้รัน `npm install` ในโฟลเดอร์โปรเจกต์เพื่อให้มี dependencies `mssql` และ `@supabase/supabase-js` ตาม `package.json` เดิม

```bat
node price-agent.mjs --dry-run
```

คำสั่งนี้อ่าน MSSQL จริงและแสดงจำนวน/hash แต่ไม่เขียน Supabase เทียบจำนวนและสินค้ากับรายงานเดิมก่อนเปิดใช้

## 3. ติดตั้ง Supabase และเปลี่ยนจากบอท CSV

1. หลังตรวจ dry-run แล้ว หยุด Task ของบอทอัปโหลด R05.106 เดิม (`botr05106`) และรอรอบที่กำลังทำงานจบ ให้ Agent ราคาเป็นผู้เขียนประจำเพียงตัวเดียว ไม่กระทบ Stock/Pending
2. รัน `price-agent-setup.sql` ทั้งไฟล์ใน **Supabase SQL Editor** ของโปรเจกต์เดิม (ไม่ใช่ SSMS) ต้องมี `products`, `products_import` และ `log_price_changes()` จากระบบเดิม
3. รัน `node price-agent.mjs --once` เพื่อซิงค์ครั้งแรก คำสั่งนี้ข้ามข้อมูลที่ hash เหมือนเดิมด้วย
4. เปิดเว็บรุ่นใหม่ กดเฟือง **Admin** → ใส่รหัสเดิม → กด Badge **ดึงข้อมูลล่าสุด** Agent จะอ่าน MSSQL ทันทีเมื่อได้รับคำขอ แล้ว Badge แสดงผลสำเร็จ/ผิดพลาด หน้า Price ที่เปิดค้างจะอัปเดตเอง กดซ้ำระหว่างรอไม่ได้ คำขอที่ข้อมูลไม่เปลี่ยนก็แสดงว่าตรวจสำเร็จโดยไม่โหลดรายการซ้ำ

SQL รันซ้ำได้ ไม่ล้างสินค้า/ประวัติราคา และรักษา API `swap_products_from_import()`/`upload_products_from_web()` เดิม หากติดตั้ง Agent รุ่นทุก 60 วินาทีไปแล้ว ต้องรัน SQL รุ่นใหม่นี้ซ้ำและรีสตาร์ท Agent ปุ่มอัปโหลด CSV ใน Admin ยังใช้ได้ โดย Agent จะยืนยันข้อมูลจาก MSSQL เมื่อถึง 08:00 หรือกด Badge ครั้งถัดไป ไฟล์ CSV จึงต้องตรงกับต้นทางปัจจุบัน

**ห้ามนำ `products-import-swap.sql` รุ่นเก่าจาก repo บอทมารันทับ** เพราะจะกลับเป็นลบ/เพิ่มทั้งตารางและหยุดส่ง `price_sync` หากรันไปแล้วให้รัน `price-agent-setup.sql` ซ้ำ

## 4. เปิดอัตโนมัติเมื่อเปิดเครื่อง

รัน `run-price-agent.bat` หรือให้ Task Scheduler เรียกตอน **At startup** ตั้ง **Start in** เป็นโฟลเดอร์โปรเจกต์ เลือก **Do not start a new instance** และปิดเงื่อนไขหยุดหลังรันครบเวลา ให้รันเครื่องเดียว wrapper เปิดใหม่ใน 10 วินาทีเมื่อโปรแกรมหยุด

เครื่องและ Agent ต้องเปิดอยู่เวลา 08:00 หากพลาดช่วง 08:00 จะรอวันถัดไป หรือกด Badge เพื่อดึงทันที เมื่ออ่าน MSSQL ล้มเหลวจะบันทึกผลผิดพลาดและไม่วน SELECT ซ้ำเอง ให้แก้สาเหตุแล้วกด Badge ใหม่ คำขอที่กดตอน Agent ปิดจะยังค้างใน Supabase และทำเมื่อ Agent กลับมาเปิด

ดู `price-agent.log` (หมุนเมื่อเกิน 5 MB) และตรวจสถานะใน Supabase:

```sql
select data_version, row_count, last_success_at, last_checked_at, last_scheduled_date,
       request_id, completed_request_id, last_error
from public.price_sync where id = 1;
```

`last_checked_at` = ตรวจสำเร็จล่าสุด, `last_success_at` = ข้อมูลเปลี่ยนล่าสุด, `last_scheduled_date` = รอบ 08:00 ที่เริ่มทำไปแล้ว ผลว่าง/หายเกิน 20%, barcode/SKU ไม่ครบ, barcode ซ้ำแต่ข้อมูลขัดกัน หรือบันทึกพัง จะไม่แทนที่ข้อมูลเดิม แก้สาเหตุจาก log แล้วกด Badge ใหม่ ไม่มีคำสั่งเขียนใด ๆ ส่งเข้า MSSQL
