import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { SearchIcon } from './SearchIcon';
import { useStockSync } from './useStockSync';

interface StockItem {
  branch: string;
  sku: string;
  name: string;
  qty: string;
  unit: string;
  price: string;
}

const TABS = ['คลังสินค้า', 'SRC', 'KKL', 'SSS'] as const;

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
  onGoPendingDocs: () => void;
}

export function StockCheckPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport, onGoPendingDocs }: Props) {
  const [results,      setResults]      = useState<StockItem[]>([]);
  const [activeTab,    setActiveTab]    = useState<string>('คลังสินค้า');
  const [search,       setSearch]       = useState('');
  const [searching,    setSearching]    = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [lastUploaded, setLastUploaded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState('');
  const [searchVersion, setSearchVersion] = useState(0);
  const searchSeqRef = useRef(0);
  const sync = useStockSync();
  const [refreshComplete, setRefreshComplete] = useState(false);
  const wasSyncBusy = useRef(false);

  useEffect(() => {
    const completed = wasSyncBusy.current && !sync.busy && sync.dataMs !== null
      && !sync.statusError && !sync.agentError && !sync.agentSilent;
    wasSyncBusy.current = sync.busy;
    setRefreshComplete(completed);
    if (!completed) return;
    const timer = window.setTimeout(() => setRefreshComplete(false), 1800);
    return () => window.clearTimeout(timer);
  }, [sync.busy, sync.dataMs, sync.statusError, sync.agentError, sync.agentSilent]);

  // ระหว่างทยอยติดตั้ง Agent ยังแสดงชุด CSV เดิมได้; ไม่ค้างป้าย Loading เมื่ออ่านไม่ได้.
  useEffect(() => {
    if (sync.available !== false) return;
    supabase
      .from('stock')
      .select('uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (data?.[0]?.uploaded_at) {
          const d = new Date(data[0].uploaded_at);
          if (Number.isFinite(d.getTime())) setLastUploaded(d.getTime());
        } else if (error) setLoadError('อ่านข้อมูลสต๊อคไม่สำเร็จ กรุณาลองอีกครั้ง');
      });
  }, [sync.available]);

  useEffect(() => {
    // ยกเลิกผลเก่าทันทีที่เปลี่ยนคำค้น/คลัง แม้คำขอเก่ายังไม่เสร็จ.
    const seq = ++searchSeqRef.current;
    const q = search.trim();
    if (!q) {
      setResults([]); setSearched(false); setSearching(false); setLoadError('');
      return;
    }
    setSearching(true);
    setSearched(true);
    setResults([]);
    setLoadError('');
    const timer = window.setTimeout(async () => {
      try {
        const query = supabase.from('stock').select('branch, sku, name, qty, unit, price')
          .eq('branch', activeTab).order('sku').limit(300);
        const { data, error } = await (/^\d+$/.test(q)
          ? query.ilike('sku', `${q}%`)
          : query.ilike('name', `%${q}%`));
        if (seq !== searchSeqRef.current) return;
        if (error) throw error;
        setResults((data ?? []).map(row => ({
          branch: row.branch ?? '', sku: row.sku ?? '', name: row.name ?? '',
          qty: row.qty ?? '', unit: row.unit ?? '', price: row.price ?? '',
        })));
      } catch {
        if (seq !== searchSeqRef.current) return;
        setLoadError('ค้นหาสต๊อคไม่สำเร็จ กรุณาลองอีกครั้ง');
      } finally { if (seq === searchSeqRef.current) setSearching(false); }
    }, 200);
    return () => { window.clearTimeout(timer); ++searchSeqRef.current; };
  }, [search, activeTab, sync.dataVersion, searchVersion]);

  const formatTime = (ms: number) => new Date(ms).toLocaleString('en-GB', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok',
  });
  const stampMs = sync.dataMs ?? lastUploaded;
  const initialLoading = sync.available === null && !sync.statusError;
  const syncLoading = !sync.statusError && !sync.agentSilent && (sync.busy || initialLoading);
  const syncMessage = sync.statusError || (sync.agentSilent ? 'เครื่องในร้านไม่ตอบ กรุณาลองอีกครั้ง'
    : sync.busy ? '' : sync.agentError || (stampMs === null && sync.available !== null
      ? sync.available ? 'ยังไม่มีข้อมูลจากเครื่องในร้าน' : 'ยังไม่มีข้อมูลสต๊อค' : ''));
  const syncFailed = Boolean(sync.statusError || (!sync.busy && !sync.agentSilent && sync.agentError));
  const syncState = syncLoading ? 'loading' : refreshComplete ? 'success' : 'idle';
  const refreshLabel = initialLoading ? 'กำลังตรวจสอบ…' : syncLoading ? 'กำลังดึงข้อมูล…'
    : refreshComplete ? 'อัปเดตแล้ว' : 'ดึงข้อมูลล่าสุด';

  return (
    <div className="app-container">
      <div className="hero-header pd-glass-hero">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="CHECK STOCK" /></h1>
          <div className="tagline-row pd-glass-row">
            <div className="pd-glass-controls" data-state={syncState} aria-busy={syncLoading}>
              <div className="pd-glass-stamp" title={sync.successMs !== null ? `สต๊อคเปลี่ยนครั้งล่าสุด ${formatTime(sync.successMs)}` : undefined}>
                <span className="pd-glass-caption">ข้อมูล ณ <time className="pd-glass-date" dateTime={stampMs !== null ? new Date(stampMs).toISOString() : undefined}>
                  {stampMs !== null ? new Date(stampMs).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok' }) : '—'}
                </time></span>
                <time className="pd-glass-clock" dateTime={stampMs !== null ? new Date(stampMs).toISOString() : undefined}>
                  {stampMs !== null ? new Date(stampMs).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' }) : '--:--:--'}
                </time>
              </div>
              {(sync.available !== false || sync.statusError) && <button
                type="button"
                className="pd-glass-refresh"
                disabled={initialLoading || (sync.busy && !sync.agentSilent)}
                onClick={() => { void sync.refresh(); }}
                title="ขอข้อมูลล่าสุดจาก ProMaxx"
              >
                {syncLoading ? <span className="pd-glass-loader" aria-hidden="true" /> : <svg className={refreshComplete ? 'pd-glass-check' : undefined} viewBox="0 0 24 24" aria-hidden="true">
                  {refreshComplete ? <path d="m5 12 4.5 4.5L19 7" /> : <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1.7L20 8M4 16l2.3 2.7A7 7 0 0 0 17.9 17" /></>}
                </svg>}
                <span>{refreshLabel}</span>
              </button>}
            </div>
            <span className="pd-glass-announcement" role="status" aria-live="polite">{syncLoading
              ? initialLoading ? 'กำลังอ่านสถานะสต๊อค' : 'กำลังดึงข้อมูลล่าสุด'
              : refreshComplete ? 'ตรวจข้อมูลล่าสุดสำเร็จ' : ''}</span>
            {syncMessage && <div className={`pd-glass-feedback${syncFailed ? ' pd-glass-feedback--error' : ''}`} role="status" aria-live="polite">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4m0 4h.01" /></svg>
              <span>{syncMessage}</span>
            </div>}
          </div>
          <PageNavRow current="stockcheck" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport, pendingdocs: onGoPendingDocs }} />
        </div>
      </div>

      <div className="container">
        <div className="table-search-row table-search-row--match-table">
          <div className="search-premium">
            <input
              type="text"
              className="search-input-premium"
              placeholder="ค้นหา SKU หรือชื่อสินค้า..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setSearchVersion(value => value + 1); }}
            />
            <button className="search-btn-premium" type="button" aria-label="ค้นหา" onClick={() => setSearchVersion(value => value + 1)}>
              {searching ? '⏳' : <SearchIcon />}
            </button>
          </div>
        </div>

        {loadError && <div className="pd-load-error" role="alert">{loadError}</div>}

        {searched && <div className="stock-tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`stock-tab${activeTab === tab ? ' stock-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>}

        {searched && (
          <div className="product-table-wrap stock-table-wrap">
            <div className="selected-table-header">
              <span>{searching ? 'กำลังค้นหา…' : `${results.length} รายการ${results.length === 300 ? ' (แสดงสูงสุด 300)' : ''}`}</span>
            </div>
            <table className="product-table stock-table">
              <thead>
                <tr>
                  <th className="stock-col-sku">SKU</th>
                  <th className="stock-col-name">ชื่อสินค้า</th>
                  <th className="stock-col-qty">จำนวน</th>
                  <th className="stock-col-unit">หน่วย</th>
                  <th className="stock-col-price">ราคาต่อหน่วย</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                      {searching ? 'กำลังค้นหา…' : loadError ? 'ไม่สามารถแสดงผลการค้นหาได้' : 'ไม่พบข้อมูล'}
                    </td>
                  </tr>
                ) : (
                  results.map((item, i) => (
                    <tr key={i}>
                      <td className="stock-col-sku">{item.sku}</td>
                      <td className="stock-col-name">{item.name}</td>
                      <td className="stock-col-qty">{isNaN(Number(item.qty)) ? item.qty : Math.floor(Number(item.qty))}</td>
                      <td className="stock-col-unit">{item.unit}</td>
                      <td className="stock-col-price">{isNaN(Number(item.price)) ? item.price : Math.floor(Number(item.price)).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!searched && (
          <div className="stock-empty-state">
            <div className="stock-empty-icon">
              <svg className="stock-empty-icon-img" viewBox="0 0 96 96" aria-hidden="true">
                <path d="M48 20 L74 33 L74 63 L48 76 L22 63 L22 33 Z" fill="none" stroke="#4891db" strokeWidth="4" strokeLinejoin="round" />
                <path d="M22 33 L48 46 L74 33" fill="none" stroke="#4891db" strokeWidth="4" strokeLinejoin="round" />
                <path d="M48 46 L48 76" fill="none" stroke="#4891db" strokeWidth="4" />
              </svg>
            </div>
            <div>พิมพ์ SKU หรือชื่อสินค้าในช่องค้นหาด้านบน</div>
          </div>
        )}
      </div>
    </div>
  );
}
