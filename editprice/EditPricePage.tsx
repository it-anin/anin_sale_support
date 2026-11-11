import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import * as XLSX from 'xlsx';
import { AnimatedLogoText } from '../AnimatedLogo';
import { PageNavRow, type NavHandlers } from '../pageAccess';
import {
  buildPosText, cellText, compareSheets, filterRows, findMissingMasterUnits, formatPrice, posExportRows, priceAtLevel,
  PRICE_LEVELS, reportRows, resolveMasterColumns, type CompareFilter, type ComparisonResult, type ComparisonRow, type MissingMasterUnit,
  type ExportOptions, type PriceLevel, type SheetRows,
} from './engine';
import './EditPricePage.css';

type FileKind = 'master' | 'promaxx';
type Step = 'upload' | 'compare' | 'export';
interface UploadedSheet { name: string; rows: SheetRows; count: number }
interface ExportEntry { filename: string; count: number; time: string }
const CHECKLIST_KEY = 'price-compare-row-checklist';
const FILTERS: { id: CompareFilter; label: string }[] = [
  { id: 'mismatch', label: 'ไม่ตรง' }, { id: 'all', label: 'ทั้งหมด' },
  { id: 'matched', label: 'ตรง' }, { id: 'notfound', label: 'ไม่พบ' },
];

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

function FileUploadZone({ kind, file, busy, error, onFile }: {
  kind: FileKind; file: UploadedSheet | null; busy: boolean; error: string;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const title = kind === 'master' ? 'Product Master' : 'R05.105';
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
    <div className={`ep-upload${dragging ? ' ep-upload--dragging' : ''}${file ? ' ep-upload--ready' : ''}`}
      onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)} onDrop={drop}>
      <span className="ep-file-number">ไฟล์ {kind === 'master' ? '1' : '2'}</span>
      <h3>{title}</h3>
      <p>{kind === 'master' ? 'ทุนใหม่จากคอลัมน์ ทุนซื้อ และหน่วยจาก PURCHASE_UNIT' : 'ทุนเก่าและราคาขายระดับ 0 / 1 / 4 / 5'}</p>
      <div className="ep-file-detail" aria-live="polite">
        {busy ? 'กำลังอ่านไฟล์…' : file ? <><strong>{file.name}</strong><span>{file.count.toLocaleString()} แถวข้อมูล</span></> : <><strong>ลากไฟล์มาวางที่นี่</strong><span>รองรับ .xlsx, .xls, .csv · อ่านเฉพาะชีตแรก</span></>}
      </div>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" aria-label={`อัปโหลด ${title}`}
        onChange={pick} disabled={busy} hidden />
      <button type="button" className="ep-button ep-button--secondary" disabled={busy} onClick={() => input.current?.click()}>
        {file ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'} {title}
      </button>
      {error && <p className="ep-error" role="alert">{error}</p>}
    </div>
  );
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
            <tr key={row.id} aria-rowindex={start + index + 2} className={selected.has(row.id) ? 'ep-row--selected' : ''}
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
        ? 'กด “เปรียบเทียบราคา” เพื่อข้ามเฉพาะรายการเหล่านี้และเปรียบเทียบรายการที่มีหน่วยต่อ หรือกด “ยกเลิก” เพื่อกลับไปแก้ไขไฟล์'
        : 'ทุกรายการไม่มีหน่วยในคอลัมน์ PURCHASE_UNIT จึงไม่มีข้อมูลสำหรับเปรียบเทียบ กรุณายกเลิกเพื่อแก้ไขไฟล์ Product Master'}</p>
      <MissingUnitRows rows={rows} />
    </div>
    <div className="ep-missing-unit-actions">
      <button ref={cancelRef} type="button" className="ep-button ep-button--secondary" autoFocus onClick={onCancel}>ยกเลิก</button>
      <button type="button" className="ep-button" disabled={!canContinue} onClick={onCompare}>เปรียบเทียบราคา</button>
    </div>
  </dialog>;
}

