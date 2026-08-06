import { useState, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';

const ORDER_BRANCHES = ['SRC', 'KKL', 'SSS', 'Warehouse'] as const;
const CONTACT_CHANNELS = ['Tel.', 'Line', 'WhatsApp'] as const;
const DELIVERY_METHODS = ['รับที่ร้าน', 'จัดส่ง'] as const;

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
}

function emptyOrderForm(): OrderForm {
  return {
    branch: 'SRC', sku: '', product_name: '', unit: '', qty: '',
    paid_date: '', sale_bill_no: '', customer_name: '',
    contact_channel: 'Tel.', contact_value: '',
    pickup_date: '', delivery_method: 'รับที่ร้าน',
  };
}

interface ProductSuggestion {
  sku: string;
  name: string;
  unit: string;
}

interface RequestForm {
  branch: string;
  product_name: string;
  supplier: string;
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
    branch: 'SRC', product_name: '', supplier: '',
    generic_name: '', strength: '', pack_size: '', qty: '',
    customer_name: '', contact_channel: 'Tel.', contact_value: '',
    need_date: '',
  };
}

const NEW_PRODUCT_BRANCHES = ['SRC', 'KKL', 'SSS'] as const;
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
    { key: 'order_type', label: 'เบิก/สั่งซื้อ' },
    { key: 'order_bill_no', label: 'สั่งซื้อ/เบิก (เลขบิล)' },
    { key: 'order_date', label: 'วันที่สั่งซื้อ/เบิก', input: 'date' },
    { key: 'order_source', label: 'สั่งลงที่ไหน' },
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

