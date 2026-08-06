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
  requested?: boolean;
  requestedAt?: string;
  requestDate?: string;
  documentNo?: string;
  location?: string;
  enteredAt?: string;
  notFound?: boolean;
  stockQty?: string;     // จำนวนคงเหลือในคลังสินค้า ('' = ไม่มีในสต็อค)
  stockChecked?: boolean; // เช็คสต็อคแล้วหรือยัง
  outOfStock?: boolean;   // คลังสินค้ากด ✕ แจ้งว่าของหมด → สาขาเห็น "ของหมด" แทนปุ่มอนุมัติ
}

// สาขาคลังสินค้าในตาราง stock (map มาจาก Warehouse)
const WAREHOUSE_BRANCH = 'คลังสินค้า';

const STORAGE_KEY = 'outboundItems';

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDocumentNo(value: number) {
  return String(value).padStart(4, '0');
}

function makeRow(documentNo = '0001'): OutboundRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: '', barcode: '', name: '', unit: '',
    qty: '', branch: 'SRC',
    approved: false, approvedAt: '', requested: false, requestedAt: '', requestDate: todayIso(), documentNo, location: '', enteredAt: new Date().toISOString(),
  };
}

function loadRowsFromStorage(): OutboundRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OutboundRow[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((row, index) => ({
          ...row,
          requestDate: row.requestDate ?? todayIso(),
          documentNo: row.documentNo ?? formatDocumentNo(index + 1),
        }));
      }
    }
  } catch { /* ignore corrupt storage */ }
  return [makeRow()];
}

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
  isWarehouse: boolean;
  userBranch?: string;
}

