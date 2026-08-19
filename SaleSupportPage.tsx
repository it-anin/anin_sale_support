import { useState, useEffect, useMemo, useRef, Fragment, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow, usePageNotifications } from './pageAccess';
import { BRANCH_PROFILE_CODES, branchCodeLabel } from './auth';

const ORDER_BRANCHES = ['SRC', 'KKL', 'SSS', 'SALE_ADMIN', 'Warehouse'] as const;
/** สาขาหน้าร้าน — ใช้กับ ss_backorders.branch ซึ่งมี CHECK ไว้ 3 ค่านี้เท่านั้น
 *  ⚠️ ไม่มี Warehouse และ **ไม่มี SALE_ADMIN** — Sale Admin ถูกกันออกจากเมนู BackOrder ทั้งเมนู
 *     (ดู currentRole === 'saleadmin') ถ้าจะเปิดให้ ต้องขยาย CHECK ในฐานข้อมูลก่อนเสมอ */
const BACKORDER_BRANCHES = ['SRC', 'KKL', 'SSS'] as const;
/** รหัสยืนยันงานที่ย้อนกลับไม่ได้ (ลบแถว / ล้างประวัติอัพเดท)
 *  ⚠️ อยู่ฝั่ง client เหมือน VITE_ADMIN_PASSWORD — เป็น gate กันกดพลาด ไม่ใช่ security จริง */
const ADMIN_PASSWORD = '221900';
/** ค่าใน `stock.branch` ของคลังสินค้า (upload-stock.mjs map มาจาก 'Warehouse')
 *  ⚠️ ห้ามใช้ `Profile.branch` แทน เพราะโปรไฟล์คลังมีค่าเป็น null · ตรงกับ WAREHOUSE_BRANCH ใน OutboundPage.tsx */
const WAREHOUSE_STOCK_BRANCH = 'คลังสินค้า';
const CONTACT_CHANNELS = ['Tel.', 'Line', 'WhatsApp'] as const;
const DELIVERY_METHODS = ['รับที่ร้าน', 'จัดส่ง'] as const;
const ORDER_TYPES = ['เบิก', 'สั่งซื้อ'] as const;
const ORDER_SOURCES = ['คลังสินค้า', 'หน้าร้าน'] as const;

function orderRecipientLabel(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase();
  if (code === 'WAREHOUSE') return 'คลังสินค้า';
  if (code === 'PURCHASING') return 'จัดซื้อ';
  if (code === 'BOTH') return 'คลังสินค้าและจัดซื้อ';
  return String(value ?? '');
}

interface OrderForm {
  branch: string;
  sku: string;
  product_name: string;
  unit: string;
  qty: string;
  paid_date: string;
  sale_bill_no: string;
  customer_name: string;
  contact_channel: string;
  contact_value: string;
  pickup_date: string;
  delivery_method: string;
  note: string;
}

/** format Date เป็น YYYY-MM-DD (ค่าที่ <input type="date"> ต้องการ)
 *  ใช้เวลาท้องถิ่น ไม่ใช่ toISOString() ซึ่งเป็น UTC — ไทย UTC+7 จะได้วันย้อนหลัง 1 วันตอนก่อนเที่ยง */
function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** วันที่ถัดจากวันนี้ไป n วันทำการ — ข้ามเสาร์(6)/อาทิตย์(0) ไม่นับ
 *  เช่น วันอังคาร +5 วันทำการ = อังคารถัดไป (ไม่ใช่วันอาทิตย์แบบนับวันปฏิทิน)
 *  ⚠️ ไม่ได้ข้ามวันหยุดนักขัตฤกษ์ — ถ้าต้องการต้องมีตารางวันหยุดเพิ่ม */
function addBusinessDays(days: number): string {
  const d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return toDateInputValue(d);
}

/** วันนัดรับ = วันที่บันทึก + 5 วันทำการ — เลื่อนออกไปได้ แต่เลือกเร็วกว่านี้ไม่ได้ */
const PICKUP_DATE_OFFSET_DAYS = 5;

function emptyOrderForm(): OrderForm {
  return {
    branch: 'SRC', sku: '', product_name: '', unit: '', qty: '',
    paid_date: '', sale_bill_no: '', customer_name: '',
    contact_channel: 'Tel.', contact_value: '',
    pickup_date: addBusinessDays(PICKUP_DATE_OFFSET_DAYS), delivery_method: 'รับที่ร้าน', note: '',
  };
}

interface ProductSuggestion {
  sku: string;
  name: string;
  unit: string;
}

/** ฟอร์ม ➕ Add BackOrder — ไม่มีช่องจำนวน (คอลัมน์จำนวนในตารางดึงสดจาก stock)
 *  และไม่มี Outbound/ตราประทับ เพราะเป็นงานที่กรอกทีหลังใน popup
 *  `unit` = หน่วยของ barcode ที่สแกน/เลือก — 1 barcode ผูกกับ 1 หน่วยเสมอใน `products` */
interface BackOrderForm {
  branch: string;
  sku: string;
  product_name: string;
  unit: string;
  /** ค้างส่งลูกค้า — สาขาพิมพ์เอง คนละตัวกับ "คลังมีสินค้า" ที่ดึงสดจาก stock */
  pending_qty: string;
  customer_name: string;
  paid_date: string;
  sale_bill_no: string;
  pickup_date: string;
  note: string;
}

function emptyBackOrderForm(): BackOrderForm {
  return {
    branch: 'SRC', sku: '', product_name: '', unit: '', pending_qty: '', customer_name: '',
    paid_date: '', sale_bill_no: '', pickup_date: '', note: '',
  };
}

interface RequestForm {
  branch: string;
  product_name: string;
  supplier: string;
  /** ทุกโปรไฟล์กรอกได้ แต่ค่าที่บันทึกแล้วแสดงเฉพาะโปรไฟล์จัดซื้อ */
  sku: string;
  generic_name: string;
  strength: string;
  pack_size: string;
  qty: string;
  customer_name: string;
  contact_channel: string;
  contact_value: string;
  need_date: string;
}

function emptyRequestForm(): RequestForm {
  return {
    branch: 'SRC', product_name: '', supplier: '', sku: '',
    generic_name: '', strength: '', pack_size: '', qty: '',
    customer_name: '', contact_channel: 'Tel.', contact_value: '',
    need_date: '',
  };
}

const NEW_PRODUCT_BRANCHES = ['SRC', 'KKL', 'SSS', 'SALE_ADMIN'] as const;
const TICKET_DEPARTMENTS = ['Purchase', 'Warehouse'] as const;

interface TicketForm {
  branch: string;
  department: string;
  issue: string;
}

function emptyTicketForm(): TicketForm {
  return { branch: 'SRC', department: 'Purchase', issue: '' };
}

interface MasterForm {
  sku: string;
  name: string;
  base_unit: string;
  abc: string;
  multiply: string;
  supplier: string;
  set_deal: string;
  purchase_unit: string;
  barcode_unit: string;
  cost: string;
  buying_deal_normal: string;
  buying_deal_free: string;
  group_name: string;
  group_percent: string;
  sku_name: string;
}

function emptyMasterForm(): MasterForm {
  return {
    sku: '', name: '', base_unit: '', abc: '', multiply: '',
    supplier: '', set_deal: '', purchase_unit: '', barcode_unit: '',
    cost: '', buying_deal_normal: '', buying_deal_free: '',
    group_name: '', group_percent: '', sku_name: '',
  };
}

// จับคู่หัวคอลัมน์ในไฟล์ Product_Master → คอลัมน์ในตาราง (เรียงจากเฉพาะเจาะจงก่อน)
const MASTER_HEADER_MAP: [RegExp, string][] = [
  [/^sku[\s_]*name$/i,      'sku_name'],
  [/^sku$/i,                'sku'],
  [/^name$|ชื่อสินค้า/i,     'name'],
  [/base[\s_]*unit/i,       'base_unit'],
  [/^abc$/i,                'abc'],
  [/multiply/i,             'multiply'],
  [/^supplier$/i,           'supplier'],
  [/set[\s_]*deal/i,        'set_deal'],
  [/purchase[\s_]*unit/i,   'purchase_unit'],
  [/barcode[\s_]*unit/i,    'barcode_unit'],
  [/ทุนซื้อ|^cost$/i,        'cost'],
  [/buying[\s_]*deal[\s_]*normal/i, 'buying_deal_normal'],
  [/buying[\s_]*deal[\s_]*free/i,   'buying_deal_free'],
  [/group\s*%|group[\s_]*percent/i, 'group_percent'],
  [/^group$/i,              'group_name'],
  [/distributor[\s_]*name/i, 'distributor_name'],
  [/^distributor$/i,        'distributor'],
];

interface SupplierRow {
  name: string;
  details: Record<string, string> | null;
}

// สรุปรายละเอียดติดต่อจาก details เป็นบรรทัดสั้นๆ ใน dropdown
function supplierDetailLine(details: Record<string, string> | null): string {
  if (!details) return '';
  return Object.values(details).filter(Boolean).slice(0, 3).join(' · ');
}