export function EditPricePage({ handlers }: { handlers: NavHandlers }) {
  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<Record<FileKind, UploadedSheet | null>>({ master: null, promaxx: null });
  const [loading, setLoading] = useState<Record<FileKind, boolean>>({ master: false, promaxx: false });
  const [fileErrors, setFileErrors] = useState({ master: '', promaxx: '' });
  const versions = useRef({ master: 0, promaxx: 0 });
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [filter, setFilter] = useState<CompareFilter>('mismatch');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportRowIds, setExportRowIds] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(loadChecklist);
  const [selectedLevel, setSelectedLevel] = useState<PriceLevel>(0);
  const [error, setError] = useState('');
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [missingUnitWarning, setMissingUnitWarning] = useState<{ rows: MissingMasterUnit[]; canContinue: boolean } | null>(null);
  const rows = useMemo(() => result ? filterRows(result, filter, search) : [], [result, filter, search]);
  const allRows = useMemo(() => result ? result.products.flatMap(product => product.rows) : [], [result]);
  const selectedExportRows = useMemo(() => allRows.filter(row => exportRowIds.has(row.id)), [allRows, exportRowIds]);
  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.id)), [rows, selected]);
  const units = useMemo(() => Array.from(new Set(rows.map(row => row.unit))).sort((a, b) => a.localeCompare(b, 'th')), [rows]);
  const busy = loading.master || loading.promaxx || comparing;

  useEffect(() => {
    try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify([...checked])); } catch { /* ใช้ checklist ต่อได้เมื่อพื้นที่เก็บเต็ม */ }
  }, [checked]);

  async function upload(kind: FileKind, file: File) {
    const version = ++versions.current[kind];
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
      if (kind === 'master') {
        resolveMasterColumns(rows[0]);
      } else if ((rows[0]?.length ?? 0) <= 7) {
        throw new Error('ต้องมีหัวตารางและข้อมูลถึงคอลัมน์ H กรุณาตรวจชนิดไฟล์');
      }
      const count = rows.slice(1).filter(row => row.some(value => cellText(value))).length;
      if (versions.current[kind] === version) setFiles(previous => ({ ...previous, [kind]: { name: file.name, rows, count } }));
    } catch (cause) {
      if (versions.current[kind] === version) setFileErrors(previous => ({ ...previous, [kind]: cause instanceof Error ? cause.message : 'อ่านไฟล์ไม่สำเร็จ' }));
    } finally {
      if (versions.current[kind] === version) setLoading(previous => ({ ...previous, [kind]: false }));
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
    const start = performance.now();
    try {
      setResult(compareSheets(files.master.rows, files.promaxx.rows, { skipMissingUnits }));
      setElapsed(performance.now() - start);
      setFilter('mismatch');
      setSearch('');
      setSelected(new Set());
      setExportRowIds(new Set());
      setStep('compare');
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

  const filterControls = (
    <div className="ep-filters">
      <div className="ep-filter-buttons" aria-label="ตัวกรองผลเปรียบเทียบ">
        {FILTERS.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id}
          className={`ep-filter${filter === item.id ? ' ep-filter--active' : ''}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      <input className="ep-search" type="search" value={search} onChange={event => setSearch(event.target.value)}
        placeholder="ค้นหา SKU, ชื่อสินค้า หรือหน่วย" aria-label="ค้นหาผลเปรียบเทียบ" />
      <span className="ep-row-count" aria-live="polite">{rows.length.toLocaleString()} แถว</span>
    </div>
  );

  function exportButtons(options: ExportOptions, base = false, sourceRows = rows) {
    return PRICE_LEVELS.map(level => {
      const count = posExportRows(sourceRows, level, options).length;
      return <button type="button" key={level} className={`ep-button${base ? ' ep-button--green' : ''}`}
        disabled={count === 0} onClick={() => exportText(level, options, sourceRows)}>
        ระดับ {level} <span className="ep-button-count">{count.toLocaleString()}</span>
      </button>;
    });
  }

  return (
    <div className="edit-price-page">
      <header className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="Edit Price" /></h1>
          <div className="tagline-row"><p className="tagline">เปรียบเทียบทุนและคำนวณราคาขายใหม่</p></div>
          <PageNavRow current="editprice" handlers={handlers} />
        </div>
      </header>
      <main className="ep-main">
        <nav className="ep-steps" aria-label="ขั้นตอน Edit Price">
          {([{ id: 'upload', label: '1. Data Upload' }, { id: 'compare', label: '2. Compare & Analyze' }, { id: 'export', label: '3. Export' }] as const).map(item => (
            <button type="button" key={item.id} aria-pressed={step === item.id} className={`ep-step${step === item.id ? ' ep-step--active' : ''}`}
              disabled={item.id !== 'upload' && !result} onClick={() => { setStep(item.id); setError(''); }}>{item.label}</button>
          ))}
        </nav>
        {error && <div className="ep-error ep-error--banner" role="alert">{error}</div>}

        {step === 'upload' && <section className="ep-panel" aria-label="อัปโหลดข้อมูลราคา">
          <div className="ep-panel-heading"><div><h2>ข้อมูลสำหรับเปรียบเทียบราคา</h2><p>อัปโหลดสองไฟล์ โดยแถวแรกเป็นหัวตาราง ระบบอ่านและคำนวณบนเครื่องของคุณ</p></div></div>
          <div className="ep-upload-grid">
            {(['master', 'promaxx'] as const).map(kind => <FileUploadZone key={kind} kind={kind} file={files[kind]}
              busy={loading[kind] || comparing} error={fileErrors[kind]} onFile={file => { void upload(kind, file); }} />)}
          </div>
          <details className="ep-format-help"><summary>รูปแบบคอลัมน์ของไฟล์</summary>
            <p><strong>Product Master:</strong> SKU = SKU, ชื่อสินค้า = NAME, หน่วยฐาน = BASE_UNIT, หน่วยทุนใหม่ = PURCHASE_UNIT, ทุนใหม่ = ทุนซื้อ · สลับลำดับคอลัมน์ได้ และไม่แยกตัวพิมพ์เล็ก–ใหญ่</p>
            <p><strong>R05.105:</strong> B = SKU, E = หน่วย, F = ระดับราคา (0/1/4/5), G = ราคาเก่าระดับ 0, H = ราคาเก่าระดับ 1/5 หรือทุนเก่าระดับ 4</p>
          </details>
          <div className="ep-upload-footer"><span>ไฟล์ที่เลือกจะไม่ถูกอัปโหลดไปยังฐานข้อมูล</span>
            <button type="button" className="ep-button" disabled={!files.master || !files.promaxx || busy} onClick={() => { void compare(); }}>
              {comparing ? 'กำลังเปรียบเทียบ…' : 'เปรียบเทียบราคา (Compare Prices)'}
            </button>
          </div>
        </section>}

        {result && step !== 'upload' && <>
          <div className="ep-summary" aria-label="สรุปผลเปรียบเทียบ">
            {[
              ['Total', result.total], ['Matched', result.matched - result.mismatched],
              ['Mismatched', result.mismatched], ['Not Found', result.notFound],
              ['R05.105 Records', result.promaxxRecords], ['Process Time', `${elapsed.toFixed(0)} ms`],
            ].map(([label, value]) => <div className="ep-stat" key={label}><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong></div>)}
          </div>
          <section className="ep-panel">
            <div className="ep-panel-heading"><div><h2>{step === 'compare' ? 'ผลเปรียบเทียบราคา' : 'ส่งออกผลเปรียบเทียบ'}</h2>
              <p>Product Master: {files.master?.name} · R05.105: {files.promaxx?.name}</p></div>
              {step === 'compare' && <button type="button" className="ep-button" onClick={() => setStep('export')}>ไปหน้า Export →</button>}
            </div>
            {result.skippedMissingUnits.length > 0 && <div className="ep-skipped-warning" role="status">
              <strong>ข้าม {result.skippedMissingUnits.length.toLocaleString()} รายการที่ไม่มีหน่วยในคอลัมน์ PURCHASE_UNIT</strong>
              <p>ผลเปรียบเทียบและไฟล์ส่งออกใช้เฉพาะรายการที่มีหน่วย</p>
              <details><summary>ดูรายการที่ข้าม</summary><MissingUnitRows rows={result.skippedMissingUnits} /></details>
            </div>}
            {filterControls}

            <section className="ep-selection-export" aria-labelledby="ep-selection-export-title">
              <div className="ep-panel-heading">
                <div><h3 id="ep-selection-export-title">ส่งออก TXT เฉพาะหน่วยที่เลือก</h3>
                  <p role="status">เลือก {selectedExportRows.length.toLocaleString()} รายการ</p></div>
                <div className="ep-inline-actions">
                  {step === 'compare' && <button type="button" className="ep-button ep-button--secondary" disabled={rows.length === 0}
                    onClick={selectFilteredExportRows}>เลือกหน่วยตามตัวกรอง</button>}
                  <button type="button" className="ep-button ep-button--secondary" disabled={exportRowIds.size === 0}
                    onClick={() => setExportRowIds(new Set())}>ล้างหน่วยที่เลือก</button>
                </div>
              </div>
              <p className="ep-hint">ติ๊กช่อง “เลือกหน่วย” เพื่อส่งออกเฉพาะแถว SKU และหน่วยนั้น รายการที่เลือกคงอยู่เมื่อเปลี่ยนตัวกรองหรือค้นหา · TXT ส่งออกได้ทั้งทุนเพิ่ม ทุนลด และทุนเท่าเดิม โดยใช้ราคาใหม่ของระดับที่เลือก</p>
              <div className="ep-export-buttons">{exportButtons({ rowIds: exportRowIds }, false, allRows)}</div>
            </section>

            {step === 'compare' ? <>
              <p className="ep-hint">ตัวกรองใช้สถานะรวมต่อ SKU · คลิกแถวหรือกด Enter เพื่อดูเทียบใน Selected Results ได้สูงสุด 10 แถว · ช่อง “ตรวจแล้ว” จำไว้เมื่อเปิดใช้งานครั้งถัดไป</p>
              <ComparisonTable rows={rows} checked={checked} selected={selected} exportRowIds={exportRowIds}
                onCheck={toggleCheck} onSelect={toggleSelect} onSelectExportRow={toggleExportRow} />
              {selected.size > 0 && <div className="ep-selected">
                <div className="ep-panel-heading"><h3>Selected Results · เลือก {selected.size}/10 แถว</h3>
                  <div className="ep-inline-actions"><label>ระดับราคา <select aria-label="ระดับราคา Selected Results" value={selectedLevel}
                    onChange={event => setSelectedLevel(Number(event.target.value) as PriceLevel)}>{PRICE_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}</select></label>
                    <button type="button" className="ep-button ep-button--secondary" onClick={() => setSelected(new Set())}>ล้างที่เลือก</button></div>
                </div>
                {selectedRows.length === 0 ? <p className="ep-hint">แถวที่เลือกถูกซ่อนโดยตัวกรองหรือคำค้นปัจจุบัน</p> : <div className="ep-mini-table-wrap"><table className="ep-mini-table" aria-label="Selected Results">
                  <thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th>หน่วย</th><th>ราคาเก่า</th><th>ราคาใหม่</th></tr></thead>
                  <tbody>{selectedRows.map(row => <tr key={row.id}><td>{row.sku}</td><td>{row.name}</td><td>{row.unit}</td>
                    <td>{formatPrice(priceAtLevel(row, selectedLevel, 'old'))}</td><td className="ep-new">{formatPrice(priceAtLevel(row, selectedLevel, 'new'))}</td></tr>)}</tbody>
                </table></div>}
              </div>}
            </> : <>
              <div className="ep-export-note">ปุ่มส่งออกด้านล่างใช้แถวตามตัวกรองและคำค้นด้านบน · TXT ส่งออกทุกรายการที่มีราคาใหม่ของระดับนั้น รวมทุนเพิ่ม ทุนลด และทุนเท่าเดิม · Excel รวมทุกแถวที่กรองได้</div>
              <div className="ep-export-group"><h3>TXT แยกตามระดับราคา</h3><p>SKU, ราคาใหม่ และระดับราคา คั่นด้วย Tab · UTF-8 BOM · ทศนิยม 2 ตำแหน่ง</p>
                <div className="ep-export-buttons">{exportButtons({})}</div>
              </div>
              <div className="ep-export-group"><h3>BASE_UNIT · เฉพาะหน่วยฐาน</h3><p>หน่วยตรงกับคอลัมน์ BASE_UNIT ของ Product Master</p>
                <div className="ep-export-buttons">{exportButtons({ baseUnitOnly: true }, true)}</div>
              </div>
              <details className="ep-unit-exports"><summary>TXT แยกตามหน่วย ({units.length.toLocaleString()} หน่วย)</summary>
                {units.map(unit => <div className="ep-unit-row" key={unit}><strong>{unit}</strong><div className="ep-export-buttons">{exportButtons({ unit })}</div></div>)}
              </details>
              <div className="ep-upload-footer"><span>รายงาน Excel: {rows.length.toLocaleString()} แถว รวมทุนและราคาเก่า/ใหม่</span>
                <button type="button" className="ep-button ep-button--secondary" disabled={rows.length === 0} onClick={exportExcel}>Export All (.xlsx)</button>
              </div>
              <details className="ep-export-preview" open><summary>Export Preview · 10 แถวแรกตามตัวกรอง</summary>
                {rows.length === 0 ? <p className="ep-hint">ไม่มีข้อมูลตามตัวกรองปัจจุบัน</p> : <div className="ep-mini-table-wrap"><table className="ep-mini-table" aria-label="Export Preview">
                  <thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th>หน่วย</th><th>ทุนเก่า</th><th>ทุนใหม่</th><th>ระดับ 0 ใหม่</th><th>ระดับ 1 ใหม่</th><th>ระดับ 5 ใหม่</th></tr></thead>
                  <tbody>{rows.slice(0, 10).map(row => <tr key={row.id}><td>{row.sku}</td><td>{row.name}</td><td>{row.unit}</td><td>{formatPrice(row.oldCost)}</td>
                    <td>{formatPrice(row.newCost)}</td>{([0, 1, 5] as const).map(level => <td key={level}>{formatPrice(row.newPrices[level])}</td>)}</tr>)}</tbody>
                </table></div>}
              </details>
              <div className="ep-export-log" aria-live="polite"><h3>Export Log</h3>
                {exports.length === 0 ? <p className="ep-hint">ยังไม่มีประวัติการส่งออกในครั้งนี้</p> : <ul>{exports.map((entry, index) => <li key={index}>
                  <time>{entry.time}</time><strong>{entry.filename}</strong><span>{entry.count.toLocaleString()} แถว</span>
                </li>)}</ul>}
              </div>
            </>}
          </section>
        </>}
      </main>
      {missingUnitWarning && <MissingUnitDialog rows={missingUnitWarning.rows} canContinue={missingUnitWarning.canContinue}
        onCancel={() => setMissingUnitWarning(null)} onCompare={() => { void compare(true); }} />}
    </div>
  );
}
