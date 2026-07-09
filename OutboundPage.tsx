import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';

const BRANCHES = ['SRC', 'KKL', 'SSS'] as const;

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
  notFound?: boolean;
}

const STORAGE_KEY = 'outboundItems';

function makeRow(): OutboundRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: '', barcode: '', name: '', unit: '',
    qty: '', branch: 'SRC',
    approved: false, approvedAt: '',
  };
}

function loadRowsFromStorage(): OutboundRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OutboundRow[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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
}

export function OutboundPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound }: Props) {
  const [rows, setRows] = useState<OutboundRow[]>(loadRowsFromStorage);
  const [unlocked, setUnlocked] = useState(false);
  const [pwRowId, setPwRowId] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  const updateRow = (id: string, patch: Partial<OutboundRow>) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  // ค้นหาสินค้าจาก Supabase ด้วย SKU หรือ Barcode แล้วเติมข้อมูลลงแถว
  const lookupRow = async (id: string, term: string) => {
    const q = term.trim();
    if (!q) return;
    const { data, error } = await supabase
      .from('products')
      .select('sku, barcode, name, unit')
      .or(`sku.eq.${q},barcode.eq.${q}`)
      .limit(1);
    if (!error && data && data[0]) {
      updateRow(id, {
        sku: data[0].sku ?? '',
        barcode: data[0].barcode ?? '',
        name: data[0].name ?? '',
        unit: data[0].unit ?? '',
        notFound: false,
      });
    } else {
      updateRow(id, { name: '', unit: '', notFound: true });
    }
  };

  const addRow = () => setRows(prev => [...prev, makeRow()]);

  const removeRow = (id: string) => {
    setRows(prev => {
      const next = prev.filter(r => r.id !== id);
      return next.length > 0 ? next : [makeRow()];
    });
  };

  const clearAll = () => {
    if (!window.confirm('ลบรายการเบิกทั้งหมด?')) return;
    setRows([makeRow()]);
  };

  const approveRow = (id: string) => {
    updateRow(id, { approved: true, approvedAt: new Date().toISOString() });
  };

  const handleOutboundClick = (row: OutboundRow) => {
    if (row.approved) return;
    if (!row.sku || !row.name) { window.alert('กรุณาใส่ SKU หรือ Barcode ให้ระบบดึงข้อมูลสินค้าก่อน'); return; }
    if (!row.qty || Number(row.qty) <= 0) { window.alert('กรุณาใส่จำนวนที่เบิก'); return; }
    if (unlocked) { approveRow(row.id); return; }
    setPwInput('');
    setPwError('');
    setPwRowId(row.id);
  };

  const confirmPassword = () => {
    if (pwInput === (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) {
      setUnlocked(true);
      if (pwRowId) approveRow(pwRowId);
      setPwRowId(null);
    } else {
      setPwError('รหัสผ่านไม่ถูกต้อง');
    }
  };

  const approvedCount = rows.filter(r => r.approved).length;

  return (
    <div className="app-container">
      <div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="QUICK OUTBOUND" /></h1>
          <div className="tagline-row">
            <span className="updated-badge">เบิกสินค้าด่วน {unlocked ? '🔓' : '🔐'}</span>
          </div>
          <div className="search-nav-row">
            <button className="page-nav-card" onClick={onGoPriceTag} title="ป้ายราคา">
              <span className="page-nav-icon">🏷️</span>
              <span className="page-nav-label">ป้ายราคา</span>
            </button>
            <button className="page-nav-card" onClick={onGoDrugLabel} title="ฉลากยา">
              <span className="page-nav-icon">📝</span>
              <span className="page-nav-label">ฉลากยา</span>
            </button>
            <button className="page-nav-card" onClick={onGoStockCheck} title="เช็คสต๊อค">
              <span className="page-nav-icon">📦</span>
              <span className="page-nav-label">สต๊อค</span>
            </button>
            <button className="page-nav-card" onClick={onGoCustomerHistory} title="ประวัติลูกค้า">
              <span className="page-nav-icon">🪪</span>
              <span className="page-nav-label">ประวัติ</span>
            </button>
            <button className="page-nav-card page-nav-card--active" onClick={onGoOutbound} title="เบิกสินค้าด่วน">
              <span className="page-nav-icon">🚚</span>
              <span className="page-nav-label">เบิกด่วน</span>
            </button>
          </div>
        </div>
      </div>

      <div className="container">
        <div className="product-table-wrap stock-table-wrap">
          <div className="selected-table-header outbound-toolbar">
            <span>{rows.length} รายการ · อนุมัติแล้ว {approvedCount}</span>
            <div className="outbound-toolbar-btns">
              <button className="btn-cart-toggle" onClick={addRow}>➕ เพิ่มแถว</button>
              <button className="btn-cart-toggle" onClick={clearAll}>🗑️ ล้างทั้งหมด</button>
            </div>
          </div>
          <table className="product-table stock-table outbound-table">
            <thead>
              <tr>
                <th className="ob-col-sku">SKU</th>
                <th className="ob-col-barcode">Barcode</th>
                <th className="ob-col-name">Name</th>
                <th className="ob-col-unit">Unit</th>
                <th className="ob-col-qty">Quantity</th>
                <th className="ob-col-branch">Branch</th>
                <th className="ob-col-outbound">Outbound</th>
                <th className="ob-col-del"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className={row.approved ? 'outbound-row--approved' : ''}>
                  <td className="ob-col-sku">
                    <input
                      type="text"
                      className="outbound-input"
                      placeholder="SKU"
                      value={row.sku}
                      disabled={row.approved}
                      onChange={e => updateRow(row.id, { sku: e.target.value, notFound: false })}
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
                      onChange={e => updateRow(row.id, { barcode: e.target.value, notFound: false })}
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
                  <td className="ob-col-outbound">
                    {row.approved ? (
                      <div className="outbound-approved-mark">
                        ✅ อนุมัติแล้ว
                        <span className="outbound-approved-time">
                          {row.approvedAt && new Date(row.approvedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                    ) : (
                      <button className="outbound-approve-btn" onClick={() => handleOutboundClick(row)}>
                        Outbound
                      </button>
                    )}
                  </td>
                  <td className="ob-col-del">
                    <button className="outbound-del-btn" title="ลบแถว" onClick={() => removeRow(row.id)}>✕</button>
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
                placeholder="รหัสผ่าน admin"
                autoFocus
                value={pwInput}
                onChange={e => { setPwInput(e.target.value); setPwError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') confirmPassword(); }}
              />
              {pwError && <div className="outbound-notfound">{pwError}</div>}
            </div>
            <div className="dl-modal-footer">
              <button className="btn-cart-toggle" onClick={confirmPassword}>✔ ยืนยัน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