// ช่อง Supplier พร้อมรายชื่อจากตาราง ss_suppliers (พิมพ์ 2 ตัวขึ้นไป)
function SupplierInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<SupplierRow[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (v: string) => {
    onChange(v);
    if (timer.current) clearTimeout(timer.current);
    const q = v.trim();
    if (q.length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('ss_suppliers')
        .select('name, details')
        .ilike('name', `%${q}%`)
        .limit(8);
      if (!error && data) {
        setItems(data.map(d => ({ name: d.name ?? '', details: d.details ?? null })));
      }
    }, 250);
  };

  return (
    <div className="ss-suggest-wrap">
      <input className="ss-input" type="text" placeholder="พิมพ์ 2 ตัวขึ้นไปเพื่อค้นหา หรือพิมพ์ชื่อใหม่"
        value={value}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setTimeout(() => setItems([]), 150)} />
      {items.length > 0 && (
        <div className="ss-suggest-list">
          {items.map(s => (
            <button key={s.name} type="button" className="ss-suggest-item"
              onMouseDown={() => { onChange(s.name); setItems([]); }}>
              <span className="ss-suggest-name">{s.name}</span>
              <span className="ss-suggest-unit">{supplierDetailLine(s.details)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── โหมดแก้ไขข้อมูลใน Popup รายละเอียด ──
interface EditField {
  key: string;
  label: string;
  input?: 'text' | 'date' | 'number' | 'textarea' | 'select' | 'supplier';
  options?: readonly string[];
  full?: boolean;
}

const NUMBER_EDIT_KEYS = new Set(['qty', 'ask_qty']);

// ฟิลด์ที่แก้ไขได้ต่อแต่ละตาราง (ไม่รวมคอลัมน์คำนวณ/อัตโนมัติ เช่น created_at, distributor)
const EDIT_FIELDS: Record<string, EditField[]> = {
  ss_orders: [
    { key: 'branch', label: 'สาขา', input: 'select', options: ORDER_BRANCHES },
    { key: 'sku', label: 'SKU' },
    { key: 'product_name', label: 'ชื่อสินค้า', full: true },
    { key: 'unit', label: 'หน่วย' },
    { key: 'qty', label: 'จำนวน', input: 'number' },
    { key: 'paid_date', label: 'วันที่ลูกค้าชำระ', input: 'date' },
    { key: 'sale_bill_no', label: 'เลขบิลขาย' },
    { key: 'customer_name', label: 'ชื่อลูกค้า' },
    { key: 'pickup_date', label: 'วันที่นัดรับ', input: 'date' },
    { key: 'delivery_method', label: 'รับที่ร้าน/จัดส่ง', input: 'select', options: DELIVERY_METHODS },
    { key: 'order_type', label: 'เบิก/สั่งซื้อ', input: 'select', options: ORDER_TYPES },
    { key: 'order_bill_no', label: 'สั่งซื้อ/เบิก (เลขบิล)' },
    { key: 'order_date', label: 'วันที่สั่งซื้อ/เบิก', input: 'date' },
    { key: 'order_source', label: 'สั่งลงที่ไหน', input: 'select', options: ORDER_SOURCES },
    { key: 'eta_date', label: 'วันที่คาดว่าของถึง', input: 'date' },
    { key: 'inbound_date', label: 'Inbound วันที่รับของ', input: 'date' },
    { key: 'outbound_date', label: 'Outbound วันที่ส่งของ', input: 'date' },
    { key: 'transfer_no', label: 'เลขโอนสินค้า/เลขจัดส่ง' },
    { key: 'contact_channel', label: 'ช่องทางติดต่อ', input: 'select', options: CONTACT_CHANNELS },
    { key: 'phone', label: 'เบอร์/ไอดีติดต่อ' },
    { key: 'note', label: 'หมายเหตุ', input: 'textarea', full: true },
  ],
  ss_request_items: [
    { key: 'product_name', label: 'ชื่อสินค้า', full: true },
    { key: 'branch', label: 'สาขา', input: 'select', options: ORDER_BRANCHES },
    { key: 'sku', label: 'SKU' },
    { key: 'generic_name', label: 'Generic Name' },
    { key: 'strength', label: 'ความแรง' },
    { key: 'pack_size', label: 'ขนาดบรรจุ' },
    { key: 'qty', label: 'จำนวนที่ต้องการ', input: 'number' },
    { key: 'need_date', label: 'วันที่ต้องการสินค้า', input: 'date' },
    { key: 'supplier', label: 'Supplier', input: 'supplier' },
    { key: 'customer_name', label: 'ชื่อลูกค้า' },
    { key: 'contact_channel', label: 'ช่องทางติดต่อ', input: 'select', options: CONTACT_CHANNELS },
    { key: 'phone', label: 'เบอร์/ไอดีติดต่อ' },
    { key: 'leadtime', label: 'Leadtime' },
    { key: 'exp', label: 'EXP' },
    { key: 'moq', label: 'MOQ' },
    { key: 'note', label: 'Note', input: 'textarea', full: true },
  ],
  ss_new_products: [
    { key: 'name_brand', label: 'Name/Brand', full: true },
    { key: 'active_ingredient', label: 'ชื่อยา/สารสำคัญ', full: true },
    { key: 'branch', label: 'Branch', input: 'select', options: NEW_PRODUCT_BRANCHES },
    { key: 'ask_qty', label: 'Ask Qty', input: 'number' },
    { key: 'pack_size', label: 'ขนาดบรรจุ' },
    { key: 'supplier', label: 'Supplier', input: 'supplier' },
    { key: 'quoted_price', label: 'ราคาที่แจ้ง' },
    { key: 'note', label: 'หมายเหตุ', input: 'textarea', full: true },
  ],
  ss_tickets: [
    { key: 'department', label: 'Department', input: 'select', options: TICKET_DEPARTMENTS },
    { key: 'branch', label: 'Branch', input: 'select', options: NEW_PRODUCT_BRANCHES },
    { key: 'issue', label: 'Issue', input: 'textarea', full: true },
    { key: 'answer', label: 'Answer', input: 'textarea', full: true },
  ],
  product_master: [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Name', full: true },
    { key: 'base_unit', label: 'BASE_UNIT' },
    { key: 'abc', label: 'ABC' },
    { key: 'multiply', label: 'Multiply' },
    { key: 'supplier', label: 'Supplier', input: 'supplier' },
    { key: 'set_deal', label: 'Set_Deal' },
    { key: 'purchase_unit', label: 'Purchase_Unit' },
    { key: 'barcode_unit', label: 'Barcode_Unit' },
    { key: 'cost', label: 'ทุนซื้อ' },
    { key: 'buying_deal_normal', label: 'Buying_Deal_Normal' },
    { key: 'buying_deal_free', label: 'Buying_Deal_Free' },
    { key: 'group_name', label: 'Group' },
    { key: 'group_percent', label: 'Group %' },
    { key: 'sku_name', label: 'SKU Name', full: true },
  ],
};

function describeChangedFields(
  table: string,
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
): string {
  const labels = new Map((EDIT_FIELDS[table] ?? []).map(field => [field.key, field.label]));
  const display = (value: unknown) => {
    const text = value === null || value === undefined || value === '' ? '—' : String(value);
    return text.length > 45 ? `${text.slice(0, 42)}...` : text;
  };
  const changed = Object.keys(patch).filter(key => {
    const before = row[key] === null || row[key] === undefined ? '' : String(row[key]);
    const after = patch[key] === null || patch[key] === undefined ? '' : String(patch[key]);
    return before !== after;
  });
  return changed.length > 0
    ? changed.map(key => `${labels.get(key) ?? key}: ${display(row[key])} → ${display(patch[key])}`).join(' · ')
    : '';
}

function DetailEditForm({ table, row, onSaved, onCancel, hideKeys }: {
  table: string;
  row: Record<string, unknown>;
  onSaved: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  /** ฟิลด์ที่ไม่ให้เห็น/แก้ตามสิทธิ์ผู้ใช้ (เช่น SKU ของ Request Item ที่เห็นเฉพาะจัดซื้อ) */
  hideKeys?: readonly string[];
}) {
  const allFields = EDIT_FIELDS[table] ?? [];
  const fields = hideKeys?.length ? allFields.filter(f => !hideKeys.includes(f.key)) : allFields;
  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      const v = row[f.key];
      if (f.input === 'date' && v) init[f.key] = String(v).slice(0, 10);
      else init[f.key] = v === null || v === undefined ? '' : String(v);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k: string, v: string) => setForm(s => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    setErr('');
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      const val = (form[f.key] ?? '').trim();
      patch[f.key] = NUMBER_EDIT_KEYS.has(f.key) ? (val ? Number(val) : null) : (val || null);
    }
    const { error } = await supabase.from(table).update(patch).eq('id', String(row.id));
    setSaving(false);
    if (error) { setErr(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    onSaved(patch);
  };

  return (
    <>
      <div className="dl-modal-body ss-form">
        {fields.map(f => (
          <div key={f.key} className={`ss-form-row${f.full ? ' ss-form-row--full' : ''}`}>
            <label>{f.label}</label>
            {f.input === 'supplier' ? (
              <SupplierInput value={form[f.key]} onChange={v => set(f.key, v)} />
            ) : f.input === 'select' && f.options ? (
              <select className="ss-input" value={form[f.key]} onChange={e => set(f.key, e.target.value)}>
                <option value=""></option>
                {f.options.map(o => <option key={o} value={o}>{f.key === 'branch' ? branchCodeLabel(o) : o}</option>)}
              </select>
            ) : f.input === 'textarea' ? (
              <textarea className="ss-input ss-textarea" value={form[f.key]} onChange={e => set(f.key, e.target.value)} />
            ) : (
              <input className="ss-input" type={f.input === 'date' ? 'date' : f.input === 'number' ? 'number' : 'text'}
                value={form[f.key]} onChange={e => set(f.key, e.target.value)} />
            )}
          </div>
        ))}
        {err && <div className="ss-form-error">{err}</div>}
      </div>
      <div className="dl-modal-footer">
        <button className="ss-add-btn ss-add-btn--secondary" onClick={onCancel} disabled={saving}>ยกเลิก</button>
        <button className="ss-add-btn" onClick={save} disabled={saving}>{saving ? 'กำลังบันทึก...' : '💾 บันทึก'}</button>
      </div>
    </>
  );
}

interface NewProductForm {
  branch: string;
  ask_qty: string;
  name_brand: string;
  active_ingredient: string;
  pack_size: string;
  supplier: string;
  quoted_price: string;
  note: string;
}

function emptyNewProductForm(): NewProductForm {
  return {
    branch: 'SRC', ask_qty: '', name_brand: '', active_ingredient: '',
    pack_size: '', supplier: '', quoted_price: '', note: '',
  };
}

type MenuId = 'order' | 'backorder' | 'request' | 'newproduct' | 'ticket' | 'products';

/** กลุ่มผู้ใช้ที่ใช้ตัดสินว่าเมนูไหนโผล่ใน sidebar — map มาจาก props isBranchUser/isWarehouse/isPurchasing
 *  ⚠️ `saleadmin` แยกจาก `branch` **เพื่อซ่อนเมนู BackOrder เท่านั้น** — พฤติกรรมอื่นทั้งหมด
 *     (ล็อกช่องสาขา, filter ตาราง, แจ้งเตือน) ยังเดินตาม isBranchUser ซึ่งเป็น true ทั้งคู่ */
type MenuRole = 'branch' | 'warehouse' | 'purchasing' | 'saleadmin';

interface ColumnDef {
  key: string;
  label: string;
  kind?: 'date' | 'datetime' | 'chip' | 'chips';
  min?: number;
  /** ค่าที่แสดงเป็นบรรทัดที่ 2 ในช่องเดียวกัน (ดีไซน์ Two-line Row ของตาราง Order)
   *  เป็น ColumnDef เต็ม ๆ ไม่ใช่แค่ key เพราะต้องใช้ `kind` ของตัวเองในการ format */
  sub?: ColumnDef;
  /** ยุบหลายคอลัมน์สถานะเป็นชิปหลายอันในช่องเดียว — ใช้กับ `kind: 'chips'` */
  chipKeys?: readonly string[];
}

interface MenuDef {
  id: MenuId;
  label: string;
  icon: ReactNode;
  table: string;
  columns: ColumnDef[];
  orderBy?: string;
  ascending?: boolean;
  filter?: { column: string; value: string };
  /** ใครเห็นเมนูนี้ — ไม่ใส่ = ทุกโปรไฟล์เห็น */
  roles?: readonly MenuRole[];
}

// ไอคอนเมนู sidebar — แบบ "Square Badge" (กรอบสี่เหลี่ยมมนเส้นบาง, currentColor)
// สไตล์คุมจาก `.ss-menu-icon` / `.ss-menu-icon svg` ใน App.css
const MenuSvg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);
const IconProducts = (
  <MenuSvg>
    <rect x="2.5" y="9" width="19" height="6" rx="3" />
    <line x1="12" y1="9" x2="12" y2="15" />
  </MenuSvg>
);
const IconOrder = (
  <MenuSvg>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 3h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V3Z" />
    <path d="M8 11.5h8" />
    <path d="M8 15.5h5" />
  </MenuSvg>
);
const IconBackOrder = (
  <MenuSvg>
    <path d="M3.5 7.5 12 3.2l8.5 4.3v9L12 20.8 3.5 16.5v-9Z" />
    <path d="M3.5 7.5 12 11.8l8.5-4.3" />
    <path d="M12 11.8v9" />
  </MenuSvg>
);
const IconRequest = (
  <MenuSvg>
    <path d="m12 2.3 8.6 4.95L12 12.2 3.4 7.25 12 2.3Z" />
    <path d="M2.5 8.7 11.2 13.7v8.3L2.5 17V8.7Z" />
    <path d="M12.8 13.7 21.5 8.7V17l-8.7 5v-8.3Z" />
  </MenuSvg>
);
const IconNewProduct = (
  <MenuSvg>
    <path d="M12 2.5 14.1 9.4 21 11.5 14.1 13.6 12 20.5 9.9 13.6 3 11.5 9.9 9.4Z" />
  </MenuSvg>
);
const IconTicket = (
  <MenuSvg>
    <path d="M3 8.2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 3.6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-3.6Z" />
    <path d="M14 6.2v1.8M14 11v2M14 15.5v1.8" strokeDasharray="0.1 3.2" />
  </MenuSvg>
);
const IconUpload = (
  <MenuSvg>
    <path d="M12 3v12" />
    <path d="m7 8 5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </MenuSvg>
);

/** key ของ 3 ขั้นสถานะ Order — ประกาศก่อน MENUS เพราะคอลัมน์ "สถานะ 3 ขั้น" ต้องใช้
 *  ⚠️ `ORDER_STEPS` ด้านล่างอ้างค่าจากตัวนี้ ห้ามพิมพ์ key ซ้ำเองอีกที่ */
const ORDER_STEP_KEYS = ['arrived_branch', 'customer_notified', 'delivered'] as const;

const MENUS: MenuDef[] = [
  {
    // ── ตาราง Order เป็นดีไซน์ "Two-line Row" (เลือกจาก public/order-table-layout-designs.html แบบที่ 2) ──
    // 24 คอลัมน์เดิมรวม min width = 2,834px ล้นทุกจอ (จอ 1920 มีที่ ~1,738px) จึงยุบเป็น 12 ช่อง
    // โดยยัด 2 ค่าลงช่องเดียวคนละบรรทัด: `label` = บรรทัดบน · `sub.label` = บรรทัดล่างตัวเล็กสีจาง
    // ⚠️ ข้อมูลยังครบ 24 ค่าเท่าเดิม ไม่ได้ตัดคอลัมน์ไหนทิ้ง — จับคู่ให้เป็นเรื่องเดียวกัน
    //    (บิลขาย/บิลสั่งซื้อ · ชำระ/นัดรับ · รับเข้า/ส่งออก) เพื่อให้อ่านคู่กันแล้วได้ความ
    // ⚠️ `min` ที่นี่คือความกว้างของ**ทั้งช่อง** = ค่าที่กว้างกว่าใน 2 บรรทัด ไม่ใช่ผลรวม
    id: 'order', label: 'Order', icon: IconOrder, table: 'ss_orders',
    columns: [
      { key: 'sku_name',      label: 'SKU / ชื่อสินค้า', min: 200 },
      { key: 'branch',        label: 'Branch', min: 90 },
      { key: 'qty',           label: 'จำนวน', min: 70,
        sub: { key: 'unit', label: 'หน่วย' } },
      { key: 'customer_name', label: 'ชื่อลูกค้า', min: 120,
        sub: { key: 'phone', label: 'เบอร์โทรติดต่อ' } },
      { key: 'sale_bill_no',  label: 'เลขบิลขาย', min: 150,
        sub: { key: 'order_bill_no', label: 'สั่งซื้อ/เบิก (เลขบิล)' } },
      { key: 'paid_date',     label: 'วันที่ลูกค้าชำระ', kind: 'date', min: 110,
        sub: { key: 'pickup_date', label: 'วันที่นัดรับ', kind: 'date' } },
      { key: 'order_type',    label: 'เบิก/สั่งซื้อ', min: 100,
        sub: { key: 'order_source', label: 'สั่งลงที่ไหน' } },
      { key: 'order_date',    label: 'วันที่สั่งซื้อ/เบิก', kind: 'date', min: 110,
        sub: { key: 'eta_date', label: 'วันที่คาดว่าของถึง', kind: 'date' } },
      { key: 'inbound_date',  label: 'Inbound วันที่รับของ', kind: 'date', min: 120,
        sub: { key: 'outbound_date', label: 'Outbound วันที่ส่งของ', kind: 'date' } },
      { key: 'transfer_no',   label: 'เลขโอนสินค้า/เลขจัดส่ง', min: 140,
        sub: { key: 'delivery_method', label: 'รับที่ร้าน/จัดส่ง' } },
      { key: 'note',          label: 'หมายเหตุ', min: 130,
        sub: { key: 'created_at', label: 'TimeStamp', kind: 'datetime' } },
      // 3 ชิปสถานะยุบเป็นช่องเดียว เรียงลงมาตามลำดับงาน (ถึงสาขา → แจ้งลูกค้า → ส่งมอบ)
      { key: 'order_steps',   label: 'สถานะ', kind: 'chips', chipKeys: ORDER_STEP_KEYS, min: 100 },
    ],
  },
  {
    // สินค้าค้างส่ง (ABC ≠ P) — จัดซื้อไม่เห็นเมนูนี้เพราะดูแลเฉพาะ ABC = P
    // ⚠️ 2 คอลัมน์ตัวเลขคนละที่มา อย่าสลับกัน:
    //    `stock_qty`   "คลังมีสินค้า"  = ยอดสดจาก `stock` สาขาคลังสินค้า ไม่ได้เก็บในตาราง (เติมหลัง fetch)
    //                   ทุกโปรไฟล์เห็นยอดของคลังเหมือนกัน — สาขาต้องรู้ว่าคลังมีของพอส่งไหม
    //    `pending_qty` "ค้างส่งลูกค้า" = สาขาพิมพ์เองในฟอร์ม ➕ Add BackOrder เก็บลงตาราง
    // ⚠️ ทั้งคู่แสดงแค่ตัวเลข ไม่ต่อท้ายหน่วย ส่วน "หน่วย" = หน่วยของ barcode ที่สแกน/เลือก
    //    ตัวเลขคลังนับด้วยหน่วยของ stock ซึ่งเป็นหน่วยเล็กสุดเสมอ จึงอาจคนละหน่วยกับคอลัมน์ "หน่วย"
    //    (เช่น 530 แผง / หน่วย = กล่อง) — หน่วยที่คลังนับไปอยู่ใน tooltip ของช่องตัวเลขแทน
    id: 'backorder', label: 'BackOrder', icon: IconBackOrder, table: 'ss_backorders',
    roles: ['branch', 'warehouse'],
    columns: [
      { key: 'sku_name',          label: 'SKU / ชื่อสินค้า', min: 200 },
      { key: 'branch',            label: 'Branch', min: 70 },
      { key: 'stock_qty',         label: 'คลังมีสินค้า', min: 90 },
      { key: 'pending_qty',       label: 'ค้างส่งลูกค้า', min: 100 },
      { key: 'unit',              label: 'หน่วย', min: 70 },
      { key: 'customer_name',     label: 'ชื่อลูกค้า', min: 120 },
      { key: 'paid_date',         label: 'วันที่ลูกค้าชำระ', kind: 'date', min: 110 },
      { key: 'sale_bill_no',      label: 'เลขที่บิล', min: 160 },
      { key: 'pickup_date',       label: 'วันที่นัดรับ', kind: 'date', min: 100 },
      { key: 'note',              label: 'หมายเหตุ', min: 140 },
      { key: 'outbound_date',     label: 'Outbound วันที่ส่งของ', kind: 'date', min: 140 },
      { key: 'transfer_no',       label: 'เลขโอนสินค้า/เลขจัดส่ง', min: 150 },
      { key: 'arrived_branch',    label: 'ของถึงสาขา', kind: 'chip', min: 100 },
      { key: 'customer_notified', label: 'แจ้งลูกค้า', kind: 'chip', min: 100 },
      { key: 'delivered',         label: 'ส่งมอบสินค้า', kind: 'chip', min: 110 },
    ],
  },
  {
    id: 'request', label: 'Request Item', icon: IconRequest, table: 'ss_request_items',
    columns: [
      { key: 'product_name', label: 'ชื่อสินค้า', min: 180 },
      { key: 'branch',       label: 'สาขา', min: 70 },
      { key: 'generic_name', label: 'Generic Name', min: 130 },
      { key: 'strength',     label: 'ความแรง', min: 80 },
      { key: 'pack_size',    label: 'ขนาดบรรจุ', min: 100 },
      { key: 'qty',          label: 'จำนวนที่ต้องการ', min: 110 },
      { key: 'need_date',    label: 'วันที่ต้องการสินค้า', kind: 'date', min: 130 },
      { key: 'status',       label: 'Status', kind: 'chip', min: 110 },
      { key: 'created_at',   label: 'DateTime', kind: 'datetime', min: 130 },
      { key: 'sku',          label: 'SKU', min: 80 },
      { key: 'availability', label: 'Availability', kind: 'chip', min: 100 },
      { key: 'note',          label: 'Note', min: 140 },
      { key: 'leadtime',      label: 'Leadtime', min: 80 },
      { key: 'exp',           label: 'EXP', min: 90 },
      { key: 'moq',           label: 'MOQ', min: 80 },
      { key: 'supplier',      label: 'Supplier', min: 140 },
      { key: 'image_url',     label: 'รูปสินค้า', min: 90 },
      { key: 'customer_name', label: 'ชื่อลูกค้า', min: 120 },
      { key: 'phone',         label: 'ติดต่อลูกค้า', min: 130 },
    ],
  },
  {
    id: 'newproduct', label: 'New Product', icon: IconNewProduct, table: 'ss_new_products',
    columns: [
      { key: 'name_brand',        label: 'Name/Brand', min: 150 },
      { key: 'active_ingredient', label: 'ชื่อยา/สารสำคัญ', min: 170 },
      { key: 'created_at',        label: 'Stamp Date', kind: 'datetime', min: 130 },
      { key: 'branch',            label: 'Branch', min: 70 },
      { key: 'ask_qty',           label: 'Ask Qty', min: 70 },
      { key: 'pack_size',         label: 'ขนาดบรรจุ', min: 100 },
      { key: 'image_url',         label: 'รูปสินค้า', min: 90 },
      { key: 'supplier',          label: 'Supplier', min: 140 },
      { key: 'quoted_price',      label: 'ราคาที่แจ้ง', min: 110 },
      { key: 'note',              label: 'หมายเหตุ', min: 140 },
      { key: 'status',            label: 'Status', kind: 'chip', min: 110 },
    ],
  },
  {
    id: 'ticket', label: 'Ticket', icon: IconTicket, table: 'ss_tickets',
    columns: [
      { key: 'department', label: 'Department', min: 100 },
      { key: 'created_at', label: 'Date Time', kind: 'datetime', min: 130 },
      { key: 'branch',     label: 'Branch', min: 70 },
      { key: 'issue',      label: 'Issue', min: 240 },
      { key: 'answer',     label: 'Answer', min: 240 },
      { key: 'status',     label: 'Status', kind: 'chip', min: 110 },
    ],
  },
  {
    id: 'products', label: 'Products', icon: IconProducts, table: 'product_master',
    orderBy: 'sku', ascending: true,
    // ไม่ fix filter abc='P' แล้ว — แสดงทุกรายการ ผู้ใช้เลือกกรอง ABC เองจาก chip บน toolbar
    columns: [
      { key: 'sku',              label: 'SKU', min: 90 },
      { key: 'name',             label: 'Name', min: 220 },
      { key: 'base_unit',        label: 'BASE_UNIT', min: 90 },
      { key: 'abc',              label: 'ABC', min: 60 },
      { key: 'cost',             label: 'ทุนซื้อ', min: 80 },
      { key: 'distributor',      label: 'Distributor', min: 100 },
      { key: 'distributor_name', label: 'Distributor Name', min: 180 },
    ],
  },
];

const MENU_DISPLAY_ORDER: MenuId[] = ['products', 'order', 'backorder', 'request', 'newproduct', 'ticket'];

// ช่องรายละเอียดใน Popup Order (เรียงตามสเปค)
const ORDER_DETAIL_FIELDS: ColumnDef[] = [
  { key: 'sku_name',      label: 'SKU / ชื่อสินค้า' },
  { key: 'branch',        label: 'สาขา (Branch/Warehouse)' },
  { key: 'recipient_department', label: 'ส่งให้แผนก' },
  { key: 'qty_unit',      label: 'จำนวน' },
  { key: 'sale_bill_no',  label: 'เลขบิลขาย' },
  { key: 'customer_name', label: 'ชื่อลูกค้า' },
  { key: 'pickup_date',   label: 'วันที่นัดรับ', kind: 'date' },
  { key: 'note',          label: 'หมายเหตุ' },
  { key: 'delivery_method', label: 'รับที่ร้าน/จัดส่ง' },
  { key: 'order_type',    label: 'เบิก/สั่งซื้อ' },
  { key: 'order_bill_no', label: 'สั่งซื้อ/เบิก (เลขบิล)' },
  { key: 'order_date',    label: 'วันที่สั่งซื้อ/เบิก', kind: 'date' },
  { key: 'order_source',  label: 'สั่งลงที่ไหน' },
  { key: 'eta_date',      label: 'วันที่คาดว่าของถึง', kind: 'date' },
  { key: 'inbound_date',  label: 'Inbound วันที่รับของ', kind: 'date' },
  { key: 'outbound_date', label: 'Outbound วันที่ส่งของ', kind: 'date' },
  { key: 'transfer_no',   label: 'เลขโอนสินค้า/เลขจัดส่ง' },
  { key: 'phone',         label: 'เบอร์โทรติดต่อ' },
  { key: 'created_at',    label: 'TimeStamp (วันที่ลง Order)', kind: 'datetime' },
];

// ช่องรายละเอียดใน Popup BackOrder — ใช้ popup ตัวเดียวกับ Order แต่คนละชุดฟิลด์
// ไม่มี stock_qty / stock_unit ("คลังมีสินค้า") เพราะเป็นข้อมูลสดของตาราง ไม่ได้เก็บในแถว
const BACKORDER_DETAIL_FIELDS: ColumnDef[] = [
  { key: 'sku_name',      label: 'SKU / ชื่อสินค้า' },
  { key: 'pending_qty',   label: 'ค้างส่งลูกค้า' },
  { key: 'unit',          label: 'หน่วย' },
  { key: 'branch',        label: 'สาขา' },
  { key: 'customer_name', label: 'ชื่อลูกค้า' },
  { key: 'paid_date',     label: 'วันที่ลูกค้าชำระ', kind: 'date' },
  { key: 'sale_bill_no',  label: 'เลขที่บิล' },
  { key: 'pickup_date',   label: 'วันที่นัดรับ', kind: 'date' },
  { key: 'note',          label: 'หมายเหตุ' },
  { key: 'outbound_date', label: 'Outbound วันที่ส่งของ', kind: 'date' },
  { key: 'transfer_no',   label: 'เลขโอนสินค้า/เลขจัดส่ง' },
  { key: 'created_at',    label: 'TimeStamp (วันที่ลงรายการ)', kind: 'datetime' },
];

// Popup เมนู Products แสดงครบทุกคอลัมน์ของ Product Master (ตารางโชว์แค่บางส่วน)
const PRODUCT_DETAIL_FIELDS: ColumnDef[] = [
  { key: 'sku',                label: 'SKU' },
  { key: 'name',               label: 'Name' },
  { key: 'base_unit',          label: 'BASE_UNIT' },
  { key: 'abc',                label: 'ABC' },
  { key: 'multiply',           label: 'Multiply' },
  { key: 'supplier',           label: 'Supplier' },
  { key: 'set_deal',           label: 'Set_Deal' },
  { key: 'purchase_unit',      label: 'Purchase_Unit' },
  { key: 'barcode_unit',       label: 'Barcode_Unit' },
  { key: 'cost',               label: 'ทุนซื้อ' },
  { key: 'buying_deal_normal', label: 'Buying_Deal_Normal' },
  { key: 'buying_deal_free',   label: 'Buying_Deal_Free' },
  { key: 'group_name',         label: 'Group' },
  { key: 'group_percent',      label: 'Group %' },
  { key: 'sku_name',           label: 'SKU Name' },
  { key: 'distributor',        label: 'Distributor' },
  { key: 'distributor_name',   label: 'Distributor Name' },
  { key: 'created_at',         label: 'TimeStamp', kind: 'datetime' },
];

// ช่องที่ควรกินเต็มความกว้างใน popup รายละเอียด
const DETAIL_FULL_KEYS = new Set(['issue', 'answer', 'note', 'name', 'name_brand', 'active_ingredient', 'sku_name']);

// 3 ขั้นตอนอนุมัติใน Popup Order (ตราประทับ)
// label    = ชื่อขั้น ใช้บนตราประทับใน popup — เป็นคำบอก "สิ่งที่ต้องทำ"
// navLabel = ชื่อในเมนูย่อย sidebar — เป็นคำบอก "สิ่งที่ยังไม่ได้ทำ" เพราะเลขข้าง ๆ คือจำนวนที่ค้าง
const ORDER_INITIAL_STATUSES: Record<string, string> = {
  arrived_branch: 'ยังไม่ถึง',
  customer_notified: 'ยังไม่แจ้ง',
  delivered: 'ยังไม่ส่งมอบ',
};

// key อ้างจาก ORDER_STEP_KEYS ที่ประกาศไว้ก่อน MENUS — แหล่งเดียว ไม่ให้ 2 ที่หลุดจากกัน
const ORDER_STEPS = [
  { key: ORDER_STEP_KEYS[0], label: 'ของถึงสาขา',  navLabel: 'ยังไม่ถึงสาขา',      done: 'ถึงแล้ว',    pending: ORDER_INITIAL_STATUSES.arrived_branch },
  { key: ORDER_STEP_KEYS[1], label: 'แจ้งลูกค้า',   navLabel: 'ยังไม่ได้แจ้งลูกค้า', done: 'แจ้งแล้ว',   pending: ORDER_INITIAL_STATUSES.customer_notified },
  { key: ORDER_STEP_KEYS[2], label: 'ส่งมอบสินค้า', navLabel: 'ยังไม่ได้ส่งมอบ',    done: 'ส่งมอบแล้ว', pending: ORDER_INITIAL_STATUSES.delivered },
] as const;

/** ชื่อขั้นจาก key — ใช้ทำ tooltip ของชิปในคอลัมน์ "สถานะ 3 ขั้น" */
const stepLabelOf = (key: string) => ORDER_STEPS.find(s => s.key === key)?.label ?? key;

const stepDone = (v: string) => !!v && v.includes('แล้ว') && !v.includes('ยังไม่');

// ขั้นล่าสุดที่สาขากดตราไปแล้ว — ไล่จากท้ายมาหน้า เพราะ ORDER_STEPS เรียงตามลำดับงาน
// (ถึงสาขา → แจ้งลูกค้า → ส่งมอบ) ขั้นท้ายสุดที่ผ่านแล้วคือความคืบหน้าล่าสุด
// null = สาขายังไม่ได้กดตราอะไรเลย
const latestStampedStep = (row: Record<string, unknown>) => {
  for (let i = ORDER_STEPS.length - 1; i >= 0; i--) {
    if (stepDone(String(row[ORDER_STEPS[i].key] ?? ''))) return ORDER_STEPS[i];
  }
  return null;
};

/* ── Toast แจ้งผลกดตราประทับ (pill กลางบนจอ) ──
   ดีไซน์ "Top Center Drop" จาก public/stamp-toast-designs.html แบบที่ 2
   ok = อนุมัติสำเร็จ · cancel = ยกเลิกสถานะแล้ว · error = บันทึกไม่สำเร็จ */
type StampToastTone = 'ok' | 'cancel' | 'error';
type StampToast = { id: number; tone: StampToastTone; title: string; detail: string; leaving?: boolean };
const STAMP_TOAST_ICON: Record<StampToastTone, string> = { ok: '✔', cancel: '↩', error: '✕' };
const STAMP_TOAST_MS = 3400;   // อยู่บนจอกี่มิลลิวินาทีก่อนเริ่มเฟดออก
const STAMP_TOAST_MAX = 2;     // ค้างพร้อมกันได้กี่ใบ — กดตรารัว 3 ขั้นแล้วไม่ท่วมจอ

// ช่องที่ "คลังสินค้า" กรอกใน popup Order — แทนที่ตราประทับ 3 ขั้น (ซึ่งเป็นงานฝั่งสาขา)
// 3 คอลัมน์นี้มีอยู่ใน ss_orders + ตาราง Order อยู่แล้ว ไม่ต้องเพิ่ม schema
const WAREHOUSE_FIELDS = [
  { key: 'inbound_date',  label: 'Inbound วันที่รับของ',   type: 'date' },
  { key: 'outbound_date', label: 'Outbound วันที่ส่งของ',  type: 'date' },
  { key: 'transfer_no',   label: 'เลขโอนสินค้า/เลขจัดส่ง', type: 'text' },
] as const;
const WAREHOUSE_KEYS = new Set<string>(WAREHOUSE_FIELDS.map(f => f.key));

// ช่องที่ "คลังสินค้า" กรอกใน popup BackOrder — น้อยกว่า Order เพราะไม่มีขั้นรับของเข้า (inbound)
const BACKORDER_WAREHOUSE_FIELDS = [
  { key: 'outbound_date', label: 'Outbound วันที่ส่งของ',  type: 'date' },
  { key: 'transfer_no',   label: 'เลขโอนสินค้า/เลขจัดส่ง', type: 'text' },
] as const;
const BACKORDER_WAREHOUSE_KEYS = new Set<string>(BACKORDER_WAREHOUSE_FIELDS.map(f => f.key));

/** ตาราง Order กับ BackOrder ใช้ popup ตัวเดียวกัน แต่คลังกรอกคนละชุดฟิลด์ */
type WarehouseField = { key: string; label: string; type: string };
const warehouseFieldsFor = (table: string): readonly WarehouseField[] =>
  table === 'ss_backorders' ? BACKORDER_WAREHOUSE_FIELDS : WAREHOUSE_FIELDS;

// ช่องที่ "จัดซื้อ" บันทึกใน popup Order
const PURCHASING_ORDER_FIELDS = [
  { key: 'order_type',    label: 'เบิก/สั่งซื้อ',             type: 'select', options: ORDER_TYPES },
  { key: 'order_bill_no', label: 'สั่งซื้อ/เบิก (เลขบิล)',    type: 'text' },
  { key: 'order_date',    label: 'วันที่สั่งซื้อ/เบิก',        type: 'date' },
  { key: 'order_source',  label: 'สั่งลงที่ไหน',              type: 'select', options: ORDER_SOURCES },
  { key: 'eta_date',      label: 'วันที่คาดว่าของถึง',         type: 'date' },
] as const;
const PURCHASING_ORDER_KEYS = new Set<string>(PURCHASING_ORDER_FIELDS.map(f => f.key));

// ดึงค่าปัจจุบันของช่องคลังออกมาเป็นฟอร์ม — คอลัมน์ date อาจกลับมาเป็น timestamp
// แต่ <input type="date"> รับแค่ YYYY-MM-DD จึงต้องตัดให้เหลือ 10 ตัว
const whFormFrom = (row: Record<string, unknown> | null, table: string): Record<string, string> =>
  Object.fromEntries(warehouseFieldsFor(table).map(f => {
    const raw = String(row?.[f.key] ?? '');
    return [f.key, f.type === 'date' ? raw.slice(0, 10) : raw];
  }));

const purchasingFormFrom = (row: Record<string, unknown> | null): Record<string, string> =>
  Object.fromEntries(PURCHASING_ORDER_FIELDS.map(f => {
    const raw = String(row?.[f.key] ?? '');
    return [f.key, f.type === 'date' ? raw.slice(0, 10) : raw];
  }));

// จำนวนที่ยังค้างของแต่ละขั้น + จำนวนที่เลยวันนัดรับในนั้น → เมนูย่อยใต้ปุ่ม Order
type StepCounts = Record<string, { pending: number; overdue: number }>;
const emptyStepCounts = (): StepCounts =>
  Object.fromEntries(ORDER_STEPS.map(s => [s.key, { pending: 0, overdue: 0 }]));

// เลือกสีชิปตามคำในสถานะ: เขียว = เสร็จ, แดง = ยกเลิก, ฟ้า = กำลังไป, ส้ม = รอ
function chipClass(value: string): string {
  if (/เสร็จ|ส่งมอบแล้ว|แจ้งแล้ว|ถึงแล้ว|อนุมัติ|มีของ|done|complete|closed|resolved/i.test(value)) return 'ss-chip--green';
  if (/ยกเลิก|ปฏิเสธ|ไม่มีของ|cancel|reject/i.test(value)) return 'ss-chip--red';
  if (/สั่งแล้ว|กำลัง|จัดส่ง|ระหว่าง|ต้องสั่ง|progress|shipping/i.test(value)) return 'ss-chip--blue';
  return 'ss-chip--orange';
}

function formatCell(row: Record<string, unknown>, col: ColumnDef) {
  if (col.key === 'sku_name') {
    const sku = (row.sku as string) ?? '';
    const name = (row.product_name as string) ?? '';
    return [sku, name].filter(Boolean).join(' ');
  }
  if (col.key === 'phone') {
    const channel = (row.contact_channel as string) ?? '';
    const value = (row.phone as string) ?? '';
    return [channel, value].filter(Boolean).join(' ');
  }
  if (col.key === 'qty_unit') {
    const qty = row.qty === null || row.qty === undefined ? '' : String(row.qty);
    const unit = (row.unit as string) ?? '';
    return [qty, unit].filter(Boolean).join(' ');
  }
  if (col.key === 'recipient_department') return orderRecipientLabel(row.recipient_department);
  // รหัสในฐานข้อมูลเป็นตัวพิมพ์ใหญ่ (SALE_ADMIN) แต่ผู้ใช้ต้องเห็นชื่อจริง ("Sale Admin")
  // — จุดเดียวที่แปลงให้ทุกตารางที่มีคอลัมน์ branch
  if (col.key === 'branch') return branchCodeLabel(row.branch);
  const raw = row[col.key];
  if (raw === null || raw === undefined || raw === '') return '';
  if (col.kind === 'date') return new Date(String(raw)).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (col.kind === 'datetime') return new Date(String(raw)).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  return String(raw);
}

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
  isPurchasing: boolean;
  isWarehouse: boolean;
  userBranch?: string;
  /** จำนวน `ss_branch_notification_events` ที่ยังไม่อ่านของคลังสินค้า (branch='WAREHOUSE')
   *  คนละตัวนับกับ pageNotifications.salesupport ที่ใช้กับปุ่ม "Order ใหม่" เดิม — ดูจุดประกาศ notificationHistoryUnreadCount */
  warehouseUpdateUnreadCount?: number;
}

const REQUEST_STATUS_OPTIONS = ['อนุมัติ', 'กำลังติดต่อ', 'ไม่อนุมัติ'] as const;
const NEW_PRODUCT_STATUS_OPTIONS = ['อนุมัติ', 'รอพิจารณา', 'ไม่อนุมัติ'] as const;
const REQUEST_AVAILABILITY_OPTIONS = ['ต้องสั่ง', 'มีของ', 'ไม่มีของ', 'ของขาด', 'ยกเลิกจำหน่าย'] as const;
const TICKET_STATUS_OPTIONS = ['Done', 'Cancel'] as const;
/** ผู้รับที่ทิศ "แผนก → สาขา" ยิงถึงได้ — ต้องรวม Sale Admin ด้วย ไม่งั้น notifyBranchUpdate
 *  จะไม่รู้จักรหัสแล้วตก fallback ไป fan-out หา SRC/KKL/SSS ทั้ง 3 สาขาแทน */
const NOTIFIED_BRANCHES = BRANCH_PROFILE_CODES;

/** ป้ายผู้กระทำในแผงประวัติ — ต้องครอบคลุมทั้ง 2 ทิศทาง (แผนก→สาขา และ สาขา→จัดซื้อ)
 *  ⚠️ ของเดิมเขียนเป็น ternary `=== 'WAREHOUSE' ? 'คลังสินค้า' : 'จัดซื้อ'` ซึ่งทำให้ค่าอื่น
 *     ทั้งหมดตกไปเป็น "จัดซื้อ" — พอสาขาเป็นผู้กระทำได้ จัดซื้อจะเห็นว่าตัวเองแจ้งเตือนตัวเอง */
const NOTIFICATION_ACTOR_LABELS: Record<string, string> = {
  WAREHOUSE: 'คลังสินค้า',
  PURCHASING: 'จัดซื้อ',
  SRC: 'สาขา SRC',
  KKL: 'สาขา KKL',
  SSS: 'สาขา SSS',
  SALE_ADMIN: 'Sale Admin',
};
const notificationActorTone = (code: string) =>
  code === 'WAREHOUSE' ? 'warehouse' : code === 'PURCHASING' ? 'purchasing' : 'branch';

interface BranchNotificationEvent {
  id: string;
  branch: string;
  actor_code: string;
  menu_id: string;
  table_name: string;
  record_id: string | null;
  title: string;
  detail: string | null;
  item_sku: string | null;
  item_name: string | null;
  created_at: string;
  read_at: string | null;
}

interface NotificationMeta {
  menuId?: MenuId | 'supplier';
  tableName?: string;
  recordId?: unknown;
  title?: string;
  detail?: string;
  itemSku?: unknown;
  itemName?: unknown;
}

/** insert แล้วคืน id ของแถวที่เพิ่งสร้าง — ใช้ผูกกับ record_id ของแจ้งเตือน (คลิกแล้วเปิด popup ใบนั้นได้)
 *  ⚠️ ใช้ `.select('id')` แบบ array ห้ามใช้ `.single()` — `.single()` จะ error เมื่อได้ 0 แถว
 *     ทำให้ insert ที่สำเร็จถูกรายงานว่าล้มเหลว แล้วผู้ใช้กดซ้ำจนได้ Order ซ้ำ */
async function insertWithContactChannelFallback(table: string, payload: Record<string, unknown>) {
  const run = (body: Record<string, unknown>) => supabase.from(table).insert(body).select('id');
  let { data, error } = await run(payload);
  const missingContactChannel = error
    && error.message.includes('contact_channel')
    && (error.message.includes('schema cache') || error.message.includes('Could not find'));
  if (missingContactChannel) {
    const legacyPayload = { ...payload };
    delete legacyPayload.contact_channel;
    ({ data, error } = await run(legacyPayload));
  }
  return { error, id: data?.[0]?.id ? String(data[0].id) : null };
}

export function SaleSupportPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport, isPurchasing, isWarehouse, userBranch, warehouseUpdateUnreadCount = 0 }: Props) {
  const [activeMenu, setActiveMenu] = useState<MenuId>('products');
  const [skuNameWidth, setSkuNameWidth] = useState(320);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAddOrder, setShowAddOrder] = useState(false);
  const [orderForm, setOrderForm] = useState<OrderForm>(emptyOrderForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showAddRequest, setShowAddRequest] = useState(false);
  const [requestForm, setRequestForm] = useState<RequestForm>(emptyRequestForm);
  const [requestImage, setRequestImage] = useState<File | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productForm, setProductForm] = useState<NewProductForm>(emptyNewProductForm);
  const [productImage, setProductImage] = useState<File | null>(null);
  const [showAddTicket, setShowAddTicket] = useState(false);
  const [ticketForm, setTicketForm] = useState<TicketForm>(emptyTicketForm);
  const [showAddBackOrder, setShowAddBackOrder] = useState(false);
  const [backOrderForm, setBackOrderForm] = useState<BackOrderForm>(emptyBackOrderForm);
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  // popup รายละเอียดใช้ร่วมกันระหว่าง Order กับ BackOrder — จำไว้ว่าแถวที่เปิดอยู่มาจากตารางไหน
  // (อ่านจาก activeMenu ไม่ได้ เพราะฟังก์ชันบันทึกต้องผูกกับแถวที่เปิด ไม่ใช่เมนูที่กำลังดู)
  const [selectedOrderTable, setSelectedOrderTable] = useState('ss_orders');
  const [stampError, setStampError] = useState('');
  const [stampToasts, setStampToasts] = useState<StampToast[]>([]);
  // ฟอร์มของคลังสินค้าใน popup Order/BackOrder (แทนที่ตราประทับ)
  const [whForm, setWhForm] = useState<Record<string, string>>(() => whFormFrom(null, 'ss_orders'));
  const [whSaving, setWhSaving] = useState(false);
  const [whMsg, setWhMsg] = useState('');
  const [purchasingOrderForm, setPurchasingOrderForm] = useState<Record<string, string>>(() => purchasingFormFrom(null));
  const [purchasingOrderSaving, setPurchasingOrderSaving] = useState(false);
  const [purchasingOrderMsg, setPurchasingOrderMsg] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<Record<string, unknown> | null>(null);
  const [detailView, setDetailView] = useState<{ title: string; table: string; fields: ColumnDef[]; row: Record<string, unknown> } | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const supplierFileRef = useRef<HTMLInputElement>(null);
  const [supplierMsg, setSupplierMsg] = useState('');
  const [uploadingSupplier, setUploadingSupplier] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productQuery, setProductQuery] = useState('');
  // กรอง ABC — Set ว่าง = ไม่กรอง แสดงทุกรายการ
  const [abcFilter, setAbcFilter] = useState<Set<string>>(new Set());
  // ค่า ABC ที่มีจริงในตาราง (โหลดครั้งเดียว) — null = ยังไม่โหลด
  const [abcOptions, setAbcOptions] = useState<string[] | null>(null);
  // จำนวน Order ที่ยังค้างของแต่ละขั้น → เมนูย่อย 3 อันใต้ปุ่ม Order
  const [stepCounts, setStepCounts] = useState<StepCounts>(emptyStepCounts);
  // เมนูย่อยกางอยู่ไหม (กดหัวลูกศรพับ/กาง) — กางไว้ก่อนเพื่อให้เห็นของค้างโดยไม่ต้องกด
  const [stepsOpen, setStepsOpen] = useState(true);
  // กรองตาราง Order ให้เหลือเฉพาะที่ยังไม่ผ่านขั้นนี้ — null = ไม่กรอง
  const [stepFilter, setStepFilter] = useState<string | null>(null);
  // เด้งเมื่อกดตรา — สั่งให้นับใหม่โดยไม่ต้อง refetch ทั้งตาราง
  const [stampTick, setStampTick] = useState(0);
  const supplierMapRef = useRef<Map<string, { name: string; distributor: string }> | null>(null);
  const masterFileRef = useRef<HTMLInputElement>(null);
  const [masterMsg, setMasterMsg] = useState('');
  const [uploadingMaster, setUploadingMaster] = useState(false);
  const [showAddMaster, setShowAddMaster] = useState(false);
  const [masterForm, setMasterForm] = useState<MasterForm>(emptyMasterForm);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string; table: string; label: string; branch: string; menuId: MenuId;
    itemSku: string; itemName: string;
  } | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showNotificationHistory, setShowNotificationHistory] = useState(false);
  // ล้างประวัติอัพเดททั้งสาขา — ต้องใส่รหัส Admin (ย้อนกลับไม่ได้)
  const [showClearHistory, setShowClearHistory] = useState(false);
  const [clearHistoryPw, setClearHistoryPw] = useState('');
  const [clearHistoryError, setClearHistoryError] = useState('');
  const [clearingHistory, setClearingHistory] = useState(false);
  const [notificationEvents, setNotificationEvents] = useState<BranchNotificationEvent[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationTarget, setNotificationTarget] = useState<{ menuId: MenuId; recordId: string } | null>(null);

  const menu = MENUS.find(m => m.id === activeMenu)!;
  const isBranchUser = (BRANCH_PROFILE_CODES as readonly string[]).includes(userBranch ?? '');
  // เมนูที่โปรไฟล์นี้เห็น — ใช้ทั้งกับ sidebar และเป็น whitelist ตอนเปิดจากลิงก์แจ้งเตือน
  // Sale Admin แยกเป็น role ของตัวเองเพื่อให้หลุดจาก roles: ['branch','warehouse'] ของเมนู BackOrder
  // (ss_backorders.branch มี CHECK แค่ SRC/KKL/SSS — ถ้าปล่อยให้เห็นเมนู กดบันทึกจะ error ที่ฐานข้อมูล)
  const currentRole: MenuRole = userBranch === 'SALE_ADMIN' ? 'saleadmin'
    : isBranchUser ? 'branch' : isWarehouse ? 'warehouse' : 'purchasing';
  const visibleMenus = useMemo(
    () => MENU_DISPLAY_ORDER
      .map(id => MENUS.find(m => m.id === id)!)
      .filter(m => !m.roles || m.roles.includes(currentRole)),
    [currentRole],
  );
  const pageNotifications = usePageNotifications();
  const notificationUnreadCount = Number(pageNotifications.salesupport ?? 0);

  // ผู้รับแจ้งเตือนของโปรไฟล์นี้ = ค่าที่ใช้ query คอลัมน์ `branch` ในตารางเหตุการณ์
  // (ชื่อคอลัมน์ยังเป็น "branch" ตามเดิม แต่ความหมายคือ "ผู้รับ" แล้ว — ดู comment ใน salesupport-setup.sql)
  // ⚠️ คลังสินค้าเข้าร่วมทิศทางนี้แล้ว (2569-08-18) — คู่กับ 'WAREHOUSE' ใหม่ในทั้ง CHECK constraint และ RPC
  //    ยังใช้ recipient_department บน ss_orders ต่อไปด้วยสำหรับปุ่ม "Order ใหม่" (ไม่ได้แทนที่ แค่เพิ่ม)
  const notificationRecipient = isBranchUser ? (userBranch ?? null) : isPurchasing ? 'PURCHASING' : isWarehouse ? 'WAREHOUSE' : null;
  // ⚠️ แยกจาก NOTIFICATION_ACTOR_LABELS โดยตั้งใจ — ถ้าเอา map นั้นมาใช้ หัว drawer ของสาขา
  //    จะเปลี่ยนจาก "SRC · รายการล่าสุด" เป็น "สาขา SRC · รายการล่าสุด" โดยไม่ได้ขอ
  const notificationRecipientLabel = isWarehouse ? 'คลังสินค้า' : isPurchasing ? 'จัดซื้อ' : branchCodeLabel(userBranch);
  // ตัวเลขบนปุ่ม "🔔 อัพเดท" เท่านั้น — แยกจาก notificationUnreadCount (ปุ่ม "Order ใหม่") โดยตั้งใจ
  // เพราะคลังสินค้าตอนนี้มี 2 ตัวนับพร้อมกันจากคนละแหล่ง (ss_orders vs ss_branch_notification_events)
  // โปรไฟล์อื่นไม่กระทบ — ยังเป็นค่าเดียวกับ notificationUnreadCount เป๊ะ
  const notificationHistoryUnreadCount = isWarehouse ? warehouseUpdateUnreadCount : notificationUnreadCount;

  // เมื่อคลังสินค้าเปิดเมนู Order ถือว่าเห็นงานใหม่แล้ว จึงล้างจุดแจ้งเตือน
  // ⚠️ **เฉพาะคลังสินค้าเท่านั้นแล้ว** (2569-08-17) — จัดซื้อย้ายไปใช้ตารางเหตุการณ์
  //    (ss_branch_notification_events.read_at เคลียร์ผ่าน RPC ตอนเปิด drawer) ถ้าปล่อย effect นี้
  //    ทำงานกับจัดซื้อด้วย มันจะยิง update recipient_read_at จากสัญญาณคนละเรื่อง
  //    เพราะ notificationUnreadCount ของจัดซื้อตอนนี้มาจากตารางเหตุการณ์ ไม่ใช่ ss_orders
  // ⚠️ ต้องรวม 'BOTH' ด้วยเสมอ ให้ตรงกับ filter นับเลข badge ใน App.tsx — ไม่งั้นใบที่หา SKU ไม่เจอใน
  //    Product Master (recipient_department = 'BOTH') จะถูกนับเป็นเลขค้างใน badge ตลอดไป เพราะเปิดเมนูแล้ว
  //    ก็ไม่เคยมี query ไหนมาร์คว่าอ่านแล้วสักที (2569-08-17: 'BOTH' ไม่เคยแจ้งเตือนใครมาก่อน — ดูจุดเดียวกันใน App.tsx)
  // หมายเหตุ: แถวที่ recipient_department = 'PURCHASING' จะมี recipient_read_at ค้าง null ตลอดไป
  //    ตั้งใจปล่อยไว้ — ไม่มีใครอ่านแล้ว และการเขียนทับจะทำลาย audit trail
  //    (คอลัมน์นี้ยังใช้กรองตาราง + นับเมนูย่อยอยู่ ห้ามลบ)
  useEffect(() => {
    if (activeMenu !== 'order' || !isWarehouse || notificationUnreadCount <= 0) return;
    let cancelled = false;
    void supabase
      .from('ss_orders')
      .update({ recipient_read_at: new Date().toISOString() })
      .in('recipient_department', ['WAREHOUSE', 'BOTH'])
      .is('recipient_read_at', null)
      .then(({ error: readError }) => {
        if (cancelled || readError) return;
        setRefreshKey(key => key + 1);
      });
    return () => { cancelled = true; };
  }, [activeMenu, isWarehouse, notificationUnreadCount]);

  /** ปุ่ม "🔔 Order ใหม่" — เหลือเฉพาะคลังสินค้าแล้ว (จัดซื้อใช้ drawer ประวัติแทน) */
  const openDepartmentOrders = () => {
    setStepFilter(null);
    setActiveMenu('order');
  };

  /** จุดเดียวที่รู้จักรูปร่าง argument ของ RPC — ทั้ง 2 ทิศทางเรียกผ่านตัวนี้ */
  const createNotificationEvents = async (targets: string[], actorCode: string, meta: NotificationMeta) => {
    const { error } = await supabase.rpc('ss_create_branch_notifications', {
      target_branches: targets,
      target_actor_code: actorCode,
      target_menu_id: meta.menuId ?? activeMenu,
      target_table_name: meta.tableName ?? menu.table,
      target_record_id: meta.recordId === null || meta.recordId === undefined ? null : String(meta.recordId),
      event_title: meta.title ?? `อัปเดต ${menu.label}`,
      event_detail: meta.detail ?? null,
      event_item_sku: String(meta.itemSku ?? '').trim() || null,
      event_item_name: String(meta.itemName ?? '').trim() || null,
    });
    if (error) console.error('บันทึกการแจ้งเตือน SaleSupport ไม่สำเร็จ:', error.message);
  };

  // ── ทิศที่ 1: แผนก → สาขา ────────────────────────────────────────────
  // แจ้งเฉพาะการเปลี่ยนข้อมูลที่ทำโดยคลังสินค้า/จัดซื้อ
  // ถ้าแถวมีสาขา ให้แจ้งสาขานั้นสาขาเดียว; ข้อมูลกลางอย่าง Product/Supplier แจ้งทั้ง 3 สาขา
  // ⚠️ guard ด้านล่างตรงข้ามกับ notifyPurchasingUpdate สนิท (ดูคำเตือนที่ฟังก์ชันนั้น)
  const notifyBranchUpdate = async (branchValue?: unknown, meta: NotificationMeta = {}) => {
    if (!isPurchasing && !isWarehouse) return;
    const normalized = String(branchValue ?? '').trim().toUpperCase();
    const targets = (NOTIFIED_BRANCHES as readonly string[]).includes(normalized)
      ? [normalized]
      : [...NOTIFIED_BRANCHES];
    await createNotificationEvents(targets, isWarehouse ? 'WAREHOUSE' : 'PURCHASING', meta);
  };

  // ── ทิศที่ 2: สาขา → จัดซื้อ (เพิ่ม 2569-08-17) ────────────────────────
  // ผู้กระทำ = สาขาที่ล็อกอิน · ผู้รับ = 'PURCHASING' เสมอ
  // ⚠️ ไม่มี fan-out แบบ notifyBranchUpdate — ผู้รับมีรายเดียว ไม่มีเคส "ไม่รู้ว่าใคร"
  // ⚠️ คลังสินค้าไม่รับทางนี้ ยังใช้ recipient_department บน ss_orders เหมือนเดิม (ตั้งใจ ไม่ใช่ของตกหล่น)
  // ⚠️ guard ของ 2 ฟังก์ชันนี้แยกกันคนละทิศ 100% (ตัวโน้นต้องเป็นคลัง/จัดซื้อ · ตัวนี้ต้องเป็นสาขา)
  //    จึงเรียกคู่กันในฟังก์ชันเดียวได้โดยไม่มีทางยิงซ้ำ — **ถ้าใครคลาย guard ตัวใดตัวหนึ่ง
  //    จะยิงทั้งคู่ทันที แล้วจัดซื้อจะได้แจ้งเตือนซ้ำ**
  const notifyPurchasingUpdate = async (meta: NotificationMeta = {}) => {
    if (!isBranchUser || !userBranch) return;
    await createNotificationEvents(['PURCHASING'], userBranch, meta);
  };

  // ── ทิศที่ 3: สาขา → คลังสินค้า (เพิ่ม 2569-08-18) ─────────────────────
  // ผู้กระทำ = สาขาที่ล็อกอิน · ผู้รับ = 'WAREHOUSE' เสมอ · ครอบคลุมเฉพาะ Order + BackOrder
  // (ไม่รวม Request Item — SKU/MOQ เป็นงานฝั่งจัดซื้อ คลังไม่ได้ดูแลเมนูนั้น)
  // ⚠️ guard/รูปร่างเหมือน notifyPurchasingUpdate เป๊ะ ห้ามใช้ notifyBranchUpdate แทนด้วยเหตุผลเดียวกัน —
  //    fallback fan-out ของมันจะสแปมทั้ง 3 สาขาแทนที่จะแจ้งคลัง
  // ⚠️ ปุ่ม "Order ใหม่" เดิม (นับจาก ss_orders.recipient_department) ยังทำงานคู่ขนานอยู่ ไม่ได้ถูกแทนที่
  //    ทิศนี้ครอบคลุมกว้างกว่า (ไม่กรอง recipient_department) เพราะคลังกรอกฟอร์ม Inbound/Outbound/เลขโอน
  //    ให้ Order ทุกใบอยู่แล้ว ไม่ใช่แค่ใบที่ recipient_department เป็นของคลัง
  const notifyWarehouseUpdate = async (meta: NotificationMeta = {}) => {
    if (!isBranchUser || !userBranch) return;
    await createNotificationEvents(['WAREHOUSE'], userBranch, meta);
  };

  const openNotificationHistory = async () => {
    if (!notificationRecipient) return;
    setShowNotificationHistory(true);
    setNotificationLoading(true);
    setNotificationError('');
    const { data, error } = await supabase
      .from('ss_branch_notification_events')
      .select('id, branch, actor_code, menu_id, table_name, record_id, title, detail, item_sku, item_name, created_at, read_at')
      .eq('branch', notificationRecipient)
      .order('created_at', { ascending: false })
      .limit(100);
    setNotificationLoading(false);
    if (error) {
      setNotificationError(`โหลดประวัติอัพเดทไม่สำเร็จ: ${error.message}`);
      return;
    }
    let events = (data ?? []) as BranchNotificationEvent[];
    // ประวัติเก่าก่อนมี SKU/ชื่อสินค้า: เติมจาก Order ต้นทางที่ยังไม่ถูกลบ
    const missingOrderIds = [...new Set(events
      .filter(event => event.table_name === 'ss_orders' && event.record_id && (!event.item_sku || !event.item_name))
      .map(event => event.record_id!))];
    if (missingOrderIds.length > 0) {
      const { data: orderProducts } = await supabase
        .from('ss_orders')
        .select('id, sku, product_name')
        .in('id', missingOrderIds);
      const productByOrderId = new Map((orderProducts ?? []).map(order => [String(order.id), order]));
      events = events.map(event => {
        const product = event.record_id ? productByOrderId.get(event.record_id) : undefined;
        return product
          ? { ...event, item_sku: event.item_sku || product.sku || null, item_name: event.item_name || product.product_name || null }
          : event;
      });
    }
    setNotificationEvents(events);
    // เปิดแผงแล้วจึงถือว่าอ่าน ไม่ใช่เพียงแค่เข้าหน้า SaleSupport
    const { error: readError } = await supabase.rpc('ss_mark_branch_notifications_read', { target_branch: notificationRecipient });
    if (readError) setNotificationError(`บันทึกสถานะอ่านไม่สำเร็จ: ${readError.message}`);
  };

  // ล้างประวัติอัพเดท — ลบเฉพาะของผู้รับตัวเอง ไม่แตะของคนอื่น (แผงนี้ก็แสดงแค่ของตัวเองอยู่แล้ว)
  const confirmClearHistory = async () => {
    if (!notificationRecipient) return;
    if (clearHistoryPw !== ADMIN_PASSWORD) {
      setClearHistoryError('รหัส Admin ไม่ถูกต้อง');
      return;
    }
    if (!window.confirm(`ล้างประวัติอัพเดทของ ${notificationRecipientLabel} ทั้งหมด? การลบนี้ย้อนกลับไม่ได้`)) return;
    setClearingHistory(true);
    setClearHistoryError('');
    const { error } = await supabase
      .from('ss_branch_notification_events')
      .delete()
      .eq('branch', notificationRecipient);
    setClearingHistory(false);
    if (error) {
      setClearHistoryError(`ล้างประวัติไม่สำเร็จ: ${error.message}`);
      return;
    }
    setNotificationEvents([]);
    setNotificationError('');
    setShowClearHistory(false);
    setClearHistoryPw('');
  };

  const openNotificationEvent = (event: BranchNotificationEvent) => {
    const rawMenu = event.menu_id === 'supplier' ? 'products' : event.menu_id;
    // whitelist ด้วยเมนูที่โปรไฟล์นี้เห็นจริง ไม่ใช่ MENU_DISPLAY_ORDER ทั้งชุด
    // ไม่งั้นลิงก์แจ้งเตือนจะพาไปเมนูที่ถูกซ่อน แล้วออกไม่ได้เพราะไม่มีปุ่มใน sidebar
    if (!visibleMenus.some(m => m.id === rawMenu)) return;
    const targetMenu = rawMenu as MenuId;
    setShowNotificationHistory(false);
    setStepFilter(null);
    setNotificationTarget(null);
    setActiveMenu(targetMenu);
    const canOpenRecord = !!event.record_id && !event.title.startsWith('ลบข้อมูล');
    if (targetMenu === 'products' && canOpenRecord) setProductSearch(event.record_id!);
    if (canOpenRecord) setNotificationTarget({ menuId: targetMenu, recordId: event.record_id! });
  };

  // Request Item: คอลัมน์ SKU เห็นได้ทุกโปรไฟล์ (สาขาต้องเห็นค่าที่จัดซื้อลงไว้) แต่แก้ไม่ได้ ยกเว้นจัดซื้อ
  // — เดิมซ่อนคอลัมน์นี้ทั้งคอลัมน์สำหรับ non-purchasing ผ่าน `hideRequestSku` แล้วเลิกทำแบบนั้นตามคำสั่งผู้ใช้
  // 2569-08-17: "สาขาต้องเห็นคอลัมน์ SKU ด้วยเนื่องจากจัดซื้อจะลงข้อมูลมา (แต่สาขาแก้ไขไม่ได้)"
  // สิทธิ์แก้ไขคุมที่จุด render เซลล์แทน (เงื่อนไข `col.key === 'sku' && isPurchasing` — ไม่ผ่านตกไป
  // render เป็นข้อความอ่านอย่างเดียวเหมือนคอลัมน์อื่นทั่วไป) ส่วนฟอร์ม ➕ Add / ✏️ แก้ไข ยังกันด้วย
  // `isPurchasing` ตรงๆ ที่จุดของมันเองอยู่แล้ว ไม่เกี่ยวกับตัวแปรนี้
  const visibleColumns = menu.columns;

  const startSkuNameResize = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = skuNameWidth;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      setSkuNameWidth(Math.min(700, Math.max(180, startWidth + moveEvent.clientX - startX)));
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // หน่วงคำค้นหาเมนู Products 250ms กันยิง query ถี่
  useEffect(() => {
    const t = setTimeout(() => setProductQuery(productSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [productSearch]);

  // โหลดรายการค่า ABC ที่มีจริง + จำนวน — ยิงครั้งเดียวตอนเข้าเมนู Products
  // ดึงเฉพาะคอลัมน์ abc (สั้นมาก) วนทีละ 1000 เพราะ PostgREST ไม่มี DISTINCT
  useEffect(() => {
    if (activeMenu !== 'products' || abcOptions) return;
    let cancelled = false;
    (async () => {
      const found = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('product_master').select('abc').order('sku').range(from, from + 999);
        if (error || !data) return;              // โหลดไม่ได้ก็ไม่ต้องโชว์ chip
        for (const r of data) {
          const v = String(r.abc ?? '').trim();
          if (v) found.add(v);
        }
        if (data.length < 1000) break;
      }
      if (cancelled) return;
      setAbcOptions([...found].sort((a, b) => a.localeCompare(b)));
    })();
    return () => { cancelled = true; };
  }, [activeMenu, abcOptions]);

  // นับ Order ที่ยังค้าง "แยกทีละขั้น" → เมนูย่อยใต้ปุ่ม Order
  // ดึงเฉพาะ 4 คอลัมน์แล้วนับฝั่ง client ด้วย stepDone ตัวเดียวกับหน้ารายละเอียด
  // (ไม่กรองใน SQL เพราะเกณฑ์ "เสร็จ" เป็น string-contains — เขียนซ้ำใน SQL จะมี 2 แหล่งความจริง
  //  ที่หลุดจากกันได้ · ค่า null ก็ต้องนับว่ายังไม่เสร็จ)
  // ⚠️ นับจากทุกแถวในตาราง (วนทีละ 1000) ต่างจากตารางที่ดึงมาแค่ 500 แถวล่าสุด —
  //    ถ้า ss_orders โตเกิน 500 เลขในเมนูย่อยจะมากกว่าจำนวนแถวที่กรองได้ในตาราง
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase
          .from('ss_orders')
          .select('arrived_branch, customer_notified, delivered, pickup_date');
        // ⚠️ ต้องกรองให้ตรงกับ query ของตารางเป๊ะ ๆ ไม่งั้นเลขบนเมนูย่อยจะนับแถวที่ผู้ใช้มองไม่เห็น
        //    แล้วกดกรองไปตารางว่าง (คลังไม่กรอง เพราะเห็น Order ทุกใบ)
        if (isBranchUser) q = q.eq('branch', userBranch);
        else if (isPurchasing) q = q.in('recipient_department', ['PURCHASING', 'BOTH']);
        const { data, error } = await q.range(from, from + 999);
        if (error || !data) return;      // นับไม่ได้ก็ไม่ต้องโชว์ badge
        rows.push(...data);
        if (data.length < 1000) break;
      }
      if (cancelled) return;
      const today = toDateInputValue(new Date());
      const next = emptyStepCounts();
      for (const r of rows) {
        const late = (() => {
          const pick = String(r.pickup_date ?? '').slice(0, 10);
          return !!pick && pick < today;
        })();
        // แถวเดียวค้างได้หลายขั้นพร้อมกัน — นับเข้าทุกขั้นที่ยังไม่ผ่าน ไม่ใช่ขั้นแรกที่เจอ
        for (const s of ORDER_STEPS) {
          if (stepDone(String(r[s.key] ?? ''))) continue;
          next[s.key].pending++;
          if (late) next[s.key].overdue++;
        }
      }
      setStepCounts(next);
    })();
    return () => { cancelled = true; };
  }, [refreshKey, stampTick, isBranchUser, userBranch, isPurchasing]);

  // ยอดรวมทั้ง 3 ขั้น — 0 = ไม่มีอะไรค้าง ซ่อนเมนูย่อยทิ้งทั้งชุด
  const totalStepPending = ORDER_STEPS.reduce((n, s) => n + (stepCounts[s.key]?.pending ?? 0), 0);

  // เคลียร์ตัวกรองเมื่อไม่มีของค้างแล้ว ไม่งั้นเมนูย่อยหายไปพร้อมกับตัวกรองที่ยังทำงานอยู่ → ตารางว่างโดยไม่มีอะไรบอก
  useEffect(() => {
    if (totalStepPending === 0 && stepFilter) setStepFilter(null);
  }, [totalStepPending, stepFilter]);

  // ตาราง Order เมื่อกดเมนูย่อย → เหลือเฉพาะที่ยังไม่ผ่านขั้นนั้น (กรองฝั่ง client ด้วย stepDone ตัวเดียวกับที่ใช้นับ)
  const visibleRows = useMemo(() => {
    if (activeMenu !== 'order' || !stepFilter) return rows;
    return rows.filter(r => !stepDone(String(r[stepFilter] ?? '')));
  }, [rows, activeMenu, stepFilter]);

  // โหลดตาราง Supplier มาทำ map: รหัส/ค่าใดๆ ใน details → { ชื่อ Supplier, ค่า DISTRIBUTOR } (cache ครั้งเดียว)
  const loadSupplierMap = async (): Promise<Map<string, { name: string; distributor: string }>> => {
    if (supplierMapRef.current) return supplierMapRef.current;
    const map = new Map<string, { name: string; distributor: string }>();
    const { data } = await supabase.from('ss_suppliers').select('name, details').limit(10000);
    for (const s of data ?? []) {
      const name = String(s.name ?? '').trim();
      if (!name) continue;
      const details = (s.details as Record<string, string> | null) ?? {};
      // หาค่า DISTRIBUTOR แบบไม่สนตัวพิมพ์เล็ก-ใหญ่
      const distKey = Object.keys(details).find(k => k.trim().toLowerCase() === 'distributor');
      const distributor = distKey ? String(details[distKey] ?? '').trim() : '';
      const info = { name, distributor };
      map.set(name.toLowerCase(), info);
      for (const v of Object.values(details)) {
        const key = String(v).trim().toLowerCase();
        if (key && !map.has(key)) map.set(key, info);
      }
    }
    supplierMapRef.current = map;
    return map;
  };

  // จำนวนคงเหลือ + หน่วย ที่คลังสินค้า สำหรับคอลัมน์ "คลังมีสินค้า" ในตาราง BackOrder
  // ⚠️ ทุกโปรไฟล์เห็นยอดของ **คลังสินค้า** เหมือนกัน (ยืนยันกับผู้ใช้แล้ว 2569-08-15)
  //    สาขาต้องรู้ว่าคลังมีของพอส่งไหม ไม่ใช่ว่าตัวเองเหลือเท่าไหร่
  // ดึงเฉพาะ SKU ที่อยู่บนหน้าจอ (.in() cap 1000 แต่ตารางนี้ limit 500 จึงพอเสมอ)
  // ⚠️ ไม่ cache แบบ loadSupplierMap เพราะสต๊อกถูกเขียนทับใหม่ทุก 5 นาทีจาก Task Scheduler
  const loadWarehouseStock = async (skus: string[]) => {
    const map = new Map<string, { qty: string; unit: string }>();
    const unique = [...new Set(skus.map(s => s.trim()).filter(Boolean))];
    if (unique.length === 0) return map;
    const { data, error } = await supabase
      .from('stock')
      .select('sku, qty, unit')
      .eq('branch', WAREHOUSE_STOCK_BRANCH)
      .in('sku', unique);
    // อ่านสต๊อกไม่สำเร็จ → คืน null ให้ผู้เรียกแสดงช่องว่าง
    // (ถ้าคืน map ว่าง ทุกแถวจะกลายเป็น 0 = "ไม่มีของ" ทั้งที่จริงคือ "อ่านไม่ได้")
    if (error) return null;
    for (const r of data ?? []) {
      const key = String(r.sku ?? '').trim();
      if (!key || map.has(key)) continue;   // SKU ซ้ำ (คนละหน่วย) — เก็บแถวแรกที่เจอ
      // stock.qty เป็น text ใน DB — ตัดทศนิยมแบบเดียวกับหน้า Stock, ค่าที่ไม่ใช่ตัวเลขคงไว้ตามเดิม
      const raw = String(r.qty ?? '');
      map.set(key, {
        qty: raw === '' || isNaN(Number(raw)) ? raw : String(Math.floor(Number(raw))),
        unit: String(r.unit ?? ''),
      });
    }
    return map;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setRows([]);
      let query = supabase.from(menu.table).select('*');
      // ilike แบบไม่มี wildcard = เท่ากันโดยไม่สนตัวพิมพ์เล็ก-ใหญ่
      if (menu.filter) query = query.ilike(menu.filter.column, menu.filter.value);
      // สาขาเห็น Order ของตัวเองทั้งหมด; คลัง/จัดซื้อเห็นเฉพาะ Order ที่ส่งให้แผนกตน
      // ค่า BOTH ใช้กับข้อมูลเก่าก่อนมีช่องเลือกผู้รับ เพื่อไม่ให้รายการเดิมหาย
      // กรองที่ server ไม่ใช่ฝั่ง client เพื่อไม่ให้ limit 500 ถูกกินโดยแถวของสาขาอื่น
      if (menu.id === 'order' && isBranchUser) query = query.eq('branch', userBranch);
      // ⚠️ คลังสินค้าเห็น Order **ทุกใบ** ไม่กรองตามผู้รับ — เพราะคลังเป็นคนกรอก Inbound / Outbound /
      //    เลขโอนสินค้า ให้ทุกใบไม่ว่าจะเป็นของจัดซื้อ (ABC = P) หรือของคลังเอง
      //    จัดซื้อยังกรองอยู่เพราะดูแลเฉพาะ ABC = P · BOTH คือข้อมูลเก่าก่อนมีการแยกผู้รับ
      else if (menu.id === 'order' && isPurchasing) query = query.in('recipient_department', ['PURCHASING', 'BOTH']);
      // BackOrder: สาขาเห็นเฉพาะของตัวเอง คลังเห็นทุกสาขา (จัดซื้อเข้าเมนูนี้ไม่ได้)
      if (menu.id === 'backorder' && isBranchUser) query = query.eq('branch', userBranch);
      if (menu.id === 'products' && abcFilter.size > 0) {
        query = query.in('abc', [...abcFilter]);
      }
      if (menu.id === 'products' && productQuery) {
        query = query.or(`sku.ilike.${productQuery}%,name.ilike.%${productQuery}%,sku_name.ilike.%${productQuery}%`);
      }
      // Products เริ่มต้นโชว์ 20 รายการ, ค้นหาหรือกรอง ABC แล้วโชว์สูงสุด 500
      // (กรอง ABC = ผู้ใช้ตั้งใจไล่ดูทั้งกลุ่ม ถ้าเหลือ 20 จะไม่เห็นของที่กรองมา)
      const limit = menu.id === 'products'
        ? (productQuery || abcFilter.size > 0 ? 500 : 20)
        : 500;
      const { data, error } = await query
        .order(menu.orderBy ?? 'created_at', { ascending: menu.ascending ?? false })
        .limit(limit);
      if (cancelled) return;
      if (error) {
        setRows([]);
        setError(`โหลดข้อมูลไม่สำเร็จ (${error.message}) — ตรวจว่ารันไฟล์ salesupport-setup.sql ใน Supabase แล้วหรือยัง`);
      } else if (menu.id === 'products') {
        // เติม Distributor (ค่า DISTRIBUTOR) / Distributor Name (ชื่อ) จากข้อมูล Supplier โดยจับคู่รหัสในคอลัมน์ supplier
        const map = await loadSupplierMap();
        if (cancelled) return;
        setRows((data ?? []).map(r => {
          const code = String(r.supplier ?? '').trim();
          const info = code ? map.get(code.toLowerCase()) : undefined;
          return {
            ...r,
            distributor: info?.distributor || r.distributor,
            distributor_name: info?.name || r.distributor_name,
          };
        }));
      } else if (menu.id === 'backorder') {
        // "คลังมีสินค้า" + หน่วยที่คลังนับ ไม่ได้เก็บในตาราง — เติมสดจาก stock ของคลังโดยจับคู่ด้วย sku
        const stock = await loadWarehouseStock((data ?? []).map(r => String(r.sku ?? '')));
        if (cancelled) return;
        setRows((data ?? []).map(r => {
          const sku = String(r.sku ?? '').trim();
          const hit = sku ? stock?.get(sku) : undefined;
          return {
            ...r,
            // ไม่มีแถวใน stock = ไม่มีของจริง — ตาราง stock ไม่เก็บแถว qty = 0 เลยสักสาขา
            // (ตรวจกับข้อมูลจริงแล้ว: มีแต่ค่าติดลบ ไม่มี 0) → แสดง 0 ไม่ใช่ช่องว่าง
            // ยกเว้นอ่าน stock ไม่สำเร็จ (stock === null) ปล่อยว่างไว้ อย่าโกหกว่าเป็น 0
            stock_qty: hit?.qty ?? (stock && sku ? '0' : ''),
            stock_unit: hit?.unit ?? '',
          };
        }));
      } else {
        setRows(data ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [menu.table, menu.id, refreshKey, productQuery, abcFilter, isBranchUser, userBranch, isPurchasing]);

  // กดประวัติที่ผูกกับรายการ → ไปเมนูนั้นและเปิดรายละเอียดเมื่อโหลดแถวพบ
  useEffect(() => {
    if (!notificationTarget || loading || activeMenu !== notificationTarget.menuId) return;
    const row = rows.find(r =>
      String(r.id ?? '') === notificationTarget.recordId
      || String(r.sku ?? '') === notificationTarget.recordId,
    );
    if (!row) return;
    setNotificationTarget(null);
    setEditing(false);
    if (activeMenu === 'order' || activeMenu === 'backorder') {
      setSelectedOrder(row);
      setSelectedOrderTable(menu.table);
      setStampError('');
    } else if (activeMenu === 'request') {
      setSelectedRequest(row);
    } else {
      const targetMenu = MENUS.find(m => m.id === activeMenu)!;
      setDetailView({
        title: `รายละเอียด ${targetMenu.label}`,
        table: targetMenu.table,
        fields: activeMenu === 'products' ? PRODUCT_DETAIL_FIELDS : targetMenu.columns,
        row,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationTarget, loading, activeMenu, rows]);

  const updateForm = (patch: Partial<OrderForm>) => setOrderForm(f => ({ ...f, ...patch }));

  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestReqRef = useRef(0);

  // เติมชื่อสินค้า+หน่วยอัตโนมัติจาก SKU (ทุก ABC) — พิมพ์เองได้ถ้าไม่พบ
  /** SKU ที่ ABC = P ในชุดที่ส่งมา — ช่องค้นหาอ่านจาก `products` (มี barcode/หน่วย เหมือนหน้าป้ายราคา)
   *  แต่ค่า ABC อยู่ใน `product_master` จึงต้องถามอีกตารางแล้วกรองฝั่ง client
   *  ⚠️ SKU ที่ไม่มีใน product_master ถือว่า "ไม่ใช่ P" → เลือกได้ (products มี SKU มากกว่า product_master) */
  const findPurchasingSkus = async (skus: string[]): Promise<Set<string>> => {
    const blocked = new Set<string>();
    const unique = [...new Set(skus.map(s => s.trim()).filter(Boolean))];
    if (unique.length === 0) return blocked;
    const { data } = await supabase
      .from('product_master')
      .select('sku, abc')
      .in('sku', unique);
    for (const r of data ?? []) {
      // normalize trim+uppercase ให้ตรงกับที่ saveOrder ใช้ตัดสินผู้รับ Order
      if (String(r.abc ?? '').trim().toUpperCase() === 'P') blocked.add(String(r.sku ?? '').trim());
    }
    return blocked;
  };

  /** ค้นสินค้าจาก `products` แล้วยุบเหลือคู่ `sku-unit` ที่ไม่ซ้ำ — ใช้ร่วมกันทั้งฟอร์ม Order และ BackOrder
   *
   *  ⚠️ **ต้องอ่านจาก `products` ห้ามใช้ `product_master`** — `product_master` มี unique ที่ `sku`
   *     คือ 1 แถวต่อ SKU เก็บแค่ `base_unit` ทำให้ SKU ที่มีหลายหน่วยเห็นแค่หน่วยเดียว
   *     (เช่น 100074 เห็นแค่ "แผง" ไม่เห็น "กล่อง") · `products` มี 1 แถวต่อ barcode = ครบทุกหน่วย
   *     และมีคอลัมน์ `barcode` ให้สแกนได้ด้วย ซึ่ง product_master ไม่มี
   *
   *  exact = ตรงตัว (ใช้ตอนกด Enter) · ไม่ใส่ = ขึ้นต้นด้วย / มีคำนี้ (ใช้ตอนพิมพ์)
   *  excludeP = ตัดสินค้า ABC = P ออก (ฟอร์ม BackOrder ใช้) · onlyP = เอาเฉพาะ ABC = P (ฟอร์ม Order ใช้)
   *  2 ตัวนี้คนละทิศ ใช้พร้อมกันไม่ได้ — ไม่ใส่เลย = ไม่กรอง ABC
   *  ดึงเผื่อ 40 แถวแล้วค่อยเหลือ 8 เพราะจะโดนยุบหน่วยซ้ำ + อาจโดนกรอง ABC อีกทอด */
  const searchProductUnits = async (
    term: string,
    opts: { exact?: boolean; excludeP?: boolean; onlyP?: boolean } = {},
  ): Promise<ProductSuggestion[]> => {
    const q = term.trim();
    if (!q) return [];
    const filter = opts.exact
      ? `sku.eq.${q},barcode.eq.${q}`
      : `sku.ilike.${q}%,barcode.ilike.${q}%,name.ilike.%${q}%`;
    const { data, error } = await supabase
      .from('products')
      .select('sku, barcode, name, unit')
      .or(filter)
      .limit(40);
    if (error || !data) return [];
    // products.sku ไม่ unique (SKU เดียวมีหลายหน่วย: แผง/กล่อง/โหล) — ยุบเฉพาะคู่ sku-unit ที่ซ้ำกันจริง
    const seen = new Set<string>();
    const rows: ProductSuggestion[] = [];
    for (const d of data) {
      const sku = String(d.sku ?? '').trim();
      const unit = String(d.unit ?? '').trim();
      const key = `${sku}-${unit}`;
      if (!sku || seen.has(key)) continue;
      seen.add(key);
      rows.push({ sku, name: String(d.name ?? ''), unit });
    }
    if (!opts.excludeP && !opts.onlyP) return rows.slice(0, 8);
    const purchasingSkus = await findPurchasingSkus(rows.map(r => r.sku));
    const keep = opts.onlyP
      ? (r: ProductSuggestion) => purchasingSkus.has(r.sku)
      : (r: ProductSuggestion) => !purchasingSkus.has(r.sku);
    return rows.filter(keep).slice(0, 8);
  };

  // กด Enter → หาแบบตรงตัวด้วย SKU หรือ Barcode — เฉพาะ ABC = P (New Order มีไว้สำหรับยา Pre เท่านั้น)
  // เจอหน่วยเดียว = เติมให้เลย · เจอหลายหน่วย = โชว์รายการให้เลือกเอง (อย่าเดาหน่วยแทนผู้ใช้)
  const lookupSku = async (term: string) => {
    const q = term.trim();
    if (!q) return;
    setSuggestions([]);
    const rows = await searchProductUnits(q, { exact: true, onlyP: true });
    if (rows.length === 0) {
      // แยกให้ออกว่า "ไม่มีสินค้านี้" กับ "มีแต่ไม่ใช่ P" — ไม่งั้นพิมพ์แล้วเงียบไม่รู้เพราะอะไร
      const any = await searchProductUnits(q, { exact: true });
      if (any.length > 0) {
        setSaveError(`SKU ${any[0].sku} ไม่ใช่สินค้า ABC = P (Pre) — ใช้เมนู BackOrder แทน`);
      }
      return;
    }
    setSaveError('');
    if (rows.length === 1) {
      updateForm({ sku: rows[0].sku, product_name: rows[0].name, unit: rows[0].unit });
      return;
    }
    setSuggestions(rows);
  };

  // พิมพ์ 3 ตัวขึ้นไป → ค้นหารายชื่อสินค้ามาให้เลือก เฉพาะ ABC = P (หน่วง 250ms กันยิงถี่)
  const handleSkuChange = (value: string) => {
    updateForm({ sku: value });
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    // token กัน race — callback มี await ถ้าพิมพ์เร็วผลของคำเก่าอาจกลับมาทีหลังแล้วทับของใหม่
    const token = ++suggestReqRef.current;
    suggestTimer.current = setTimeout(async () => {
      const rows = await searchProductUnits(q, { onlyP: true });
      if (token !== suggestReqRef.current) return;
      setSuggestions(rows);
    }, 250);
  };

  const pickSuggestion = (s: ProductSuggestion) => {
    updateForm({ sku: s.sku, product_name: s.name, unit: s.unit });
    setSuggestions([]);
  };

  // ── ช่อง SKU ของฟอร์ม BackOrder — เหมือน Order แต่ตัดสินค้า ABC = P ออก ──
  const updateBackOrderForm = (patch: Partial<BackOrderForm>) => setBackOrderForm(f => ({ ...f, ...patch }));

  // กด Enter → หาแบบตรงตัวด้วย SKU หรือ Barcode (เหมือน lookupRow ในหน้าเบิกด่วน)
  // เจอหน่วยเดียว = เติมให้เลย · เจอหลายหน่วย = โชว์รายการให้เลือกเอง
  const lookupBackOrderSku = async (term: string) => {
    const q = term.trim();
    if (!q) return;
    setSuggestions([]);
    const rows = await searchProductUnits(q, { exact: true, excludeP: true });
    if (rows.length === 0) {
      // แยกให้ออกว่า "ไม่มีสินค้านี้" กับ "มีแต่เป็นของจัดซื้อ" — ไม่งั้นพิมพ์แล้วเงียบไม่รู้เพราะอะไร
      const any = await searchProductUnits(q, { exact: true });
      if (any.length > 0) {
        setSaveError(`SKU ${any[0].sku} เป็นสินค้า ABC = P (งานจัดซื้อ) — ใช้เมนู Order แทน`);
      }
      return;
    }
    setSaveError('');
    if (rows.length === 1) {
      updateBackOrderForm({ sku: rows[0].sku, product_name: rows[0].name, unit: rows[0].unit });
      return;
    }
    setSuggestions(rows);
  };

  const handleBackOrderSkuChange = (value: string) => {
    updateBackOrderForm({ sku: value });
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    // token กัน race — callback มี await ถ้าพิมพ์เร็วผลของคำเก่าอาจกลับมาทีหลังแล้วทับของใหม่
    const token = ++suggestReqRef.current;
    suggestTimer.current = setTimeout(async () => {
      const rows = await searchProductUnits(q, { excludeP: true });
      if (token !== suggestReqRef.current) return;
      setSuggestions(rows);
    }, 250);
  };

  const pickBackOrderSuggestion = (s: ProductSuggestion) => {
    // หน่วยของบรรทัดที่เลือก (= หน่วยของ barcode นั้น) ถูกเก็บลง ss_backorders.unit
    updateBackOrderForm({ sku: s.sku, product_name: s.name, unit: s.unit });
    setSuggestions([]);
    setSaveError('');
  };

  const openAddBackOrder = () => {
    setBackOrderForm({
      ...emptyBackOrderForm(),
      branch: isBranchUser ? (userBranch ?? 'SRC') : 'SRC',
    });
    setSuggestions([]);
    setSaveError('');
    setShowAddBackOrder(true);
  };

  const saveBackOrder = async () => {
    const branch = isBranchUser ? (userBranch ?? 'SRC') : backOrderForm.branch;
    if (!backOrderForm.sku.trim()) { setSaveError('กรุณาใส่ SKU'); return; }
    if (!backOrderForm.pending_qty || Number(backOrderForm.pending_qty) <= 0) {
      setSaveError('กรุณาใส่จำนวนที่ค้างส่งลูกค้าให้ถูกต้อง'); return;
    }
    if (!backOrderForm.sale_bill_no.trim()) { setSaveError('กรุณาใส่เลขที่บิล'); return; }
    setSaving(true);
    setSaveError('');
    // ช่องวันที่ที่เว้นว่าง → null ไม่ใช่ '' (คอลัมน์ date ใน Postgres รับสตริงว่างไม่ได้)
    const { error } = await supabase.from('ss_backorders').insert({
      branch,
      sku: backOrderForm.sku.trim(),
      product_name: backOrderForm.product_name.trim() || null,
      unit: backOrderForm.unit.trim() || null,
      pending_qty: Number(backOrderForm.pending_qty),
      customer_name: backOrderForm.customer_name.trim() || null,
      paid_date: backOrderForm.paid_date || null,
      sale_bill_no: backOrderForm.sale_bill_no.trim(),
      pickup_date: backOrderForm.pickup_date || null,
      note: backOrderForm.note.trim() || null,
      ...ORDER_INITIAL_STATUSES,
      // created_at (TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
    });
    setSaving(false);
    if (error) {
      setSaveError(`บันทึกไม่สำเร็จ: ${error.message}`);
      return;
    }
    void notifyBranchUpdate(branch, {
      menuId: 'backorder', tableName: 'ss_backorders', title: 'เพิ่ม BackOrder ใหม่',
      detail: [backOrderForm.sku, backOrderForm.product_name].filter(Boolean).join(' · '),
      itemSku: backOrderForm.sku,
      itemName: backOrderForm.product_name,
    });
    // สาขาสร้าง BackOrder → แจ้งคลังสินค้า (BackOrder ไม่เคยมีทิศนี้มาก่อนเลย — เพิ่มใหม่ทั้งหมด)
    void notifyWarehouseUpdate({
      menuId: 'backorder', tableName: 'ss_backorders', title: 'สาขาเพิ่ม BackOrder ใหม่',
      detail: `จำนวนค้างส่ง ${backOrderForm.pending_qty}${backOrderForm.unit ? ` ${backOrderForm.unit}` : ''}`,
      itemSku: backOrderForm.sku,
      itemName: backOrderForm.product_name,
    });
    setShowAddBackOrder(false);
    setActiveMenu('backorder');
    setRefreshKey(k => k + 1);
  };

  const openAddOrder = () => {
    const initialOrder = emptyOrderForm();
    setOrderForm({
      ...initialOrder,
      branch: isBranchUser ? (userBranch ?? 'SRC') : initialOrder.branch,
    });
    setSuggestions([]);
    setSaveError('');
    setShowAddOrder(true);
  };

  const saveOrder = async () => {
    const orderBranch = isBranchUser ? (userBranch ?? 'SRC') : orderForm.branch;
    if (!orderForm.sku.trim()) { setSaveError('กรุณาใส่ SKU'); return; }
    if (!orderForm.qty || Number(orderForm.qty) <= 0) { setSaveError('กรุณาใส่จำนวนให้ถูกต้อง'); return; }
    if (!orderForm.paid_date) { setSaveError('กรุณาใส่วันที่ชำระ'); return; }
    if (!orderForm.sale_bill_no.trim()) { setSaveError('กรุณาใส่เลขบิลขาย'); return; }
    if (!orderForm.pickup_date) { setSaveError('กรุณาใส่วันที่นัดรับ'); return; }
    // เช็คซ้ำฝั่ง JS ด้วย — attribute min บน <input type="date"> กันแค่ปฏิทิน พิมพ์เองยังลอดได้
    // เทียบ ณ เวลาบันทึก ไม่ใช่เวลาเปิดฟอร์ม (เผื่อเปิดค้างข้ามวัน)
    const minPickup = addBusinessDays(PICKUP_DATE_OFFSET_DAYS);
    if (orderForm.pickup_date < minPickup) {
      setSaveError(`วันที่นัดรับต้องไม่เร็วกว่า ${new Date(minPickup).toLocaleDateString('th-TH')} (บวก ${PICKUP_DATE_OFFSET_DAYS} วันทำการจากวันที่บันทึก ไม่นับเสาร์-อาทิตย์)`);
      return;
    }
    setSaving(true);
    setSaveError('');
    // New Order เฉพาะยา Pre (ABC = P) เท่านั้น — ช่องค้นหา SKU กรอง P ไว้แล้ว แต่พิมพ์เองล้วนๆ
    // ยังข้าม UI นั้นได้ จึงต้องเช็คซ้ำที่นี่กันเผื่อ (เหมือน min pickup_date ด้านบน)
    // ไม่พบ SKU ใน Product Master (พิมพ์เองไม่ตรงฐาน) → ไม่ทราบ ABC ปล่อยผ่านเป็น BOTH กันออเดอร์ไม่มีใครเห็นเลย
    const { data: masterRow } = await supabase
      .from('product_master')
      .select('abc')
      .eq('sku', orderForm.sku.trim())
      .limit(1);
    const abc = String(masterRow?.[0]?.abc ?? '').trim().toUpperCase();
    if (abc && abc !== 'P') {
      setSaving(false);
      setSaveError(`SKU ${orderForm.sku.trim()} ไม่ใช่สินค้า ABC = P (Pre) — ใช้เมนู BackOrder แทน`);
      return;
    }
    const recipientDepartment = !abc ? 'BOTH' : 'PURCHASING';
    const orderPayload = {
      branch: orderBranch,
      recipient_department: recipientDepartment,
      sku: orderForm.sku.trim(),
      product_name: orderForm.product_name.trim() || null,
      unit: orderForm.unit.trim() || null,
      qty: Number(orderForm.qty),
      paid_date: orderForm.paid_date,
      sale_bill_no: orderForm.sale_bill_no.trim(),
      customer_name: orderForm.customer_name.trim() || null,
      contact_channel: orderForm.contact_value.trim() ? orderForm.contact_channel : null,
      phone: orderForm.contact_value.trim() || null,
      pickup_date: orderForm.pickup_date,
      delivery_method: orderForm.delivery_method,
      note: orderForm.note.trim() || null,
      ...ORDER_INITIAL_STATUSES,
      // created_at (TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
    };
    const { error, id: newOrderId } = await insertWithContactChannelFallback('ss_orders', orderPayload);
    setSaving(false);
    if (error) {
      setSaveError(`บันทึกไม่สำเร็จ: ${error.message}`);
    } else {
      void notifyBranchUpdate(orderBranch, {
        menuId: 'order', tableName: 'ss_orders', title: 'เพิ่ม Order ใหม่',
        detail: [orderForm.sku, orderForm.product_name].filter(Boolean).join(' · '),
        itemSku: orderForm.sku,
        itemName: orderForm.product_name,
      });
      // สาขาสร้าง Order → แจ้งจัดซื้อ (ทิศตรงข้ามกับบรรทัดบน — ยิงคนละโปรไฟล์ ไม่ซ้ำกัน)
      // ⚠️ ห้าม gate ด้วย recipientDepartment === 'PURCHASING' — ค่า 'BOTH' (SKU ไม่มีใน
      //    Product Master) จัดซื้อก็ต้องเห็น ไม่งั้นจะเป็นบั๊กตัวเดียวกับที่แก้ไปเมื่อ 2569-08-17
      // detail ไม่ซ้ำ SKU/ชื่อ เพราะ 2 ค่านั้นมีบล็อกแสดงผลของตัวเองอยู่แล้วใน drawer
      const newOrderDetail = [
        `จำนวน ${orderForm.qty}${orderForm.unit ? ` ${orderForm.unit}` : ''}`,
        orderForm.pickup_date ? `นัดรับ ${new Date(orderForm.pickup_date).toLocaleDateString('th-TH')}` : '',
        orderForm.sale_bill_no ? `บิล ${orderForm.sale_bill_no}` : '',
      ].filter(Boolean).join(' · ');
      void notifyPurchasingUpdate({
        menuId: 'order', tableName: 'ss_orders', recordId: newOrderId,
        title: 'สาขาเพิ่ม Order ใหม่',
        detail: newOrderDetail,
        itemSku: orderForm.sku,
        itemName: orderForm.product_name,
      });
      // สาขาสร้าง Order → แจ้งคลังด้วย (คู่ขนานกับที่แจ้งจัดซื้อ) — คลังกรอก Inbound/Outbound/เลขโอนให้ทุกใบ
      // ไม่ใช่แค่ใบที่ recipient_department เป็นของคลัง จึงไม่กรองด้วยค่านั้นเหมือนกับที่แจ้งจัดซื้อไม่กรอง
      void notifyWarehouseUpdate({
        menuId: 'order', tableName: 'ss_orders', recordId: newOrderId,
        title: 'สาขาเพิ่ม Order ใหม่',
        detail: newOrderDetail,
        itemSku: orderForm.sku,
        itemName: orderForm.product_name,
      });
      setShowAddOrder(false);
      setActiveMenu('order');
      setRefreshKey(k => k + 1);
    }
  };

  const updateRequestForm = (patch: Partial<RequestForm>) => setRequestForm(f => ({ ...f, ...patch }));

  const openAddRequest = () => {
    const initialRequest = emptyRequestForm();
    setRequestForm({
      ...initialRequest,
      branch: isBranchUser ? (userBranch ?? 'SRC') : initialRequest.branch,
    });
    setRequestImage(null);
    setSaveError('');
    setShowAddRequest(true);
  };

  // อัปโหลดรูปเข้า Supabase Storage แล้วคืน public URL
  const uploadImage = async (file: File, folder: string): Promise<string> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('salesupport').upload(path, file);
    if (error) throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${error.message} — ตรวจว่ารัน salesupport-setup.sql เวอร์ชันล่าสุด (สร้าง bucket) แล้วหรือยัง`);
    return supabase.storage.from('salesupport').getPublicUrl(path).data.publicUrl;
  };

  const saveRequest = async () => {
    const requestBranch = isBranchUser ? (userBranch ?? 'SRC') : requestForm.branch;
    if (!requestForm.product_name.trim()) { setSaveError('กรุณาใส่ชื่อสินค้า'); return; }
    if (isPurchasing && !requestForm.sku.trim()) { setSaveError('กรุณาใส่ SKU'); return; }
    if (!requestForm.generic_name.trim()) { setSaveError('กรุณาใส่ Generic Name'); return; }
    if (!requestForm.strength.trim()) { setSaveError('กรุณาใส่ความแรง'); return; }
    if (!requestForm.qty || Number(requestForm.qty) <= 0) { setSaveError('กรุณาใส่จำนวนที่ต้องการ'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const imageUrl = requestImage ? await uploadImage(requestImage, 'request-items') : null;
      const requestPayload = {
        branch: requestBranch,
        product_name: requestForm.product_name.trim(),
        supplier: requestForm.supplier.trim() || null,
        image_url: imageUrl,
        sku: requestForm.sku.trim() || null,
        generic_name: requestForm.generic_name.trim(),
        strength: requestForm.strength.trim(),
        pack_size: requestForm.pack_size.trim() || null,
        qty: Number(requestForm.qty),
        customer_name: requestForm.customer_name.trim() || null,
        contact_channel: requestForm.contact_value.trim() ? requestForm.contact_channel : null,
        phone: requestForm.contact_value.trim() || null,
        need_date: requestForm.need_date || null,
        status: 'รอตรวจสอบ',
        // created_at (DateTime/TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
      };
      const { error, id: newRequestId } = await insertWithContactChannelFallback('ss_request_items', requestPayload);
      if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
      void notifyBranchUpdate(requestBranch, {
        menuId: 'request', tableName: 'ss_request_items', title: 'เพิ่ม Request Item ใหม่',
        detail: [requestForm.sku, requestForm.product_name].filter(Boolean).join(' · '),
        itemSku: requestForm.sku,
        itemName: requestForm.product_name,
      });
      // สาขาขอสินค้าใหม่ → แจ้งจัดซื้อ (จัดซื้อเป็นคนหาของ/ลง SKU+MOQ ต่อ)
      // detail ไม่ซ้ำ SKU/ชื่อ เพราะ 2 ค่านั้นมีบล็อกแสดงผลของตัวเองอยู่แล้วใน drawer
      void notifyPurchasingUpdate({
        menuId: 'request', tableName: 'ss_request_items', recordId: newRequestId,
        title: 'สาขาขอสินค้าใหม่ (Request Item)',
        detail: [
          `จำนวน ${requestForm.qty}`,
          [requestForm.generic_name.trim(), requestForm.strength.trim()].filter(Boolean).join(' '),
          requestForm.need_date ? `ต้องการ ${new Date(requestForm.need_date).toLocaleDateString('th-TH')}` : '',
          requestForm.supplier.trim() ? `supplier ${requestForm.supplier.trim()}` : '',
        ].filter(Boolean).join(' · '),
        itemSku: requestForm.sku,
        itemName: requestForm.product_name,
      });
      setShowAddRequest(false);
      setActiveMenu('request');
      setRefreshKey(k => k + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateProductForm = (patch: Partial<NewProductForm>) => setProductForm(f => ({ ...f, ...patch }));

  const openAddProduct = () => {
    setProductForm(emptyNewProductForm());
    setProductImage(null);
    setSaveError('');
    setShowAddProduct(true);
  };

  const saveProduct = async () => {
    if (!productForm.ask_qty || Number(productForm.ask_qty) <= 0) { setSaveError('กรุณาใส่ Ask Qty ให้ถูกต้อง'); return; }
    if (!productForm.name_brand.trim()) { setSaveError('กรุณาใส่ Name/Brand'); return; }
    if (!productForm.active_ingredient.trim()) { setSaveError('กรุณาใส่ชื่อยา/สารสำคัญ'); return; }
    if (!productForm.pack_size.trim()) { setSaveError('กรุณาใส่ขนาดบรรจุ'); return; }
    if (!productImage) { setSaveError('กรุณาแนบรูปสินค้า'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const imageUrl = await uploadImage(productImage, 'new-products');
      const { error } = await supabase.from('ss_new_products').insert({
        branch: productForm.branch,
        ask_qty: Number(productForm.ask_qty),
        name_brand: productForm.name_brand.trim(),
        active_ingredient: productForm.active_ingredient.trim(),
        pack_size: productForm.pack_size.trim(),
        image_url: imageUrl,
        supplier: productForm.supplier.trim() || null,
        quoted_price: productForm.quoted_price.trim() || null,
        note: productForm.note.trim() || null,
        status: 'รอพิจารณา', // Status จริงอัปเดตโดยแผนกจัดซื้อ
        // created_at (TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
      });
      if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
      void notifyBranchUpdate(productForm.branch, {
        menuId: 'newproduct', tableName: 'ss_new_products', title: 'เพิ่ม New Product ใหม่',
        detail: productForm.name_brand,
        itemName: productForm.name_brand,
      });
      setShowAddProduct(false);
      setActiveMenu('newproduct');
      setRefreshKey(k => k + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // อ่านไฟล์ Excel → หา "คอลัมน์ชื่อ" → แทนที่ข้อมูลใน ss_suppliers ทั้งหมด
  const handleSupplierFile = async (file: File) => {
    setUploadingSupplier(true);
    setSupplierMsg('');
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('ไม่พบชีทข้อมูลในไฟล์');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (rows.length === 0) throw new Error('ไฟล์ไม่มีข้อมูล');

      const headers = Object.keys(rows[0]);
      // เลือกคอลัมน์ชื่อ: NAME ตรงตัวมาก่อน แล้วค่อยไล่หาคำใกล้เคียง
      const nameKey =
        headers.find(h => h.trim().toLowerCase() === 'name') ??
        headers.find(h => /^ชื่อ/.test(h.trim())) ??
        headers.find(h => /name|ชื่อ/i.test(h)) ??
        headers.find(h => /supplier|บริษัท/i.test(h)) ??
        headers[0];

      const seen = new Set<string>();
      const suppliers: SupplierRow[] = [];
      for (const r of rows) {
        const name = String(r[nameKey] ?? '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const details: Record<string, string> = {};
        for (const h of headers) {
          if (h === nameKey) continue;
          const v = String(r[h] ?? '').trim();
          if (v) details[h] = v;
        }
        suppliers.push({ name, details: Object.keys(details).length > 0 ? details : null });
      }
      if (suppliers.length === 0) throw new Error(`ไม่พบชื่อ Supplier ในคอลัมน์ "${nameKey}"`);

      if (!window.confirm(`พบ ${suppliers.length} รายการ (คอลัมน์ชื่อ: "${nameKey}") — แทนที่ข้อมูล Supplier เดิมทั้งหมด?`)) {
        return;
      }

      const { error: delError } = await supabase
        .from('ss_suppliers')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (delError) throw new Error(`ล้างข้อมูลเดิมไม่สำเร็จ: ${delError.message} — ตรวจว่ารัน SQL สร้างตาราง ss_suppliers แล้วหรือยัง`);

      for (let i = 0; i < suppliers.length; i += 100) {
        const { error } = await supabase.from('ss_suppliers').insert(suppliers.slice(i, i + 100));
        if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
      }
      setSupplierMsg(`✓ นำเข้า Supplier ${suppliers.length} รายการ`);
      void notifyBranchUpdate(undefined, {
        menuId: 'supplier', tableName: 'ss_suppliers', title: 'อัปเดต Supplier',
        detail: `นำเข้า Supplier ${suppliers.length.toLocaleString()} รายการ`,
      });
      supplierMapRef.current = null; // ล้าง cache ให้ Distributor Name ในเมนู Products อัปเดตตาม
      setRefreshKey(k => k + 1);
    } catch (e) {
      setSupplierMsg(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingSupplier(false);
      if (supplierFileRef.current) supplierFileRef.current.value = '';
    }
  };

  // อ่านไฟล์ Product_Master → จับคู่หัวคอลัมน์ → แทนที่ข้อมูล product_master ทั้งหมด
  const handleMasterFile = async (file: File) => {
    setUploadingMaster(true);
    setMasterMsg('');
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('ไม่พบชีทข้อมูลในไฟล์');
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (rows.length === 0) throw new Error('ไฟล์ไม่มีข้อมูล');

      const headers = Object.keys(rows[0]);
      const headerToCol = new Map<string, string>();
      for (const h of headers) {
        const hit = MASTER_HEADER_MAP.find(([re]) => re.test(h.trim()));
        if (hit && ![...headerToCol.values()].includes(hit[1])) headerToCol.set(h, hit[1]);
      }
      if (![...headerToCol.values()].includes('sku')) {
        throw new Error(`ไม่พบคอลัมน์ SKU ในไฟล์ (หัวคอลัมน์ที่เจอ: ${headers.slice(0, 8).join(', ')}...)`);
      }

      // ทุกแถวต้องมี key ชุดเดียวกัน (ช่องว่างเป็น null) ไม่งั้น bulk upsert จะไม่ผ่าน
      const cols = [...new Set(headerToCol.values())];
      const seen = new Set<string>();
      const products: Record<string, string | null>[] = [];
      for (const r of rows) {
        const rec: Record<string, string | null> = Object.fromEntries(cols.map(c => [c, null]));
        for (const [h, col] of headerToCol) {
          const v = String(r[h] ?? '').trim();
          if (v) rec[col] = v;
        }
        if (!rec.sku || seen.has(rec.sku)) continue;
        seen.add(rec.sku);
        products.push(rec);
      }
      if (products.length === 0) throw new Error('ไม่พบแถวที่มี SKU');

      const mapped = [...headerToCol.keys()].join(', ');
      if (!window.confirm(
        `พบสินค้า ${products.length} รายการ\nคอลัมน์ที่นำเข้า: ${mapped}\n\n` +
        `Merge ตาม SKU: SKU ที่มีอยู่จะถูกอัปเดตตามไฟล์, SKU ใหม่จะถูกเพิ่ม (ไม่ลบรายการอื่น)`
      )) {
        return;
      }

      for (let i = 0; i < products.length; i += 100) {
        const { error } = await supabase
          .from('product_master')
          .upsert(products.slice(i, i + 100), { onConflict: 'sku' });
        if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message} — ตรวจว่ารัน SQL เวอร์ชันล่าสุด (unique SKU) แล้วหรือยัง`);
      }
      setMasterMsg(`✓ นำเข้า/อัปเดต Product Master ${products.length} รายการ`);
      void notifyBranchUpdate(undefined, {
        menuId: 'products', tableName: 'product_master', title: 'อัปเดต Product Master',
        detail: `นำเข้า/อัปเดต ${products.length.toLocaleString()} รายการ`,
      });
      setAbcOptions(null);        // ไฟล์ใหม่อาจมีค่า ABC ที่ยังไม่เคยมี → โหลด chip ใหม่
      setRefreshKey(k => k + 1);
    } catch (e) {
      setMasterMsg(`✕ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadingMaster(false);
      if (masterFileRef.current) masterFileRef.current.value = '';
    }
  };

  const updateMasterForm = (patch: Partial<MasterForm>) => setMasterForm(f => ({ ...f, ...patch }));

  const openAddMaster = () => {
    setMasterForm(emptyMasterForm());
    setSaveError('');
    setShowAddMaster(true);
  };

  const saveMaster = async () => {
    if (!masterForm.sku.trim()) { setSaveError('กรุณาใส่ SKU'); return; }
    setSaving(true);
    setSaveError('');
    const payload: Record<string, string | null> = {};
    (Object.keys(masterForm) as (keyof MasterForm)[]).forEach(k => {
      payload[k] = masterForm[k].trim() || null;
    });
    const { error } = await supabase.from('product_master').insert(payload);
    setSaving(false);
    if (error) {
      setSaveError(error.code === '23505'
        ? `SKU "${masterForm.sku.trim()}" มีอยู่ใน Product Master แล้ว`
        : `บันทึกไม่สำเร็จ: ${error.message}`);
    } else {
      void notifyBranchUpdate(undefined, {
        menuId: 'products', tableName: 'product_master', recordId: masterForm.sku,
        title: 'เพิ่มสินค้าใน Product Master', detail: masterForm.sku,
        itemSku: masterForm.sku,
        itemName: masterForm.name,
      });
      setShowAddMaster(false);
      setActiveMenu('products');
      setAbcOptions(null);        // สินค้าใหม่อาจมีค่า ABC ที่ยังไม่เคยมี
      setRefreshKey(k => k + 1);
    }
  };

  // popup ใช้ร่วมกับ BackOrder — ชื่อเมนู/ตารางต้องอ้างจากแถวที่เปิดอยู่ ไม่ใช่ค่าคงที่ 'ss_orders'
  const isBackOrderDetail = selectedOrderTable === 'ss_backorders';
  const orderDetailMenuId: MenuId = isBackOrderDetail ? 'backorder' : 'order';
  const orderDetailLabel = isBackOrderDetail ? 'BackOrder' : 'Order';
  const orderWarehouseFields = warehouseFieldsFor(selectedOrderTable);

  // ── Toast แจ้งผลกดตราประทับ ──
  // เก็บ timer ไว้เคลียร์ตอน unmount — ปิดป๊อปอัปหรือออกจากหน้าระหว่าง toast ยังค้าง
  // แล้ว setState หลัง unmount จะ warning
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<Set<number>>(new Set());
  useEffect(() => () => { toastTimersRef.current.forEach(clearTimeout); }, []);

  const pushStampToast = (tone: StampToastTone, title: string, detail: string) => {
    const id = ++toastIdRef.current;
    setStampToasts(prev => [...prev, { id, tone, title, detail }].slice(-STAMP_TOAST_MAX));
    // ตั้ง leaving แล้วปล่อยให้ onAnimationEnd เป็นคนถอดออกจริง — ไม่ต้องใช้ timer ใบที่สอง
    const timer = window.setTimeout(() => {
      toastTimersRef.current.delete(timer);
      setStampToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)));
    }, STAMP_TOAST_MS);
    toastTimersRef.current.add(timer);
  };

  // กล่องยืนยัน "ยกเลิกสถานะ" — แทนที่ window.confirm() ด้วยดีไซน์ "Centered Icon Alert"
  // (เลือกจาก public/confirm-dialog-designs.html แบบที่ 6) · step ที่รอยืนยันอยู่ = เปิดกล่อง, null = ปิด
  const [confirmCancelStep, setConfirmCancelStep] = useState<typeof ORDER_STEPS[number] | null>(null);

  // บันทึกค่าสถานะจริงลง Supabase — แยกออกจาก toggleOrderStep เพื่อให้เรียกได้ทั้งจากคลิกตรงๆ (อนุมัติ)
  // และจากปุ่ม "ยืนยัน" ในกล่อง Centered Icon Alert (ยกเลิก)
  const applyStepChange = async (step: typeof ORDER_STEPS[number], isDone: boolean) => {
    if (!selectedOrder) return;
    const id = String(selectedOrder.id);
    const next = isDone ? step.pending : step.done;
    const { error } = await supabase.from(selectedOrderTable).update({ [step.key]: next }).eq('id', id);
    if (error) {
      // ยิง toast คู่กับข้อความใต้แถวตรา — toast สะกิดให้รู้ทันที ส่วน .ss-form-error ค้างไว้ให้อ่านซ้ำได้
      setStampError(`อัปเดตไม่สำเร็จ: ${error.message}`);
      pushStampToast('error', 'อัปเดตไม่สำเร็จ', step.label);
      return;
    }
    setStampError('');
    pushStampToast(
      isDone ? 'cancel' : 'ok',
      isDone ? 'ยกเลิกสถานะแล้ว' : 'อนุมัติแล้ว',
      `${step.label} → ${next}`,
    );
    setSelectedOrder(o => (o ? { ...o, [step.key]: next } : o));
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, [step.key]: next } : r)));
    setStampTick(t => t + 1);   // อัปเดต badge ทันที
    void notifyBranchUpdate(selectedOrder.branch, {
      menuId: orderDetailMenuId, tableName: selectedOrderTable, recordId: selectedOrder.id,
      title: `อัปเดตสถานะ ${orderDetailLabel}`, detail: `${step.label} → ${next}`,
      itemSku: selectedOrder.sku,
      itemName: selectedOrder.product_name,
    });
    // สาขากดตรา → แจ้งจัดซื้อ
    // ⚠️ ฟังก์ชันนี้ใช้ร่วมกับ BackOrder (selectedOrderTable เป็นได้ทั้ง ss_orders / ss_backorders)
    //    BackOrder อยู่นอกขอบเขตโดยตั้งใจ — จัดซื้อไม่เห็นเมนูนั้นด้วยซ้ำ (MENUS roles) ถ้าไม่กัน
    //    จะแจ้งเตือนแล้วคลิกไปตันที่ whitelist ใน openNotificationEvent โดยไม่มี feedback
    if (selectedOrderTable === 'ss_orders') {
      void notifyPurchasingUpdate({
        menuId: 'order', tableName: 'ss_orders', recordId: selectedOrder.id,
        title: 'สาขาอัปเดตสถานะ Order', detail: `${step.label} → ${next}`,
        itemSku: selectedOrder.sku,
        itemName: selectedOrder.product_name,
      });
    }
    // สาขากดตรา → แจ้งคลังด้วยเสมอ ไม่กรองตาราง (ต่างจากจัดซื้อด้านบนที่กรองเฉพาะ ss_orders)
    // เพราะคลังดูแลทั้ง Order และ BackOrder ตามที่ตกลงไว้
    void notifyWarehouseUpdate({
      menuId: orderDetailMenuId, tableName: selectedOrderTable, recordId: selectedOrder.id,
      title: `สาขาอัปเดตสถานะ ${orderDetailLabel}`, detail: `${step.label} → ${next}`,
      itemSku: selectedOrder.sku,
      itemName: selectedOrder.product_name,
    });
  };

  // กดตราประทับใน Popup Order/BackOrder: อนุมัติทันที / ยกเลิกต้องยืนยันก่อน (เปิดกล่อง Centered Icon Alert)
  const toggleOrderStep = (step: typeof ORDER_STEPS[number]) => {
    if (!selectedOrder) return;
    const current = String(selectedOrder[step.key] ?? '');
    if (stepDone(current)) { setConfirmCancelStep(step); return; }
    void applyStepChange(step, false);
  };

  const confirmCancelStepNo = () => setConfirmCancelStep(null);
  const confirmCancelStepYes = () => {
    if (!confirmCancelStep) return;
    const step = confirmCancelStep;
    setConfirmCancelStep(null);
    void applyStepChange(step, true);
  };

  // ── ฟอร์มคลังสินค้าใน popup Order / BackOrder ──
  const whSavedValues = useMemo(
    () => whFormFrom(selectedOrder, selectedOrderTable),
    [selectedOrder, selectedOrderTable],
  );
  const whDirty = orderWarehouseFields.some(f => (whForm[f.key] ?? '') !== whSavedValues[f.key]);
  const purchasingOrderSavedValues = useMemo(() => purchasingFormFrom(selectedOrder), [selectedOrder]);
  const purchasingOrderDirty = PURCHASING_ORDER_FIELDS.some(
    f => (purchasingOrderForm[f.key] ?? '') !== purchasingOrderSavedValues[f.key],
  );

  // รีเซ็ตฟอร์มเมื่อเปิด Order คนละใบ — ผูกกับ id ไม่ใช่ทั้งอ็อบเจกต์
  // (setSelectedOrder ถูกเรียกทุกครั้งที่บันทึก ถ้าผูกทั้งอ็อบเจกต์จะล้างสิ่งที่พิมพ์ค้างไว้)
  useEffect(() => {
    setWhForm(whFormFrom(selectedOrder, selectedOrderTable));
    setWhMsg('');
    setPurchasingOrderForm(purchasingFormFrom(selectedOrder));
    setPurchasingOrderMsg('');
    setConfirmCancelStep(null);   // เปลี่ยนใบที่เปิดอยู่ (หรือปิดป๊อปอัป) → กล่องยืนยันที่ค้างอยู่ต้องปิดตาม
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id]);

  const saveWarehouseFields = async () => {
    if (!selectedOrder) return;
    const id = String(selectedOrder.id);
    // ช่องว่าง → null ไม่ใช่ '' — คอลัมน์ date ใน Postgres รับสตริงว่างไม่ได้ (invalid input syntax)
    const patch = Object.fromEntries(
      orderWarehouseFields.map(f => [f.key, (whForm[f.key] ?? '').trim() || null]),
    );
    setWhSaving(true);
    const { error } = await supabase.from(selectedOrderTable).update(patch).eq('id', id);
    setWhSaving(false);
    if (error) {
      setWhMsg(`✕ บันทึกไม่สำเร็จ: ${error.message}`);
      return;
    }
    setWhMsg('✓ บันทึกแล้ว');
    void notifyBranchUpdate(selectedOrder.branch, {
      menuId: orderDetailMenuId, tableName: selectedOrderTable, recordId: selectedOrder.id,
      title: `คลังสินค้าอัปเดต ${orderDetailLabel}`,
      itemSku: selectedOrder.sku,
      itemName: selectedOrder.product_name,
      detail: orderWarehouseFields
        .filter(f => (whForm[f.key] ?? '') !== whSavedValues[f.key])
        .map(f => `${f.label}: ${whForm[f.key] || 'ล้างค่า'}`)
        .join(' · '),
    });
    setSelectedOrder(o => (o ? { ...o, ...patch } : o));
    // อัปเดตแถวในตารางทันที ไม่ต้อง refetch — คอลัมน์เหล่านี้อยู่ในตารางอยู่แล้ว
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, ...patch } : r)));
  };

  const savePurchasingOrderFields = async () => {
    if (!selectedOrder) return;
    const id = String(selectedOrder.id);
    const patch = Object.fromEntries(
      PURCHASING_ORDER_FIELDS.map(f => [f.key, (purchasingOrderForm[f.key] ?? '').trim() || null]),
    );
    setPurchasingOrderSaving(true);
    const { error } = await supabase.from('ss_orders').update(patch).eq('id', id);
    setPurchasingOrderSaving(false);
    if (error) {
      setPurchasingOrderMsg(`✕ บันทึกไม่สำเร็จ: ${error.message}`);
      return;
    }
    setPurchasingOrderMsg('✓ บันทึกแล้ว');
    void notifyBranchUpdate(selectedOrder.branch, {
      menuId: 'order', tableName: 'ss_orders', recordId: selectedOrder.id,
      title: 'จัดซื้ออัปเดต Order',
      itemSku: selectedOrder.sku,
      itemName: selectedOrder.product_name,
      detail: PURCHASING_ORDER_FIELDS
        .filter(f => (purchasingOrderForm[f.key] ?? '') !== purchasingOrderSavedValues[f.key])
        .map(f => `${f.label}: ${purchasingOrderForm[f.key] || 'ล้างค่า'}`)
        .join(' · '),
    });
    setSelectedOrder(order => (order ? { ...order, ...patch } : order));
    setRows(previous => previous.map(row => (String(row.id) === id ? { ...row, ...patch } : row)));
  };

  // ทั้ง Order และ BackOrder ใช้ป้ายชุดเดียวกัน — คอลัมน์ outbound_date / 3 สถานะ มีครบทั้ง 2 ตาราง
  const isStampMenu = activeMenu === 'order' || activeMenu === 'backorder';

  // แจ้งเตือนฝั่งสาขา: คลังกรอก "Outbound วันที่ส่งของ" แล้ว แต่สาขายังไม่กดตรา "ของถึงสาขา"
  // ⚠️ ต้องมีเงื่อนไข arrived_branch ด้วย — ถ้าดูแค่ outbound_date ป้ายจะติดค้างตลอดไปไม่มีวันดับ
  // เช็ค branch ซ้ำกับที่กรองใน query แล้ว — ตั้งใจเก็บไว้เป็นกันชน เผื่อวันหลังเลิกกรองที่ query
  const showOutboundAlert = (row: Record<string, unknown>) =>
    isBranchUser
    && isStampMenu
    && String(row.branch ?? '') === userBranch
    && !!String(row.outbound_date ?? '').trim()
    && !stepDone(String(row.arrived_branch ?? ''));

  // ป้ายฝั่งคลัง: ตำแหน่ง/หน้าตาเดียวกับป้ายของสาขา แต่บอก "ขั้นล่าสุดที่สาขากดตรา"
  // มีคอลัมน์ชิป 3 ตัวบอกอยู่แล้ว แต่อยู่ขวาสุดต้องเลื่อนตารางไปดู — ป้ายนี้เห็นได้เลยโดยไม่ต้องเลื่อน
  const stampStatusBadge = (row: Record<string, unknown>) => {
    if (!isWarehouse || !isStampMenu) return null;
    const step = latestStampedStep(row);
    if (!step) return null;   // สาขายังไม่กดอะไรเลย
    return (
      <span className="ss-out-badge" title={`สาขากดตราล่าสุด: ${step.label} → ${step.done}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5.5 5.5L20 6" /></svg>
        {step.done}
      </span>
    );
  };

  // คลัง/จัดซื้อไม่ต้องเห็นช่องงานของตัวเองซ้ำในส่วนอ่านอย่างเดียว เพราะกรอกอยู่ในฟอร์มด้านล่างแล้ว
  const orderDetailFields = useMemo(
    () => {
      if (isBackOrderDetail) {
        return isWarehouse
          ? BACKORDER_DETAIL_FIELDS.filter(f => !BACKORDER_WAREHOUSE_KEYS.has(f.key))
          : BACKORDER_DETAIL_FIELDS;
      }
      if (isWarehouse) return ORDER_DETAIL_FIELDS.filter(f => !WAREHOUSE_KEYS.has(f.key));
      if (isPurchasing) return ORDER_DETAIL_FIELDS.filter(f => !PURCHASING_ORDER_KEYS.has(f.key));
      return ORDER_DETAIL_FIELDS;
    },
    [isPurchasing, isWarehouse, isBackOrderDetail],
  );

  // ปิด popup รายละเอียดพร้อมอนิเมชั่น: เล่นอนิเมชั่นปิดก่อน แล้วค่อย unmount
  const closeDetail = () => {
    if (detailClosing) return;
    setDetailClosing(true);
    setTimeout(() => {
      setSelectedOrder(null);
      setSelectedRequest(null);
      setDetailView(null);
      setDetailClosing(false);
      setEditing(false);
    }, 220);
  };

  // อัปเดตแถวในตาราง + row ที่เปิดอยู่ หลังบันทึกโหมดแก้ไข
  const applyEditPatch = (id: string, patch: Record<string, unknown>, notificationBranch?: unknown, meta: NotificationMeta = {}) => {
    const sourceRow = rows.find(row => String(row.id ?? row.sku ?? '') === id)
      ?? (selectedOrder && String(selectedOrder.id) === id ? selectedOrder : null)
      ?? (selectedRequest && String(selectedRequest.id) === id ? selectedRequest : null)
      ?? (detailView && String(detailView.row.id ?? detailView.row.sku ?? '') === id ? detailView.row : null);
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, ...patch } : r)));
    setSelectedOrder(o => (o && String(o.id) === id ? { ...o, ...patch } : o));
    setSelectedRequest(r => (r && String(r.id) === id ? { ...r, ...patch } : r));
    setDetailView(d => (d && String(d.row.id) === id ? { ...d, row: { ...d.row, ...patch } } : d));
    setEditing(false);
    if (meta.detail !== '') {
      const resolved = {
        ...meta,
        recordId: meta.recordId ?? id,
        detail: meta.detail ?? `แก้ไข ${Object.keys(patch).join(', ')}`,
        itemSku: meta.itemSku ?? patch.sku ?? sourceRow?.sku,
        itemName: meta.itemName ?? patch.product_name ?? patch.name ?? patch.name_brand
          ?? sourceRow?.product_name ?? sourceRow?.name ?? sourceRow?.name_brand,
      };
      void notifyBranchUpdate(notificationBranch, resolved);
      // สาขาแก้ Request Item (เช่น เปลี่ยนจำนวน/วันที่ต้องการ) → แจ้งจัดซื้อด้วย
      // ⚠️ กันเฉพาะเมนู request เท่านั้น — ฟังก์ชันนี้ใช้ร่วมกับ products/newproduct/ticket
      //    และ popup Order ซึ่งอยู่นอกขอบเขต (Order แจ้งผ่าน applyStepChange อยู่แล้ว)
      // เงื่อนไข meta.detail !== '' ด้านบนกันกรณีกดบันทึกทั้งที่ไม่ได้แก้อะไรให้แล้ว
      if (meta.menuId === 'request') void notifyPurchasingUpdate({ ...resolved, title: 'สาขาแก้ไข Request Item' });
    }
    // แก้ ABC ผ่านฟอร์มแก้ไขก็ทำให้รายการ chip ค้างได้เหมือนกัน
    if (activeMenu === 'products') { supplierMapRef.current = null; setAbcOptions(null); setRefreshKey(k => k + 1); }
  };

  const updateStatus = async (table: 'ss_request_items' | 'ss_new_products' | 'ss_tickets', id: string, status: string, branch?: unknown, itemSku?: unknown, itemName?: unknown) => {
    const { error } = await supabase.from(table).update({ status }).eq('id', id);
    if (error) { setError(`บันทึก Status ไม่สำเร็จ: ${error.message}`); return; }
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, status } : r)));
    setSelectedRequest(prev => prev && String(prev.id) === id ? { ...prev, status } : prev);
    const statusMenu: MenuId = table === 'ss_request_items' ? 'request' : table === 'ss_new_products' ? 'newproduct' : 'ticket';
    void notifyBranchUpdate(branch, {
      menuId: statusMenu, tableName: table, recordId: id,
      title: 'อัปเดต Status', detail: `Status → ${status}`,
      itemSku,
      itemName,
    });
  };

  const updateRequestAvailability = async (id: string, availability: string, branch?: unknown, itemSku?: unknown, itemName?: unknown) => {
    const { error } = await supabase.from('ss_request_items').update({ availability }).eq('id', id);
    if (error) { setError(`บันทึก Availability ไม่สำเร็จ: ${error.message}`); return; }
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, availability } : r)));
    setSelectedRequest(prev => prev && String(prev.id) === id ? { ...prev, availability } : prev);
    void notifyBranchUpdate(branch, {
      menuId: 'request', tableName: 'ss_request_items', recordId: id,
      title: 'อัปเดต Availability', detail: `Availability → ${availability}`,
      itemSku,
      itemName,
    });
  };

  // กรอก MOQ ตรงในตาราง (จัดซื้อเท่านั้น) — เป็นช่องข้อความอิสระ ไม่ใช่ select เหมือน status/availability
  // เพราะ MOQ เป็น text ไม่มีชุดตัวเลือกตายตัว (เช่น "5 กล่อง", "10", "-")
  const updateRequestMoq = async (id: string, moq: string, branch?: unknown, itemSku?: unknown, itemName?: unknown) => {
    const value = moq.trim() || null;
    const { error } = await supabase.from('ss_request_items').update({ moq: value }).eq('id', id);
    if (error) { setError(`บันทึก MOQ ไม่สำเร็จ: ${error.message}`); return; }
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, moq: value } : r)));
    setSelectedRequest(prev => prev && String(prev.id) === id ? { ...prev, moq: value } : prev);
    void notifyBranchUpdate(branch, {
      menuId: 'request', tableName: 'ss_request_items', recordId: id,
      title: 'อัปเดต MOQ', detail: `MOQ → ${value ?? '(ว่าง)'}`,
      itemSku,
      itemName,
    });
  };

  // กรอก SKU ตรงในตาราง (จัดซื้อเท่านั้น) — คู่กับ MOQ ข้างบน แบบเดียวกันทุกจุดแล้ว รวมถึงสถานะ
  // "เห็นแต่แก้ไม่ได้" สำหรับ non-purchasing (คอลัมน์นี้อยู่ใน visibleColumns เสมอ ไม่ถูกกรองออกอีกต่อไป)
  const updateRequestSku = async (id: string, sku: string, branch?: unknown, itemName?: unknown) => {
    const value = sku.trim() || null;
    const { error } = await supabase.from('ss_request_items').update({ sku: value }).eq('id', id);
    if (error) { setError(`บันทึก SKU ไม่สำเร็จ: ${error.message}`); return; }
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, sku: value } : r)));
    setSelectedRequest(prev => prev && String(prev.id) === id ? { ...prev, sku: value } : prev);
    void notifyBranchUpdate(branch, {
      menuId: 'request', tableName: 'ss_request_items', recordId: id,
      title: 'อัปเดต SKU', detail: `SKU → ${value ?? '(ว่าง)'}`,
      itemSku: value,
      itemName,
    });
  };

  const openDeleteRow = (row: Record<string, unknown>) => {
    setDeleteTarget({
      id: String(row.id), table: menu.table, label: menu.label,
      branch: String(row.branch ?? ''), menuId: activeMenu,
      itemSku: String(row.sku ?? ''),
      itemName: String(row.product_name ?? row.name ?? row.name_brand ?? ''),
    });
    setDeletePassword('');
    setDeleteError('');
  };

  const confirmDeleteRow = async () => {
    if (!deleteTarget) return;
    if (deletePassword !== ADMIN_PASSWORD) {
      setDeleteError('รหัส Admin ไม่ถูกต้อง');
      return;
    }
    if (!window.confirm(`ยืนยันลบข้อมูล ${deleteTarget.label} จาก Supabase? การลบนี้ไม่สามารถย้อนกลับได้`)) return;
    setDeleting(true);
    setDeleteError('');
    const { error } = await supabase.from(deleteTarget.table).delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) {
      setDeleteError(`ลบข้อมูลไม่สำเร็จ: ${error.message}`);
      return;
    }
    setRows(prev => prev.filter(row => String(row.id) !== deleteTarget.id));
    setSelectedOrder(prev => prev && String(prev.id) === deleteTarget.id ? null : prev);
    setSelectedRequest(prev => prev && String(prev.id) === deleteTarget.id ? null : prev);
    setDetailView(prev => prev && String(prev.row.id) === deleteTarget.id ? null : prev);
    void notifyBranchUpdate(deleteTarget.branch, {
      menuId: deleteTarget.menuId, tableName: deleteTarget.table, recordId: deleteTarget.id,
      title: `ลบข้อมูล ${deleteTarget.label}`, detail: `รหัสรายการ ${deleteTarget.id}`,
      itemSku: deleteTarget.itemSku,
      itemName: deleteTarget.itemName,
    });
    setDeleteTarget(null);
    setDeletePassword('');
  };

  const openRequestDetail = (row: Record<string, unknown>) => {
    setSelectedRequest(row);
    setEditing(false);
  };

  const updateTicketForm = (patch: Partial<TicketForm>) => setTicketForm(f => ({ ...f, ...patch }));

  const openAddTicket = () => {
    setTicketForm(emptyTicketForm());
    setSaveError('');
    setShowAddTicket(true);
  };

  const saveTicket = async () => {
    if (!ticketForm.issue.trim()) { setSaveError('กรุณาใส่รายละเอียดปัญหา (Issue)'); return; }
    setSaving(true);
    setSaveError('');
    const { error } = await supabase.from('ss_tickets').insert({
      branch: ticketForm.branch,
      department: ticketForm.department,
      issue: ticketForm.issue.trim(),
      status: 'รอดำเนินการ', // Status/Answer อัปเดตโดยแผนกปลายทาง
      // created_at (TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
    });
    setSaving(false);
    if (error) {
      setSaveError(`บันทึกไม่สำเร็จ: ${error.message}`);
    } else {
      void notifyBranchUpdate(ticketForm.branch, {
        menuId: 'ticket', tableName: 'ss_tickets', title: 'เพิ่ม Ticket ใหม่',
        detail: ticketForm.issue,
      });
      setShowAddTicket(false);
      setActiveMenu('ticket');
      setRefreshKey(k => k + 1);
    }
  };

  return (
    <div className="app-container">
      <div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="SALE SUPPORT" /></h1>
          <div className="tagline-row">
            <span className="updated-badge">ศูนย์รวมงานซัพพอร์ตการขาย</span>
          </div>
          <PageNavRow current="salesupport" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport }} />
        </div>
      </div>

      <div className="container">
        <div className="ss-layout">
          <div className="ss-sidebar">
            {visibleMenus.map(m => (
              <Fragment key={m.id}>
                <button
                  className={`ss-menu-btn${m.id === activeMenu ? ' ss-menu-btn--active' : ''}`}
                  onClick={() => setActiveMenu(m.id)}
                >
                  <span className="ss-menu-icon">{m.icon}</span>
                  {m.label}
                  {/* หัวลูกศรพับ/กางเมนูย่อย 3 ขั้น — โผล่เฉพาะตอนมีของค้าง
                      stopPropagation กันไม่ให้กดพับแล้วเด้งเปลี่ยนเมนูไปด้วย */}
                  {m.id === 'order' && totalStepPending > 0 && (
                    <span
                      className={`ss-menu-caret${stepsOpen ? ' is-open' : ''}`}
                      title={stepsOpen ? 'พับรายการที่ค้าง' : `ยังค้าง ${totalStepPending} รายการ — กางดู`}
                      onClick={e => { e.stopPropagation(); setStepsOpen(o => !o); }}
                    >
                      {!stepsOpen && <em className="ss-menu-caret-dot" />}
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                    </span>
                  )}
                </button>

                {/* เมนูย่อย 3 ขั้น — กดแล้วกรองตาราง Order ให้เหลือเฉพาะที่ยังไม่ผ่านขั้นนั้น */}
                {m.id === 'order' && totalStepPending > 0 && stepsOpen && (
                  <div className="ss-order-steps">
                    {ORDER_STEPS.map((s, i) => {
                      const c = stepCounts[s.key] ?? { pending: 0, overdue: 0 };
                      const on = stepFilter === s.key;
                      return (
                        <button
                          key={s.key}
                          className={
                            `ss-order-step ss-order-step--s${i + 1}` +
                            (c.pending === 0 ? ' is-zero' : '') +
                            (on ? ' is-active' : '')
                          }
                          title={
                            // ครบแล้วใช้ชื่อขั้นแบบบวก (label) — พูดว่า "ยังไม่..." ทั้งที่ครบแล้วจะสับสน
                            c.pending === 0
                              ? `${s.label} — ครบแล้วทุกรายการ`
                              : `${s.navLabel} ${c.pending} รายการ` +
                                (c.overdue > 0 ? ` · เลยวันนัดรับ ${c.overdue}` : '') +
                                (on ? ' (กดอีกครั้งเพื่อเลิกกรอง)' : ' (กดเพื่อกรองตาราง)')
                          }
                          // ค่า 0 = ไม่มีอะไรให้กรอง กดไปก็ได้ตารางว่าง
                          disabled={c.pending === 0}
                          onClick={() => {
                            setActiveMenu('order');
                            setStepFilter(prev => (prev === s.key ? null : s.key));
                          }}
                        >
                          <i className="ss-order-step-dot" />
                          <span className="ss-order-step-label">{s.navLabel}</span>
                          <span className={`ss-order-step-count${c.overdue > 0 ? ' is-late' : ''}`}>
                            {c.pending}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Fragment>
            ))}
            {isPurchasing && (
              <>
                <div className="ss-sidebar-divider" />
                <input ref={supplierFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleSupplierFile(f); }} />
                <button className="ss-menu-btn ss-upload-supplier-btn" disabled={uploadingSupplier}
                  onClick={() => supplierFileRef.current?.click()}>
                  <span className="ss-menu-icon">{IconUpload}</span>
                  {uploadingSupplier ? 'กำลังนำเข้า...' : 'อัปโหลด Supplier'}
                </button>
                {supplierMsg && (
                  <div className={`ss-supplier-msg${supplierMsg.startsWith('✕') ? ' ss-supplier-msg--error' : ''}`}>
                    {supplierMsg}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="ss-panel ss-panel-anim" key={activeMenu}>
            <div className="ss-panel-toolbar">
              <span className="ss-panel-title"><span className="ss-menu-icon">{menu.icon}</span> {menu.label} · {loading ? 'กำลังโหลด...' : `${visibleRows.length} รายการ`}</span>
              {activeMenu !== 'products' && (
                <div className="ss-toolbar-btns">
                  {activeMenu === 'order' && (
                    <button className="ss-add-btn" onClick={openAddOrder}>➕ New Order</button>
                  )}
                  {activeMenu === 'backorder' && (
                    <button className="ss-add-btn" onClick={openAddBackOrder}>➕ Add BackOrder</button>
                  )}
                  {activeMenu === 'request' && (
                    <button className="ss-add-btn" onClick={openAddRequest}>➕ Add</button>
                  )}
                  {activeMenu === 'newproduct' && (
                    <button className="ss-add-btn" onClick={openAddProduct}>➕ Add</button>
                  )}
                  {activeMenu === 'ticket' && (
                    <button className="ss-add-btn" onClick={openAddTicket}>➕ Add</button>
                  )}
                  {notificationRecipient && (
                    <button className="ss-notification-history-btn" onClick={openNotificationHistory}>
                      <span aria-hidden="true">🔔</span>
                      อัพเดท
                      {notificationHistoryUnreadCount > 0 && (
                        <span className="ss-notification-count">{notificationHistoryUnreadCount > 99 ? '99+' : notificationHistoryUnreadCount}</span>
                      )}
                    </button>
                  )}
                  {isWarehouse && notificationUnreadCount > 0 && (
                    <button className="ss-notification-history-btn" onClick={openDepartmentOrders}>
                      <span aria-hidden="true">🔔</span>
                      Order ใหม่
                      <span className="ss-notification-count">{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}</span>
                    </button>
                  )}
                </div>
              )}
              {activeMenu === 'products' && (
                <>
                  <div className="ss-search-center">
                    <input className="ss-input ss-search-input" type="text"
                      placeholder="🔍 ค้นหา SKU หรือชื่อสินค้า..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)} />
                    {abcOptions && abcOptions.length > 0 && (
                      <div className="ss-abc-filter">
                        <span className="ss-abc-label">ABC</span>
                        <button
                          className={`ss-abc-chip${abcFilter.size === 0 ? ' is-active' : ''}`}
                          // Set ตัวใหม่ = identity เปลี่ยน → effect ยิงซ้ำ กดตอนไม่ได้กรองอยู่จึงไม่ต้องทำอะไร
                          onClick={() => { if (abcFilter.size) setAbcFilter(new Set()); }}
                        >
                          ทั้งหมด
                        </button>
                        {abcOptions.map(v => (
                          <button
                            key={v}
                            className={`ss-abc-chip${abcFilter.has(v) ? ' is-active' : ''}`}
                            onClick={() => setAbcFilter(prev => {
                              const next = new Set(prev);
                              if (next.has(v)) next.delete(v); else next.add(v);
                              return next;
                            })}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ss-toolbar-btns">
                    <input ref={masterFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleMasterFile(f); }} />
                    <button className="ss-add-btn ss-add-btn--secondary" disabled={uploadingMaster}
                      onClick={() => masterFileRef.current?.click()}>
                      {uploadingMaster ? 'กำลังนำเข้า...' : '📤 อัปโหลด Product Master'}
                    </button>
                    {!isBranchUser && (
                      <button className="ss-add-btn" onClick={openAddMaster}>➕ New Product</button>
                    )}
                    {notificationRecipient && (
                      <button className="ss-notification-history-btn" onClick={openNotificationHistory}>
                        <span aria-hidden="true">🔔</span>
                        อัพเดท
                        {notificationHistoryUnreadCount > 0 && (
                          <span className="ss-notification-count">{notificationHistoryUnreadCount > 99 ? '99+' : notificationHistoryUnreadCount}</span>
                        )}
                      </button>
                    )}
                    {isWarehouse && notificationUnreadCount > 0 && (
                      <button className="ss-notification-history-btn" onClick={openDepartmentOrders}>
                        <span aria-hidden="true">🔔</span>
                        Order ใหม่
                        <span className="ss-notification-count">{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {activeMenu === 'products' && masterMsg && (
              <div className={`ss-panel-msg${masterMsg.startsWith('✕') ? ' ss-panel-msg--error' : ''}`}>{masterMsg}</div>
            )}
            {error && <div className="ss-error">{error}</div>}

            <div className="ss-table-wrap">
              <table className={`ss-table ss-table--${activeMenu}`} style={{ '--sku-name-width': `${skuNameWidth}px` } as CSSProperties}>
                <thead>
                  <tr>
                    {visibleColumns.map(col => (
                      <th key={col.key} className={`ss-col-${col.key}`} style={col.min ? { minWidth: col.min } : undefined}
                        title={col.sub ? `${col.label} / ${col.sub.label}` : col.label}>
                        {col.label}
                        {/* บรรทัดที่ 2 ของหัวคอลัมน์ — คู่กับ .ss-cell-sub ในช่องข้อมูล */}
                        {col.sub && <span className="ss-col-sub-label">{col.sub.label}</span>}
                        {col.key === 'sku_name' && <span className="ss-column-resizer" onMouseDown={startSkuNameResize} title="ลากเพื่อปรับความกว้างคอลัมน์" />}
                      </th>
                    ))}
                    <th className="ss-delete-col">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && visibleRows.length === 0 && !error && (
                    <tr><td className="ss-empty" colSpan={visibleColumns.length}>
                      {stepFilter && rows.length > 0 ? 'ไม่มีรายการที่ค้างขั้นนี้ในหน้านี้' : 'ยังไม่มีข้อมูล'}
                    </td></tr>
                  )}
                  {visibleRows.map(row => (
                    <tr key={String(row.id)}
                      className="ss-row-click"
                      onClick={
                        // Order กับ BackOrder ใช้ popup เดียวกัน — จำตารางต้นทางไว้ให้ฟังก์ชันบันทึกใช้
                        activeMenu === 'order' || activeMenu === 'backorder'
                          ? () => { setSelectedOrder(row); setSelectedOrderTable(menu.table); setStampError(''); setEditing(false); }
                        : activeMenu === 'request' ? () => openRequestDetail(row)
                        : () => { setEditing(false); setDetailView({
                            title: `รายละเอียด ${menu.label}`,
                            table: menu.table,
                            fields: activeMenu === 'products' ? PRODUCT_DETAIL_FIELDS : menu.columns,
                            row,
                          }); }
                      }>
                      {visibleColumns.map(col => {
                        const rawText = formatCell(row, col);
                        // Order เก่าบางรายการถูกสร้างก่อนมีค่าเริ่มต้น จึงแสดงสถานะรอแทนช่องว่าง
                        const text = activeMenu === 'order' && col.kind === 'chip' && !rawText
                          ? (ORDER_INITIAL_STATUSES[col.key] ?? '')
                          : rawText;
                        if ((activeMenu === 'request' || activeMenu === 'newproduct' || activeMenu === 'ticket') && col.key === 'status' && isPurchasing) {
                          const currentStatus = String(row.status ?? '');
                          const statusOptions = activeMenu === 'request'
                            ? REQUEST_STATUS_OPTIONS
                            : activeMenu === 'newproduct' ? NEW_PRODUCT_STATUS_OPTIONS : TICKET_STATUS_OPTIONS;
                          const statusTable = activeMenu === 'request'
                            ? 'ss_request_items'
                            : activeMenu === 'newproduct' ? 'ss_new_products' : 'ss_tickets';
                          return (
                            <td key={col.key} onClick={e => e.stopPropagation()}>
                              <select
                                className="ss-status-select"
                                value={statusOptions.includes(currentStatus as never) ? currentStatus : ''}
                                onChange={e => updateStatus(
                                  statusTable,
                                  String(row.id),
                                  e.target.value,
                                  row.branch,
                                  row.sku,
                                  row.product_name ?? row.name_brand,
                                )}
                              >
                                <option value="">เลือก Status</option>
                                {statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
                              </select>
                            </td>
                          );
                        }
                        if (activeMenu === 'request' && col.key === 'availability' && isPurchasing) {
                          const currentAvailability = String(row.availability ?? '');
                          return (
                            <td key={col.key} onClick={e => e.stopPropagation()}>
                              <select
                                className="ss-status-select"
                                value={REQUEST_AVAILABILITY_OPTIONS.includes(currentAvailability as typeof REQUEST_AVAILABILITY_OPTIONS[number]) ? currentAvailability : ''}
                                onChange={e => updateRequestAvailability(String(row.id), e.target.value, row.branch, row.sku, row.product_name)}
                              >
                                <option value="">เลือก Availability</option>
                                {REQUEST_AVAILABILITY_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
                              </select>
                            </td>
                          );
                        }
                        // MOQ กรอกตรงในตาราง (จัดซื้อเท่านั้น) — คู่กับ hideKeys ที่ล็อกช่องนี้ไว้ในฟอร์มแก้ไข
                        // ⚠️ key ผูกกับค่า moq ปัจจุบันด้วย (ไม่ใช่แค่ row.id) — บังคับ React remount ช่อง
                        // uncontrolled นี้ทุกครั้งที่ค่าจาก DB เปลี่ยน (คอมมิตเอง หรือ refetch จากที่อื่น)
                        // ไม่งั้น defaultValue จะค้างค่าตอน mount ครั้งแรกไม่ยอมอัปเดตตาม
                        if (activeMenu === 'request' && col.key === 'moq' && isPurchasing) {
                          const currentMoq = String(row.moq ?? '');
                          return (
                            <td key={col.key} onClick={e => e.stopPropagation()}>
                              <input
                                key={`${String(row.id)}-${currentMoq}`}
                                className="ss-status-input"
                                type="text"
                                defaultValue={currentMoq}
                                placeholder="MOQ"
                                onBlur={e => {
                                  const next = e.target.value.trim();
                                  if (next !== currentMoq.trim()) {
                                    void updateRequestMoq(String(row.id), next, row.branch, row.sku, row.product_name);
                                  }
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              />
                            </td>
                          );
                        }
                        // SKU กรอกตรงในตาราง (จัดซื้อเท่านั้น) — เหมือน MOQ ทุกจุด ต่างแค่ตัดพารามิเตอร์
                        // itemSku ออกจาก updateRequestSku (ค่าที่กำลังแก้คือ sku เอง เลยส่งค่าใหม่แทน)
                        if (activeMenu === 'request' && col.key === 'sku' && isPurchasing) {
                          const currentSku = String(row.sku ?? '');
                          return (
                            <td key={col.key} onClick={e => e.stopPropagation()}>
                              <input
                                key={`${String(row.id)}-${currentSku}`}
                                className="ss-status-input"
                                type="text"
                                defaultValue={currentSku}
                                placeholder="SKU"
                                onBlur={e => {
                                  const next = e.target.value.trim();
                                  if (next !== currentSku.trim()) {
                                    void updateRequestSku(String(row.id), next, row.branch, row.product_name);
                                  }
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              />
                            </td>
                          );
                        }
                        // หลายสถานะยุบเป็นชิปเรียงลงมาในช่องเดียว (ตาราง Order)
                        if (col.kind === 'chips' && col.chipKeys) {
                          return (
                            <td key={col.key} className={`ss-col-${col.key}`}>
                              <div className="ss-chip-stack">
                                {col.chipKeys.map(k => {
                                  // Order เก่าที่สร้างก่อนมีค่าเริ่มต้น → เติมสถานะรอแทนช่องว่าง (เหมือน kind: 'chip')
                                  const v = String(row[k] ?? '') || (ORDER_INITIAL_STATUSES[k] ?? '');
                                  if (!v) return null;
                                  return (
                                    <span key={k} className={`ss-chip ${chipClass(v)}`} title={`${stepLabelOf(k)}: ${v}`}>{v}</span>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        }
                        if (col.kind === 'chip' && text) {
                          return <td key={col.key}><span className={`ss-chip ${chipClass(text)}`}>{text}</span></td>;
                        }
                        if (col.key === 'image_url' && text) {
                          return <td key={col.key}><a className="ss-img-link" href={text} target="_blank" rel="noreferrer">🖼️ ดูรูป</a></td>;
                        }
                        const main = (
                          <>
                            {text}
                            {col.key === 'sku_name' && showOutboundAlert(row) && (
                              <span className="ss-out-badge" title="คลังสินค้าส่งของออกแล้ว — รับของแล้วกดตรา “ของถึงสาขา” ในหน้ารายละเอียด">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M1 3h13v13H1z" /><path d="M14 8h4l3 3v5h-7V8Z" />
                                  <circle cx="5.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" />
                                </svg>
                                คลังส่งของแล้ว
                              </span>
                            )}
                            {col.key === 'sku_name' && stampStatusBadge(row)}
                          </>
                        );
                        const subText = col.sub ? formatCell(row, col.sub) : '';
                        return (
                          <td key={col.key} className={`ss-col-${col.key}`}
                            title={
                              col.key === 'sku_name' ? text
                              // ตัวเลขนับด้วยหน่วยของ stock ซึ่งอาจไม่ใช่หน่วยในคอลัมน์ "หน่วย" — บอกไว้ตอน hover
                              : col.key === 'stock_qty' && row.stock_unit
                                ? `คลังนับเป็น ${row.stock_unit}`
                              : col.sub ? `${col.label}: ${text || '—'}\n${col.sub.label}: ${subText || '—'}`
                              : undefined
                            }>
                            {/* ห่อด้วย div เฉพาะคอลัมน์ที่มีบรรทัดที่ 2 — เมนูอื่นจะได้ layout เดิมเป๊ะ */}
                            {col.sub ? <div className="ss-cell-main">{main}</div> : main}
                            {col.sub && <div className="ss-cell-sub">{subText || '—'}</div>}
                          </td>
                        );
                      })}
                      <td className="ss-delete-col" onClick={e => e.stopPropagation()}>
                        <button className="ss-delete-row-btn" type="button" onClick={() => openDeleteRow(row)} title="ลบข้อมูล">
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showNotificationHistory && (
        <div className="ss-notification-overlay" onClick={() => setShowNotificationHistory(false)}>
          <aside className="ss-notification-drawer" role="dialog" aria-modal="true" aria-label="ประวัติอัพเดท SaleSupport" onClick={e => e.stopPropagation()}>
            <div className="ss-notification-header">
              <div>
                <strong>🔔 ประวัติอัพเดท</strong>
                <span>{notificationRecipientLabel} · รายการล่าสุด</span>
              </div>
              <button className="dl-modal-close" onClick={() => setShowNotificationHistory(false)} aria-label="ปิด">✕</button>
            </div>
            <div className="ss-notification-list">
              {notificationLoading && <div className="ss-notification-state">กำลังโหลด...</div>}
              {!notificationLoading && notificationError && (
                <div className="ss-notification-state ss-notification-state--error">{notificationError}</div>
              )}
              {!notificationLoading && !notificationError && notificationEvents.length === 0 && (
                <div className="ss-notification-state">ยังไม่มีประวัติอัพเดท</div>
              )}
              {!notificationLoading && notificationEvents.map(event => (
                <button
                  key={event.id}
                  className={`ss-notification-item${event.read_at ? '' : ' is-unread'}`}
                  onClick={() => openNotificationEvent(event)}
                >
                  <span className={`ss-notification-actor ss-notification-actor--${notificationActorTone(event.actor_code)}`}>
                    {NOTIFICATION_ACTOR_LABELS[event.actor_code] ?? event.actor_code}
                  </span>
                  {!event.read_at && <span className="ss-notification-new">ใหม่</span>}
                  <strong>{event.title}</strong>
                  {(event.item_sku || event.item_name) && (
                    <span className="ss-notification-product">
                      {event.item_sku && <b>SKU {event.item_sku}</b>}
                      {event.item_name && <span>{event.item_name}</span>}
                    </span>
                  )}
                  {event.detail && <span className="ss-notification-detail">{event.detail}</span>}
                  <span className="ss-notification-time">
                    {new Date(event.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                    <em>เปิดเมนู →</em>
                  </span>
                </button>
              ))}
            </div>
            <div className="ss-notification-footer">
              <span>แสดงประวัติล่าสุดสูงสุด 100 รายการ</span>
              <button
                type="button"
                className="ss-notification-clear-btn"
                disabled={notificationLoading || notificationEvents.length === 0}
                onClick={() => { setShowClearHistory(true); setClearHistoryPw(''); setClearHistoryError(''); }}
              >
                🗑️ ล้างประวัติ
              </button>
            </div>
          </aside>
        </div>
      )}

      {showClearHistory && (
        <div className="dl-modal-overlay" onClick={() => !clearingHistory && setShowClearHistory(false)}>
          <div className="dl-modal dl-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>ล้างประวัติอัพเดท {notificationRecipientLabel}</span>
              <button className="dl-modal-close" onClick={() => setShowClearHistory(false)} disabled={clearingHistory}>✕</button>
            </div>
            <div className="dl-modal-body">
              <p className="ss-delete-warning">
                ประวัติอัพเดทของ {notificationRecipientLabel} ทั้งหมด {notificationEvents.length} รายการ
                จะถูกลบออกจาก Supabase อย่างถาวร (ไม่กระทบข้อมูล Order / BackOrder)
              </p>
              <input
                className="ss-input"
                type="password"
                placeholder="รหัส Admin"
                autoFocus
                value={clearHistoryPw}
                onChange={e => { setClearHistoryPw(e.target.value); setClearHistoryError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') confirmClearHistory(); }}
              />
              {clearHistoryError && <div className="ss-form-error">{clearHistoryError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn ss-add-btn--secondary" onClick={() => setShowClearHistory(false)} disabled={clearingHistory}>ยกเลิก</button>
              <button className="ss-delete-confirm-btn" onClick={confirmClearHistory} disabled={clearingHistory}>
                {clearingHistory ? 'กำลังล้าง...' : 'ล้างประวัติ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="dl-modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="dl-modal dl-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>ยืนยันลบข้อมูล {deleteTarget.label}</span>
              <button className="dl-modal-close" onClick={() => setDeleteTarget(null)} disabled={deleting}>✕</button>
            </div>
            <div className="dl-modal-body">
              <p className="ss-delete-warning">ข้อมูลจะถูกลบออกจากตารางและ Supabase อย่างถาวร</p>
              <input
                className="ss-input"
                type="password"
                placeholder="รหัส Admin"
                autoFocus
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeleteError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') confirmDeleteRow(); }}
              />
              {deleteError && <div className="ss-form-error">{deleteError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn ss-add-btn--secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>ยกเลิก</button>
              <button className="ss-delete-confirm-btn" onClick={confirmDeleteRow} disabled={deleting}>
                {deleting ? 'กำลังลบ...' : 'ลบข้อมูล'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedOrder && (
        <div className={`dl-modal-overlay ss-modal-anim${detailClosing ? ' ss-modal-closing' : ''}`}>
          <div className="dl-modal dl-modal--wide" key={editing ? 'edit' : 'view'} onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>📋 รายละเอียด {orderDetailLabel}</span>
              <div className="ss-head-actions">
                {/* คลังกรอกได้เฉพาะช่องด้านล่าง จึงไม่มีปุ่มแก้ไขทั้งใบ */}
                {!editing && !isBranchUser && !isWarehouse && !isPurchasing && (
                  <button className="ss-head-edit" onClick={() => setEditing(true)}>✏️ แก้ไข</button>
                )}
                <button className="dl-modal-close" onClick={closeDetail}>✕</button>
              </div>
            </div>
            {editing && !isBranchUser && !isWarehouse && !isPurchasing ? (
              <DetailEditForm table={selectedOrderTable} row={selectedOrder}
                onSaved={patch => applyEditPatch(String(selectedOrder.id), patch, selectedOrder.branch, {
                  menuId: orderDetailMenuId, tableName: selectedOrderTable,
                  title: `แก้ไขข้อมูล ${orderDetailLabel}`,
                  detail: describeChangedFields(selectedOrderTable, selectedOrder, patch),
                })}
                onCancel={() => setEditing(false)} />
            ) : (
              <div className="dl-modal-body ss-order-detail">
                <div className="ss-detail-grid">
                  {orderDetailFields.map(f => (
                    <div key={f.key} className={`ss-detail-item${f.key === 'sku_name' || f.key === 'note' ? ' ss-detail-item--full' : ''}`}>
                      <span className="ss-detail-label">{f.label}</span>
                      <span className="ss-detail-value">{formatCell(selectedOrder, f) || '—'}</span>
                    </div>
                  ))}
                </div>

                {isWarehouse ? (
                  /* คลังสินค้า: กรอกช่องของตัวเองแทนตราประทับ (ตราเป็นงานฝั่งสาขา)
                     Order = 3 ช่อง · BackOrder = ช่องเดียว (ดู warehouseFieldsFor) */
                  <>
                    <div className="ss-detail-steps-title">ข้อมูลคลังสินค้า · กรอกแล้วกดบันทึก</div>
                    <div className="ss-wh-grid">
                      {orderWarehouseFields.map(f => (
                        <label key={f.key} className="ss-wh-field">
                          <span className="ss-detail-label">{f.label}</span>
                          <input
                            className="ss-input"
                            type={f.type}
                            value={whForm[f.key] ?? ''}
                            placeholder={f.type === 'text' ? 'เลขโอน / เลขจัดส่ง' : undefined}
                            onChange={e => { setWhForm(v => ({ ...v, [f.key]: e.target.value })); setWhMsg(''); }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="ss-wh-actions">
                      <button className="ss-add-btn" disabled={!whDirty || whSaving} onClick={saveWarehouseFields}>
                        {whSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                      </button>
                      {whMsg && (
                        <span className={`ss-wh-msg${whMsg.startsWith('✕') ? ' ss-wh-msg--error' : ''}`}>{whMsg}</span>
                      )}
                    </div>
                  </>
                ) : isPurchasing && !isBackOrderDetail ? (
                  /* ฟอร์มจัดซื้อมีเฉพาะ Order — คอลัมน์ 5 ตัวนี้ไม่มีใน ss_backorders
                     (จัดซื้อเข้าเมนู BackOrder ไม่ได้อยู่แล้ว เช็คซ้ำไว้กันบันทึกลงคอลัมน์ที่ไม่มีจริง) */
                  <>
                    <div className="ss-detail-steps-title">ข้อมูลจัดซื้อ · แก้ไขแล้วกดบันทึก</div>
                    <div className="ss-purchasing-grid">
                      {PURCHASING_ORDER_FIELDS.map(field => (
                        <label key={field.key} className="ss-purchasing-field">
                          <span className="ss-detail-label">{field.label}</span>
                          {field.type === 'select' ? (
                            <select
                              className="ss-input"
                              value={purchasingOrderForm[field.key] ?? ''}
                              onChange={event => {
                                setPurchasingOrderForm(form => ({ ...form, [field.key]: event.target.value }));
                                setPurchasingOrderMsg('');
                              }}
                            >
                              <option value="">เลือก{field.label}</option>
                              {field.options.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : (
                            <input
                              className="ss-input"
                              type={field.type}
                              value={purchasingOrderForm[field.key] ?? ''}
                              placeholder={field.type === 'text' ? 'กรอกเลขบิล' : undefined}
                              onChange={event => {
                                setPurchasingOrderForm(form => ({ ...form, [field.key]: event.target.value }));
                                setPurchasingOrderMsg('');
                              }}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="ss-purchasing-actions">
                      <button
                        className="ss-add-btn"
                        disabled={!purchasingOrderDirty || purchasingOrderSaving}
                        onClick={savePurchasingOrderFields}
                      >
                        {purchasingOrderSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                      </button>
                      {purchasingOrderMsg && (
                        <span className={`ss-purchasing-msg${purchasingOrderMsg.startsWith('✕') ? ' ss-purchasing-msg--error' : ''}`}>
                          {purchasingOrderMsg}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ss-detail-steps-title">สถานะการดำเนินการ · กดปุ่มอัปเดทตามสถานะ</div>
                    <div className="ss-stamp-row">
                      {ORDER_STEPS.map(step => {
                        const done = stepDone(String(selectedOrder[step.key] ?? ''));
                        return (
                          <button key={step.key} type="button"
                            className={`ss-stamp${done ? ' ss-stamp--done' : ''}`}
                            onClick={() => toggleOrderStep(step)}>
                            {step.label}
                            <span className="ss-stamp-mark">{step.label} ✔</span>
                          </button>
                        );
                      })}
                    </div>
                    {stampError && <div className="ss-form-error">{stampError}</div>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedRequest && (
        <div className={`dl-modal-overlay ss-modal-anim${detailClosing ? ' ss-modal-closing' : ''}`}>
          <div className="dl-modal dl-modal--wide" key={editing ? 'edit' : 'view'} onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>📦 รายละเอียด Request Item</span>
              <div className="ss-head-actions">
                {!editing && <button className="ss-head-edit" onClick={() => setEditing(true)}>✏️ แก้ไข</button>}
                <button className="dl-modal-close" onClick={closeDetail}>✕</button>
              </div>
            </div>
            {editing ? (
              <DetailEditForm table="ss_request_items" row={selectedRequest}
                hideKeys={!isPurchasing ? ['sku', 'moq'] : undefined}
                onSaved={patch => applyEditPatch(String(selectedRequest.id), patch, selectedRequest.branch, {
                  menuId: 'request', tableName: 'ss_request_items', title: 'แก้ไข Request Item',
                  detail: describeChangedFields('ss_request_items', selectedRequest, patch),
                })}
                onCancel={() => setEditing(false)} />
            ) : (
              <div className="dl-modal-body ss-order-detail">
                <div className="ss-detail-grid">
                  <div className="ss-detail-item ss-detail-item--full">
                    <span className="ss-detail-label">ชื่อสินค้า</span>
                    <span className="ss-detail-value">{String(selectedRequest.product_name ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">สาขา</span>
                    <span className="ss-detail-value">{String(selectedRequest.branch ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">TimeStamp วันที่ลงข้อมูล</span>
                    <span className="ss-detail-value">{formatCell(selectedRequest, { key: 'created_at', label: '', kind: 'datetime' }) || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">Supplier</span>
                    <span className="ss-detail-value">{String(selectedRequest.supplier ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">รูปสินค้า</span>
                    <span className="ss-detail-value">
                      {selectedRequest.image_url
                        ? <a href={String(selectedRequest.image_url)} target="_blank" rel="noreferrer">
                            <img className="ss-detail-img" src={String(selectedRequest.image_url)} alt="รูปสินค้า" />
                          </a>
                        : '—'}
                    </span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">Generic Name</span>
                    <span className="ss-detail-value">{String(selectedRequest.generic_name ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">ความแรง</span>
                    <span className="ss-detail-value">{String(selectedRequest.strength ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">ขนาดบรรจุ</span>
                    <span className="ss-detail-value">{String(selectedRequest.pack_size ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">จำนวนที่ต้องการ</span>
                    <span className="ss-detail-value">{selectedRequest.qty === null || selectedRequest.qty === undefined ? '—' : String(selectedRequest.qty)}</span>
                  </div>
                  <div className="ss-detail-item ss-detail-item--full">
                    <span className="ss-detail-label">ชื่อลูกค้า / ช่องทางการติดต่อ</span>
                    <span className="ss-detail-value">
                      {[String(selectedRequest.customer_name ?? ''), formatCell(selectedRequest, { key: 'phone', label: '' })].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">วันที่ต้องการสินค้า</span>
                    <span className="ss-detail-value">{formatCell(selectedRequest, { key: 'need_date', label: '', kind: 'date' }) || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">Status</span>
                    <span className="ss-detail-value">
                      {selectedRequest.status
                        ? <span className={`ss-chip ${chipClass(String(selectedRequest.status))}`}>{String(selectedRequest.status)}</span>
                        : '—'}
                    </span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">Availability</span>
                    <span className="ss-detail-value">
                      {selectedRequest.availability
                        ? <span className={`ss-chip ${chipClass(String(selectedRequest.availability))}`}>{String(selectedRequest.availability)}</span>
                        : '—'}
                    </span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">Note</span>
                    <span className="ss-detail-value">{String(selectedRequest.note ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">Leadtime</span>
                    <span className="ss-detail-value">{String(selectedRequest.leadtime ?? '') || '—'}</span>
                  </div>
                  <div className="ss-detail-item">
                    <span className="ss-detail-label">MOQ</span>
                    <span className="ss-detail-value">{String(selectedRequest.moq ?? '') || '—'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {detailView && (
        <div className={`dl-modal-overlay ss-modal-anim${detailClosing ? ' ss-modal-closing' : ''}`}>
          <div className="dl-modal dl-modal--wide" key={editing ? 'edit' : 'view'} onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>{detailView.title}</span>
              <div className="ss-head-actions">
                {!editing && EDIT_FIELDS[detailView.table] && (
                  <button className="ss-head-edit" onClick={() => setEditing(true)}>✏️ แก้ไข</button>
                )}
                <button className="dl-modal-close" onClick={closeDetail}>✕</button>
              </div>
            </div>
            {editing ? (
              <DetailEditForm table={detailView.table} row={detailView.row}
                onSaved={patch => applyEditPatch(String(detailView.row.id), patch, detailView.row.branch, {
                  menuId: activeMenu, tableName: detailView.table,
                  recordId: activeMenu === 'products' ? detailView.row.sku : detailView.row.id,
                  title: `แก้ไข ${menu.label}`,
                  detail: describeChangedFields(detailView.table, detailView.row, patch),
                })}
                onCancel={() => setEditing(false)} />
            ) : (
              <div className="dl-modal-body ss-order-detail">
                <div className="ss-detail-grid">
                  {detailView.fields.map(f => {
                    const text = formatCell(detailView.row, f);
                    return (
                      <div key={f.key} className={`ss-detail-item${DETAIL_FULL_KEYS.has(f.key) ? ' ss-detail-item--full' : ''}`}>
                        <span className="ss-detail-label">{f.label}</span>
                        <span className="ss-detail-value">
                          {f.key === 'image_url' && text ? (
                            <a href={text} target="_blank" rel="noreferrer">
                              <img className="ss-detail-img" src={text} alt="รูปสินค้า" />
                            </a>
                          ) : f.kind === 'chip' && text ? (
                            <span className={`ss-chip ${chipClass(text)}`}>{text}</span>
                          ) : (
                            text || '—'
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showAddOrder && (
        <div className="dl-modal-overlay">
          <div className="dl-modal dl-modal--new-order" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ New Order (เฉพาะยา Pre เท่านั้น)</span>
              <button className="dl-modal-close" onClick={() => setShowAddOrder(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>สาขา *</label>
                {isBranchUser ? (
                  <div className="ss-branch-locked-value" title="สาขากำหนดตามรหัสที่เข้าสู่ระบบ">
                    
                    <strong>{branchCodeLabel(userBranch)}</strong>
                  </div>
                ) : (
                  <select className="ss-input" value={orderForm.branch} onChange={e => updateForm({ branch: e.target.value })}>
                    {ORDER_BRANCHES.map(b => <option key={b} value={b}>{branchCodeLabel(b)}</option>)}
                  </select>
                )}
              </div>
              <div className="ss-form-row">
                <label>SKU *</label>
                <div className="ss-suggest-wrap">
                  <input className="ss-input" type="text" placeholder="พิมพ์ 3 ตัวขึ้นไป หรือกด Enter"
                    value={orderForm.sku}
                    onChange={e => handleSkuChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') lookupSku(orderForm.sku); }} />
                  {suggestions.length > 0 && (
                    <div className="ss-suggest-list">
                      {/* key ต้องมี unit ด้วย — SKU เดียวขึ้นได้หลายบรรทัด (แผง/กล่อง/โหล) */}
                      {suggestions.map(s => (
                        <button key={`${s.sku}-${s.unit}`} type="button" className="ss-suggest-item"
                          onMouseDown={() => pickSuggestion(s)}>
                          <span className="ss-suggest-sku">{s.sku}</span>
                          <span className="ss-suggest-name">{s.name}</span>
                          <span className="ss-suggest-unit">{s.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="ss-form-row ss-form-row--full">
                <div className="ss-name-unit-row">
                  <div className="ss-form-row ss-name-col">
                    <label>ชื่อสินค้า *</label>
                    <input className="ss-input" type="text" placeholder="เติมอัตโนมัติจาก SKU หรือพิมพ์เอง"
                      value={orderForm.product_name}
                      onChange={e => updateForm({ product_name: e.target.value })} />
                  </div>
                  <div className="ss-form-row ss-unit-col">
                    <label>หน่วย</label>
                    <input className="ss-input" type="text" placeholder="อัตโนมัติ"
                      value={orderForm.unit}
                      onChange={e => updateForm({ unit: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="ss-form-row">
                <label>จำนวน *</label>
                <input className="ss-input" type="number" min="0" placeholder="0"
                  value={orderForm.qty}
                  onChange={e => updateForm({ qty: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>วันที่ชำระ *</label>
                <input className="ss-input" type="date" value={orderForm.paid_date}
                  onChange={e => updateForm({ paid_date: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>เลขบิลขาย *</label>
                <input className="ss-input" type="text" placeholder="เช่น IV-880012"
                  value={orderForm.sale_bill_no}
                  onChange={e => updateForm({ sale_bill_no: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ชื่อลูกค้า</label>
                <input className="ss-input" type="text" placeholder="ชื่อลูกค้า"
                  value={orderForm.customer_name}
                  onChange={e => updateForm({ customer_name: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>ช่องทางการติดต่อ</label>
                <div className="ss-contact-row">
                  <select className="ss-input ss-contact-select" value={orderForm.contact_channel}
                    onChange={e => updateForm({ contact_channel: e.target.value })}>
                    {CONTACT_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="ss-input" type="text"
                    placeholder={orderForm.contact_channel === 'Tel.' ? 'เบอร์โทร เช่น 081-234-5678' : `ไอดี ${orderForm.contact_channel}`}
                    value={orderForm.contact_value}
                    onChange={e => updateForm({ contact_value: e.target.value })} />
                </div>
              </div>
              <div className="ss-form-row">
                <label>วันที่นัดรับ *</label>
                <input className="ss-input" type="date" value={orderForm.pickup_date}
                  min={addBusinessDays(PICKUP_DATE_OFFSET_DAYS)}
                  title={`เลือกได้ตั้งแต่ ${PICKUP_DATE_OFFSET_DAYS} วันทำการนับจากวันนี้เป็นต้นไป (ไม่นับเสาร์-อาทิตย์)`}
                  onChange={e => updateForm({ pickup_date: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>รับที่ร้าน/จัดส่ง</label>
                <select className="ss-input" value={orderForm.delivery_method}
                  onChange={e => updateForm({ delivery_method: e.target.value })}>
                  {DELIVERY_METHODS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {isBranchUser && (
                <div className="ss-form-row ss-form-row--full">
                  <label>หมายเหตุ</label>
                  <textarea
                    className="ss-input ss-textarea"
                    rows={3}
                    placeholder="กรอกรายละเอียดเพิ่มเติม (ถ้ามี)"
                    value={orderForm.note}
                    onChange={e => updateForm({ note: e.target.value })}
                  />
                </div>
              )}
              <div className="ss-form-note">🕐 TimeStamp เวลาที่บันทึกจะถูกบันทึกอัตโนมัติเมื่อกดปุ่มบันทึก</div>
              {saveError && <div className="ss-form-error">{saveError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn" onClick={saveOrder} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddBackOrder && (
        <div className="dl-modal-overlay">
          <div className="dl-modal dl-modal--new-order" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ Add BackOrder</span>
              <button className="dl-modal-close" onClick={() => setShowAddBackOrder(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>สาขา *</label>
                {isBranchUser ? (
                  <div className="ss-branch-locked-value" title="สาขากำหนดตามรหัสที่เข้าสู่ระบบ">
                    <span aria-hidden="true"></span>
                    <strong>{branchCodeLabel(userBranch)}</strong>
                  </div>
                ) : (
                  <select className="ss-input" value={backOrderForm.branch}
                    onChange={e => updateBackOrderForm({ branch: e.target.value })}>
                    {BACKORDER_BRANCHES.map(b => <option key={b} value={b}>{branchCodeLabel(b)}</option>)}
                  </select>
                )}
              </div>
              <div className="ss-form-row">
                <label>SKU *</label>
                <div className="ss-suggest-wrap">
                  <input className="ss-input" type="text" placeholder="SKU / บาร์โค้ด / ชื่อสินค้า — พิมพ์ 3 ตัวขึ้นไป หรือสแกนแล้วกด Enter"
                    value={backOrderForm.sku}
                    onChange={e => handleBackOrderSkuChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') lookupBackOrderSku(backOrderForm.sku); }} />
                  {suggestions.length > 0 && (
                    <div className="ss-suggest-list">
                      {/* key ต้องมีหน่วยด้วย — products มี SKU เดียวหลายหน่วย ใช้ sku เดี่ยวจะ key ซ้ำ */}
                      {suggestions.map(s => (
                        <button key={`${s.sku}-${s.unit}`} type="button" className="ss-suggest-item"
                          onMouseDown={() => pickBackOrderSuggestion(s)}>
                          <span className="ss-suggest-sku">{s.sku}</span>
                          <span className="ss-suggest-name">{s.name}</span>
                          <span className="ss-suggest-unit">{s.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="ss-form-row ss-form-row--full">
                <div className="ss-name-unit-row">
                  <div className="ss-form-row ss-name-col">
                    <label>ชื่อสินค้า</label>
                    <input className="ss-input" type="text" placeholder="เติมอัตโนมัติจาก SKU หรือพิมพ์เอง"
                      value={backOrderForm.product_name}
                      onChange={e => updateBackOrderForm({ product_name: e.target.value })} />
                  </div>
                  <div className="ss-form-row ss-unit-col">
                    <label>หน่วย</label>
                    <input className="ss-input" type="text" placeholder="อัตโนมัติ"
                      title="หน่วยของบาร์โค้ดที่สแกน/เลือก — คลังอาจนับสต๊อกด้วยหน่วยเล็กกว่านี้"
                      value={backOrderForm.unit}
                      onChange={e => updateBackOrderForm({ unit: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="ss-form-row">
                <label>ค้างส่งลูกค้า *</label>
                <input className="ss-input" type="number" min="0" placeholder="0"
                  title="จำนวนที่ยังค้างส่งให้ลูกค้า — คนละตัวกับคอลัมน์ 'คลังมีสินค้า' ที่ดึงยอดคลังมาแสดงอัตโนมัติ"
                  value={backOrderForm.pending_qty}
                  onChange={e => updateBackOrderForm({ pending_qty: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ชื่อลูกค้า</label>
                <input className="ss-input" type="text" placeholder="ชื่อลูกค้า"
                  value={backOrderForm.customer_name}
                  onChange={e => updateBackOrderForm({ customer_name: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>วันที่ลูกค้าชำระ</label>
                <input className="ss-input" type="date" value={backOrderForm.paid_date}
                  onChange={e => updateBackOrderForm({ paid_date: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>เลขที่บิล *</label>
                <input className="ss-input" type="text" placeholder="เลขที่บิล"
                  value={backOrderForm.sale_bill_no}
                  onChange={e => updateBackOrderForm({ sale_bill_no: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>วันที่นัดรับ</label>
                <input className="ss-input" type="date" value={backOrderForm.pickup_date}
                  onChange={e => updateBackOrderForm({ pickup_date: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>หมายเหตุ</label>
                <textarea
                  className="ss-input ss-textarea"
                  rows={3}
                  placeholder="กรอกรายละเอียดเพิ่มเติม (ถ้ามี)"
                  value={backOrderForm.note}
                  onChange={e => updateBackOrderForm({ note: e.target.value })}
                />
              </div>
              <div className="ss-form-note">📦 คอลัมน์ "คลังมีสินค้า" ในตารางดึงยอดคงเหลือที่คลังมาแสดงอัตโนมัติ ไม่ต้องกรอก</div>
              {saveError && <div className="ss-form-error">{saveError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn" onClick={saveBackOrder} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddRequest && (
        <div className="dl-modal-overlay">
          <div className="dl-modal" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ Add Request Item</span>
              <button className="dl-modal-close" onClick={() => setShowAddRequest(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>สาขา *</label>
                {isBranchUser ? (
                  <div className="ss-branch-locked-value" title="สาขากำหนดตามรหัสที่เข้าสู่ระบบ">
                    <strong>{branchCodeLabel(userBranch)}</strong>
                  </div>
                ) : (
                  <select className="ss-input" value={requestForm.branch} onChange={e => updateRequestForm({ branch: e.target.value })}>
                    {ORDER_BRANCHES.map(b => <option key={b} value={b}>{branchCodeLabel(b)}</option>)}
                  </select>
                )}
              </div>
              <div className="ss-form-row">
                <label>Supplier</label>
                <SupplierInput value={requestForm.supplier} onChange={v => updateRequestForm({ supplier: v })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>ชื่อสินค้า *</label>
                <input className="ss-input" type="text" placeholder="ชื่อสินค้าที่ต้องการ"
                  value={requestForm.product_name}
                  onChange={e => updateRequestForm({ product_name: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>แนบรูปสินค้า</label>
                <input className="ss-input ss-file" type="file" accept="image/*"
                  onChange={e => setRequestImage(e.target.files?.[0] ?? null)} />
                {requestImage && <span className="ss-file-name">📎 {requestImage.name}</span>}
              </div>
              {/* SKU เป็นงานฝั่งจัดซื้อล้วนๆ — สาขา/คลังไม่รู้ SKU ตอนขอสินค้าใหม่ (จัดซื้อมาลงทีหลัง
                  ในตาราง/ฟอร์มแก้ไข) จึงซ่อนช่องนี้เฉพาะตอนสร้างสำหรับ non-purchasing เท่านั้น
                  — ต่างจากคอลัมน์ในตารางที่ตอนนี้ทุกโปรไฟล์เห็นได้แล้ว (ดู visibleColumns)
                  ยังบังคับกรอกเฉพาะตอนจัดซื้อเป็นคนเพิ่มเอง (เช็คคู่กับ saveRequest) */}
              {isPurchasing && (
                <div className="ss-form-row">
                  <label>SKU *</label>
                  <input className="ss-input" type="text" placeholder="เช่น 100376"
                    value={requestForm.sku}
                    onChange={e => updateRequestForm({ sku: e.target.value })} />
                </div>
              )}
              <div className="ss-form-row">
                <label>Generic Name *</label>
                <input className="ss-input" type="text" placeholder="เช่น Loratadine"
                  value={requestForm.generic_name}
                  onChange={e => updateRequestForm({ generic_name: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ความแรง *</label>
                <input className="ss-input" type="text" placeholder="เช่น 10 mg"
                  value={requestForm.strength}
                  onChange={e => updateRequestForm({ strength: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ขนาดบรรจุ</label>
                <input className="ss-input" type="text" placeholder="เช่น 10x10 เม็ด"
                  value={requestForm.pack_size}
                  onChange={e => updateRequestForm({ pack_size: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>จำนวนที่ต้องการ *</label>
                <input className="ss-input" type="number" min="0" placeholder="0"
                  value={requestForm.qty}
                  onChange={e => updateRequestForm({ qty: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>ชื่อลูกค้า / ช่องทางติดต่อลูกค้า</label>
                <div className="ss-contact-row">
                  <input className="ss-input" type="text" placeholder="ชื่อลูกค้า"
                    value={requestForm.customer_name}
                    onChange={e => updateRequestForm({ customer_name: e.target.value })} />
                  <select className="ss-input ss-contact-select" value={requestForm.contact_channel}
                    onChange={e => updateRequestForm({ contact_channel: e.target.value })}>
                    {CONTACT_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="ss-input" type="text"
                    placeholder={requestForm.contact_channel === 'Tel.' ? 'เบอร์โทร' : `ไอดี ${requestForm.contact_channel}`}
                    value={requestForm.contact_value}
                    onChange={e => updateRequestForm({ contact_value: e.target.value })} />
                </div>
              </div>
              <div className="ss-form-row">
                <label>วันที่ต้องการสินค้า</label>
                <input className="ss-input" type="date" value={requestForm.need_date}
                  onChange={e => updateRequestForm({ need_date: e.target.value })} />
              </div>
              <div className="ss-form-note">🕐 DateTime (TimeStamp) จะถูกบันทึกอัตโนมัติเมื่อกดปุ่มบันทึก · สถานะเริ่มต้น "รอตรวจสอบ"</div>
              {saveError && <div className="ss-form-error">{saveError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn" onClick={saveRequest} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddProduct && (
        <div className="dl-modal-overlay">
          <div className="dl-modal" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ Add New Product</span>
              <button className="dl-modal-close" onClick={() => setShowAddProduct(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>สาขา *</label>
                <select className="ss-input" value={productForm.branch} onChange={e => updateProductForm({ branch: e.target.value })}>
                  {NEW_PRODUCT_BRANCHES.map(b => <option key={b} value={b}>{branchCodeLabel(b)}</option>)}
                </select>
              </div>
              <div className="ss-form-row">
                <label>Ask Qty *</label>
                <input className="ss-input" type="number" min="1" placeholder="0"
                  value={productForm.ask_qty}
                  onChange={e => updateProductForm({ ask_qty: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>Name/Brand *</label>
                <input className="ss-input" type="text" placeholder="ชื่อสินค้า/ยี่ห้อ"
                  value={productForm.name_brand}
                  onChange={e => updateProductForm({ name_brand: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>ชื่อยา/สารสำคัญ *</label>
                <input className="ss-input" type="text" placeholder="เช่น Probiotic 10 สายพันธุ์"
                  value={productForm.active_ingredient}
                  onChange={e => updateProductForm({ active_ingredient: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ขนาดบรรจุ *</label>
                <input className="ss-input" type="text" placeholder="เช่น 30 แคปซูล"
                  value={productForm.pack_size}
                  onChange={e => updateProductForm({ pack_size: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Supplier</label>
                <SupplierInput value={productForm.supplier} onChange={v => updateProductForm({ supplier: v })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>รูปสินค้า *</label>
                <input className="ss-input ss-file" type="file" accept="image/*"
                  onChange={e => setProductImage(e.target.files?.[0] ?? null)} />
                {productImage && <span className="ss-file-name">📎 {productImage.name}</span>}
              </div>
              <div className="ss-form-row">
                <label>ราคาที่แจ้ง</label>
                <input className="ss-input" type="text" placeholder="เช่น 250 บาท/กล่อง"
                  value={productForm.quoted_price}
                  onChange={e => updateProductForm({ quoted_price: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>หมายเหตุ</label>
                <input className="ss-input" type="text" placeholder="หมายเหตุ (ถ้ามี)"
                  value={productForm.note}
                  onChange={e => updateProductForm({ note: e.target.value })} />
              </div>
              <div className="ss-form-note">🕐 TimeStamp บันทึกอัตโนมัติเมื่อกดบันทึก · Status เริ่มต้น "รอพิจารณา" (แผนกจัดซื้อเป็นผู้อัปเดต)</div>
              {saveError && <div className="ss-form-error">{saveError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn" onClick={saveProduct} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddTicket && (
        <div className="dl-modal-overlay">
          <div className="dl-modal" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ Add Ticket</span>
              <button className="dl-modal-close" onClick={() => setShowAddTicket(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>สาขา *</label>
                <select className="ss-input" value={ticketForm.branch} onChange={e => updateTicketForm({ branch: e.target.value })}>
                  {NEW_PRODUCT_BRANCHES.map(b => <option key={b} value={b}>{branchCodeLabel(b)}</option>)}
                </select>
              </div>
              <div className="ss-form-row">
                <label>Department *</label>
                <select className="ss-input" value={ticketForm.department} onChange={e => updateTicketForm({ department: e.target.value })}>
                  {TICKET_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>Issue *</label>
                <textarea className="ss-input ss-textarea" placeholder="รายละเอียดปัญหา/เรื่องที่ต้องการแจ้ง"
                  value={ticketForm.issue}
                  onChange={e => updateTicketForm({ issue: e.target.value })} />
              </div>
              <div className="ss-form-note">🕐 TimeStamp บันทึกอัตโนมัติเมื่อกดบันทึก · Status เริ่มต้น "รอดำเนินการ" (แผนกปลายทางเป็นผู้ตอบและอัปเดต)</div>
              {saveError && <div className="ss-form-error">{saveError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn" onClick={saveTicket} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMaster && (
        <div className="dl-modal-overlay">
          <div className="dl-modal" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ New Product (Product Master)</span>
              <button className="dl-modal-close" onClick={() => setShowAddMaster(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>SKU *</label>
                <input className="ss-input" type="text" placeholder="รหัสสินค้า"
                  value={masterForm.sku}
                  onChange={e => updateMasterForm({ sku: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ชื่อสินค้า</label>
                <input className="ss-input" type="text" placeholder="ชื่อสินค้า"
                  value={masterForm.name}
                  onChange={e => updateMasterForm({ name: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Base_Unit</label>
                <input className="ss-input" type="text" placeholder="เช่น TAB, BOT"
                  value={masterForm.base_unit}
                  onChange={e => updateMasterForm({ base_unit: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ABC</label>
                <input className="ss-input" type="text" placeholder="เช่น A"
                  value={masterForm.abc}
                  onChange={e => updateMasterForm({ abc: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Multiply</label>
                <input className="ss-input" type="text" placeholder="Multiply"
                  value={masterForm.multiply}
                  onChange={e => updateMasterForm({ multiply: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Supplier</label>
                <SupplierInput value={masterForm.supplier} onChange={v => updateMasterForm({ supplier: v })} />
              </div>
              <div className="ss-form-row">
                <label>Set_Deal</label>
                <input className="ss-input" type="text" placeholder="Set_Deal"
                  value={masterForm.set_deal}
                  onChange={e => updateMasterForm({ set_deal: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Purchase_Unit</label>
                <input className="ss-input" type="text" placeholder="Purchase_Unit"
                  value={masterForm.purchase_unit}
                  onChange={e => updateMasterForm({ purchase_unit: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Barcode_Unit</label>
                <input className="ss-input" type="text" placeholder="Barcode_Unit"
                  value={masterForm.barcode_unit}
                  onChange={e => updateMasterForm({ barcode_unit: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ทุนซื้อ</label>
                <input className="ss-input" type="text" placeholder="เช่น 120.50"
                  value={masterForm.cost}
                  onChange={e => updateMasterForm({ cost: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Buying_Deal_Normal</label>
                <input className="ss-input" type="text" placeholder="Buying_Deal_Normal"
                  value={masterForm.buying_deal_normal}
                  onChange={e => updateMasterForm({ buying_deal_normal: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Buying_Deal_Free</label>
                <input className="ss-input" type="text" placeholder="เช่น 10+1"
                  value={masterForm.buying_deal_free}
                  onChange={e => updateMasterForm({ buying_deal_free: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Group</label>
                <input className="ss-input" type="text" placeholder="Group"
                  value={masterForm.group_name}
                  onChange={e => updateMasterForm({ group_name: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>Group %</label>
                <input className="ss-input" type="text" placeholder="เช่น 5%"
                  value={masterForm.group_percent}
                  onChange={e => updateMasterForm({ group_percent: e.target.value })} />
              </div>
              <div className="ss-form-row ss-form-row--full">
                <label>SKU Name</label>
                <input className="ss-input" type="text" placeholder="SKU Name"
                  value={masterForm.sku_name}
                  onChange={e => updateMasterForm({ sku_name: e.target.value })} />
              </div>
              {saveError && <div className="ss-form-error">{saveError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="ss-add-btn" onClick={saveMaster} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast แจ้งผลกดตราประทับ — render ตลอดแม้ไม่มีใบ เพื่อให้ aria-live ประกาศได้จริง
          (live region ต้องมีอยู่ก่อนข้อความจะถูกใส่เข้าไป) */}
      <div className="ss-toast-layer" role="status" aria-live="polite">
        {stampToasts.map(t => (
          <div
            key={t.id}
            className={`ss-toast ss-toast--${t.tone}${t.leaving ? ' ss-toast--leaving' : ''}`}
            onAnimationEnd={() => {
              if (t.leaving) setStampToasts(prev => prev.filter(x => x.id !== t.id));
            }}
          >
            <span className="ss-toast-ico" aria-hidden="true">{STAMP_TOAST_ICON[t.tone]}</span>
            <span>{t.title}</span>
            <span className="ss-toast-sub">· {t.detail}</span>
          </div>
        ))}
      </div>

      {/* กล่องยืนยัน "ยกเลิกสถานะ" — แทนที่ window.confirm() ด้วยดีไซน์ "Centered Icon Alert"
          (เลือกจาก public/confirm-dialog-designs.html แบบที่ 6)
          ⚠️ ปุ่มยืนยันใช้โทนเหลืองอำพัน ไม่ใช่แดง — ยกเลิกตราไม่ใช่การลบถาวร ยังกดประทับใหม่ได้ */}
      {confirmCancelStep && (
        <div className="ss-confirm-overlay" onClick={confirmCancelStepNo}>
          <div className="ss-confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="ss-confirm-title" onClick={e => e.stopPropagation()}>
            <div className="ss-confirm-top">
              <div className="ss-confirm-ico" aria-hidden="true">↩️</div>
              <div className="ss-confirm-title" id="ss-confirm-title">ยกเลิกสถานะ?</div>
              <div className="ss-confirm-msg">
                "{confirmCancelStep.label}" จะกลับไปเป็น<br />
                "{confirmCancelStep.pending}" — กดประทับใหม่ได้ภายหลัง
              </div>
            </div>
            <div className="ss-confirm-btns">
              <button type="button" onClick={confirmCancelStepNo}>ไม่ยกเลิก</button>
              <button type="button" className="ss-confirm-btn--yes" onClick={confirmCancelStepYes}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
