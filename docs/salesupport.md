# Sale Support (หน้าซัพพอร์ต) — รายละเอียดเต็ม

> เอกสารนี้แยกออกมาจาก `CLAUDE.md` (root) เพื่อลด context ที่โหลดทุกเซสชัน — **อ่านไฟล์นี้ก่อนแก้ `SaleSupportPage.tsx` เสมอ** ไฟล์นี้ใหญ่สุดในโปรเจกต์ (231 KB) และมี hazard เยอะที่สุด

## SaleSupport tables

**SaleSupport tables** (สร้างด้วย `salesupport-setup.sql` — RLS: anon ทำได้ทุกอย่าง `for all`):

| Table | ใช้กับเมนู | หมายเหตุ |
|---|---|---|
| `ss_orders` | Order | งานสั่งจอง/สั่งซื้อของลูกค้า ~23 คอลัมน์ (sku, branch, qty, paid_date, customer_name, contact_channel, สถานะ chip: arrived_branch / customer_notified / delivered ฯลฯ) |
| `ss_backorders` | BackOrder | สินค้าค้างส่ง (ABC ≠ P) — `branch` มี CHECK `SRC/KKL/SSS/SALE_ADMIN` · เก็บ `unit` = **หน่วยของบาร์โค้ดที่สแกน** · `pending_qty` = **ค้างส่งลูกค้า** (สาขากรอกเอง) ส่วน **"คลังมีสินค้า" ไม่ได้เก็บ** ดึงสดจาก `stock` สาขาคลังสินค้า · 3 สถานะ chip default สะกดตรงกับ `ss_orders` เป๊ะ · migration `202608140001` → `202608140003` + `202608150001` + `202608190002` (เพิ่ม `SALE_ADMIN`) |
| `ss_request_items` | Request Item | ขอสินค้าที่ไม่มีในสต๊อก + supplier, image_url, customer_name |
| `ss_new_products` | New Product | เสนอสินค้าใหม่เข้าร้าน + image_url, quoted_price, status |
| `ss_tickets` | Ticket | แจ้งปัญหา department: Purchase / Warehouse |
| `product_master` | Products | ฐานข้อมูลสินค้าหลักจากไฟล์ Product_Master — **unique constraint ที่ `sku`** (รองรับ upsert) — เมนู Products filter `abc = 'P'` เรียงตาม sku |
| `ss_suppliers` | (autocomplete) | ชื่อ supplier + `details` jsonb เก็บคอลัมน์อื่นทั้งหมดจาก Excel |

- **Storage bucket `salesupport`** (public) — เก็บรูปสินค้าแนบจากเมนู Request Item / New Product (โฟลเดอร์ `request-items/`, `new-products/`) — policy: anon insert + select
- อัปโหลด Excel ผ่านเว็บด้วยไลบรารี `xlsx`: ปุ่ม "อัปโหลด Supplier" (ล้างแล้ว insert ใหม่ทีละ 100 แถว) และ "📤 อัปโหลด Product Master" (จับคู่หัวคอลัมน์ด้วย `MASTER_HEADER_MAP` regex)
- Supplier autocomplete: พิมพ์ ≥ 2 ตัวอักษรใน field Supplier → ค้นจาก `ss_suppliers`
- SKU autocomplete (ฟอร์ม Order + BackOrder): ใช้ helper กลาง **`searchProductUnits(term, opts)`** ค้นจากตาราง `products` เติมชื่อ/หน่วยอัตโนมัติ — ดูหัวข้อ "ช่องค้นหา SKU" ด้านล่าง
- Popup Order มี 3 ตราประทับอนุมัติ (ของถึงสาขา / แจ้งลูกค้า / ส่งมอบสินค้า) — กดแล้วบันทึกลง Supabase ทันที

## ภาพรวม

- Layout: `.ss-layout` = sidebar ซ้าย (`.ss-sidebar` เมนู 6 อัน) + panel ขวา (toolbar + ตาราง)
- เมนูขับเคลื่อนด้วย config `MENUS: MenuDef[]` — แต่ละเมนูกำหนด table, columns (`kind: 'date' | 'datetime' | 'chip'`), orderBy, filter, **`roles`**
- Chip สี: เขียว (`.ss-chip--green`) / แดง / ฟ้า / ส้ม ตามค่าสถานะ
- คลิกแถว → popup รายละเอียด (แก้ไข inline ได้) — Order/BackOrder popup มีตราประทับอนุมัติ 3 ขั้น บันทึกลง Supabase ทันที
- **หน้านี้แยกพฤติกรรมตามโปรไฟล์** ผ่าน props: `isPurchasing` (`authProfile.id === 'PURCHASING'`) · `isWarehouse` (`authProfile.group === 'คลังสินค้า'`) · `userBranch` (`authProfile.branch` → `isBranchUser` ในไฟล์)
- `isBranchUser` = `BRANCH_PROFILE_CODES.includes(userBranch)` (import จาก `auth.ts`) = **`SRC`/`KKL`/`SSS`/`SALE_ADMIN`** — ⚠️ **ห้าม hardcode 3 สาขากลับมา** เดิมรายชื่อนี้ซ้ำอยู่ 5 จุดคนละไฟล์ เพิ่มโปรไฟล์ทีต้องไล่แก้ครบทุกจุด ตกจุดไหนก็พังเงียบคนละแบบ
- ยุบเป็น `currentRole: MenuRole` (`'branch' | 'warehouse' | 'purchasing' | 'saleadmin'`) → `visibleMenus` กรอง `MENU_DISPLAY_ORDER` ด้วย `MenuDef.roles` (ไม่ใส่ `roles` = ทุกโปรไฟล์เห็น)
  - ⚠️ `visibleMenus` ยังเป็น **whitelist ตอนเปิดจากลิงก์แจ้งเตือน** (`openNotificationEvent`) ด้วย — ไม่งั้นลิงก์จะพาไปเมนูที่ถูกซ่อน แล้วออกไม่ได้เพราะไม่มีปุ่มใน sidebar
  - **Sale Admin นับเป็น role `branch` เต็มตัว** — เคยมี role `'saleadmin'` แยกไว้ซ่อนเมนู BackOrder ตอนเพิ่มโปรไฟล์ (2569-08-19 เช้า) แต่**ถอดออกแล้ว**ตอนบ่ายที่ผู้ใช้ขอเปิดเมนูนั้นให้ใช้ได้ · ทุกอย่างเดินตาม `isBranchUser` (ล็อกช่องสาขาในฟอร์ม, `.eq('branch', userBranch)`, `notifyPurchasingUpdate`/`notifyWarehouseUpdate`)
- **`branchCodeLabel(code)`** (จาก `auth.ts`) = จุดเดียวที่แปลงรหัส DB → ชื่อที่ผู้ใช้เห็น (`SALE_ADMIN` → `Sale Admin`) อ่านจาก `PROFILES.label` ตรงๆ ไม่มี map ซ้ำ · เรียกที่ **`formatCell`** (ครอบทุกตาราง **และ popup รายละเอียด** เพราะ popup เรนเดอร์ผ่าน `formatCell` เหมือนกัน), option ของ dropdown สาขาทุกฟอร์ม, ป้าย `.ss-branch-locked-value`, และ `notificationRecipientLabel`

## เมนู Order — สาขาเห็นเฉพาะของตัวเอง

`isBranchUser` → เติม `.eq('branch', userBranch)` ในทั้ง **2 query** ที่แตะ `ss_orders` · คลัง/จัดซื้อเห็นทุกสาขาเพราะดูแลให้ทั้งหมด

1. query ตาราง (effect หลัก) — กรองที่ server ไม่ใช่ฝั่ง client ไม่งั้น `limit 500` จะถูกกินโดยแถวของสาขาอื่น
2. query นับเมนูย่อย 3 ขั้น — ⚠️ **ต้องกรองให้ตรงกัน** ไม่งั้นเลขบน badge จะนับรวมสาขาที่ผู้ใช้มองไม่เห็น แล้วกดกรองแล้วตารางว่าง
- **ไม่มีป้ายบอกว่าถูกกรอง** — เคยใส่ `🔒 สาขา X` ใน toolbar แล้วผู้ใช้ให้เอาออกเพราะรก (2569-08-13) อย่าใส่กลับ
- เช็ค `row.branch === userBranch` ใน `showOutboundAlert()` ซ้ำซ้อนกับ query แล้ว — เก็บไว้เป็นกันชนโดยตั้งใจ
- ฟอร์ม ➕ New Order **ล็อกสาขาตามรหัสที่ล็อกอินแล้ว** (`.ss-branch-locked-value` ไอคอน 🔒 แก้ไม่ได้) — เดิม default เป็น `SRC` ทำให้ KKL/SSS สร้าง Order ผิดสาขาแล้วมองไม่เห็นทันที · คลัง/จัดซื้อยังเลือก dropdown ได้ตามปกติ
- ผู้รับ Order ตัดสิน**อัตโนมัติจาก `product_master.abc` ของ SKU ที่กรอก** ตอนกดบันทึก (`saveOrder`): `P` → `PURCHASING` · หา SKU ไม่เจอใน Product Master → `BOTH` (ไม่ทราบ ABC กันออเดอร์ไม่มีใครเห็นเลย) — ไม่มีช่องให้เลือกแผนกในฟอร์มแล้ว
- ⚠️ **New Order เฉพาะยา Pre (`ABC = P`) เท่านั้น — บังคับจริงตั้งแต่ 2569-08-17** ไม่ใช่แค่ข้อความหัวป็อปอัพ "(เฉพาะยา Pre เท่านั้น)" เฉยๆ (ก่อนหน้านี้ช่องค้นหายังเจอ SKU ทุก ABC และ `saveOrder` ยัง route ABC ที่ไม่ใช่ P ไป `WAREHOUSE` ได้ ขัดกับข้อความหัวป็อปอัพ) — ล็อก 2 ชั้น:
  1. ช่องค้นหา SKU (`lookupSku`/`handleSkuChange`) ใส่ `onlyP: true` ให้ `searchProductUnits()` — พิมพ์/กด Enter หา SKU ที่ไม่ใช่ P จะไม่มี suggestion ขึ้นเลย (ตรงข้ามกับ BackOrder ที่ใช้ `excludeP`)
  2. `saveOrder` เช็คซ้ำ `abc !== 'P'` (เมื่อพบใน Product Master) ก่อน insert เสมอ — กันพิมพ์ SKU เองตรงๆ โดยไม่ผ่านช่องค้นหาเลย ถ้าเจอว่าไม่ใช่ P จะไม่ insert และ error ชี้ไปเมนู BackOrder แทน (ข้อความเดียวกับที่ BackOrder ชี้กลับมา Order เวลาเจอ SKU เป็น P) · **SKU ที่หาไม่เจอใน Product Master ยังผ่านได้เป็น `BOTH` เหมือนเดิม** (ไม่บล็อกยาใหม่ที่ยังไม่มีในฐาน)
  - ผลคือ `recipient_department` ของ Order ใหม่ทุกใบมีได้แค่ `PURCHASING` หรือ `BOTH` เท่านั้น — ค่า `WAREHOUSE` เป็นได้แค่ข้อมูลเก่าก่อนวันที่นี้ (โค้ดอ่าน/แสดงผลค่านี้ได้ตามปกติ แค่ไม่มีทาง insert ใหม่แล้ว)

