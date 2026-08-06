import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { AnimatedLogoText } from './AnimatedLogo';
import { PageNavRow } from './pageAccess';
import { SearchIcon } from './SearchIcon';

interface CustomerRecord {
  phone: string;
  first_name: string;
  last_name: string;
  sku: string;
  product_name: string;
}

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

  useEffect(() => {
    supabase
      .from('customer_history')
      .select('uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.uploaded_at) {
          const d = new Date(data[0].uploaded_at);
          setLastUploaded(d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }));
        }
      });
  }, []);

  const doSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) { setResults([]); setSearched(false); return; }
    setSearching(true);
    setSearched(true);
    const parts = q.split(/\s+/).filter(Boolean);
    let query = supabase
      .from('customer_history')
      .select('phone, first_name, last_name, sku, product_name')
      .order('first_name')
      .limit(300);
    if (parts.length >= 2) {
      query = query.ilike('first_name', `%${parts[0]}%`).ilike('last_name', `%${parts[1]}%`);
    } else {
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    const { data, error } = await query;
    if (!error && data) {
      setResults(data.map(r => ({
        phone:        r.phone        ?? '',
        first_name:   r.first_name   ?? '',
        last_name:    r.last_name    ?? '',
        sku:          r.sku          ?? '',
        product_name: r.product_name ?? '',
      })));
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

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
              <span>{results.filter(r => r.product_name.toLowerCase().includes(productSearch.toLowerCase())).length} รายการ {results.length === 300 && '(แสดงสูงสุด 300)'}</span>
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
                  <th className="cust-col-phone">เบอร์โทร</th>
                  <th className="cust-col-name">ชื่อลูกค้า</th>
                  <th className="cust-col-sku">SKU</th>
                  <th className="cust-col-product">ชื่อสินค้า</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>
                      ไม่พบข้อมูล
                    </td>
                  </tr>
                ) : (
                  results.filter(r => r.product_name.toLowerCase().includes(productSearch.toLowerCase())).map((item, i) => (
                    <tr key={i}>
                      <td className="cust-col-phone">{item.phone}</td>
                      <td className="cust-col-name">{item.first_name} {item.last_name}</td>
                      <td className="cust-col-sku">{item.sku}</td>
                      <td className="cust-col-product">{item.product_name}</td>
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