export function OutboundPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport, isWarehouse, userBranch }: Props) {
  const [rows, setRows] = useState<OutboundRow[]>(loadRowsFromStorage);
  const [activeBranch, setActiveBranch] = useState<string>(isWarehouse ? BRANCHES[0] : (userBranch && BRANCHES.includes(userBranch as typeof BRANCHES[number]) ? userBranch : BRANCHES[0]));
  const [unlocked, setUnlocked] = useState(false);
  const [pwRowId, setPwRowId] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  const updateRow = (id: string, patch: Partial<OutboundRow>) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const branchRequest = !isWarehouse && r.branch === activeBranch
        ? { requested: true, requestedAt: r.requestedAt || new Date().toISOString() }
        : {};
      return { ...r, ...patch, ...branchRequest };
    }));
  };

  // ค้นหาสินค้าจาก Supabase ด้วย SKU หรือ Barcode แล้วเติมข้อมูลลงแถว
  // + เช็คจำนวนคงเหลือจากตาราง stock (สาขาคลังสินค้า)
  const lookupRow = async (id: string, term: string) => {
    const q = term.trim();
    if (!q) return;

    // 1) หาข้อมูลสินค้าจากตาราง products (รองรับ barcode → sku)
    const { data: pdata } = await supabase
      .from('products')
      .select('sku, barcode, name, unit')
      .or(`sku.eq.${q},barcode.eq.${q}`)
      .limit(1);
    const product = pdata?.[0];

    // 2) เช็คสต็อคจากคลังสินค้าด้วย sku (barcode เช็คไม่ได้เพราะ stock ไม่มีคอลัมน์ barcode)
    const skuForStock = product?.sku ?? (/^\d+$/.test(q) ? q : null);
    let stockRow: { sku?: string; name?: string; qty?: string; unit?: string } | null = null;
    if (skuForStock) {
      const { data: sdata } = await supabase
        .from('stock')
        .select('sku, name, qty, unit')
        .eq('branch', WAREHOUSE_BRANCH)
        .eq('sku', skuForStock)
        .limit(1);
      stockRow = sdata?.[0] ?? null;
    }

    if (product || stockRow) {
      updateRow(id, {
        sku: product?.sku ?? stockRow?.sku ?? q,
        barcode: product?.barcode ?? '',
        name: product?.name ?? stockRow?.name ?? '',
        unit: product?.unit ?? stockRow?.unit ?? '',
        stockQty: stockRow ? String(stockRow.qty ?? '0') : '',
        stockChecked: true,
        notFound: false,
      });
    } else {
      updateRow(id, { name: '', unit: '', stockQty: '', stockChecked: true, notFound: true });
    }
  };

  const visibleRows = rows.filter(row => row.branch === activeBranch);
  const addRow = () => setRows(prev => {
    const nextNo = prev.reduce((max, row) => Math.max(max, Number(row.documentNo) || 0), 0) + 1;
    return [...prev, { ...makeRow(formatDocumentNo(nextNo)), branch: activeBranch }];
  });

  const removeRow = (id: string) => {
    setRows(prev => {
      const next = prev.filter(r => r.id !== id);
      return next.length > 0 ? next : [makeRow()];
    });
  };

  // คลังสินค้ากด ✕ = แจ้งว่าของหมด (ไม่ใช่ลบแถว) — กดซ้ำเพื่อยกเลิกสถานะ
  const toggleOutOfStock = (row: OutboundRow) => {
    if (row.approved) { window.alert('รายการนี้อนุมัติไปแล้ว'); return; }
    updateRow(row.id, { outOfStock: !row.outOfStock });
  };

  const clearAll = () => {
    if (!window.confirm('ลบรายการเบิกทั้งหมด?')) return;
    setRows([makeRow('0001')]);
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
    updateRow(id, { approved: true, approvedAt: new Date().toISOString() });
  };

  const handleOutboundClick = (row: OutboundRow) => {
    if (row.approved) return;
    if (!row.sku || !row.name) { window.alert('กรุณาใส่ SKU หรือ Barcode ให้ระบบดึงข้อมูลสินค้าก่อน'); return; }
    if (!row.qty || Number(row.qty) <= 0) { window.alert('กรุณาใส่จำนวนที่เบิก'); return; }
    if (!isWarehouse) {
      updateRow(row.id, { requested: true, requestedAt: new Date().toISOString() });
      return;
    }
    if (!row.requested) { window.alert('รายการนี้ยังไม่ได้ส่งขออนุมัติจากสาขา'); return; }
    if (unlocked) { approveRow(row.id); return; }
    setPwInput('');
    setPwError('');
    setPwRowId(row.id);
  };

  const confirmPassword = () => {
    if (pwInput === WAREHOUSE_PASSWORD) {
      setUnlocked(true);
      if (pwRowId) approveRow(pwRowId);
      setPwRowId(null);
    } else {
      setPwError('รหัสผ่านไม่ถูกต้อง');
    }
  };

  const approvedCount = visibleRows.filter(r => r.approved).length;

  return (
    <div className="app-container">
      <div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="QUICK OUTBOUND" /></h1>
          <div className="tagline-row">
            <span className="updated-badge">เบิกสินค้าด่วน {unlocked ? '🔓' : '🔐'}</span>
          </div>
          <PageNavRow current="outbound" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport }} />
        </div>
      </div>

      <div className="container">
        <div className="product-table-wrap stock-table-wrap outbound-table-wrap">
          <div className="selected-table-header outbound-toolbar">
            <span>{visibleRows.length} รายการ · อนุมัติแล้ว {approvedCount}</span>
            {isWarehouse && (
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
              <button className="outbound-3d-btn" onClick={addRow} title="เพิ่มแถว">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="outbound-3d-btn-txt">เพิ่มแถว</span>
              </button>
              <button className="outbound-3d-btn outbound-3d-btn--clear" onClick={clearAll} title="ล้างทั้งหมด">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span className="outbound-3d-btn-txt">ล้างหมด</span>
              </button>
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
                {/* คอลัมน์ Branch แสดงเฉพาะคลังสินค้า — ฝั่งสาขารู้สาขาตัวเองจากรหัสที่ล็อกอินอยู่แล้ว */}
                {isWarehouse && <th className="ob-col-branch">Branch</th>}
                <th className="ob-col-outbound">Outbound</th>
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
                    <input
                      type="text"
                      className="outbound-input"
                      placeholder="SKU"
                      value={row.sku}
                      disabled={row.approved}
                      onChange={e => updateRow(row.id, { sku: e.target.value, notFound: false, stockChecked: false, stockQty: '' })}
                      onBlur={e => lookupRow(row.id, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') lookupRow(row.id, row.sku); }}
                    />
                  </td>
                  <td className="ob-col-barcode">
                    <input
                      type="text"
                      className="outbound-input"
                      placeholder="Barcode"
                      value={row.barcode}
                      disabled={row.approved}
                      onChange={e => updateRow(row.id, { barcode: e.target.value, notFound: false, stockChecked: false, stockQty: '' })}
                      onBlur={e => lookupRow(row.id, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') lookupRow(row.id, row.barcode); }}
                    />
                  </td>
                  <td className="ob-col-name">
                    {row.notFound
                      ? <span className="outbound-notfound">ไม่พบสินค้า</span>
                      : row.name || <span className="outbound-hint">สแกน/พิมพ์ SKU หรือ Barcode แล้วกด Enter</span>}
                  </td>
                  <td className="ob-col-unit">{row.unit}</td>
                  <td className="ob-col-stock">
                    {!row.stockChecked || row.notFound ? null
                      : row.stockQty !== '' && Number(row.stockQty) > 0
                        ? <span className="outbound-instock">คงเหลือ {Math.floor(Number(row.stockQty))}</span>
                        : <span className="outbound-nostock">ไม่มีสินค้าในสต็อค</span>}
                  </td>
                  <td className="ob-col-qty">
                    <input
                      type="number"
                      className="outbound-input outbound-input--qty"
                      placeholder="0"
                      min="0"
                      value={row.qty}
                      disabled={row.approved}
                      onChange={e => updateRow(row.id, { qty: e.target.value })}
                    />
                  </td>
                  <td className="ob-col-request-date">
                    <input
                      type="date"
                      className="outbound-input outbound-date-input"
                      value={row.requestDate ?? todayIso()}
                      disabled={row.approved}
                      onChange={e => updateRow(row.id, { requestDate: e.target.value })}
                    />
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
                        onChange={e => updateRow(row.id, { branch: e.target.value })}
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
                      <span className="outbound-outofstock-mark">ของหมด ✕</span>
                    ) : !isWarehouse ? (
                      <div className="outbound-pending-mark">รออนุมัติ</div>
                    ) : row.requested ? (
                      isWarehouse ? (
                        <button className="outbound-approve-btn" onClick={() => handleOutboundClick(row)}>
                          อนุมัติ
                        </button>
                      ) : null
                    ) : (
                      isWarehouse ? (
                        <div className="outbound-waiting-mark">รอสาขาส่งรายการ</div>
                      ) : (
                        <button className="outbound-approve-btn" onClick={() => handleOutboundClick(row)}>
                          Outbound
                        </button>
                      )
                    )}
                  </td>
                  <td className="ob-col-del">
                    {isWarehouse ? (
                      <button
                        className={`outbound-del-btn${row.outOfStock ? ' outbound-del-btn--active' : ''}`}
                        title={row.outOfStock ? 'ยกเลิกสถานะของหมด' : 'แจ้งสาขาว่าของหมด'}
                        onClick={() => toggleOutOfStock(row)}
                      >✕</button>
                    ) : (
                      <button className="outbound-del-btn" title="ลบแถว" onClick={() => removeRow(row.id)}>✕</button>
                    )}
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
              <span>🔐 ใส่รหัสผ่านเพื่ออนุมัติ</span>
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