## ช่องค้นหา SKU ในฟอร์ม (Order + BackOrder) — `searchProductUnits()`

helper กลางตัวเดียวใช้ทั้ง 2 ฟอร์ม — `searchProductUnits(term, { exact?, excludeP?, onlyP? })`

- ⚠️ **ต้องอ่านจาก `products` ห้ามใช้ `product_master`** — `product_master` มี **unique ที่ `sku`** คือ 1 แถวต่อ SKU เก็บแค่ `base_unit` → SKU ที่มีหลายหน่วยจะเห็นแค่หน่วยเดียว (แก้ 2569-08-16: ฟอร์ม Order เคยใช้ `product_master` จึงพิมพ์ `100074` แล้วเจอแค่ `แผง` ไม่เห็น `กล่อง` ทั้งที่หน้าป้ายราคาเห็นครบ)
- `products` มี 1 แถวต่อ barcode = ครบทุกหน่วย และมีคอลัมน์ `barcode` ให้สแกนได้ ซึ่ง `product_master` ไม่มี
- ยุบผลลัพธ์ด้วย key `sku-unit` (ไม่ใช่ `sku`) — ไม่งั้นหน่วยที่ 2, 3 จะถูกตัดทิ้ง · **`key` ของ `<button>` ในลิสต์ก็ต้องเป็น `sku-unit`** ไม่งั้น React duplicate key
- ดึง `.limit(40)` แล้วค่อยเหลือ 8 เพราะโดนยุบหน่วยซ้ำ + อาจโดนกรอง ABC (excludeP/onlyP) อีกทอด
- **กด Enter (`exact: true`)** → `.or('sku.eq.x,barcode.eq.x')` · เจอ **1 หน่วย = เติมให้เลย** · เจอ **หลายหน่วย = โชว์รายการให้เลือกเอง** (ห้ามเดาหน่วยแทนผู้ใช้)
- **พิมพ์ไปเรื่อย ๆ (3 ตัวขึ้นไป)** → `.or('sku.ilike.x%,barcode.ilike.x%,name.ilike.%x%')` หน่วง 250ms + `suggestReqRef` token กัน race
- `excludeP: true` (BackOrder ใช้) → กรอง `ABC = P` ออก ฝั่ง client ผ่าน `findPurchasingSkus()`
- `onlyP: true` (Order ใช้ — เพิ่ม 2569-08-17) → เอาเฉพาะ `ABC = P` ผ่าน `findPurchasingSkus()` ตัวเดียวกัน กลับทิศกับ `excludeP` (2 ตัวใช้พร้อมกันไม่ได้)
- ทั้ง Order และ BackOrder กด Enter แล้วไม่เจอ (หลังกรอง ABC) จะเช็คซ้ำแบบไม่กรอง P เพื่อแยกข้อความ **"ไม่มีสินค้านี้"** ออกจาก **"มีแต่เป็นคนละฝั่ง"** — ไม่ปล่อยเงียบ: BackOrder เจอว่าเป็น P จะบอกให้ไปใช้เมนู Order · Order เจอว่าไม่ใช่ P จะบอกให้ไปใช้เมนู BackOrder (ข้อความสมมาตรกัน)

ตัวอย่างผลจริง (พิมพ์ในช่อง SKU):

| พิมพ์ | เดิม (product_master) | ใหม่ (products) |
|---|---|---|
| `100074` | 1 รายการ — `แผง` | **2 รายการ — `แผง` \| `กล่อง`** |
| `100034` | 1 รายการ — `แผง` | **3 รายการ — `แผง` \| `10แผง` \| `กล่อง`** |
| `109331` (barcode ของ sku `100056`) | **0 รายการ — หาไม่เจอ** | **1 รายการ — `100056 แผง`** |

## จุดแจ้งเตือนหน้า SaleSupport — 3 โปรไฟล์ 3 กลไก (คลังสินค้ามี 2 พร้อมกัน)

จุดแดงบนไอคอน Support (เห็นจากทุกหน้าผ่าน `PageNotificationContext`) + ปุ่ม 🔔 ในหน้า SaleSupport เอง

| โปรไฟล์ | ปุ่ม | ครอบคลุม | นับจาก | มาร์คว่าอ่าน |
|---|---|---|---|---|
| สาขา SRC/KKL/SSS | **🔔 อัพเดท** (drawer ประวัติ) | Order, Request Item | `ss_branch_notification_events` `branch = <สาขา>` | เปิด drawer → RPC `ss_mark_branch_notifications_read` |
| จัดซื้อ | **🔔 อัพเดท** (drawer เดียวกัน) | Order, Request Item | ตารางเดียวกัน `branch = 'PURCHASING'` | เปิด drawer → RPC ตัวเดียวกัน |
| **คลังสินค้า** | 🔔 **Order ใหม่** (ไม่มีประวัติ, ของเดิม) | เฉพาะ Order ที่ `recipient_department` เป็นของคลัง | `ss_orders` `.in('recipient_department',['WAREHOUSE','BOTH'])` + `recipient_read_at is null` | เปิดเมนู Order → `update recipient_read_at` |
| **คลังสินค้า** | **🔔 อัพเดท** (drawer ประวัติ, เพิ่ม 2569-08-18) | Order + BackOrder **ทุกใบ** (ไม่กรอง `recipient_department`) | `ss_branch_notification_events` `branch = 'WAREHOUSE'` | เปิด drawer → RPC ตัวเดียวกัน |

- **คลังสินค้ามี 2 ปุ่มพร้อมกัน คนละแหล่งข้อมูล ไม่ได้แทนที่กัน** — "Order ใหม่" นับเฉพาะ Order ที่ส่งมาถึงคลังจริง (`recipient_department`) ส่วน "อัพเดท" ครอบคลุมกว้างกว่าเพราะคลังกรอกฟอร์ม Inbound/Outbound/เลขโอนให้ Order **ทุกใบ** ไม่ใช่แค่ใบที่ส่งถึงคลัง และครอบคลุม BackOrder ที่ "Order ใหม่" ไม่เคยเห็นเลย
- `App.tsx` มี **2 effect แยกกัน** สำหรับคลัง: `notificationSource` (`kind:'orders'`, ของเดิม, ให้ "Order ใหม่") + effect ใหม่ต่างหากที่ query `ss_branch_notification_events` ตรงๆ (ให้ `warehouseUpdateUnreadCount`) — **จงใจไม่ยัดเข้า `notificationSource` เดิม** เพราะตัวนั้นเป็น discriminated union คืนได้แค่ 1 ค่าต่อโปรไฟล์ (`useMemo` ต้องมี identity เดียว ไม่งั้น resubscribe ทุก render) การแยก effect ยังกันความเสี่ยงต่อ 2 โปรไฟล์เดิม (สาขา/จัดซื้อ) ที่ทดสอบผ่านแล้วไม่ให้กระทบ
- ฝั่ง `'events'` (สาขา/จัดซื้อ) และ effect ใหม่ของคลัง ทั้งคู่ subscribe ตาราง **`ss_branch_notifications` (ตัวสรุป)** ไม่ใช่ `_events` — RPC upsert `last_update_at` ที่นั่น การเขียนแถวนั้นคือสิ่งที่ปลุก `loadUnread()`
- ปุ่มในหน้า: `notificationRecipient && …` (อัพเดท — ตอนนี้ `isWarehouse` ก็ทำให้ `notificationRecipient === 'WAREHOUSE'` แล้ว) · `isWarehouse && notificationUnreadCount > 0 && …` (Order ใหม่ — ยังอ่าน `notificationUnreadCount`/`pageNotifications.salesupport` เดิม ไม่ยุ่งกับตัวนับใหม่) — ตัวแปร `departmentCode` เดิมถูกลบทิ้งแล้วทั้ง 2 ไฟล์
- ⚠️ **`notificationUnreadCount` (Order ใหม่) กับ `notificationHistoryUnreadCount` (อัพเดท) เป็นคนละตัวแปรโดยตั้งใจ** — สำหรับคลังสินค้า `notificationHistoryUnreadCount = warehouseUpdateUnreadCount` (prop ใหม่จาก `App.tsx`) ส่วนสาขา/จัดซื้อสองตัวนี้ค่าเท่ากันเป๊ะ (ไม่กระทบพฤติกรรมเดิม) — ปุ่ม "🔔 อัพเดท" ต้องใช้ `notificationHistoryUnreadCount` เท่านั้น ถ้าเผลอใช้ `notificationUnreadCount` แทน คลังจะเห็นเลข "Order ใหม่" โผล่ผิดที่ปุ่ม "อัพเดท"

