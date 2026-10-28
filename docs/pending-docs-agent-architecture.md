# โครงสร้างของ Agent Push (Pending Docs Agent)

> สรุปจากโค้ดจริง: `pending-docs-agent.mjs`, `pending-docs-setup.sql`, `run-pending-docs-agent.bat`
> หน้าที่: ดึง "ใบโอนสินค้าออกที่สาขายังไม่กดส่ง" จาก MSSQL ของ ProMaxx แล้ว **push ขึ้น Supabase** ให้หน้าเว็บ `PendingDocsPage.tsx` แสดง

---

## 1. ภาพรวมการไหลของข้อมูล

```
 ┌──────────────────┐   1. RPC request_pending_docs_refresh()   ┌────────────────────┐
 │ เว็บ (Vercel)     │ ────────────────────────────────────────▶ │ Supabase            │
 │ PendingDocsPage   │   (เปิดหน้า / กด 🔄 / กลับมาที่แท็บ)        │  pending_docs_sync  │
 └──────────────────┘                                            │  pending_transfers  │
          ▲                                                      └─────────┬──────────┘
          │ 5. realtime: last_success_at ขยับ → โหลดตารางใหม่              │ 2. Realtime (UPDATE)
          │                                                                ▼ + poll ทุก 30 วิ (สำรอง)
          │                                                      ┌────────────────────┐
          │                  4. RPC (service_role)               │ Agent (เครื่องในร้าน) │
          └───────────────────────────────────────────────────── │ node pending-docs-  │
            replace_pending_transfers / mark_..._unchanged       │ agent.mjs           │
                                                                 └─────────┬──────────┘
                                                                           │ 3. SELECT อย่างเดียว
                                                                           ▼
                                                                 ┌────────────────────┐
                                                                 │ MSSQL ProMaxx       │
                                                                 │ (SQL Server Express)│
                                                                 └────────────────────┘
```

**หลักการ:** Agent เชื่อมต่อ "ออก" อย่างเดียว (ไม่เปิดพอร์ตให้อินเทอร์เน็ตเข้าร้าน) และ **ถาม MSSQL เฉพาะตอนมีคนเปิดหน้า Pending** — ไม่มีรอบถามเอง

---

## 2. สิ่งที่ Agent ใช้

### 2.1 Runtime และ Library

| รายการ | ใช้ทำอะไร |
|---|---|
| **Node.js 20+** | รันสคริปต์ `.mjs` (ES module) |
| `mssql` 12.7.4 (ใช้ `tedious` ข้างใน) | ต่อ MSSQL ของ ProMaxx — pool เล็ก (max 2) เพราะ Express ใช้ร่วมกับ POS |
| `@supabase/supabase-js` | ต่อ Supabase: อ่านแถวสถานะ, เรียก RPC, ฟัง Realtime |
| `crypto` (ในตัว Node) | `sha256` ทำ "ลายนิ้วมือ" ของชุดข้อมูล (`snapshotHash`) |
| `fs`, `path`, `url` (ในตัว Node) | อ่าน `.env`, เขียน log, หมุนไฟล์ log |

### 2.2 ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| `pending-docs-agent.mjs` | ตัว Agent (ทั้ง SQL, แปลงข้อมูล, push, realtime) |
| `pending-docs-agent.test.mjs` | unit test — `npm run test:pending-docs` |
| `run-pending-docs-agent.bat` | ตัวห่อให้ Task Scheduler: ล้ม/หยุดแล้ว **เปิดใหม่เองใน 10 วิ** (ต้องเป็น CRLF, ใช้ `ping` แทน `timeout`) |
| `pending-docs-setup.sql` | สร้างตาราง/RPC/realtime ฝั่ง Supabase |
| `วิธีติดตั้ง-agent-เอกสารค้าง.md` | คู่มือติดตั้งทีละขั้น |
| `.env` (ที่เครื่อง Agent) | ค่าเชื่อมต่อลับ — **ห้ามขึ้นต้น `VITE_`** (Vite จะฝังลง JS สาธารณะ) |
| `pending-docs-agent.log` | log ในเครื่อง (หมุนไฟล์เมื่อเกิน 5 MB → `.log.old`) |

### 2.3 ค่าใน `.env`

