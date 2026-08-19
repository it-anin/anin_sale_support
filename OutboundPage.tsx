import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { PROFILES } from './auth';
import * as XLSX from 'xlsx';

const BRANCHES = ['SRC', 'KKL', 'SSS'] as const;

// ปุ่มอนุมัติใช้รหัสเดียวกับ login แผนกคลังสินค้า (แก้รหัสที่ auth.ts ที่เดียว)
const WAREHOUSE_PASSWORD = PROFILES.find(p => p.id === 'WAREHOUSE')?.password ?? '0000';

interface OutboundRow {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  unit: string;
  qty: string;
  branch: string;
  approved: boolean;
  approvedAt: string;
  requested: boolean;
  requestedAt: string;
  requestDate: string;
  documentNo: string;
  location: string;
  enteredAt: string;
  notFound: boolean;
  outOfStock: boolean;
  stockQty?: string;     // จำนวนคงเหลือในคลังสินค้า ('' = ไม่มีในสต็อค) — ไม่ persist ดึงสดทุกครั้ง
  stockChecked?: boolean; // เช็คสต็อคแล้วหรือยัง — ไม่ persist
  // หน่วยทั้งหมดที่ SKU นี้มี (แผง/กล่อง ฯลฯ) ใช้ทำ dropdown คอลัมน์ Unit — ไม่ persist ดึงสดทุกครั้ง
  unitOptions?: { unit: string; barcode: string }[];
  persisted: boolean;    // แถวนี้ insert ลง Supabase แล้วหรือยัง (false = ยัง local-only)
}

// row ที่ได้จาก Supabase (snake_case ตาม schema outbound_requests)
interface DbOutboundRow {
  id: string;
  branch: string;
  sku: string | null;
  barcode: string | null;
  name: string | null;
  unit: string | null;
  not_found: boolean;
  qty: number | null;
  request_date: string | null;
  document_no: string | null;
  location: string | null;
  entered_at: string;
  requested: boolean;
  requested_at: string | null;
  approved: boolean;
  approved_at: string | null;
  out_of_stock: boolean;
}

// สาขาคลังสินค้าในตาราง stock (map มาจาก Warehouse)
const WAREHOUSE_BRANCH = 'คลังสินค้า';

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDocumentNo(value: number) {
  return String(value).padStart(4, '0');
}

function makeRow(documentNo = '0001', branch: string = 'SRC'): OutboundRow {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: '', barcode: '', name: '', unit: '',
    qty: '', branch,
    approved: false, approvedAt: '', requested: false, requestedAt: '',
    requestDate: todayIso(), documentNo, location: '', enteredAt: new Date().toISOString(),
    notFound: false, outOfStock: false, persisted: false,
  };
}

function rowFromDb(r: DbOutboundRow): OutboundRow {
  return {
    id: r.id,
    sku: r.sku ?? '',
    barcode: r.barcode ?? '',
    name: r.name ?? '',
    unit: r.unit ?? '',
    qty: r.qty === null || r.qty === undefined ? '' : String(r.qty),
    branch: r.branch,
    approved: r.approved,
    approvedAt: r.approved_at ?? '',
    requested: r.requested,
    requestedAt: r.requested_at ?? '',
    requestDate: r.request_date ?? todayIso(),
    documentNo: r.document_no ?? '',
    location: r.location ?? '',
    enteredAt: r.entered_at,
    notFound: r.not_found,
    outOfStock: r.out_of_stock,
    persisted: true,
  };
}

function toDbBody(row: OutboundRow) {
  return {
    branch: row.branch,
    sku: row.sku || null,
    barcode: row.barcode || null,
    name: row.name || null,
    unit: row.unit || null,
    not_found: row.notFound,
    qty: row.qty.trim() === '' || Number.isNaN(Number(row.qty)) ? null : Number(row.qty),
    request_date: row.requestDate || null,
    document_no: row.documentNo || null,
    location: row.location || null,
    requested: row.requested,
    requested_at: row.requestedAt || null,
    approved: row.approved,
    approved_at: row.approvedAt || null,
    out_of_stock: row.outOfStock,
  };
}

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
  isWarehouse: boolean;
  isPurchasing: boolean;
  userBranch?: string;
}