**ทิศทางแจ้งเตือน 3 ทาง ใช้ตาราง `ss_branch_notification_events` ร่วมกัน:**

| ทิศ | ฟังก์ชัน | guard | ผู้รับ (`branch`) | ผู้กระทำ (`actor_code`) |
|---|---|---|---|---|
| แผนก → สาขา (เดิม) | `notifyBranchUpdate(branchValue, meta)` | `isPurchasing \|\| isWarehouse` | สาขาของแถวนั้น · ไม่รู้จัก = **fan-out ทั้ง 3 สาขา** | `WAREHOUSE`/`PURCHASING` |
| สาขา → จัดซื้อ (2569-08-17) | `notifyPurchasingUpdate(meta)` | `isBranchUser` | `'PURCHASING'` เสมอ ไม่มี fan-out | สาขาที่ล็อกอิน |
| **สาขา → คลังสินค้า** (2569-08-18) | `notifyWarehouseUpdate(meta)` | `isBranchUser` | `'WAREHOUSE'` เสมอ ไม่มี fan-out | สาขาที่ล็อกอิน |

- ทั้งสามเรียกผ่าน helper กลาง **`createNotificationEvents(targets, actorCode, meta)`** — จุดเดียวที่รู้จักรูปร่าง argument ของ RPC
- ⚠️ **guard ของทิศ "แผนก → สาขา" ตรงข้ามกับอีก 2 ทิศสนิท** (`isPurchasing||isWarehouse` ผู้กระทำ vs `isBranchUser` ผู้กระทำ) จึงเรียกคู่กันในฟังก์ชันเดียวได้โดยไม่มีทางยิงซ้ำ (`saveOrder`/`applyStepChange`/`saveBackOrder` เรียกได้พร้อมกันหลายทิศ) — **ถ้าใครคลาย guard ตัวใดตัวหนึ่งจะยิงข้ามทิศทันที**
- ⚠️ **ห้ามเอา `notifyBranchUpdate` มาใช้ 2 ทิศใหม่** — fallback fan-out ของมันจะสแปมทั้ง 3 สาขาแทนที่จะแจ้งจัดซื้อ/คลัง
- **`notifyWarehouseUpdate` ไม่กรอง `recipient_department`/ตาราง** (ต่างจาก `notifyPurchasingUpdate` ที่กรองเฉพาะ `ss_orders`) — ยิงทั้ง Order ทุกใบและ BackOrder ทุกใบ เพราะคลังทำงานกับทั้งคู่อยู่แล้ว (กรอกฟอร์ม Inbound/Outbound/เลขโอนใน Order ทุกใบ ไม่ใช่แค่ใบที่ส่งถึงคลัง)

**Trigger ที่แจ้งจัดซื้อ (6 จุด · 3 เมนู) และคลังสินค้า (4 จุด · 2 เมนู):**

| เมนู | จุด | แจ้งจัดซื้อ | แจ้งคลัง |
|---|---|---|---|
| Order | `saveOrder` — สาขาสร้าง Order ใหม่ | ✓ `สาขาเพิ่ม Order ใหม่` | ✓ `สาขาเพิ่ม Order ใหม่` |
| Order | `applyStepChange` (`selectedOrderTable === 'ss_orders'`) — สาขากดตรา 3 ขั้น | ✓ `สาขาอัปเดตสถานะ Order` | ✓ `สาขาอัปเดตสถานะ Order` |
| BackOrder | `saveBackOrder` — สาขาสร้าง BackOrder ใหม่ | ✓ `สาขาเพิ่ม BackOrder ใหม่` | ✓ `สาขาเพิ่ม BackOrder ใหม่` |
| BackOrder | `applyStepChange` (`selectedOrderTable === 'ss_backorders'`) — สาขากดตรา 3 ขั้น | ✓ `สาขาอัปเดตสถานะ BackOrder` | ✓ `สาขาอัปเดตสถานะ BackOrder` |
| Request Item | `saveRequest` — สาขาขอสินค้าใหม่ | ✓ `สาขาขอสินค้าใหม่ (Request Item)` | ✕ (นอกขอบเขต — SKU/MOQ เป็นงานจัดซื้อ) |
| Request Item | `applyEditPatch` — สาขาแก้ไขคำขอ | ✓ `สาขาแก้ไข Request Item` | ✕ (นอกขอบเขต) |

- **จัดซื้อเข้าร่วมทิศ BackOrder แล้ว 2569-08-19** — เดิม 2 แถว BackOrder เป็น `✕ (นอกขอบเขต)` เพราะจัดซื้อดูแลเฉพาะ `ABC = P` · ผู้ใช้ขอเปิดให้จัดซื้อ "รับทราบ" ตอนเพิ่มโปรไฟล์ Sale Admin เข้าเมนูนี้ · **มีผลกับทุกสาขา ไม่ใช่แค่ Sale Admin**
- ⚠️ `applyStepChange` **ใช้ร่วมกับ BackOrder** (`selectedOrderTable` เป็นได้ทั้ง 2 ตาราง) — ทั้งฝั่งจัดซื้อและฝั่งคลัง**ไม่กรองตารางแล้ว** แต่ **meta ต้องใช้ `orderDetailMenuId` / `selectedOrderTable` ห้าม hardcode `'order'`/`'ss_orders'`** ไม่งั้นแจ้งเตือนของ BackOrder จะพาไปเปิดเมนู Order ด้วย id ของ BackOrder แล้วหาแถวไม่เจอ (ของเดิม hardcode ไว้ได้เพราะ guard การันตีว่าเป็น Order เสมอ — พอถอด guard ต้องแก้คู่กัน)
- ⚠️ `applyEditPatch` **ใช้ร่วมกับ products/newproduct/ticket และ popup Order** จึงต้องครอบ `if (meta.menuId === 'request')` ก่อนแจ้งจัดซื้อ — ไม่งั้นทุกเมนูจะแจ้งจัดซื้อหมด (ทิศนี้ไม่มีสมการเทียบเท่าฝั่งคลัง — Request Item อยู่นอกขอบเขตของคลังทั้งหมด)
  - เงื่อนไข `meta.detail !== ''` ที่ครอบอยู่แล้วกันกรณีกดบันทึกทั้งที่ไม่ได้แก้อะไร (`describeChangedFields` คืน `''`) — ทั้ง 3 ทิศจึงเงียบเหมือนกัน
- ⚠️ **ห้าม gate `saveOrder` ด้วย `recipientDepartment === 'PURCHASING'`** — ค่า `'BOTH'` (SKU ไม่มีใน Product Master) จัดซื้อก็ต้องเห็น (คลังไม่ต้องกังวลข้อนี้เพราะไม่กรอง `recipient_department` อยู่แล้ว)
- จัดซื้อเห็น Request Item **ทุกสาขา** (query ไม่กรอง branch สำหรับเมนูนี้) คลิกแจ้งเตือนจึงเปิดใบนั้นได้เสมอ ต่างจาก Order ที่จัดซื้อกรอง `recipient_department`
- คลิกแจ้งเตือนเปิดใบได้เสมอทุกโปรไฟล์ เพราะทั้ง `id: 'order'` และ `id: 'backorder'` **ไม่มี `roles` แล้ว** (ทุกโปรไฟล์เห็น) — ไม่ชนกับ whitelist ใน `openNotificationEvent` · 🚨 **เปิดทิศแจ้งเตือนใหม่ไปเมนูไหน ต้องเช็คก่อนเสมอว่าผู้รับเห็นเมนูนั้นไหม** ไม่งั้น badge ขึ้นแต่คลิกแล้วตันโดยไม่มี feedback (นี่คือเหตุผลที่ BackOrder เคยกันจัดซื้อไว้ — พอเปิดทิศต้องถอด `roles` คู่กัน)