| ตัวแปร | จำเป็น | ความหมาย |
|---|---|---|
| `MSSQL_SERVER` | ✅ | ที่อยู่เครื่อง MSSQL |
| `MSSQL_DATABASE` | ✅ | ชื่อฐานข้อมูล ProMaxx |
| `MSSQL_USER` / `MSSQL_PASSWORD` | ✅ | login **`web_readonly`** (GRANT SELECT 7 ตาราง เท่านั้น) |
| `SUPABASE_SERVICE_KEY` | ✅ (ยกเว้น `--dry-run`) | service_role key — ใช้เรียก RPC ที่เขียนข้อมูล |
| `MSSQL_INSTANCE` | ไม่บังคับ | named instance เช่น `SQLEXPRESS` (หาพอร์ตผ่าน SQL Server Browser) |
| `MSSQL_PORT` | ไม่บังคับ | ใช้เมื่อไม่ระบุ instance |
| `MSSQL_ENCRYPT` | ไม่บังคับ | `false` สำหรับ SQL Server รุ่นเก่า (TLS 1.0) |
| `MSSQL_TDS_VERSION` | ไม่บังคับ | บังคับเวอร์ชัน TDS |
| `PENDING_TRANSFER_DAYS` | ไม่บังคับ | ย้อนหลังกี่วัน (ค่าเริ่มต้น **90**, ช่วง 1–3650) |

`SUPABASE_URL` ฝังอยู่ในโค้ด (ไม่ใช่ความลับ)

### 2.4 ตารางของ MSSQL ที่อ่าน (SELECT เท่านั้น)

7 ตาราง: 6 ตารางของรายงาน R16.150 (`d_16150_h20190121` ของ SeniorSoft — เช่น `TRANS`, `TRANEXTRAINFO`, `TRANDETAILITEM`, `BRANCH` …) + `WAREHOUSE`

---

## 3. ฝั่ง Supabase ที่ Agent ใช้

### ตาราง

| ตาราง | RLS | เนื้อหา |
|---|---|---|
| `pending_transfers` | anon อ่านอย่างเดียว | snapshot ใบโอนค้างส่ง (`sys_tran_no` pk, `doc_no`, `doc_date`, `from_branch`, `to_branch`, `item_count`, `items` jsonb) |
| `pending_docs_sync` | anon อ่านอย่างเดียว | แถวเดียว `id=1` ตัวกลางเว็บ↔Agent: `refresh_requested_at`, `last_success_at`, `last_checked_at`, `data_hash`, `last_error`, `last_error_at`, `row_count` |

### RPC (ฟังก์ชัน)

| RPC | ใครเรียก | ทำอะไร |
|---|---|---|
| `request_pending_docs_refresh(p_auto)` | เว็บ (anon) | ตั้งคำขอข้อมูลสด + throttle (คนสั่ง 10 วิ / อัตโนมัติ 2 นาที) |
| `replace_pending_transfers(p_rows, p_hash)` | **Agent (service_role เท่านั้น)** | แทนที่ทั้งชุดใน 1 transaction, ขยับ `last_success_at` |
| `mark_pending_docs_unchanged(p_hash)` | **Agent (service_role เท่านั้น)** | ข้อมูลเหมือนเดิม → ขยับแค่ `last_checked_at` (คืน `true`) |

### Realtime

Publish เฉพาะ `pending_docs_sync` (1 แถว) — **ไม่ publish `pending_transfers`** เพราะ replace ทีละหลายร้อยแถวจะกลายเป็น realtime หลายร้อยข้อความ

---

## 4. ขั้นตอนการทำงานของ Agent (push)

1. **เริ่มต้น** — อ่านแถว `pending_docs_sync` (ต้องมีคอลัมน์ `data_hash` ไม่งั้นออกพร้อมข้อความให้รัน SQL ใหม่) → ต่อ Realtime
2. **รอคำขอ** ทาง 2 ช่อง
   - Realtime `UPDATE` บน `pending_docs_sync` (หลัก)
   - Poll แถวสถานะทุก **30 วิ** (สำรอง — อ่าน Supabase อย่างเดียว ไม่แตะ MSSQL)
3. **มีคำขอใหม่** (`refresh_requested_at` ใหม่กว่าที่ตอบไปแล้ว) → เข้า `createSyncRunner` (single-flight: คำขอซ้อนยุบเหลือ "ทำซ้ำอีก 1 รอบ")
4. **ดึง MSSQL** — `assertReadOnlySql()` ตรวจว่าเป็น SELECT คำสั่งเดียว → รัน `TRANSFER_SQL` (timeout 20 วิ)
5. **แปลงข้อมูล** — `groupTransferRows()` รวม 1 แถว/รายการสินค้า → 1 ใบ/`SYSTRANNO` และแปลงคลังเป็นรหัสแอปด้วย `WAREHOUSE_MAP`
6. **Push** — `pushSnapshot()` คำนวณ `snapshotHash` แล้วเทียบกับ `data_hash` บน Supabase
   - เหมือนเดิม → `mark_pending_docs_unchanged` (ไม่ส่งตาราง เว็บไม่โหลดซ้ำ)
   - เปลี่ยน → `replace_pending_transfers` (ส่งทั้งชุด)
7. **error** → เขียนข้อความสั้นลง `pending_docs_sync.last_error` (ผ่าน `publicErrorMessage()` ไม่ใส่ข้อความดิบของ driver) ส่วนรายละเอียดเต็มอยู่ใน log ในเครื่อง