export function OutboundPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport, isWarehouse, isPurchasing, userBranch }: Props) {
  const canSwitchBranches = isWarehouse || isPurchasing;
  // โปรไฟล์ที่ลงข้อมูลได้แต่ไม่ใช่สาขาหน้าร้าน (Sale Admin) — หน้านี้ไม่รองรับ
  // ⚠️ ห้ามปล่อยผ่าน: `activeBranch` ด้านล่างจะ fallback เป็น 'SRC' แล้ว effect เติมแถวร่าง
  //    จะสร้างแถวติดสาขา SRC ให้ พอพิมพ์ปุ๊บ updateRow มาร์ค requested:true ทันที
  //    = ส่งใบเบิกในนามสาขาอื่นโดยสาขานั้นไม่รู้ตัว (outbound_requests.branch มี CHECK แค่ SRC/KKL/SSS)
  const branchNotSupported = !canSwitchBranches && Boolean(userBranch)
    && !(BRANCHES as readonly string[]).includes(userBranch as string);
  const [rows, setRows] = useState<OutboundRow[]>([]);
  const [activeBranch, setActiveBranch] = useState<string>(canSwitchBranches ? BRANCHES[0] : (userBranch && BRANCHES.includes(userBranch as typeof BRANCHES[number]) ? userBranch : BRANCHES[0]));
  const [unlocked, setUnlocked] = useState(false);
  const [pwRowId, setPwRowId] = useState<string | null>(null);
  const [pwAction, setPwAction] = useState<'approve' | 'delete'>('approve');
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');

  // ดึงจำนวนคงเหลือคลังสินค้าแบบ batch หลังโหลดแถว (เลียนแบบ loadWarehouseStock ในหน้า Sale Support)
  // ⚠️ ต้องทำแบบนี้เพราะตอนนี้ข้อมูลแชร์ข้ามโปรไฟล์แล้ว — คนที่ไม่ได้เป็นคนพิมพ์ SKU เองก็ต้องเห็นเลขคงเหลือด้วย
  const refreshStock = async (skus: string[]) => {
    const unique = [...new Set(skus.map(s => s.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    const { data, error } = await supabase.from('stock').select('sku, qty').eq('branch', WAREHOUSE_BRANCH).in('sku', unique);
    if (error) return; // อ่านไม่สำเร็จ — ปล่อยของเดิมไว้ อย่าโกหกว่าไม่มีของ
    const map = new Map<string, string>();
    for (const r of data ?? []) {
      const key = String(r.sku ?? '').trim();
      if (!key || map.has(key)) continue;
      const raw = String(r.qty ?? '');
      map.set(key, raw === '' || isNaN(Number(raw)) ? raw : String(Math.floor(Number(raw))));
    }
    setRows(prev => prev.map(r => {
      const key = r.sku.trim();
      if (!key) return r;
      return { ...r, stockQty: map.get(key) ?? '', stockChecked: true };
    }));
  };

  // ดึงหน่วยทั้งหมดของแต่ละ SKU มาเป็นตัวเลือกใน dropdown คอลัมน์ Unit (pattern เดียวกับ refreshStock)
  // ⚠️ จำเป็นเพราะ unitOptions ไม่ได้เก็บใน outbound_requests — คนที่เปิดหน้ามาทีหลัง (หรือหลัง refetch)
  // จะไม่มีตัวเลือกให้กดเลย ถ้าไม่ดึงใหม่ทุกครั้งที่โหลดแถว
  const refreshUnitOptions = async (skus: string[]) => {
    const unique = [...new Set(skus.map(s => s.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    const { data, error } = await supabase.from('products').select('sku, unit, barcode').in('sku', unique);
    if (error) return;
    const map = new Map<string, { unit: string; barcode: string }[]>();
    for (const r of data ?? []) {
      const key = String(r.sku ?? '').trim();
      const unit = String(r.unit ?? '').trim();
      if (!key || !unit) continue;
      const list = map.get(key) ?? [];
      if (!list.some(o => o.unit === unit)) list.push({ unit, barcode: String(r.barcode ?? '') });
      map.set(key, list);
    }
    setRows(prev => prev.map(r => {
      const key = r.sku.trim();
      if (!key) return r;
      return { ...r, unitOptions: map.get(key) ?? [] };
    }));
  };

  // โหลดแถวจาก Supabase ตาม role + subscribe realtime ให้ทุกโปรไฟล์เห็นข้อมูลเดียวกันสด ๆ
  // สาขาเห็นเฉพาะของตัวเอง · คลังสินค้า/จัดซื้อเห็นทุกสาขา (จัดซื้อดูอย่างเดียว ดูข้อ isPurchasing ด้านล่าง)
  useEffect(() => {
    let cancelled = false;

    const fetchRows = async () => {
      let query = supabase.from('outbound_requests').select('*').order('entered_at', { ascending: true });
      if (!canSwitchBranches && userBranch) {
        query = query.eq('branch', userBranch);
      }
      // ⚠️ คลังสินค้าเห็นเฉพาะแถวที่สาขากด "บันทึกรายการ" แล้วเท่านั้น (2569-08-19)
      // กันพนักงานคลังเห็นข้อมูลที่สาขายังพิมพ์/แก้ไขอยู่ (requested=false) แล้วเดินไปหยิบของล่วงหน้า
      // ก่อนสาขาจะตัดสินใจส่งจริง — จัดซื้อไม่กรอง (ดูอย่างเดียว ไม่มีการกระทำทางกายภาพกับของ)
      if (isWarehouse) {
        query = query.eq('requested', true);
      }
      const { data, error } = await query;
      if (cancelled || error) return;
      const fetched = (data ?? []).map(rowFromDb);
      setRows(prev => {
        // คงค่าที่ไม่ได้เก็บใน DB (คงเหลือคลัง + ตัวเลือกหน่วย) ของแถวเดิมไว้ ไม่งั้นทุก refetch (ทุก 30 วิ/realtime)
        // dropdown หน่วยจะกลายเป็นข้อความแวบนึงแล้วค่อยกลับมา และเลขคงเหลือจะกะพริบหายทุกครั้ง
        const prevById = new Map(prev.map(r => [r.id, r]));
        const merged = fetched.map(r => {
          const old = prevById.get(r.id);
          return old ? { ...r, stockQty: old.stockQty, stockChecked: old.stockChecked, unitOptions: old.unitOptions } : r;
        });
        const drafts = prev.filter(r => !r.persisted);
        return [...merged, ...drafts];
      });
      void refreshStock(fetched.map(r => r.sku));
      void refreshUnitOptions(fetched.map(r => r.sku));
    };

    void fetchRows();

    const channelFilter = !canSwitchBranches && userBranch
      ? { event: '*' as const, schema: 'public', table: 'outbound_requests', filter: `branch=eq.${userBranch}` }
      : { event: '*' as const, schema: 'public', table: 'outbound_requests' };
    const channel = supabase
      .channel(`outbound-requests-${userBranch ?? (isWarehouse ? 'warehouse' : 'purchasing')}`)
      .on('postgres_changes', channelFilter, () => { void fetchRows(); })
      .subscribe();
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void fetchRows(); };
    window.addEventListener('focus', fetchRows);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const timer = window.setInterval(fetchRows, 30_000);

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', fetchRows);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWarehouse, isPurchasing, userBranch]);

  // เติมแถวร่างว่างให้แท็บที่กำลังดูอยู่เสมอ ถ้าแท็บนั้นไม่มีแถวเลย (เหมือนพฤติกรรมเดิมตอนตารางว่าง)
  // ⚠️ ต้องกัน isWarehouse ด้วย ไม่ใช่แค่ isPurchasing — หลังกรอง query เป็น requested=true เท่านั้น
  // (ดูจุด fetchRows ด้านบน) แท็บที่ยังไม่มีใครส่งจะ "ไม่มีแถวเลย" ในสายตาคลังบ่อยขึ้นมาก ถ้าไม่กันไว้
  // จะเติมแถวร่างที่คลังพิมพ์ได้จริง (ช่อง SKU/Barcode/Qty ของคลังเป็น input ไม่ใช่ text) แล้วสร้างแถวใหม่
  // ติดสาขานั้นแบบ requested=false เงียบๆ โดยสาขาไม่รู้ตัว
  useEffect(() => {
    if (isWarehouse || isPurchasing) return; // ดูอย่างเดียว/รอสาขาส่งเอง ไม่ต้องมีแถวร่างให้พิมพ์
    if (branchNotSupported) return;          // Sale Admin ฯลฯ — แถวร่างจะติดสาขา SRC ที่ fallback มา
    if (rows.some(r => r.branch === activeBranch)) return;
    setRows(prev => [...prev, makeRow('0001', activeBranch)]);
  }, [activeBranch, rows, isWarehouse, isPurchasing, branchNotSupported]);

  // อัปเดตแค่ state ในเครื่อง (เร็ว ใช้ตอนพิมพ์สด ๆ) — ไม่ยิง Supabase ทุกตัวอักษร
  const updateRow = (id: string, patch: Partial<OutboundRow>) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const branchRequest = !isWarehouse && !isPurchasing && r.branch === activeBranch
        ? { requested: true, requestedAt: r.requestedAt || new Date().toISOString() }
        : {};
      return { ...r, ...patch, ...branchRequest };
    }));
  };

  // "กรอกจริงแล้วหรือยัง" — ใช้ตัดสินว่าแถวร่างควรถูก insert ลง Supabase ได้หรือยัง
  // ⚠️ วันที่เบิกไม่นับเป็นเนื้อหา เพราะ makeRow เติมวันที่วันนี้ให้ทุกแถวใหม่อยู่แล้ว
  const hasContent = (r: OutboundRow) => Boolean(r.sku.trim() || r.barcode.trim() || r.name.trim() || r.qty.trim());

  // เซฟจริงลง Supabase — แถวใหม่ (persisted=false) จะ insert ครั้งแรก แล้วสลับ id เป็นของ DB
  // แถวที่มีอยู่แล้วจะ update ตาม id — เรียกตอน blur/Enter/กดปุ่ม ไม่ใช่ทุก keystroke
  const persistRow = async (id: string, patch: Partial<OutboundRow> = {}) => {
    const current = rows.find(r => r.id === id);
    if (!current) return;
    const merged: OutboundRow = { ...current, ...patch };
    const body = toDbBody(merged);
    if (!merged.persisted) {
      // ⚠️ ยังว่างอยู่ → เก็บไว้ใน state เฉย ๆ ห้าม insert
      // (blur ช่อง SKU/Barcode/Qty ที่ยังว่าง หรือแตะช่องวันที่ ก็เรียกฟังก์ชันนี้ — เคยทำให้แถวเปล่าค้างฐานข้อมูลจริงมาแล้ว)
      if (!hasContent(merged)) { setRows(prev => prev.map(r => (r.id === id ? merged : r))); return; }
      const { data, error } = await supabase.from('outbound_requests').insert(body).select().single();
      if (error || !data) { window.alert(`บันทึกไม่สำเร็จ: ${error?.message ?? 'ไม่ทราบสาเหตุ'}`); return; }
      const saved = rowFromDb(data as DbOutboundRow);
      // `saved` มาจาก rowFromDb ซึ่งไม่มีค่าที่ไม่ได้เก็บใน DB — ต้องยกมาจากแถวเดิมเอง ไม่งั้น dropdown หน่วยหายทันทีหลัง insert
      setRows(prev => prev.map(r => (r.id === id ? { ...saved, stockQty: r.stockQty, stockChecked: r.stockChecked, unitOptions: merged.unitOptions ?? r.unitOptions } : r)));
    } else {
      const { error } = await supabase.from('outbound_requests').update(body).eq('id', merged.id);
      if (error) { window.alert(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
      setRows(prev => prev.map(r => (r.id === id ? merged : r)));
    }
  };

  // ค้นหาสินค้าจาก Supabase ด้วย SKU หรือ Barcode — คืน patch ให้ผู้เรียกไปเซฟเอง (ไม่ยิง state/DB เอง)
  const lookupProduct = async (term: string): Promise<Partial<OutboundRow> | null> => {
    const q = term.trim();
    if (!q) return null;

    // ⚠️ ห้ามใส่ .limit(1) — สินค้าตัวเดียวกันมีได้หลายหน่วย (แผง/กล่อง) เป็นคนละแถวใน products
    // คนละ barcode คนละราคา · เอามาให้ครบเพื่อทำ dropdown เลือกหน่วยในคอลัมน์ Unit (เหมือนหน้าป้ายราคาที่โชว์ทุกหน่วย)
    const { data: pdata } = await supabase
      .from('products')
      .select('sku, barcode, name, unit')
      .or(`sku.eq.${q},barcode.eq.${q}`);
    let matches = pdata ?? [];

    // พิมพ์/สแกน barcode มา → ได้แถวเดียวเฉพาะหน่วยนั้น ต้องดึงหน่วยพี่น้องของ SKU เดียวกันมาด้วย
    // ไม่งั้นสาขาที่สแกนกล่องมาจะสลับไปเบิกแผงไม่ได้
    if (matches.length === 1 && matches[0]?.sku) {
      const { data: siblings } = await supabase
        .from('products')
        .select('sku, barcode, name, unit')
        .eq('sku', matches[0].sku);
      if (siblings && siblings.length > 1) matches = siblings;
    }

    // ถ้าค้นด้วย barcode ให้เลือกหน่วยของ barcode นั้นเป็นค่าตั้งต้น ไม่งั้นใช้แถวแรกของ SKU
    const product = matches.find(r => String(r.barcode ?? '') === q) ?? matches[0];
    const unitOptions = matches
      .filter(r => String(r.unit ?? '').trim())
      .map(r => ({ unit: String(r.unit), barcode: String(r.barcode ?? '') }))
      .filter((o, i, arr) => arr.findIndex(x => x.unit === o.unit) === i);

    // barcode เช็คใน stock ไม่ได้เพราะ stock ไม่มีคอลัมน์ barcode — ใช้เป็น fallback ชื่อ/หน่วยเท่านั้น
    const skuForStock = product?.sku ?? (/^\d+$/.test(q) ? q : null);
    let stockRow: { sku?: string; name?: string; unit?: string } | null = null;
    if (!product && skuForStock) {
      const { data: sdata } = await supabase
        .from('stock')
        .select('sku, name, unit')
        .eq('branch', WAREHOUSE_BRANCH)
        .eq('sku', skuForStock)
        .limit(1);
      stockRow = sdata?.[0] ?? null;
    }

    if (product || stockRow) {
      return {
        sku: product?.sku ?? stockRow?.sku ?? q,
        barcode: product?.barcode ?? '',
        name: product?.name ?? stockRow?.name ?? '',
        unit: product?.unit ?? stockRow?.unit ?? '',
        unitOptions,
        notFound: false,
      };
    }
    return { name: '', unit: '', unitOptions: [], notFound: true };
  };

  const commitSkuOrBarcode = async (id: string, field: 'sku' | 'barcode', value: string) => {
    const found = await lookupProduct(value);
    await persistRow(id, { [field]: value, ...(found ?? {}) });
  };

  const visibleRows = rows.filter(row => row.branch === activeBranch);

  const addRow = () => setRows(prev => {
    const branchRows = prev.filter(r => r.branch === activeBranch);
    const nextNo = branchRows.reduce((max, row) => Math.max(max, Number(row.documentNo) || 0), 0) + 1;
    return [...prev, makeRow(formatDocumentNo(nextNo), activeBranch)];
  });

  const dropRowLocally = (id: string) => setRows(prev => {
    const next = prev.filter(r => r.id !== id);
    if (next.length > 0 || isWarehouse) return next; // คลังไม่ควรมีแถวร่างในเครื่องเลยสักแถว (เหตุผลเดียวกับจุดอื่นด้านบน)
    return [makeRow('0001', activeBranch)];
  });

  // ⚠️ ต้องรอผลลบจาก Supabase ให้สำเร็จก่อนค่อยเอาแถวออกจากหน้าจอ — ห้าม optimistic
  // บั๊กเดิม (2569-08-18): ยิง `void supabase.delete()` แบบไม่รอผล/ไม่เช็ค error แล้วลบออกจาก state ทันที
  // → ถ้าคำสั่งไม่สำเร็จ หน้าจอบอกว่าลบแล้วแต่ DB ยังมีอยู่ พอ refresh แถวก็กลับมา ไม่มีอะไรเตือนเลย
  // และเช็ค id ว่าขึ้นต้น `local-` ไหมแทนการเชื่อ flag `persisted` อย่างเดียว (flag เพี้ยน = ข้ามการลบเงียบ ๆ)
  const removeRow = async (id: string) => {
    const target = rows.find(r => r.id === id);
    const isDraft = id.startsWith('local-') && !target?.persisted;
    if (isDraft) { dropRowLocally(id); return; }   // แถวร่างที่ยังไม่เคยลง DB — ลบจาก state ได้เลย

    const { data, error } = await supabase.from('outbound_requests').delete().eq('id', id).select('id');
    if (error) { window.alert(`ลบไม่สำเร็จ: ${error.message}\nแถวนี้ยังอยู่ในระบบ`); return; }
    if (!data || data.length === 0) {
      window.alert('ไม่พบรายการนี้ในฐานข้อมูลแล้ว (อาจมีคนอื่นลบไปก่อน) — จะเอาออกจากหน้าจอให้');
    }
    dropRowLocally(id);
  };

  // คลังสินค้ากดปุ่ม [⊘ ของหมด] = แจ้งว่าของหมด (ไม่ใช่ลบแถว) — ยกเลิกได้ที่ลิงก์ใต้ตราประทับ
  const toggleOutOfStock = (row: OutboundRow) => {
    if (row.approved) { window.alert('รายการนี้อนุมัติไปแล้ว'); return; }
    void persistRow(row.id, { outOfStock: !row.outOfStock });
  };

  // ล้างเฉพาะแถวของสาขาที่กำลังดูอยู่ (activeBranch) เท่านั้น — ⚠️ ห้ามล้างทุกสาขา
  // ตอนนี้ rows ของคลัง/จัดซื้อมีข้อมูลทุกสาขาปนกัน ถ้าล้างแบบเดิม (ล้างทั้ง state) จะลบของสาขาอื่นที่ไม่ได้กำลังดูไปด้วย
  // ⚠️ รอผลลบให้สำเร็จก่อนล้างออกจากหน้าจอ เหตุผลเดียวกับ removeRow (ห้าม optimistic)
  const clearAll = async () => {
    if (!window.confirm(`ลบรายการเบิกทั้งหมดของสาขา ${activeBranch}?`)) return;
    const idsToDelete = rows.filter(r => r.branch === activeBranch && !r.id.startsWith('local-')).map(r => r.id);
    if (idsToDelete.length > 0) {
      const { error } = await supabase.from('outbound_requests').delete().in('id', idsToDelete);
      if (error) { window.alert(`ลบไม่สำเร็จ: ${error.message}\nรายการยังอยู่ในระบบ`); return; }
    }
    // ⚠️ ห้ามเติมแถวร่างว่างให้ activeBranch เหมือนโค้ดเดิม — ปุ่มนี้เห็นเฉพาะคลัง (isWarehouse) และคลังไม่ควร
    // มีแถวร่างในเครื่องเลยสักแถว (เหตุผลเดียวกับจุด fetchRows/เพิ่มแถว ด้านบน) ล้างแล้วปล่อยว่างจริง ๆ
    setRows(prev => prev.filter(r => r.branch !== activeBranch));
  };

  const exportXlsx = () => {
    const branchRows = rows.filter(row => row.branch === activeBranch);
    if (!branchRows.length) {
      window.alert(`ไม่มีรายการสำหรับสาขา ${activeBranch}`);
      return;
    }
    const exportRows = branchRows.map(row => ({
      Branch: row.branch, SKU: row.sku, Barcode: row.barcode, Name: row.name,
      Unit: row.unit, Quantity: row.qty, Location: row.location ?? '',
      'เวลาที่สาขาลง': row.enteredAt ? new Date(row.enteredAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' }) : '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: ['Branch', 'SKU', 'Barcode', 'Name', 'Unit', 'Quantity', 'Location', 'เวลาที่สาขาลง'] });
    worksheet['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 24 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Quick Outbound');
    const exportDate = new Date();
    const day = String(exportDate.getDate()).padStart(2, '0');
    const month = String(exportDate.getMonth() + 1);
    const year = String(exportDate.getFullYear());
    const dateKey = `${year}${month.padStart(2, '0')}${day}`;
    const sequenceKey = `picklistSequence_${activeBranch}_${dateKey}`;
    const sequence = Number(localStorage.getItem(sequenceKey) || '0') + 1;
    localStorage.setItem(sequenceKey, String(sequence));
    const picklistNumber = `${day}${month}${year}${String(sequence).padStart(3, '0')}`;
    XLSX.writeFile(workbook, `Picklist_${activeBranch}_เบิกด่วน_${picklistNumber}.xlsx`);
  };

  const approveRow = (id: string) => {
    void persistRow(id, { approved: true, approvedAt: new Date().toISOString() });
  };

  const handleOutboundClick = (row: OutboundRow) => {
    if (row.approved) return;
    if (!row.sku || !row.name) { window.alert('กรุณาใส่ SKU หรือ Barcode ให้ระบบดึงข้อมูลสินค้าก่อน'); return; }
    if (!row.qty || Number(row.qty) <= 0) { window.alert('กรุณาใส่จำนวนที่เบิก'); return; }
    if (!isWarehouse) {
      void persistRow(row.id, { requested: true, requestedAt: new Date().toISOString() });
      return;
    }
    if (!row.requested) { window.alert('รายการนี้ยังไม่ได้ส่งขออนุมัติจากสาขา'); return; }
    if (unlocked) { approveRow(row.id); return; }
    setPwAction('approve');
    setPwInput('');
    setPwError('');
    setPwRowId(row.id);
  };

  // คลังสินค้าลบรายการทิ้งถาวร — ต้องใส่รหัสทุกครั้ง ไม่ใช้ shortcut `unlocked` เหมือนปุ่มอนุมัติ
  // (ลบแล้วกู้คืนไม่ได้ ต่างจากอนุมัติที่ยังแก้ไขสถานะสาขาอื่นต่อได้)
  // ⚠️ ลบได้แม้แถวจะ approved แล้ว (2569-08-18 กลับกฎเดิมตามคำขอผู้ใช้) — รหัสผ่านทุกครั้งคือด่านกันพลาดเดียวที่เหลืออยู่
  const handleWarehouseDelete = (row: OutboundRow) => {
    setPwAction('delete');
    setPwInput('');
    setPwError('');
    setPwRowId(row.id);
  };

  const confirmPassword = () => {
    if (pwInput === WAREHOUSE_PASSWORD) {
      setUnlocked(true);
      if (pwRowId) {
        if (pwAction === 'delete') void removeRow(pwRowId);
        else approveRow(pwRowId);
      }
      setPwRowId(null);
    } else {
      setPwError('รหัสผ่านไม่ถูกต้อง');
    }
  };

  const approvedCount = visibleRows.filter(r => r.approved).length;

  const heroHeader = (
    <div className="hero-header">
      <div className="hero-content">
        <h1 className="logo-premium"><AnimatedLogoText text="QUICK OUTBOUND" /></h1>
        <div className="tagline-row">
          <span className="updated-badge">เบิกสินค้าด่วน {unlocked ? '🔓' : '🔐'}</span>
        </div>
        <PageNavRow current="outbound" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport }} />
      </div>
    </div>
  );

  // ต้องอยู่หลัง hooks ทั้งหมด (early-return ก่อน hooks ผิดกฎ React) — ดูคำอธิบายที่ branchNotSupported
  if (branchNotSupported) {
    return (
      <div className="app-container">
        {heroHeader}
        <div className="container">
          <div className="product-table-wrap stock-table-wrap outbound-table-wrap">
            <div className="outbound-empty-note">
              <p><strong>หน้านี้ใช้ได้เฉพาะรหัสสาขา (SRC / KKL / SSS) และคลังสินค้า/จัดซื้อ</strong></p>
              <p>โปรไฟล์ที่เข้าสู่ระบบอยู่ไม่ได้สังกัดสาขาหน้าร้าน จึงเบิกสินค้าจากคลังไม่ได้</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {heroHeader}

      <div className="container">
        <div className="product-table-wrap stock-table-wrap outbound-table-wrap">
          <div className="selected-table-header outbound-toolbar">
            <span>{visibleRows.length} รายการ · อนุมัติแล้ว {approvedCount}</span>
            {canSwitchBranches && (
              <div className="outbound-branch-tabs" role="tablist" aria-label="เลือกสาขา">
                {BRANCHES.map(branch => {
                  const count = rows.filter(row => row.branch === branch).length;
                  return (
                    <button
                      key={branch}
                      type="button"
                      role="tab"
                      aria-selected={activeBranch === branch}
                      className={`outbound-branch-tab ${activeBranch === branch ? 'outbound-branch-tab--active' : ''}`}
                      onClick={() => setActiveBranch(branch)}
                    >
                      <span>{branch}</span><small>{count}</small>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="outbound-toolbar-btns">
              {isWarehouse && (
                <button className="outbound-3d-btn outbound-export-btn" onClick={exportXlsx} title="Export .xlsx">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span className="outbound-3d-btn-txt">Export</span>
                </button>
              )}
              {/* ⚠️ เฉพาะสาขาเท่านั้น — คลังไม่ควรมีแถวร่างในเครื่องเลยสักแถว (ดูจุด fetchRows/auto-draft-row ด้านบน)
                  เดิมกันแค่ isPurchasing ทำให้คลังกดปุ่มนี้ได้ สร้างแถวว่างในเครื่องที่ยังไม่ persisted แล้วไปโผล่ในตัวเลขบนแท็บ
                  (นับจาก rows ตรงๆ ไม่แยกว่า persisted/requested จริงหรือยัง) ดูเหมือนสาขาส่งมาทั้งที่ยังไม่ได้กดเลย */}
              {!isWarehouse && !isPurchasing && (
                <button className="outbound-3d-btn" onClick={addRow} title="เพิ่มแถว">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span className="outbound-3d-btn-txt">เพิ่มแถว</span>
                </button>
              )}
              {/* ⚠️ "ล้างหมด" ให้เฉพาะคลังสินค้า — ถ้าสาขากดได้ จะเลี่ยงข้อห้ามลบรายแถวไปลบรวดเดียวทั้งสาขาได้ */}
              {isWarehouse && (
                <button className="outbound-3d-btn outbound-3d-btn--clear" onClick={() => void clearAll()} title="ล้างทั้งหมด">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                  <span className="outbound-3d-btn-txt">ล้างหมด</span>
                </button>
              )}
            </div>
          </div>
          <table className="product-table stock-table outbound-table">
            <thead>
              <tr>
                <th className="ob-col-entered">วันที่สาขาลง</th>
                <th className="ob-col-sku">SKU</th>
                <th className="ob-col-barcode">Barcode</th>
                <th className="ob-col-name">Name</th>
                <th className="ob-col-unit">Unit</th>
                <th className="ob-col-stock">คงเหลือคลัง</th>
                <th className="ob-col-qty">Quantity</th>
                <th className="ob-col-request-date">วันที่เบิก</th>
                <th className="ob-col-document-no">เลขที่เอกสาร</th>
                {/* คอลัมน์ Branch แสดงเฉพาะคลังสินค้า — ฝั่งสาขารู้สาขาตัวเองจากรหัสที่ล็อกอินอยู่แล้ว จัดซื้อสลับดูผ่านแท็บ ไม่ต้องมีคอลัมน์นี้ */}
                {isWarehouse && <th className="ob-col-branch">Branch</th>}
                <th className="ob-col-outbound">สถานะ</th>
                <th className="ob-col-del"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr key={row.id} className={row.approved ? 'outbound-row--approved' : ''}>
                  <td className="ob-col-entered">
                    {row.enteredAt ? (
                      <span
                        className="outbound-entered-date"
                        title={new Date(row.enteredAt).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'medium' })}
                      >
                        {new Date(row.enteredAt).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </span>
                    ) : (
                      <span className="outbound-hint">—</span>
                    )}
                  </td>
                  <td className="ob-col-sku">
                    {isPurchasing ? (
                      row.sku || <span className="outbound-hint">—</span>
                    ) : (
                      <input
                        key={`${row.id}-sku-${row.sku}`}
                        type="text"
                        className="outbound-input"
                        placeholder="SKU"
                        defaultValue={row.sku}
                        disabled={row.approved}
                        onBlur={e => { void commitSkuOrBarcode(row.id, 'sku', e.target.value); }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      />
                    )}
                  </td>
                  <td className="ob-col-barcode">
                    {isPurchasing ? (
                      row.barcode || <span className="outbound-hint">—</span>
                    ) : (
                      <input
                        key={`${row.id}-barcode-${row.barcode}`}
                        type="text"
                        className="outbound-input"
                        placeholder="Barcode"
                        defaultValue={row.barcode}
                        disabled={row.approved}
                        onBlur={e => { void commitSkuOrBarcode(row.id, 'barcode', e.target.value); }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      />
                    )}
                  </td>
                  <td className="ob-col-name">
                    {row.notFound
                      ? <span className="outbound-notfound">ไม่พบสินค้า</span>
                      : row.name || <span className="outbound-hint">สแกน/พิมพ์ SKU หรือ Barcode แล้วกด Enter</span>}
                  </td>
                  <td className="ob-col-unit">
                    {/* สินค้าที่มีหลายหน่วย (เช่น แผง/กล่อง) ให้เลือกได้ — เปลี่ยนหน่วยแล้ว barcode ตามไปด้วยอัตโนมัติ
                        เพราะแต่ละหน่วยเป็นคนละแถวใน products มีบาร์โค้ด/ราคาของตัวเอง */}
                    {!isPurchasing && !row.approved && (row.unitOptions?.length ?? 0) > 1 ? (
                      <select
                        className="outbound-select"
                        value={row.unit}
                        onChange={e => {
                          const picked = row.unitOptions?.find(o => o.unit === e.target.value);
                          void persistRow(row.id, { unit: e.target.value, barcode: picked?.barcode ?? row.barcode });
                        }}
                      >
                        {row.unitOptions!.map(o => <option key={o.unit} value={o.unit}>{o.unit}</option>)}
                      </select>
                    ) : (
                      row.unit
                    )}
                  </td>
                  <td className="ob-col-stock">
                    {!row.stockChecked || row.notFound ? null
                      : row.stockQty !== '' && row.stockQty !== undefined && Number(row.stockQty) > 0
                        ? <span className="outbound-instock">คงเหลือ {Math.floor(Number(row.stockQty))}</span>
                        : <span className="outbound-nostock">ไม่มีสินค้าในสต็อค</span>}
                  </td>
                  <td className="ob-col-qty">
                    {isPurchasing ? (
                      row.qty || <span className="outbound-hint">—</span>
                    ) : (
                      <input
                        key={`${row.id}-qty-${row.qty}`}
                        type="number"
                        className="outbound-input outbound-input--qty"
                        placeholder="0"
                        min="0"
                        defaultValue={row.qty}
                        disabled={row.approved}
                        onBlur={e => { void persistRow(row.id, { qty: e.target.value }); }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      />
                    )}
                  </td>
                  <td className="ob-col-request-date">
                    {isPurchasing ? (
                      (row.requestDate ?? todayIso())
                    ) : (
                      <input
                        type="date"
                        className="outbound-input outbound-date-input"
                        value={row.requestDate ?? todayIso()}
                        disabled={row.approved}
                        onChange={e => { updateRow(row.id, { requestDate: e.target.value }); void persistRow(row.id, { requestDate: e.target.value }); }}
                      />
                    )}
                  </td>
                  <td className="ob-col-document-no">
                    <span className="outbound-document-no">{row.documentNo ?? '0001'}</span>
                  </td>
                  {isWarehouse && (
                    <td className="ob-col-branch">
                      <select
                        className="outbound-select"
                        value={row.branch}
                        disabled={row.approved}
                        onChange={e => { updateRow(row.id, { branch: e.target.value }); void persistRow(row.id, { branch: e.target.value }); }}
                      >
                        {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="ob-col-outbound">
                    {row.approved ? (
                      <div className="outbound-approved-mark">
                        <span className="outbound-approved-stamp">อนุมัติแล้ว ✓</span>
                        <span className="outbound-approved-time">
                          {row.approvedAt && new Date(row.approvedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                    ) : row.outOfStock ? (
                      // คลังสินค้าเห็นปุ่มยกเลิกใต้ตราประทับ (เดิมกดปุ่ม ✕ ท้ายแถวซ้ำเพื่อยกเลิก)
                      <div className="outbound-action-group">
                        {/* ใช้ ⊘ ให้ตรงกับไอคอนบนปุ่ม "ของหมด" (เดิมเป็น ✕ ซึ่งซ้ำความหมายกับปุ่มลบ) */}
                        <span className="outbound-outofstock-mark">ของหมด ⊘</span>
                        {isWarehouse && (
                          <button className="outbound-oos-undo" onClick={() => toggleOutOfStock(row)}>ยกเลิกสถานะนี้</button>
                        )}
                      </div>
                    ) : isPurchasing ? (
                      <div className="outbound-pending-mark">{row.requested ? 'รอคลังอนุมัติ' : 'สาขายังไม่ส่งรายการ'}</div>
                    ) : !isWarehouse ? (
                      row.requested ? (
                        <div className="outbound-pending-mark">รออนุมัติ</div>
                      ) : (
                        <button className="outbound-approve-btn" onClick={() => handleOutboundClick(row)}>
                          บันทึกรายการ
                        </button>
                      )
                    ) : !row.requested ? (
                      // สาขายังไม่กด Outbound — ยังไม่มีคำขอให้ตัดสินใจ จึงซ่อนทั้งปุ่มอนุมัติและของหมด
                      // (กันคลังสินค้าเผลอตอบรายการที่สาขายังกรอกไม่เสร็จ)
                      <div className="outbound-waiting-mark">รอสาขาส่งรายการ</div>
                    ) : (
                      // คลังสินค้า: ปุ่มตัดสินใจ 2 ทางอยู่คู่กัน — อนุมัติ ↔ ของหมด
                      // ⚠️ "ของหมด" ต้องอยู่ช่องนี้ ไม่ใช่ช่องท้ายแถว เพราะเป็นการตอบคำขอ ไม่ใช่การจัดการแถว
                      // (เดิมใช้ปุ่ม ✕ ท้ายแถวคู่กับถังขยะ แล้วพนักงานสับสนว่าอันไหนลบจริง)
                      <div className="outbound-action-group">
                        <button className="outbound-ok-btn" onClick={() => handleOutboundClick(row)}>
                          <span className="outbound-btn-ico">✓</span>อนุมัติ
                        </button>
                        <button className="outbound-oos-btn" title="แจ้งสาขาว่าสินค้าหมด" onClick={() => toggleOutOfStock(row)}>
                          <span className="outbound-btn-ico">⊘</span>ของหมด
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="ob-col-del">
                    {/* ช่องนี้ทำหน้าที่เดียวคือ "ลบแถว" — ⚠️ ห้ามเอา ✕ กลับมาใช้สื่อความหมายอื่นที่นี่อีก
                        (เดิมสาขา ✕ = ลบ แต่คลัง ✕ = ของหมด คนละเรื่องกันจนพนักงานสับสน)
                        กันเบิกซ้ำ: ลบได้เฉพาะแถวที่ "คลังยังไม่เห็น" เท่านั้น — คลังสินค้าลบได้ทุกแถว (มีรหัสกันไว้ชั้นนึงแล้ว)
                        ส่วนสาขาลบได้เฉพาะแถวที่ตัวเองยังไม่กด "บันทึกรายการ" (`!row.requested`) เพราะแถวนั้นยังไม่เคยส่งให้คลัง
                        เห็น จึงไม่มีทางที่คลังจะจ่ายของไปแล้ว — พอกดส่งแล้ว ปุ่มนี้หายไป ต้องแก้ค่าในแถวเดิมหรือแจ้งคลังให้ลบแทน */}
                    {isWarehouse ? (
                      <button
                        className="outbound-del-btn"
                        title="ลบรายการนี้ทิ้งถาวร (ต้องใส่รหัสผ่าน)"
                        onClick={() => handleWarehouseDelete(row)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    ) : !isPurchasing && !row.requested ? (
                      <button
                        className="outbound-del-btn"
                        title="ลบรายการนี้ (ยังไม่ได้ส่งให้คลังสินค้า)"
                        onClick={() => void removeRow(row.id)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {pwRowId && (
        <div className="dl-modal-overlay" onClick={() => setPwRowId(null)}>
          <div className="dl-modal dl-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="dl-modal-header">
              <span>🔐 ใส่รหัสผ่านเพื่อ{pwAction === 'delete' ? 'ลบรายการ' : 'อนุมัติ'}</span>
              <button className="dl-modal-close" onClick={() => setPwRowId(null)}>✕</button>
            </div>
            <div className="dl-modal-body">
              <input
                type="password"
                className="outbound-input outbound-input--pw"
                placeholder="รหัสผ่านคลังสินค้า"
                autoFocus
                value={pwInput}
                onChange={e => { setPwInput(e.target.value); setPwError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') confirmPassword(); }}
              />
              {pwError && <div className="outbound-notfound">{pwError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="outbound-confirm-btn" onClick={confirmPassword}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                <span>ยืนยัน</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