**Schema (migration `202608170001_purchasing_notification_events.sql` เพิ่มจัดซื้อ, `202608180001_warehouse_notification_events.sql` เพิ่มคลังสินค้า):**
- ⚠️ คอลัมน์ยังชื่อ **`branch` แต่ความหมายคือ "ผู้รับ"** แล้ว (`SRC/KKL/SSS` = สาขา, `SALE_ADMIN` = Sale Admin, `PURCHASING` = จัดซื้อ, `WAREHOUSE` = คลังสินค้า) — ไม่ rename เพราะมี query/RPC/retention/realtime filter อ้างอยู่หลายจุด · มี `comment on column` กำกับไว้ใน DB
- CHECK `branch` = **6 ค่า** (`SRC/KKL/SSS/SALE_ADMIN/PURCHASING/WAREHOUSE`) · CHECK `actor_code` = **6 ค่า** (`WAREHOUSE/PURCHASING/SRC/KKL/SSS/SALE_ADMIN`)
- `SALE_ADMIN` เพิ่มโดย `202608190001_sale_admin_branch_code.sql` — **migration แรกที่ต้องขยาย `actor_code` ด้วย** (2 รอบก่อนหน้าเพิ่มแค่ฝั่งผู้รับ) เพราะ Sale Admin เป็นผู้กระทำที่ยิงหาจัดซื้อ/คลัง ถ้าลืมข้อนี้ insert โดน CHECK ปฏิเสธทั้งแถวทั้งที่ผู้รับถูกต้อง
- ⚠️ **`NOTIFIED_BRANCHES` (ฝั่งเว็บ) = `BRANCH_PROFILE_CODES`** ต้องมี `SALE_ADMIN` ด้วยเสมอ — `notifyBranchUpdate` ใช้ลิสต์นี้ตัดสินว่ารู้จักรหัสผู้รับไหม **ถ้าไม่รู้จักจะ fan-out ไปทั้ง 3 สาขาแทน** (จัดซื้อแก้แถวของ Sale Admin แล้ว SRC/KKL/SSS ได้แจ้งเตือนไปด้วยทั้งที่ไม่เกี่ยว)
- ⚠️ RPC `ss_create_branch_notifications` มี filter `in (...)` **2 จุด** (insert เหตุการณ์ + upsert ตารางสรุป) — **ลืมจุดที่สอง = เหตุการณ์ลงตารางแต่ realtime ไม่ยิง** badge ขึ้นช้า 30 วิแบบสุ่ม หาสาเหตุยากมาก
- ⚠️ `salesupport-setup.sql` ใช้ `create table if not exists` → CHECK ที่เขียน inline **ไม่ถูกใช้กับตารางที่มีอยู่แล้ว** จึงต้องมีทั้งแบบ inline (ติดตั้งใหม่) และแบบ `drop/add constraint` (DB เดิม) คู่กันเสมอ — migration ของคลังอัปเดตทั้ง 2 แบบในไฟล์เดียวกันแล้ว
- ⚠️ **ต้องรัน `202608180001_warehouse_notification_events.sql` ก่อน deploy frontend ที่เรียก `notifyWarehouseUpdate`** เหมือนกับ migration ของจัดซื้อ — ไม่งั้น RPC กรอง `'WAREHOUSE'` ทิ้งเงียบๆ ปุ่ม "🔔 อัพเดท" ของคลังขึ้นมาแต่ค้าง 0 ตลอด ไม่มี error ให้เห็น
- **ไม่ backfill เหตุการณ์ย้อนหลังให้คลัง** ต่างจาก migration ของจัดซื้อที่ backfill จาก Order ค้างอยู่ ณ ตอน cutover — เพราะทิศนี้ไม่ได้แทนที่ "Order ใหม่" เดิม (ยังใช้คู่ขนานกันต่อไป) จึงไม่มีอะไรต้อง cutover ให้ต่อเนื่อง เริ่มนับจากศูนย์พอ

- ⚠️ **บั๊ก 2569-08-17 (แก้แล้ว):** เดิมทั้ง 3 จุดของฝั่งแผนกใช้ `.eq('recipient_department', departmentCode)` เฉยๆ — Order ที่ `recipient_department = 'BOTH'` จึง **ไม่เคยขึ้นแจ้งเตือนให้ใครเลย** ทั้งที่เห็นในตารางปกติ (ตารางใช้ `.in()` อยู่แล้ว) เจอจากเคสจริง SKU `101369` ของสาขา SSS · ตอนนี้เหลือใช้กับคลังอย่างเดียวและใช้ `.in()` แล้ว (ปุ่ม "Order ใหม่" เดิม — ไม่เกี่ยวกับปุ่ม "อัพเดท" ใหม่ของคลังที่ไม่กรอง `recipient_department` เลย)
- **Request Item แจ้งจัดซื้อแล้ว (2569-08-18)** — ผ่าน `notifyPurchasingUpdate` เหมือน Order ไม่ต้องเพิ่มคอลัมน์ใน `ss_request_items` เลย เพราะตารางเหตุการณ์เก็บ `menu_id`/`table_name`/`record_id` เป็น text อยู่แล้ว · เมนูอื่น (New Product / Ticket) ยังไม่มี ถ้าจะเพิ่มใช้ pattern เดียวกันได้ทันที
- **BackOrder แจ้งคลังแล้ว (2569-08-18)** — ผ่าน `notifyWarehouseUpdate` เหมือนกัน ไม่ต้องเพิ่มคอลัมน์เช่นกัน

## ตาราง Order — ดีไซน์ Two-line Row (ไม่ต้องเลื่อนแนวนอน)

24 คอลัมน์เดิมรวม `min` = **2,834px** ล้นทุกจอ (จอ 1920 มีที่ ~1,738px · แม้จอ 2560 ก็ยังเกิน 19%) → ยุบเหลือ **12 ช่อง** ด้วยดีไซน์ **"Two-line Row"** (แบบที่ 2 จาก `public/order-table-layout-designs.html`) ตามคำสั่งผู้ใช้ 2569-08-15

- **ข้อมูลยังครบ 24 ค่าเท่าเดิม ไม่ได้ตัดคอลัมน์ไหนทิ้ง** — ยัด 2 ค่าลงช่องเดียวคนละบรรทัด: บรรทัดบน = `label` · บรรทัดล่างตัวเล็กสีจาง = `sub.label`
- จับคู่ให้เป็น**เรื่องเดียวกัน**เพื่อให้อ่านคู่กันแล้วได้ความ: `เลขบิลขาย / เลขบิลสั่งซื้อ` · `วันชำระ / วันนัดรับ` · `Inbound / Outbound` · `ชื่อลูกค้า / เบอร์โทร`
- 3 ชิปสถานะยุบเป็นช่องเดียว (`kind: 'chips'` + `chipKeys: ORDER_STEP_KEYS`) เรียงลงมาตามลำดับงาน
- **วัดจริงด้วย `App.css` ตัวจริง + ฟอนต์จริง (Chrome headless):** ตารางต้องการ **1,500px** (ลดจากเดิม **47%**)

| จอ | ที่ว่าง | ผล |
|---|---|---|
| 1920 | 1,738px | ✅ พอดี เหลือ 238px |
| 1600 | 1,418px | ⚠️ ล้น 82px — ลากคอลัมน์ SKU (`--sku-name-width` default 320px) ให้แคบลงแล้วพอดี |
| 1366 | 1,184px | ⚠️ ล้น 316px |

**จุดที่ต้องระวังเวลาแก้ต่อ:**
- ⚠️ `ColumnDef.sub` เป็น **`ColumnDef` เต็ม ๆ ไม่ใช่แค่ key** — เพราะ `formatCell` ต้องใช้ `kind` ของบรรทัดล่างเอง (ไม่งั้นวันที่จะโชว์เป็น ISO ดิบ)
- ⚠️ `<td>` **ห่อด้วย `.ss-cell-main` เฉพาะคอลัมน์ที่มี `sub`** — เมนูอื่น (Products / Request / Ticket / BackOrder) ไม่มี `sub` จึง render โครงเดิมเป๊ะ ไม่ได้รับผลกระทบ
- ⚠️ `min` ในคอลัมน์คู่คือความกว้างของ**ทั้งช่อง** = ค่าที่กว้างกว่าใน 2 บรรทัด **ไม่ใช่ผลรวม**
- ⚠️ `ORDER_STEP_KEYS` ประกาศ**ก่อน** `MENUS` แล้ว `ORDER_STEPS` อ้างค่าจากตัวนี้ (`key: ORDER_STEP_KEYS[0]`) — แหล่งเดียว ห้ามพิมพ์ key ซ้ำอีกที่
- `ORDER_DETAIL_FIELDS` (popup) / `EDIT_FIELDS` (ฟอร์มแก้ไข) เป็นคนละลิสต์กับ `MENUS[order].columns` — เปลี่ยนคอลัมน์ตารางไม่กระทบ popup
- ป้าย `.ss-out-badge` / `stampStatusBadge` ยังผูกกับ `sku_name` ซึ่งยังเป็นคอลัมน์แรกเหมือนเดิม
- **BackOrder ใช้ดีไซน์เดียวกันแล้ว 2569-08-19** — ดูหัวข้อ "ตาราง BackOrder" ด้านล่าง (แกลเลอรีของมันเองอยู่ที่ `public/backorder-table-layout-designs.html`)

## เมนู Request Item — SKU/MOQ เป็นงานฝั่งจัดซื้อ แต่ทุกโปรไฟล์ดูได้ (2569-08-17)

`ss_request_items` ไม่มี `roles` ที่ระดับเมนู (ทุกโปรไฟล์เห็นเมนูนี้) — `sku` และ `moq` เป็นข้อมูลที่**จัดซื้อเป็นคนกรอก แต่สาขา/คลังต้องมองเห็นได้** (สาขาต้องรู้ว่าจัดซื้อลง SKU/MOQ ไว้แล้วหรือยัง) จึงกันแค่**สิทธิ์แก้ไข** ไม่ใช่การมองเห็น — ทั้งคู่ตอนนี้พฤติกรรมเหมือนกันทุกจุด:

| จุด | non-purchasing | purchasing |
|---|---|---|
| คอลัมน์ในตาราง (`MENUS['request'].columns`) | เห็นเป็นข้อความอ่านอย่างเดียว | เห็นเป็น `<input>` พิมพ์แก้ตรงๆ ได้ |
| ฟอร์มแก้ไข (`DetailEditForm`) | ไม่เห็นช่องนี้เลย (`hideKeys={!isPurchasing ? ['sku', 'moq'] : undefined}`) | เห็นแก้ได้ |
| ฟอร์ม ➕ Add Request Item | ไม่เห็นช่อง SKU เลย (สาขายังไม่รู้ SKU ตอนขอสินค้าใหม่) ไม่มีช่อง MOQ ให้ใครกรอกตอนสร้างอยู่แล้ว | เห็นช่อง `SKU *` บังคับกรอก |

