import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { SearchIcon } from './SearchIcon';

interface CustomerRecord {
  purchase_date: string | null;
  phone: string;
  first_name: string;
  last_name: string;
  sku: string;
  product_name: string;
}

/** ดึงดิบสูงสุดกี่แถวต่อการค้นหา (ยุบแถวซ้ำฝั่งเว็บหลังจากนี้) */
const ROW_LIMIT = 1000;

interface Props {
  onGoPriceTag: () => void;
  onGoDrugLabel: () => void;
  onGoStockCheck: () => void;
  onGoCustomerHistory: () => void;
  onGoOutbound: () => void;
  onGoSaleSupport: () => void;
}

export function CustomerHistoryPage({ onGoPriceTag, onGoDrugLabel, onGoStockCheck, onGoCustomerHistory, onGoOutbound, onGoSaleSupport }: Props) {
  const [results,       setResults]       = useState<CustomerRecord[]>([]);
  const [search,        setSearch]        = useState('');
  const [searching,     setSearching]     = useState(false);
  const [searched,      setSearched]      = useState(false);
  const [lastUploaded,  setLastUploaded]  = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [truncated,     setTruncated]     = useState(false);

  const loadLastUploaded = useCallback(async () => {
    const { data } = await supabase
      .from('customer_history')
      .select('uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(1);
    if (data?.[0]?.uploaded_at) {
      const d = new Date(data[0].uploaded_at);
      setLastUploaded(d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }));
    }
  }, []);

  useEffect(() => {
    loadLastUploaded();
    const interval = window.setInterval(loadLastUploaded, 60_000);
    const handleFocus = () => loadLastUploaded();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadLastUploaded();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadLastUploaded]);

  const doSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) { setResults([]); setSearched(false); return; }
    setSearching(true);
    setSearched(true);
    const parts = q.split(/\s+/).filter(Boolean);
    let query = supabase
      .from('customer_history')
      .select('purchase_date, phone, first_name, last_name, sku, product_name')
      .order('purchase_date', { ascending: false })
      .limit(ROW_LIMIT);
    if (parts.length >= 2) {
      query = query.ilike('first_name', `%${parts[0]}%`).ilike('last_name', `%${parts[1]}%`);
    } else {
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    const { data, error } = await query;
    if (!error && data) {
      setTruncated(data.length === ROW_LIMIT);
      // ลูกค้าคนเดียวกันซื้อสินค้าเดิมซ้ำ → เหลือแถวเดียว เอาวันที่ล่าสุด
      const latest = new Map<string, CustomerRecord>();
      for (const r of data) {
        const rec: CustomerRecord = {
          purchase_date: r.purchase_date ?? null,
          phone:        r.phone        ?? '',
          first_name:   r.first_name   ?? '',
          last_name:    r.last_name    ?? '',
          sku:          r.sku          ?? '',
          product_name: r.product_name ?? '',
        };
        const key = `${rec.phone}|${rec.first_name}|${rec.last_name}|${rec.sku}|${rec.product_name}`;
        const prev = latest.get(key);
        if (!prev || (rec.purchase_date ?? '') > (prev.purchase_date ?? '')) latest.set(key, rec);
      }
      setResults([...latest.values()]);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const visible = results.filter(r => r.product_name.toLowerCase().includes(productSearch.toLowerCase()));

  return (
    <div className="app-container">
      <div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium"><AnimatedLogoText text="CUSTOMER HISTORY" /></h1>
          <div className="tagline-row">
            {lastUploaded
              ? <span className="updated-badge">Last Updated : {lastUploaded}</span>
              : <span className="updated-badge updated-badge--loading">Loading...</span>
            }
          </div>
          <PageNavRow current="customerhistory" handlers={{ pricetag: onGoPriceTag, druglabel: onGoDrugLabel, stockcheck: onGoStockCheck, customerhistory: onGoCustomerHistory, outbound: onGoOutbound, salesupport: onGoSaleSupport }} />
        </div>
      </div>

      <div className="container">
        <div className="table-search-row">
          <div className="search-premium">
            <input
              type="text"
              className="search-input-premium"
              placeholder="ค้นหาชื่อ นามสกุล หรือเบอร์โทร..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="search-btn-premium">
              {searching ? '⏳' : <SearchIcon />}
            </button>
          </div>
        </div>

        {searched && (
          <div className="product-table-wrap stock-table-wrap">
            <div className="selected-table-header">
              <span>{searching ? 'กำลังค้นหา…' : `${visible.length} รายการ ${truncated ? `(จากข้อมูล ${ROW_LIMIT.toLocaleString()} แถวล่าสุด)` : ''}`}</span>
              <input
                type="text"
                placeholder="ค้นหาชื่อยา..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                className="search-input-premium"
                style={{ fontSize: '0.82rem', padding: '4px 10px', width: '200px', marginLeft: 'auto' }}
              />
            </div>
            <table className="product-table stock-table">
              <thead>
                <tr>
                  <th className="cust-col-date">วันที่ซื้อ</th>
                  <th className="cust-col-phone">เบอร์โทร</th>
                  <th className="cust-col-name">ชื่อลูกค้า</th>
                  <th className="cust-col-sku">SKU</th>
                  <th className="cust-col-product">ชื่อสินค้า</th>
                </tr>
              </thead>
              {searching ? (
                <tbody className="ch-skeleton">
                  {Array.from({ length: 6 }, (_, i) => (
                    <tr key={i}>
                      <td className="cust-col-date"><span /></td>
                      <td className="cust-col-phone"><span /></td>
                      <td className="cust-col-name"><span /></td>
                      <td className="cust-col-sku"><span /></td>
                      <td className="cust-col-product"><span /></td>
                    </tr>
                  ))}
                </tbody>
              ) : (
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                        ไม่พบข้อมูล
                      </td>
                    </tr>
                  ) : (
                    visible.map((item, i) => (
                      <tr key={i}>
                        <td className="cust-col-date">{item.purchase_date ? new Date(item.purchase_date).toLocaleDateString('th-TH') : '-'}</td>
                        <td className="cust-col-phone">{item.phone}</td>
                        <td className="cust-col-name">{item.first_name} {item.last_name}</td>
                        <td className="cust-col-sku">{item.sku}</td>
                        <td className="cust-col-product">{item.product_name}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              )}
            </table>
          </div>
        )}

        {!searched && (
          <div className="stock-empty-state">
            <div className="stock-empty-icon">
              <svg className="stock-empty-icon-img" viewBox="0 0 96 96" aria-hidden="true">
                <rect x="22" y="30" width="52" height="36" rx="4" fill="none" stroke="#4891db" strokeWidth="3.5" />
                <circle cx="35" cy="48" r="7" fill="none" stroke="#4891db" strokeWidth="3" />
                <line x1="50" y1="41" x2="66" y2="41" stroke="#4891db" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="50" y1="49" x2="66" y2="49" stroke="#4891db" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="50" y1="57" x2="60" y2="57" stroke="#4891db" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>พิมพ์ชื่อหรือนามสกุลลูกค้าในช่องค้นหาด้านบน</div>
          </div>
        )}
      </div>
    </div>
  );
}
