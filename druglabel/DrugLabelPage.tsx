import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as XLSX from 'xlsx';
import { supabaseLabel, supabaseLabelError, supabaseLabelWrite, TBL_SETTINGS, TBL_MEDICINES, TBL_TRANSLATIONS } from './supabase';
import { LANGS, type Lang, type Medicine, type ShopSettings } from './types';
import { Label } from './Label';
import { DLResultList } from './ResultList';
import { translateMedicineLabel, getTargetLangs } from './translate';
import { AnimatedLogoText } from '../AnimatedLogo';
import { PageNavRow } from '../pageAccess';
import { SearchIcon } from '../SearchIcon';

const BRANCH_PROFILES = [
  { id: 'hq',        shop_name_th: 'สาขาชากค้อ',          shop_name_en: 'Chak Kho Branch',           phone: '082-0311590' },
  { id: 'nine-kilo', shop_name_th: 'สาขาเก้ากิโล',         shop_name_en: 'Kao Ki Lo Branch',          phone: '098-8201512' },
  { id: 'suan-suea', shop_name_th: 'สาขาสวนเสือศรีราชา',   shop_name_en: 'Suan Suea SiRacha Branch',  phone: '092-2469002' },
] as const;

type BranchId = (typeof BRANCH_PROFILES)[number]['id'];

type MedRow = { id: string; sku: string; barcode: string | null };
type TrRow  = { medicine_id: string; trade_name?: string | null; generic_name?: string | null;
                usage?: string | null; indication?: string | null; warning?: string | null; storage?: string | null };

type TrForm = { trade_name: string; generic_name: string; usage: string; indication: string; warning: string; storage: string };
type AddForm = { sku: string; barcode: string; translations: Record<Lang, TrForm> };

const emptyTr = (): TrForm => ({ trade_name: '', generic_name: '', usage: '', indication: '', warning: '', storage: '' });
const emptyForm = (): AddForm => ({
  sku: '', barcode: '',
  translations: Object.fromEntries(LANGS.map(l => [l.code, emptyTr()])) as Record<Lang, TrForm>,
});

function flatMed(med: MedRow, tr: Omit<TrRow, 'medicine_id'> | null): Medicine {
  return {
    id: med.id, sku: med.sku, barcode: med.barcode,
    trade_name:   tr?.trade_name   ?? `(${med.sku})`,
    generic_name: tr?.generic_name ?? null,
    usage:        tr?.usage        ?? null,
    indication:   tr?.indication   ?? null,
    warning:      tr?.warning      ?? null,
    storage:      tr?.storage      ?? null,
  };
}

/* ---------- นำเข้าฉลากยาจากไฟล์ XLSX/CSV (ภาษาไทยอย่างเดียว) ---------- */

// mapping ตามตำแหน่งคอลัมน์ (ไม่ใช่ชื่อหัวคอลัมน์) ตามที่ผู้ใช้กำหนด
// A=SKU · D=ข้อบ่งใช้ · E=วิธีใช้ · F=ข้อควรระวัง · G=การเก็บรักษา · H=ชื่อยา · I+J=ชื่อการค้า
const IMPORT_COL = { sku: 0, indication: 3, usage: 4, warning: 5, storage: 6, generic_name: 7, trade1: 8, trade2: 9 };
const TRADE_NAME_SEP = ' / ';
const IMPORT_CHUNK = 500;

type ImportRow = TrForm & { sku: string; usage_ref: string };
type ImportParseResult = {
  rows: ImportRow[];
  totalDataRows: number;
  skippedNoSku: number;
  skippedEmpty: number;
  dupInFile: number;
};

function parseLabelSheet(ws: XLSX.WorkSheet): ImportParseResult {
  // header:1 (array-of-arrays) จำเป็นเพราะ mapping เป็นตำแหน่ง · raw:false กัน SKU ตัวเลขกลายเป็น number
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: false });
  if (aoa.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล (มีแต่แถวหัวคอลัมน์ หรือว่างเปล่า)');

  // ไฟล์มีแถวหัวคอลัมน์เสมอ → ข้ามแถวแรกทุกครั้ง
  const dataRows = aoa.slice(1);

  // AOA ตัดคอลัมน์ว่างท้ายแถวออก index 9 อาจเป็น undefined จึงต้อง ?? ''
  const cell = (r: unknown[], i: number) => {
    const v = String(r[i] ?? '').trim();
    return v === '-' ? '' : v;
  };

  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  let skippedNoSku = 0, skippedEmpty = 0, dupInFile = 0;

  for (const r of dataRows) {
    let sku = cell(r, IMPORT_COL.sku);
    if (!sku) { skippedNoSku++; continue; }
    if (/^\d{1,5}$/.test(sku)) sku = sku.padStart(6, '0');

    const t1 = cell(r, IMPORT_COL.trade1);
    const t2 = cell(r, IMPORT_COL.trade2);
    const trade_name = t1 && t2 ? `${t1}${TRADE_NAME_SEP}${t2}` : (t1 || t2);

    const row: ImportRow = {
      sku,
      trade_name,
      generic_name: cell(r, IMPORT_COL.generic_name),
      usage:        cell(r, IMPORT_COL.usage),
      indication:   cell(r, IMPORT_COL.indication),
      warning:      cell(r, IMPORT_COL.warning),
      storage:      cell(r, IMPORT_COL.storage),
      usage_ref:    cell(r, IMPORT_COL.usage).slice(0, 100),
    };

    if (!row.trade_name && !row.generic_name && !row.usage && !row.indication && !row.warning && !row.storage) {
      skippedEmpty++; continue;
    }

    // dedupe ในไฟล์ — คู่ (sku, usage_ref) ซ้ำใน upsert ก้อนเดียวทำให้ Postgres error 21000
    const key = `${row.sku}|${row.usage_ref}`;
    if (seen.has(key)) { dupInFile++; continue; }
    seen.add(key);
    rows.push(row);
  }

  return { rows, totalDataRows: dataRows.length, skippedNoSku, skippedEmpty, dupInFile };
}

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
}