- ⚠️ **`sku` เคยถูกซ่อนทั้งคอลัมน์ตารางสำหรับ non-purchasing มาก่อน** (ตัวแปร `hideRequestSku` กรอง `visibleColumns`) — **เอาออกแล้ว 2569-08-17** ตามคำสั่งผู้ใช้ "สาขาต้องเห็นคอลัมน์ SKU ด้วยเนื่องจากจัดซื้อจะลงข้อมูลมา (แต่สาขาแก้ไขไม่ได้)" — `visibleColumns` ตอนนี้คือ `menu.columns` ตรงๆ ไม่มีการกรองพิเศษของ Request Item อีกแล้ว
- `leadtime` / `exp` / `availability` / `status` เป็นฟิลด์ "จัดซื้อกรอกทีหลัง" แนวคิดเดียวกัน แต่**ยังไม่มีการกรองสิทธิ์แก้ไข** — ยังแก้ได้ทุกโปรไฟล์ผ่าน `DetailEditForm` (ไม่ได้ขอมา จึงยังไม่แตะ)

**คอลัมน์ MOQ + SKU กรอกตรง ๆ ในตารางได้สำหรับจัดซื้อ** — ไม่ต้องเปิด ✏️ แก้ไขทุกครั้ง เหมือนกับที่ `status`/`availability` มีอยู่แล้วในตาราง Request Item แต่ทั้งคู่เป็น **text ไม่มีชุดตัวเลือกตายตัว** จึงใช้ `<input>` แทน `<select>`:
- `updateRequestMoq(id, moq, branch, itemSku, itemName)` / `updateRequestSku(id, sku, branch, itemName)` — คู่กับ `updateStatus`/`updateRequestAvailability` เดิม เขียน Supabase ตรง ๆ แล้ว `setRows` อัปเดต state โดยไม่ refetch ทั้งตาราง (ค่าว่าง → `null` ไม่ใช่ `''`)
  - ⚠️ `updateRequestSku` **ไม่มีพารามิเตอร์ `itemSku`** แบบตัวอื่น — เพราะค่าที่กำลังแก้คือ SKU เอง จึงส่งค่าใหม่ (`value`) เป็น `itemSku` ใน `notifyBranchUpdate` ตรงๆ แทนที่จะรับ `row.sku` (ค่าเก่า) เข้ามาแล้วไม่ได้ใช้
- render เงื่อนไข `activeMenu === 'request' && col.key === 'moq'/'sku' && isPurchasing` (แถวคู่กับ status/availability ในตัวจัดการเซลล์) — ไม่ผ่านเงื่อนไขตกไป render เป็นข้อความอ่านอย่างเดียวเหมือนคอลัมน์ทั่วไป (path เดียวกับที่ `formatCell` ใช้)
- **`<input>` เป็น uncontrolled + คอมมิตตอน `onBlur`** (Enter = trigger blur ผ่าน `e.currentTarget.blur()`) ไม่ใช่ controlled เขียนทุก keystroke เหมือน `<select>` เพราะข้อความยาวกว่า พิมพ์ทีละตัวแล้วยิง Supabase ทุกตัวอักษรจะช้าและไม่จำเป็น
- ⚠️ **`key` ของ `<input>` ผูกกับค่าปัจจุบันของฟิลด์นั้นด้วย** (`` `${row.id}-${currentMoq}` `` / `` `${row.id}-${currentSku}` `` ไม่ใช่แค่ `row.id`) — บังคับ React remount ช่อง uncontrolled นี้ทุกครั้งที่ค่าจาก DB เปลี่ยน (คอมมิตเอง หรือ refetch จากเมนูอื่นกลับมา) ไม่งั้น `defaultValue` จะค้างค่าตอน mount ครั้งแรกไม่ยอมอัปเดตตามข้อมูลจริง — ทดสอบแล้วว่าจำเป็นจริง (ยืนยันด้วย DB round-trip ผ่าน headless Chrome ทั้ง MOQ และ SKU)
- CSS `.ss-status-input` ลอก property จาก `.ss-status-select` ทุกตัวเพื่อให้แถวเดียวกันดูเป็นชุดเดียวกัน + คอลัมน์ `th.ss-col-moq`/`th.ss-col-sku` ขยายเป็น 100px (จาก `min: 80` ใน `MENUS`) ให้พิมพ์สบายขึ้น

**ฟอร์ม ➕ Add Request Item ล็อกสาขาตามรหัสที่ล็อกอินแล้ว** (`.ss-branch-locked-value` ไอคอน 🔒 แก้ไม่ได้ — แบบเดียวกับ New Order/Add BackOrder) — เดิม `emptyRequestForm()` default เป็น `SRC` เฉยๆ ทำให้ KKL/SSS สร้าง Request Item ผิดสาขาได้ (สร้างของ KKL ไปตกอยู่สาขา SRC โดยไม่รู้ตัว) · แก้ 2569-08-17 ตามแบบเดียวกับ `openAddOrder`/`openAddBackOrder`:
- `openAddRequest` ตั้ง `branch: isBranchUser ? (userBranch ?? 'SRC') : initialRequest.branch` ตอนเปิดฟอร์ม
- `saveRequest` **คำนวณสาขาซ้ำอีกทีตอนบันทึก** (`requestBranch = isBranchUser ? (userBranch ?? 'SRC') : requestForm.branch`) ไม่ได้เชื่อ `requestForm.branch` ตรงๆ — กันเหนียวสองชั้นแบบเดียวกับ Order/BackOrder
- คลัง/จัดซื้อยังเลือก dropdown ได้ตามปกติ (ตัวเลือกยังมี `Warehouse` เป็นตัวที่ 4 จาก `ORDER_BRANCHES` — ต่างจาก BackOrder ที่ใช้ `BACKORDER_BRANCHES` แค่ 3 สาขา)
- ⚠️ **New Product / Ticket มีช่อง "สาขา \*" แบบ dropdown เปล่าเหมือนกัน ยังไม่ได้ล็อก** — บั๊กคลาสเดียวกัน แต่โจทย์นี้ระบุเฉพาะ Request Item จึงยังไม่แตะ 2 เมนูนั้น

## เมนู BackOrder — สินค้าค้างส่ง (ABC ≠ P)

ตาราง `ss_backorders` แยกจาก `ss_orders` · **ทุกโปรไฟล์เห็นเมนูนี้** (ไม่มี `roles` ใน `MENUS` แล้ว)

- **จัดซื้อเพิ่งเข้ามาเห็นเมนูนี้ได้ 2569-08-19** — เดิม `roles: ['branch','warehouse']` กันไว้เพราะ BackOrder คือของ `ABC ≠ P` ส่วนจัดซื้อดูแลเฉพาะ `ABC = P` · ถอดออกตามคำขอผู้ใช้ให้จัดซื้อ "รับทราบ" ข้อมูลด้วย
  - **จัดซื้อแก้แถวที่มีอยู่ไม่ได้** — popup ตัดทั้งปุ่มตราประทับและฟอร์มจัดซื้อออก (`isPurchasing && isBackOrderDetail` → ข้อความบอกว่าดูอย่างเดียว)
  - แต่ยัง**เพิ่มแถวแทนสาขาได้เหมือนคลัง** เพราะปุ่ม ➕ Add BackOrder ไม่มี role gate (แบบเดียวกับ ➕ New Order) · เคสนี้ `notifyPurchasingUpdate`/`notifyWarehouseUpdate` เงียบทั้งคู่ (guard `isBranchUser`) เหลือแต่ `notifyBranchUpdate` แจ้งสาขาเจ้าของแถว — สมเหตุสมผลและตรงกับพฤติกรรมของคลังที่มีมาก่อน
  - 🚨 **ห้ามปล่อยให้จัดซื้อตกไป `else` ของ popup** — จะได้ปุ่มตรา 3 ขั้นซึ่งเป็นงานสาขา และ `applyStepChange` **ไม่มี role guard ข้างในเลย** (ทั้งไฟล์คุมสิทธิ์ตราประทับด้วยการซ่อนปุ่มล้วน ๆ) จัดซื้อจึงกดเปลี่ยนสถานะได้จริงถ้าปุ่มโผล่
- `BACKORDER_BRANCHES` = `SRC/KKL/SSS/SALE_ADMIN` (ไม่มี `Warehouse` — คลังเป็นผู้รับงานไม่ใช่ผู้ขอ) ต้องตรงกับ CHECK ของ `ss_backorders.branch` เป๊ะ ๆ
- สาขา/Sale Admin เห็นเฉพาะของตัวเอง (`.eq('branch', userBranch)` ใน query) · คลัง+จัดซื้อเห็นทุกสาขา จึงมีคอลัมน์ `Branch` ในตารางไว้แยกว่าแถวไหนของใคร

**⚠️ มี 2 คอลัมน์ตัวเลขคนละที่มา อย่าสลับกัน** (ตั้งชื่อตามคำสั่งผู้ใช้ 2569-08-15):

| คอลัมน์ | key | ที่มา | เก็บในตาราง? |
|---|---|---|---|
| **คลังมีสินค้า** | `stock_qty` | ยอดสดจาก `stock` สาขา `คลังสินค้า` | ✕ เติมหลัง fetch |
| **ค้างส่งลูกค้า** | `pending_qty` | สาขาพิมพ์เองในฟอร์ม ➕ Add BackOrder | ✓ `numeric` |

