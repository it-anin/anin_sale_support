import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import * as XLSX from 'xlsx';
import { AnimatedLogoText } from '../AnimatedLogo';
import { PageNavRow, type NavHandlers } from '../pageAccess';
import { supabase } from '../supabase';
import { loadProductMaster } from './productMaster';
import {
  buildPosText, cellText, compareSheets, filterRows, findMissingMasterUnits, formatPrice, posExportRows, priceAtLevel,
  PRICE_LEVELS, reportRows, resolveMasterColumns, type CompareFilter, type ComparisonResult, type ComparisonRow, type MissingMasterUnit,
  type ExportOptions, type PriceLevel, type SheetRows,
} from './engine';
import './EditPricePage.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';

type FileKind = 'master' | 'promaxx';
type ExportScope = 'selected' | 'filtered' | 'base' | 'unit';
interface UploadedSheet { name: string; rows: SheetRows; count: number }
interface ExportEntry { filename: string; count: number; time: string }
const CHECKLIST_KEY = 'price-compare-row-checklist';
const FILTERS: { id: CompareFilter; label: string }[] = [
  { id: 'mismatch', label: 'ไม่ตรง' }, { id: 'all', label: 'ทั้งหมด' },
  { id: 'matched', label: 'ตรง' }, { id: 'notfound', label: 'ไม่พบ' },
];

const ICONS = {
  tag: <><path d="M20 13 13 20a2 2 0 0 1-3 0L3 13V3h10l7 7a2 2 0 0 1 0 3Z" /><circle cx="8" cy="8" r="1" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 12h8M8 16h8" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  arrow: <path d="M4 12h16m-5-5 5 5-5 5" />,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg className="ep-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

function loadChecklist(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CHECKLIST_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
  } catch { return new Set(); }
}

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function FileUploadZone({ file, loading, disabled, error, onFile }: {
  file: UploadedSheet | null; loading: boolean; disabled: boolean; error: string;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = loading || disabled;
  const title = 'R05.105';
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy && event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]);
  };
  return (
    <div className={`ep-upload${dragging ? ' ep-upload--dragging' : ''}${file ? ' ep-upload--ready' : ''}`} aria-busy={loading}
      onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)} onDrop={drop}>
      <div className="ep-source-heading"><span className="ep-source-icon"><Icon name="file" /></span>
        <div><h3>{title}</h3><p>ไฟล์ราคาและทุนเดิม</p></div>
        {file && <span className="ep-source-ready" title="อ่านไฟล์เรียบร้อย"><Icon name="check" /></span>}
      </div>
      <div className="ep-file-detail" aria-live="polite">
        {loading ? <strong>กำลังอ่านไฟล์…</strong> : file ? <><strong>{file.name}</strong><span>{file.count.toLocaleString()} แถวข้อมูล</span></> : <><strong>เลือกไฟล์หรือลากมาวางที่นี่</strong><span>.xlsx / .xls / .csv</span></>}
      </div>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" aria-label={`อัปโหลด ${title}`}
        onChange={pick} disabled={busy} hidden />
      <button type="button" className="ep-button ep-button--secondary" disabled={busy} onClick={() => input.current?.click()}>
        <Icon name="upload" />
        {file ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'} {title}
      </button>
      {error && <p className="ep-error" role="alert">{error}</p>}
    </div>
  );
}

function ProductMasterSource({ file, loading, disabled, error, onReload }: {
  file: UploadedSheet | null; loading: boolean; disabled: boolean; error: string; onReload: () => void;
}) {
  return <div className={`ep-upload${file ? ' ep-upload--ready' : ''}`} aria-busy={loading}>
    <div className="ep-source-heading"><span className="ep-source-icon"><Icon name="file" /></span>
      <div><h3>Product Master</h3><p>ข้อมูลร่วมจาก SaleSupport</p></div>
      {file && <span className="ep-source-ready" title="โหลดข้อมูลเรียบร้อย"><Icon name="check" /></span>}
    </div>
    <div className="ep-file-detail" aria-live="polite">
      {loading ? <strong>กำลังโหลด Product Master…</strong> : file
        ? <><strong>{file.count.toLocaleString()} รายการสินค้า</strong><span>ใช้ข้อมูลเดียวกับการอัปโหลดใน SaleSupport</span></>
        : <strong>ยังไม่มีข้อมูลสำหรับเปรียบเทียบ</strong>}
    </div>
    <button type="button" className="ep-button ep-button--secondary" disabled={loading || disabled} onClick={onReload}><Icon name="refresh" />โหลดข้อมูลล่าสุด</button>
    {error && <p className="ep-error" role="alert">{error}</p>}
  </div>;
}