### โหมดการรัน (CLI)

| คำสั่ง | ความหมาย |
|---|---|
| `node pending-docs-agent.mjs` | รันค้าง (โหมดปกติ) |
| `--dry-run` | อ่าน MSSQL อย่างเดียว ไม่เขียน Supabase — ใช้ตรวจ query |
| `--once` | ซิงค์รอบเดียวและ **บังคับส่งทั้งชุด** |
| `--print-sql` | พิมพ์ SQL เดียวกับที่ Agent ใช้ ไปวางใน SSMS |

### ตัวกันพังในตัว

- **Watchdog:** Realtime ต่อไม่ติดเกิน 10 นาที → `process.exit(2)` ให้ `.bat` เปิดใหม่
- **MSSQL pool reset:** query ล้มเมื่อไร ปิด pool แล้วต่อใหม่รอบหน้า
- **คำขอที่ error** ไม่ถูกลองซ้ำทุก 30 วิ — ลองใหม่เมื่อมีคนขอใหม่หรือ Agent รีสตาร์ท
- **อ่านแถวสถานะไม่ได้** → ไม่ถาม MSSQL "เผื่อไว้"

---

## 5. การจับคู่คลัง (`WAREHOUSE_MAP`)

คีย์ = `SYSBRANCHID:SYSWAREHOUSEID` ของคลัง **ต้นทาง**

| คีย์ | คลังใน ProMaxx | รหัสในแอป |
|---|---|---|
| `0:0` | Warehouse | คลังสินค้า |
| `0:1` | Front Store | SRC |
| `4:0` | Main KKL | KKL |
| `5:0` | Main SSS | SSS |

- ต้นทางนอก map (สาขา 1–3) → **ข้ามทั้งใบ**
- ปลายทาง: ตรง map ก่อน → ไม่ตรงใช้ `DEST_BRANCH_FALLBACK` (สาขา 0 = คลังสินค้า, 4 = KKL, 5 = SSS)
- 🚨 `SYSWAREHOUSEID` ซ้ำข้ามสาขา ต้องใช้คู่กับ `SYSBRANCHID` เสมอ (ทั้งใน map และ `JOIN WAREHOUSE`)

---

## 6. กฎเหล็ก / ข้อควรระวัง

1. 🚨 **MSSQL: SELECT เท่านั้น** — ห้ามเพิ่ม/แก้ไข/สร้าง view/index/procedure/ตารางพัก (มี 2 ด่าน: `assertReadOnlySql()` + สิทธิ์ของ login `web_readonly`)
2. 🚨 **ห้ามให้เบราว์เซอร์ต่อ MSSQL, ห้ามเปิดพอร์ต 1433, ห้ามทำ API ในร้านแล้วเปิด tunnel**
3. 🚨 **ห้ามใส่รอบถาม MSSQL เองกลับมา** (`setInterval` ที่ทำให้แตะ MSSQL) — ผู้ใช้สั่งให้ถามเฉพาะตอนมีคนเปิดหน้า
4. `last_success_at` / `last_checked_at` ต้องมาจาก `now()` ของ DB ผ่าน RPC — **ห้าม Agent ส่งเวลาเครื่องตัวเอง**
5. `replace_pending_transfers` / `mark_pending_docs_unchanged` ต้อง `revoke` จาก anon แล้ว grant ให้ `service_role` เท่านั้น
6. `pending_docs_sync.last_error` อ่านได้ด้วย anon (สาธารณะ) — ห้ามใส่ IP/ชื่อเครื่อง
7. วันที่จาก MSSQL ส่งเป็นข้อความ `CONVERT(char(10), …, 23)` กัน driver ตีความเป็น UTC แล้ววันเลื่อน 7 ชม.
8. **ลำดับอัปเดต:** รัน `pending-docs-setup.sql` ใน Supabase **ก่อน** แล้วค่อย `git pull` ที่เครื่อง Agent
9. Task Scheduler: ตั้ง Task เครื่องเดียว และ **เอาติ๊ก "Stop the task if it runs longer than 3 days" ออก**
10. `npm audit` เตือน high ใน `@azure/msal-node` (ผ่าน `tedious`) — ใช้เฉพาะ Azure AD ซึ่ง Agent ไม่ได้ใช้ · **ห้าม `npm audit fix --force`**

---

## 7. สรุปสั้น ๆ

> **Agent Push = Node.js + `mssql` + `@supabase/supabase-js`** รันค้างบนเครื่องในร้านผ่าน Task Scheduler + `.bat`
> อ่าน MSSQL (read-only) → เทียบ sha256 → push ผ่าน RPC (`service_role`) → Supabase (2 ตาราง + 3 RPC + realtime 1 ตาราง) → เว็บ