- **"คลังมีสินค้า" ทุกโปรไฟล์เห็นยอดของ `คลังสินค้า` เหมือนกัน** — สาขาต้องรู้ว่า**คลัง**มีของพอส่งไหม ไม่ใช่ว่าตัวเองเหลือเท่าไหร่ (เคยลองเปลี่ยนเป็นสต๊อกของสาขาเองแล้วผู้ใช้ยืนยันให้กลับมาเป็นของคลัง 2569-08-15)
- **"ค้างส่งลูกค้า" เป็นช่องบังคับ** ในฟอร์ม (`ค้างส่งลูกค้า *`, ต้อง > 0) เหมือน `จำนวน *` ของ New Order — แถวค้างส่งที่ไม่รู้จำนวนคลังเอาไปทำงานต่อไม่ได้
- **คอลัมน์ `unit` = หน่วยของบาร์โค้ดที่สแกน/เลือก** — ใน `products` **1 barcode ผูกกับ 1 หน่วยเสมอ** (ตรวจแล้วไม่ชนกันเลย) เช่น SKU 100098 มี 4 บาร์โค้ด: `แผง ×1` / `10แผง ×10` / `โหล ×12` / `กล่อง ×50`
  - ⚠️ **ตัวเลขในคอลัมน์ "คลังมีสินค้า" นับด้วยหน่วยของ `stock` ซึ่งเป็นหน่วยเล็กสุดเสมอ** (ตรวจกับข้อมูลจริงแล้ว `stock.unit` = แถวที่ `base_multiple = 1` ทุกตัวอย่าง) จึงอาจเป็นคนละหน่วยกับคอลัมน์ "หน่วย" — เช่น คลังมี `530` (แผง) แต่หน่วยที่บันทึกไว้คือ `กล่อง`
  - ตามคำสั่งผู้ใช้ (2569-08-14) **คอลัมน์จำนวนแสดงแค่ตัวเลข ไม่ต่อท้ายหน่วย** — หน่วยที่คลังนับย้ายไปอยู่ใน `title` (hover แล้วขึ้น `คลังนับเป็น แผง`) อย่าเอากลับมาต่อท้ายตัวเลข
- **"คลังมีสินค้า" + หน่วยที่คลังนับ ไม่ได้เก็บในตาราง** — `loadWarehouseStock()` ดึงสดจาก `stock` ที่ `branch = 'คลังสินค้า'` จับคู่ด้วย `sku` แล้วเติมเป็น `stock_qty` / `stock_unit` หลัง fetch (แบบเดียวกับที่เมนู Products เติม Distributor ด้วย `loadSupplierMap`)
  - ⚠️ **ไม่มีแถวใน `stock` = ไม่มีของจริง → แสดง `0` ไม่ใช่ช่องว่าง** — ตรวจข้อมูลจริงแล้ว **ไม่มีแถว `qty = 0` เลยสักสาขา** (มีแต่ค่าติดลบ) แปลว่าไฟล์ export ตัดของหมดสต๊อกออก
  - ⚠️ `loadWarehouseStock` คืน **`null` เมื่อ query error** (ไม่ใช่ map ว่าง) แล้วผู้เรียกปล่อยช่องว่างแทน `0` — ถ้าคืน map ว่างทุกแถวจะกลายเป็น `0` = "ไม่มีของ" ทั้งที่จริงคือ "อ่านไม่ได้"
  - ⚠️ **ไม่ cache** ต่างจาก `loadSupplierMap` เพราะสต๊อกถูกเขียนทับใหม่ทุก 5 นาทีจาก Task Scheduler
  - `stock.qty` เป็น `text` ค่าจริงหน้าตา `"13.0000"` → ต้อง `Math.floor(Number(...))` เหมือน `StockCheckPage` · ค่าที่ไม่ใช่ตัวเลขคงไว้ตามเดิม
  - ⚠️ ใช้ค่าคงที่ `WAREHOUSE_STOCK_BRANCH = 'คลังสินค้า'` **ห้ามใช้ `Profile.branch`** เพราะโปรไฟล์คลังมีค่าเป็น `null` (ตรงกับ `WAREHOUSE_BRANCH` ใน `OutboundPage.tsx`)
  - ดึงเฉพาะ SKU ที่อยู่บนหน้าจอด้วย `.in()` — cap 1000 แต่ตารางนี้ `limit 500` จึงพอเสมอ
- ช่อง SKU ในฟอร์ม ➕ Add BackOrder **กรอง `ABC = P` ออกฝั่ง client ไม่ใช่ `.neq('abc','P')`** — SQL จะตัดแถวที่ `abc` เป็น `null` ทิ้งไปด้วย (`null <> 'P'` คืน `null`) · ดึง `.limit(40)` แล้วค่อยกรองเหลือ 8 กันกรณีผลลัพธ์ต้น ๆ เป็น P ทั้งชุดแล้วรายการว่างเปล่า (ดูหัวข้อ "ช่องค้นหา SKU" ด้านบน)
  - ค่า ABC จริงในฐานข้อมูล (ส.ค. 2569): `C` 1,160 · `A` 916 · `B` 857 · `P` 685 · `D` 426 · `REVIEW` 45 — **ไม่มีค่าว่างเลย**
- **popup ใช้ตัวเดียวกับ Order** — `selectedOrderTable` state จำว่าแถวที่เปิดมาจากตารางไหน แล้ว `toggleOrderStep` / `saveWarehouseFields` ยิงไปตารางนั้น
  - ⚠️ อ่านจาก `activeMenu` แทนไม่ได้ — ฟังก์ชันบันทึกต้องผูกกับ**แถวที่เปิดอยู่** ไม่ใช่เมนูที่กำลังดู
  - คลังกรอกช่องเดียว (`BACKORDER_WAREHOUSE_FIELDS` = `outbound_date`) ต่างจาก Order ที่มี 3 ช่อง — เลือกด้วย `warehouseFieldsFor(table)`
  - ไม่มีฟอร์มจัดซื้อ (คอลัมน์ `order_type` ฯลฯ ไม่มีใน `ss_backorders`) — สาขา `isPurchasing && isBackOrderDetail` ตัดจัดซื้อออกก่อนถึงทั้งฟอร์มจัดซื้อและปุ่มตรา เหลือข้อความ "ดูข้อมูลได้อย่างเดียว" · **จำเป็นตั้งแต่จัดซื้อเข้าเมนูนี้ได้ 2569-08-19** ก่อนหน้านั้นเป็นแค่การกันเหนียว
- ⚠️ **ค่า default ของ 3 สถานะใน SQL ต้องสะกดตรงกับ `ss_orders` เป๊ะ ๆ** เพราะ `stepDone()` ตัดสินด้วยการหาคำว่า `"แล้ว"` ในสตริง
- **ป้าย `.ss-out-badge` (Days Badge) ใช้ร่วมกับ Order** — `showOutboundAlert` / `stampStatusBadge` เช็คผ่านตัวแปร `isStampMenu` (`activeMenu === 'order' || 'backorder'`) · ใช้ได้เพราะ `ss_backorders` มี `outbound_date` + 3 คอลัมน์สถานะ ชื่อเดียวกับ `ss_orders`
- **ไม่มีเมนูย่อย 3 ขั้น** ใต้ปุ่ม BackOrder — `stepCounts` ยังนับจาก `ss_orders` อย่างเดียว (ยังไม่ได้ขอมา)

### ตาราง BackOrder — ดีไซน์ Two-line Row (2569-08-19)

15 คอลัมน์เดิมรวม `min` = **1,760px** ล้นตั้งแต่จอ 1920 (มีที่ ~1,738px) → ยุบเหลือ **10 ช่อง** ด้วยดีไซน์เดียวกับตาราง Order (แบบที่ 2 จาก `public/backorder-table-layout-designs.html`) ตามคำสั่งผู้ใช้

- ใช้กลไกเดิมทั้งหมด (`ColumnDef.sub`, `kind: 'chips'`, CSS `.ss-cell-main`/`.ss-cell-sub`/`.ss-col-sub-label`/`.ss-chip-stack`) — **ไม่ได้เพิ่มโค้ด render ใหม่เลย** แค่เปลี่ยน config `MENUS[backorder].columns`
- คู่ที่จับ: `ค้างส่งลูกค้า / หน่วย` · `ชื่อลูกค้า / เบอร์โทรติดต่อ` · `วันชำระ / วันนัดรับ` · `Outbound / เลขโอน` · `หมายเหตุ / TimeStamp` · 3 ชิปสถานะยุบเป็นช่องเดียว
- 🚨 **`stock_qty` กับ `pending_qty` ตั้งใจแยกช่องกัน ห้ามจับคู่เป็น 2 บรรทัด** — เป็นตัวเลข 2 ตัวคนละแหล่ง (ดูตารางด้านบน) วางซ้อนกันในช่องเดียวจะอ่านสลับกันง่ายมาก และ `stock_qty` มี tooltip เฉพาะตัว (`คลังนับเป็น …`) ที่ชนกับ tooltip ของช่องคู่พอดี (ในโค้ด `col.key === 'stock_qty'` ถูกเช็คก่อน `col.sub` → บรรทัดล่างจะหายจาก tooltip เงียบ ๆ)
- **`created_at` โผล่ในตารางเป็นบรรทัดล่างของ "หมายเหตุ"** — ค่านี้มีในตารางอยู่แล้ว (เห็นใน popup) แต่เดิมไม่ได้แสดงในตาราง ตรงกับที่ Order ทำ

**คอลัมน์ `phone` เพิ่มใหม่พร้อมกัน** (migration `202608190003_backorder_phone.sql`) — เดิม `ss_backorders` ไม่มีเบอร์โทรเลย