function ComparisonTable({ rows, checked, selected, exportRowIds, onCheck, onSelect, onSelectExportRow }: {
  rows: ComparisonRow[]; checked: Set<string>; selected: Set<string>; exportRowIds: Set<string>;
  onCheck: (id: string) => void; onSelect: (id: string) => void; onSelectExportRow: (id: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const rowHeight = 48;
  const start = Math.max(0, Math.floor((scrollTop - 44) / rowHeight) - 6);
  const end = Math.min(rows.length, start + 28);
  useEffect(() => {
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [rows]);
  if (rows.length === 0) return <div className="ep-empty">ไม่พบรายการตามตัวกรองและคำค้นปัจจุบัน</div>;
  return (
    <div className="ep-table-scroll" ref={viewport} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      tabIndex={0} role="region" aria-label="ตารางเปรียบเทียบราคา เลื่อนเพื่อดูรายการเพิ่มเติม">
      <table className="ep-table" aria-label="ผลเปรียบเทียบราคา" aria-rowcount={rows.length + 1}>
        <thead><tr>
          <th scope="col">ตรวจแล้ว</th><th scope="col">เลือกหน่วย</th><th scope="col">SKU</th><th scope="col" className="ep-name">ชื่อสินค้า</th><th scope="col">หน่วย</th>
          <th scope="col">ทุนเก่า</th><th scope="col">ทุนใหม่</th>
          {([0, 1, 5] as const).map(level => <th scope="col" key={level} colSpan={2}>ระดับ {level} · เก่า / ใหม่</th>)}
        </tr></thead>
        <tbody>
          {start > 0 && <tr aria-hidden="true" className="ep-spacer"><td colSpan={13} style={{ height: start * rowHeight }} /></tr>}
          {rows.slice(start, end).map((row, index) => (
            <tr key={row.id} aria-rowindex={start + index + 2}
              className={`${selected.has(row.id) ? 'ep-row--selected' : ''}${exportRowIds.has(row.id) ? ' ep-row--export' : ''}`}
              tabIndex={0} onClick={() => onSelect(row.id)} onKeyDown={event => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onSelect(row.id);
                }
              }}>
              <td onClick={event => event.stopPropagation()}><input type="checkbox" checked={checked.has(row.id)}
                aria-label={`ตรวจแล้ว ${row.sku} ${row.unit}`} onChange={() => onCheck(row.id)} /></td>
              <td onClick={event => event.stopPropagation()}><input type="checkbox" checked={exportRowIds.has(row.id)}
                aria-label={`เลือกสำหรับ TXT ${row.sku} ${row.unit}`} onChange={() => onSelectExportRow(row.id)} /></td>
              <td>{row.sku}</td><td className="ep-name" title={row.name}>{row.name}</td><td title={row.unit}>{row.unit}</td>
              <td className="ep-old">{formatPrice(row.oldCost)}</td><td className="ep-new">{formatPrice(row.newCost)}</td>
              {([0, 1, 5] as const).map(level => <PriceCells key={level} row={row} level={level} />)}
            </tr>
          ))}
          {end < rows.length && <tr aria-hidden="true" className="ep-spacer"><td colSpan={13} style={{ height: (rows.length - end) * rowHeight }} /></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PriceCells({ row, level }: { row: ComparisonRow; level: 0 | 1 | 5 }) {
  return <><td className="ep-old">{formatPrice(row.oldPrices[level])}</td><td className="ep-new">{formatPrice(row.newPrices[level])}</td></>;
}

function MissingUnitRows({ rows }: { rows: MissingMasterUnit[] }) {
  return <>
    <div className="ep-missing-unit-list" tabIndex={0} role="region" aria-label="รายการที่ไม่มีหน่วย เลื่อนเพื่อดูเพิ่มเติม"><table className="ep-mini-table" aria-label="รายการที่ไม่มีหน่วยในคอลัมน์ PURCHASE_UNIT">
      <thead><tr><th>SKU</th><th>ชื่อสินค้า</th></tr></thead>
      <tbody>{rows.slice(0, 100).map((row, index) => <tr key={`${row.sku}:${index}`}><td>{row.sku}</td><td>{row.name || '-'}</td></tr>)}</tbody>
    </table></div>
    {rows.length > 100 && <p className="ep-hint">แสดง 100 รายการแรกจาก {rows.length.toLocaleString()} รายการที่ไม่มีหน่วย</p>}
  </>;
}

function MissingUnitDialog({ rows, canContinue, onCancel, onCompare }: {
  rows: MissingMasterUnit[]; canContinue: boolean; onCancel: () => void; onCompare: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    cancelRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && !previousFocus.matches(':disabled')) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="ep-missing-unit-dialog" role="alertdialog" aria-modal="true"
    aria-labelledby="ep-missing-unit-title" aria-describedby="ep-missing-unit-description"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const elements = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="ep-missing-unit-body">
      <div className="ep-missing-unit-heading">
        <span className="ep-missing-unit-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" /></svg></span>
        <div><h2 id="ep-missing-unit-title">พบรายการที่ไม่มีหน่วยในคอลัมน์ PURCHASE_UNIT</h2><p>Product Master · {rows.length.toLocaleString()} รายการ</p></div>
      </div>
      <p id="ep-missing-unit-description">{canContinue
        ? 'กด “เปรียบเทียบราคา” เพื่อข้ามเฉพาะรายการเหล่านี้และเปรียบเทียบรายการที่มีหน่วยต่อ หรือกด “ยกเลิก” เพื่อแก้ไข Product Master ที่หน้า SaleSupport แล้วโหลดข้อมูลล่าสุด'
        : 'ทุกรายการไม่มีหน่วยในคอลัมน์ PURCHASE_UNIT จึงไม่มีข้อมูลสำหรับเปรียบเทียบ กรุณายกเลิกเพื่อแก้ไข Product Master ที่หน้า SaleSupport แล้วโหลดข้อมูลล่าสุด'}</p>
      <MissingUnitRows rows={rows} />
    </div>
    <div className="ep-missing-unit-actions">
      <button ref={cancelRef} type="button" className="ep-button ep-button--secondary" autoFocus onClick={onCancel}>ยกเลิก</button>
      <button type="button" className="ep-button" disabled={!canContinue} onClick={onCompare}>เปรียบเทียบราคา</button>
    </div>
  </dialog>;
}

export function EditPricePage({ handlers }: { handlers: NavHandlers }) {
  const [files, setFiles] = useState<Record<FileKind, UploadedSheet | null>>({ master: null, promaxx: null });
  const [loading, setLoading] = useState<Record<FileKind, boolean>>({ master: true, promaxx: false });
  const [fileErrors, setFileErrors] = useState({ master: '', promaxx: '' });
  const [masterReload, setMasterReload] = useState(0);
  const fileVersion = useRef(0);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [filter, setFilter] = useState<CompareFilter>('mismatch');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportRowIds, setExportRowIds] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(loadChecklist);
  const [selectedLevel, setSelectedLevel] = useState<PriceLevel>(0);
  const [error, setError] = useState('');
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [exportScope, setExportScope] = useState<ExportScope>('selected');
  const [exportUnit, setExportUnit] = useState('');
  const [missingUnitWarning, setMissingUnitWarning] = useState<{ rows: MissingMasterUnit[]; canContinue: boolean } | null>(null);
  const rows = useMemo(() => result ? filterRows(result, filter, search) : [], [result, filter, search]);
  const allRows = useMemo(() => result ? result.products.flatMap(product => product.rows) : [], [result]);
  const selectedExportRows = useMemo(() => allRows.filter(row => exportRowIds.has(row.id)), [allRows, exportRowIds]);
  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.id)), [rows, selected]);
  const units = useMemo(() => Array.from(new Set(rows.map(row => row.unit))).sort((a, b) => a.localeCompare(b, 'th')), [rows]);
  const busy = loading.master || loading.promaxx || comparing;
  const activeExportUnit = units.includes(exportUnit) ? exportUnit : units[0] ?? '';
  const exportOptions: ExportOptions = exportScope === 'selected' ? { rowIds: exportRowIds }
    : exportScope === 'base' ? { baseUnitOnly: true } : exportScope === 'unit' ? { unit: activeExportUnit } : {};
  const exportSourceRows = exportScope === 'selected' ? allRows : rows;
  const reviewedCount = allRows.filter(row => checked.has(row.id)).length;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(previous => ({ ...previous, master: true }));
    setFiles(previous => ({ ...previous, master: null }));
    setFileErrors(previous => ({ ...previous, master: '' }));
    setResult(null);
    setMissingUnitWarning(null);
    setSelected(new Set());
    setExportRowIds(new Set());
    setError('');
    void loadProductMaster(supabase, controller.signal).then(rows => {
      if (active) setFiles(previous => ({ ...previous, master: { name: 'SaleSupport', rows, count: rows.length - 1 } }));
    }).catch(cause => {
      if (active) setFileErrors(previous => ({ ...previous, master: cause instanceof Error ? cause.message : 'โหลด Product Master ไม่สำเร็จ กรุณาลองอีกครั้ง' }));
    }).finally(() => {
      if (active) setLoading(previous => ({ ...previous, master: false }));
    });
    return () => { active = false; controller.abort(); };
  }, [masterReload]);

  useEffect(() => () => { fileVersion.current++; }, []);

  useEffect(() => {
    try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify([...checked])); } catch { /* ใช้ checklist ต่อได้เมื่อพื้นที่เก็บเต็ม */ }
  }, [checked]);

  async function upload(file: File) {
    const kind = 'promaxx';
    const version = ++fileVersion.current;
    setLoading(previous => ({ ...previous, [kind]: true }));
    setFiles(previous => ({ ...previous, [kind]: null }));
    setFileErrors(previous => ({ ...previous, [kind]: '' }));
    setResult(null);
    setMissingUnitWarning(null);
    setSelected(new Set());
    setExportRowIds(new Set());
    setError('');
    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('กรุณาเลือกไฟล์ .xlsx, .xls หรือ .csv');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('ไฟล์นี้ไม่มีชีตข้อมูล');
      // raw:false คงรูปแบบรหัสสินค้าที่มีเลขศูนย์นำหน้า ส่วนราคาจะแปลงด้วย parseNum
      const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '', raw: false, blankrows: false });
      if (rows.length < 2) throw new Error('ต้องมีหัวตารางและข้อมูลสินค้า กรุณาตรวจชนิดไฟล์');
      if ((rows[0]?.length ?? 0) <= 7) {
        throw new Error('ต้องมีหัวตารางและข้อมูลถึงคอลัมน์ H กรุณาตรวจชนิดไฟล์');
      }
      const count = rows.slice(1).filter(row => row.some(value => cellText(value))).length;
      if (fileVersion.current === version) setFiles(previous => ({ ...previous, [kind]: { name: file.name, rows, count } }));
    } catch (cause) {
      if (fileVersion.current === version) setFileErrors(previous => ({ ...previous, [kind]: cause instanceof Error ? cause.message : 'อ่านไฟล์ไม่สำเร็จ' }));
    } finally {
      if (fileVersion.current === version) setLoading(previous => ({ ...previous, [kind]: false }));
    }
  }

  async function compare(skipMissingUnits = false) {
    if (!files.master || !files.promaxx || busy) return;
    setError('');
    if (!skipMissingUnits) {
      const missing = findMissingMasterUnits(files.master.rows);
      if (missing.length > 0) {
        const columns = resolveMasterColumns(files.master.rows[0]);
        setMissingUnitWarning({
          rows: missing,
          canContinue: files.master.rows.slice(1).some(row => !!cellText(row[columns.SKU]) && !!cellText(row[columns.UNIT])),
        });
        return;
      }
    }
    setMissingUnitWarning(null);
    setComparing(true);
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    try {
      setResult(compareSheets(files.master.rows, files.promaxx.rows, { skipMissingUnits }));
      setFilter('mismatch');
      setSearch('');
      setSelected(new Set());
      setExportRowIds(new Set());
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'เปรียบเทียบไม่สำเร็จ กรุณาตรวจรูปแบบไฟล์');
    } finally { setComparing(false); }
  }

  function toggleCheck(id: string) {
    setChecked(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleSelect(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  }

  function toggleExportRow(id: string) {
    setExportRowIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFilteredExportRows() {
    setExportRowIds(previous => new Set([...previous, ...rows.map(row => row.id)]));
  }

  function recordExport(filename: string, count: number) {
    setError('');
    setExports(previous => [{ filename, count, time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }) }, ...previous].slice(0, 30));
  }

  function exportText(level: PriceLevel, options: ExportOptions = {}, sourceRows = rows) {
    const text = buildPosText(sourceRows, level, options);
    if (!text) { setError('ไม่มีรายการที่มีราคาใหม่สำหรับระดับและหน่วยที่เลือก'); return; }
    const prefix = options.rowIds !== undefined ? 'SELECTED_' : options.baseUnitOnly ? 'BASE_UNIT_' : options.unit === undefined ? '' : options.unit.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + '_';
    const filename = `${prefix}ราคาระดับ ${level}.txt`;
    try {
      saveDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
      recordExport(filename, posExportRows(sourceRows, level, options).length);
    } catch { setError('ดาวน์โหลดไม่สำเร็จ กรุณาลองอีกครั้ง'); }
  }

  function exportExcel() {
    try {
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(reportRows(rows));
      sheet['!cols'] = [{ wch: 16 }, { wch: 44 }, { wch: 14 }, ...Array.from({ length: 8 }, () => ({ wch: 20 }))];
      XLSX.utils.book_append_sheet(workbook, sheet, 'Price Comparison');
      saveDownload(new Blob([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }), 'Price_Comparison_Report.xlsx');
      recordExport('Price_Comparison_Report.xlsx', rows.length);
    } catch { setError('สร้างไฟล์ Excel ไม่สำเร็จ กรุณาลองอีกครั้ง'); }
  }

  const filterCounts: Record<CompareFilter, number> = {
    all: result?.total ?? 0, mismatch: result?.mismatched ?? 0,
    matched: result ? result.matched - result.mismatched : 0, notfound: result?.notFound ?? 0,
  };
  const filterControls = (
    <div className="ep-filters">
      <div className="ep-filter-buttons" aria-label="ตัวกรองผลเปรียบเทียบ">
        {FILTERS.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} disabled={!result}
          aria-label={item.label} className={`ep-filter${filter === item.id ? ' ep-filter--active' : ''}`}
          onClick={() => setFilter(item.id)}>{item.label}<span>{filterCounts[item.id].toLocaleString()}</span></button>)}
      </div>
      <label className="ep-search-wrap"><Icon name="search" /><input className="ep-search" type="search" value={search}
        disabled={!result} onChange={event => setSearch(event.target.value)}
        placeholder="ค้นหา SKU, ชื่อสินค้า หรือหน่วย" aria-label="ค้นหาผลเปรียบเทียบ" /></label>
    </div>
  );

  return (
    <div className="edit-price-page" data-design="14">
      <header className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="EDIT PRICE" /></h1>
          <div className="tagline-row"><p className="tagline">เปรียบเทียบทุนและคำนวณราคาขายใหม่</p></div>
          <PageNavRow current="editprice" handlers={handlers} />
        </div>
      </header>
      <main className="ep-main">
        {error && <div className="ep-error ep-error--banner" role="alert">{error}</div>}

        <section className="ep-sources" aria-label="ข้อมูลสำหรับเปรียบเทียบราคา">
          <div className="ep-upload-grid">
            <ProductMasterSource file={files.master} loading={loading.master} disabled={comparing} error={fileErrors.master}
              onReload={() => setMasterReload(previous => previous + 1)} />
            <FileUploadZone file={files.promaxx} loading={loading.promaxx} disabled={comparing} error={fileErrors.promaxx}
              onFile={file => { void upload(file); }} />
          </div>
          <div className="ep-processing">
            <div role="status"><strong>{comparing ? 'กำลังคำนวณราคา…' : result ? 'คำนวณราคาเรียบร้อย'
              : files.master && files.promaxx ? 'ข้อมูลพร้อมเปรียบเทียบ' : 'เตรียมข้อมูลสำหรับเปรียบเทียบ'}</strong>
              <small>{files.master && files.promaxx
                ? `${files.master.count.toLocaleString()} SKU · ${files.promaxx.count.toLocaleString()} แถว R05.105 · 4 ระดับราคา`
                : 'ใช้ Product Master จาก SaleSupport แล้วเลือกไฟล์ R05.105'}</small></div>
            <button type="button" className="ep-button" disabled={!files.master || !files.promaxx || busy} onClick={() => { void compare(); }}>
              <Icon name="refresh" />{comparing ? 'กำลังเปรียบเทียบ…' : result ? 'คำนวณราคาใหม่' : 'เปรียบเทียบราคา'}
            </button>
          </div>
        </section>
        <details className="ep-format-help"><summary>รูปแบบข้อมูลและไฟล์ที่รองรับ</summary>
          <p><strong>Product Master:</strong> ใช้รหัสสินค้า ชื่อสินค้า หน่วยฐาน หน่วยจัดซื้อ และทุนซื้อจากข้อมูลที่อัปโหลดในหน้า SaleSupport หากแก้ไขข้อมูลแล้วให้กดโหลดข้อมูลล่าสุด</p>
          <p><strong>R05.105:</strong> รองรับ .xlsx / .xls / .csv อ่านเฉพาะชีตแรก แถวแรกเป็นหัวตาราง · B = SKU, E = หน่วย, F = ระดับราคา (0/1/4/5), G = ราคาเก่าระดับ 0, H = ราคาเก่าระดับ 1/5 หรือทุนเก่าระดับ 4</p>
        </details>

        <div className="ep-matrix-header">
          <section className="ep-summary" aria-label="สรุปผลเปรียบเทียบ">
            {([
              ['สินค้าทั้งหมด', result?.total, 'all'], ['ราคาไม่ตรง', result?.mismatched, 'mismatch'],
              ['ราคาตรง', result ? result.matched - result.mismatched : undefined, 'matched'], ['ไม่พบใน R05.105', result?.notFound, 'notfound'],
            ] as const).map(([label, value, kind]) => <div className={`ep-stat ep-stat--${kind}`} key={kind}>
              <span>{label}</span><div><strong>{value === undefined ? '—' : value.toLocaleString()}</strong><small>SKU</small></div>
            </div>)}
          </section>
          <section className="ep-export-panel" aria-label="ส่งออกไฟล์">
            <div className="ep-export-scope"><label><span>ขอบเขตส่งออก TXT</span>
              <select aria-label="ขอบเขตส่งออก TXT" value={exportScope} onChange={event => setExportScope(event.target.value as ExportScope)}>
                <option value="selected">เฉพาะหน่วยที่เลือก</option><option value="filtered">ทั้งหมดตามตัวกรอง</option>
                <option value="base">เฉพาะหน่วยฐาน</option><option value="unit">แยกตามชื่อหน่วย</option>
              </select></label>
              {exportScope === 'unit' && <label><span>หน่วยสินค้า</span><select aria-label="หน่วยสินค้าสำหรับส่งออก TXT"
                value={activeExportUnit} disabled={units.length === 0} onChange={event => setExportUnit(event.target.value)}>
                {units.length === 0 && <option value="">ยังไม่มีหน่วยสินค้า</option>}
                {units.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select></label>}
            </div>
            <div className="ep-export-levels">{PRICE_LEVELS.map(level => {
              const count = posExportRows(exportSourceRows, level, exportOptions).length;
              return <button type="button" className="ep-level-button" key={level} disabled={!result || busy || count === 0}
                aria-label={`ส่งออก TXT ระดับ ${level} (${count.toLocaleString()} รายการ)`}
                onClick={() => exportText(level, exportOptions, exportSourceRows)}>
                <span className="ep-level-number">{level}</span><span className="ep-level-copy">{level === 4 ? 'ทุนใหม่' : `ราคาขายระดับ ${level}`}
                  <small>{count.toLocaleString()} รายการ · .txt</small></span><Icon name="download" />
              </button>;
            })}</div>
            <div className="ep-export-bottom">
              <button type="button" className="ep-button ep-button--secondary ep-excel-button" disabled={!result || busy || rows.length === 0}
                onClick={exportExcel}><Icon name="file" />รายงาน Excel (.xlsx)<Icon name="download" /></button>
              <p><Icon name="info" />{exportScope === 'selected' ? 'TXT ใช้เฉพาะหน่วยที่เลือกไว้ รวมรายการที่ซ่อนด้วยตัวกรอง' : 'TXT ใช้รายการตามตัวกรองและคำค้น'}<br />ส่งออกได้ทั้งทุนเพิ่ม ทุนลด และทุนเท่าเดิม</p>
            </div>
          </section>
        </div>

        <section className="ep-result-panel" aria-label="ผลเปรียบเทียบราคา">
          <div className="ep-panel-heading"><div><h3>ผลเปรียบเทียบราคา</h3><p>{result
            ? `Product Master จาก SaleSupport · ${files.promaxx?.name} · ${result.promaxxRecords.toLocaleString()} แถวราคาเดิม`
            : 'ข้อมูลที่เปรียบเทียบแล้วจะแสดงที่นี่ ราคาเก่าและใหม่อยู่คนละคอลัมน์'}</p></div>
            <span className="ep-table-badge">PRICE MATRIX</span>
          </div>
          {result && result.skippedMissingUnits.length > 0 && <div className="ep-skipped-warning" role="status">
            <strong>ข้าม {result.skippedMissingUnits.length.toLocaleString()} รายการที่ไม่มีหน่วยในคอลัมน์ PURCHASE_UNIT</strong>
            <p>ผลเปรียบเทียบและไฟล์ส่งออกใช้เฉพาะรายการที่มีหน่วย</p>
            <details><summary>ดูรายการที่ข้าม</summary><MissingUnitRows rows={result.skippedMissingUnits} /></details>
          </div>}
          {filterControls}
          <div className="ep-selection-bar"><span className="ep-row-count">{rows.length.toLocaleString()} หน่วย <small>· สถานะนับตาม SKU</small></span>
            <span className="ep-selection-count" role="status">เลือก {selectedExportRows.length.toLocaleString()} หน่วย</span>
            <button type="button" className="ep-text-button" disabled={rows.length === 0} onClick={selectFilteredExportRows}>เลือกตามตัวกรอง</button>
            <button type="button" className="ep-text-button" disabled={exportRowIds.size === 0} onClick={() => setExportRowIds(new Set())}>ล้างที่เลือก</button>
            <span className="ep-review-count">ตรวจแล้ว {reviewedCount.toLocaleString()}/{allRows.length.toLocaleString()}</span>
          </div>
          {result ? <ComparisonTable rows={rows} checked={checked} selected={selected} exportRowIds={exportRowIds}
            onCheck={toggleCheck} onSelect={toggleSelect} onSelectExportRow={toggleExportRow} />
            : <div className="ep-empty ep-welcome"><span className="ep-welcome-icon"><Icon name="tag" /></span>
              <h3>พร้อมตรวจราคา ในพื้นที่เดียว</h3><p>เลือกไฟล์ R05.105 แล้วกดเปรียบเทียบราคา<br />จากนั้นเลือกหน่วยที่ต้องการ และดาวน์โหลดจากแผงด้านบนได้ทันที</p>
              <div className="ep-welcome-steps"><span>01 เตรียมข้อมูล</span><Icon name="arrow" /><span>02 ตรวจราคา</span><Icon name="arrow" /><span>03 ส่งออกไฟล์</span></div>
            </div>}
          <p className="ep-scroll-hint"><Icon name="arrow" />เลื่อนตารางแนวนอนเพื่อดูครบทุกระดับราคา · ตัวเลขเก่าและใหม่อยู่คนละคอลัมน์</p>
          <div className="ep-table-note"><span>เลือกส่งออกและตรวจแล้วแยกกัน · 1 SKU มีหลายหน่วยได้</span><span>คลิกแถวหรือกด Enter / Space เพื่อดูเทียบได้สูงสุด 10 แถว</span></div>

          {selected.size > 0 && <section className="ep-selected" aria-label="รายการที่เลือกดูเทียบ">
            <div className="ep-panel-heading"><h3>Selected Results · เลือก {selected.size}/10 แถว</h3>
              <div className="ep-inline-actions"><label>ระดับราคา <select aria-label="ระดับราคา Selected Results" value={selectedLevel}
                onChange={event => setSelectedLevel(Number(event.target.value) as PriceLevel)}>{PRICE_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}</select></label>
                <button type="button" className="ep-text-button" onClick={() => setSelected(new Set())}>ล้างที่เลือกดูเทียบ</button></div>
            </div>
            {selectedRows.length === 0 ? <p className="ep-hint">แถวที่เลือกถูกซ่อนโดยตัวกรองหรือคำค้นปัจจุบัน</p> : <div className="ep-mini-table-wrap"><table className="ep-mini-table" aria-label="Selected Results">
              <thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th>หน่วย</th><th>ราคาเก่า</th><th>ราคาใหม่</th></tr></thead>
              <tbody>{selectedRows.map(row => <tr key={row.id}><td>{row.sku}</td><td>{row.name}</td><td>{row.unit}</td>
                <td>{formatPrice(priceAtLevel(row, selectedLevel, 'old'))}</td><td className="ep-new">{formatPrice(priceAtLevel(row, selectedLevel, 'new'))}</td></tr>)}</tbody>
            </table></div>}
          </section>}

          {result && <details className="ep-export-preview"><summary>ตัวอย่างรายงาน Excel · 10 แถวแรกตามตัวกรอง</summary>
            {rows.length === 0 ? <p className="ep-hint">ไม่มีข้อมูลตามตัวกรองปัจจุบัน</p> : <div className="ep-mini-table-wrap"><table className="ep-mini-table" aria-label="Export Preview">
              <thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th>หน่วย</th><th>ทุนเก่า</th><th>ทุนใหม่</th><th>ระดับ 0 ใหม่</th><th>ระดับ 1 ใหม่</th><th>ระดับ 5 ใหม่</th></tr></thead>
              <tbody>{rows.slice(0, 10).map(row => <tr key={row.id}><td>{row.sku}</td><td>{row.name}</td><td>{row.unit}</td><td>{formatPrice(row.oldCost)}</td>
                <td>{formatPrice(row.newCost)}</td>{([0, 1, 5] as const).map(level => <td key={level}>{formatPrice(row.newPrices[level])}</td>)}</tr>)}</tbody>
            </table></div>}
          </details>}
        </section>
        <section className="ep-export-log" aria-live="polite"><h3>ประวัติส่งออก</h3>
          {exports.length === 0 ? <p>ยังไม่มีการส่งออกในรอบนี้</p> : <ul>{exports.map((entry, index) => <li key={index}>
            <Icon name="file" /><time>{entry.time}</time><strong>{entry.filename}</strong><span>{entry.count.toLocaleString()} แถว</span>
          </li>)}</ul>}
        </section>
        <footer className="ep-workspace-footer"><span><Icon name="check" />ไฟล์ R05.105 และผลคำนวณอยู่บนเครื่องของคุณ</span><span>TXT · UTF-8 BOM · Tab · CRLF</span></footer>
      </main>
      {missingUnitWarning && <MissingUnitDialog rows={missingUnitWarning.rows} canContinue={missingUnitWarning.canContinue}
        onCancel={() => setMissingUnitWarning(null)} onCompare={() => { void compare(true); }} />}
    </div>
  );
}