function DetailEditForm({ table, row, onSaved, onCancel }: {
  table: string;
  row: Record<string, unknown>;
  onSaved: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const fields = EDIT_FIELDS[table] ?? [];
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
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
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

type MenuId = 'order' | 'request' | 'newproduct' | 'ticket' | 'products';

interface ColumnDef {
  key: string;
  label: string;
  kind?: 'date' | 'datetime' | 'chip';
  min?: number;
}

interface MenuDef {
  id: MenuId;
  label: string;
  icon: string;
  table: string;
  columns: ColumnDef[];
  orderBy?: string;
  ascending?: boolean;
  filter?: { column: string; value: string };
}

const MENUS: MenuDef[] = [
  {
    id: 'order', label: 'Order', icon: '📋', table: 'ss_orders',
    columns: [
      { key: 'sku_name',          label: 'SKU / ชื่อสินค้า', min: 200 },
      { key: 'branch',            label: 'Branch', min: 70 },
      { key: 'qty',               label: 'จำนวน', min: 60 },
      { key: 'unit',              label: 'หน่วย', min: 70 },
      { key: 'paid_date',         label: 'วันที่ลูกค้าชำระ', kind: 'date', min: 110 },
      { key: 'sale_bill_no',      label: 'เลขบิลขาย', min: 160 },
      { key: 'customer_name',     label: 'ชื่อลูกค้า', min: 120 },
      { key: 'pickup_date',       label: 'วันที่นัดรับ', kind: 'date', min: 100 },
      { key: 'note',              label: 'หมายเหตุ', min: 140 },
      { key: 'delivery_method',   label: 'รับที่ร้าน/จัดส่ง', min: 110 },
      { key: 'order_type',        label: 'เบิก/สั่งซื้อ', min: 90 },
      { key: 'order_bill_no',     label: 'สั่งซื้อ/เบิก (เลขบิล)', min: 130 },
      { key: 'order_date',        label: 'วันที่สั่งซื้อ/เบิก', kind: 'date', min: 110 },
      { key: 'order_source',      label: 'สั่งลงที่ไหน', min: 110 },
      { key: 'eta_date',          label: 'วันที่คาดว่าของถึง', kind: 'date', min: 120 },
      { key: 'inbound_date',      label: 'Inbound วันที่รับของ', kind: 'date', min: 130 },
      { key: 'outbound_date',     label: 'Outbound วันที่ส่งของ', kind: 'date', min: 140 },
      { key: 'transfer_no',       label: 'เลขโอนสินค้า/เลขจัดส่ง', min: 150 },
      { key: 'arrived_branch',    label: 'ของถึงสาขา', kind: 'chip', min: 100 },
      { key: 'customer_notified', label: 'แจ้งลูกค้า', kind: 'chip', min: 100 },
      { key: 'delivered',         label: 'ส่งมอบสินค้า', kind: 'chip', min: 110 },
      { key: 'phone',             label: 'เบอร์โทรติดต่อ', min: 110 },
      { key: 'created_at',        label: 'TimeStamp', kind: 'datetime', min: 130 },
    ],
  },
  {
    id: 'request', label: 'Request Item', icon: '📦', table: 'ss_request_items',
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
    id: 'newproduct', label: 'New Product', icon: '🆕', table: 'ss_new_products',
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
    id: 'ticket', label: 'Ticket', icon: '🎫', table: 'ss_tickets',
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
    id: 'products', label: 'Products', icon: '💊', table: 'product_master',
    orderBy: 'sku', ascending: true,
    filter: { column: 'abc', value: 'P' },
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

const MENU_DISPLAY_ORDER: MenuId[] = ['products', 'order', 'request', 'newproduct', 'ticket'];

// ช่องรายละเอียดใน Popup Order (เรียงตามสเปค)
const ORDER_DETAIL_FIELDS: ColumnDef[] = [
  { key: 'sku_name',      label: 'SKU / ชื่อสินค้า' },
  { key: 'branch',        label: 'สาขา (Branch/Warehouse)' },
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
const ORDER_STEPS = [
  { key: 'arrived_branch',    label: 'ของถึงสาขา',  done: 'ถึงแล้ว',    pending: 'ยังไม่ถึง' },
  { key: 'customer_notified', label: 'แจ้งลูกค้า',   done: 'แจ้งแล้ว',   pending: 'ยังไม่แจ้ง' },
  { key: 'delivered',         label: 'ส่งมอบสินค้า', done: 'ส่งมอบแล้ว', pending: 'ยังไม่ส่งมอบ' },
] as const;

const stepDone = (v: string) => !!v && v.includes('แล้ว') && !v.includes('ยังไม่');

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
}

const REQUEST_STATUS_OPTIONS = ['อนุมัติ', 'กำลังติดต่อ', 'ไม่อนุมัติ'] as const;
const NEW_PRODUCT_STATUS_OPTIONS = ['อนุมัติ', 'รอพิจารณา', 'ไม่อนุมัติ'] as const;
const REQUEST_AVAILABILITY_OPTIONS = ['ต้องสั่ง', 'มีของ', 'ไม่มีของ', 'ของขาด', 'ยกเลิกจำหน่าย'] as const;
const TICKET_STATUS_OPTIONS = ['Done', 'Cancel'] as const;

async function insertWithContactChannelFallback(table: string, payload: Record<string, unknown>) {
  let { error } = await supabase.from(table).insert(payload);
  const missingContactChannel = error
    && error.message.includes('contact_channel')
    && (error.message.includes('schema cache') || error.message.includes('Could not find'));
  if (missingContactChannel) {
    const legacyPayload = { ...payload };
    delete legacyPayload.contact_channel;
    ({ error } = await supabase.from(table).insert(legacyPayload));
  }
  return error;
}

export function SaleSupportPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport, isPurchasing }: Props) {
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
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [stampError, setStampError] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<Record<string, unknown> | null>(null);
  const [detailView, setDetailView] = useState<{ title: string; table: string; fields: ColumnDef[]; row: Record<string, unknown> } | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const supplierFileRef = useRef<HTMLInputElement>(null);
  const [supplierMsg, setSupplierMsg] = useState('');
  const [uploadingSupplier, setUploadingSupplier] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const supplierMapRef = useRef<Map<string, { name: string; distributor: string }> | null>(null);
  const masterFileRef = useRef<HTMLInputElement>(null);
  const [masterMsg, setMasterMsg] = useState('');
  const [uploadingMaster, setUploadingMaster] = useState(false);
  const [showAddMaster, setShowAddMaster] = useState(false);
  const [masterForm, setMasterForm] = useState<MasterForm>(emptyMasterForm);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; table: string; label: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const menu = MENUS.find(m => m.id === activeMenu)!;

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setRows([]);
      let query = supabase.from(menu.table).select('*');
      // ilike แบบไม่มี wildcard = เท่ากันโดยไม่สนตัวพิมพ์เล็ก-ใหญ่
      if (menu.filter) query = query.ilike(menu.filter.column, menu.filter.value);
      if (menu.id === 'products' && productQuery) {
        query = query.or(`sku.ilike.${productQuery}%,name.ilike.%${productQuery}%,sku_name.ilike.%${productQuery}%`);
      }
      // Products เริ่มต้นโชว์ 20 รายการ, ค้นหาแล้วโชว์สูงสุด 100
      const limit = menu.id === 'products' ? (productQuery ? 100 : 20) : 500;
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
      } else {
        setRows(data ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [menu.table, refreshKey, productQuery]);

  const updateForm = (patch: Partial<OrderForm>) => setOrderForm(f => ({ ...f, ...patch }));

  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // เติมชื่อสินค้า+หน่วยอัตโนมัติจาก SKU/Barcode (ถ้ามีในระบบ) — พิมพ์เองได้ถ้าไม่พบ
  const lookupSku = async (term: string) => {
    const q = term.trim();
    if (!q) return;
    setSuggestions([]);
    const { data, error } = await supabase
      .from('products')
      .select('sku, name, unit')
      .or(`sku.eq.${q},barcode.eq.${q}`)
      .limit(1);
    if (!error && data && data[0]) {
      updateForm({ sku: data[0].sku ?? q, product_name: data[0].name ?? '', unit: data[0].unit ?? '' });
    }
  };

  // พิมพ์ 3 ตัวขึ้นไป → ค้นหารายชื่อสินค้ามาให้เลือก (หน่วง 250ms กันยิงถี่)
  const handleSkuChange = (value: string) => {
    updateForm({ sku: value });
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('products')
        .select('sku, name, unit')
        .or(`sku.ilike.${q}%,barcode.ilike.${q}%,name.ilike.%${q}%`)
        .limit(8);
      if (!error && data) {
        setSuggestions(data.map(d => ({ sku: d.sku ?? '', name: d.name ?? '', unit: d.unit ?? '' })));
      }
    }, 250);
  };

  const pickSuggestion = (s: ProductSuggestion) => {
    updateForm({ sku: s.sku, product_name: s.name, unit: s.unit });
    setSuggestions([]);
  };

  const openAddOrder = () => {
    setOrderForm(emptyOrderForm());
    setSuggestions([]);
    setSaveError('');
    setShowAddOrder(true);
  };

  const saveOrder = async () => {
    if (!orderForm.sku.trim() && !orderForm.product_name.trim()) { setSaveError('กรุณาใส่ SKU หรือชื่อสินค้า'); return; }
    if (!orderForm.qty || Number(orderForm.qty) <= 0) { setSaveError('กรุณาใส่จำนวนให้ถูกต้อง'); return; }
    setSaving(true);
    setSaveError('');
    const orderPayload = {
      branch: orderForm.branch,
      sku: orderForm.sku.trim() || null,
      product_name: orderForm.product_name.trim() || null,
      unit: orderForm.unit.trim() || null,
      qty: Number(orderForm.qty),
      paid_date: orderForm.paid_date || null,
      sale_bill_no: orderForm.sale_bill_no.trim() || null,
      customer_name: orderForm.customer_name.trim() || null,
      contact_channel: orderForm.contact_value.trim() ? orderForm.contact_channel : null,
      phone: orderForm.contact_value.trim() || null,
      pickup_date: orderForm.pickup_date || null,
      delivery_method: orderForm.delivery_method,
      // created_at (TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
    };
    const error = await insertWithContactChannelFallback('ss_orders', orderPayload);
    setSaving(false);
    if (error) {
      setSaveError(`บันทึกไม่สำเร็จ: ${error.message}`);
    } else {
      setShowAddOrder(false);
      setActiveMenu('order');
      setRefreshKey(k => k + 1);
    }
  };

  const updateRequestForm = (patch: Partial<RequestForm>) => setRequestForm(f => ({ ...f, ...patch }));

  const openAddRequest = () => {
    setRequestForm(emptyRequestForm());
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
    if (!requestForm.product_name.trim()) { setSaveError('กรุณาใส่ชื่อสินค้า'); return; }
    if (!requestForm.qty || Number(requestForm.qty) <= 0) { setSaveError('กรุณาใส่จำนวนที่ต้องการ'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const imageUrl = requestImage ? await uploadImage(requestImage, 'request-items') : null;
      const requestPayload = {
        branch: requestForm.branch,
        product_name: requestForm.product_name.trim(),
        supplier: requestForm.supplier.trim() || null,
        image_url: imageUrl,
        generic_name: requestForm.generic_name.trim() || null,
        strength: requestForm.strength.trim() || null,
        pack_size: requestForm.pack_size.trim() || null,
        qty: Number(requestForm.qty),
        customer_name: requestForm.customer_name.trim() || null,
        contact_channel: requestForm.contact_value.trim() ? requestForm.contact_channel : null,
        phone: requestForm.contact_value.trim() || null,
        need_date: requestForm.need_date || null,
        status: 'รอตรวจสอบ',
        // created_at (DateTime/TimeStamp) บันทึกอัตโนมัติจากฝั่งฐานข้อมูล
      };
      const error = await insertWithContactChannelFallback('ss_request_items', requestPayload);
      if (error) throw new Error(`บันทึกไม่สำเร็จ: ${error.message}`);
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
        ask_qty: productForm.ask_qty ? Number(productForm.ask_qty) : null,
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
      setShowAddMaster(false);
      setActiveMenu('products');
      setRefreshKey(k => k + 1);
    }
  };

  // กดตราประทับใน Popup Order: อนุมัติ / ยกเลิกการอนุมัติ (บันทึกลง Supabase ทันที)
  const toggleOrderStep = async (step: typeof ORDER_STEPS[number]) => {
    if (!selectedOrder) return;
    const id = String(selectedOrder.id);
    const current = String(selectedOrder[step.key] ?? '');
    const isDone = stepDone(current);
    if (isDone && !window.confirm(`ยกเลิกสถานะ "${step.label}" ?`)) return;
    const next = isDone ? step.pending : step.done;
    const { error } = await supabase.from('ss_orders').update({ [step.key]: next }).eq('id', id);
    if (error) {
      setStampError(`อัปเดตไม่สำเร็จ: ${error.message}`);
      return;
    }
    setStampError('');
    setSelectedOrder(o => (o ? { ...o, [step.key]: next } : o));
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, [step.key]: next } : r)));
  };

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
  const applyEditPatch = (id: string, patch: Record<string, unknown>) => {
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, ...patch } : r)));
    setSelectedOrder(o => (o && String(o.id) === id ? { ...o, ...patch } : o));
    setSelectedRequest(r => (r && String(r.id) === id ? { ...r, ...patch } : r));
    setDetailView(d => (d && String(d.row.id) === id ? { ...d, row: { ...d.row, ...patch } } : d));
    setEditing(false);
    if (activeMenu === 'products') { supplierMapRef.current = null; setRefreshKey(k => k + 1); }
  };

  const updateStatus = async (table: 'ss_request_items' | 'ss_new_products' | 'ss_tickets', id: string, status: string) => {
    const { error } = await supabase.from(table).update({ status }).eq('id', id);
    if (error) { setError(`บันทึก Status ไม่สำเร็จ: ${error.message}`); return; }
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, status } : r)));
    setSelectedRequest(prev => prev && String(prev.id) === id ? { ...prev, status } : prev);
  };

  const updateRequestAvailability = async (id: string, availability: string) => {
    const { error } = await supabase.from('ss_request_items').update({ availability }).eq('id', id);
    if (error) { setError(`บันทึก Availability ไม่สำเร็จ: ${error.message}`); return; }
    setRows(prev => prev.map(r => (String(r.id) === id ? { ...r, availability } : r)));
    setSelectedRequest(prev => prev && String(prev.id) === id ? { ...prev, availability } : prev);
  };

  const openDeleteRow = (row: Record<string, unknown>) => {
    setDeleteTarget({ id: String(row.id), table: menu.table, label: menu.label });
    setDeletePassword('');
    setDeleteError('');
  };

  const confirmDeleteRow = async () => {
    if (!deleteTarget) return;
    if (deletePassword !== '221900') {
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
            {MENU_DISPLAY_ORDER.map(id => MENUS.find(m => m.id === id)!).map(m => (
              <button
                key={m.id}
                className={`ss-menu-btn${m.id === activeMenu ? ' ss-menu-btn--active' : ''}`}
                onClick={() => setActiveMenu(m.id)}
              >
                <span className="ss-menu-icon">{m.icon}</span>
                {m.label}
              </button>
            ))}
            <div className="ss-sidebar-divider" />
            <input ref={supplierFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleSupplierFile(f); }} />
            <button className="ss-menu-btn ss-upload-supplier-btn" disabled={uploadingSupplier}
              onClick={() => supplierFileRef.current?.click()}>
              <span className="ss-menu-icon">📤</span>
              {uploadingSupplier ? 'กำลังนำเข้า...' : 'อัปโหลด Supplier'}
            </button>
            {supplierMsg && (
              <div className={`ss-supplier-msg${supplierMsg.startsWith('✕') ? ' ss-supplier-msg--error' : ''}`}>
                {supplierMsg}
              </div>
            )}
          </div>

          <div className="ss-panel ss-panel-anim" key={activeMenu}>
            <div className="ss-panel-toolbar">
              <span>{menu.icon} {menu.label} · {loading ? 'กำลังโหลด...' : `${rows.length} รายการ`}</span>
              {activeMenu === 'order' && (
                <button className="ss-add-btn" onClick={openAddOrder}>➕ New Order</button>
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
              {activeMenu === 'products' && (
                <>
                  <div className="ss-search-center">
                    <input className="ss-input ss-search-input" type="text"
                      placeholder="🔍 ค้นหา SKU หรือชื่อสินค้า..."
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)} />
                  </div>
                  <div className="ss-toolbar-btns">
                    <input ref={masterFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleMasterFile(f); }} />
                    <button className="ss-add-btn ss-add-btn--secondary" disabled={uploadingMaster}
                      onClick={() => masterFileRef.current?.click()}>
                      {uploadingMaster ? 'กำลังนำเข้า...' : '📤 อัปโหลด Product Master'}
                    </button>
                    <button className="ss-add-btn" onClick={openAddMaster}>➕ New Product</button>
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
                    {menu.columns.map(col => (
                      <th key={col.key} className={`ss-col-${col.key}`} style={col.min ? { minWidth: col.min } : undefined} title={col.label}>
                        {col.label}
                        {col.key === 'sku_name' && <span className="ss-column-resizer" onMouseDown={startSkuNameResize} title="ลากเพื่อปรับความกว้างคอลัมน์" />}
                      </th>
                    ))}
                    <th className="ss-delete-col">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && rows.length === 0 && !error && (
                    <tr><td className="ss-empty" colSpan={menu.columns.length}>ยังไม่มีข้อมูล</td></tr>
                  )}
                  {rows.map(row => (
                    <tr key={String(row.id)}
                      className="ss-row-click"
                      onClick={
                        activeMenu === 'order' ? () => { setSelectedOrder(row); setStampError(''); setEditing(false); }
                        : activeMenu === 'request' ? () => openRequestDetail(row)
                        : () => { setEditing(false); setDetailView({
                            title: `${menu.icon} รายละเอียด ${menu.label}`,
                            table: menu.table,
                            fields: activeMenu === 'products' ? PRODUCT_DETAIL_FIELDS : menu.columns,
                            row,
                          }); }
                      }>
                      {menu.columns.map(col => {
                        const text = formatCell(row, col);
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
                                onChange={e => updateStatus(statusTable, String(row.id), e.target.value)}
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
                                onChange={e => updateRequestAvailability(String(row.id), e.target.value)}
                              >
                                <option value="">เลือก Availability</option>
                                {REQUEST_AVAILABILITY_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
                              </select>
                            </td>
                          );
                        }
                        if (col.kind === 'chip' && text) {
                          return <td key={col.key}><span className={`ss-chip ${chipClass(text)}`}>{text}</span></td>;
                        }
                        if (col.key === 'image_url' && text) {
                          return <td key={col.key}><a className="ss-img-link" href={text} target="_blank" rel="noreferrer">🖼️ ดูรูป</a></td>;
                        }
                        return <td key={col.key} className={`ss-col-${col.key}`} title={col.key === 'sku_name' ? text : undefined}>{text}</td>;
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
              <span>📋 รายละเอียด Order</span>
              <div className="ss-head-actions">
                {!editing && <button className="ss-head-edit" onClick={() => setEditing(true)}>✏️ แก้ไข</button>}
                <button className="dl-modal-close" onClick={closeDetail}>✕</button>
              </div>
            </div>
            {editing ? (
              <DetailEditForm table="ss_orders" row={selectedOrder}
                onSaved={patch => applyEditPatch(String(selectedOrder.id), patch)}
                onCancel={() => setEditing(false)} />
            ) : (
              <div className="dl-modal-body ss-order-detail">
                <div className="ss-detail-grid">
                  {ORDER_DETAIL_FIELDS.map(f => (
                    <div key={f.key} className={`ss-detail-item${f.key === 'sku_name' || f.key === 'note' ? ' ss-detail-item--full' : ''}`}>
                      <span className="ss-detail-label">{f.label}</span>
                      <span className="ss-detail-value">{formatCell(selectedOrder, f) || '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="ss-detail-steps-title">สถานะการดำเนินการ · กดตราเพื่ออนุมัติ</div>
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
                onSaved={patch => applyEditPatch(String(selectedRequest.id), patch)}
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
                onSaved={patch => applyEditPatch(String(detailView.row.id), patch)}
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
          <div className="dl-modal" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>➕ New Order</span>
              <button className="dl-modal-close" onClick={() => setShowAddOrder(false)}>✕</button>
            </div>
            <div className="dl-modal-body ss-form">
              <div className="ss-form-row">
                <label>สาขา *</label>
                <select className="ss-input" value={orderForm.branch} onChange={e => updateForm({ branch: e.target.value })}>
                  {ORDER_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="ss-form-row">
                <label>SKU</label>
                <div className="ss-suggest-wrap">
                  <input className="ss-input" type="text" placeholder="พิมพ์ 3 ตัวขึ้นไป หรือกด Enter"
                    value={orderForm.sku}
                    onChange={e => handleSkuChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') lookupSku(orderForm.sku); }} />
                  {suggestions.length > 0 && (
                    <div className="ss-suggest-list">
                      {suggestions.map(s => (
                        <button key={s.sku} type="button" className="ss-suggest-item"
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
                <label>วันที่ชำระ</label>
                <input className="ss-input" type="date" value={orderForm.paid_date}
                  onChange={e => updateForm({ paid_date: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>เลขบิลขาย</label>
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
                <label>วันที่นัดรับ</label>
                <input className="ss-input" type="date" value={orderForm.pickup_date}
                  onChange={e => updateForm({ pickup_date: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>รับที่ร้าน/จัดส่ง</label>
                <select className="ss-input" value={orderForm.delivery_method}
                  onChange={e => updateForm({ delivery_method: e.target.value })}>
                  {DELIVERY_METHODS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
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
                <select className="ss-input" value={requestForm.branch} onChange={e => updateRequestForm({ branch: e.target.value })}>
                  {ORDER_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
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
              <div className="ss-form-row">
                <label>Generic Name</label>
                <input className="ss-input" type="text" placeholder="เช่น Loratadine"
                  value={requestForm.generic_name}
                  onChange={e => updateRequestForm({ generic_name: e.target.value })} />
              </div>
              <div className="ss-form-row">
                <label>ความแรง</label>
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
                  {NEW_PRODUCT_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="ss-form-row">
                <label>Ask Qty</label>
                <input className="ss-input" type="number" min="0" placeholder="0"
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
                  {NEW_PRODUCT_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
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
    </div>
  );
}