- ช่อง "เบอร์โทรติดต่อ" ในฟอร์ม ➕ Add BackOrder (ใต้ "ชื่อลูกค้า") · ไม่บังคับกรอก
- ⚠️ **ไม่มี `contact_channel` คู่กันเหมือน `ss_orders`** — แต่ `formatCell` มี branch พิเศษที่เอา `contact_channel` มาต่อหน้า `phone` เสมอ · ปลอดภัยเพราะ `ss_backorders` ไม่มีคอลัมน์นั้น ค่าจึงเป็น `undefined` แล้วถูก `filter(Boolean)` ทิ้ง เหลือแค่เบอร์ · **ถ้าวันหลังเพิ่ม `contact_channel` เข้า `ss_backorders` มันจะโผล่หน้าเบอร์เองอัตโนมัติ** (ตั้งใจได้ แต่ต้องรู้ไว้)
- ⚠️ **ต้องรัน migration ก่อน deploy** — อ่านตารางยังปกติเพราะ query เป็น `select('*')` แต่ `saveBackOrder` จะ insert ไม่ผ่าน (`column ss_backorders.phone does not exist`)
- `ss_backorders` **ไม่มีใน `EDIT_FIELDS`** (ไม่มีฟอร์มแก้ไขทั้งใบ) จึงไม่ต้องเพิ่ม `phone` ที่นั่น — เพิ่มใน `BACKORDER_DETAIL_FIELDS` (popup) อย่างเดียว

## Popup Order — โหมดคลังสินค้า

โปรไฟล์คลังสินค้า (รหัส `0000`) เห็น popup Order คนละแบบกับสาขา/จัดซื้อ:

| | สาขา | จัดซื้อ | คลังสินค้า |
|---|---|---|---|
| ปุ่ม ✏️ แก้ไข (ทั้งใบ) | ✕ | ✓ | **✕** |
| ตราประทับ 3 ขั้น | ✓ | ✓ | **✕ — แทนด้วยฟอร์ม 3 ช่อง** |

- ฟอร์มคลัง = `WAREHOUSE_FIELDS`: `inbound_date` (Inbound วันที่รับของ) · `outbound_date` (Outbound วันที่ส่งของ) · `transfer_no` (เลขโอนสินค้า/เลขจัดส่ง)
- **3 คอลัมน์นี้มีอยู่ใน `ss_orders` + `MENUS` ของ Order อยู่แล้ว** ไม่ต้องแก้ schema · กดบันทึกแล้ว `setRows` อัปเดตแถวในตารางทันทีโดยไม่ refetch
- ⚠️ **ช่องว่างต้องส่งเป็น `null` ไม่ใช่ `''`** — คอลัมน์ `date` ใน Postgres ตอบ `22007 invalid input syntax for type date` ถ้าได้สตริงว่าง (ทดสอบกับ DB จริงแล้ว)
- คลังไม่เห็น 3 ช่องนี้ในส่วนอ่านอย่างเดียวด้านบน (`orderDetailFields` กรอง `WAREHOUSE_KEYS` ออก) เพราะกรอกอยู่ในฟอร์มด้านล่างแล้ว
- ⚠️ `useEffect` ที่รีเซ็ตฟอร์ม **ผูกกับ `selectedOrder?.id` ไม่ใช่ทั้งอ็อบเจกต์** — `setSelectedOrder` ถูกเรียกทุกครั้งที่บันทึก ถ้าผูกทั้งอ็อบเจกต์จะล้างสิ่งที่พิมพ์ค้างไว้

## Toast แจ้งผลกดตราประทับ (Order / BackOrder)

pill กลางบนจอ โผล่ทุกครั้งที่กดตราใน popup — ดีไซน์ **"Top Center Drop"** (แบบที่ 2 จาก `public/stamp-toast-designs.html`) · เดิมกดแล้วสำเร็จ**เงียบสนิท** ไม่มีอะไรยืนยันนอกจากตราเปลี่ยนสี

- `pushStampToast(tone, title, detail)` ใน `SaleSupportPage.tsx` — 3 โทน: `ok` เขียว (อนุมัติแล้ว) · `cancel` ทอง (ยกเลิกสถานะแล้ว) · `error` แดง (อัปเดตไม่สำเร็จ)
- ข้อความ detail คือ `${step.label} → ${next}` = ค่าจริงที่เพิ่งเขียนลง DB (`ของถึงสาขา → ถึงแล้ว` / `→ ยังไม่ถึง`)
- ค้างพร้อมกันได้ `STAMP_TOAST_MAX = 2` ใบ (`.slice(-2)`) · อยู่บนจอ `STAMP_TOAST_MS = 3400` ms
- **ถอด toast ออกด้วย `onAnimationEnd` ไม่ใช่ timer ใบที่สอง** — timer แค่ตั้ง `leaving: true` แล้ว CSS animation จบเมื่อไหร่ค่อยถอดออกจาก state
- ⚠️ `.ss-toast-layer` **render อยู่ตลอดแม้ไม่มี toast** เพราะ `aria-live` ต้องมี live region อยู่ก่อนข้อความจะถูกใส่ → ต้องมี `pointer-events: none` ไม่งั้นเป็นแผ่นใสบังปุ่มกลางบนจอ
- ⚠️ `z-index: 1200` — ต้องสูงกว่า `.dl-modal-overlay` (1000) เพราะยิงตอน popup เปิดอยู่เสมอ และสูงกว่า `.ss-notification-overlay` (1100) ไม่งั้นโดน drawer ประวัติอัพเดททับ
- เคส error **ยิง toast คู่กับ `.ss-form-error` ใต้แถวตรา** (ไม่ได้แทนที่) — toast สะกิดให้รู้ทันที ส่วนข้อความใต้ตราค้างไว้ให้อ่านซ้ำได้หลัง toast หาย
- `toastTimersRef` เก็บ timer ไว้ `clearTimeout` ตอน unmount — กัน setState หลัง unmount ตอนออกจากหน้าระหว่าง toast ยังค้าง
- การยืนยันก่อนยกเลิกตราไม่ใช้ `window.confirm` แล้ว — ดูหัวข้อถัดไป

## กล่องยืนยัน "ยกเลิกสถานะ" — แทนที่ `window.confirm()`

pill/โมดัลกลางจอ โผล่เฉพาะตอนกดตราที่ **ประทับแล้ว** ซ้ำ (ยกเลิก) — ดีไซน์ **"Centered Icon Alert"** (แบบที่ 6 จาก `public/confirm-dialog-designs.html`) 2569-08-17 · เดิมใช้ `window.confirm()` ของเบราว์เซอร์ ขึ้นหัว "localhost:5200 บอกว่า" ไม่มีดีไซน์เลย