export function DrugLabelPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport }: Props) {
  const [settings,       setSettings]       = useState<ShopSettings | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<BranchId>('hq');
  const [lang,           setLang]           = useState<Lang>('th');
  const [searchInput,    setSearchInput]    = useState('');
  const [lastQuery,      setLastQuery]      = useState('');
  const [results,        setResults]        = useState<Medicine[]>([]);
  const [selected,       setSelected]       = useState<Medicine | null>(null);
  const [patientName,    setPatientName]    = useState('');
  const [loading,        setLoading]        = useState(false);
  const [searched,       setSearched]       = useState(false);
  const [error,          setError]          = useState<string | null>(null);

  // Add medicine modal
  const [showAddModal,   setShowAddModal]   = useState(false);
  const [addFormLang,    setAddFormLang]    = useState<Lang>('th');
  const [addForm,        setAddForm]        = useState<AddForm>(emptyForm);
  const [addSaving,      setAddSaving]      = useState(false);
  const [addError,       setAddError]       = useState('');
  const [translating,    setTranslating]    = useState(false);
  const [translateError, setTranslateError] = useState('');
  const [showEditModal,   setShowEditModal]   = useState(false);
  const [editFormLang,    setEditFormLang]    = useState<Lang>('th');
  const [editForm,        setEditForm]        = useState<AddForm>(emptyForm);
  const [editSaving,      setEditSaving]      = useState(false);
  const [editLoading,     setEditLoading]     = useState(false);
  const [editError,       setEditError]       = useState('');
  const [editTranslating,    setEditTranslating]    = useState(false);
  const [editTranslateError, setEditTranslateError] = useState('');
  const [showDeleteModal,  setShowDeleteModal]  = useState(false);
  const [deletePassword,   setDeletePassword]   = useState('');
  const [deleting,         setDeleting]         = useState(false);
  const [deleteError,      setDeleteError]      = useState('');
  const [isAdminUnlocked,  setIsAdminUnlocked]  = useState(false);
  const [showAdminModal,   setShowAdminModal]   = useState(false);
  const [adminPwInput,     setAdminPwInput]     = useState('');
  const [adminPwError,     setAdminPwError]     = useState('');

  const [importBusy,       setImportBusy]       = useState(false);
  const [importMsg,        setImportMsg]        = useState('');

  const printRootRef    = useRef<HTMLDivElement>(null);
  const overlayDownRef  = useRef(false);
  const importFileRef   = useRef<HTMLInputElement>(null);

  const branch = BRANCH_PROFILES.find((b) => b.id === selectedBranch) ?? BRANCH_PROFILES[0];
  const activeSettings = settings
    ? { ...settings, shop_name_th: branch.shop_name_th, shop_name_en: branch.shop_name_en, phone: branch.phone }
    : null;

  useEffect(() => {
    if (!supabaseLabel) { setError(supabaseLabelError ?? 'Supabase not configured.'); return; }
    supabaseLabel.from(TBL_SETTINGS).select('*').eq('id', 1).single()
      .then(({ data, error: e }) => {
        if (e) { setError(`โหลด settings ไม่ได้: ${e.message}`); return; }
        setSettings(data as ShopSettings);
      });
  }, []);

  useEffect(() => {
    if (lastQuery) void doSearch(lastQuery, lang, selected?.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) {
      if (q.length === 0) { setResults([]); setSearched(false); setSelected(null); }
      return;
    }
    const timer = setTimeout(() => {
      setLastQuery(q);
      void doSearch(q, lang);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  async function loadByIds(ids: string[], searchLang: Lang): Promise<Medicine[]> {
    if (!supabaseLabel || ids.length === 0) return [];
    const { data: meds, error: e1 } = await supabaseLabel.from(TBL_MEDICINES).select('id, sku, barcode').in('id', ids);
    if (e1) throw e1;
    const { data: trs, error: e2 } = await supabaseLabel.from(TBL_TRANSLATIONS)
      .select('medicine_id, trade_name, generic_name, usage, indication, warning, storage')
      .in('medicine_id', ids).eq('lang', searchLang);
    if (e2) throw e2;
    const trMap  = new Map((trs  ?? []).map((t: TrRow) => [t.medicine_id, t]));
    const medMap = new Map((meds ?? []).map((m: MedRow) => [m.id, m]));
    return ids.map(id => { const m = medMap.get(id); return m ? flatMed(m, trMap.get(id) ?? null) : null; })
      .filter((m): m is Medicine => m !== null);
  }

  async function doSearch(q: string, searchLang: Lang, keepId?: string) {
    if (!supabaseLabel) { setError(supabaseLabelError ?? 'Supabase not configured.'); setSearched(true); return; }
    setLoading(true); setError(null); setSearched(true);
    try {
      const [medRes, trRes] = await Promise.all([
        supabaseLabel.from(TBL_MEDICINES).select('id, sku, barcode')
          .or(`sku.eq.${q},barcode.eq.${q},barcode.ilike.%${q}%`).limit(20),
        supabaseLabel.from(TBL_TRANSLATIONS).select('medicine_id')
          .or(`trade_name.ilike.%${q}%,generic_name.ilike.%${q}%`).limit(50),
      ]);
      if (medRes.error) throw medRes.error;
      if (trRes.error) throw trRes.error;
      const medIds = (medRes.data ?? []).map((r: MedRow) => r.id);
      const trIds  = (trRes.data  ?? []).map((r: { medicine_id: string | null }) => r.medicine_id).filter(Boolean) as string[];
      const allIds = Array.from(new Set([...medIds, ...trIds])).slice(0, 30);
      const meds = await loadByIds(allIds, searchLang);
      setResults(meds);
      setSelected(keepId ? (meds.find(m => m.id === keepId) ?? (meds.length === 1 ? meds[0] : null)) : (meds.length === 1 ? meds[0] : null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveMedicine() {
    if (!supabaseLabelWrite) { setAddError('Supabase write client ไม่พร้อม'); return; }
    const sku = addForm.sku.trim();
    if (!sku) { setAddError('กรุณากรอก SKU'); return; }
    setAddSaving(true); setAddError('');
    try {
      const usage_ref = addForm.translations['th'].usage.trim().slice(0, 100);
      const { data: medData, error: medErr } = await supabaseLabelWrite
        .from('medicines')
        .upsert({ sku, usage_ref, barcode: addForm.barcode.trim() || null }, { onConflict: 'sku,usage_ref' })
        .select('id').single();
      if (medErr) throw medErr;

      const medicine_id = medData.id;
      const translations = LANGS
        .map(l => ({ medicine_id, lang: l.code, ...addForm.translations[l.code] }))
        .filter(t => t.trade_name || t.generic_name || t.usage || t.indication || t.warning || t.storage)
        .map(t => ({
          medicine_id: t.medicine_id, lang: t.lang,
          trade_name:   t.trade_name   || null,
          generic_name: t.generic_name || null,
          usage:        t.usage        || null,
          indication:   t.indication   || null,
          warning:      t.warning      || null,
          storage:      t.storage      || null,
        }));

      if (translations.length) {
        const { error: trErr } = await supabaseLabelWrite
          .from('medicine_translations').upsert(translations, { onConflict: 'medicine_id,lang' });
        if (trErr) throw trErr;
      }

      setShowAddModal(false);
      setAddForm(emptyForm());
      if (lastQuery) void doSearch(lastQuery, lang);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as { message?: string })?.message
        ?? JSON.stringify(err);
      setAddError(msg);
    } finally {
      setAddSaving(false);
    }
  }

  async function handleLabelImport(file: File, input: HTMLInputElement) {
    setImportBusy(true);
    setImportMsg('กำลังอ่านไฟล์...');
    try {
      if (!supabaseLabel) throw new Error(supabaseLabelError ?? 'Supabase read client ไม่พร้อม');
      if (!supabaseLabelWrite) throw new Error('Supabase write client ไม่พร้อม');

      // CSV อ่านเป็น text ก่อนเพื่อบังคับ UTF-8 (ไฟล์ TIS-620 ภาษาไทยจะเพี้ยน — ให้บันทึกเป็น .xlsx แทน)
      const wb = file.name.toLowerCase().endsWith('.csv')
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(await file.arrayBuffer());
      const sheetName = wb.SheetNames[0];
      const ws = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!ws) throw new Error('ไม่พบชีทข้อมูลในไฟล์');

      const { rows, totalDataRows, skippedNoSku, skippedEmpty, dupInFile } = parseLabelSheet(ws);
      if (rows.length === 0) throw new Error('ไม่พบแถวที่ใช้ได้ — ตรวจว่าคอลัมน์ A เป็น SKU และมีข้อมูลฉลากในคอลัมน์ D–J');

      // ดึงรายการยาเดิมทั้งหมด — ต้องวนทีละ 1000 เพราะ Supabase จำกัด default 1000 แถวต่อ query
      setImportMsg('กำลังตรวจข้อมูลเดิมในระบบ...');
      const bySku = new Map<string, { id: string; usage_ref: string }[]>();
      let existingRowCount = 0;
      for (let from = 0; ; from += 1000) {
        const { data, error: exErr } = await supabaseLabel
          .from(TBL_MEDICINES).select('id, sku, usage_ref').range(from, from + 999);
        if (exErr) throw new Error(exErr.message);
        const page = (data ?? []) as { id: string; sku: string; usage_ref: string | null }[];
        for (const m of page) {
          const key = String(m.sku);
          const list = bySku.get(key) ?? [];
          list.push({ id: m.id, usage_ref: m.usage_ref ?? '' });
          bySku.set(key, list);
        }
        existingRowCount += page.length;
        if (page.length < 1000) break;
      }

      // จับคู่แถวในไฟล์กับแถวเดิม — unique key ของ medicines คือ (sku, usage_ref) ไม่ใช่ sku เดี่ยวๆ
      //   exact  = ตรงทั้ง sku + usage_ref → ทับคำแปลอย่างเดียว
      //   reuse  = sku เดิมมีแถวเดียวแต่ "วิธีใช้" เปลี่ยน → แก้ usage_ref ของแถวเดิม (ไม่งั้นจะได้แถวใหม่ซ้ำ SKU)
      //   new    = ไม่เคยมี sku นี้ หรือ sku มีหลายแถวแล้วหาที่ตรงไม่ได้ → เพิ่มเป็นวิธีใช้แบบใหม่
      const exactRows: { id: string; row: ImportRow }[] = [];
      const reuseRows: { id: string; row: ImportRow }[] = [];
      const newRows: ImportRow[] = [];
      const claimed = new Set<string>();   // กัน 2 แถวในไฟล์แย่งแถวเดิมใบเดียวกัน
      let newSkuCount = 0;
      for (const r of rows) {
        const list = bySku.get(r.sku);
        if (!list || list.length === 0) { newRows.push(r); newSkuCount++; continue; }
        const exact = list.find(m => m.usage_ref === r.usage_ref && !claimed.has(m.id));
        if (exact) { claimed.add(exact.id); exactRows.push({ id: exact.id, row: r }); continue; }
        if (list.length === 1 && !claimed.has(list[0].id)) {
          claimed.add(list[0].id);
          reuseRows.push({ id: list[0].id, row: r });
          continue;
        }
        newRows.push(r);
      }
      const overwriteCount = exactRows.length + reuseRows.length;

      const sample = rows.slice(0, 3).map(r =>
        `  ${r.sku} · ${r.trade_name || '(ไม่มีชื่อการค้า)'} · ${r.usage.slice(0, 40) || '(ไม่มีวิธีใช้)'}`
      ).join('\n');

      const ok = window.confirm(
        `ไฟล์: ${file.name}\nชีท: ${sheetName}\nอ่านข้อมูลได้ ${totalDataRows.toLocaleString()} แถว (ข้ามแถวหัวคอลัมน์แล้ว)\n\n` +
        `📊 ในระบบตอนนี้: ${bySku.size.toLocaleString()} SKU (${existingRowCount.toLocaleString()} แถวยา)\n\n` +
        `♻️ เขียนทับของเดิม: ${overwriteCount.toLocaleString()} รายการ` +
        (reuseRows.length ? ` (ในนี้ ${reuseRows.length.toLocaleString()} รายการ "วิธีใช้" เปลี่ยนไปจากเดิม)` : '') + `\n` +
        `➕ เพิ่มใหม่: ${newRows.length.toLocaleString()} รายการ` +
        (newRows.length - newSkuCount > 0 ? ` (SKU ใหม่ ${newSkuCount.toLocaleString()} · วิธีใช้แบบใหม่ของ SKU เดิม ${(newRows.length - newSkuCount).toLocaleString()})` : '') + `\n` +
        `⏭️ ข้ามจากไฟล์ — ไม่มี SKU: ${skippedNoSku.toLocaleString()} · ข้อมูลว่าง: ${skippedEmpty.toLocaleString()} · ซ้ำในไฟล์: ${dupInFile.toLocaleString()}\n\n` +
        (sample ? `ตัวอย่าง 3 แถวแรก (SKU · ชื่อการค้า · วิธีใช้):\n${sample}\n\n` : '') +
        `🚨 คำแปลภาษาไทยเดิมของ ${overwriteCount.toLocaleString()} รายการจะถูกทับด้วยข้อมูลในไฟล์ (ภาษาอื่นไม่ถูกแตะ)\n\nยืนยันนำเข้า?`
      );
      if (!ok) { setImportMsg(''); return; }

      const idByRow = new Map<ImportRow, string>();
      exactRows.forEach(e => idByRow.set(e.row, e.id));

      // ขั้น 1 — แก้ usage_ref ของแถวเดิมที่ "วิธีใช้" เปลี่ยน
      // ต้องทำ "ก่อน" insert แถวใหม่ ไม่งั้นแถวใหม่ที่ใช้ usage_ref เดิมจะไปชนแถวนี้ก่อนที่มันจะถูกแก้
      for (let i = 0; i < reuseRows.length; i += IMPORT_CHUNK) {
        const chunk = reuseRows.slice(i, i + IMPORT_CHUNK);
        setImportMsg(`กำลังอัปเดตวิธีใช้ ${Math.min(i + IMPORT_CHUNK, reuseRows.length).toLocaleString()}/${reuseRows.length.toLocaleString()}...`);
        const { error: upErr } = await supabaseLabelWrite
          .from('medicines')
          .upsert(chunk.map(e => ({ id: e.id, sku: e.row.sku, usage_ref: e.row.usage_ref })), { onConflict: 'id' });
        if (upErr) throw new Error(upErr.message);
        chunk.forEach(e => idByRow.set(e.row, e.id));
      }

      // ขั้น 2 — เพิ่มรายการยาใหม่ (ไม่ใส่ barcode ใน payload เพื่อไม่ให้ทับ barcode เดิมเป็น null)
      for (let i = 0; i < newRows.length; i += IMPORT_CHUNK) {
        const chunk = newRows.slice(i, i + IMPORT_CHUNK);
        setImportMsg(`กำลังเพิ่มรายการยา ${Math.min(i + IMPORT_CHUNK, newRows.length).toLocaleString()}/${newRows.length.toLocaleString()}...`);
        const { data, error: medErr } = await supabaseLabelWrite
          .from('medicines')
          .upsert(chunk.map(r => ({ sku: r.sku, usage_ref: r.usage_ref })), { onConflict: 'sku,usage_ref' })
          .select('id, sku, usage_ref');
        if (medErr) throw new Error(medErr.message);
        const idByKey = new Map<string, string>();
        ((data ?? []) as { id: string; sku: string; usage_ref: string | null }[])
          .forEach(m => idByKey.set(`${m.sku}|${m.usage_ref ?? ''}`, m.id));
        chunk.forEach(r => {
          const id = idByKey.get(`${r.sku}|${r.usage_ref}`);
          if (id) idByRow.set(r, id);
        });
      }

      // ขั้น 3 — คำแปลภาษาไทย (ทับของเดิมผ่าน onConflict medicine_id,lang · ภาษาอื่นไม่ถูกแตะ)
      const trPayload = rows.flatMap(r => {
        const medicine_id = idByRow.get(r);
        if (!medicine_id) return [];
        return [{
          medicine_id, lang: 'th',
          trade_name:   r.trade_name   || null,
          generic_name: r.generic_name || null,
          usage:        r.usage        || null,
          indication:   r.indication   || null,
          warning:      r.warning      || null,
          storage:      r.storage      || null,
        }];
      });
      for (let i = 0; i < trPayload.length; i += IMPORT_CHUNK) {
        setImportMsg(`กำลังบันทึกคำแปลไทย ${Math.min(i + IMPORT_CHUNK, trPayload.length).toLocaleString()}/${trPayload.length.toLocaleString()}...`);
        const { error: trErr } = await supabaseLabelWrite
          .from('medicine_translations')
          .upsert(trPayload.slice(i, i + IMPORT_CHUNK), { onConflict: 'medicine_id,lang' });
        if (trErr) throw new Error(trErr.message);
      }

      const missing = rows.length - trPayload.length;
      setImportMsg(
        `✅ เขียนทับ ${overwriteCount.toLocaleString()} · เพิ่มใหม่ ${newRows.length.toLocaleString()} รายการ\n` +
        `ตอนนี้ระบบมีทั้งหมด ${(bySku.size + newSkuCount).toLocaleString()} SKU\n` +
        (skippedNoSku + skippedEmpty + dupInFile > 0
          ? `แถวที่ข้ามจากไฟล์: ไม่มี SKU ${skippedNoSku} · ข้อมูลว่าง ${skippedEmpty} · ซ้ำในไฟล์ ${dupInFile}\n` : '') +
        (missing > 0 ? `⚠️ มี ${missing} แถวที่บันทึกคำแปลไม่ได้ (หา id ของรายการยาไม่เจอ)\n` : '') +
        `ขั้นถัดไป: เปิดแต่ละ SKU → ✏️ แก้ไขข้อมูล → ✨ แปลด้วย AI เพื่อเติมภาษาอื่น`
      );
      if (lastQuery) void doSearch(lastQuery, lang);
    } catch (err: unknown) {
      setImportMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportBusy(false);
      // reset ใน finally เสมอ ไม่งั้นเลือกไฟล์เดิมซ้ำหลัง error จะไม่ทำงาน
      input.value = '';
    }
  }

  async function handleAutoTranslate() {
    const tr = addForm.translations[addFormLang];
    if (!tr.trade_name.trim()) { setTranslateError('กรุณากรอกชื่อการค้าในแท็บที่เลือกก่อน'); return; }
    setTranslating(true); setTranslateError('');
    try {
      const result = await translateMedicineLabel(addFormLang, tr, getTargetLangs(addFormLang));
      setAddForm(f => ({ ...f, translations: { ...f.translations, ...result } }));
    } catch (err: unknown) {
      setTranslateError(err instanceof Error ? err.message : 'แปลภาษาไม่สำเร็จ');
    } finally {
      setTranslating(false);
    }
  }

  async function handleEditAutoTranslate() {
    const tr = editForm.translations[editFormLang];
    if (!tr.trade_name.trim()) { setEditTranslateError('กรุณากรอกชื่อการค้าในแท็บที่เลือกก่อน'); return; }
    const missingLangs = LANGS
      .filter(l => l.code !== editFormLang)
      .filter(l => {
        const t = editForm.translations[l.code];
        return !t.trade_name && !t.generic_name && !t.usage && !t.indication && !t.warning && !t.storage;
      })
      .map(l => l.code as Lang);
    if (missingLangs.length === 0) {
      setEditTranslateError('ทุกภาษามีข้อมูลอยู่แล้ว — แก้ไขแต่ละภาษาได้โดยตรง');
      return;
    }
    setEditTranslating(true); setEditTranslateError('');
    try {
      const result = await translateMedicineLabel(editFormLang, tr, missingLangs);
      setEditForm(f => ({ ...f, translations: { ...f.translations, ...result } }));
    } catch (err: unknown) {
      setEditTranslateError(err instanceof Error ? err.message : 'แปลภาษาไม่สำเร็จ');
    } finally {
      setEditTranslating(false);
    }
  }

  async function handleOpenEditModal() {
    if (!selected) return;
    if (!supabaseLabel) { setError(supabaseLabelError ?? 'Supabase read client ไม่พร้อม'); return; }
    setShowEditModal(true);
    setEditLoading(true);
    setEditError('');
    setEditFormLang(lang);
    try {
      const [medRes, trRes] = await Promise.all([
        supabaseLabel
          .from(TBL_MEDICINES)
          .select('sku, barcode')
          .eq('id', selected.id)
          .single(),
        supabaseLabel
          .from(TBL_TRANSLATIONS)
          .select('lang, trade_name, generic_name, usage, indication, warning, storage')
          .eq('medicine_id', selected.id),
      ]);
      if (medRes.error) throw medRes.error;
      if (trRes.error) throw trRes.error;

      const form = emptyForm();
      form.sku = medRes.data.sku ?? selected.sku;
      form.barcode = medRes.data.barcode ?? selected.barcode ?? '';
      for (const row of trRes.data ?? []) {
        const rowLang = row.lang as Lang;
        if (!LANGS.some((l) => l.code === rowLang)) continue;
        form.translations[rowLang] = {
          trade_name: row.trade_name ?? '',
          generic_name: row.generic_name ?? '',
          usage: row.usage ?? '',
          indication: row.indication ?? '',
          warning: row.warning ?? '',
          storage: row.storage ?? '',
        };
      }
      setEditForm(form);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'โหลดข้อมูลสำหรับแก้ไขไม่สำเร็จ';
      setEditError(msg);
    } finally {
      setEditLoading(false);
    }
  }

  async function handleUpdateMedicine() {
    if (!selected) { setEditError('ไม่พบรายการที่ต้องการแก้ไข'); return; }
    if (!supabaseLabelWrite) { setEditError('Supabase write client ไม่พร้อม'); return; }
    const sku = editForm.sku.trim();
    if (!sku) { setEditError('กรุณากรอก SKU'); return; }
    setEditSaving(true);
    setEditError('');
    try {
      const usage_ref = editForm.translations['th'].usage.trim().slice(0, 100);
      const { error: medErr } = await supabaseLabelWrite
        .from('medicines')
        .update({ sku, barcode: editForm.barcode.trim() || null, usage_ref })
        .eq('id', selected.id);
      if (medErr) throw medErr;

      const translations = LANGS.map((l) => {
        const t = editForm.translations[l.code];
        return {
          medicine_id: selected.id,
          lang: l.code,
          trade_name: t.trade_name || null,
          generic_name: t.generic_name || null,
          usage: t.usage || null,
          indication: t.indication || null,
          warning: t.warning || null,
          storage: t.storage || null,
        };
      });

      const { error: trErr } = await supabaseLabelWrite
        .from('medicine_translations')
        .upsert(translations, { onConflict: 'medicine_id,lang' });
      if (trErr) throw trErr;

      setShowEditModal(false);
      if (lastQuery) {
        await doSearch(lastQuery, lang, selected.id);
      } else {
        await doSearch(sku, lang, selected.id);
        setLastQuery(sku);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as { message?: string })?.message
        ?? JSON.stringify(err);
      setEditError(msg);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteMedicine() {
    if (!selected) return;
    if (!supabaseLabelWrite) { setDeleteError('Supabase write client ไม่พร้อม'); return; }
    if (deletePassword !== (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) {
      setDeleteError('รหัส Admin ไม่ถูกต้อง'); return;
    }
    setDeleting(true); setDeleteError('');
    try {
      const { error: trErr } = await supabaseLabelWrite
        .from('medicine_translations').delete().eq('medicine_id', selected.id);
      if (trErr) throw trErr;
      const { error: medErr } = await supabaseLabelWrite
        .from('medicines').delete().eq('id', selected.id);
      if (medErr) throw medErr;
      setShowDeleteModal(false);
      setSelected(null);
      setResults(prev => prev.filter(m => m.id !== selected.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message
        : (err as { message?: string })?.message
        ?? JSON.stringify(err);
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  }

  function setEditTrField(trgLang: Lang, field: keyof TrForm, value: string) {
    setEditForm((f) => ({
      ...f,
      translations: {
        ...f.translations,
        [trgLang]: { ...f.translations[trgLang], [field]: value },
      },
    }));
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setLastQuery(q);
    void doSearch(q, lang);
  }

  function handlePrint() {
    if (!selected || !activeSettings || !printRootRef.current) return;
    const labelMarkup = printRootRef.current.innerHTML;
    const headMarkup  = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(n => n.outerHTML).join('\n');
    const win = window.open('', '_blank', 'width=800,height=600,left=-1000,top=-1000');
    if (!win) { setError('ไม่สามารถเปิดหน้าต่างพิมพ์ได้ — กรุณาอนุญาต pop-ups'); return; }
    win.document.open();
    win.document.write(`<!doctype html><html lang="th"><head>
      <meta charset="UTF-8"/><title>Print Label</title>${headMarkup}
      <style>
        @page { size: 95mm 65mm; margin: 0; }
        html,body { margin:0;padding:0;width:95mm;height:65mm;overflow:hidden;background:#fff; }
        body { display:flex;align-items:flex-start;justify-content:flex-start; }
        .dl-label-print-root { display:block!important;width:95mm;height:65mm;margin:0;padding:0;overflow:hidden; }
        .dl-label { margin:0!important;border:none!important;box-shadow:none!important; }
      </style>
    </head><body><div class="dl-label-print-root">${labelMarkup}</div></body></html>`);
    win.document.close(); win.focus();
    const runPrint = () => { win.print(); win.close(); };
    if (win.document.readyState === 'complete') setTimeout(runPrint, 150);
    else win.addEventListener('load', () => setTimeout(runPrint, 150), { once: true });
  }

  function setTrField(lang: Lang, field: keyof TrForm, value: string) {
    setAddForm(f => ({ ...f, translations: { ...f.translations, [lang]: { ...f.translations[lang], [field]: value } } }));
  }

  return (
    <>
      {/* Hero Header */}
      <div className="hero-header dl-hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="DRUG LABEL" /></h1>
          <div className="tagline-row">
            {BRANCH_PROFILES.map(b => (
              <button key={b.id} className={`dl-branch-btn${selectedBranch === b.id ? ' active' : ''}`}
                onClick={() => setSelectedBranch(b.id)} type="button">{b.shop_name_th}</button>
            ))}
          </div>
          <PageNavRow current="druglabel" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport }} />
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="dl-page">
        <div className="table-search-row">
          <form className="search-premium" onSubmit={handleSearch}>
            <input className="search-input-premium" type="text" autoFocus
              placeholder="ค้นหา SKU / บาร์โค้ด / ชื่อยา"
              value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            <button className="search-btn-premium" type="submit" disabled={loading}>{loading ? '...' : <SearchIcon />}</button>
          </form>
        </div>
        <div className="dl-main">
        <section className="dl-results-panel">
          <div className="dl-upload-row">
            <button className="dl-upload-btn" type="button" onClick={() => { setAddForm(emptyForm()); setAddError(''); setShowAddModal(true); }}>
              ➕ เพิ่มฉลากยาใหม่
            </button>
            {isAdminUnlocked && (
              <>
                <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleLabelImport(f, e.target); }} />
                <button className="dl-upload-btn" type="button" disabled={importBusy}
                  onClick={() => importFileRef.current?.click()}>
                  {importBusy ? 'กำลังนำเข้า...' : '📤 อัปโหลดฉลากยา (XLSX/CSV)'}
                </button>
              </>
            )}
          </div>
          {importMsg && <div className="dl-upload-msg" style={{ whiteSpace: 'pre-line', padding: '0 0 0.75rem' }}>{importMsg}</div>}
          {error   && <div className="dl-error-line">{error}</div>}
          {loading && <div className="dl-status-line">กำลังค้นหา...</div>}
          {!loading && !searched && <div className="dl-status-line">สแกนบาร์โค้ด หรือค้นหาด้วย SKU / ชื่อยา</div>}
          {!loading && searched && results.length === 0 && !error && (
            <div className="dl-status-line">ไม่พบรายการ — ลองใช้ชื่ออื่น</div>
          )}
          <DLResultList results={results} selectedId={selected?.id ?? null} onSelect={setSelected} />
        </section>

        <aside className="dl-preview-panel">
          <div className="dl-preview-panel-header">
            <span>Preview ฉลากยา · 90×65 mm</span>
            <button
              className={`dl-admin-lock-btn${isAdminUnlocked ? ' unlocked' : ''}`}
              type="button"
              title={isAdminUnlocked ? 'Admin (ล็อก)' : 'Admin'}
              onClick={() => {
                if (isAdminUnlocked) { setIsAdminUnlocked(false); }
                else { setAdminPwInput(''); setAdminPwError(''); setShowAdminModal(true); }
              }}>
              {isAdminUnlocked ? '🔓' : '🔐'}
            </button>
            <div className="dl-lang-selector">
              {LANGS.map(({ code, label }) => (
                <button key={code} className={`dl-lang-btn${lang === code ? ' active' : ''}`}
                  onClick={() => setLang(code)} type="button">{label}</button>
              ))}
            </div>
          </div>
          <div className="dl-patient-input-wrap">
            <label htmlFor="patient-name">ชื่อลูกค้า</label>
            <input id="patient-name" className="dl-patient-input" type="text"
              placeholder="ระบุชื่อลูกค้า (ถ้ามี)" value={patientName}
              onChange={e => setPatientName(e.target.value)} />
          </div>
          {selected && activeSettings ? (
            <>
              <div className="dl-preview-frame">
                <Label medicine={selected} settings={activeSettings} lang={lang} patientName={patientName || undefined} preview />
              </div>
              <div className="dl-print-actions">
                <button className="dl-btn-print" onClick={handlePrint} type="button">🖨️ พิมพ์ฉลากยา</button>
                <button className="dl-btn-edit" onClick={handleOpenEditModal} type="button">✏️ แก้ไขข้อมูล</button>
                {isAdminUnlocked && (
                  <button className="dl-btn-delete" onClick={() => { setDeletePassword(''); setDeleteError(''); setShowDeleteModal(true); }} type="button">🗑️ ลบ</button>
                )}
              </div>
            </>
          ) : (
            <div className="dl-empty-preview">เลือกรายการเพื่อดูตัวอย่างฉลาก</div>
          )}
        </aside>
      </div>

      {/* Hidden print root */}
      {selected && activeSettings && (
        <div ref={printRootRef} className="dl-label-print-root">
          <Label medicine={selected} settings={activeSettings} lang={lang} patientName={patientName || undefined} />
        </div>
      )}
      </div>

      {/* Add Medicine Modal */}
      {showAddModal && (
        <div className="dl-modal-overlay"
          onMouseDown={e => { overlayDownRef.current = e.target === e.currentTarget; }}
          onClick={() => { if (overlayDownRef.current) setShowAddModal(false); }}>
          <div className="dl-modal">
            <div className="dl-modal-header">
              <span>➕ เพิ่มฉลากยาใหม่</span>
              <button className="dl-modal-close" onClick={() => setShowAddModal(false)} type="button">✕</button>
            </div>

            <div className="dl-modal-body">
              {/* SKU + Barcode */}
              <div className="dl-add-row">
                <div className="dl-add-field">
                  <label>SKU <span className="dl-add-required">*</span></label>
                  <input className="dl-add-input" type="text"
                    value={addForm.sku} onChange={e => setAddForm(f => ({ ...f, sku: e.target.value }))} />
                </div>
              </div>

              {/* Language tabs + auto-translate */}
              <div className="dl-add-lang-tabs-row">
                <div className="dl-add-lang-tabs">
                  {LANGS.map(l => {
                    const hasFill = l.code !== 'th' && Object.values(addForm.translations[l.code]).some(v => v.trim() !== '');
                    return (
                      <button key={l.code} type="button"
                        className={`dl-add-lang-tab${addFormLang === l.code ? ' active' : ''}`}
                        onClick={() => setAddFormLang(l.code)}>
                        {l.label}
                        {hasFill && <span className="dl-lang-dot" />}
                      </button>
                    );
                  })}
                </div>
                <button className="dl-translate-btn" type="button"
                  disabled={translating} onClick={handleAutoTranslate}>
                  {translating ? '⏳ กำลังแปล...' : '✨ แปลด้วย AI'}
                </button>
              </div>
              {translateError && <div className="dl-add-error">{translateError}</div>}

              {/* Per-language fields */}
              {LANGS.filter(l => l.code === addFormLang).map(l => (
                <div key={l.code} className="dl-add-lang-fields">
                  {([
                    ['trade_name',   'ชื่อการค้า / Name'],
                    ['generic_name', 'ชื่อยา / Generic Name'],
                    ['usage',        'วิธีใช้ / Administration'],
                    ['indication',   'ข้อบ่งใช้ / Indication'],
                    ['warning',      'ข้อควรระวัง / Warning'],
                    ['storage',      'การเก็บรักษา / Storage'],
                  ] as [keyof TrForm, string][]).map(([field, label]) => (
                    <div key={field} className="dl-add-field">
                      <label>{label}</label>
                      <textarea className="dl-add-textarea" rows={field === 'trade_name' || field === 'generic_name' ? 1 : 2}
                        value={addForm.translations[l.code][field]}
                        onChange={e => setTrField(l.code, field, e.target.value)} />
                    </div>
                  ))}
                </div>
              ))}

              {addError && <div className="dl-add-error">{addError}</div>}
            </div>

            <div className="dl-modal-footer">
              <button className="dl-btn-cancel" type="button" onClick={() => setShowAddModal(false)}>ยกเลิก</button>
              <button className="dl-btn-save" type="button" disabled={addSaving} onClick={handleSaveMedicine}>
                {addSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Medicine Modal */}
      {showEditModal && (
        <div className="dl-modal-overlay"
          onMouseDown={e => { overlayDownRef.current = e.target === e.currentTarget; }}
          onClick={() => { if (overlayDownRef.current) setShowEditModal(false); }}>
          <div className="dl-modal">
            <div className="dl-modal-header">
              <span>✏️ แก้ไขข้อมูลฉลากยา</span>
              <button className="dl-modal-close" onClick={() => setShowEditModal(false)} type="button">✕</button>
            </div>
            <div className="dl-modal-body">
              {editLoading ? (
                <div className="dl-status-line">กำลังโหลดข้อมูล...</div>
              ) : (
                <>
                  <div className="dl-add-row">
                    <div className="dl-add-field">
                      <label>SKU <span className="dl-add-required">*</span></label>
                      <input className="dl-add-input" type="text" placeholder="รหัสสินค้า"
                        value={editForm.sku} onChange={e => setEditForm(f => ({ ...f, sku: e.target.value }))} />
                    </div>
                    <div className="dl-add-field">
                      <label>Barcode</label>
                      <input className="dl-add-input" type="text" placeholder="บาร์โค้ด (ถ้ามี)"
                        value={editForm.barcode} onChange={e => setEditForm(f => ({ ...f, barcode: e.target.value }))} />
                    </div>
                  </div>

                  <div className="dl-add-lang-tabs-row">
                    <div className="dl-add-lang-tabs">
                      {LANGS.map(l => {
                        const t = editForm.translations[l.code];
                        const isEmpty = !t.trade_name && !t.generic_name && !t.usage && !t.indication && !t.warning && !t.storage;
                        return (
                          <button key={l.code} type="button"
                            className={`dl-add-lang-tab${editFormLang === l.code ? ' active' : ''}`}
                            onClick={() => setEditFormLang(l.code)}>
                            {l.label}
                            {isEmpty && l.code !== editFormLang && <span className="dl-lang-dot dl-lang-dot--missing" />}
                            {!isEmpty && <span className="dl-lang-dot" />}
                          </button>
                        );
                      })}
                    </div>
                    <button className="dl-translate-btn" type="button"
                      disabled={editTranslating} onClick={handleEditAutoTranslate}>
                      {editTranslating ? '⏳ กำลังแปล...' : '✨ แปลด้วย AI'}
                    </button>
                  </div>
                  {editTranslateError && <div className="dl-add-error">{editTranslateError}</div>}

                  {LANGS.filter(l => l.code === editFormLang).map(l => (
                    <div key={l.code} className="dl-add-lang-fields">
                      {([
                        ['trade_name',   'ชื่อการค้า / Name'],
                        ['generic_name', 'ชื่อยา / Generic Name'],
                        ['usage',        'วิธีใช้ / Administration'],
                        ['indication',   'ข้อบ่งใช้ / Indication'],
                        ['warning',      'ข้อควรระวัง / Warning'],
                        ['storage',      'การเก็บรักษา / Storage'],
                      ] as [keyof TrForm, string][]).map(([field, label]) => (
                        <div key={field} className="dl-add-field">
                          <label>{label}</label>
                          <textarea className="dl-add-textarea" rows={field === 'trade_name' || field === 'generic_name' ? 1 : 2}
                            placeholder={label}
                            value={editForm.translations[l.code][field]}
                            onChange={e => setEditTrField(l.code, field, e.target.value)} />
                        </div>
                      ))}
                    </div>
                  ))}
                  {editError && <div className="dl-add-error">{editError}</div>}
                </>
              )}
            </div>
            <div className="dl-modal-footer">
              <button className="dl-btn-cancel" type="button" onClick={() => setShowEditModal(false)}>ยกเลิก</button>
              <button className="dl-btn-save" type="button" disabled={editSaving || editLoading} onClick={handleUpdateMedicine}>
                {editSaving ? 'กำลังบันทึก...' : '💾 บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Admin Unlock Modal */}
      {showAdminModal && (
        <div className="dl-modal-overlay"
          onMouseDown={e => { overlayDownRef.current = e.target === e.currentTarget; }}
          onClick={() => { if (overlayDownRef.current) setShowAdminModal(false); }}>
          <div className="dl-modal dl-modal-sm">
            <div className="dl-modal-header">
              <span>🔐 Admin</span>
              <button className="dl-modal-close" onClick={() => setShowAdminModal(false)} type="button">✕</button>
            </div>
            <div className="dl-modal-body">
              <div className="dl-add-field">
                <label>รหัส Admin</label>
                <input className="dl-add-input" type="password" placeholder="ใส่รหัส Admin"
                  value={adminPwInput}
                  onChange={e => { setAdminPwInput(e.target.value); setAdminPwError(''); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (adminPwInput === (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) {
                        setIsAdminUnlocked(true); setShowAdminModal(false);
                      } else { setAdminPwError('รหัสไม่ถูกต้อง'); }
                    }
                  }}
                  autoFocus />
              </div>
              {adminPwError && <div className="dl-add-error">{adminPwError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="dl-btn-cancel" type="button" onClick={() => setShowAdminModal(false)}>ยกเลิก</button>
              <button className="dl-btn-save" type="button" onClick={() => {
                if (adminPwInput === (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) {
                  setIsAdminUnlocked(true); setShowAdminModal(false);
                } else { setAdminPwError('รหัสไม่ถูกต้อง'); }
              }}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Medicine Modal */}
      {showDeleteModal && selected && (
        <div className="dl-modal-overlay"
          onMouseDown={e => { overlayDownRef.current = e.target === e.currentTarget; }}
          onClick={() => { if (overlayDownRef.current) setShowDeleteModal(false); }}>
          <div className="dl-modal dl-modal-sm">
            <div className="dl-modal-header">
              <span>🗑️ ลบ SKU: {selected.sku}</span>
              <button className="dl-modal-close" onClick={() => setShowDeleteModal(false)} type="button">✕</button>
            </div>
            <div className="dl-modal-body">
              <p className="dl-delete-warn">⚠️ ลบ SKU และข้อมูลทุกภาษาออกถาวร ไม่สามารถกู้คืนได้</p>
              <div className="dl-add-field">
                <label>รหัส Admin</label>
                <input className="dl-add-input" type="password" placeholder="ใส่รหัส Admin"
                  value={deletePassword}
                  onChange={e => { setDeletePassword(e.target.value); setDeleteError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') void handleDeleteMedicine(); }}
                  autoFocus />
              </div>
              {deleteError && <div className="dl-add-error">{deleteError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="dl-btn-cancel" type="button" onClick={() => setShowDeleteModal(false)}>ยกเลิก</button>
              <button className="dl-btn-delete-confirm" type="button"
                disabled={deleting || !deletePassword} onClick={handleDeleteMedicine}>
                {deleting ? 'กำลังลบ...' : '🗑️ ยืนยันลบ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