- `toggleOrderStep(step)` **ไม่ใช่ async แล้ว** — แค่เช็ค `stepDone(current)`: ยังไม่ done → เรียก `applyStepChange(step, false)` (อนุมัติ) ทันทีไม่ถาม · done แล้ว (จะยกเลิก) → `setConfirmCancelStep(step)` เปิดกล่องแทนการ update ตรงๆ
- **`applyStepChange(step, isDone)`** แยกออกมาจาก `toggleOrderStep` เดิม — เก็บ logic เขียน Supabase + toast + `notifyBranchUpdate` ทั้งหมดไว้ที่เดียว เรียกได้ทั้งจากเส้นทางอนุมัติ (ตรงๆ) และเส้นทางยกเลิก (ผ่านกล่องยืนยัน)
- กดปุ่ม **"ยืนยัน"** ในกล่อง → `confirmCancelStepYes()` → ปิดกล่องก่อนแล้วค่อยเรียก `applyStepChange(step, true)` — ปิด state ก่อนเสมอกัน double-submit ถ้า Supabase ตอบช้า
- ข้อความในกล่องดึงจาก `ORDER_STEPS` จริง ไม่ hardcode: `"${step.label}" จะกลับไปเป็น "${step.pending}"` (เช่น `"ของถึงสาขา" จะกลับไปเป็น "ยังไม่ถึง"`)
- ⚠️ **ปุ่มยืนยันโทนเหลืองอำพัน (`#c9822e`) ไม่ใช่แดง** — ยกเลิกตราไม่ใช่การลบถาวร ยังกดประทับใหม่ได้ สีแดงเข้มเก็บไว้กับ `.dl-admin-danger`/ปุ่มลบข้อมูลจริงเท่านั้น
- ⚠️ **`z-index: 1150`** — สูงกว่า `.dl-modal-overlay` (1000) เพราะต้องลอยทับ popup Order ที่เปิดอยู่เสมอ แต่ต่ำกว่า `.ss-toast-layer` (1200) เพราะ toast ไม่เคยโผล่พร้อมกล่องนี้จริง (toast ยิงหลัง Supabase ตอบ ซึ่งกล่องนี้ปิดไปแล้วก่อนหน้านั้นเสมอ)
- คลิก backdrop หรือปุ่ม "ไม่ยกเลิก" → `confirmCancelStepNo()` ปิดกล่องเฉยๆ ไม่มีอะไรถูกเขียนลง DB (ตามแบบ `showClearHistory`/`deleteTarget` ที่มีอยู่แล้วในไฟล์เดียวกัน)
- ⚠️ **effect ที่รีเซ็ตฟอร์มตอนเปลี่ยน `selectedOrder?.id`** ([SaleSupportPage.tsx:2003](SaleSupportPage.tsx#L2003)) เคลียร์ `confirmCancelStep` ด้วย — กันกล่องค้างข้ามใบถ้าเผลอเปลี่ยน Order ที่เปิดอยู่ระหว่างกล่องเปิด (หรือปิด popup ไปเลย เพราะ `selectedOrder` กลายเป็น `null` ก็นับเป็นการเปลี่ยน id เหมือนกัน)
- `window.confirm()` ยังเหลืออยู่อีก **4 จุด** ในไฟล์เดียวกัน (ล้างประวัติอัพเดท, อัปโหลด Supplier, อัปโหลด Product Master, ลบข้อมูล) — ยังไม่ได้แทนที่ ถ้าจะทำต่อ pattern เดียวกันนี้ (state เก็บ "สิ่งที่รอยืนยัน" + ฟังก์ชัน yes/no) ใช้ซ้ำได้เลย
- ทดสอบผ่านจริงกับแอปที่รันอยู่ (ไม่ใช่แค่ build ผ่าน): เปิดใบ → กดตรา done → กล่องเปิดข้อความถูกต้อง → กด "ไม่ยกเลิก"/backdrop ไม่เขียน DB → เปิดใหม่กด "ยืนยัน" → DB อัปเดตจริง + toast ยิงถูกต้อง

## ป้าย "คลังส่งของแล้ว" ในตาราง Order / BackOrder (ฝั่งสาขา)

ป้ายเขียว `#1a9e8f` + ไอคอนรถ ต่อท้ายชื่อสินค้าในคอลัมน์ `sku_name` — ดีไซน์เลือกจาก `public/outbound-alert-designs.html` (แบบ 8 "Days Badge" แต่ตัดตัวเลขวันออกตามคำสั่งผู้ใช้ จึงไม่มีการไล่สีตามอายุ ใช้สีเดียว)

`showOutboundAlert(row)` — ต้องครบ 4 ข้อ:
1. `isBranchUser` (SRC / KKL / SSS เท่านั้น — คลังกับจัดซื้อไม่เห็น ไม่ใช่คนรับของ)
2. `isStampMenu` = `activeMenu === 'order' || 'backorder'` — ตัวแปรร่วมของทั้ง 2 ป้าย ใช้ได้เพราะ `ss_backorders` มี `outbound_date` + 3 คอลัมน์สถานะ ชื่อเดียวกับ `ss_orders`
3. `row.branch === userBranch` — **เฉพาะออเดอร์ของสาขาตัวเอง** เป็นกันชนซ้ำกับ query (ทั้ง Order และ BackOrder กรองสาขาที่ server ให้อยู่แล้ว) เก็บไว้เผื่อวันหลังเลิกกรอง
4. `outbound_date` มีค่า **และ** `arrived_branch` ยังไม่ done (`!stepDone(...)`)

- ⚠️ **ข้อ 4 ต้องมีทั้งสองส่วน** — ถ้าเช็คแค่ `outbound_date` ป้ายจะติดค้างตลอดไปไม่มีวันดับ · กดตรา "ของถึงสาขา" = ป้ายหายทันที (ตราอัปเดต `rows` อยู่แล้ว ไม่ต้อง refetch)

## ป้ายฝั่งคลังสินค้า — ขั้นล่าสุดที่สาขากดตรา

ตำแหน่ง/หน้าตาเดียวกับป้ายของสาขา (`.ss-out-badge` ตัวเดียวกัน) แต่ไอคอนเป็นเครื่องหมายถูก และข้อความคือ **ขั้นล่าสุดที่สาขากดตราไปแล้ว**

- `latestStampedStep(row)` ไล่ `ORDER_STEPS` **จากท้ายมาหน้า** เพราะ 3 ขั้นเรียงตามลำดับงาน (ถึงสาขา → แจ้งลูกค้า → ส่งมอบ) ขั้นท้ายสุดที่ผ่านแล้วคือความคืบหน้าล่าสุด
- ข้อความใช้ค่า `done` ของขั้นนั้น (`ถึงแล้ว` / `แจ้งแล้ว` / `ส่งมอบแล้ว`) = ค่าจริงในคอลัมน์ ตรงกับชิปที่แสดงในตาราง
- ยังไม่กดตราอะไรเลย → **ไม่มีป้าย** (`latestStampedStep` คืน `null`)
- เห็นเฉพาะ `isWarehouse` — สาขาเห็นป้าย "คลังส่งของแล้ว" แทน ทั้งสองใช้ `.ss-out-badge` ตัวเดียวกันแต่ไม่มีทางโผล่พร้อมกัน เพราะเงื่อนไขแยกตามโปรไฟล์
- ใช้กับเมนู BackOrder ด้วย (เงื่อนไข `isStampMenu` เดียวกับป้ายฝั่งสาขา)
- เหตุผลที่ต้องมีทั้งที่มีคอลัมน์ชิป 3 ตัวอยู่แล้ว: ชิปอยู่ขวาสุดของตาราง ต้องเลื่อนแนวนอนไปดู ส่วนป้ายนี้ติดกับชื่อสินค้าเห็นได้ทันที
- คอลัมน์ `.ss-col-sku_name` เป็น `white-space: nowrap` + `table-layout: auto` → คอลัมน์จะกว้างขึ้นเองเมื่อมีป้าย (ผู้ใช้ลากปรับความกว้างได้อยู่แล้ว)
- ฟอร์มเพิ่มข้อมูลต่อเมนู + แนบรูป (upload เข้า bucket `salesupport`)
- ฟอนต์หน้านี้: Noto Sans Thai

## เมนูย่อย 3 ขั้นใต้ปุ่ม Order (Accordion Sub-nav)

แทนที่ badge ตัวเลขรวมตัวเดียวแบบเดิม (`.ss-menu-badge` — ลบทิ้งแล้ว) ด้วยเมนูย่อย 3 อันที่กางใต้ปุ่ม Order — ดีไซน์เลือกจาก `public/order-step-badge-designs.html` (แบบที่ 12)

- 3 ขั้นมาจาก `ORDER_STEPS` ชุดเดียวกับตราประทับใน popup: `arrived_branch` / `customer_notified` / `delivered`
- ⚠️ **`ORDER_STEPS` มีชื่อ 2 ชุด อย่าสลับกัน** — `label` (`ของถึงสาขา`) ใช้บนตราประทับใน popup + confirm ตอนยกเลิกตรา · `navLabel` (`ยังไม่ถึงสาขา` / `ยังไม่ได้แจ้งลูกค้า` / `ยังไม่ได้ส่งมอบ`) ใช้ในเมนูย่อย sidebar + ป้ายตัวกรอง เพราะเลขข้าง ๆ คือ**จำนวนที่ยังค้าง** · tooltip ตอนขั้นนั้นครบแล้วกลับไปใช้ `label` (พูดว่า "ยังไม่..." ทั้งที่ครบแล้วจะสับสน) · หัวคอลัมน์ในตารางเป็นคนละชุด อยู่ใน `MENUS[].columns` ไม่ได้อ่านจาก `ORDER_STEPS`
- เลข = จำนวนที่**ยังไม่ผ่านขั้นนั้น** ตัดสินด้วย `stepDone()` (มีคำว่า "แล้ว" และไม่มี "ยังไม่") — **นับฝั่ง client ไม่กรองใน SQL** เพราะเกณฑ์เป็น string-contains ถ้าเขียนซ้ำใน SQL จะมี 2 แหล่งความจริงที่หลุดจากกันได้ · ค่า `null`/ว่าง นับว่ายังไม่ผ่าน
- **แถวเดียวนับเข้าได้หลายขั้นพร้อมกัน** — ผลรวม 3 ขั้นจึงมากกว่าจำนวน Order ที่ค้างจริงได้ (ตั้งใจ: แต่ละเลขตอบคำถาม "ขั้นนี้ต้องทำอีกกี่รายการ")
- กดเมนูย่อย → `setActiveMenu('order')` + กรองตารางเหลือเฉพาะที่ยังไม่ผ่านขั้นนั้น (กดซ้ำ = เลิกกรอง) · ตัวกรองค้างข้ามเมนู
- **ไม่มีป้ายบอกสถานะตัวกรองใน toolbar** — เคยมี `.ss-step-filter-tag` (บอกว่ากรองขั้นไหน + ปุ่ม ✕ เลิกกรอง) แล้วผู้ใช้ให้เอาออกเพราะรก (2569-08-13) อย่าใส่กลับ · ตัวบอกสถานะที่เหลือคือ `.is-active` บนเมนูย่อย และทางเลิกกรองคือกดเมนูย่อยอันเดิมซ้ำ
- กรองด้วย `visibleRows` (useMemo) **ไม่ใช่ query ใหม่** — ตารางกับเลขบน badge ใช้ `stepDone` ตัวเดียวกัน
- ⚠️ **นับจากทุกแถว (วน `.range()` ทีละ 1000) แต่ตารางดึงมาแค่ 500 แถวล่าสุด** — ถ้า `ss_orders` โตเกิน 500 เลขบน badge จะมากกว่าจำนวนแถวที่กรองได้
- `totalStepPending === 0` → ซ่อนทั้งหัวลูกศรและเมนูย่อย (พฤติกรรมเดิมของ badge) · มี `useEffect` เคลียร์ `stepFilter` ตามด้วย ไม่งั้นตัวกรองจะยังทำงานทั้งที่ปุ่มหายไปแล้ว → ตารางว่างโดยไม่มีอะไรบอก
- ขั้นที่ครบแล้ว (0) → `.is-zero` จางลง + `disabled` **ไม่ซ่อน** เพื่อไม่ให้เมนูขยับขึ้นลงเวลากดตรา
- สัญญาณ "เลยวันนัดรับ" (เดิมคือ `.ss-menu-badge--late` แดงกะพริบ) ย้ายมาอยู่ที่ `.ss-order-step-count.is-late` — กะพริบเฉพาะขั้นที่มีรายการเลยนัด ใช้ `@keyframes ssBadgePulse` ตัวเดิม
- หัวลูกศรพับ/กางเป็น `<span>` ใน `<button>` ต้องมี `stopPropagation` ไม่งั้นกดพับแล้วเด้งเปลี่ยนเมนูไปด้วย · พับอยู่ → มีจุดส้ม `.ss-menu-caret-dot` เตือนว่ายังมีของค้างซ่อนอยู่
- นับใหม่เมื่อ `refreshKey` หรือ `stampTick` เปลี่ยน (กดตราแล้วเลขอัปเดตทันทีโดยไม่ refetch ทั้งตาราง)
